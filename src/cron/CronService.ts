import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { CronParser } from './CronParser';
import {
  CronSchedule,
  CreateCronScheduleDto,
  UpdateCronScheduleDto,
  CronRunLog,
  CronStats,
  CronTargetType,
  CronRunStatus,
  CronListRunsOptions,
  CronPreviewResult,
  MissedRunPolicy,
} from './types';
import { FunctionConfig, FunctionCronContext } from '../functions/types';
import { FlowConfig } from '../flows/types';
import { AppError, NotFoundError, ValidationError } from '../core/errors/AppError';

export interface CronServiceOptions {
  config?: any;
  eventBus?: any;
  functionService?: any;
  flowService?: any;
  snapshotService?: any;
}

export class CronService {
  private db: DatabaseService;
  private config?: any;
  private eventBus?: any;
  private functionService?: any;
  private flowService?: any;
  private snapshotService?: any;

  private isDisposed = false;
  private isStarted = false;
  private tablesEnsured = false;
  private loopTimer: NodeJS.Timeout | null = null;
  private isTicking = false;
  private activeRenewals = new Map<string, NodeJS.Timeout>();
  private readonly instanceId: string = randomUUID();
  private startPromise: Promise<void> | null = null;
  private ensureTablesPromise: Promise<void> | null = null;

  constructor(db: DatabaseService, options: CronServiceOptions = {}) {
    this.db = db;
    this.config = options.config;
    this.eventBus = options.eventBus;
    this.functionService = options.functionService;
    this.flowService = options.flowService;
    this.snapshotService = options.snapshotService;
  }

  public setFunctionService(svc: any): void {
    this.functionService = svc;
  }

  public setFlowService(svc: any): void {
    this.flowService = svc;
  }

  public setSnapshotService(svc: any): void {
    this.snapshotService = svc;
  }

  public onDriverSwitched(newDb: DatabaseService): void {
    this.db = newDb;
    this.tablesEnsured = false;
    if (this.isDbAvailable()) {
      void this.ensureTables().then(() => {
        if (this.isDbAvailable()) {
          this.cleanStaleLeases().catch(() => {});
          this.scheduleNextWake();
          this.isStarted = true;
        }
      }).catch(() => {});
    }
  }

  public isDbAvailable(): boolean {
    if (this.isDisposed) return false;
    if (this.db) {
      if (this.db.isDatabaseLocked?.() || (this.db.isOpen && !this.db.isOpen())) {
        return false;
      }
    }
    return true;
  }

  public isRunning(): boolean {
    return this.isStarted && !this.isDisposed;
  }

  // ==========================================
  // Lifecycle
  // ==========================================

