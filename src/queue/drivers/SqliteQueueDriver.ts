import { DatabaseService } from '../../database/DatabaseService';
import { IQueueDriver } from './IQueueDriver';
import {
  QueueConfig,
  CreateQueueDto,
  QueueMessage,
  EnqueueMessageDto,
  MessageFailResult,
  QueueStats,
  GetMessagesOptions,
  ReclaimOrphanedOptions,
} from '../types';
import { mapRowToQueue, mapRowToMessage } from './queueMapping';
import { ensureQueueSchema } from './queueSchema';
import { SyncQueueEngine } from './SyncQueueEngine';
import { AsyncQueueEngine } from './AsyncQueueEngine';

export class SqliteQueueDriver implements IQueueDriver {
  public initialized = false;
  private syncEngine: SyncQueueEngine;
  private asyncEngine: AsyncQueueEngine;

  constructor(private db: DatabaseService) {
    this.syncEngine = new SyncQueueEngine(db);
    this.asyncEngine = new AsyncQueueEngine(db);
  }

  private get isSqlite(): boolean {
    return this.db.dialect.name === 'sqlite';
  }

  public async init(): Promise<void> {
    try {
      await ensureQueueSchema(this.db);
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

  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  private getTieBreaker(): string {
    return this.isSqlite ? 'rowid' : 'id';
  }

  public async upsertQueue(dto: CreateQueueDto): Promise<QueueConfig> {
    await this.ensureInit();
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
        ? Math.max(0, Math.floor(Number(dto.maxAttempts)))
        : (existing?.maxAttempts ?? 3);
    const strictOrder =
      dto.strictOrder !== undefined && dto.strictOrder !== null
        ? Boolean(dto.strictOrder)
        : (existing?.strictOrder ?? false);
    const defaultBackoff = strictOrder ? 0 : 1000;
    const backoffDelayMs =
      dto.backoffDelayMs !== undefined && dto.backoffDelayMs !== null
        ? Math.max(0, Math.floor(Number(dto.backoffDelayMs)))
        : (existing?.backoffDelayMs ?? defaultBackoff);
    const deadLetterQueue = dto.deadLetterQueue !== undefined ? dto.deadLetterQueue : (existing?.deadLetterQueue ?? null);
    const targetFunction = dto.targetFunction !== undefined ? dto.targetFunction : (existing?.targetFunction ?? null);
    const isSystem = dto.name.startsWith('_system:') || dto.isSystem
      ? 1
      : (existing ? (existing.isSystem ? 1 : 0) : 0);
    const created = existing?.created || now;

    await this.db.prepare(`
      INSERT INTO _queues (
        name, concurrency, visibilityTimeoutSeconds, maxAttempts, backoffDelayMs,
        deadLetterQueue, targetFunction, isSystem, strictOrder, created, updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        concurrency = excluded.concurrency,
        visibilityTimeoutSeconds = excluded.visibilityTimeoutSeconds,
        maxAttempts = excluded.maxAttempts,
        backoffDelayMs = excluded.backoffDelayMs,
        deadLetterQueue = excluded.deadLetterQueue,
        targetFunction = excluded.targetFunction,
        isSystem = excluded.isSystem,
        strictOrder = excluded.strictOrder,
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
      strictOrder ? 1 : 0,
      created,
      now
    );

    return (await this.getQueue(dto.name))!;
  }

  public async getQueue(name: string): Promise<QueueConfig | null> {
    await this.ensureInit();
    const row = (await this.db.prepare('SELECT * FROM _queues WHERE name = ?').get(name)) as any;
    return row ? mapRowToQueue(row) : null;
  }

  public async getAllQueues(includeSystem = true): Promise<QueueConfig[]> {
    await this.ensureInit();
    const sql = includeSystem
      ? 'SELECT * FROM _queues ORDER BY created ASC'
      : "SELECT * FROM _queues WHERE isSystem = 0 AND name NOT LIKE '_system:%' ORDER BY created ASC";
    const rows = ((await this.db.prepare(sql).all()) as any[]) || [];
    return rows.map((r) => mapRowToQueue(r));
  }

  public async deleteQueue(name: string): Promise<boolean> {
    await this.ensureInit();
    return this.isSqlite ? this.syncEngine.deleteQueue(name) : this.asyncEngine.deleteQueue(name);
  }

  public async send<T = any>(dto: EnqueueMessageDto<T>): Promise<QueueMessage<T>> {
    await this.ensureInit();
    return this.isSqlite ? this.syncEngine.send(dto) : this.asyncEngine.send(dto);
  }

  public async sendBatch<T = any>(messages: EnqueueMessageDto<T>[]): Promise<QueueMessage<T>[]> {
    await this.ensureInit();
    return this.isSqlite ? this.syncEngine.sendBatch(messages) : this.asyncEngine.sendBatch(messages);
  }

  public async claim<T = any>(
    queueName: string,
    claimedBy: string,
    visibilityTimeoutSeconds: number,
    limit = 1
  ): Promise<QueueMessage<T>[]> {
    await this.ensureInit();
    return this.isSqlite
      ? this.syncEngine.claim(queueName, claimedBy, visibilityTimeoutSeconds, limit)
      : this.asyncEngine.claim(queueName, claimedBy, visibilityTimeoutSeconds, limit);
  }

  public async touch(messageId: string, extensionSeconds: number, claimToken?: string | null): Promise<boolean> {
    await this.ensureInit();
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + extensionSeconds * 1000).toISOString();

    let sql = `
      UPDATE _queue_messages
      SET leaseExpiresAt = ?, updated = ?
      WHERE id = ? AND status = 'processing'
    `;
    const params: any[] = [leaseExpiresAt, now, messageId];

    if (claimToken) {
      sql += ` AND claimToken = ?`;
      params.push(claimToken);
    }

    const res: any = await this.db.prepare(sql).run(...params);
    return Number(res?.changes || 0) > 0;
  }

  public async complete(messageId: string, result?: any, claimToken?: string | null): Promise<boolean> {
    await this.ensureInit();
    const now = new Date().toISOString();
    const resultStr = result !== undefined ? JSON.stringify(result) : null;

    const jobQueue = (await this.db.prepare(`
      SELECT q.strictOrder
      FROM _queue_messages j
      JOIN _queues q ON j.queue = q.name
      WHERE j.id = ?
    `).get(messageId)) as { strictOrder: number } | undefined;

    const allowedStatuses = jobQueue && Boolean(jobQueue.strictOrder)
      ? "('processing')"
      : "('processing', 'queued')";

    let sql = `
      UPDATE _queue_messages
      SET status = 'completed',
          result = ?,
          error = NULL,
          claimedBy = NULL,
          leaseExpiresAt = NULL,
          claimToken = NULL,
          updated = ?,
          finishedAt = ?
      WHERE id = ? AND status IN ${allowedStatuses}
    `;
    const params: any[] = [resultStr, now, now, messageId];

    if (claimToken) {
      sql += ` AND claimToken = ?`;
      params.push(claimToken);
    }

    const res: any = await this.db.prepare(sql).run(...params);
    return Number(res?.changes || 0) > 0;
  }

  public async fail(messageId: string, error: string, backoffDelayMs?: number, claimToken?: string | null): Promise<MessageFailResult> {
    await this.ensureInit();
    return this.isSqlite
      ? this.syncEngine.fail(messageId, error, backoffDelayMs, claimToken)
      : this.asyncEngine.fail(messageId, error, backoffDelayMs, claimToken);
  }

  public async forceDeadLetter(messageId: string, reason = 'Force-skipped to DLQ by operator'): Promise<boolean> {
    await this.ensureInit();
    return this.isSqlite
      ? this.syncEngine.forceDeadLetter(messageId, reason)
      : this.asyncEngine.forceDeadLetter(messageId, reason);
  }

  public async cancel(messageId: string): Promise<boolean> {
    await this.ensureInit();
    return this.isSqlite
      ? this.syncEngine.cancel(messageId)
      : this.asyncEngine.cancel(messageId);
  }

  public async defer(messageId: string, delayMs: number, reason?: string): Promise<boolean> {
    await this.ensureInit();
    const now = new Date().toISOString();
    const availableAt = new Date(Date.now() + Math.max(0, delayMs)).toISOString();

    const res: any = await this.db.prepare(`
      UPDATE _queue_messages
      SET status = 'queued',
          claimedBy = NULL,
          leaseExpiresAt = NULL,
          claimToken = NULL,
          attempts = MAX(0, attempts - 1),
          error = ?,
          availableAt = ?,
          updated = ?
      WHERE id = ? AND status = 'processing'
    `).run(reason || null, availableAt, now, messageId);

    return Number(res?.changes || 0) > 0;
  }

  public async retryDeadLetterMessages(
    queueName: string,
    limit = 100,
    onMessageRequeued?: (queue: string) => void
  ): Promise<number> {
    await this.ensureInit();
    return this.isSqlite
      ? this.syncEngine.retryDeadLetterMessages(queueName, limit, onMessageRequeued)
      : this.asyncEngine.retryDeadLetterMessages(queueName, limit, onMessageRequeued);
  }

  public async retryMessage(messageId: string, onMessageRequeued?: (queue: string) => void): Promise<boolean> {
    await this.ensureInit();
    return this.isSqlite
      ? this.syncEngine.retryMessage(messageId, onMessageRequeued)
      : this.asyncEngine.retryMessage(messageId, onMessageRequeued);
  }

  public async reclaimOrphaned(
    queueName?: string,
    options: ReclaimOrphanedOptions = {},
    onDlqEnqueued?: (dlqQueue: string) => void
  ): Promise<number> {
    await this.ensureInit();
    return this.isSqlite
      ? this.syncEngine.reclaimOrphaned(queueName, options, onDlqEnqueued)
      : this.asyncEngine.reclaimOrphaned(queueName, options, onDlqEnqueued);
  }

  public async cleanup(retentionDays: number, queueName?: string): Promise<number> {
    await this.ensureInit();
    const days = Math.max(0, retentionDays);
    const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();

    if (queueName) {
      const res: any = await this.db.prepare(`
        DELETE FROM _queue_messages
        WHERE queue = ?
          AND status IN ('completed', 'failed', 'dead_letter')
          AND COALESCE(finishedAt, updated) <= ?
      `).run(queueName, cutoff);
      return Number(res?.changes || 0);
    }

    const res: any = await this.db.prepare(`
      DELETE FROM _queue_messages
      WHERE status IN ('completed', 'failed', 'dead_letter')
        AND COALESCE(finishedAt, updated) <= ?
    `).run(cutoff);
    return Number(res?.changes || 0);
  }

  public async purge(queueName: string, status?: string): Promise<number> {
    await this.ensureInit();
    if (status) {
      const res: any = await this.db.prepare('DELETE FROM _queue_messages WHERE queue = ? AND status = ?').run(queueName, status);
      return Number(res?.changes || 0);
    }
    const res: any = await this.db.prepare("DELETE FROM _queue_messages WHERE queue = ? AND status IN ('queued', 'failed', 'dead_letter', 'completed')").run(queueName);
    return Number(res?.changes || 0);
  }

  public async getMessage<T = any>(messageId: string): Promise<QueueMessage<T> | null> {
    await this.ensureInit();
    const row = (await this.db.prepare('SELECT * FROM _queue_messages WHERE id = ?').get(messageId)) as any;
    return row ? mapRowToMessage<T>(row) : null;
  }

  public async getMessages<T = any>(options: GetMessagesOptions = {}): Promise<{ items: QueueMessage<T>[]; total: number }> {
    await this.ensureInit();
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

    const countRow = (await this.db.prepare(`SELECT COUNT(*) as total FROM _queue_messages ${where}`).get(...params)) as any;
    const total = Number(countRow?.total || 0);

    const tieBreaker = this.getTieBreaker();
    const rows: any[] = ((await this.db.prepare(`
      SELECT * FROM _queue_messages
      ${where}
      ORDER BY priority DESC, created ASC, ${tieBreaker} ASC
      LIMIT ? OFFSET ?
    `).all(...params, perPage, offset)) as any) || [];

    return {
      items: rows.map((r) => mapRowToMessage<T>(r)),
      total,
    };
  }

  public async getStats(queueName?: string, includeSystem = false): Promise<QueueStats> {
    await this.ensureInit();
    let where = '';
    const params: any[] = [];

    if (queueName) {
      where = 'WHERE queue = ?';
      params.push(queueName);
    } else if (!includeSystem) {
      where = "WHERE queue NOT LIKE '_system:%'";
    }

    const row = (await this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) as deadLetter
      FROM _queue_messages
      ${where}
    `).get(...params)) as any;

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
    await this.ensureInit();
    const now = new Date().toISOString();
    if (queueName) {
      const row = (await this.db.prepare(`
        SELECT MIN(availableAt) as nextAt FROM _queue_messages
        WHERE queue = ? AND status = 'queued' AND availableAt > ?
      `).get(queueName, now)) as any;
      return row?.nextAt || null;
    }

    const row = (await this.db.prepare(`
      SELECT MIN(availableAt) as nextAt FROM _queue_messages
      WHERE status = 'queued' AND availableAt > ?
    `).get(now)) as any;
    return row?.nextAt || null;
  }

  public async getQueuesWithPendingMessages(): Promise<string[]> {
    await this.ensureInit();
    const now = new Date().toISOString();
    const rows = ((await this.db.prepare(`
      SELECT DISTINCT queue FROM _queue_messages
      WHERE status = 'queued' AND availableAt <= ?
    `).all(now)) as any) as Array<{ queue: string }>;
    return (rows || []).map((r) => r.queue);
  }
}
