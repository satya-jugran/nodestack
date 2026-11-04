import * as crypto from 'crypto';
import { IQueueDriver } from './drivers/IQueueDriver';
import {
  QueueConfig,
  CreateQueueDto,
  QueueJob,
  EnqueueJobDto,
  JobFailResult,
  JobHandler,
  QueueStats,
  GetJobsOptions,
} from './types';
import { ConfigService } from '../core/config/ConfigService';
import { FunctionService } from '../functions/FunctionService';
import { DatabaseService } from '../database/DatabaseService';
import { AppError } from '../core/errors/AppError';

export interface QueueServiceOptions {
  reclaimIntervalMs?: number;
  cleanupIntervalMs?: number;
  workerId?: string;
}

/**
 * Stateless, DB-Driven Generic Queue Orchestrator.
 *
 * All durable state (queue configs, concurrency limits, targetFunction bindings,
 * active processing counts, and job leases) lives in the underlying IQueueDriver (SQLite).
 *
 * In-memory state is strictly limited to:
 * 1. Optional programmatic callbacks (`handlers` / `prefixHandlers`) for embedded TypeScript consumers
 *    and the single `_system:flow:` system prefix handler.
 * 2. Transient coordination sets (`drainingQueues`, `pendingWake`) that are empty when idle.
 */
export class QueueService {
  private handlers = new Map<string, JobHandler<any, any>>();
  private prefixHandlers = new Map<string, JobHandler<any, any>>();
  private drainingQueues = new Set<string>();
  private pendingWake = new Set<string>();

  private workerId: string;
  private isDisposed = false;
  private delayedTimer: NodeJS.Timeout | null = null;
  private nextDelayedTargetMs: number | null = null;
  private reclaimTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private reclaimIntervalMs: number;
  private cleanupIntervalMs: number;

  constructor(
    private driver: IQueueDriver,
    private config?: ConfigService,
    private functionService?: FunctionService,
    private db?: DatabaseService,
    options: QueueServiceOptions = {}
  ) {
    this.workerId = options.workerId || `worker_${crypto.randomBytes(4).toString('hex')}`;
    this.reclaimIntervalMs = options.reclaimIntervalMs ?? 15000;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 24 * 60 * 60 * 1000;
    this.initSync();
  }

  private initSync(): void {
    try {
      void this.driver.init();
    } catch {
      // ignore if db not ready yet
    }
  }

  public getDatabase(): DatabaseService | undefined {
    return this.db;
  }

  public getDriver(): IQueueDriver {
    return this.driver;
  }

  public setFunctionService(functionService: FunctionService): void {
    this.functionService = functionService;
  }

  public getWorkerCount(): number {
    return this.handlers.size + this.prefixHandlers.size;
  }

  public hasWorker(queueName: string): boolean {
    return this.resolveMemoryHandler(queueName) !== undefined;
  }

  private resolveMemoryHandler(queueName: string): JobHandler<any, any> | undefined {
    const exact = this.handlers.get(queueName);
    if (exact) return exact;
    for (const [prefix, handler] of this.prefixHandlers.entries()) {
      if (queueName.startsWith(prefix)) {
        return handler;
      }
    }
    return undefined;
  }

  private isDbAvailable(): boolean {
    if (this.isDisposed) return false;
    if (this.db) {
      if (this.db.isDatabaseLocked() || !this.db.isOpen()) {
        return false;
      }
    }
    return true;
  }

  public async start(): Promise<void> {
    this.isDisposed = false;
    await this.driver.init();

    if (this.isDbAvailable()) {
      // 1. Immediately reclaim any orphaned 'processing' jobs left behind by a crash/restart
      // (excluding _system:flow:* jobs which FlowService recovers via step checkpoints)
      try {
        const allQueues = await this.driver.getAllQueues(true);
        for (const q of allQueues) {
          if (!q.name.startsWith('_system:flow:')) {
            await this.driver.reclaimOrphaned(q.name, true);
          }
        }
      } catch {}

      // 2. Run startup retention cleanup
      const retentionDays = this.config?.queueJobRetentionDays ?? 7;
      try {
        await this.driver.cleanup(retentionDays);
      } catch {}
    }

    this.startBackgroundSweepers();

    // 3. Query DB for any queues with pending 'queued' jobs and wake them
    await this.wakePendingQueuesFromStorage();
    void this.scheduleNextDelayedWake();
  }

