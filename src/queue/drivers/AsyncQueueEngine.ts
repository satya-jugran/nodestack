import * as crypto from 'crypto';
import { DatabaseService } from '../../database/DatabaseService';
import {
  QueueMessage,
  EnqueueMessageDto,
  MessageFailResult,
  ReclaimOrphanedOptions,
} from '../types';
import { mapRowToMessage } from './queueMapping';

export class AsyncQueueEngine {
  constructor(private db: DatabaseService) {}

  private buildPagination(limit: number, offset = 0): { clause: string; params: number[] } {
    const pag = this.db.dialect.paginationSql('?', '?', true);
    const params = pag.paramOrder === 'limit-first' ? [limit, offset] : [offset, limit];
    return { clause: pag.clause, params };
  }

  public async deleteQueue(name: string): Promise<boolean> {
    return await this.db.transaction(async (tx: any) => {
      await tx.prepare('DELETE FROM _queue_messages WHERE queue = ?').run(name);
      const res: any = await tx.prepare('DELETE FROM _queues WHERE name = ?').run(name);
      return Number(res?.changes || 0) > 0;
    });
  }

  public async send<T = any>(dto: EnqueueMessageDto<T>): Promise<QueueMessage<T>> {
    return await this.db.transaction(async (tx: any) => {
      return await this.insertMessage(dto, tx);
    });
  }

  public async sendBatch<T = any>(messages: EnqueueMessageDto<T>[]): Promise<QueueMessage<T>[]> {
    if (!messages || messages.length === 0) return [];
    return await this.db.transaction(async (tx: any) => {
      const results: QueueMessage<T>[] = [];
      for (const msg of messages) {
        results.push(await this.insertMessage(msg, tx));
      }
      return results;
    });
  }

