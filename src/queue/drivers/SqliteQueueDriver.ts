import * as crypto from 'crypto';
import { DatabaseService } from '../../database/DatabaseService';
import { IQueueDriver } from './IQueueDriver';
import {
  QueueConfig,
  CreateQueueDto,
  QueueJob,
  EnqueueJobDto,
  JobFailResult,
  QueueStats,
  GetJobsOptions,
} from '../types';

export class SqliteQueueDriver implements IQueueDriver {
  public initialized = false;

  constructor(private db: DatabaseService) {}

  public async init(): Promise<void> {
    try {
      this.createSchema();
      this.initialized = true;
    } catch (err: any) {
      console.warn(`[SqliteQueueDriver] init warning: ${err.message}`);
    }
  }

  public invalidateInit(): void {
    this.initialized = false;
  }

  public async close(): Promise<void> {
    this.initialized = false;
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _queues (
        name TEXT PRIMARY KEY,
        concurrency INTEGER NOT NULL DEFAULT 0,
        visibilityTimeoutSeconds INTEGER NOT NULL DEFAULT 30,
        maxAttempts INTEGER NOT NULL DEFAULT 3,
        backoffDelayMs INTEGER NOT NULL DEFAULT 1000,
        deadLetterQueue TEXT DEFAULT NULL,
        targetFunction TEXT DEFAULT NULL,
        isSystem INTEGER NOT NULL DEFAULT 0,
        created TEXT NOT NULL,
        updated TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS _queue_jobs (
        id TEXT PRIMARY KEY,
        queue TEXT NOT NULL,
        groupKey TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        payload TEXT,
        result TEXT DEFAULT NULL,
        error TEXT DEFAULT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        maxAttempts INTEGER NOT NULL DEFAULT 3,
        priority INTEGER NOT NULL DEFAULT 0,
        availableAt TEXT NOT NULL,
        claimedBy TEXT DEFAULT NULL,
        leaseExpiresAt TEXT DEFAULT NULL,
        claimToken TEXT DEFAULT NULL,
        deduplicationId TEXT DEFAULT NULL,
        created TEXT NOT NULL,
        updated TEXT NOT NULL,
        finishedAt TEXT DEFAULT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_qjobs_poll ON _queue_jobs(queue, status, availableAt, priority DESC);
      CREATE INDEX IF NOT EXISTS idx_qjobs_group ON _queue_jobs(groupKey, status);
      CREATE INDEX IF NOT EXISTS idx_qjobs_cleanup ON _queue_jobs(status, finishedAt);
      CREATE INDEX IF NOT EXISTS idx_qjobs_dedup ON _queue_jobs(queue, deduplicationId);
    `);

    // Ensure claimToken column exists on pre-existing or upgraded tables
    try {
      this.db.exec(`ALTER TABLE _queue_jobs ADD COLUMN claimToken TEXT DEFAULT NULL;`);
    } catch {}
  }

  private ensureInit(): void {
    if (!this.initialized) {
      this.createSchema();
      this.initialized = true;
    }
  }

  public async upsertQueue(dto: CreateQueueDto): Promise<QueueConfig> {
    this.ensureInit();
    const now = new Date().toISOString();
    const existing = await this.getQueue(dto.name);

    const concurrency =
      dto.concurrency !== undefined && dto.concurrency !== null
        ? Math.max(0, Math.floor(Number(dto.concurrency)))
        : (existing?.concurrency ?? 0);
    const visibilityTimeoutSeconds =
      dto.visibilityTimeoutSeconds !== undefined && dto.visibilityTimeoutSeconds !== null
        ? Math.max(1, Math.floor(Number(dto.visibilityTimeoutSeconds)))
        : (existing?.visibilityTimeoutSeconds ?? 30);
    const maxAttempts =
      dto.maxAttempts !== undefined && dto.maxAttempts !== null
        ? Math.max(1, Math.floor(Number(dto.maxAttempts)))
        : (existing?.maxAttempts ?? 3);
    const backoffDelayMs =
      dto.backoffDelayMs !== undefined && dto.backoffDelayMs !== null
        ? Math.max(0, Math.floor(Number(dto.backoffDelayMs)))
        : (existing?.backoffDelayMs ?? 1000);
    const deadLetterQueue = dto.deadLetterQueue !== undefined ? dto.deadLetterQueue : (existing?.deadLetterQueue ?? null);
    const targetFunction = dto.targetFunction !== undefined ? dto.targetFunction : (existing?.targetFunction ?? null);
    const isSystem = dto.isSystem !== undefined ? (dto.isSystem ? 1 : 0) : (existing ? (existing.isSystem ? 1 : 0) : (dto.name.startsWith('_system:') ? 1 : 0));
    const created = existing?.created || now;

    this.db.prepare(`
      INSERT INTO _queues (
        name, concurrency, visibilityTimeoutSeconds, maxAttempts, backoffDelayMs,
        deadLetterQueue, targetFunction, isSystem, created, updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        concurrency = excluded.concurrency,
        visibilityTimeoutSeconds = excluded.visibilityTimeoutSeconds,
        maxAttempts = excluded.maxAttempts,
        backoffDelayMs = excluded.backoffDelayMs,
        deadLetterQueue = excluded.deadLetterQueue,
        targetFunction = excluded.targetFunction,
        isSystem = excluded.isSystem,
        updated = excluded.updated
    `).run(
      dto.name,
      concurrency,
      visibilityTimeoutSeconds,
      maxAttempts,
      backoffDelayMs,
      deadLetterQueue,
      targetFunction,
      isSystem,
      created,
      now
    );

    return (await this.getQueue(dto.name))!;
  }

  public async getQueue(name: string): Promise<QueueConfig | null> {
    this.ensureInit();
    const row = this.db.prepare('SELECT * FROM _queues WHERE name = ?').get(name) as any;
    return row ? this.mapRowToQueue(row) : null;
  }

  public async getAllQueues(includeSystem = true): Promise<QueueConfig[]> {
    this.ensureInit();
    const sql = includeSystem
      ? 'SELECT * FROM _queues ORDER BY created ASC'
      : 'SELECT * FROM _queues WHERE isSystem = 0 ORDER BY created ASC';
    const rows = this.db.prepare(sql).all() as any[];
    return rows.map((r) => this.mapRowToQueue(r));
  }

  public async deleteQueue(name: string): Promise<boolean> {
    this.ensureInit();
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM _queue_jobs WHERE queue = ?').run(name);
      const res = this.db.prepare('DELETE FROM _queues WHERE name = ?').run(name);
      return Number(res.changes) > 0;
    });
  }

  public async send<T = any>(dto: EnqueueJobDto<T>): Promise<QueueJob<T>> {
    this.ensureInit();
    return this.db.transaction(() => {
      return this.insertJobSync(dto);
    });
  }

  public async sendBatch<T = any>(jobs: EnqueueJobDto<T>[]): Promise<QueueJob<T>[]> {
    this.ensureInit();
    if (!jobs || jobs.length === 0) return [];
    return this.db.transaction(() => {
      return jobs.map((j) => this.insertJobSync(j));
    });
  }

  private insertJobSync<T = any>(dto: EnqueueJobDto<T>): QueueJob<T> {
    // Ensure queue record exists if not registered yet
    const existingQueue = this.db.prepare('SELECT * FROM _queues WHERE name = ?').get(dto.queue) as any;
    const now = new Date().toISOString();

    let defaultMaxAttempts = 3;
    if (!existingQueue) {
      const isSys = dto.queue.startsWith('_system:') ? 1 : 0;
      this.db.prepare(`
        INSERT OR IGNORE INTO _queues (
          name, concurrency, visibilityTimeoutSeconds, maxAttempts, backoffDelayMs,
          deadLetterQueue, targetFunction, isSystem, created, updated
        ) VALUES (?, 0, 30, 3, 1000, NULL, NULL, ?, ?, ?)
      `).run(dto.queue, isSys, now, now);
    } else {
      defaultMaxAttempts = existingQueue.maxAttempts ?? 3;
    }

    // Deduplication check for active (queued / processing) jobs
    if (dto.deduplicationId) {
      const dup = this.db.prepare(`
        SELECT * FROM _queue_jobs
        WHERE queue = ? AND deduplicationId = ? AND status IN ('queued', 'processing')
        LIMIT 1
      `).get(dto.queue, dto.deduplicationId) as any;
      if (dup) {
        return this.mapRowToJob<T>(dup);
      }
    }

    const id = dto.id || `job_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
    const delayMs = dto.delaySeconds && dto.delaySeconds > 0 ? Math.floor(dto.delaySeconds * 1000) : 0;
    const availableAt = delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : now;
    const priority = dto.priority !== undefined ? Math.floor(dto.priority) : 0;
    const maxAttempts = dto.maxAttempts !== undefined ? Math.max(1, Math.floor(dto.maxAttempts)) : defaultMaxAttempts;
    const payloadStr = dto.payload !== undefined ? JSON.stringify(dto.payload) : null;

    this.db.prepare(`
      INSERT INTO _queue_jobs (
        id, queue, groupKey, status, payload, result, error,
        attempts, maxAttempts, priority, availableAt, claimedBy,
        leaseExpiresAt, deduplicationId, created, updated, finishedAt
      ) VALUES (?, ?, ?, 'queued', ?, NULL, NULL, 0, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL)
    `).run(
      id,
      dto.queue,
      dto.groupKey ?? null,
      payloadStr,
      maxAttempts,
      priority,
      availableAt,
      dto.deduplicationId ?? null,
      now,
      now
    );

    const row = this.db.prepare('SELECT * FROM _queue_jobs WHERE id = ?').get(id) as any;
    return this.mapRowToJob<T>(row);
  }

  public async claim<T = any>(
    queueName: string,
    claimedBy: string,
    visibilityTimeoutSeconds: number,
    limit = 1
  ): Promise<QueueJob<T>[]> {
    this.ensureInit();
    const safeLimit = Math.max(1, Math.floor(limit));
    const timeoutSec = Math.max(1, Math.floor(visibilityTimeoutSeconds || 30));

    return this.db.transaction(() => {
      const now = new Date().toISOString();
      const leaseExpiresAt = new Date(Date.now() + timeoutSec * 1000).toISOString();

      // 0. Enforce queue-level concurrency cap if configured in _queues
      const queueRow = this.db.prepare('SELECT concurrency FROM _queues WHERE name = ?').get(queueName) as { concurrency: number } | undefined;
      let effectiveLimit = safeLimit;
      if (queueRow && typeof queueRow.concurrency === 'number' && queueRow.concurrency >= 1) {
        const activeRow = this.db.prepare(`
          SELECT COUNT(*) as cnt FROM _queue_jobs
          WHERE queue = ? AND status = 'processing' AND (leaseExpiresAt IS NULL OR leaseExpiresAt > ?)
        `).get(queueName, now) as { cnt: number };
        const availableSlots = Math.max(0, queueRow.concurrency - (activeRow?.cnt || 0));
        effectiveLimit = Math.min(safeLimit, availableSlots);
      }

      if (effectiveLimit <= 0) {
        return [];
      }

      // 1. Select candidate IDs in deterministic priority + FIFO order
      const candidates = this.db.prepare(`
        SELECT id FROM _queue_jobs
        WHERE queue = ?
          AND status = 'queued'
          AND availableAt <= ?
        ORDER BY priority DESC, availableAt ASC, rowid ASC
        LIMIT ?
      `).all(queueName, now, effectiveLimit) as Array<{ id: string }>;

      if (!candidates || candidates.length === 0) {
        return [];
      }

      const claimedJobs: QueueJob<T>[] = [];
      const updateStmt = this.db.prepare(`
        UPDATE _queue_jobs
        SET status = 'processing',
            claimedBy = ?,
            leaseExpiresAt = ?,
            claimToken = ?,
            attempts = attempts + 1,
            updated = ?
        WHERE id = ? AND status = 'queued'
      `);
      const selectStmt = this.db.prepare('SELECT * FROM _queue_jobs WHERE id = ?');

      for (const candidate of candidates) {
        const claimToken = crypto.randomUUID();
        const res = updateStmt.run(claimedBy, leaseExpiresAt, claimToken, now, candidate.id);
        if (Number(res.changes) > 0) {
          const row = selectStmt.get(candidate.id) as any;
          if (row) {
            claimedJobs.push(this.mapRowToJob<T>(row));
          }
        }
      }

      return claimedJobs;
    });
  }

  public async touch(jobId: string, extensionSeconds: number, claimToken?: string | null): Promise<boolean> {
    this.ensureInit();
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + extensionSeconds * 1000).toISOString();

    let sql = `
      UPDATE _queue_jobs
      SET leaseExpiresAt = ?, updated = ?
      WHERE id = ? AND status = 'processing'
    `;
    const params: any[] = [leaseExpiresAt, now, jobId];

    if (claimToken) {
      sql += ` AND claimToken = ?`;
      params.push(claimToken);
    }

    const res = this.db.prepare(sql).run(...params);
    return Number(res.changes) > 0;
  }

  public async complete(jobId: string, result?: any, claimToken?: string | null): Promise<boolean> {
    this.ensureInit();
    const now = new Date().toISOString();
    const resultStr = result !== undefined ? JSON.stringify(result) : null;

    let sql = `
      UPDATE _queue_jobs
      SET status = 'completed',
          result = ?,
          error = NULL,
          claimedBy = NULL,
          leaseExpiresAt = NULL,
          claimToken = NULL,
          updated = ?,
          finishedAt = ?
      WHERE id = ? AND status IN ('processing', 'queued')
    `;
    const params: any[] = [resultStr, now, now, jobId];

    if (claimToken) {
      sql += ` AND claimToken = ?`;
      params.push(claimToken);
    }

    const res = this.db.prepare(sql).run(...params);
    return Number(res.changes) > 0;
  }

  public async fail(jobId: string, error: string, backoffDelayMs?: number, claimToken?: string | null): Promise<JobFailResult> {
    this.ensureInit();
    return this.db.transaction(() => {
      let query = "SELECT * FROM _queue_jobs WHERE id = ? AND status = 'processing'";
      const params: any[] = [jobId];
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
      const maxAttempts = Number(row.maxAttempts) || (qRow?.maxAttempts ?? 3);
      const baseBackoff = backoffDelayMs !== undefined ? backoffDelayMs : (qRow?.backoffDelayMs ?? 1000);

      if (attempts < maxAttempts) {
        // Exponential backoff: baseBackoff * 2^(attempts - 1)
        const delay = Math.max(0, baseBackoff * Math.pow(2, Math.max(0, attempts - 1)));
        const availableAt = new Date(Date.now() + delay).toISOString();

        let updateSql = `
          UPDATE _queue_jobs
          SET status = 'queued',
              error = ?,
              claimedBy = NULL,
              leaseExpiresAt = NULL,
              claimToken = NULL,
              availableAt = ?,
              updated = ?
          WHERE id = ? AND status = 'processing'
        `;
        const updateParams: any[] = [error, availableAt, now, jobId];
        if (claimToken) {
          updateSql += ` AND claimToken = ?`;
          updateParams.push(claimToken);
        }

        const res = this.db.prepare(updateSql).run(...updateParams);
        if (Number(res.changes) === 0) {
          return { retried: false, deadLettered: false, attempts: 0 };
        }

        return { retried: true, deadLettered: false, attempts };
      }

      // Max attempts reached -> mark as dead_letter (or failed if maxAttempts == 1 and no DLQ)
      const dlqName = qRow?.deadLetterQueue || null;

      let dlqSql = `
        UPDATE _queue_jobs
        SET status = 'dead_letter',
            error = ?,
            claimedBy = NULL,
            leaseExpiresAt = NULL,
            claimToken = NULL,
            updated = ?,
            finishedAt = ?
        WHERE id = ? AND status = 'processing'
      `;
      const dlqParams: any[] = [error, now, now, jobId];
      if (claimToken) {
        dlqSql += ` AND claimToken = ?`;
        dlqParams.push(claimToken);
      }

      const res = this.db.prepare(dlqSql).run(...dlqParams);
      if (Number(res.changes) === 0) {
        return { retried: false, deadLettered: false, attempts: 0 };
      }

      // If a separate deadLetterQueue is configured, also enqueue a copy into that DLQ
      if (dlqName && dlqName !== row.queue) {
        let parsedPayload: any = null;
        try {
          parsedPayload = row.payload ? JSON.parse(row.payload) : null;
        } catch {
          parsedPayload = row.payload;
        }
        this.insertJobSync({
          queue: dlqName,
          payload: {
            originalJobId: row.id,
            originalQueue: row.queue,
            error,
            attempts,
            failedAt: now,
            payload: parsedPayload,
          },
          groupKey: row.groupKey,
          priority: row.priority,
        });
      }

      return { retried: false, deadLettered: true, attempts };
    });
  }

  public async cancel(jobId: string): Promise<boolean> {
    this.ensureInit();
    const res = this.db.prepare('DELETE FROM _queue_jobs WHERE id = ?').run(jobId);
    return Number(res.changes) > 0;
  }

  public async defer(jobId: string, delayMs: number, reason?: string): Promise<boolean> {
    this.ensureInit();
    const now = new Date().toISOString();
    const availableAt = new Date(Date.now() + Math.max(0, delayMs)).toISOString();

    const res = this.db.prepare(`
      UPDATE _queue_jobs
      SET status = 'queued',
          claimedBy = NULL,
          leaseExpiresAt = NULL,
          claimToken = NULL,
          attempts = MAX(0, attempts - 1),
          error = ?,
          availableAt = ?,
          updated = ?
      WHERE id = ? AND status = 'processing'
    `).run(reason || null, availableAt, now, jobId);

    return Number(res.changes) > 0;
  }

  public async retryDeadLetterJobs(queueName: string, limit = 100): Promise<number> {
    this.ensureInit();
    const safeLimit = Math.max(1, Math.floor(limit));
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      const rows = this.db.prepare(`
        SELECT id FROM _queue_jobs
        WHERE queue = ? AND status IN ('dead_letter', 'failed')
        ORDER BY updated ASC, rowid ASC
        LIMIT ?
      `).all(queueName, safeLimit) as Array<{ id: string }>;

      if (!rows || rows.length === 0) return 0;

      const stmt = this.db.prepare(`
        UPDATE _queue_jobs
        SET status = 'queued',
            attempts = 0,
            error = NULL,
            claimedBy = NULL,
            leaseExpiresAt = NULL,
            availableAt = ?,
            updated = ?,
            finishedAt = NULL
        WHERE id = ?
      `);

      let count = 0;
      for (const r of rows) {
        const res = stmt.run(now, now, r.id);
        count += Number(res.changes);
      }
      return count;
    });
  }

