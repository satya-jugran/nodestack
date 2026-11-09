import * as crypto from 'crypto';
import { DatabaseService } from '../../database/DatabaseService';
import {
  QueueMessage,
  EnqueueMessageDto,
  MessageFailResult,
  ReclaimOrphanedOptions,
} from '../types';
import { mapRowToMessage } from './queueMapping';

export class SyncQueueEngine {
  constructor(private db: DatabaseService) {}

  public deleteQueue(name: string): boolean {
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM _queue_messages WHERE queue = ?').run(name);
      const res: any = this.db.prepare('DELETE FROM _queues WHERE name = ?').run(name);
      return Number(res?.changes || 0) > 0;
    });
  }

  public send<T = any>(dto: EnqueueMessageDto<T>): QueueMessage<T> {
    return this.db.transaction(() => {
      return this.insertMessageSync(dto);
    });
  }

  public sendBatch<T = any>(messages: EnqueueMessageDto<T>[]): QueueMessage<T>[] {
    if (!messages || messages.length === 0) return [];
    return this.db.transaction(() => {
      return messages.map((j) => this.insertMessageSync(j));
    });
  }

  public insertMessageSync<T = any>(dto: EnqueueMessageDto<T>): QueueMessage<T> {
    const existingQueue = this.db.prepare('SELECT * FROM _queues WHERE name = ?').get(dto.queue) as any;
    const now = new Date().toISOString();

    let defaultMaxAttempts = 3;
    if (!existingQueue) {
      const isSys = dto.queue.startsWith('_system:') ? 1 : 0;
      this.db.prepare(`
        INSERT OR IGNORE INTO _queues (
          name, concurrency, visibilityTimeoutSeconds, maxAttempts, backoffDelayMs,
          deadLetterQueue, targetFunction, isSystem, strictOrder, created, updated
        ) VALUES (?, 0, 30, 3, 1000, NULL, NULL, ?, 0, ?, ?)
      `).run(dto.queue, isSys, now, now);
    } else {
      defaultMaxAttempts = existingQueue.maxAttempts ?? 3;
    }

    if (dto.deduplicationId) {
      const dup = this.db.prepare(`
        SELECT * FROM _queue_messages
        WHERE queue = ? AND deduplicationId = ? AND status IN ('queued', 'processing')
        LIMIT 1
      `).get(dto.queue, dto.deduplicationId) as any;
      if (dup) {
        return mapRowToMessage<T>(dup);
      }
    }

    const id = dto.id || `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const delayMs = dto.delaySeconds && dto.delaySeconds > 0 ? Math.floor(dto.delaySeconds * 1000) : 0;
    const availableAt = delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : now;
    const priority = dto.priority !== undefined ? Math.floor(dto.priority) : 0;
    const maxAttempts = dto.maxAttempts !== undefined ? Math.max(0, Math.floor(dto.maxAttempts)) : defaultMaxAttempts;
    const payloadStr = dto.payload !== undefined ? JSON.stringify(dto.payload) : null;

    this.db.prepare(`
      INSERT INTO _queue_messages (
        id, queue, groupKey, status, payload, result, error,
        attempts, maxAttempts, priority, availableAt, claimedBy,
        leaseExpiresAt, deduplicationId, originalMessageId, created, updated, finishedAt
      ) VALUES (?, ?, ?, 'queued', ?, NULL, NULL, 0, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL)
    `).run(
      id,
      dto.queue,
      dto.groupKey ?? null,
      payloadStr,
      maxAttempts,
      priority,
      availableAt,
      dto.deduplicationId ?? null,
      dto.originalMessageId ?? null,
      now,
      now
    );

    const row = this.db.prepare('SELECT * FROM _queue_messages WHERE id = ?').get(id) as any;
    return mapRowToMessage<T>(row);
  }

  public claim<T = any>(
    queueName: string,
    claimedBy: string,
    visibilityTimeoutSeconds: number,
    limit = 1
  ): QueueMessage<T>[] {
    const safeLimit = Math.max(1, Math.floor(limit));
    const timeoutSec = Math.max(1, Math.floor(visibilityTimeoutSeconds || 30));

    return this.db.transaction(() => {
      const now = new Date().toISOString();
      const leaseExpiresAt = new Date(Date.now() + timeoutSec * 1000).toISOString();

      // 0. Enforce queue-level concurrency cap if configured in _queues
      const queueRow = this.db.prepare('SELECT concurrency, strictOrder FROM _queues WHERE name = ?').get(queueName) as { concurrency: number; strictOrder: number } | undefined;
      let effectiveLimit = safeLimit;
      if (queueRow && typeof queueRow.concurrency === 'number' && queueRow.concurrency >= 1) {
        const activeRow = this.db.prepare(`
          SELECT COUNT(*) as cnt FROM _queue_messages
          WHERE queue = ? AND status = 'processing' AND (leaseExpiresAt IS NULL OR leaseExpiresAt > ?)
        `).get(queueName, now) as { cnt: number };
        const availableSlots = Math.max(0, queueRow.concurrency - (activeRow?.cnt || 0));
        effectiveLimit = Math.min(safeLimit, availableSlots);
      }

      if (effectiveLimit <= 0) {
        return [];
      }

      // 1. Select candidate IDs in deterministic priority + FIFO / group-partitioned order
      let candidates: Array<{ id: string }>;
      if (queueRow && Boolean(queueRow.strictOrder)) {
        candidates = this.db.prepare(`
          WITH partition_hol AS (
            SELECT
              id,
              status,
              availableAt,
              priority,
              created,
              rowid as rid,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(groupKey, '')
                ORDER BY created ASC, rowid ASC
              ) as rn
            FROM _queue_messages
            WHERE queue = ?
              AND status IN ('queued', 'processing')
          )
          SELECT id FROM partition_hol
          WHERE rn = 1
            AND status = 'queued'
            AND availableAt <= ?
          ORDER BY created ASC, rid ASC
          LIMIT ?
        `).all(queueName, now, effectiveLimit) as Array<{ id: string }>;
      } else {
        candidates = this.db.prepare(`
          SELECT id FROM _queue_messages
          WHERE queue = ?
            AND status = 'queued'
            AND availableAt <= ?
          ORDER BY priority DESC, availableAt ASC, rowid ASC
          LIMIT ?
        `).all(queueName, now, effectiveLimit) as Array<{ id: string }>;
      }

      if (!candidates || candidates.length === 0) {
        return [];
      }

      const claimedMessages: QueueMessage<T>[] = [];
      const updateStmt = this.db.prepare(`
        UPDATE _queue_messages
        SET status = 'processing',
            claimedBy = ?,
            leaseExpiresAt = ?,
            claimToken = ?,
            attempts = attempts + 1,
            updated = ?
        WHERE id = ? AND status = 'queued'
      `);
      const selectStmt = this.db.prepare('SELECT * FROM _queue_messages WHERE id = ?');

      for (const candidate of candidates) {
        const claimToken = crypto.randomUUID();
        const res: any = updateStmt.run(claimedBy, leaseExpiresAt, claimToken, now, candidate.id);
        if (Number(res?.changes || 0) > 0) {
          const row = selectStmt.get(candidate.id) as any;
          if (row) {
            claimedMessages.push(mapRowToMessage<T>(row));
          }
        }
      }

      return claimedMessages;
    });
  }

  public fail(messageId: string, error: string, backoffDelayMs?: number, claimToken?: string | null): MessageFailResult {
    return this.db.transaction(() => {
      let query = "SELECT * FROM _queue_messages WHERE id = ? AND status = 'processing'";
      const params: any[] = [messageId];
      if (claimToken) {
        query += ' AND claimToken = ?';
        params.push(claimToken);
      }
      const row = this.db.prepare(query).get(...params) as any;
      if (!row) {
        return { retried: false, deadLettered: false, attempts: 0 };
      }

      const qRow = this.db.prepare('SELECT * FROM _queues WHERE name = ?').get(row.queue) as any;
      const now = new Date().toISOString();
      const attempts = Number(row.attempts) || 1;
      const maxAttempts = row.maxAttempts !== null && row.maxAttempts !== undefined && !isNaN(Number(row.maxAttempts))
        ? Number(row.maxAttempts)
        : (qRow?.maxAttempts ?? 3);
      const baseBackoff = backoffDelayMs !== undefined ? backoffDelayMs : (qRow?.backoffDelayMs ?? 1000);

      if (maxAttempts === 0 || attempts < maxAttempts) {
        const delay = Math.max(0, baseBackoff * Math.pow(2, Math.max(0, attempts - 1)));
        const availableAt = new Date(Date.now() + delay).toISOString();

        let updateSql = `
          UPDATE _queue_messages
          SET status = 'queued',
              error = ?,
              claimedBy = NULL,
              leaseExpiresAt = NULL,
              claimToken = NULL,
              availableAt = ?,
              updated = ?
          WHERE id = ? AND status = 'processing'
        `;
        const updateParams: any[] = [error, availableAt, now, messageId];
        if (claimToken) {
          updateSql += ` AND claimToken = ?`;
          updateParams.push(claimToken);
        }

        const res: any = this.db.prepare(updateSql).run(...updateParams);
        if (Number(res?.changes || 0) === 0) {
          return { retried: false, deadLettered: false, attempts: 0 };
        }

        return { retried: true, deadLettered: false, attempts };
      }

      const dlqName = qRow?.deadLetterQueue || null;

      let dlqSql = `
        UPDATE _queue_messages
        SET status = 'dead_letter',
            error = ?,
            claimedBy = NULL,
            leaseExpiresAt = NULL,
            claimToken = NULL,
            updated = ?,
            finishedAt = ?
        WHERE id = ? AND status = 'processing'
      `;
      const dlqParams: any[] = [error, now, now, messageId];
      if (claimToken) {
        dlqSql += ` AND claimToken = ?`;
        dlqParams.push(claimToken);
      }

      const res: any = this.db.prepare(dlqSql).run(...dlqParams);
      if (Number(res?.changes || 0) === 0) {
        return { retried: false, deadLettered: false, attempts: 0 };
      }

      if (dlqName && dlqName !== row.queue) {
        try {
          this.db.prepare(`
            DELETE FROM _queue_messages
            WHERE queue = ? AND status = 'queued' AND (originalMessageId = ? OR id = ? OR payload LIKE ?)
          `).run(dlqName, row.id, row.forwardedToMessageId || '', `%"originalMessageId":"${row.id}"%`);
        } catch {}

        let parsedPayload: any = null;
        try {
          parsedPayload = row.payload ? JSON.parse(row.payload) : null;
        } catch {
          parsedPayload = row.payload;
        }
        const dlqJob = this.insertMessageSync({
          queue: dlqName,
          payload: {
            originalMessageId: row.id,
            originalJobId: row.id,
            originalQueue: row.queue,
            error,
            attempts,
            failedAt: now,
            payload: parsedPayload,
          },
          originalMessageId: row.id,
          groupKey: row.groupKey,
          priority: row.priority,
        });

        try {
          this.db.prepare(`
            UPDATE _queue_messages SET forwardedToMessageId = ? WHERE id = ?
          `).run(dlqJob.id, row.id);
        } catch {}
      }

      return { retried: false, deadLettered: true, attempts };
    });
  }

  public forceDeadLetter(messageId: string, reason = 'Force-skipped to DLQ by operator'): boolean {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM _queue_messages WHERE id = ?').get(messageId) as any;
      if (!row) return false;
      if (row.status === 'completed' || row.status === 'dead_letter') {
        return false;
      }

      const now = new Date().toISOString();
      const cfg = this.db.prepare('SELECT deadLetterQueue FROM _queues WHERE name = ?').get(row.queue) as any;
      const dlqName = cfg?.deadLetterQueue;

      const res: any = this.db.prepare(`
        UPDATE _queue_messages
        SET status = 'dead_letter',
            error = ?,
            claimedBy = NULL,
            leaseExpiresAt = NULL,
            claimToken = NULL,
            updated = ?,
            finishedAt = ?
        WHERE id = ?
      `).run(reason, now, now, messageId);

      if (Number(res?.changes || 0) === 0) return false;

      if (dlqName && dlqName !== row.queue) {
        try {
          this.db.prepare(`
            DELETE FROM _queue_messages
            WHERE queue = ? AND status = 'queued' AND (originalMessageId = ? OR id = ? OR payload LIKE ?)
          `).run(dlqName, row.id, row.forwardedToMessageId || '', `%"originalMessageId":"${row.id}"%`);
        } catch {}

        let parsedPayload: any = null;
        try {
          parsedPayload = row.payload ? JSON.parse(row.payload) : null;
        } catch {
          parsedPayload = row.payload;
        }

        const dlqMsg = this.insertMessageSync({
          queue: dlqName,
          payload: {
            originalMessageId: row.id,
            originalJobId: row.id,
            originalQueue: row.queue,
            error: reason,
            attempts: row.attempts,
            failedAt: now,
            payload: parsedPayload,
          },
          originalMessageId: row.id,
          groupKey: row.groupKey,
          priority: row.priority,
        });

        try {
          this.db.prepare(`
            UPDATE _queue_messages SET forwardedToMessageId = ? WHERE id = ?
          `).run(dlqMsg.id, row.id);
        } catch {}
      }

      return true;
    });
  }

  public cancel(messageId: string): boolean {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT id, forwardedToMessageId FROM _queue_messages WHERE id = ?').get(messageId) as any;
      if (!row) return false;
      try {
        this.db.prepare(`
          DELETE FROM _queue_messages
          WHERE status = 'queued' AND (id = ? OR originalMessageId = ? OR payload LIKE ?)
        `).run(row.forwardedToMessageId || '', messageId, `%"originalMessageId":"${messageId}"%`);
      } catch {}
      const res: any = this.db.prepare('DELETE FROM _queue_messages WHERE id = ?').run(messageId);
      try {
        this.db.prepare(`
          UPDATE _queue_messages SET forwardedToMessageId = NULL WHERE forwardedToMessageId = ?
        `).run(messageId);
      } catch {}
      return Number(res?.changes || 0) > 0;
    });
  }

  public retryDeadLetterMessages(
    queueName: string,
    limit = 100,
    onMessageRequeued?: (queue: string) => void
  ): number {
    const safeLimit = Math.max(1, Math.floor(limit));
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      const rows = (this.db.prepare(`
        SELECT id, forwardedToMessageId FROM _queue_messages
        WHERE queue = ? AND status IN ('dead_letter', 'failed')
        ORDER BY updated ASC, rowid ASC
        LIMIT ?
      `).all(queueName, safeLimit) as any) as Array<{ id: string; forwardedToMessageId?: string | null }>;

      let count = 0;

      if (rows && rows.length > 0) {
        const stmt = this.db.prepare(`
          UPDATE _queue_messages
          SET status = 'queued',
              attempts = 0,
              error = NULL,
              claimedBy = NULL,
              leaseExpiresAt = NULL,
              claimToken = NULL,
              availableAt = ?,
              updated = ?,
              finishedAt = NULL,
              forwardedToMessageId = NULL
          WHERE id = ?
        `);

        for (const r of rows) {
          const res: any = stmt.run(now, now, r.id);
          const changed = Number(res?.changes || 0);
          if (changed > 0) {
            count += changed;
            try {
              this.db.prepare(`
                DELETE FROM _queue_messages
                WHERE status = 'queued' AND (id = ? OR originalMessageId = ? OR payload LIKE ?)
              `).run(r.forwardedToMessageId || '', r.id, `%"originalMessageId":"${r.id}"%`);
            } catch {}
          }
        }
        if (count > 0) {
          onMessageRequeued?.(queueName);
        }
      }

      const remainingLimit = safeLimit - count;
      if (remainingLimit > 0) {
        const dlqRows: any[] = (this.db.prepare(`
          SELECT * FROM _queue_messages
          WHERE queue = ? AND status IN ('queued', 'dead_letter', 'failed')
            AND (originalMessageId IS NOT NULL OR payload LIKE '%"originalMessageId"%')
          ORDER BY updated ASC, rowid ASC
          LIMIT ?
        `).all(queueName, remainingLimit) as any) || [];

        for (const dlqRow of dlqRows) {
          let parsed: any = null;
          try {
            parsed = dlqRow.payload ? JSON.parse(dlqRow.payload) : null;
          } catch {
            parsed = dlqRow.payload;
          }
          const origId = dlqRow.originalMessageId || parsed?.originalMessageId;
          const origQueue = parsed?.originalQueue;

          if (origId) {
            const origJob = this.db.prepare('SELECT * FROM _queue_messages WHERE id = ?').get(origId) as any;
            if (origJob) {
              const resOrig: any = this.db.prepare(`
                UPDATE _queue_messages
                SET status = 'queued',
                    attempts = 0,
                    error = NULL,
                    claimedBy = NULL,
                    leaseExpiresAt = NULL,
                    claimToken = NULL,
                    availableAt = ?,
                    updated = ?,
                    finishedAt = NULL,
                    forwardedToMessageId = NULL
                WHERE id = ?
              `).run(now, now, origId);
              if (Number(resOrig?.changes || 0) > 0) {
                count++;
                if (origJob.queue) {
                  onMessageRequeued?.(origJob.queue);
                }
              }
            } else if (origQueue) {
              const unwrapped = parsed?.payload !== undefined ? parsed.payload : parsed;
              this.insertMessageSync({
                queue: origQueue,
                payload: unwrapped,
                groupKey: dlqRow.groupKey,
                priority: dlqRow.priority,
              });
              count++;
              onMessageRequeued?.(origQueue);
            }
            this.db.prepare('DELETE FROM _queue_messages WHERE id = ?').run(dlqRow.id);
          }
        }
      }

      return count;
    });
  }

  public retryMessage(messageId: string, onMessageRequeued?: (queue: string) => void): boolean {
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      const row = this.db.prepare('SELECT * FROM _queue_messages WHERE id = ?').get(messageId) as any;
      if (!row) return false;

      if (row.status === 'processing') {
        return false;
      }

      let parsedPayload: any = null;
      try {
        parsedPayload = row.payload ? JSON.parse(row.payload) : null;
      } catch {
        parsedPayload = row.payload;
      }

      const origJobId = row.originalMessageId || parsedPayload?.originalMessageId;
      const origQueue = parsedPayload?.originalQueue;

      if (origJobId && (row.queue !== origQueue || row.originalMessageId)) {
        const origRow = this.db.prepare('SELECT * FROM _queue_messages WHERE id = ?').get(origJobId) as any;
        if (origRow) {
          this.db.prepare(`
            UPDATE _queue_messages
            SET status = 'queued',
                attempts = 0,
                error = NULL,
                claimedBy = NULL,
                leaseExpiresAt = NULL,
                claimToken = NULL,
                availableAt = ?,
                updated = ?,
                finishedAt = NULL,
                forwardedToMessageId = NULL
            WHERE id = ?
          `).run(now, now, origJobId);
          onMessageRequeued?.(origRow.queue);
        } else if (origQueue) {
          const unwrapped = parsedPayload?.payload !== undefined ? parsedPayload.payload : parsedPayload;
          this.insertMessageSync({
            queue: origQueue,
            payload: unwrapped,
            groupKey: row.groupKey,
            priority: row.priority,
          });
          onMessageRequeued?.(origQueue);
        }

        this.db.prepare('DELETE FROM _queue_messages WHERE id = ?').run(messageId);
        if (origJobId) {
          try {
            this.db.prepare(`
              DELETE FROM _queue_messages
              WHERE queue = ? AND status = 'queued' AND (originalMessageId = ? OR payload LIKE ?)
            `).run(row.queue, origJobId, `%"originalMessageId":"${origJobId}"%`);
          } catch {}
        }
        return true;
      }

      const res = this.db.prepare(`
        UPDATE _queue_messages
        SET status = 'queued',
            attempts = 0,
            error = NULL,
            claimedBy = NULL,
            leaseExpiresAt = NULL,
            claimToken = NULL,
            availableAt = ?,
            updated = ?,
            finishedAt = NULL,
            forwardedToMessageId = NULL
        WHERE id = ?
      `).run(now, now, messageId) as any;

      if (Number(res?.changes || 0) === 0) return false;

      try {
        this.db.prepare(`
          DELETE FROM _queue_messages
          WHERE status = 'queued' AND (id = ? OR originalMessageId = ? OR payload LIKE ?)
        `).run(row.forwardedToMessageId || '', messageId, `%"originalMessageId":"${messageId}"%`);
      } catch {}

      onMessageRequeued?.(row.queue);
      return true;
    });
  }

  public reclaimOrphaned(
    queueName?: string,
    options: ReclaimOrphanedOptions = {},
    onDlqEnqueued?: (dlqQueue: string) => void
  ): number {
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      let expired: any[];

      if (options.forceAll) {
        const sql = queueName
          ? `SELECT * FROM _queue_messages WHERE queue = ? AND status = 'processing'`
          : `SELECT * FROM _queue_messages WHERE status = 'processing'`;
        expired = (queueName ? (this.db.prepare(sql).all(queueName) as any) : (this.db.prepare(sql).all() as any)) || [];
      } else if (options.reclaimDeadWorkers) {
        const localClause = `claimedBy IS NULL OR claimedBy LIKE 'worker_%' OR claimedBy LIKE '%crashed%'`;
        const sql = queueName
          ? `SELECT * FROM _queue_messages WHERE queue = ? AND status = 'processing' AND ((leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ?) OR ${localClause})`
          : `SELECT * FROM _queue_messages WHERE status = 'processing' AND ((leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ?) OR ${localClause})`;
        expired = (queueName
          ? (this.db.prepare(sql).all(queueName, now) as any)
          : (this.db.prepare(sql).all(now) as any)) || [];
      } else {
        const sql = queueName
          ? `SELECT * FROM _queue_messages WHERE queue = ? AND status = 'processing' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ?`
          : `SELECT * FROM _queue_messages WHERE status = 'processing' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ?`;
        expired = (queueName
          ? (this.db.prepare(sql).all(queueName, now) as any)
          : (this.db.prepare(sql).all(now) as any)) || [];
      }

      if (!expired || expired.length === 0) return 0;

      let reclaimed = 0;
      for (const row of expired) {
        const qRow = this.db.prepare('SELECT * FROM _queues WHERE name = ?').get(row.queue) as any;
        const attempts = Number(row.attempts) || 1;
        const maxAttempts = row.maxAttempts !== null && row.maxAttempts !== undefined && !isNaN(Number(row.maxAttempts))
          ? Number(row.maxAttempts)
          : (qRow?.maxAttempts ?? 3);
        const dlqName = qRow?.deadLetterQueue || null;
        const timeoutError = 'Max attempts exceeded after visibility timeout';

        if (maxAttempts === 0 || attempts < maxAttempts) {
          this.db.prepare(`
            UPDATE _queue_messages
            SET status = 'queued',
                claimedBy = NULL,
                leaseExpiresAt = NULL,
                claimToken = NULL,
                error = COALESCE(error, 'Visibility timeout expired (orphaned lease reclaimed)'),
                availableAt = ?,
                updated = ?
            WHERE id = ? AND status = 'processing'
          `).run(now, now, row.id);
          reclaimed++;
        } else {
          this.db.prepare(`
            UPDATE _queue_messages
            SET status = 'dead_letter',
                claimedBy = NULL,
                leaseExpiresAt = NULL,
                claimToken = NULL,
                error = COALESCE(error, ?),
                updated = ?,
                finishedAt = ?
            WHERE id = ? AND status = 'processing'
          `).run(timeoutError, now, now, row.id);
          reclaimed++;

          if (dlqName && dlqName !== row.queue) {
            try {
              this.db.prepare(`
                DELETE FROM _queue_messages
                WHERE queue = ? AND status = 'queued' AND (originalMessageId = ? OR id = ? OR payload LIKE ?)
              `).run(dlqName, row.id, row.forwardedToMessageId || '', `%"originalMessageId":"${row.id}"%`);
            } catch {}

            let parsedPayload: any = null;
            try {
              parsedPayload = row.payload ? JSON.parse(row.payload) : null;
            } catch {
              parsedPayload = row.payload;
            }
            const dlqJob = this.insertMessageSync({
              queue: dlqName,
              payload: {
                originalMessageId: row.id,
                originalJobId: row.id,
                originalQueue: row.queue,
                error: row.error || timeoutError,
                attempts,
                failedAt: now,
                payload: parsedPayload,
              },
              originalMessageId: row.id,
              groupKey: row.groupKey,
              priority: row.priority,
            });
            try {
              this.db.prepare(`
                UPDATE _queue_messages SET forwardedToMessageId = ? WHERE id = ?
              `).run(dlqJob.id, row.id);
            } catch {}
            onDlqEnqueued?.(dlqName);
          }
        }
      }

      return reclaimed;
    });
  }
}