  public async insertMessage<T = any>(dto: EnqueueMessageDto<T>, tx?: any): Promise<QueueMessage<T>> {
    const target = tx || this.db;
    const existingQueue = (await target.prepare('SELECT * FROM _queues WHERE name = ?').get(dto.queue)) as any;
    const now = new Date().toISOString();

    let defaultMaxAttempts = 3;
    if (!existingQueue) {
      const isSys = dto.queue.startsWith('_system:') ? 1 : 0;
      const upsertSql = this.db.dialect.upsertSql(
        '_queues',
        [
          'name',
          'concurrency',
          'visibilityTimeoutSeconds',
          'maxAttempts',
          'backoffDelayMs',
          'deadLetterQueue',
          'targetFunction',
          'isSystem',
          'strictOrder',
          'created',
          'updated',
        ],
        'name',
        []
      );
      await target.prepare(upsertSql).run(dto.queue, 0, 30, 3, 1000, null, null, isSys, 0, now, now);
    } else {
      defaultMaxAttempts = existingQueue.maxAttempts ?? 3;
    }

    if (dto.deduplicationId) {
      const dupSql = this.db.dialect.paginate(
        `SELECT * FROM _queue_messages WHERE queue = ? AND deduplicationId = ? AND status IN ('queued', 'processing')`,
        1,
        0
      );
      const dup = (await target.prepare(dupSql).get(dto.queue, dto.deduplicationId)) as any;
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

    await target.prepare(`
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

    const row = (await target.prepare('SELECT * FROM _queue_messages WHERE id = ?').get(id)) as any;
    return mapRowToMessage<T>(row);
  }

  public async claim<T = any>(
    queueName: string,
    claimedBy: string,
    visibilityTimeoutSeconds: number,
    limit = 1
  ): Promise<QueueMessage<T>[]> {
    const safeLimit = Math.max(1, Math.floor(limit));
    const timeoutSec = Math.max(1, Math.floor(visibilityTimeoutSeconds || 30));

    return await this.db.transaction(async (tx: any) => {
      const now = new Date().toISOString();
      const leaseExpiresAt = new Date(Date.now() + timeoutSec * 1000).toISOString();

      const queueRow = (await tx.prepare('SELECT concurrency, strictOrder FROM _queues WHERE name = ?').get(queueName)) as { concurrency: number; strictOrder: number } | undefined;
      let effectiveLimit = safeLimit;
      if (queueRow && typeof queueRow.concurrency === 'number' && queueRow.concurrency >= 1) {
        const activeRow = (await tx.prepare(`
          SELECT COUNT(*) as cnt FROM _queue_messages
          WHERE queue = ? AND status = 'processing' AND (leaseExpiresAt IS NULL OR leaseExpiresAt > ?)
        `).get(queueName, now)) as { cnt: number };
        const availableSlots = Math.max(0, queueRow.concurrency - (activeRow?.cnt || 0));
        effectiveLimit = Math.min(safeLimit, availableSlots);
      }

      if (effectiveLimit <= 0) {
        return [];
      }

      const claimPag = this.buildPagination(effectiveLimit);
      let candidates: Array<{ id: string }>;
      if (queueRow && Boolean(queueRow.strictOrder)) {
        candidates = ((await tx.prepare(`
          WITH partition_hol AS (
            SELECT
              id,
              status,
              availableAt,
              priority,
              created,
              id as rid,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(groupKey, '')
                ORDER BY created ASC, id ASC
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
          ${claimPag.clause}
        `).all(queueName, now, ...claimPag.params)) as Array<{ id: string }>) || [];
      } else {
        candidates = ((await tx.prepare(`
          SELECT id FROM _queue_messages
          WHERE queue = ?
            AND status = 'queued'
            AND availableAt <= ?
          ORDER BY priority DESC, availableAt ASC, id ASC
          ${claimPag.clause}
        `).all(queueName, now, ...claimPag.params)) as Array<{ id: string }>) || [];
      }

      if (!candidates || candidates.length === 0) {
        return [];
      }

      const claimedMessages: QueueMessage<T>[] = [];
      const updateStmt = tx.prepare(`
        UPDATE _queue_messages
        SET status = 'processing',
            claimedBy = ?,
            leaseExpiresAt = ?,
            claimToken = ?,
            attempts = attempts + 1,
            updated = ?
        WHERE id = ? AND status = 'queued'
      `);
      const selectStmt = tx.prepare('SELECT * FROM _queue_messages WHERE id = ?');

      for (const candidate of candidates) {
        const claimToken = crypto.randomUUID();
        const res: any = await updateStmt.run(claimedBy, leaseExpiresAt, claimToken, now, candidate.id);
        if (Number(res?.changes || 0) > 0) {
          const row = (await selectStmt.get(candidate.id)) as any;
          if (row) {
            claimedMessages.push(mapRowToMessage<T>(row));
          }
        }
      }

      return claimedMessages;
    });
  }

  public async fail(messageId: string, error: string, backoffDelayMs?: number, claimToken?: string | null): Promise<MessageFailResult> {
    return await this.db.transaction(async (tx: any) => {
      let query = "SELECT * FROM _queue_messages WHERE id = ? AND status = 'processing'";
      const params: any[] = [messageId];
      if (claimToken) {
        query += ' AND claimToken = ?';
        params.push(claimToken);
      }
      const row = (await tx.prepare(query).get(...params)) as any;
      if (!row) {
        return { retried: false, deadLettered: false, attempts: 0 };
      }

      const qRow = (await tx.prepare('SELECT * FROM _queues WHERE name = ?').get(row.queue)) as any;
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

        const res: any = await tx.prepare(updateSql).run(...updateParams);
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

      const res: any = await tx.prepare(dlqSql).run(...dlqParams);
      if (Number(res?.changes || 0) === 0) {
        return { retried: false, deadLettered: false, attempts: 0 };
      }

      if (dlqName && dlqName !== row.queue) {
        try {
          await tx.prepare(`
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
        const dlqJob = await this.insertMessage({
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
        }, tx);

        try {
          await tx.prepare(`
            UPDATE _queue_messages SET forwardedToMessageId = ? WHERE id = ?
          `).run(dlqJob.id, row.id);
        } catch {}
      }

      return { retried: false, deadLettered: true, attempts };
    });
  }

