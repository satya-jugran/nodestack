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
  FunctionHostServices,
  FunctionExecutionResult,
  FunctionLog,
  FunctionRecordQueryOptions,
  FunctionAuthPolicy,
} from './types';

export const ALLOWED_AUTH_POLICIES: readonly FunctionAuthPolicy[] = ['public', 'auth', 'admin', 'apiKey'] as const;
import { AppError, NotFoundError, ForbiddenError, UnauthorizedError, ValidationError, ConflictError } from '../core/errors/AppError';
import { FlowValidator } from '../flows/FlowValidator';
import type { FlowService } from '../flows/FlowService';
import type { QueueService } from '../queue/QueueService';
import type { AuthService, AuthClaims } from '../auth/AuthService';
import type { ApiKeyService } from '../auth/ApiKeyService';

export class FunctionConcurrencyLimitError extends AppError {
  constructor(message = 'Serverless function concurrency limit reached. Please retry shortly.') {
    super(message, 429);
  }
}

export interface FunctionServiceOptions {
  runner?: SandboxedRunner;
  maxConcurrent?: number;
  maxRecursionDepth?: number;
  flowService?: FlowService;
  queueService?: QueueService;
  authService?: AuthService;
  apiKeyService?: ApiKeyService;
}

export class FunctionService {
  private runner: SandboxedRunner;
  private maxConcurrent: number;
  private maxRecursionDepth: number;
  private activeExecutions = 0;
  private executionStorage = new AsyncLocalStorage<{ depth: number; activeFns: Set<string> }>();
  private flowService?: FlowService;
  private queueService?: QueueService;
  private authService?: AuthService;
  private apiKeyService?: ApiKeyService;

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
    this.flowService = options.flowService;
    this.queueService = options.queueService;
    this.authService = options.authService;
    this.apiKeyService = options.apiKeyService;
    this.initTables();
  }

  public getActiveExecutions(): number {
    return this.activeExecutions;
  }

  public getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  public getAvailableCapacity(): number {
    return Math.max(0, this.maxConcurrent - this.activeExecutions);
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
      const textType = this.db.dialect.textType();
      const ddlFunctions = this.db.dialect.createTableIfNotExists('_functions', `
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        description ${textType} DEFAULT '',
        code ${textType} NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        authPolicy VARCHAR(50) NOT NULL DEFAULT 'public',
        methods VARCHAR(100) NOT NULL DEFAULT 'GET,POST',
        eventTrigger VARCHAR(255),
        timeoutMs INTEGER NOT NULL DEFAULT 1000,
        memoryLimitMb INTEGER NOT NULL DEFAULT 32,
        allowedDomains ${textType} NOT NULL,
        elevated INTEGER NOT NULL DEFAULT 0,
        env ${textType} NOT NULL,
        created VARCHAR(50) NOT NULL,
        updated VARCHAR(50) NOT NULL
      `);
      void this.db.exec(ddlFunctions).catch(() => {});

      const ddlLogs = this.db.dialect.createTableIfNotExists('_function_logs', `
        id VARCHAR(255) PRIMARY KEY,
        functionId VARCHAR(255) NOT NULL,
        functionName VARCHAR(255) NOT NULL,
        trigger VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL,
        statusCode INTEGER NOT NULL,
        durationMs INTEGER NOT NULL,
        requestPayload ${textType},
        responsePayload ${textType},
        logs ${textType},
        error ${textType},
        actorId VARCHAR(255),
        timestamp VARCHAR(50) NOT NULL
      `);
      void this.db.exec(ddlLogs).catch(() => {});
    } catch (err: any) {
      console.warn(`[FunctionService] initTables warning: ${err.message}`);
    }
  }

  // ==========================================
  // Function CRUD
  // ==========================================

  public getAllFunctions(options?: { search?: string; enabled?: boolean }): any {
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

    const rows = this.db.all<any>(sql, ...params);
    if (rows instanceof Promise) {
      return rows.then((r: any[]) => (r || []).map((row: any) => this.mapRowToConfig(row)));
    }
    return (rows || []).map((r: any) => this.mapRowToConfig(r));
  }

  public getFunctionById(id: string): any {
    const row = this.db.get<any>('SELECT * FROM _functions WHERE id = ?', id);
    if (row instanceof Promise) {
      return row.then((r) => (r ? this.mapRowToConfig(r) : null));
    }
    return row ? this.mapRowToConfig(row) : null;
  }

  public getFunctionByName(name: string): any {
    const row = this.db.get<any>('SELECT * FROM _functions WHERE name = ?', name);
    if (row instanceof Promise) {
      return row.then((r) => (r ? this.mapRowToConfig(r) : null));
    }
    return row ? this.mapRowToConfig(row) : null;
  }

  public createFunction(dto: CreateFunctionDto, actor?: any): any {
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
    if (existing instanceof Promise) {
      return existing.then((ex) => {
        if (ex) throw new ConflictError(`Function with name '${cleanName}' already exists`);
        return this.finishCreateFunction(cleanName, dto, actor);
      });
    }
    if (existing) {
      throw new ConflictError(`Function with name '${cleanName}' already exists`);
    }
    return this.finishCreateFunction(cleanName, dto, actor);
  }

  private finishCreateFunction(cleanName: string, dto: CreateFunctionDto, actor?: any): any {
    const id = dto.id || `fn_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const methods = Array.isArray(dto.methods) && dto.methods.length > 0 ? dto.methods.join(',') : 'GET,POST';
    const allowedDomains = JSON.stringify(dto.allowedDomains || []);
    const env = JSON.stringify(dto.env || {});

    const res = this.db.run(`
      INSERT INTO _functions (
        id, name, description, code, enabled, authPolicy, methods,
        eventTrigger, timeoutMs, memoryLimitMb, allowedDomains,
        elevated, env, created, updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      cleanName,
      dto.description || '',
      dto.code || 'export default async function(core, context) {\n  return { status: 200, body: { message: "Hello from " + context.app.slug } };\n}',
      dto.enabled === false ? 0 : 1,
      dto.authPolicy || 'public',
      methods,
      dto.eventTrigger || null,
      dto.timeoutMs || 1000,
      dto.memoryLimitMb || 32,
      allowedDomains,
      dto.elevated ? 1 : 0,
      env,
      now,
      now
    );

    if (res instanceof Promise) {
      return res.then(async () => {
        const created = await this.getFunctionById(id);
        return created!;
      });
    }

    const created = this.getFunctionById(id);
    return created!;
  }

  public updateFunction(id: string, dto: UpdateFunctionDto, actor?: any): any {
    if (dto.authPolicy !== undefined) {
      if (!ALLOWED_AUTH_POLICIES.includes(dto.authPolicy as FunctionAuthPolicy)) {
        throw new ValidationError(
          `Invalid auth policy '${dto.authPolicy}'. Allowed policies are: ${ALLOWED_AUTH_POLICIES.join(', ')}`
        );
      }
    }

    const current = this.getFunctionById(id);
    if (current instanceof Promise) {
      return current.then((curr) => {
        if (!curr) throw new NotFoundError(`Function '${id}' not found`);
        return this.finishUpdateFunction(id, curr, dto, actor);
      });
    }
    if (!current) {
      throw new NotFoundError(`Function '${id}' not found`);
    }
    return this.finishUpdateFunction(id, current, dto, actor);
  }

  private finishUpdateFunction(id: string, current: FunctionConfig, dto: UpdateFunctionDto, actor?: any): any {
    let name = current.name;
    if (dto.name && dto.name.trim() !== current.name) {
      const cleanName = dto.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const conflict = this.getFunctionByName(cleanName);
      if (conflict instanceof Promise) {
        return conflict.then((conf) => {
          if (conf && conf.id !== id) throw new ConflictError(`Function with name '${cleanName}' already exists`);
          return this.applyUpdateFunction(id, current, cleanName, dto, actor);
        });
      }
      if (conflict && conflict.id !== id) {
        throw new ConflictError(`Function with name '${cleanName}' already exists`);
      }
      name = cleanName;
    }
    return this.applyUpdateFunction(id, current, name, dto, actor);
  }

  private applyUpdateFunction(id: string, current: FunctionConfig, name: string, dto: UpdateFunctionDto, actor?: any): any {
    const description = dto.description !== undefined ? dto.description : current.description;
    const code = dto.code !== undefined ? dto.code : current.code;
    const enabled = dto.enabled !== undefined ? (dto.enabled ? 1 : 0) : (current.enabled ? 1 : 0);
    const authPolicy = dto.authPolicy || current.authPolicy;
    const methods = dto.methods ? dto.methods.join(',') : current.methods.join(',');
    const eventTrigger = dto.eventTrigger !== undefined ? dto.eventTrigger : current.eventTrigger;
    const timeoutMs = dto.timeoutMs !== undefined ? dto.timeoutMs : current.timeoutMs;
    const memoryLimitMb = dto.memoryLimitMb !== undefined ? dto.memoryLimitMb : current.memoryLimitMb;
    const allowedDomains = dto.allowedDomains ? JSON.stringify(dto.allowedDomains) : JSON.stringify(current.allowedDomains);
    const elevated = dto.elevated !== undefined ? (dto.elevated ? 1 : 0) : (current.elevated ? 1 : 0);
    const env = dto.env ? JSON.stringify(dto.env) : JSON.stringify(current.env);
    const now = new Date().toISOString();

    const res = this.db.run(`
      UPDATE _functions SET
        name = ?, description = ?, code = ?, enabled = ?, authPolicy = ?,
        methods = ?, eventTrigger = ?, timeoutMs = ?, memoryLimitMb = ?,
        allowedDomains = ?, elevated = ?, env = ?, updated = ?
      WHERE id = ?
    `,
      name,
      description,
      code,
      enabled,
      authPolicy,
      methods,
      eventTrigger,
      timeoutMs,
      memoryLimitMb,
      allowedDomains,
      elevated,
      env,
      now,
      id
    );

    const cascadeRes = this.cascadeRenames(current.name, name, now);

    if (res instanceof Promise || cascadeRes instanceof Promise) {
      return Promise.all([res, cascadeRes]).then(async () => {
        const updated = await this.getFunctionById(id);
        return updated!;
      });
    }

    const updated = this.getFunctionById(id);
    return updated!;
  }

  private cascadeRenames(currentName: string, newName: string, now: string): void | Promise<void> {
    if (newName === currentName) return;

    const doQueues = () => {
      try {
        const q = this.db.run('UPDATE _queues SET targetFunction = ? WHERE targetFunction = ?', newName, currentName);
        if (q instanceof Promise) return q.catch(() => {});
      } catch {}
    };

    const doFlows = () => {
      try {
        const rows = this.db.all<any>('SELECT id, definition FROM _flows');
        if (rows instanceof Promise) {
          return rows.then(async (rList) => {
            for (const row of rList || []) {
              try {
                const def = JSON.parse(row.definition);
                const renamed = FlowValidator.renameReferencedFunction(def, currentName, newName);
                if (renamed) {
                  await this.db.run(
                    'UPDATE _flows SET definition = ?, updated = ? WHERE id = ?',
                    JSON.stringify(def),
                    now,
                    row.id
                  );
                }
              } catch {}
            }
          }).catch(() => {});
        }

        for (const row of rows || []) {
          try {
            const def = JSON.parse(row.definition);
            const renamed = FlowValidator.renameReferencedFunction(def, currentName, newName);
            if (renamed) {
              const r = this.db.run(
                'UPDATE _flows SET definition = ?, updated = ? WHERE id = ?',
                JSON.stringify(def),
                now,
                row.id
              );
              if (r instanceof Promise) void r.catch(() => {});
            }
          } catch {}
        }
      } catch {}
    };

    const qRes = doQueues();
    if (qRes instanceof Promise) {
      return qRes.then(() => doFlows());
    }
    return doFlows();
  }

  public setFlowService(flowService: FlowService): void {
    this.flowService = flowService;
  }

  public getFlowService(): FlowService | undefined {
    return this.flowService;
  }

  public setQueueService(queueService: QueueService): void {
    this.queueService = queueService;
  }

  public getQueueService(): QueueService | undefined {
    return this.queueService;
  }

  /**
   * Finds all flows that reference a function by name or ID.
   * Uses wired FlowService if available, or falls back to direct query on _flows table.
   */
  public getDependentFlows(functionName: string, functionId?: string): any {
    if (this.flowService) {
      const res = this.flowService.getFlowsReferencingFunction(functionName, functionId);
      if (res instanceof Promise) {
        return res.then((flows: any[]) => flows.map((f) => ({ id: f.id, name: f.name })));
      }
      return (res || []).map((f: any) => ({ id: f.id, name: f.name }));
    }

    const rows = typeof (this.db as any).prepare === 'function'
      ? (this.db as any).prepare('SELECT id, name, definition FROM _flows').all()
      : this.db.all<{ id: string; name: string; definition: string }>('SELECT id, name, definition FROM _flows');
    if (rows instanceof Promise) {
      return rows.then((r: any) => this.filterDependentFlows(r, functionName, functionId));
    }
    return this.filterDependentFlows(rows, functionName, functionId);
  }

  private filterDependentFlows(rows: any[], functionName: string, functionId?: string): Array<{ id: string; name: string }> {
    const targetName = functionName ? functionName.trim() : '';
    const targetId = functionId ? functionId.trim() : '';
    const dependent: Array<{ id: string; name: string }> = [];

    for (const row of rows || []) {
      let def: any;
      try {
        def = typeof row.definition === 'string' ? JSON.parse(row.definition) : row.definition;
      } catch {
        throw new AppError(
          `Failed to inspect flow dependencies: malformed definition in flow '${row.name || row.id}'`,
          500
        );
      }
      if (!def || typeof def !== 'object' || Array.isArray(def)) {
        throw new AppError(
          `Failed to inspect flow dependencies: malformed definition in flow '${row.name || row.id}'`,
          500
        );
      }
      const referenced = FlowValidator.extractReferencedFunctions(def);
      if ((targetName && referenced.has(targetName)) || (targetId && referenced.has(targetId))) {
        dependent.push({ id: row.id, name: row.name });
      }
    }
    return dependent;
  }

  /**
   * Finds all queues that bind this function as their targetFunction worker.
   */
  public getDependentQueues(functionName: string, functionId?: string): any {
    try {
      const rows = this.db.all<{ name: string; targetFunction: string }>('SELECT name, targetFunction FROM _queues WHERE targetFunction IS NOT NULL');
      if (rows instanceof Promise) {
        return rows.then((r) => this.filterDependentQueues(r, functionName, functionId)).catch(() => []);
      }
      return this.filterDependentQueues(rows, functionName, functionId);
    } catch {
      return [];
    }
  }

  private filterDependentQueues(rows: any[], functionName: string, functionId?: string): Array<{ name: string }> {
    const targetName = functionName ? functionName.trim() : '';
    const targetId = functionId ? functionId.trim() : '';
    return (rows || [])
      .filter((r) => (targetName && r.targetFunction === targetName) || (targetId && r.targetFunction === targetId))
      .map((r) => ({ name: r.name }));
  }

  public deleteFunction(id: string, actor?: any, options?: { force?: boolean }): any {
    const current = this.getFunctionById(id) || this.getFunctionByName(id);
    if (current instanceof Promise) {
      return current.then((curr) => {
        if (!curr) throw new NotFoundError(`Function '${id}' not found`);
        return this.finishDeleteFunction(curr, actor, options);
      });
    }
    if (!current) {
      throw new NotFoundError(`Function '${id}' not found`);
    }
    return this.finishDeleteFunction(current, actor, options);
  }

  private finishDeleteFunction(current: FunctionConfig, actor?: any, options?: { force?: boolean }): any {
    const doDelete = () => {
      const del1 = this.db.run('DELETE FROM _function_logs WHERE functionId = ?', current.id);
      const del2 = this.db.run('DELETE FROM _functions WHERE id = ?', current.id);
      if (del1 instanceof Promise || del2 instanceof Promise) {
        return Promise.all([del1, del2]).then(() => true);
      }
      return true;
    };

    if (options?.force) {
      return doDelete();
    }

    const deps = this.getDependentFlows(current.name, current.id);
    const queues = this.getDependentQueues(current.name, current.id);

    if (deps instanceof Promise || queues instanceof Promise) {
      return Promise.all([deps, queues]).then(([dependent, dependentQueues]) => {
        if (dependent.length > 0) {
          const flowList = dependent.map((f: any) => `'${f.name}'`).join(', ');
          throw new ConflictError(
            `Cannot delete function '${current.name}': referenced by ${dependent.length} flow(s) (${flowList})`
          );
        }
        if (dependentQueues.length > 0) {
          const queueList = dependentQueues.map((q: any) => `'${q.name}'`).join(', ');
          throw new ConflictError(
            `Cannot delete function '${current.name}': bound as targetFunction by ${dependentQueues.length} queue(s) (${queueList})`
          );
        }
        return doDelete();
      });
    }

    if (deps && deps.length > 0) {
      const flowList = deps.map((f: any) => `'${f.name}'`).join(', ');
      throw new ConflictError(
        `Cannot delete function '${current.name}': referenced by ${deps.length} flow(s) (${flowList})`
      );
    }
    if (queues && queues.length > 0) {
      const queueList = queues.map((q: any) => `'${q.name}'`).join(', ');
      throw new ConflictError(
        `Cannot delete function '${current.name}': bound as targetFunction by ${queues.length} queue(s) (${queueList})`
      );
    }

    return doDelete();
  }

  // ==========================================
  // Execution & Testing
  // ==========================================

  public verifyAuthPolicy(fn: FunctionConfig, auth?: any): void {
    switch (fn.authPolicy) {
      case 'admin':
        if (!auth?.isAdmin) {
          throw new ForbiddenError(`Superuser authorization required to invoke function '${fn.name}'`);
        }
        break;
      case 'auth':
        if (!auth || (!auth.id && !auth.isAdmin)) {
          throw new UnauthorizedError(`Authentication token required to invoke function '${fn.name}'`);
        }
        break;
      case 'apiKey':
        if (!auth?.isApiKey && !auth?.isAdmin) {
          throw new UnauthorizedError(`Valid API Key required to invoke function '${fn.name}'`);
        }
        break;
      case 'public':
        break;
      default:
        throw new ForbiddenError(`Unsupported auth policy '${fn.authPolicy}'`);
    }
  }

  public async executeFunction(
    functionIdOrName: string,
    requestCtx?: FunctionRequestContext,
    actor?: any
  ): Promise<FunctionExecutionResult> {
    const fn = (await this.getFunctionById(functionIdOrName)) || (await this.getFunctionByName(functionIdOrName));
    if (!fn) {
      throw new NotFoundError(`Function '${functionIdOrName}' not found`);
    }

    if (!fn.enabled) {
      throw new AppError(`Function '${fn.name}' is currently disabled`, 403);
    }

    // Verify HTTP method permission
    if (requestCtx?.method && fn.methods.length > 0 && !fn.methods.includes('*')) {
      const allowedMethods = fn.methods.map((m: any) => m.toUpperCase());
      if (!allowedMethods.includes(requestCtx.method.toUpperCase())) {
        throw new AppError(`HTTP method '${requestCtx.method}' is not allowed for this function`, 405);
      }
    }

    // Concurrency throttle check
    if (this.activeExecutions >= this.maxConcurrent) {
      throw new FunctionConcurrencyLimitError();
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
      this.queueService?.wakeAllWorkers();
    }
  }

  /**
   * Executes a serverless function bound as a Queue worker (targetFunction).
   */
  public async executeQueueMessage(
    functionIdOrName: string,
    message: { id: string; queue: string; payload: any; attempts: number; maxAttempts: number; groupKey?: string | null },
    actor?: any
  ): Promise<FunctionExecutionResult> {
    const fn = (await this.getFunctionById(functionIdOrName)) || (await this.getFunctionByName(functionIdOrName));
    if (!fn) {
      throw new NotFoundError(`Function '${functionIdOrName}' not found`);
    }

    if (!fn.enabled) {
      throw new AppError(`Function '${fn.name}' is currently disabled`, 403);
    }

    if (this.activeExecutions >= this.maxConcurrent) {
      throw new FunctionConcurrencyLimitError();
    }

    const requestCtx: FunctionRequestContext = {
      method: 'POST',
      path: `/api/queues/${message.queue}`,
      query: {},
      headers: {
        'content-type': 'application/json',
        'x-queue-name': message.queue,
        'x-message-id': message.id,
        'x-queue-message-id': message.id,
        'x-job-id': message.id,
        'x-queue-job-id': message.id,
        'x-message-attempts': String(message.attempts),
        'x-job-attempts': String(message.attempts),
      },
      body: message.payload,
      params: { queue: message.queue, messageId: message.id, jobId: message.id },
      auth: actor ? { id: actor.id, role: actor.isAdmin ? 'admin' : 'user' } : null,
    };

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

      this.recordLog({
        functionId: fn.id,
        functionName: fn.name,
        trigger: `queue:${message.queue}`,
        status: result.status,
        statusCode: result.statusCode,
        durationMs: result.durationMs,
        requestPayload: JSON.stringify(message.payload ?? null),
        responsePayload: JSON.stringify(result.body ?? null),
        logs: result.logs.join('\n'),
        error: result.error,
        actorId: actor?.id || `msg:${message.id}`,
      });

      return result;
    } finally {
      this.activeExecutions = Math.max(0, this.activeExecutions - 1);
      this.queueService?.wakeAllWorkers();
    }
  }

  public setAuthServices(authService?: AuthService, apiKeyService?: ApiKeyService): void {
    if (authService) this.authService = authService;
    if (apiKeyService) this.apiKeyService = apiKeyService;
  }

  public hasAuthServices(): boolean {
    return Boolean(this.authService || this.apiKeyService);
  }

  public async resolveAuthFromHeaders(headers: Record<string, any> = {}): Promise<{ hasAuthHeader: boolean; resolvedAuth: any }> {
    let authHeader: string | undefined;
    let xApiKey: string | undefined;

    for (const [k, v] of Object.entries(headers)) {
      const lower = k.toLowerCase();
      if (lower === 'authorization' && typeof v === 'string') {
        authHeader = v;
      } else if ((lower === 'x-api-key' || lower === 'x-apikey') && typeof v === 'string') {
        xApiKey = v;
      }
    }

    if (xApiKey && xApiKey.trim()) {
      const key = xApiKey.trim();
      if (this.apiKeyService) {
        const result = await this.apiKeyService.verifyKey(key);
        if (result.valid && result.apiKey) {
          const isSuperAdmin = result.apiKey.role === 'admin' || result.apiKey.scopes.includes('*') || result.apiKey.scopes.includes('admin:*');
          return {
            hasAuthHeader: true,
            resolvedAuth: {
              id: result.apiKey.id,
              email: `${result.apiKey.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}@service.nodestack.local`,
              collection: '_api_keys',
              tokenKey: result.apiKey.id,
              isAdmin: isSuperAdmin,
              isApiKey: true,
              apiKeyId: result.apiKey.id,
              apiKeyName: result.apiKey.name,
              scopes: result.apiKey.scopes,
              allowedIps: result.apiKey.allowedIps,
            },
          };
        }
      }
      return { hasAuthHeader: true, resolvedAuth: null };
    }

    if (authHeader && authHeader.trim()) {
      const headerVal = authHeader.trim();
      let token: string | undefined;
      let isApiKeyHeader = false;

      if (headerVal.startsWith('Bearer nsk_') || headerVal.startsWith('bearer nsk_') || headerVal.startsWith('ApiKey ') || headerVal.startsWith('apikey ')) {
        token = headerVal.substring(7).trim();
        isApiKeyHeader = true;
      } else if (headerVal.toLowerCase().startsWith('bearer ')) {
        token = headerVal.substring(7).trim();
      } else {
        token = headerVal;
      }

      if (token) {
        if (isApiKeyHeader || token.startsWith('nsk_')) {
          if (this.apiKeyService) {
            const result = await this.apiKeyService.verifyKey(token);
            if (result.valid && result.apiKey) {
              const isSuperAdmin = result.apiKey.role === 'admin' || result.apiKey.scopes.includes('*') || result.apiKey.scopes.includes('admin:*');
              return {
                hasAuthHeader: true,
                resolvedAuth: {
                  id: result.apiKey.id,
                  email: `${result.apiKey.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}@service.nodestack.local`,
                  collection: '_api_keys',
                  tokenKey: result.apiKey.id,
                  isAdmin: isSuperAdmin,
                  isApiKey: true,
                  apiKeyId: result.apiKey.id,
                  apiKeyName: result.apiKey.name,
                  scopes: result.apiKey.scopes,
                  allowedIps: result.apiKey.allowedIps,
                },
              };
            }
          }
          return { hasAuthHeader: true, resolvedAuth: null };
        }

        if (this.authService) {
          try {
            const claims = await this.authService.verifyToken(token);
            return { hasAuthHeader: true, resolvedAuth: claims };
          } catch {
            return { hasAuthHeader: true, resolvedAuth: null };
          }
        }
      }
      return { hasAuthHeader: true, resolvedAuth: null };
    }

    return { hasAuthHeader: false, resolvedAuth: undefined };
  }

  public async testFunction(
    id: string,
    mockRequest: Partial<FunctionRequestContext> = {},
    actor?: any
  ): Promise<FunctionExecutionResult> {
    const fn = await this.getFunctionById(id);
    if (!fn) {
      throw new NotFoundError(`Function '${id}' not found`);
    }

    const rawHeaders = mockRequest.headers || {};
    const { hasAuthHeader, resolvedAuth } = await this.resolveAuthFromHeaders(rawHeaders);

    let effectiveAuth: any;
    let effectiveActor: any;

    if (hasAuthHeader) {
      effectiveAuth = resolvedAuth;
      effectiveActor = resolvedAuth;
    } else if (mockRequest.auth !== undefined) {
      effectiveAuth = mockRequest.auth;
      effectiveActor = mockRequest.auth;
    } else {
      effectiveAuth = actor ? { id: actor.id, role: actor.isAdmin ? 'admin' : (actor.isApiKey ? 'apiKey' : 'user'), email: actor.email } : null;
      effectiveActor = actor;
    }

    const requestCtx: FunctionRequestContext = {
      method: mockRequest.method || 'POST',
      path: mockRequest.path || `/api/functions/${fn.name}`,
      query: mockRequest.query || {},
      headers: mockRequest.headers || { 'content-type': 'application/json' },
      body: mockRequest.body || {},
      params: mockRequest.params || {},
      auth: effectiveAuth,
    };

    if (fn.authPolicy && fn.authPolicy !== 'public') {
      try {
        this.verifyAuthPolicy(fn, effectiveActor);
      } catch (err: any) {
        return {
          status: 'error',
          statusCode: err.statusCode || 401,
          error: err.message,
          durationMs: 0,
          logs: [`[AuthError] ${err.message}`],
          memoryUsedMb: 0,
        };
      }
    }

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

    let result: FunctionExecutionResult;
    try {
      const context = this.buildFunctionContext(fn, requestCtx, undefined, effectiveActor);
      result = await this.executionStorage.run(
        { depth: currentDepth, activeFns: nextActiveFns },
        async () => {
          return await this.runner.execute(fn.code, context, {
            timeoutMs: fn.timeoutMs,
            memoryLimitMb: fn.memoryLimitMb,
          });
        }
      );
    } finally {
      this.activeExecutions = Math.max(0, this.activeExecutions - 1);
      this.queueService?.wakeAllWorkers();
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
      actorId: effectiveActor?.id || undefined,
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

    const matchingFunctions = await this.db.all<any>(`
      SELECT * FROM _functions
      WHERE enabled = 1
        AND (eventTrigger = ? OR eventTrigger = ? OR eventTrigger = '*:*' OR eventTrigger = '*')
    `, hookTrigger, wildcardTrigger);

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
        this.queueService?.wakeAllWorkers();
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

      if (result.status === 'timeout' && eventCtx.isBefore) {
        throw new AppError(result.error || `Before-hook function '${fn.name}' timed out`, 504);
      }

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
  ): any {
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

    const countRow = this.db.get<any>(`SELECT COUNT(*) as count FROM _function_logs ${whereClause}`, ...params);
    const baseSql = `SELECT * FROM _function_logs ${whereClause} ORDER BY timestamp DESC`;
    const paginatedSql = this.db.dialect.paginate(baseSql, perPage, offset);

    if (countRow instanceof Promise) {
      return Promise.all([countRow, this.db.all<any>(paginatedSql, ...params)]).then(([cRow, rows]) => {
        const totalItems = cRow?.count || 0;
        const totalPages = Math.ceil(totalItems / perPage) || 1;
        return { items: rows, totalItems, totalPages, page, perPage };
      });
    }

    const totalItems = countRow?.count || 0;
    const totalPages = Math.ceil(totalItems / perPage) || 1;
    const rows = this.db.all<any>(paginatedSql, ...params);
    if (rows instanceof Promise) {
      return rows.then((r) => ({ items: r, totalItems, totalPages, page, perPage }));
    }
    return { items: rows, totalItems, totalPages, page, perPage };
  }

  public clearLogs(functionId?: string): any {
    if (functionId) {
      const res = this.db.run('DELETE FROM _function_logs WHERE functionId = ?', functionId);
      if (res instanceof Promise) return res.then(() => {});
      return;
    }
    const res = this.db.run('DELETE FROM _function_logs');
    if (res instanceof Promise) return res.then(() => {});
  }

  public getStats(): any {
    const fns = this.db.get<any>('SELECT COUNT(*) as total, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active FROM _functions');
    const logs = this.db.get<any>(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as failed
      FROM _function_logs
    `);

    if (fns instanceof Promise || logs instanceof Promise) {
      return Promise.all([fns, logs]).then(([f, l]) => this.calculateStatsFromRows(f, l));
    }
    return this.calculateStatsFromRows(fns, logs);
  }

  private calculateStatsFromRows(fns: any, logs: any) {
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
  ): FunctionHostServices {
    // If elevated is true, run as service-role (bypassing user rules)
    const effectiveAuth = fn.elevated
      ? { isAdmin: true, id: 'service-role' }
      : (actor || null);

    const safeFetch = SsrfGuard.createGuardedFetch(fn.allowedDomains, fn.timeoutMs);

    const recordsBridge = {
      get: async (collection: string, id: string) => {
        if (this.recordService) {
          try {
            return await this.recordService.getOne(collection, id, {}, effectiveAuth);
          } catch (err: any) {
            if (err?.name === 'NotFoundError' || err?.statusCode === 404 || (err?.message && err.message.includes('not found'))) {
              return null;
            }
            throw err;
          }
        }
        const quotedCol = this.db.dialect.quoteIdentifier(collection);
        return await this.db.get<any>(`SELECT * FROM ${quotedCol} WHERE id = ?`, id);
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
        const quotedCol = this.db.dialect.quoteIdentifier(collection);
        const limit = options?.perPage || 30;
        const page = options?.page || 1;
        const offset = (page - 1) * limit;
        const sql = this.db.dialect.paginate(`SELECT * FROM ${quotedCol}`, limit, offset);
        const rows = await this.db.all<any>(sql);
        return { items: rows, totalItems: rows.length, totalPages: 1, page, perPage: limit };
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

    const queueBridge = {
      send: async (queueName: string, payload: any, options?: any) => {
        if (!this.queueService) {
          throw new Error('QueueService not available in function context');
        }
        if (!queueName || typeof queueName !== 'string' || !queueName.trim()) {
          throw new Error('Queue name is required');
        }
        if (queueName.trim().startsWith('_system:')) {
          throw new Error('Cannot enqueue messages into reserved _system:* queues from user functions');
        }
        if (options && typeof options === 'object' && typeof options.queue === 'string' && options.queue.trim().startsWith('_system:')) {
          throw new Error('Cannot enqueue messages into reserved _system:* queues from user functions');
        }
        return await this.queueService.send(queueName.trim(), payload, options);
      },
      claim: async (queueName: string, options?: { visibilityTimeoutSeconds?: number; limit?: number }) => {
        if (!this.queueService) {
          throw new Error('QueueService not available in function context');
        }
        if (!queueName || typeof queueName !== 'string' || !queueName.trim()) {
          throw new Error('Queue name is required');
        }
        if (queueName.trim().startsWith('_system:')) {
          throw new Error('Cannot claim messages from reserved _system:* queues from user functions');
        }
        const visibility = options?.visibilityTimeoutSeconds ?? 30;
        const limit = Math.max(1, Math.min(options?.limit ?? 1, 50));
        return await this.queueService.claim(queueName.trim(), visibility, limit, `fn_worker_${fn.id}`);
      },
      complete: async (messageId: string, result?: any, claimToken?: string) => {
        if (!this.queueService) {
          throw new Error('QueueService not available in function context');
        }
        if (!messageId || typeof messageId !== 'string') {
          throw new Error('Message ID is required to complete a queue message');
        }
        const msg = await this.queueService.getMessage(messageId);
        if (!msg) {
          return false;
        }
        if (msg.queue.startsWith('_system:')) {
          throw new Error('Cannot complete messages belonging to reserved _system:* queues from user functions');
        }
        return await this.queueService.complete(messageId, result, claimToken);
      },
      fail: async (messageId: string, error?: string, options?: { backoffDelayMs?: number; claimToken?: string }) => {
        if (!this.queueService) {
          throw new Error('QueueService not available in function context');
        }
        if (!messageId || typeof messageId !== 'string') {
          throw new Error('Message ID is required to fail a queue message');
        }
        const msg = await this.queueService.getMessage(messageId);
        if (!msg) {
          return { retried: false, deadLettered: false, attempts: 0 };
        }
        if (msg.queue.startsWith('_system:')) {
          throw new Error('Cannot fail messages belonging to reserved _system:* queues from user functions');
        }
        const errMsg = error || 'Failed by function worker';
        return await this.queueService.fail(messageId, errMsg, options?.backoffDelayMs, options?.claimToken);
      },
      touch: async (messageId: string, extensionSeconds?: number, claimToken?: string) => {
        if (!this.queueService) {
          throw new Error('QueueService not available in function context');
        }
        if (!messageId || typeof messageId !== 'string') {
          throw new Error('Message ID is required to touch a queue message');
        }
        const msg = await this.queueService.getMessage(messageId);
        if (!msg) {
          return false;
        }
        if (msg.queue.startsWith('_system:')) {
          throw new Error('Cannot touch messages belonging to reserved _system:* queues from user functions');
        }
        return await this.queueService.touch(messageId, extensionSeconds ?? 30, claimToken);
      },
      getMessage: async (messageId: string) => {
        if (!this.queueService) {
          throw new Error('QueueService not available in function context');
        }
        if (!messageId || typeof messageId !== 'string') {
          return null;
        }
        const msg = await this.queueService.getMessage(messageId);
        if (msg && msg.queue.startsWith('_system:')) {
          return null;
        }
        return msg;
      },
    };

    return {
      sdk: {
        records: recordsBridge,
        queue: queueBridge,
      },
      network: {
        fetch: safeFetch as any,
      },
      observability: {
        log: () => {},
      },
      context: {
        app: this.appScope,
        request: requestCtx,
        event: eventCtx,
        env: fn.env || {},
        auth: (requestCtx && requestCtx.auth !== undefined) ? requestCtx.auth : (effectiveAuth || null),
      },
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
