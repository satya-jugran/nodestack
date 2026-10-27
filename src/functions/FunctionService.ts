import * as crypto from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseService } from '../database/DatabaseService';
import { SchemaService } from '../schema/SchemaService';
import { RecordService } from '../records/RecordService';
import { RuleEngine } from '../rules/RuleEngine';
import { EventBus } from '../core/events/EventBus';
import { SandboxedRunner } from './runtime/SandboxedRunner';
import { SsrfGuard } from './security/SsrfGuard';
import {
  FunctionConfig,
  CreateFunctionDto,
  UpdateFunctionDto,
  FunctionRequestContext,
  FunctionEventContext,
  FunctionContext,
  FunctionExecutionResult,
  FunctionLog,
  FunctionRecordQueryOptions,
  FunctionAuthPolicy,
} from './types';

export const ALLOWED_AUTH_POLICIES: readonly FunctionAuthPolicy[] = ['public', 'auth', 'admin', 'apiKey'] as const;
import { AppError, NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../core/errors/AppError';

export interface FunctionServiceOptions {
  runner?: SandboxedRunner;
  maxConcurrent?: number;
  maxRecursionDepth?: number;
}

export class FunctionService {
  private runner: SandboxedRunner;
  private maxConcurrent: number;
  private maxRecursionDepth: number;
  private activeExecutions = 0;
  private executionStorage = new AsyncLocalStorage<{ depth: number; activeFns: Set<string> }>();

  constructor(
    private db: DatabaseService,
    private schemaService?: SchemaService,
    private recordService?: RecordService,
    private ruleEngine?: RuleEngine,
    private eventBus?: EventBus,
    private appScope: { id: string; slug: string; name?: string } = { id: 'default', slug: 'default' },
    options: FunctionServiceOptions = {}
  ) {
    this.runner = options.runner || new SandboxedRunner();
    this.maxConcurrent = options.maxConcurrent || 15;
    this.maxRecursionDepth = options.maxRecursionDepth || 5;
    this.initTables();
  }

  public getActiveExecutions(): number {
    return this.activeExecutions;
  }

  public getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  public getMaxRecursionDepth(): number {
    return this.maxRecursionDepth;
  }

  public getRunner(): SandboxedRunner {
    return this.runner;
  }

  /**
   * Initializes SQLite tables for functions and execution logs if not already created.
   */
  public initTables(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS _functions (
          id TEXT PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          description TEXT DEFAULT '',
          code TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          authPolicy TEXT NOT NULL DEFAULT 'public',
          methods TEXT NOT NULL DEFAULT 'GET,POST',
          routePath TEXT,
          eventTrigger TEXT,
          timeoutMs INTEGER NOT NULL DEFAULT 1000,
          memoryLimitMb INTEGER NOT NULL DEFAULT 32,
          allowedDomains TEXT NOT NULL DEFAULT '[]',
          elevated INTEGER NOT NULL DEFAULT 0,
          env TEXT NOT NULL DEFAULT '{}',
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_functions_name ON _functions(name);
        CREATE INDEX IF NOT EXISTS idx_functions_eventTrigger ON _functions(eventTrigger);

        CREATE TABLE IF NOT EXISTS _function_logs (
          id TEXT PRIMARY KEY,
          functionId TEXT NOT NULL,
          functionName TEXT NOT NULL,
          trigger TEXT NOT NULL,
          status TEXT NOT NULL,
          statusCode INTEGER NOT NULL,
          durationMs INTEGER NOT NULL,
          requestPayload TEXT,
          responsePayload TEXT,
          logs TEXT,
          error TEXT,
          actorId TEXT,
          timestamp TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_fnlogs_fnId ON _function_logs(functionId);
        CREATE INDEX IF NOT EXISTS idx_fnlogs_timestamp ON _function_logs(timestamp DESC);
      `);
    } catch (err: any) {
      console.warn(`[FunctionService] initTables warning: ${err.message}`);
    }
  }

  // ==========================================
  // Function CRUD
  // ==========================================

  public getAllFunctions(options?: { search?: string; enabled?: boolean }): FunctionConfig[] {
    let sql = 'SELECT * FROM _functions WHERE 1=1';
    const params: any[] = [];

    if (options?.enabled !== undefined) {
      sql += ' AND enabled = ?';
      params.push(options.enabled ? 1 : 0);
    }

    if (options?.search) {
      sql += ' AND (name LIKE ? OR description LIKE ?)';
      const term = `%${options.search}%`;
      params.push(term, term);
    }

    sql += ' ORDER BY name ASC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapRowToConfig(r));
  }

  public getFunctionById(id: string): FunctionConfig | null {
    const row = this.db.prepare('SELECT * FROM _functions WHERE id = ?').get(id) as any;
    return row ? this.mapRowToConfig(row) : null;
  }

  public getFunctionByName(name: string): FunctionConfig | null {
    const row = this.db.prepare('SELECT * FROM _functions WHERE name = ?').get(name) as any;
    return row ? this.mapRowToConfig(row) : null;
  }

  public createFunction(dto: CreateFunctionDto, actor?: any): FunctionConfig {
    if (!dto.name || !dto.name.trim()) {
      throw new ValidationError('Function name cannot be blank');
    }

    if (dto.authPolicy !== undefined) {
      if (!ALLOWED_AUTH_POLICIES.includes(dto.authPolicy as FunctionAuthPolicy)) {
        throw new ValidationError(
          `Invalid auth policy '${dto.authPolicy}'. Allowed policies are: ${ALLOWED_AUTH_POLICIES.join(', ')}`
        );
      }
    }

    const cleanName = dto.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const existing = this.getFunctionByName(cleanName);
    if (existing) {
      throw new ConflictError(`Function with name '${cleanName}' already exists`);
    }

    const id = dto.id || `fn_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const methods = Array.isArray(dto.methods) && dto.methods.length > 0 ? dto.methods.join(',') : 'GET,POST';
    const allowedDomains = JSON.stringify(dto.allowedDomains || []);
    const env = JSON.stringify(dto.env || {});

    this.db.prepare(`
      INSERT INTO _functions (
        id, name, description, code, enabled, authPolicy, methods,
        routePath, eventTrigger, timeoutMs, memoryLimitMb, allowedDomains,
        elevated, env, created, updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      cleanName,
      dto.description || '',
      dto.code || 'export default async function(ctx) {\n  return { status: 200, body: { message: "Hello from " + ctx.app.slug } };\n}',
      dto.enabled === false ? 0 : 1,
      dto.authPolicy || 'public',
      methods,
      dto.routePath || null,
      dto.eventTrigger || null,
      dto.timeoutMs || 1000,
      dto.memoryLimitMb || 32,
      allowedDomains,
      dto.elevated ? 1 : 0,
      env,
      now,
      now
    );

    return this.getFunctionById(id)!;
  }

  public updateFunction(id: string, dto: UpdateFunctionDto, actor?: any): FunctionConfig {
    const current = this.getFunctionById(id);
    if (!current) {
      throw new NotFoundError(`Function '${id}' not found`);
    }

    if (dto.authPolicy !== undefined) {
      if (!ALLOWED_AUTH_POLICIES.includes(dto.authPolicy as FunctionAuthPolicy)) {
        throw new ValidationError(
          `Invalid auth policy '${dto.authPolicy}'. Allowed policies are: ${ALLOWED_AUTH_POLICIES.join(', ')}`
        );
      }
    }

    let name = current.name;
    if (dto.name && dto.name.trim() !== current.name) {
      const cleanName = dto.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const conflict = this.getFunctionByName(cleanName);
      if (conflict && conflict.id !== id) {
        throw new ConflictError(`Function with name '${cleanName}' already exists`);
      }
      name = cleanName;
    }

    const description = dto.description !== undefined ? dto.description : current.description;
    const code = dto.code !== undefined ? dto.code : current.code;
    const enabled = dto.enabled !== undefined ? (dto.enabled ? 1 : 0) : (current.enabled ? 1 : 0);
    const authPolicy = dto.authPolicy || current.authPolicy;
    const methods = dto.methods ? dto.methods.join(',') : current.methods.join(',');
    const routePath = dto.routePath !== undefined ? dto.routePath : current.routePath;
    const eventTrigger = dto.eventTrigger !== undefined ? dto.eventTrigger : current.eventTrigger;
    const timeoutMs = dto.timeoutMs !== undefined ? dto.timeoutMs : current.timeoutMs;
    const memoryLimitMb = dto.memoryLimitMb !== undefined ? dto.memoryLimitMb : current.memoryLimitMb;
    const allowedDomains = dto.allowedDomains ? JSON.stringify(dto.allowedDomains) : JSON.stringify(current.allowedDomains);
    const elevated = dto.elevated !== undefined ? (dto.elevated ? 1 : 0) : (current.elevated ? 1 : 0);
    const env = dto.env ? JSON.stringify(dto.env) : JSON.stringify(current.env);
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE _functions SET
        name = ?, description = ?, code = ?, enabled = ?, authPolicy = ?,
        methods = ?, routePath = ?, eventTrigger = ?, timeoutMs = ?, memoryLimitMb = ?,
        allowedDomains = ?, elevated = ?, env = ?, updated = ?
      WHERE id = ?
    `).run(
      name,
      description,
      code,
      enabled,
      authPolicy,
      methods,
      routePath,
      eventTrigger,
      timeoutMs,
      memoryLimitMb,
      allowedDomains,
      elevated,
      env,
      now,
      id
    );

    return this.getFunctionById(id)!;
  }

  public deleteFunction(id: string, actor?: any): boolean {
    const current = this.getFunctionById(id);
    if (!current) {
      throw new NotFoundError(`Function '${id}' not found`);
    }

    this.db.prepare('DELETE FROM _function_logs WHERE functionId = ?').run(id);
    this.db.prepare('DELETE FROM _functions WHERE id = ?').run(id);
    return true;
  }

  // ==========================================
  // Execution & Testing
  // ==========================================

  public async executeFunction(
    functionIdOrName: string,
    requestCtx?: FunctionRequestContext,
    actor?: any
  ): Promise<FunctionExecutionResult> {
    const fn = this.getFunctionById(functionIdOrName) || this.getFunctionByName(functionIdOrName);
    if (!fn) {
      throw new NotFoundError(`Function '${functionIdOrName}' not found`);
    }

    if (!fn.enabled) {
      throw new AppError(`Function '${fn.name}' is currently disabled`, 403);
    }

    // Verify HTTP method permission
    if (requestCtx?.method && fn.methods.length > 0 && !fn.methods.includes('*')) {
      const allowedMethods = fn.methods.map((m) => m.toUpperCase());
      if (!allowedMethods.includes(requestCtx.method.toUpperCase())) {
        throw new AppError(`HTTP method '${requestCtx.method}' is not allowed for this function`, 405);
      }
    }

    // Concurrency throttle check
    if (this.activeExecutions >= this.maxConcurrent) {
      throw new AppError('Serverless function concurrency limit reached. Please retry shortly.', 429);
    }

    const parentStore = this.executionStorage.getStore();
    const currentDepth = (parentStore?.depth || 0) + 1;
    const activeFns = parentStore?.activeFns ? new Set(parentStore.activeFns) : new Set<string>();

    if (currentDepth > this.maxRecursionDepth || activeFns.has(fn.id)) {
      const errorMsg = activeFns.has(fn.id)
        ? `Circular recursion detected: function '${fn.name}' already active in call stack`
        : `Maximum function recursion depth of ${this.maxRecursionDepth} exceeded`;
      throw new AppError(errorMsg, 508);
    }

    this.activeExecutions++;
    const nextActiveFns = new Set(activeFns);
    nextActiveFns.add(fn.id);

    try {
      const context = this.buildFunctionContext(fn, requestCtx, undefined, actor);
      const result = await this.executionStorage.run(
        { depth: currentDepth, activeFns: nextActiveFns },
        () =>
          this.runner.execute(fn.code, context, {
            timeoutMs: fn.timeoutMs,
            memoryLimitMb: fn.memoryLimitMb,
          })
      );

      // Record log entry asynchronously
      this.recordLog({
        functionId: fn.id,
        functionName: fn.name,
        trigger: 'http',
        status: result.status,
        statusCode: result.statusCode,
        durationMs: result.durationMs,
        requestPayload: requestCtx ? JSON.stringify(requestCtx.body ?? null) : undefined,
        responsePayload: JSON.stringify(result.body ?? null),
        logs: result.logs.join('\n'),
        error: result.error,
        actorId: actor?.id || requestCtx?.auth?.id || undefined,
      });

      return result;
    } finally {
      this.activeExecutions = Math.max(0, this.activeExecutions - 1);
    }
  }

  public async testFunction(
    id: string,
    mockRequest: Partial<FunctionRequestContext> = {},
    actor?: any
  ): Promise<FunctionExecutionResult> {
    const fn = this.getFunctionById(id);
    if (!fn) {
      throw new NotFoundError(`Function '${id}' not found`);
    }

    const requestCtx: FunctionRequestContext = {
      method: mockRequest.method || 'POST',
      path: mockRequest.path || `/api/functions/${fn.name}`,
      query: mockRequest.query || {},
      headers: mockRequest.headers || { 'content-type': 'application/json' },
      body: mockRequest.body || {},
      params: mockRequest.params || {},
      auth: mockRequest.auth !== undefined ? mockRequest.auth : (actor ? { id: actor.id, role: actor.isAdmin ? 'admin' : 'user', email: actor.email } : null),
    };

    if (this.activeExecutions >= this.maxConcurrent) {
      throw new AppError('Serverless function concurrency limit reached. Please retry shortly.', 429);
    }

    this.activeExecutions++;
    let result: FunctionExecutionResult;
    try {
      const context = this.buildFunctionContext(fn, requestCtx, undefined, actor);
      result = await this.runner.execute(fn.code, context, {
        timeoutMs: fn.timeoutMs,
        memoryLimitMb: fn.memoryLimitMb,
      });
    } finally {
      this.activeExecutions = Math.max(0, this.activeExecutions - 1);
    }

    this.recordLog({
      functionId: fn.id,
      functionName: fn.name,
      trigger: 'test',
      status: result.status,
      statusCode: result.statusCode,
      durationMs: result.durationMs,
      requestPayload: JSON.stringify(requestCtx.body ?? null),
      responsePayload: JSON.stringify(result.body ?? null),
      logs: result.logs.join('\n'),
      error: result.error,
      actorId: actor?.id || undefined,
    });

    return result;
  }

  // ==========================================
  // Lifecycle Hook Dispatcher
  // ==========================================

  public async handleRecordEvent(
    action: 'create' | 'update' | 'delete',
    eventCtx: { collection: string; record: Record<string, any>; auth?: any; isBefore?: boolean }
  ): Promise<Record<string, any> | void> {
    const hookTrigger = `${eventCtx.collection}:${eventCtx.isBefore ? 'before' : 'after'}${action.charAt(0).toUpperCase() + action.slice(1)}`;
    const wildcardTrigger = `*:${eventCtx.isBefore ? 'before' : 'after'}${action.charAt(0).toUpperCase() + action.slice(1)}`;

    const matchingFunctions = this.db.prepare(`
      SELECT * FROM _functions
      WHERE enabled = 1
        AND (eventTrigger = ? OR eventTrigger = ? OR eventTrigger = '*:*' OR eventTrigger = '*')
    `).all(hookTrigger, wildcardTrigger) as any[];

    if (matchingFunctions.length === 0) return;

    const parentStore = this.executionStorage.getStore();
    const currentDepth = (parentStore?.depth || 0) + 1;
    const activeFns = parentStore?.activeFns ? new Set(parentStore.activeFns) : new Set<string>();

    for (const row of matchingFunctions) {
      const fn = this.mapRowToConfig(row);

      // Recursion protection: check depth and circular invocation of the same function
      if (currentDepth > this.maxRecursionDepth || activeFns.has(fn.id)) {
        const errorMsg = activeFns.has(fn.id)
          ? `Circular recursion detected: function '${fn.name}' already active in call stack for trigger '${hookTrigger}'`
          : `Maximum function recursion depth of ${this.maxRecursionDepth} exceeded for trigger '${hookTrigger}'`;

        this.recordLog({
          functionId: fn.id,
          functionName: fn.name,
          trigger: `hook:${hookTrigger}`,
          status: 'error',
          statusCode: 508,
          durationMs: 0,
          requestPayload: JSON.stringify(eventCtx.record),
          responsePayload: undefined,
          logs: `[RecursionGuard] ${errorMsg}`,
          error: errorMsg,
          actorId: eventCtx.auth?.id || undefined,
        });

        throw new AppError(errorMsg, 508);
      }

      // Concurrency admission control: enforce maxConcurrent limit
      if (this.activeExecutions >= this.maxConcurrent) {
        const errorMsg = 'Serverless function concurrency limit reached. Please retry shortly.';
        this.recordLog({
          functionId: fn.id,
          functionName: fn.name,
          trigger: `hook:${hookTrigger}`,
          status: 'error',
          statusCode: 429,
          durationMs: 0,
          requestPayload: JSON.stringify(eventCtx.record),
          responsePayload: undefined,
          logs: `[ConcurrencyGuard] ${errorMsg}`,
          error: errorMsg,
          actorId: eventCtx.auth?.id || undefined,
        });

        throw new AppError(errorMsg, 429);
      }

      const fnEventCtx: FunctionEventContext = {
        collection: eventCtx.collection,
        action,
        record: eventCtx.record,
        isBefore: eventCtx.isBefore,
      };

      const context = this.buildFunctionContext(fn, undefined, fnEventCtx, eventCtx.auth);

      this.activeExecutions++;
      const nextActiveFns = new Set(activeFns);
      nextActiveFns.add(fn.id);

      let result: FunctionExecutionResult;
      try {
        result = await this.executionStorage.run(
          { depth: currentDepth, activeFns: nextActiveFns },
          () =>
            this.runner.execute(fn.code, context, {
              timeoutMs: fn.timeoutMs,
              memoryLimitMb: fn.memoryLimitMb,
            })
        );
      } finally {
        this.activeExecutions = Math.max(0, this.activeExecutions - 1);
      }

      this.recordLog({
        functionId: fn.id,
        functionName: fn.name,
        trigger: `hook:${hookTrigger}`,
        status: result.status,
        statusCode: result.statusCode,
        durationMs: result.durationMs,
        requestPayload: JSON.stringify(eventCtx.record),
        responsePayload: JSON.stringify(result.body ?? null),
        logs: result.logs.join('\n'),
        error: result.error,
        actorId: eventCtx.auth?.id || undefined,
      });

      if (result.status === 'error' && eventCtx.isBefore) {
        const isRecursion = result.error?.includes('recursion');
        throw new AppError(result.error || `Function '${fn.name}' failed`, isRecursion ? 508 : 500);
      }

      // If before hook returns an object or mutations, apply them
      if (eventCtx.isBefore && result.status === 'success' && result.body && typeof result.body === 'object') {
        if (result.body.cancel === true) {
          throw new AppError(result.body.reason || `Cancelled by function '${fn.name}'`, 400);
        }
        if (result.body.record && typeof result.body.record === 'object') {
          Object.assign(eventCtx.record, result.body.record);
        }
      }
    }

    return eventCtx.record;
  }

  // ==========================================
  // Logs & Statistics
  // ==========================================

  public getLogs(
    functionId?: string,
    options: { page?: number; perPage?: number; status?: string } = {}
  ): { items: FunctionLog[]; totalItems: number; totalPages: number; page: number; perPage: number } {
    const page = Math.max(1, options.page || 1);
    const perPage = Math.max(1, Math.min(options.perPage || 25, 100));
    const offset = (page - 1) * perPage;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (functionId) {
      whereClause += ' AND functionId = ?';
      params.push(functionId);
    }

    if (options.status && options.status !== 'all') {
      whereClause += ' AND status = ?';
      params.push(options.status);
    }

    const countRow = this.db.prepare(`SELECT COUNT(*) as count FROM _function_logs ${whereClause}`).get(...params) as any;
    const totalItems = countRow?.count || 0;
    const totalPages = Math.ceil(totalItems / perPage) || 1;

    const rows = this.db.prepare(`
      SELECT * FROM _function_logs
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(...params, perPage, offset) as any[];

    return {
      items: rows,
      totalItems,
      totalPages,
      page,
      perPage,
    };
  }

  public clearLogs(functionId?: string): void {
    if (functionId) {
      this.db.prepare('DELETE FROM _function_logs WHERE functionId = ?').run(functionId);
    } else {
      this.db.prepare('DELETE FROM _function_logs').run();
    }
  }

  public getStats(): {
    totalFunctions: number;
    activeFunctions: number;
    totalExecutions: number;
    successExecutions: number;
    failedExecutions: number;
    successRate: string;
  } {
    const fns = this.db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active FROM _functions').get() as any;
    const logs = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as failed
      FROM _function_logs
    `).get() as any;

    const totalExecutions = logs?.total || 0;
    const successExecutions = logs?.success || 0;
    const failedExecutions = logs?.failed || 0;
    const rate = totalExecutions > 0 ? `${((successExecutions / totalExecutions) * 100).toFixed(1)}%` : '100%';

    return {
      totalFunctions: fns?.total || 0,
      activeFunctions: fns?.active || 0,
      totalExecutions,
      successExecutions,
      failedExecutions,
      successRate: rate,
    };
  }

  // ==========================================
  // Context Builder & Helpers
  // ==========================================

  private buildFunctionContext(
    fn: FunctionConfig,
    requestCtx?: FunctionRequestContext,
    eventCtx?: FunctionEventContext,
    actor?: any
  ): FunctionContext {
    // If elevated is true, run as service-role (bypassing user rules)
    const effectiveAuth = fn.elevated ? { isAdmin: true, id: 'service-role' } : (actor || requestCtx?.auth || null);

    const safeFetch = SsrfGuard.createGuardedFetch(fn.allowedDomains, fn.timeoutMs);

    const recordsBridge = {
      get: async (collection: string, id: string) => {
        if (this.recordService) {
          return await this.recordService.getOne(collection, id, {}, effectiveAuth);
        }
        return this.db.prepare(`SELECT * FROM "${collection}" WHERE id = ?`).get(id) as any;
      },
      list: async (collection: string, options?: FunctionRecordQueryOptions) => {
        if (this.recordService) {
          return await this.recordService.getList(
            collection,
            {
              filter: options?.filter,
              sort: options?.sort,
              page: options?.page || 1,
              perPage: options?.perPage || 30,
              search: options?.search,
            },
            effectiveAuth
          );
        }
        const rows = this.db.prepare(`SELECT * FROM "${collection}" LIMIT ?`).all(options?.perPage || 30);
        return { items: rows, totalItems: rows.length, totalPages: 1, page: 1, perPage: options?.perPage || 30 };
      },
      create: async (collection: string, data: Record<string, any>) => {
        if (this.recordService) {
          return await this.recordService.create(collection, data, effectiveAuth);
        }
        throw new Error('RecordService not available in function context');
      },
      update: async (collection: string, id: string, data: Record<string, any>) => {
        if (this.recordService) {
          return await this.recordService.update(collection, id, data, effectiveAuth);
        }
        throw new Error('RecordService not available in function context');
      },
      delete: async (collection: string, id: string): Promise<boolean> => {
        if (this.recordService) {
          await this.recordService.delete(collection, id, effectiveAuth);
          return true;
        }
        throw new Error('RecordService not available in function context');
      },
    };

    return {
      app: this.appScope,
      request: requestCtx,
      event: eventCtx,
      records: recordsBridge,
      fetch: safeFetch as any,
      env: fn.env || {},
      log: () => {},
    };
  }

  private recordLog(log: Omit<FunctionLog, 'id' | 'timestamp'>): void {
    try {
      const id = `fnlog_${crypto.randomBytes(6).toString('hex')}`;
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO _function_logs (
          id, functionId, functionName, trigger, status, statusCode,
          durationMs, requestPayload, responsePayload, logs, error, actorId, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        log.functionId,
        log.functionName,
        log.trigger,
        log.status,
        log.statusCode,
        log.durationMs,
        log.requestPayload || null,
        log.responsePayload || null,
        log.logs || '',
        log.error || null,
        log.actorId || null,
        now
      );
    } catch (err: any) {
      console.warn(`[FunctionService] Failed to record log: ${err.message}`);
    }
  }

  private mapRowToConfig(row: any): FunctionConfig {
    let allowedDomains: string[] = [];
    try {
      allowedDomains = row.allowedDomains ? JSON.parse(row.allowedDomains) : [];
    } catch {}

    let env: Record<string, string> = {};
    try {
      env = row.env ? JSON.parse(row.env) : {};
    } catch {}

    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      code: row.code,
      enabled: Boolean(row.enabled),
      authPolicy: row.authPolicy || 'public',
      methods: row.methods ? row.methods.split(',').map((m: string) => m.trim()) : ['GET', 'POST'],
      routePath: row.routePath || undefined,
      eventTrigger: row.eventTrigger || null,
      timeoutMs: row.timeoutMs || 1000,
      memoryLimitMb: row.memoryLimitMb || 32,
      allowedDomains,
      elevated: Boolean(row.elevated),
      env,
      created: row.created,
      updated: row.updated,
    };
  }
}