  public async forceDeadLetter(messageId: string, reason = 'Force-skipped to DLQ by operator'): Promise<boolean> {
    return await this.db.transaction(async (tx: any) => {
      const row = (await tx.prepare('SELECT * FROM _queue_messages WHERE id = ?').get(messageId)) as any;
      if (!row) return false;
      if (row.status === 'completed' || row.status === 'dead_letter') {
        return false;
      }

      const now = new Date().toISOString();
      const cfg = (await tx.prepare('SELECT deadLetterQueue FROM _queues WHERE name = ?').get(row.queue)) as any;
      const dlqName = cfg?.deadLetterQueue;

      const res: any = await tx.prepare(`
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
          await tx.prepare(`
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

        const dlqMsg = await this.insertMessage({
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
        }, tx);

        try {
          await tx.prepare(`
            UPDATE _queue_messages SET forwardedToMessageId = ? WHERE id = ?
          `).run(dlqMsg.id, row.id);
        } catch {}
      }

      return true;
    });
  }

  public async cancel(messageId: string): Promise<boolean> {
    return await this.db.transaction(async (tx: any) => {
      const row = (await tx.prepare('SELECT id, forwardedToMessageId FROM _queue_messages WHERE id = ?').get(messageId)) as any;
      if (!row) return false;
      try {
        await tx.prepare(`
          DELETE FROM _queue_messages
          WHERE status = 'queued' AND (id = ? OR originalMessageId = ? OR payload LIKE ?)
        `).run(row.forwardedToMessageId || '', messageId, `%"originalMessageId":"${messageId}"%`);
      } catch {}
      const res: any = await tx.prepare('DELETE FROM _queue_messages WHERE id = ?').run(messageId);
      try {
        await tx.prepare(`
          UPDATE _queue_messages SET forwardedToMessageId = NULL WHERE forwardedToMessageId = ?
        `).run(messageId);
      } catch {}
      return Number(res?.changes || 0) > 0;
    });
  }