  public async reclaimOrphaned(
    queueName?: string,
    forceAll = false,
    onDlqEnqueued?: (dlqQueue: string) => void
  ): Promise<number> {
    this.ensureInit();
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      let expired: any[];
      if (forceAll) {
        const sql = queueName
          ? `SELECT * FROM _queue_jobs WHERE queue = ? AND status = 'processing'`
          : `SELECT * FROM _queue_jobs WHERE status = 'processing'`;
        expired = (queueName ? this.db.prepare(sql).all(queueName) : this.db.prepare(sql).all()) as any[];
      } else {
        const sql = queueName
          ? `SELECT * FROM _queue_jobs WHERE queue = ? AND status = 'processing' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ?`
          : `SELECT * FROM _queue_jobs WHERE status = 'processing' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ?`;
        expired = (queueName
          ? this.db.prepare(sql).all(queueName, now)
          : this.db.prepare(sql).all(now)) as any[];
      }

      if (!expired || expired.length === 0) return 0;

      let reclaimed = 0;
      for (const row of expired) {
        const qRow = this.db.prepare('SELECT * FROM _queues WHERE name = ?').get(row.queue) as any;
        const attempts = Number(row.attempts) || 1;
        const maxAttempts = Number(row.maxAttempts) || (qRow?.maxAttempts ?? 3);
        const dlqName = qRow?.deadLetterQueue || null;
        const timeoutError = 'Max attempts exceeded after visibility timeout';

        if (attempts < maxAttempts) {
          this.db.prepare(`
            UPDATE _queue_jobs
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
            UPDATE _queue_jobs
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

          // If a separate deadLetterQueue is configured, also enqueue a copy into that DLQ
          if (dlqName && dlqName !== row.queue) {
            let parsedPayload: any = null;
            try {
              parsedPayload = row.payload ? JSON.parse(row.payload) : null;
            } catch {
              parsedPayload = row.payload;
            }
            this.insertJobSync({
              queue: dlqName,
              payload: {
                originalJobId: row.id,
                originalQueue: row.queue,
                error: row.error || timeoutError,
                attempts,
                failedAt: now,
                payload: parsedPayload,
              },
              groupKey: row.groupKey,
              priority: row.priority,
            });
            onDlqEnqueued?.(dlqName);
          }
        }
      }

      return reclaimed;
    });
  }

  public async cleanup(retentionDays: number, queueName?: string): Promise<number> {
    this.ensureInit();
    const days = Math.max(0, retentionDays);
    const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();

    if (queueName) {
      const res = this.db.prepare(`
        DELETE FROM _queue_jobs
        WHERE queue = ?
          AND status IN ('completed', 'failed', 'dead_letter')
          AND COALESCE(finishedAt, updated) <= ?
      `).run(queueName, cutoff);
      return Number(res.changes);
    }

    const res = this.db.prepare(`
      DELETE FROM _queue_jobs
      WHERE status IN ('completed', 'failed', 'dead_letter')
        AND COALESCE(finishedAt, updated) <= ?
    `).run(cutoff);
    return Number(res.changes);
  }

  public async purge(queueName: string, status?: string): Promise<number> {
    this.ensureInit();
    if (status) {
      const res = this.db.prepare('DELETE FROM _queue_jobs WHERE queue = ? AND status = ?').run(queueName, status);
      return Number(res.changes);
    }
    const res = this.db.prepare("DELETE FROM _queue_jobs WHERE queue = ? AND status IN ('queued', 'failed', 'dead_letter', 'completed')").run(queueName);
    return Number(res.changes);
  }

  public async getJob<T = any>(jobId: string): Promise<QueueJob<T> | null> {
    this.ensureInit();
    const row = this.db.prepare('SELECT * FROM _queue_jobs WHERE id = ?').get(jobId) as any;
    return row ? this.mapRowToJob<T>(row) : null;
  }

  public async getJobs<T = any>(options: GetJobsOptions = {}): Promise<{ items: QueueJob<T>[]; total: number }> {
    this.ensureInit();
    const page = Math.max(1, options.page || 1);
    const perPage = Math.max(1, Math.min(options.perPage || 25, 100));
    const offset = (page - 1) * perPage;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (options.queue) {
      where += ' AND queue = ?';
      params.push(options.queue);
    } else if (!options.includeSystem) {
      where += " AND queue NOT LIKE '_system:%'";
    }
    if (options.status && options.status !== 'all') {
      where += ' AND status = ?';
      params.push(options.status);
    }
    if (options.groupKey) {
      where += ' AND groupKey = ?';
      params.push(options.groupKey);
    }

    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM _queue_jobs ${where}`).get(...params) as any;
    const total = Number(countRow?.total || 0);

    const rows = this.db.prepare(`
      SELECT * FROM _queue_jobs
      ${where}
      ORDER BY priority DESC, created ASC, rowid ASC
      LIMIT ? OFFSET ?
    `).all(...params, perPage, offset) as any[];

    return {
      items: rows.map((r) => this.mapRowToJob<T>(r)),
      total,
    };
  }

  public async getStats(queueName?: string, includeSystem = false): Promise<QueueStats> {
    this.ensureInit();
    let where = '';
    const params: any[] = [];

    if (queueName) {
      where = 'WHERE queue = ?';
      params.push(queueName);
    } else if (!includeSystem) {
      where = "WHERE queue NOT LIKE '_system:%'";
    }

    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) as deadLetter
      FROM _queue_jobs
      ${where}
    `).get(...params) as any;

    const deadLetter = Number(row?.deadLetter || 0);
    return {
      queued: Number(row?.queued || 0),
      processing: Number(row?.processing || 0),
      completed: Number(row?.completed || 0),
      failed: Number(row?.failed || 0),
      deadLetter,
      dead_letter: deadLetter,
      total: Number(row?.total || 0),
    };
  }

  public async getNextDelayedTimestamp(queueName?: string): Promise<string | null> {
    this.ensureInit();
    const now = new Date().toISOString();
    if (queueName) {
      const row = this.db.prepare(`
        SELECT MIN(availableAt) as nextAt FROM _queue_jobs
        WHERE queue = ? AND status = 'queued' AND availableAt > ?
      `).get(queueName, now) as any;
      return row?.nextAt || null;
    }

    const row = this.db.prepare(`
      SELECT MIN(availableAt) as nextAt FROM _queue_jobs
      WHERE status = 'queued' AND availableAt > ?
    `).get(now) as any;
    return row?.nextAt || null;
  }

  public async getQueuesWithPendingJobs(): Promise<string[]> {
    this.ensureInit();
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT DISTINCT queue FROM _queue_jobs
      WHERE status = 'queued' AND availableAt <= ?
    `).all(now) as Array<{ queue: string }>;
    return rows.map((r) => r.queue);
  }