  public async start(): Promise<void> {
    if (this.isStarted && !this.isDisposed) {
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.isDisposed = false;

    this.startPromise = (async () => {
      try {
        if (!this.isDbAvailable()) {
          // If database driver is closed, attempt initialization if db exists
          if (this.db && !this.db.isOpen()) {
            try {
              await this.db.init();
            } catch {
              // DB driver may still be pending initialization via scope.ensureInitialized()
            }
          }
        }

        if (this.isDbAvailable()) {
          await this.ensureTables();
          await this.cleanStaleLeases();
          this.scheduleNextWake();
          this.isStarted = true;
        }
      } catch (err) {
        // Table initialization or schedule query failure
      } finally {
        this.startPromise = null;
      }
    })();

    return this.startPromise;
  }

  public async dispose(): Promise<void> {
    this.isDisposed = true;
    this.isStarted = false;
    this.tablesEnsured = false;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    for (const [key, timer] of this.activeRenewals.entries()) {
      clearInterval(timer);
    }
    this.activeRenewals.clear();
    this.startPromise = null;
    this.ensureTablesPromise = null;
  }

  public async resetAfterRestore(): Promise<void> {
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    for (const [key, timer] of this.activeRenewals.entries()) {
      clearInterval(timer);
    }
    this.activeRenewals.clear();

    this.tablesEnsured = false;
    if (this.isDbAvailable()) {
      await this.ensureTables();
      await this.cleanStaleLeases();
      this.scheduleNextWake();
      this.isStarted = true;
    }
  }

  private getNextOccurrence(expr: string, tz: string, after: Date): Date | null {
    try {
      const res = CronParser.getNextRun(expr, tz, after);
      return res?.date || null;
    } catch {
      return null;
    }
  }

  public async ensureTables(): Promise<void> {
    if (this.tablesEnsured || !this.isDbAvailable()) return;
    if (this.ensureTablesPromise) {
      return this.ensureTablesPromise;
    }

    this.ensureTablesPromise = (async () => {
      try {
        if (!this.isDbAvailable()) return;
        const dialect = this.db.dialect;
        const pk = dialect.name === 'sqlite' ? 'TEXT' : 'VARCHAR(255)';
        const txt = dialect.textType();
        const num = dialect.name === 'sqlite' ? 'INTEGER' : 'INT';
        const date = dialect.timestampType();
        const idx = dialect.name === 'sqlite' ? 'TEXT' : 'VARCHAR(100)';

        const ddlSchedules = dialect.createTableIfNotExists(
          '_cron_schedules',
          `
          id ${pk} PRIMARY KEY,
          name ${txt} NOT NULL,
          targetType ${idx} NOT NULL,
          targetId ${idx} NOT NULL,
          cronExpression ${txt} NOT NULL,
          timezone ${txt} NOT NULL DEFAULT 'UTC',
          missedRunPolicy ${txt} NOT NULL DEFAULT 'skip',
          payload ${txt},
          isSystemBound ${num} NOT NULL DEFAULT 0,
          enabled ${num} NOT NULL DEFAULT 1,
          nextRunAt ${date},
          lastRunAt ${date},
          lastStatus ${txt},
          lastError ${txt},
          leaseOwner ${txt},
          leaseExpiresAt ${date},
          claimToken ${txt},
          maxRetries ${num} NOT NULL DEFAULT 0,
          autoPauseAfterFailures ${num} NOT NULL DEFAULT 0,
          consecutiveFailures ${num} NOT NULL DEFAULT 0,
          expiresAt ${date},
          keepLast ${num},
          created ${date} NOT NULL,
          updated ${date} NOT NULL
        `
        );

        const ddlRuns = dialect.createTableIfNotExists(
          '_cron_runs',
          `
          id ${pk} PRIMARY KEY,
          scheduleId ${idx} NOT NULL,
          scheduleName ${txt} NOT NULL,
          targetType ${txt} NOT NULL,
          targetId ${txt} NOT NULL,
          scheduledAt ${date} NOT NULL,
          startedAt ${date} NOT NULL,
          finishedAt ${date},
          durationMs ${num} NOT NULL DEFAULT 0,
          status ${idx} NOT NULL,
          isCatchUp ${num} NOT NULL DEFAULT 0,
          attempt ${num} NOT NULL DEFAULT 1,
          executionRefId ${txt},
          output ${txt},
          error ${txt}
        `
        );

        await this.db.exec(ddlSchedules);
        await this.db.exec(ddlRuns);
        await this.db.exec(dialect.createIndexIfNotExists('idx_cron_due', '_cron_schedules', 'enabled, nextRunAt'));
        await this.db.exec(dialect.createIndexIfNotExists('idx_cron_target', '_cron_schedules', 'targetType, targetId'));
        await this.db.exec(dialect.createIndexIfNotExists('idx_cron_lease', '_cron_schedules', 'leaseExpiresAt'));
        await this.db.exec(dialect.createIndexIfNotExists('idx_cron_runs_sched', '_cron_runs', 'scheduleId, startedAt DESC'));
        await this.db.exec(dialect.createIndexIfNotExists('idx_cron_runs_status', '_cron_runs', 'status, startedAt DESC'));

        // Migration for existing tables
        const tryAddColumn = async (table: string, colDef: string) => {
          try {
            await this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
          } catch {}
        };
        await tryAddColumn('_cron_schedules', `maxRetries ${num} NOT NULL DEFAULT 0`);
        await tryAddColumn('_cron_schedules', `autoPauseAfterFailures ${num} NOT NULL DEFAULT 0`);
        await tryAddColumn('_cron_schedules', `consecutiveFailures ${num} NOT NULL DEFAULT 0`);
        await tryAddColumn('_cron_schedules', `expiresAt ${date}`);
        await tryAddColumn('_cron_schedules', `keepLast ${num}`);
        await tryAddColumn('_cron_runs', `attempt ${num} NOT NULL DEFAULT 1`);

        this.tablesEnsured = true;
      } catch (err) {
        // Table initialization or migration error
      } finally {
        this.ensureTablesPromise = null;
      }
    })();

    return this.ensureTablesPromise;
  }

  private async cleanStaleLeases(): Promise<void> {
    if (!this.isDbAvailable()) return;
    try {
      const nowIso = new Date().toISOString();
      await this.db.run(
        `UPDATE _cron_schedules
         SET leaseOwner = NULL, leaseExpiresAt = NULL, claimToken = NULL
         WHERE leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ?`,
        nowIso
      );
    } catch {}
  }

  // ==========================================
  // Schedule Management (CRUD)
  // ==========================================

  public async createSchedule(dto: CreateCronScheduleDto, actor?: any): Promise<CronSchedule> {
    if (!this.tablesEnsured && this.isDbAvailable()) {
      await this.ensureTables();
    }
    if (!dto.name || !dto.name.trim()) {
      throw new ValidationError('Schedule name is required');
    }
    if (!dto.targetType || !['function', 'flow', 'snapshot'].includes(dto.targetType)) {
      throw new ValidationError("Valid targetType ('function', 'flow', 'snapshot') is required");
    }
    if (!dto.targetId || !dto.targetId.trim()) {
      throw new ValidationError('targetId is required');
    }

    if (dto.targetType === 'snapshot') {
      if (this.snapshotService && !this.snapshotService.isSupported()) {
        throw new AppError('Scheduled snapshots are only supported on SQLite databases', 400);
      }
    }

    const tz = dto.timezone?.trim() || 'UTC';
    const validation = CronParser.validate(dto.cronExpression, tz);
    if (!validation.valid) {
      throw new ValidationError(validation.error || 'Invalid cron expression');
    }

    const missedPolicy: MissedRunPolicy = dto.missedRunPolicy || (dto.targetType === 'snapshot' ? 'catch_up_once' : 'skip');
    if (!['skip', 'catch_up_once', 'catch_up_all'].includes(missedPolicy)) {
      throw new ValidationError(`Invalid missedRunPolicy '${missedPolicy}'`);
    }

    const maxRetries = dto.maxRetries !== undefined ? Number(dto.maxRetries) : 0;
    if (isNaN(maxRetries) || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
      throw new ValidationError('maxRetries must be an integer between 0 and 5');
    }

    const autoPauseAfterFailures = dto.autoPauseAfterFailures !== undefined ? Number(dto.autoPauseAfterFailures) : 0;
    if (isNaN(autoPauseAfterFailures) || !Number.isInteger(autoPauseAfterFailures) || autoPauseAfterFailures < 0 || autoPauseAfterFailures > 50) {
      throw new ValidationError('autoPauseAfterFailures must be an integer between 0 and 50');
    }

    const now = new Date();
    const nowIso = now.toISOString();

    let expiresAt: string | null = null;
    if (dto.expiresAt !== undefined && dto.expiresAt !== null && String(dto.expiresAt).trim() !== '') {
      const expDate = new Date(dto.expiresAt);
      if (isNaN(expDate.getTime())) {
        throw new ValidationError('expiresAt must be a valid ISO 8601 date string');
      }
      if (expDate.getTime() <= now.getTime()) {
        throw new ValidationError('expiresAt must be a future date');
      }
      expiresAt = expDate.toISOString();
    }

    let keepLast: number | null = null;
    if (dto.keepLast !== undefined && dto.keepLast !== null && String(dto.keepLast).trim() !== '') {
      keepLast = Number(dto.keepLast);
      if (isNaN(keepLast) || !Number.isInteger(keepLast) || keepLast < 1 || keepLast > 1000) {
        throw new ValidationError('keepLast must be a positive integer between 1 and 1000');
      }
      if (dto.targetType !== 'snapshot') {
        throw new ValidationError('keepLast retention is only applicable to snapshot schedules');
      }
    }

    const id = dto.id || randomUUID();
    const enabled = dto.enabled !== false;
    const isSystemBound = dto.isSystemBound ? 1 : 0;

    let nextRunAt: string | null = null;
    if (enabled) {
      const nextDate = this.getNextOccurrence(dto.cronExpression, tz, now);
      if (expiresAt && nextDate && nextDate.getTime() > new Date(expiresAt).getTime()) {
        nextRunAt = null;
      } else {
        nextRunAt = nextDate ? nextDate.toISOString() : null;
      }
    }

    let payloadStr: string | null = null;
    if (dto.payload !== undefined && dto.payload !== null) {
      payloadStr = typeof dto.payload === 'string' ? dto.payload : JSON.stringify(dto.payload);
    }

    await this.db.run(
      `INSERT INTO _cron_schedules (
        id, name, targetType, targetId, cronExpression, timezone, missedRunPolicy,
        payload, isSystemBound, enabled, nextRunAt, lastRunAt, lastStatus, lastError,
        leaseOwner, leaseExpiresAt, claimToken, maxRetries, autoPauseAfterFailures,
        consecutiveFailures, expiresAt, keepLast, created, updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, 0, ?, ?, ?, ?)`,
      id,
      dto.name.trim(),
      dto.targetType,
      dto.targetId.trim(),
      dto.cronExpression.trim(),
      tz,
      missedPolicy,
      payloadStr,
      isSystemBound,
      enabled ? 1 : 0,
      nextRunAt,
      maxRetries,
      autoPauseAfterFailures,
      expiresAt,
      keepLast,
      nowIso,
      nowIso
    );

    this.scheduleNextWake();

    const created = await this.getSchedule(id);
    if (!created) {
      throw new AppError('Failed to create schedule', 500);
    }
    return created;
  }

  public async getSchedule(id: string): Promise<CronSchedule | null> {
    if (!this.tablesEnsured && this.isDbAvailable()) {
      await this.ensureTables();
    }
    const row = await this.db.get<any>('SELECT * FROM _cron_schedules WHERE id = ?', id);
    return row ? this.mapRowToSchedule(row) : null;
  }

  public async getAllSchedules(filter?: {
    targetType?: CronTargetType;
    enabled?: boolean;
    targetId?: string;
  }): Promise<CronSchedule[]> {
    if (!this.tablesEnsured && this.isDbAvailable()) {
      await this.ensureTables();
    }
    let sql = 'SELECT * FROM _cron_schedules WHERE 1=1';
    const params: any[] = [];

    if (filter?.targetType) {
      sql += ' AND targetType = ?';
      params.push(filter.targetType);
    }
    if (filter?.enabled !== undefined) {
      sql += ' AND enabled = ?';
      params.push(filter.enabled ? 1 : 0);
    }
    if (filter?.targetId) {
      sql += ' AND targetId = ?';
      params.push(filter.targetId);
    }

    sql += ' ORDER BY created DESC';
    const rows = await this.db.all<any>(sql, ...params);
    return (rows || []).map((r: any) => this.mapRowToSchedule(r));
  }

  public async updateSchedule(id: string, dto: UpdateCronScheduleDto, actor?: any): Promise<CronSchedule> {
    const existing = await this.getSchedule(id);
    if (!existing) {
      throw new NotFoundError(`Schedule '${id}' not found`);
    }

    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    if (!name) {
      throw new ValidationError('Schedule name cannot be empty');
    }

    if (dto.targetType !== undefined) {
      if (!dto.targetType || !['function', 'flow', 'snapshot'].includes(dto.targetType)) {
        throw new ValidationError("Valid targetType ('function', 'flow', 'snapshot') is required");
      }
    }
    const targetType = dto.targetType || existing.targetType;

    if (dto.targetId !== undefined) {
      if (!dto.targetId || !dto.targetId.trim()) {
        throw new ValidationError('targetId is required and cannot be empty');
      }
    }
    const targetId = dto.targetId !== undefined ? dto.targetId.trim() : existing.targetId;
    const enabled = dto.enabled !== undefined ? dto.enabled : existing.enabled;

    if (targetType === 'snapshot') {
      if (this.snapshotService && !this.snapshotService.isSupported() && enabled) {
        const providerName = this.db.dialect.name === 'sqlite' ? 'SQLite' : (this.db.dialect.name === 'postgres' ? 'PostgreSQL' : 'SQL Server');
        throw new AppError(`Scheduled snapshots are exclusive to embedded SQLite applications and cannot be enabled on ${providerName}`, 400);
      }
    }

    const tz = dto.timezone !== undefined ? dto.timezone.trim() : existing.timezone;
    const cronExpr = dto.cronExpression !== undefined ? dto.cronExpression.trim() : existing.cronExpression;

    const validation = CronParser.validate(cronExpr, tz);
    if (!validation.valid) {
      throw new ValidationError(validation.error || 'Invalid cron expression');
    }

    if (dto.missedRunPolicy !== undefined) {
      if (!['skip', 'catch_up_once', 'catch_up_all'].includes(dto.missedRunPolicy)) {
        throw new ValidationError(`Invalid missedRunPolicy '${dto.missedRunPolicy}'`);
      }
    }
    const missedPolicy = dto.missedRunPolicy || existing.missedRunPolicy;

    let maxRetries = existing.maxRetries || 0;
    if (dto.maxRetries !== undefined) {
      maxRetries = Number(dto.maxRetries);
      if (isNaN(maxRetries) || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
        throw new ValidationError('maxRetries must be an integer between 0 and 5');
      }
    }

    let autoPauseAfterFailures = existing.autoPauseAfterFailures || 0;
    if (dto.autoPauseAfterFailures !== undefined) {
      autoPauseAfterFailures = Number(dto.autoPauseAfterFailures);
      if (isNaN(autoPauseAfterFailures) || !Number.isInteger(autoPauseAfterFailures) || autoPauseAfterFailures < 0 || autoPauseAfterFailures > 50) {
        throw new ValidationError('autoPauseAfterFailures must be an integer between 0 and 50');
      }
    }

    let expiresAt = existing.expiresAt;
    if (dto.expiresAt !== undefined) {
      if (dto.expiresAt === null || String(dto.expiresAt).trim() === '') {
        expiresAt = null;
      } else {
        const expDate = new Date(dto.expiresAt);
        if (isNaN(expDate.getTime())) {
          throw new ValidationError('expiresAt must be a valid ISO 8601 date string');
        }
        expiresAt = expDate.toISOString();
      }
    }

    let keepLast = existing.keepLast;
    if (dto.keepLast !== undefined) {
      if (dto.keepLast === null || String(dto.keepLast).trim() === '') {
        keepLast = null;
      } else {
        keepLast = Number(dto.keepLast);
        if (isNaN(keepLast) || !Number.isInteger(keepLast) || keepLast < 1 || keepLast > 1000) {
          throw new ValidationError('keepLast must be a positive integer between 1 and 1000');
        }
        if (targetType !== 'snapshot') {
          throw new ValidationError('keepLast retention is only applicable to snapshot schedules');
        }
      }
    }

    let consecutiveFailures = existing.consecutiveFailures || 0;
    if (dto.enabled === true && !existing.enabled) {
      consecutiveFailures = 0;
    }

    let payloadStr: string | null = null;
    if (dto.payload !== undefined) {
      payloadStr = dto.payload !== null ? (typeof dto.payload === 'string' ? dto.payload : JSON.stringify(dto.payload)) : null;
    } else if (existing.payload !== undefined && existing.payload !== null) {
      payloadStr = typeof existing.payload === 'string' ? existing.payload : JSON.stringify(existing.payload);
    }

    const now = new Date();
    const nowIso = now.toISOString();

    let nextRunAt: string | null = existing.nextRunAt;
    if (enabled && (dto.cronExpression !== undefined || dto.timezone !== undefined || !existing.enabled)) {
      const nextDate = this.getNextOccurrence(cronExpr, tz, now);
      if (expiresAt && nextDate && nextDate.getTime() > new Date(expiresAt).getTime()) {
        nextRunAt = null;
      } else {
        nextRunAt = nextDate ? nextDate.toISOString() : null;
      }
    } else if (!enabled) {
      nextRunAt = null;
    }

    await this.db.run(
      `UPDATE _cron_schedules SET
        name = ?, targetType = ?, targetId = ?, cronExpression = ?, timezone = ?,
        missedRunPolicy = ?, payload = ?, enabled = ?, nextRunAt = ?,
        maxRetries = ?, autoPauseAfterFailures = ?, consecutiveFailures = ?,
        expiresAt = ?, keepLast = ?, updated = ?
      WHERE id = ?`,
      name,
      targetType,
      targetId,
      cronExpr,
      tz,
      missedPolicy,
      payloadStr,
      enabled ? 1 : 0,
      nextRunAt,
      maxRetries,
      autoPauseAfterFailures,
      consecutiveFailures,
      expiresAt,
      keepLast,
      nowIso,
      id
    );

    // Bidirectional sync for system-bound inline schedules:
    if (existing.isSystemBound) {
      try {
        if (targetType === 'function') {
          const fnCronExpr = enabled ? cronExpr : null;
          await this.db.run(
            `UPDATE _functions SET
              cronSchedule = ?, cronTimezone = ?, cronMissedPolicy = ?, cronPayload = ?, updated = ?
             WHERE id = ?`,
            fnCronExpr,
            tz,
            missedPolicy,
            payloadStr,
            nowIso,
            targetId
          );
        } else if (targetType === 'flow') {
          const flowCronExpr = enabled ? cronExpr : null;
          const flowTriggerType = enabled ? 'cron' : 'manual';
          await this.db.run(
            `UPDATE _flows SET
              triggerType = ?, cronSchedule = ?, cronTimezone = ?, cronMissedPolicy = ?, cronInput = ?, updated = ?
             WHERE id = ?`,
            flowTriggerType,
            flowCronExpr,
            tz,
            missedPolicy,
            payloadStr,
            nowIso,
            targetId
          );
        }
      } catch (syncErr) {
        console.warn(`[CronService] Failed to sync bound schedule '${id}' to ${targetType}:`, syncErr);
      }
    }

    this.scheduleNextWake();

    const updated = await this.getSchedule(id);
    return updated!;
  }

  public deleteSchedule(id: string, actor?: any): any {
    const row = this.db.get<any>('SELECT * FROM _cron_schedules WHERE id = ?', id);
    if (row instanceof Promise) {
      return row.then((r) => {
        if (!r) return false;
        return this.finishDeleteSchedule(id, r);
      });
    }
    if (!row) {
      return false;
    }
    return this.finishDeleteSchedule(id, row);
  }

  private finishDeleteSchedule(id: string, existing?: any): any {
    const promises: Promise<any>[] = [];

    // If deleting a system-bound schedule, clear cron on the parent function / flow
    if (existing && (existing.isSystemBound || id.startsWith('inline_fn_') || id.startsWith('inline_flow_'))) {
      const nowIso = new Date().toISOString();
      if (existing.targetType === 'function') {
        const pFn = this.db.run(
          'UPDATE _functions SET cronSchedule = NULL, updated = ? WHERE id = ?',
          nowIso,
          existing.targetId
        );
        if (pFn instanceof Promise) promises.push(pFn);
      } else if (existing.targetType === 'flow') {
        const pFlow = this.db.run(
          "UPDATE _flows SET triggerType = 'manual', cronSchedule = NULL, updated = ? WHERE id = ?",
          nowIso,
          existing.targetId
        );
        if (pFlow instanceof Promise) promises.push(pFlow);
      }
    }

    const del1 = this.db.run('DELETE FROM _cron_runs WHERE scheduleId = ?', id);
    const del2 = this.db.run('DELETE FROM _cron_schedules WHERE id = ?', id);
    this.scheduleNextWake();

    if (del1 instanceof Promise) promises.push(del1);
    if (del2 instanceof Promise) promises.push(del2);

    if (promises.length > 0) {
      return Promise.all(promises).then((results) => {
        const last = results[results.length - 1];
        return Number((last as any)?.changes || 0) > 0;
      });
    }
    return Number((del2 as any)?.changes || 0) > 0;
  }

  // ==========================================
  // Target Synchronization (Inline 1:1 bindings)
  // ==========================================

  public syncFunctionSchedule(fn: FunctionConfig): any {
    const scheduleId = `inline_fn_${fn.id}`;
    const row = this.db.get<any>('SELECT * FROM _cron_schedules WHERE id = ?', scheduleId);
    if (row instanceof Promise) {
      return row.then((r) => this.finishSyncFunctionSchedule(fn, scheduleId, r ? this.mapRowToSchedule(r) : null));
    }
    return this.finishSyncFunctionSchedule(fn, scheduleId, row ? this.mapRowToSchedule(row) : null);
  }

  private finishSyncFunctionSchedule(fn: FunctionConfig, scheduleId: string, existing: CronSchedule | null): any {
    if (fn.cronSchedule && fn.cronSchedule.trim() && fn.enabled) {
      const tz = fn.cronTimezone?.trim() || 'UTC';
      const missedPolicy: MissedRunPolicy = fn.cronMissedPolicy || 'skip';
      const now = new Date();
      const nextDate = this.getNextOccurrence(fn.cronSchedule.trim(), tz, now);
      const nextRunAt = nextDate ? nextDate.toISOString() : null;
      const payloadStr = fn.cronPayload ? JSON.stringify(fn.cronPayload) : null;
      const nowIso = now.toISOString();

      let runRes: any;
      if (existing) {
        runRes = this.db.run(
          `UPDATE _cron_schedules SET
            name = ?, cronExpression = ?, timezone = ?, missedRunPolicy = ?,
            payload = ?, enabled = 1, nextRunAt = ?, updated = ?
           WHERE id = ?`,
          `Function: ${fn.name}`,
          fn.cronSchedule.trim(),
          tz,
          missedPolicy,
          payloadStr,
          nextRunAt,
          nowIso,
          scheduleId
        );
      } else {
        runRes = this.db.run(
          `INSERT INTO _cron_schedules (
            id, name, targetType, targetId, cronExpression, timezone, missedRunPolicy,
            payload, isSystemBound, enabled, nextRunAt, lastRunAt, lastStatus, lastError,
            leaseOwner, leaseExpiresAt, claimToken, created, updated
          ) VALUES (?, ?, 'function', ?, ?, ?, ?, ?, 1, 1, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
          scheduleId,
          `Function: ${fn.name}`,
          fn.id,
          fn.cronSchedule.trim(),
          tz,
          missedPolicy,
          payloadStr,
          nextRunAt,
          nowIso,
          nowIso
        );
      }
      this.scheduleNextWake();
      if (runRes instanceof Promise) {
        return runRes.then(() => {});
      }
      return;
    } else {
      if (existing) {
        return this.deleteSchedule(scheduleId);
      }
    }
  }

  public syncFlowSchedule(flow: FlowConfig): any {
    const scheduleId = `inline_flow_${flow.id}`;
    const row = this.db.get<any>('SELECT * FROM _cron_schedules WHERE id = ?', scheduleId);
    if (row instanceof Promise) {
      return row.then((r) => this.finishSyncFlowSchedule(flow, scheduleId, r ? this.mapRowToSchedule(r) : null));
    }
    return this.finishSyncFlowSchedule(flow, scheduleId, row ? this.mapRowToSchedule(row) : null);
  }

  private finishSyncFlowSchedule(flow: FlowConfig, scheduleId: string, existing: CronSchedule | null): any {
    if (flow.triggerType === 'cron' && flow.cronSchedule && flow.cronSchedule.trim() && flow.enabled) {
      const tz = flow.cronTimezone?.trim() || 'UTC';
      const missedPolicy: MissedRunPolicy = flow.cronMissedPolicy || 'skip';
      const now = new Date();
      const nextDate = this.getNextOccurrence(flow.cronSchedule.trim(), tz, now);
      const nextRunAt = nextDate ? nextDate.toISOString() : null;
      const payloadStr = flow.cronInput ? JSON.stringify(flow.cronInput) : null;
      const nowIso = now.toISOString();

      let runRes: any;
      if (existing) {
        runRes = this.db.run(
          `UPDATE _cron_schedules SET
            name = ?, cronExpression = ?, timezone = ?, missedRunPolicy = ?,
            payload = ?, enabled = 1, nextRunAt = ?, updated = ?
           WHERE id = ?`,
          `Flow: ${flow.name}`,
          flow.cronSchedule.trim(),
          tz,
          missedPolicy,
          payloadStr,
          nextRunAt,
          nowIso,
          scheduleId
        );
      } else {
        runRes = this.db.run(
          `INSERT INTO _cron_schedules (
            id, name, targetType, targetId, cronExpression, timezone, missedRunPolicy,
            payload, isSystemBound, enabled, nextRunAt, lastRunAt, lastStatus, lastError,
            leaseOwner, leaseExpiresAt, claimToken, created, updated
          ) VALUES (?, ?, 'flow', ?, ?, ?, ?, ?, 1, 1, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
          scheduleId,
          `Flow: ${flow.name}`,
          flow.id,
          flow.cronSchedule.trim(),
          tz,
          missedPolicy,
          payloadStr,
          nextRunAt,
          nowIso,
          nowIso
        );
      }
      this.scheduleNextWake();
      if (runRes instanceof Promise) {
        return runRes.then(() => {});
      }
      return;
    } else {
      if (existing) {
        return this.deleteSchedule(scheduleId);
      }
    }
  }

  public removeTargetSchedules(targetType: CronTargetType, targetId: string): any {
    const rows = this.db.all<any>(
      'SELECT id FROM _cron_schedules WHERE targetType = ? AND targetId = ?',
      targetType,
      targetId
    );
    if (rows instanceof Promise) {
      return rows.then(async (rList) => {
        for (const s of rList || []) {
          await this.deleteSchedule(s.id);
        }
      });
    }
    for (const s of rows || []) {
      const d = this.deleteSchedule(s.id);
      if (d instanceof Promise) void d.catch(() => {});
    }
  }

  // ==========================================
  // Immediate Trigger & Run History
  // ==========================================

  public async triggerSchedule(id: string, actor?: any): Promise<CronRunLog> {
    const schedule = await this.getSchedule(id);
    if (!schedule) {
      throw new NotFoundError(`Schedule '${id}' not found`);
    }

    const runId = randomUUID();
    const scheduledAt = new Date();
    return await this.executeTarget(schedule, scheduledAt, false, runId);
  }

  public async getRuns(options: CronListRunsOptions = {}): Promise<{
    items: CronRunLog[];
    total: number;
    page: number;
    perPage: number;
  }> {
    if (!this.tablesEnsured && this.isDbAvailable()) {
      await this.ensureTables();
    }
    const page = Math.max(1, options.page || 1);
    const perPage = Math.max(1, Math.min(options.perPage || 30, 100));
    const offset = (page - 1) * perPage;

    let whereSql = 'WHERE 1=1';
    const params: any[] = [];

    if (options.scheduleId) {
      whereSql += ' AND scheduleId = ?';
      params.push(options.scheduleId);
    }
    if (options.targetType) {
      whereSql += ' AND targetType = ?';
      params.push(options.targetType);
    }
    if (options.status) {
      whereSql += ' AND status = ?';
      params.push(options.status);
    }

    const countRow = await this.db.get<any>(`SELECT COUNT(*) as total FROM _cron_runs ${whereSql}`, ...params);
    const total = Number(countRow?.total || 0);

    const querySql = `SELECT * FROM _cron_runs ${whereSql} ORDER BY startedAt DESC LIMIT ? OFFSET ?`;
    const rows = await this.db.all<any>(querySql, ...params, perPage, offset);
    const items = (rows || []).map((r: any) => this.mapRowToRun(r));

    return { items, total, page, perPage };
  }

  public async clearRuns(scheduleId?: string): Promise<number> {
    let res: any;
    if (scheduleId) {
      res = await this.db.run('DELETE FROM _cron_runs WHERE scheduleId = ?', scheduleId);
    } else {
      res = await this.db.run('DELETE FROM _cron_runs');
    }
    return Number(res?.changes || 0);
  }

  public async getStats(): Promise<CronStats> {
    if (!this.tablesEnsured && this.isDbAvailable()) {
      await this.ensureTables();
    }
    const totalSchedulesRow = await this.db.get<any>('SELECT COUNT(*) as cnt FROM _cron_schedules');
    const activeSchedulesRow = await this.db.get<any>('SELECT COUNT(*) as cnt FROM _cron_schedules WHERE enabled = 1');
    const totalRunsRow = await this.db.get<any>('SELECT COUNT(*) as cnt FROM _cron_runs');
    const successRunsRow = await this.db.get<any>("SELECT COUNT(*) as cnt FROM _cron_runs WHERE status = 'succeeded'");
    const failedRunsRow = await this.db.get<any>("SELECT COUNT(*) as cnt FROM _cron_runs WHERE status = 'failed'");
    const skippedRunsRow = await this.db.get<any>("SELECT COUNT(*) as cnt FROM _cron_runs WHERE status = 'skipped'");

    const fnSchedulesRow = await this.db.get<any>("SELECT COUNT(*) as cnt FROM _cron_schedules WHERE targetType = 'function'");
    const flowSchedulesRow = await this.db.get<any>("SELECT COUNT(*) as cnt FROM _cron_schedules WHERE targetType = 'flow'");
    const snapSchedulesRow = await this.db.get<any>("SELECT COUNT(*) as cnt FROM _cron_schedules WHERE targetType = 'snapshot'");

    return {
      totalSchedules: Number(totalSchedulesRow?.cnt || 0),
      activeSchedules: Number(activeSchedulesRow?.cnt || 0),
      totalRuns: Number(totalRunsRow?.cnt || 0),
      successfulRuns: Number(successRunsRow?.cnt || 0),
      failedRuns: Number(failedRunsRow?.cnt || 0),
      skippedRuns: Number(skippedRunsRow?.cnt || 0),
      byTarget: {
        function: Number(fnSchedulesRow?.cnt || 0),
        flow: Number(flowSchedulesRow?.cnt || 0),
        snapshot: Number(snapSchedulesRow?.cnt || 0),
      },
    };
  }

  public preview(cronExpression: string, timezone = 'UTC', count = 5): CronPreviewResult {
    return CronParser.preview(cronExpression, timezone, count);
  }

  // ==========================================
  // Scheduler Engine Loop & Leases
  // ==========================================

  private scheduleNextWake(): void {
    if (this.isDisposed || !this.isDbAvailable()) return;

    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }

    void (async () => {
      try {
        const row = await this.db.get<any>(
          'SELECT nextRunAt FROM _cron_schedules WHERE enabled = 1 AND nextRunAt IS NOT NULL ORDER BY nextRunAt ASC LIMIT 1'
        );

        let delayMs = 15_000;
        if (row && row.nextRunAt) {
          const nextTime = new Date(row.nextRunAt).getTime();
          const now = Date.now();
          delayMs = Math.min(Math.max(50, nextTime - now), 15_000);
        }

        if (!this.isDisposed) {
          this.loopTimer = setTimeout(() => {
            void this.tick();
          }, delayMs);
        }
      } catch {
        if (!this.isDisposed) {
          this.loopTimer = setTimeout(() => {
            void this.tick();
          }, 15_000);
        }
      }
    })();
  }

  public async tick(): Promise<void> {
    if (this.isTicking || this.isDisposed || !this.isDbAvailable()) return;
    this.isTicking = true;

    try {
      const now = new Date();
      const nowIso = now.toISOString();

      // 1. Reclaim any expired leases
      await this.cleanStaleLeases();

      // 2. Select due schedules (with a safety batch cap of 50)
      const dueSchedules = await this.db.all<any>(
        'SELECT * FROM _cron_schedules WHERE enabled = 1 AND nextRunAt IS NOT NULL AND nextRunAt <= ? ORDER BY nextRunAt ASC LIMIT 50',
        nowIso
      );

      const claimed: Array<{ schedule: CronSchedule; claimToken: string }> = [];

      for (const row of dueSchedules || []) {
        if (this.isDisposed) break;
        const schedule = this.mapRowToSchedule(row);

        // Check if schedule has already expired
        if (schedule.expiresAt && new Date(schedule.expiresAt).getTime() <= now.getTime()) {
          await this.db.run(
            `UPDATE _cron_schedules
             SET enabled = 0, nextRunAt = NULL, lastError = 'Schedule expired',
                 leaseOwner = NULL, leaseExpiresAt = NULL, claimToken = NULL
             WHERE id = ?`,
            schedule.id
          );
          if (this.eventBus) {
            try {
              this.eventBus.emit('cron:expired', { scheduleId: schedule.id, scheduleName: schedule.name });
            } catch {}
          }
          continue;
        }

        const claimToken = randomUUID();
        const leaseExpiry = new Date(Date.now() + 60_000).toISOString();

        // Atomic CAS lease acquisition
        const leaseRes = await this.db.run(
          `UPDATE _cron_schedules
           SET leaseOwner = ?, leaseExpiresAt = ?, claimToken = ?
           WHERE id = ? AND nextRunAt = ? AND (leaseExpiresAt IS NULL OR leaseExpiresAt <= ?)`,
          this.instanceId,
          leaseExpiry,
          claimToken,
          schedule.id,
          schedule.nextRunAt,
          nowIso
        );

        const acquired = Number(leaseRes?.changes || 0) > 0;
        if (!acquired) {
          continue; // Another instance claimed this schedule or nextRunAt changed
        }

        claimed.push({ schedule, claimToken });
      }

      // 3. Dispatch claimed schedules concurrently up to MAX_CONCURRENT (10 workers)
      const MAX_CONCURRENT = 10;
      let cursor = 0;
      const worker = async () => {
        while (cursor < claimed.length && !this.isDisposed) {
          const item = claimed[cursor++];
          if (!item) break;
          try {
            await this.processDueSchedule(item.schedule, now, item.claimToken);
          } catch (err) {
            // Guarded inside processDueSchedule
          }
        }
      };

      const workerCount = Math.min(MAX_CONCURRENT, claimed.length);
      if (workerCount > 0) {
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
      }
    } catch (err) {
      // Loop tick error
    } finally {
      this.isTicking = false;
      this.scheduleNextWake();
    }
  }

  private async advanceNextRun(
    schedule: CronSchedule,
    nextOccurrence: Date | null,
    claimToken: string,
    lastRunAtIso?: string,
    lastStatus?: CronRunStatus,
    lastError?: string | null
  ): Promise<void> {
    const current = await this.getSchedule(schedule.id);
    if (!current || !current.enabled) {
      // Auto-paused by circuit breaker or disabled during execution
      await this.db.run(
        `UPDATE _cron_schedules
         SET nextRunAt = NULL, leaseOwner = NULL, leaseExpiresAt = NULL, claimToken = NULL
         WHERE id = ? AND claimToken = ?`,
        schedule.id,
        claimToken
      );
      return;
    }

    let isExpired = false;
    let nextRunAt: string | null = null;

    if (nextOccurrence) {
      if (schedule.expiresAt && nextOccurrence.getTime() > new Date(schedule.expiresAt).getTime()) {
        isExpired = true;
      } else {
        nextRunAt = nextOccurrence.toISOString();
      }
    }

    if (isExpired) {
      await this.db.run(
        `UPDATE _cron_schedules
         SET enabled = 0, nextRunAt = NULL, lastError = 'Schedule expired',
             leaseOwner = NULL, leaseExpiresAt = NULL, claimToken = NULL
         WHERE id = ? AND claimToken = ?`,
        schedule.id,
        claimToken
      );
      if (this.eventBus) {
        try {
          this.eventBus.emit('cron:expired', { scheduleId: schedule.id, scheduleName: schedule.name });
        } catch {}
      }
      return;
    }

    if (lastRunAtIso && lastStatus) {
      await this.db.run(
        `UPDATE _cron_schedules
         SET lastRunAt = ?, lastStatus = ?, lastError = ?,
             nextRunAt = ?, leaseOwner = NULL, leaseExpiresAt = NULL, claimToken = NULL
         WHERE id = ? AND claimToken = ?`,
        lastRunAtIso,
        lastStatus,
        lastError || null,
        nextRunAt,
        schedule.id,
        claimToken
      );
    } else {
      await this.db.run(
        `UPDATE _cron_schedules
         SET nextRunAt = ?, leaseOwner = NULL, leaseExpiresAt = NULL, claimToken = NULL
         WHERE id = ? AND claimToken = ?`,
        nextRunAt,
        schedule.id,
        claimToken
      );
    }
  }

  private async processDueSchedule(
    schedule: CronSchedule,
    now: Date,
    claimToken: string
  ): Promise<void> {
    try {
      const scheduledTime = schedule.nextRunAt ? new Date(schedule.nextRunAt).getTime() : now.getTime();
      const diffMs = now.getTime() - scheduledTime;
      const nowIso = now.toISOString();

      // Check 60-second misfire window
      if (diffMs > 60_000) {
        if (schedule.missedRunPolicy === 'skip') {
          // Record skipped run log
          const runId = randomUUID();
          await this.db.run(
            `INSERT INTO _cron_runs (
              id, scheduleId, scheduleName, targetType, targetId, scheduledAt, startedAt,
              finishedAt, durationMs, status, isCatchUp, attempt, executionRefId, output, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'skipped', 0, 1, NULL, NULL, ?)`,
            runId,
            schedule.id,
            schedule.name,
            schedule.targetType,
            schedule.targetId,
            schedule.nextRunAt || nowIso,
            nowIso,
            nowIso,
            'Missed schedule window (>60s) - skipped per policy'
          );

          // Advance to next future occurrence after now
          const nextFuture = this.getNextOccurrence(schedule.cronExpression, schedule.timezone, now);
          await this.advanceNextRun(schedule, nextFuture, claimToken, nowIso, 'skipped', 'Skipped missed window');
          return;
        }

        if (schedule.missedRunPolicy === 'catch_up_once') {
          // Run once with catch-up flag
          await this.executeTarget(schedule, new Date(scheduledTime), true, claimToken);

          // Advance nextRunAt to next future occurrence after now
          const nextFuture = this.getNextOccurrence(schedule.cronExpression, schedule.timezone, now);
          await this.advanceNextRun(schedule, nextFuture, claimToken);
          return;
        }

        if (schedule.missedRunPolicy === 'catch_up_all') {
          // Sequentially catch up missed slots capped at 10 runs
          const catchUpSlots: Date[] = [new Date(scheduledTime)];
          let cursor = new Date(scheduledTime + 1000);

          while (catchUpSlots.length < 10) {
            const next = this.getNextOccurrence(schedule.cronExpression, schedule.timezone, cursor);
            if (!next || next.getTime() > now.getTime()) break;
            catchUpSlots.push(next);
            cursor = new Date(next.getTime() + 1000);
          }

          for (const slot of catchUpSlots) {
            await this.executeTarget(schedule, slot, true, claimToken);
          }

          // Advance nextRunAt to next future occurrence after now
          const nextFuture = this.getNextOccurrence(schedule.cronExpression, schedule.timezone, now);
          await this.advanceNextRun(schedule, nextFuture, claimToken);
          return;
        }
      }

      // Normal on-time execution (diffMs <= 60_000)
      await this.executeTarget(schedule, new Date(scheduledTime), false, claimToken);

      // Compute next future occurrence starting 1 second after the scheduled time
      const nextFuture = this.getNextOccurrence(
        schedule.cronExpression,
        schedule.timezone,
        new Date(scheduledTime + 1000)
      );
      await this.advanceNextRun(schedule, nextFuture, claimToken);
    } catch (err: any) {
      // Emergency lease release and error logging if an unexpected failure occurs
      try {
        const nextFuture = this.getNextOccurrence(schedule.cronExpression, schedule.timezone, new Date(Date.now() + 1000));
        await this.advanceNextRun(schedule, nextFuture, claimToken, undefined, 'failed', err?.message || 'Unexpected execution failure');
      } catch {}
    }
  }

  private async executeTarget(
    schedule: CronSchedule,
    scheduledAt: Date,
    isCatchUp: boolean,
    claimToken: string
  ): Promise<CronRunLog> {
    const runId = randomUUID();
    const startedAt = new Date();
    const startedAtIso = startedAt.toISOString();
    const scheduledAtIso = scheduledAt.toISOString();

    // Insert 'running' run record
    await this.db.run(
      `INSERT INTO _cron_runs (
        id, scheduleId, scheduleName, targetType, targetId, scheduledAt, startedAt,
        finishedAt, durationMs, status, isCatchUp, attempt, executionRefId, output, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 'running', ?, 1, NULL, NULL, NULL)`,
      runId,
      schedule.id,
      schedule.name,
      schedule.targetType,
      schedule.targetId,
      scheduledAtIso,
      startedAtIso,
      isCatchUp ? 1 : 0
    );

    // Active lease renewal ticker (every 15s)
    const renewalTimer = setInterval(() => {
      if (this.isDisposed) {
        clearInterval(renewalTimer);
        return;
      }
      const newExpiry = new Date(Date.now() + 60_000).toISOString();
      void this.db.run(
        'UPDATE _cron_schedules SET leaseExpiresAt = ? WHERE id = ? AND claimToken = ?',
        newExpiry,
        schedule.id,
        claimToken
      );
    }, 15_000);
    this.activeRenewals.set(runId, renewalTimer);

    let status: CronRunStatus = 'succeeded';
    let output: string | null = null;
    let error: string | null = null;
    let executionRefId: string | null = null;

    const maxRetries = Math.max(0, Math.min(schedule.maxRetries || 0, 5));
    const totalAttempts = 1 + maxRetries;
    let attemptNumber = 1;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      attemptNumber = attempt;
      status = 'succeeded';
      error = null;
      output = null;
      executionRefId = null;

      try {
        if (schedule.targetType === 'function') {
          if (!this.functionService) {
            throw new Error('FunctionService not available');
          }
          const cronCtx: FunctionCronContext = {
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            cronExpression: schedule.cronExpression,
            timezone: schedule.timezone,
            scheduledAt: scheduledAtIso,
            triggeredAt: startedAtIso,
            isCatchUp,
          };
          const fnResult = await this.functionService.executeScheduledFunction(
            schedule.targetId,
            cronCtx,
            schedule.payload
          );
          if (fnResult.status !== 'success' || fnResult.statusCode >= 400) {
            status = 'failed';
            error = fnResult.error || `Function returned status ${fnResult.statusCode}`;
          }
          output = fnResult.body !== undefined ? JSON.stringify(fnResult.body) : null;
        } else if (schedule.targetType === 'flow') {
          if (!this.flowService) {
            throw new Error('FlowService not available');
          }
          const flowResult = await this.flowService.executeFlow(
            schedule.targetId,
            schedule.payload || {},
            { id: `cron:${schedule.id}`, isAdmin: true },
            { wait: true, trusted: true }
          );
          executionRefId = flowResult?.id || null;
          if (flowResult && flowResult.status !== 'succeeded') {
            status = 'failed';
            error = flowResult.error || `Flow execution ended with status '${flowResult.status}'`;
          }
          output = flowResult?.output !== undefined ? JSON.stringify(flowResult.output) : null;
        } else if (schedule.targetType === 'snapshot') {
          if (!this.snapshotService) {
            throw new Error('SnapshotService not available');
          }
          if (!this.snapshotService.isSupported()) {
            const providerName = this.db.dialect.name === 'sqlite' ? 'SQLite' : (this.db.dialect.name === 'postgres' ? 'PostgreSQL' : 'SQL Server');
            const errorMsg = `Scheduled snapshots are exclusive to embedded SQLite applications and are paused on ${providerName}.`;
            await this.db.run(
              'UPDATE _cron_schedules SET enabled = 0, lastStatus = ?, lastError = ? WHERE id = ?',
              'failed',
              errorMsg,
              schedule.id
            );
            throw new AppError(errorMsg, 400);
          }
          const cleanName = `cron-${schedule.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-${Date.now()}`;
          const snap = await this.snapshotService.createSnapshot({
            name: cleanName,
            evictOldest: true,
          });
          executionRefId = snap.id;
          output = JSON.stringify({ snapshotId: snap.id, name: snap.name, size: snap.size });

          // Rolling Snapshot Retention: keepLast
          if (schedule.keepLast && schedule.keepLast > 0) {
            try {
              const prefix = `cron-${schedule.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-`;
              const allSnaps = await this.snapshotService.listSnapshots();
              const matchingSnaps = (allSnaps || [])
                .filter((s: any) => s.name && s.name.startsWith(prefix))
                .sort((a: any, b: any) => new Date(b.created || b.createdAt || 0).getTime() - new Date(a.created || a.createdAt || 0).getTime());

              if (matchingSnaps.length > schedule.keepLast) {
                const toPrune = matchingSnaps.slice(schedule.keepLast);
                for (const oldSnap of toPrune) {
                  try {
                    await this.snapshotService.deleteSnapshot(oldSnap.id);
                  } catch {}
                }
              }
            } catch (pruneErr) {
              console.warn(`[CronService] Failed to prune snapshot retention for '${schedule.id}':`, pruneErr);
            }
          }
        } else {
          status = 'failed';
          error = `Unsupported targetType '${schedule.targetType}'`;
        }
      } catch (err: any) {
        status = 'failed';
        error = err?.message || String(err);
      }

      if (status === 'succeeded') {
        break;
      }

      // If we failed and have retries remaining, wait with backoff
      if (attempt < totalAttempts && !this.isDisposed) {
        const backoffMs = Math.min(300 * Math.pow(2, attempt - 1), 3000);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    try {
      clearInterval(renewalTimer);
      this.activeRenewals.delete(runId);
    } catch {}

    const finishedAt = new Date();
    const finishedAtIso = finishedAt.toISOString();
    const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

    // Circuit breaker & consecutive failures handling
    let consecutiveFailures = schedule.consecutiveFailures || 0;
    let autoPaused = false;
    let scheduleEnabled = schedule.enabled;
    let scheduleError = error;

    if (status === 'succeeded') {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;
      const pauseThreshold = schedule.autoPauseAfterFailures || 0;
      if (pauseThreshold > 0 && consecutiveFailures >= pauseThreshold) {
        autoPaused = true;
        scheduleEnabled = false;
        scheduleError = `Auto-paused: reached ${pauseThreshold} consecutive failures (${error || 'Unknown error'})`;
        if (this.eventBus) {
          try {
            this.eventBus.emit('cron:autopause', {
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              consecutiveFailures,
              error: scheduleError,
            });
          } catch {}
        }
      }
    }

    // Update run record
    await this.db.run(
      `UPDATE _cron_runs
       SET finishedAt = ?, durationMs = ?, status = ?, isCatchUp = ?, attempt = ?, executionRefId = ?, output = ?, error = ?
       WHERE id = ?`,
      finishedAtIso,
      durationMs,
      status,
      isCatchUp ? 1 : 0,
      attemptNumber,
      executionRefId,
      output,
      error,
      runId
    );

    // Update schedule stats & failure counter
    await this.db.run(
      `UPDATE _cron_schedules
       SET lastRunAt = ?, lastStatus = ?, lastError = ?, consecutiveFailures = ?, enabled = ?
       WHERE id = ?`,
      startedAtIso,
      status,
      scheduleError,
      consecutiveFailures,
      scheduleEnabled ? 1 : 0,
      schedule.id
    );

    // Prune run history (keep last 100 runs per schedule)
    try {
      const cutRow = await this.db.get<any>(
        'SELECT startedAt FROM _cron_runs WHERE scheduleId = ? ORDER BY startedAt DESC LIMIT 1 OFFSET 100',
        schedule.id
      );
      if (cutRow && cutRow.startedAt) {
        await this.db.run(
          'DELETE FROM _cron_runs WHERE scheduleId = ? AND startedAt < ?',
          schedule.id,
          cutRow.startedAt
        );
      }
    } catch {}

    const runLog: CronRunLog = {
      id: runId,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      targetType: schedule.targetType,
      targetId: schedule.targetId,
      scheduledAt: scheduledAtIso,
      startedAt: startedAtIso,
      finishedAt: finishedAtIso,
      durationMs,
      status,
      isCatchUp,
      attempt: attemptNumber,
      executionRefId,
      output,
      error,
    };

    if (this.eventBus) {
      try {
        this.eventBus.emit('cron:run', runLog);
      } catch {}
    }

    return runLog;
  }

  // ==========================================
  // Row Mappers
  // ==========================================

  private mapRowToSchedule(row: any): CronSchedule {
    let payload: any = undefined;
    if (row.payload !== null && row.payload !== undefined) {
      if (typeof row.payload === 'string') {
        try {
          payload = JSON.parse(row.payload);
        } catch {
          payload = row.payload;
        }
      } else {
        payload = row.payload;
      }
    }

    return {
      id: String(row.id),
      name: String(row.name),
      targetType: row.targetType as CronTargetType,
      targetId: String(row.targetId),
      cronExpression: String(row.cronExpression),
      humanDescription: CronParser.humanize(String(row.cronExpression)),
      timezone: String(row.timezone || 'UTC'),
      missedRunPolicy: (row.missedRunPolicy || 'skip') as MissedRunPolicy,
      payload,
      isSystemBound: Boolean(row.isSystemBound),
      enabled: Boolean(row.enabled),
      nextRunAt: row.nextRunAt ? String(row.nextRunAt) : null,
      lastRunAt: row.lastRunAt ? String(row.lastRunAt) : null,
      lastStatus: row.lastStatus ? (row.lastStatus as CronRunStatus) : null,
      lastError: row.lastError ? String(row.lastError) : null,
      leaseOwner: row.leaseOwner ? String(row.leaseOwner) : null,
      leaseExpiresAt: row.leaseExpiresAt ? String(row.leaseExpiresAt) : null,
      claimToken: row.claimToken ? String(row.claimToken) : null,
      maxRetries: Number(row.maxRetries || 0),
      autoPauseAfterFailures: Number(row.autoPauseAfterFailures || 0),
      consecutiveFailures: Number(row.consecutiveFailures || 0),
      expiresAt: row.expiresAt ? String(row.expiresAt) : null,
      keepLast: row.keepLast !== null && row.keepLast !== undefined ? Number(row.keepLast) : null,
      created: String(row.created),
      updated: String(row.updated),
    };
  }

  private mapRowToRun(row: any): CronRunLog {
    return {
      id: String(row.id),
      scheduleId: String(row.scheduleId),
      scheduleName: String(row.scheduleName),
      targetType: row.targetType as CronTargetType,
      targetId: String(row.targetId),
      scheduledAt: String(row.scheduledAt),
      startedAt: String(row.startedAt),
      finishedAt: row.finishedAt ? String(row.finishedAt) : null,
      durationMs: Number(row.durationMs || 0),
      status: row.status as CronRunStatus,
      isCatchUp: Boolean(row.isCatchUp),
      attempt: Number(row.attempt || 1),
      executionRefId: row.executionRefId ? String(row.executionRefId) : null,
      output: row.output ? String(row.output) : null,
      error: row.error ? String(row.error) : null,
    };
  }
}