  /**
   * Queries the storage driver for all queues that currently have due 'queued' jobs
   * and schedules a drain for each one. Zero idle queues are loaded into memory.
   */
  public async wakePendingQueuesFromStorage(): Promise<void> {
    if (!this.isDbAvailable()) return;
    try {
      const pendingQueues = await this.driver.getQueuesWithPendingJobs();
      for (const queueName of pendingQueues) {
        this.wakeWorker(queueName);
      }
    } catch {
      // ignore
    }
  }

  private startBackgroundSweepers(): void {
    if (!this.reclaimTimer && this.reclaimIntervalMs > 0) {
      this.reclaimTimer = setInterval(() => {
        if (!this.isDbAvailable()) return;
        this.reclaimOrphaned().catch(() => {});
      }, this.reclaimIntervalMs);
      if (typeof this.reclaimTimer.unref === 'function') {
        this.reclaimTimer.unref();
      }
    }

    if (!this.cleanupTimer && this.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => {
        if (!this.isDbAvailable()) return;
        const retentionDays = this.config?.queueJobRetentionDays ?? 7;
        this.cleanup(retentionDays).catch(() => {});
      }, this.cleanupIntervalMs);
      if (typeof this.cleanupTimer.unref === 'function') {
        this.cleanupTimer.unref();
      }
    }
  }

  // ==========================================
  // Queue Configuration CRUD (100% DB-backed)
  // ==========================================

  public async upsertQueue(dto: CreateQueueDto): Promise<QueueConfig> {
    if (!dto.name || typeof dto.name !== 'string' || !dto.name.trim()) {
      throw new AppError('Queue name is required', 400);
    }
    const cleanName = dto.name.trim();

    // Concurrency normalization: 0, null, blank, or undefined = 0 (unbounded)
    let normalizedConcurrency = 0;
    if (dto.concurrency !== undefined && dto.concurrency !== null && (dto.concurrency as any) !== '') {
      const parsed = typeof dto.concurrency === 'number' ? dto.concurrency : parseInt(String(dto.concurrency), 10);
      if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 0) {
        throw new AppError('Queue concurrency must be an integer >= 0 (0 or blank for unbounded)', 400);
      }
      normalizedConcurrency = parsed;
    }

    let normalizedMaxAttempts = 3;
    if (dto.maxAttempts !== undefined && dto.maxAttempts !== null && (dto.maxAttempts as any) !== '') {
      const parsed = typeof dto.maxAttempts === 'number' ? dto.maxAttempts : parseInt(String(dto.maxAttempts), 10);
      if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1) {
        throw new AppError('Queue maxAttempts must be an integer >= 1', 400);
      }
      normalizedMaxAttempts = parsed;
    }

    let normalizedVisibility = 30;
    if (dto.visibilityTimeoutSeconds !== undefined && dto.visibilityTimeoutSeconds !== null && (dto.visibilityTimeoutSeconds as any) !== '') {
      const parsed = typeof dto.visibilityTimeoutSeconds === 'number' ? dto.visibilityTimeoutSeconds : parseInt(String(dto.visibilityTimeoutSeconds), 10);
      if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1) {
        throw new AppError('Queue visibilityTimeoutSeconds must be an integer >= 1', 400);
      }
      normalizedVisibility = parsed;
    }

    let normalizedBackoff = 1000;
    if (dto.backoffDelayMs !== undefined && dto.backoffDelayMs !== null && (dto.backoffDelayMs as any) !== '') {
      const parsed = typeof dto.backoffDelayMs === 'number' ? dto.backoffDelayMs : parseInt(String(dto.backoffDelayMs), 10);
      if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 0) {
        throw new AppError('Queue backoffDelayMs must be an integer >= 0', 400);
      }
      normalizedBackoff = parsed;
    }

    const config = await this.driver.upsertQueue({
      ...dto,
      name: cleanName,
      concurrency: normalizedConcurrency,
      maxAttempts: normalizedMaxAttempts,
      visibilityTimeoutSeconds: normalizedVisibility,
      backoffDelayMs: normalizedBackoff,
    });

    if (config.targetFunction || this.resolveMemoryHandler(cleanName)) {
      this.wakeWorker(cleanName);
    }

    return config;
  }

  public async createQueue(dto: CreateQueueDto): Promise<QueueConfig> {
    return this.upsertQueue(dto);
  }

  public async getQueue(name: string): Promise<QueueConfig | null> {
    return this.driver.getQueue(name);
  }

  public async getAllQueues(includeSystem = false): Promise<Array<QueueConfig & { stats: QueueStats }>> {
    const queues = await this.driver.getAllQueues(includeSystem);
    const results: Array<QueueConfig & { stats: QueueStats }> = [];
    for (const q of queues) {
      const stats = await this.driver.getStats(q.name);
      results.push({ ...q, stats });
    }
    return results;
  }

  public async deleteQueue(name: string): Promise<boolean> {
    this.handlers.delete(name);
    this.pendingWake.delete(name);
    this.drainingQueues.delete(name);
    return this.driver.deleteQueue(name);
  }

  // ==========================================
  // Worker Registration & Stateless Wakeup
  // ==========================================

  /**
   * Registers a programmatic worker handler for a specific queue.
   */
  public registerWorker<T = any, R = any>(
    queueName: string,
    handler: JobHandler<T, R>,
    options?: Partial<Omit<CreateQueueDto, 'name'>>
  ): void {
    this.handlers.set(queueName, handler);

    if (options && this.isDbAvailable()) {
      void this.driver
        .upsertQueue({
          name: queueName,
          ...options,
        })
        .then(() => {
          this.wakeWorker(queueName);
        })
        .catch(() => {});
    } else {
      this.wakeWorker(queueName);
    }
  }

  /**
   * Registers a single pattern/prefix worker handler (e.g. `_system:flow:`) so 10,000+ dynamic
   * queues sharing a prefix are handled by 1 handler entry with O(1) memory overhead.
   */
  public registerPrefixWorker<T = any, R = any>(prefix: string, handler: JobHandler<T, R>): void {
    this.prefixHandlers.set(prefix, handler);
  }

  public unregisterWorker(queueName: string): void {
    this.handlers.delete(queueName);
  }

  public unregisterPrefixWorker(prefix: string): void {
    this.prefixHandlers.delete(prefix);
  }

  /**
   * Coalesces wake requests per queueName via setImmediate() and triggers a DB-driven drain.
   * Holds zero state in memory once the drain completes.
   */
  public wakeWorker(queueName: string): void {
    if (this.isDisposed) return;
    if (this.pendingWake.has(queueName)) {
      return;
    }
    this.pendingWake.add(queueName);

    setImmediate(() => {
      this.pendingWake.delete(queueName);
      if (this.isDisposed || !this.isDbAvailable()) return;
      void this.drainQueue(queueName);
    });
  }

  public wakeAllWorkers(): void {
    void this.wakePendingQueuesFromStorage();
  }

  // ==========================================
  // Enqueue & Job Lifecycle Operations
  // ==========================================

  public async send<T = any>(
    queueOrJob: string | EnqueueJobDto<T>,
    payload?: T,
    options?: Omit<EnqueueJobDto<T>, 'queue' | 'payload'>
  ): Promise<QueueJob<T>> {
    const dto: EnqueueJobDto<T> =
      typeof queueOrJob === 'string'
        ? {
            queue: queueOrJob,
            payload: payload as T,
            ...options,
          }
        : queueOrJob;

    if (!dto.queue || typeof dto.queue !== 'string' || !dto.queue.trim()) {
      throw new AppError('Queue name is required', 400);
    }
    dto.queue = dto.queue.trim();

    const job = await this.driver.send(dto);

    if (dto.delaySeconds && dto.delaySeconds > 0) {
      this.scheduleDelayedAt(new Date(job.availableAt).getTime());
    } else {
      this.wakeWorker(dto.queue);
    }

    return job;
  }

  public async sendBatch<T = any>(
    queueOrJobs: string | EnqueueJobDto<T>[],
    batchDtos?: Array<Omit<EnqueueJobDto<T>, 'queue'> & { queue?: string }>
  ): Promise<QueueJob<T>[]> {
    const jobs: EnqueueJobDto<T>[] =
      typeof queueOrJobs === 'string'
        ? (batchDtos || []).map((item) => ({
            ...item,
            queue: queueOrJobs,
          }))
        : queueOrJobs;

    if (!jobs || jobs.length === 0) return [];
    const created = await this.driver.sendBatch(jobs);
    const touchedQueues = new Set<string>();
    let earliestDelayed: number | null = null;

    for (let i = 0; i < created.length; i++) {
      const job = created[i];
      const dto = jobs[i];
      if (dto?.delaySeconds && dto.delaySeconds > 0) {
        const ts = new Date(job.availableAt).getTime();
        if (earliestDelayed === null || ts < earliestDelayed) {
          earliestDelayed = ts;
        }
      } else {
        touchedQueues.add(job.queue);
      }
    }

    for (const q of touchedQueues) {
      this.wakeWorker(q);
    }
    if (earliestDelayed !== null) {
      this.scheduleDelayedAt(earliestDelayed);
    }

    return created;
  }

  public async claim<T = any>(
    queueName: string,
    visibilityTimeoutSeconds = 30,
    limit = 1,
    claimedBy = this.workerId
  ): Promise<QueueJob<T>[]> {
    return this.driver.claim<T>(queueName, claimedBy, visibilityTimeoutSeconds, limit);
  }

  public async touch(jobId: string, extensionSeconds = 30): Promise<boolean> {
    if (!this.isDbAvailable()) return false;
    return this.driver.touch(jobId, extensionSeconds);
  }

  public async complete(jobId: string, result?: any): Promise<boolean> {
    if (!this.isDbAvailable()) return false;
    return this.driver.complete(jobId, result);
  }

  public async fail(jobId: string, error: string, backoffDelayMs?: number): Promise<JobFailResult> {
    if (!this.isDbAvailable()) {
      return { retried: false, deadLettered: false, attempts: 0 };
    }
    const job = await this.driver.getJob(jobId);
    const res = await this.driver.fail(jobId, error, backoffDelayMs);
    if (res.retried) {
      const updatedJob = await this.driver.getJob(jobId);
      if (updatedJob) {
        const availMs = new Date(updatedJob.availableAt).getTime();
        if (availMs <= Date.now()) {
          this.wakeWorker(updatedJob.queue);
        } else {
          this.scheduleDelayedAt(availMs);
        }
      }
    } else if (res.deadLettered && job) {
      const cfg = await this.driver.getQueue(job.queue);
      if (cfg?.deadLetterQueue) {
        this.wakeWorker(cfg.deadLetterQueue);
      }
    }
    return res;
  }

  public async cancel(jobId: string): Promise<boolean> {
    if (!this.isDbAvailable()) return false;
    return this.driver.cancel(jobId);
  }

  public async retryDeadLetterJobs(queueName: string, limit = 100): Promise<number> {
    const count = await this.driver.retryDeadLetterJobs(queueName, limit);
    if (count > 0) {
      this.wakeWorker(queueName);
    }
    return count;
  }

  public async reclaimOrphaned(queueName?: string, forceAll = false): Promise<number> {
    if (!this.isDbAvailable()) return 0;
    const count = await this.driver.reclaimOrphaned(queueName, forceAll);
    if (count > 0) {
      if (queueName) {
        this.wakeWorker(queueName);
      } else {
        await this.wakePendingQueuesFromStorage();
      }
    }
    return count;
  }

  public async cleanup(retentionDays?: number, queueName?: string): Promise<number> {
    if (!this.isDbAvailable()) return 0;
    const days = retentionDays !== undefined ? retentionDays : (this.config?.queueJobRetentionDays ?? 7);
    return this.driver.cleanup(days, queueName);
  }

  public async purge(queueName: string, status?: string): Promise<number> {
    if (!this.isDbAvailable()) return 0;
    return this.driver.purge(queueName, status);
  }

  public async getJob<T = any>(jobId: string): Promise<QueueJob<T> | null> {
    return this.driver.getJob<T>(jobId);
  }

  public async getJobs<T = any>(options: GetJobsOptions = {}): Promise<{ items: QueueJob<T>[]; total: number }> {
    return this.driver.getJobs<T>(options);
  }

  public async getStats(queueName?: string, includeSystem = false): Promise<QueueStats> {
    return this.driver.getStats(queueName, includeSystem);
  }

  // ==========================================
  // Stateless DB-Driven Worker Execution Loop
  // ==========================================

  private async drainQueue(queueName: string): Promise<void> {
    if (this.isDisposed || !this.isDbAvailable()) return;
    if (this.drainingQueues.has(queueName)) {
      // Another drain cycle is currently claiming for this queue; mark pendingWake so it re-checks after
      this.pendingWake.add(queueName);
      return;
    }

    this.drainingQueues.add(queueName);
    try {
      // Read queue config directly from driver (single source of truth)
      const config = (await this.driver.getQueue(queueName)) || undefined;
      const memoryHandler = this.resolveMemoryHandler(queueName);
      const hasTargetFunction = Boolean(config?.targetFunction);

      // If no programmatic/prefix handler and no targetFunction in DB, this queue is externally polled only
      if (!memoryHandler && !hasTargetFunction) {
        return;
      }

      const concurrency = config?.concurrency && config.concurrency > 0 ? config.concurrency : 25;
      const visibilityTimeout = config?.visibilityTimeoutSeconds ?? 30;

      // Driver atomically checks active 'processing' count in SQLite against concurrency limit
      // and claims up to `concurrency` available slots in a single transaction
      const claimed = await this.driver.claim(queueName, this.workerId, visibilityTimeout, concurrency);
      if (!claimed || claimed.length === 0) {
        void this.scheduleNextDelayedWake(queueName);
        return;
      }

      for (const job of claimed) {
        void this.executeClaimedJob(queueName, job, config, memoryHandler);
      }
    } catch (err: any) {
      if (!this.isDisposed && this.isDbAvailable()) {
        console.warn(`[QueueService] Error draining queue '${queueName}': ${err.message}`);
      }
    } finally {
      this.drainingQueues.delete(queueName);
      if (this.pendingWake.has(queueName) && !this.isDisposed) {
        this.pendingWake.delete(queueName);
        this.wakeWorker(queueName);
      }
    }
  }

  private async executeClaimedJob(
    queueName: string,
    job: QueueJob,
    config?: QueueConfig,
    memoryHandler?: JobHandler<any, any>
  ): Promise<void> {
    try {
      const handler = memoryHandler || this.resolveMemoryHandler(queueName);
      if (handler) {
        const result = await handler(job);
        if (!this.isDisposed && this.isDbAvailable()) {
          await this.driver.complete(job.id, result);
        }
      } else if (config?.targetFunction) {
        if (!this.functionService) {
          throw new Error(`FunctionService is not available to execute targetFunction '${config.targetFunction}'`);
        }

        const fnResult = await this.functionService.executeQueueJob(
          config.targetFunction,
          job,
          { id: `job:${job.id}`, isAdmin: true, queue: queueName }
        );

        if (fnResult.status !== 'success' || fnResult.statusCode >= 400) {
          const errMsg =
            fnResult.error ||
            (typeof fnResult.body === 'object' && fnResult.body?.error
              ? String(fnResult.body.error)
              : `Function '${config.targetFunction}' failed with status ${fnResult.statusCode}`);
          throw new Error(errMsg);
        }

        if (!this.isDisposed && this.isDbAvailable()) {
          await this.driver.complete(job.id, fnResult.body);
        }
      }
    } catch (err: any) {
      if (!this.isDisposed && this.isDbAvailable()) {
        const errMsg = err?.message || String(err);
        await this.fail(job.id, errMsg, config?.backoffDelayMs);
      }
    } finally {
      // As soon as this job finishes and frees its 'processing' row in SQLite, wake the queue to claim next
      if (!this.isDisposed && this.isDbAvailable()) {
        this.wakeWorker(queueName);
      }
    }
  }

  private scheduleDelayedAt(targetMs: number): void {
    if (this.isDisposed) return;
    if (this.nextDelayedTargetMs !== null && this.nextDelayedTargetMs <= targetMs && this.delayedTimer) {
      return;
    }

    if (this.delayedTimer) {
      clearTimeout(this.delayedTimer);
      this.delayedTimer = null;
    }

    const delayMs = Math.max(5, targetMs - Date.now());
    this.nextDelayedTargetMs = targetMs;

    this.delayedTimer = setTimeout(() => {
      this.delayedTimer = null;
      this.nextDelayedTargetMs = null;
      if (this.isDisposed || !this.isDbAvailable()) return;
      void this.wakePendingQueuesFromStorage();
      void this.scheduleNextDelayedWake();
    }, Math.min(delayMs, 2147483647));

    if (typeof this.delayedTimer.unref === 'function') {
      this.delayedTimer.unref();
    }
  }

  private async scheduleNextDelayedWake(queueName?: string): Promise<void> {
    if (this.isDisposed || !this.isDbAvailable()) return;
    try {
      const nextIso = await this.driver.getNextDelayedTimestamp(queueName);
      if (nextIso) {
        const targetMs = new Date(nextIso).getTime();
        if (!isNaN(targetMs)) {
          this.scheduleDelayedAt(targetMs);
        }
      }
    } catch {
      // ignore
    }
  }

  public async dispose(): Promise<void> {
    this.isDisposed = true;
    this.pendingWake.clear();
    this.drainingQueues.clear();
    if (this.delayedTimer) {
      clearTimeout(this.delayedTimer);
      this.delayedTimer = null;
    }
    if (this.reclaimTimer) {
      clearInterval(this.reclaimTimer);
      this.reclaimTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    try {
      await this.driver.close();
    } catch {}
  }
}