  private mapRowToQueue(row: any): QueueConfig {
    return {
      name: row.name,
      concurrency: Number(row.concurrency ?? 0),
      visibilityTimeoutSeconds: Number(row.visibilityTimeoutSeconds ?? 30),
      maxAttempts: Number(row.maxAttempts ?? 3),
      backoffDelayMs: Number(row.backoffDelayMs ?? 1000),
      deadLetterQueue: row.deadLetterQueue || null,
      targetFunction: row.targetFunction || null,
      isSystem: Boolean(row.isSystem),
      created: row.created,
      updated: row.updated,
    };
  }

  private mapRowToJob<T = any>(row: any): QueueJob<T> {
    let payload: any = null;
    if (row.payload !== null && row.payload !== undefined) {
      try {
        payload = JSON.parse(row.payload);
      } catch {
        payload = row.payload;
      }
    }

    let result: any = undefined;
    if (row.result !== null && row.result !== undefined) {
      try {
        result = JSON.parse(row.result);
      } catch {
        result = row.result;
      }
    }

    return {
      id: row.id,
      queue: row.queue,
      groupKey: row.groupKey || null,
      status: row.status,
      payload,
      result,
      error: row.error || null,
      attempts: Number(row.attempts ?? 0),
      maxAttempts: Number(row.maxAttempts ?? 3),
      priority: Number(row.priority ?? 0),
      availableAt: row.availableAt,
      claimedBy: row.claimedBy || null,
      leaseExpiresAt: row.leaseExpiresAt || null,
      claimToken: row.claimToken || null,
      deduplicationId: row.deduplicationId || null,
      created: row.created,
      updated: row.updated,
      finishedAt: row.finishedAt || null,
    };
  }
}