  public async retryDeadLetterMessages(
    queueName: string,
    limit = 100,
    onMessageRequeued?: (queue: string) => void
  ): Promise<number> {
    const safeLimit = Math.max(1, Math.floor(limit));
    return await this.db.transaction(async (tx: any) => {
      const now = new Date().toISOString();
      const safePag = this.buildPagination(safeLimit);
      const rows = ((await tx.prepare(`
        SELECT id, forwardedToMessageId FROM _queue_messages
        WHERE queue = ? AND status IN ('dead_letter', 'failed')
        ORDER BY updated ASC, id ASC
        ${safePag.clause}
      `).all(queueName, ...safePag.params)) as any) as Array<{ id: string; forwardedToMessageId?: string | null }>;

      let count = 0;

      if (rows && rows.length > 0) {
        const stmt = tx.prepare(`
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
          const res: any = await stmt.run(now, now, r.id);
          const changed = Number(res?.changes || 0);
          if (changed > 0) {
            count += changed;
            try {
              await tx.prepare(`
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
        const remPag = this.buildPagination(remainingLimit);
        const dlqRows: any[] = ((await tx.prepare(`
          SELECT * FROM _queue_messages
          WHERE queue = ? AND status IN ('queued', 'dead_letter', 'failed')
            AND (originalMessageId IS NOT NULL OR payload LIKE '%"originalMessageId"%')
          ORDER BY updated ASC, id ASC
          ${remPag.clause}
        `).all(queueName, ...remPag.params)) as any) || [];

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
            const origJob = (await tx.prepare('SELECT * FROM _queue_messages WHERE id = ?').get(origId)) as any;
            if (origJob) {
              const resOrig: any = await tx.prepare(`
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
              await this.insertMessage({
                queue: origQueue,
                payload: unwrapped,
                groupKey: dlqRow.groupKey,
                priority: dlqRow.priority,
              }, tx);
              count++;
              onMessageRequeued?.(origQueue);
            }
            await tx.prepare('DELETE FROM _queue_messages WHERE id = ?').run(dlqRow.id);
          }
        }
      }

      return count;
    });
  }

  public async retryMessage(messageId: string, onMessageRequeued?: (queue: string) => void): Promise<boolean> {
    return await this.db.transaction(async (tx: any) => {
      const now = new Date().toISOString();
      const row = (await tx.prepare('SELECT * FROM _queue_messages WHERE id = ?').get(messageId)) as any;
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
        const origRow = (await tx.prepare('SELECT * FROM _queue_messages WHERE id = ?').get(origJobId)) as any;
        if (origRow) {
          await tx.prepare(`
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
          await this.insertMessage({
            queue: origQueue,
            payload: unwrapped,
            groupKey: row.groupKey,
            priority: row.priority,
          }, tx);
          onMessageRequeued?.(origQueue);
        }

        await tx.prepare('DELETE FROM _queue_messages WHERE id = ?').run(messageId);
        if (origJobId) {
          try {
            await tx.prepare(`
              DELETE FROM _queue_messages
              WHERE queue = ? AND status = 'queued' AND (originalMessageId = ? OR payload LIKE ?)
            `).run(row.queue, origJobId, `%"originalMessageId":"${origJobId}"%`);
          } catch {}
        }
        return true;
      }

      const res = (await tx.prepare(`
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
      `).run(now, now, messageId)) as any;

      if (Number(res?.changes || 0) === 0) return false;

      try {
        await tx.prepare(`
          DELETE FROM _queue_messages
          WHERE status = 'queued' AND (id = ? OR originalMessageId = ? OR payload LIKE ?)
        `).run(row.forwardedToMessageId || '', messageId, `%"originalMessageId":"${messageId}"%`);
      } catch {}

      onMessageRequeued?.(row.queue);
      return true;
    });
  }

  public async reclaimOrphaned(
    queueName?: string,
    options: ReclaimOrphanedOptions = {},
    onDlqEnqueued?: (dlqQueue: string) => void
  ): Promise<number> {
    return await this.db.transaction(async (tx: any) => {
      const now = new Date().toISOString();
      let expired: any[];

      if (options.forceAll) {
        const sql = queueName
          ? `SELECT * FROM _queue_messages WHERE queue = ? AND status = 'processing'`
          : `SELECT * FROM _queue_messages WHERE status = 'processing'`;
        expired = ((queueName ? (await tx.prepare(sql).all(queueName)) : (await tx.prepare(sql).all())) as any[]) || [];
      } else if (options.reclaimDeadWorkers) {
        const localClause = `claimedBy IS NULL OR claimedBy LIKE 'worker_%' OR claimedBy LIKE '%crashed%'`;
        const sql = queueName
          ? `SELECT * FROM _queue_messages WHERE queue = ? AND status = 'processing' AND ((leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ?) OR ${localClause})`
          : `SELECT * FROM _queue_messages WHERE status = 'processing' AND ((leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ?) OR ${localClause})`;
        expired = ((queueName
          ? (await tx.prepare(sql).all(queueName, now))
          : (await tx.prepare(sql).all(now))) as any[]) || [];
      } else {
        const sql = queueName
          ? `SELECT * FROM _queue_messages WHERE queue = ? AND status = 'processing' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ?`
          : `SELECT * FROM _queue_messages WHERE status = 'processing' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ?`;
        expired = ((queueName
          ? (await tx.prepare(sql).all(queueName, now))
          : (await tx.prepare(sql).all(now))) as any[]) || [];
      }

      if (!expired || expired.length === 0) return 0;

      let reclaimed = 0;
      for (const row of expired) {
        const qRow = (await tx.prepare('SELECT * FROM _queues WHERE name = ?').get(row.queue)) as any;
        const attempts = Number(row.attempts) || 1;
        const maxAttempts = row.maxAttempts !== null && row.maxAttempts !== undefined && !isNaN(Number(row.maxAttempts))
          ? Number(row.maxAttempts)
          : (qRow?.maxAttempts ?? 3);
        const dlqName = qRow?.deadLetterQueue || null;
        const timeoutError = 'Max attempts exceeded after visibility timeout';

        if (maxAttempts === 0 || attempts < maxAttempts) {
          await tx.prepare(`
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
          await tx.prepare(`
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
              await tx.prepare(`
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
            const dlqJob = await this.insertMessage({
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
            }, tx);
            try {
              await tx.prepare(`
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
