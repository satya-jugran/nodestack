import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { EventBus } from '../core/events/EventBus';
import { RecordAfterEventContext } from '../core/events/types';
import { FunctionService } from '../functions/FunctionService';
import { QueueService } from '../queue/QueueService';
import { QueueJob } from '../queue/types';
import { FlowEngine } from './FlowEngine';
import {
  FlowConfig,
  FlowDefinition,
  FlowState,
  CreateFlowDto,
  UpdateFlowDto,
  FlowExecution,
  FlowExecutionOptions,
  FlowCheckpoint,
  FlowStepTransitionEvent,
  FlowResumeOptions,
} from './types';
import { FlowValidator } from './FlowValidator';
import { ChoiceEvaluator } from './runtime/ChoiceEvaluator';
import { AppError, NotFoundError, ConflictError } from '../core/errors/AppError';

export interface FlowServiceOptions {
  engine?: FlowEngine;
  recoveryStrategy?: 'abort' | 'resume';
  autoRecoverOnStartup?: boolean;
  queueService?: QueueService;
}

interface ExecutionWaiter {
  resolve: (exec: FlowExecution) => void;
  reject: (err: any) => void;
  timer?: NodeJS.Timeout;
}

export class FlowService {
  private engine: FlowEngine;
  private recoveryStrategy: 'abort' | 'resume';
  private queueService?: QueueService;
  private activeAbortControllers = new Map<string, AbortController>();
  private activeExecutionClaims = new Set<string>();
  private pendingExecutionAdmissions = new Set<string>();
  private executionWaiters = new Map<string, ExecutionWaiter>();

  constructor(
    private db: DatabaseService,
    private functionService?: FunctionService,
    private eventBus?: EventBus,
    private appScope: { id: string; slug: string; name?: string } = { id: 'default', slug: 'default' },
    options: FlowServiceOptions = {}
  ) {
    this.engine = options.engine || new FlowEngine();
    this.recoveryStrategy = options.recoveryStrategy || (process.env.FLOW_RECOVERY_STRATEGY as any) || 'abort';
    this.queueService = options.queueService;
    this.initTables();
    this.bindEvents();
    this.syncAllFlowQueues();

    if (options.autoRecoverOnStartup !== false) {
      this.handleStartupRecovery().catch((err) => {
        console.warn(`[FlowService] Startup recovery warning: ${err.message}`);
      });
    }
  }

  public static generateExecutionId(): string {
    return FlowEngine.generateExecutionId();
  }

  public static getFlowQueueName(flowId: string): string {
    return `_system:flow:${flowId}`;
  }

  public setQueueService(queueService: QueueService): void {
    this.queueService = queueService;
    this.syncAllFlowQueues();
  }

  public getQueueService(): QueueService | undefined {
    return this.queueService;
  }

  public getEngine(): FlowEngine {
    return this.engine;
  }

  public getRecoveryStrategy(): 'abort' | 'resume' {
    return this.recoveryStrategy;
  }

  public initTables(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS _flows (
          id TEXT PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          description TEXT DEFAULT '',
          enabled INTEGER NOT NULL DEFAULT 1,
          triggerType TEXT NOT NULL DEFAULT 'http',
          eventTrigger TEXT,
          maxConcurrentExecutions INTEGER DEFAULT NULL,
          definition TEXT NOT NULL,
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_flows_name ON _flows(name);
        CREATE INDEX IF NOT EXISTS idx_flows_eventTrigger ON _flows(eventTrigger);

        CREATE TABLE IF NOT EXISTS _flow_executions (
          id TEXT PRIMARY KEY,
          flowId TEXT NOT NULL,
          flowName TEXT NOT NULL,
          status TEXT NOT NULL,
          input TEXT,
          output TEXT,
          error TEXT,
          durationMs INTEGER NOT NULL,
          stepLogs TEXT,
          actorId TEXT,
          actor TEXT,
          queuedAt TEXT,
          jobId TEXT,
          startedAt TEXT NOT NULL,
          finishedAt TEXT,
          checkpoint TEXT,
          claimToken TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_flowexec_flowId ON _flow_executions(flowId);
        CREATE INDEX IF NOT EXISTS idx_flowexec_status ON _flow_executions(status);
        CREATE INDEX IF NOT EXISTS idx_flowexec_flow_status ON _flow_executions(flowId, status);
        CREATE INDEX IF NOT EXISTS idx_flowexec_startedAt ON _flow_executions(startedAt DESC);
      `);

      // Migration safeguards for existing databases
      try {
        this.db.exec('ALTER TABLE _flows ADD COLUMN maxConcurrentExecutions INTEGER DEFAULT NULL');
      } catch {}
      try {
        this.db.exec('ALTER TABLE _flow_executions ADD COLUMN checkpoint TEXT');
      } catch {}
      try {
        this.db.exec('ALTER TABLE _flow_executions ADD COLUMN claimToken TEXT');
      } catch {}
      try {
        this.db.exec('ALTER TABLE _flow_executions ADD COLUMN actor TEXT');
      } catch {}
      try {
        this.db.exec('ALTER TABLE _flow_executions ADD COLUMN queuedAt TEXT');
      } catch {}
      try {
        this.db.exec('ALTER TABLE _flow_executions ADD COLUMN jobId TEXT');
      } catch {}
      try {
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_flowexec_flow_status ON _flow_executions(flowId, status)');
      } catch {}
    } catch (err: any) {
      console.warn(`[FlowService] initTables warning: ${err.message}`);
    }
  }

  // ==========================================
  // Dedicated System Queue Provisioning
  // ==========================================

  public syncAllFlowQueues(): void {
    if (!this.queueService) return;
    // Register a single stateless prefix handler for all _system:flow:* queues (O(1) memory regardless of flow count)
    this.queueService.registerPrefixWorker('_system:flow:', async (job: QueueJob) => {
      return await this.processQueuedFlowJob(job);
    });
    try {
      const flows = this.getAllFlows();
      for (const flow of flows) {
        if (flow.maxConcurrentExecutions && flow.maxConcurrentExecutions >= 1) {
          this.syncFlowQueue(flow);
        }
      }
    } catch {
      // ignore if tables not ready
    }
  }

  public syncFlowQueue(flow: FlowConfig): void {
    if (!this.queueService) return;
    const queueName = FlowService.getFlowQueueName(flow.id);

    if (flow.enabled && flow.maxConcurrentExecutions && flow.maxConcurrentExecutions >= 1) {
      const visibilityTimeoutSeconds = Math.max(60, (flow.definition?.timeoutSeconds || 300) + 30);
      void this.queueService
        .upsertQueue({
          name: queueName,
          concurrency: flow.maxConcurrentExecutions,
          visibilityTimeoutSeconds,
          maxAttempts: 1,
          backoffDelayMs: 0,
          isSystem: true,
        })
        .catch(() => {});
    } else {
      if (!flow.maxConcurrentExecutions || flow.maxConcurrentExecutions < 1) {
        void this.drainAndRemoveFlowQueue(flow, queueName);
      }
    }
  }

  /**
   * Gracefully drains or migrates pending executions when a flow's concurrency limit is removed,
   * ensuring outstanding jobs/executions are not stranded before deleting the system queue.
   */
  private async drainAndRemoveFlowQueue(flow: FlowConfig, queueName: string): Promise<void> {
    if (!this.queueService) return;

    try {
      const existingQueue = await this.queueService.getQueue(queueName);
      if (!existingQueue) {
        // Queue already deleted or never existed: migrate any remaining queued executions directly
        await this.migrateQueuedExecutionsToUnconstrained(flow);
        return;
      }

      const stats = await this.queueService.getStats(queueName, true);
      const hasPendingJobs = stats.queued > 0 || stats.processing > 0;

      const queuedExecsRow = this.db
        .prepare("SELECT COUNT(*) as count FROM _flow_executions WHERE flowId = ? AND status = 'queued'")
        .get(flow.id) as any;
      const queuedExecCount = Number(queuedExecsRow?.count || 0);

      if (hasPendingJobs || queuedExecCount > 0) {
        // Concurrency limit removed: drain all pending jobs under the new unlimited setting
        // by boosting the queue concurrency so pending jobs process immediately in parallel
        const drainConcurrency = Math.max(50, stats.queued + stats.processing + queuedExecCount);
        const visibilityTimeoutSeconds = Math.max(60, (flow.definition?.timeoutSeconds || 300) + 30);
        await this.queueService.upsertQueue({
          name: queueName,
          concurrency: drainConcurrency,
          visibilityTimeoutSeconds,
          maxAttempts: 1,
          backoffDelayMs: 0,
          isSystem: true,
        });

        // If there are queued executions in _flow_executions that don't have active jobs in queue, ensure they are enqueued
        if (queuedExecCount > 0) {
          const rows = this.db
            .prepare("SELECT * FROM _flow_executions WHERE flowId = ? AND status = 'queued' ORDER BY queuedAt ASC, startedAt ASC")
            .all(flow.id) as any[];

          for (const row of rows) {
            const exec = this.mapRowToExecution(row);
            const jobId = exec.jobId || `job_${exec.id}`;
            const job = await this.queueService.getJob(jobId);
            if (!job) {
              await this.queueService.send({
                id: jobId,
                queue: queueName,
                groupKey: flow.id,
                maxAttempts: 1,
                payload: {
                  executionId: exec.id,
                  flowId: flow.id,
                  input: exec.input,
                  actor: exec.actor || (exec.actorId ? { id: exec.actorId } : null),
                },
              });
            }
          }
        }

        this.queueService.wakeWorker(queueName);
      } else {
        // No outstanding jobs or queued executions; safe to delete the system queue
        await this.queueService.deleteQueue(queueName);
      }
    } catch (err: any) {
      console.warn(`[FlowService] drainAndRemoveFlowQueue error for flow '${flow.name}': ${err.message}`);
    }
  }

  /**
   * Dispatches any stranded 'queued' executions directly in unconstrained mode.
   */
  private async migrateQueuedExecutionsToUnconstrained(flow: FlowConfig): Promise<number> {
    const queuedRows = this.db
      .prepare("SELECT * FROM _flow_executions WHERE flowId = ? AND status = 'queued' ORDER BY queuedAt ASC, startedAt ASC")
      .all(flow.id) as any[];

    if (!queuedRows || queuedRows.length === 0) return 0;

    for (const row of queuedRows) {
      const exec = this.mapRowToExecution(row);
      void this.dispatchUnconstrainedQueuedExecution(exec, flow);
    }

    return queuedRows.length;
  }

  private async dispatchUnconstrainedQueuedExecution(exec: FlowExecution, flow: FlowConfig): Promise<void> {
    if (this.activeExecutionClaims.has(exec.id)) return;
    this.activeExecutionClaims.add(exec.id);

    const claimToken = crypto.randomUUID();
    const abortController = new AbortController();
    this.activeAbortControllers.set(exec.id, abortController);

    const now = new Date().toISOString();
    const claimUpdate = this.db.prepare(`
      UPDATE _flow_executions
      SET status = 'running',
          startedAt = ?,
          claimToken = ?
      WHERE id = ? AND status = 'queued'
    `).run(now, claimToken, exec.id);

    if (Number(claimUpdate.changes) === 0) {
      this.activeExecutionClaims.delete(exec.id);
      this.activeAbortControllers.delete(exec.id);
      return;
    }

    try {
      const isResume = Boolean(
        (exec.checkpoint && ((exec.checkpoint.stepCount ?? 0) > 0 || exec.checkpoint.currentStateName !== flow.definition.startAt)) ||
        (exec.stepLogs && exec.stepLogs.length > 0)
      );
      let resumeFrom: FlowResumeOptions | undefined;
      if (isResume) {
        const resumeInfo = this.resolveResumeState(exec, flow);
        if ('completed' in resumeInfo) {
          this.saveExecution(resumeInfo.completed);
          this.settleWaiter(exec.id, resumeInfo.completed);
          return;
        }
        resumeFrom = resumeInfo.resumeFrom;
      }

      const execution = await this.engine.execute(flow.name, flow.definition, exec.input, {
        actor: exec.actor || (exec.actorId ? { id: exec.actorId } : null),
        functionService: this.functionService,
        executionId: exec.id,
        flowId: flow.id,
        executionOptions: {},
        signal: abortController.signal,
        resumeFrom,
        onStepTransition: async (event) => {
          this.persistCheckpoint(exec.id, event, claimToken);
        },
      });

      const finalExecution: FlowExecution = {
        ...execution,
        queuedAt: exec.queuedAt ?? null,
        jobId: exec.jobId ?? null,
      };
      this.saveExecution(finalExecution);
      this.settleWaiter(exec.id, finalExecution);
    } catch (err: any) {
      const current = this.getExecutionById(exec.id);
      if (current?.status === 'aborted') {
        this.settleWaiter(exec.id, undefined, err);
        return;
      }
      const failedExec: FlowExecution = {
        id: exec.id,
        flowId: flow.id,
        flowName: flow.name,
        status: 'failed',
        input: exec.input !== undefined ? exec.input : null,
        output: current?.output ?? null,
        error: err.message || String(err),
        durationMs: current?.durationMs || 0,
        stepLogs: current?.stepLogs || [],
        actorId: exec.actorId ?? null,
        actor: exec.actor ?? null,
        queuedAt: exec.queuedAt ?? null,
        jobId: exec.jobId ?? null,
        startedAt: current?.startedAt || now,
        finishedAt: new Date().toISOString(),
        checkpoint: current?.checkpoint ?? null,
        claimToken: null,
      };
      this.saveExecution(failedExec);
      this.settleWaiter(exec.id, undefined, err);
    } finally {
      this.releaseClaim(exec.id, claimToken);
      this.activeExecutionClaims.delete(exec.id);
      this.activeAbortControllers.delete(exec.id);
    }
  }

  private bindEvents(): void {
    if (!this.eventBus) {
      return;
    }

    this.eventBus.onRecordAfterCreate(async (ctx: RecordAfterEventContext) => {
      await this.handleRecordEvent('create', ctx.collection, ctx.record, undefined, ctx.auth);
    });

    this.eventBus.onRecordAfterUpdate(async (ctx: RecordAfterEventContext) => {
      await this.handleRecordEvent('update', ctx.collection, ctx.record, ctx.originalRecord, ctx.auth);
    });

    this.eventBus.onRecordAfterDelete(async (ctx: RecordAfterEventContext) => {
      await this.handleRecordEvent('delete', ctx.collection, ctx.record, undefined, ctx.auth);
    });
  }

  public async handleRecordEvent(
    action: 'create' | 'update' | 'delete',
    collection: string,
    record: any,
    originalRecord?: any,
    actor?: any
  ): Promise<void> {
    const flows = this.getAllFlows({ enabled: true });
    const afterAction = `after${action.charAt(0).toUpperCase() + action.slice(1)}`;
    const targetPatterns = [
      `${collection}:${action}`,
      `${collection}:${afterAction}`,
      `${collection}:*`,
      `*:${action}`,
      `*:${afterAction}`,
      '*:*',
      '*',
    ];

    const matchingFlows = flows.filter(
      (flow) =>
        flow.triggerType === 'event' &&
        flow.eventTrigger &&
        targetPatterns.includes(flow.eventTrigger)
    );

    for (const flow of matchingFlows) {
      const eventPayload = {
        collection,
        action,
        record,
        originalRecord,
        timestamp: new Date().toISOString(),
      };

      // Asynchronous event trigger (single-path through executeFlow with wait: false)
      const eventActor = actor || (flow.eventTrigger ? { id: `event:${flow.eventTrigger}` } : { id: 'system:event' });
      this.executeFlow(flow.id, eventPayload, eventActor, { wait: false }).catch((err) => {
        console.error(`[FlowService] Event trigger failed for flow '${flow.name}':`, err);
      });
    }
  }

  // ==========================================
  // Flow CRUD
  // ==========================================

  public getAllFlows(options?: { search?: string; enabled?: boolean }): FlowConfig[] {
    let sql = 'SELECT * FROM _flows WHERE 1=1';
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

    sql += ' ORDER BY created DESC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapRowToConfig(r));
  }

  public getFlowById(id: string): FlowConfig | null {
    const row = this.db.prepare('SELECT * FROM _flows WHERE id = ?').get(id) as any;
    return row ? this.mapRowToConfig(row) : null;
  }

  public getFlowByName(name: string): FlowConfig | null {
    const row = this.db.prepare('SELECT * FROM _flows WHERE name = ?').get(name) as any;
    return row ? this.mapRowToConfig(row) : null;
  }

  /**
   * Recursively extracts all function names/identifiers referenced in a flow definition.
   */
  public static extractReferencedFunctions(
    defOrStates: FlowDefinition | Record<string, FlowState> | null | undefined
  ): Set<string> {
    return FlowValidator.extractReferencedFunctions(defOrStates);
  }

  /**
   * Finds all flows that reference a function by name or ID.
   */
  public getFlowsReferencingFunction(functionName: string, functionId?: string): FlowConfig[] {
    const allFlows = this.getAllFlows();
    const matched: FlowConfig[] = [];
    const targetName = functionName ? functionName.trim() : '';
    const targetId = functionId ? functionId.trim() : '';

    for (const flow of allFlows) {
      if (!flow.definition || typeof flow.definition !== 'object' || Array.isArray(flow.definition)) {
        throw new AppError(
          `Failed to inspect flow dependencies: malformed definition in flow '${flow.name || flow.id}'`,
          500
        );
      }
      const referenced = FlowValidator.extractReferencedFunctions(flow.definition);
      if ((targetName && referenced.has(targetName)) || (targetId && referenced.has(targetId))) {
        matched.push(flow);
      }
    }

    return matched;
  }

  public createFlow(dto: CreateFlowDto, actor?: any): FlowConfig {
    if (!dto.name || typeof dto.name !== 'string' || !dto.name.trim()) {
      throw new AppError('Flow name is required', 400);
    }

    if (!dto.definition) {
      throw new AppError('Flow definition is required', 400);
    }
    FlowValidator.validate(dto.definition);
    FlowValidator.validateConcurrency(dto.maxConcurrentExecutions);

    const triggerType = dto.triggerType || 'http';
    const eventTrigger = triggerType === 'event' ? (dto.eventTrigger ? dto.eventTrigger.trim() : null) : null;
    FlowValidator.validateTrigger(triggerType, eventTrigger);

    const trimmedName = dto.name.trim();
    const existing = this.getFlowByName(trimmedName);
    if (existing) {
      throw new ConflictError(`Flow with name '${trimmedName}' already exists`);
    }

    const id = dto.id || `flow_${crypto.randomBytes(8).toString('hex')}`;
    const now = new Date().toISOString();
    const enabled = dto.enabled !== undefined ? (dto.enabled ? 1 : 0) : 1;
    const description = dto.description || '';
    const maxConcurrentExecutions =
      dto.maxConcurrentExecutions !== undefined && dto.maxConcurrentExecutions !== null
        ? dto.maxConcurrentExecutions
        : null;
    const definition = JSON.stringify(dto.definition);

    this.db.prepare(`
      INSERT INTO _flows (id, name, description, enabled, triggerType, eventTrigger, maxConcurrentExecutions, definition, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, trimmedName, description, enabled, triggerType, eventTrigger, maxConcurrentExecutions, definition, now, now);

    const created = this.getFlowById(id)!;
    this.syncFlowQueue(created);
    return created;
  }

  public updateFlow(id: string, dto: UpdateFlowDto, actor?: any): FlowConfig {
    const current = this.getFlowById(id);
    if (!current) {
      throw new NotFoundError(`Flow '${id}' not found`);
    }

    let name = current.name;
    if (dto.name !== undefined) {
      if (typeof dto.name !== 'string' || !dto.name.trim()) {
        throw new AppError('Flow name cannot be blank', 400);
      }
      const trimmedName = dto.name.trim();
      if (trimmedName !== current.name) {
        const existing = this.getFlowByName(trimmedName);
        if (existing && existing.id !== id) {
          throw new ConflictError(`Flow with name '${trimmedName}' already exists`);
        }
      }
      name = trimmedName;
    }

    if (dto.definition !== undefined) {
      FlowValidator.validate(dto.definition);
    }

    if (dto.maxConcurrentExecutions !== undefined) {
      FlowValidator.validateConcurrency(dto.maxConcurrentExecutions);
    }

    const triggerType = dto.triggerType !== undefined ? dto.triggerType : current.triggerType;
    let eventTrigger = dto.eventTrigger !== undefined ? dto.eventTrigger : current.eventTrigger;
    if (triggerType !== 'event') {
      eventTrigger = null;
    } else if (eventTrigger) {
      eventTrigger = eventTrigger.trim();
    }
    FlowValidator.validateTrigger(triggerType, eventTrigger);

    const description = dto.description !== undefined ? dto.description : current.description;
    const enabled = dto.enabled !== undefined ? (dto.enabled ? 1 : 0) : (current.enabled ? 1 : 0);
    const maxConcurrentExecutions =
      dto.maxConcurrentExecutions !== undefined
        ? dto.maxConcurrentExecutions
        : (current.maxConcurrentExecutions ?? null);
    const definition = dto.definition !== undefined ? JSON.stringify(dto.definition) : JSON.stringify(current.definition);
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE _flows SET
        name = ?, description = ?, enabled = ?, triggerType = ?, eventTrigger = ?, maxConcurrentExecutions = ?, definition = ?, updated = ?
      WHERE id = ?
    `).run(name, description, enabled, triggerType, eventTrigger, maxConcurrentExecutions, definition, now, id);

    const updated = this.getFlowById(id)!;
    this.syncFlowQueue(updated);
    return updated;
  }

  public deleteFlow(id: string, actor?: any): boolean {
    const current = this.getFlowById(id);
    if (!current) {
      throw new NotFoundError(`Flow '${id}' not found`);
    }

    if (this.queueService) {
      const queueName = FlowService.getFlowQueueName(id);
      void this.queueService.deleteQueue(queueName).catch(() => {});
    }

    this.db.prepare('DELETE FROM _flow_executions WHERE flowId = ?').run(id);
    this.db.prepare('DELETE FROM _flows WHERE id = ?').run(id);
    return true;
  }

  public countRunningExecutions(flowId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM _flow_executions WHERE flowId = ? AND status = 'running'")
      .get(flowId) as any;
    return Number(row?.count || 0);
  }

  // ==========================================
  // Execution, Concurrency Admission & Checkpointing
  // ==========================================

  public async executeFlow(
    flowIdOrName: string,
    input: any,
    actor?: any,
    options: FlowExecutionOptions = {}
  ): Promise<FlowExecution> {
    const flow = this.getFlowById(flowIdOrName) || this.getFlowByName(flowIdOrName);
    if (!flow) {
      throw new NotFoundError(`Flow '${flowIdOrName}' not found`);
    }

    if (!flow.enabled) {
      throw new AppError(`Flow '${flow.name}' is currently disabled`, 403);
    }

    const executionId = options.executionId || FlowService.generateExecutionId();
    if (this.activeExecutionClaims.has(executionId) || this.pendingExecutionAdmissions.has(executionId)) {
      throw new ConflictError(`Flow execution '${executionId}' is currently running`);
    }

    if (options.executionId) {
      const existing = this.getExecutionById(options.executionId);
      if (existing && (existing.status === 'running' || existing.status === 'queued' || existing.claimToken)) {
        throw new ConflictError(`Flow execution '${options.executionId}' is already running`);
      }
    }

    this.pendingExecutionAdmissions.add(executionId);

    const authContext = typeof actor === 'object' && actor !== null
      ? {
          id: actor.id || actor.email || null,
          email: actor.email,
          isAdmin: Boolean(actor.isAdmin),
          isApiKey: Boolean(actor.isApiKey),
          role: actor.role,
          collection: actor.collection,
        }
      : (typeof actor === 'string' ? { id: actor } : null);

    const now = new Date().toISOString();
    const initialCheckpoint: FlowCheckpoint = {
      currentStateName: flow.definition.startAt,
      currentPayload: input !== undefined ? input : {},
      stepCount: 0,
      loopCounters: {},
      updatedAt: now,
    };

    // Single-Path Concurrency Throttling via QueueService when maxConcurrentExecutions >= 1
    if (flow.maxConcurrentExecutions && flow.maxConcurrentExecutions >= 1 && this.queueService) {
      const jobId = `job_${executionId}`;
      const shouldWait = options.wait !== false;

      const queuedExec: FlowExecution = {
        id: executionId,
        flowId: flow.id,
        flowName: flow.name,
        status: 'queued',
        input: input !== undefined ? input : null,
        durationMs: 0,
        stepLogs: [],
        actorId: authContext?.id || (typeof actor === 'string' ? actor : null),
        actor: authContext,
        queuedAt: now,
        jobId,
        startedAt: now,
        checkpoint: initialCheckpoint,
        claimToken: null,
      };

      // Persist queued execution immediately before yielding, atomically reserving executionId in DB
      this.saveExecution(queuedExec);

      let waitPromise: Promise<FlowExecution> | null = null;
      if (shouldWait) {
        const timeoutMs =
          options.timeoutMs || (flow.definition.timeoutSeconds ? flow.definition.timeoutSeconds * 1000 : 30000);

        waitPromise = new Promise<FlowExecution>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.executionWaiters.delete(executionId);
            try {
              this.abortExecution(
                executionId,
                `Flow '${flow.name}' execution timed out after ${timeoutMs}ms`
              );
            } catch {}
            const timeoutErr = new AppError(
              `Flow '${flow.name}' execution timed out after ${timeoutMs}ms`,
              408
            );
            (timeoutErr as any).status = 'timeout';
            reject(timeoutErr);
          }, timeoutMs);

          this.executionWaiters.set(executionId, { resolve, reject, timer });
        });
      }

      try {
        const queueName = FlowService.getFlowQueueName(flow.id);
        const existingQueue = await this.queueService.getQueue(queueName);
        if (!existingQueue || existingQueue.concurrency !== flow.maxConcurrentExecutions) {
          const visibilityTimeoutSeconds = Math.max(60, (flow.definition?.timeoutSeconds || 300) + 30);
          await this.queueService.upsertQueue({
            name: queueName,
            concurrency: flow.maxConcurrentExecutions,
            visibilityTimeoutSeconds,
            maxAttempts: 1,
            backoffDelayMs: 0,
            isSystem: true,
          });
        }

        await this.queueService.send({
          id: jobId,
          queue: queueName,
          groupKey: flow.id,
          maxAttempts: 1,
          payload: {
            executionId,
            flowId: flow.id,
            input,
            actor: authContext || actor,
            executionOptions: options,
          },
        });
      } catch (err: any) {
        this.executionWaiters.delete(executionId);
        try {
          this.db
            .prepare("DELETE FROM _flow_executions WHERE id = ? AND status = 'queued' AND claimToken IS NULL")
            .run(executionId);
        } catch {}
        throw err;
      } finally {
        this.pendingExecutionAdmissions.delete(executionId);
      }

      if (!shouldWait) {
        return this.getExecutionById(executionId) || queuedExec;
      }

      return await waitPromise!;
    }

    // Unconstrained execution path (maxConcurrentExecutions is null / undefined)
    try {
      const shouldWait = options.wait !== false;
      this.activeExecutionClaims.add(executionId);
      const claimToken = crypto.randomUUID();
      const abortController = new AbortController();
      this.activeAbortControllers.set(executionId, abortController);

      const initialRunning: FlowExecution = {
        id: executionId,
        flowId: flow.id,
        flowName: flow.name,
        status: 'running',
        input: input !== undefined ? input : null,
        durationMs: 0,
        stepLogs: [],
        actorId: authContext?.id || (typeof actor === 'string' ? actor : null),
        actor: authContext,
        queuedAt: null,
        jobId: null,
        startedAt: now,
        checkpoint: initialCheckpoint,
        claimToken,
      };

      // Atomically persist initial 'running' record so callers can poll immediately
      this.saveExecution(initialRunning);

      const runPromise = (async (): Promise<FlowExecution> => {
        try {
          const execution = await this.engine.execute(flow.name, flow.definition, input, {
            actor: authContext || actor,
            functionService: this.functionService,
            executionId,
            flowId: flow.id,
            executionOptions: options,
            signal: abortController.signal,
            onStepTransition: async (event) => {
              this.persistCheckpoint(executionId, event, claimToken);
            },
          });

          this.saveExecution(execution);
          return execution;
        } catch (err: any) {
          const existing = this.getExecutionById(executionId);
          if (existing?.status === 'aborted') {
            throw err;
          }
          this.saveExecution({
            id: executionId,
            flowId: flow.id,
            flowName: flow.name,
            status: 'failed',
            input: input !== undefined ? input : null,
            output: existing?.output ?? null,
            error: err.message || String(err),
            durationMs: existing?.durationMs || 0,
            stepLogs: existing?.stepLogs || [],
            actorId: authContext?.id || (typeof actor === 'string' ? actor : null),
            actor: authContext,
            queuedAt: existing?.queuedAt ?? null,
            jobId: existing?.jobId ?? null,
            startedAt: existing?.startedAt || now,
            finishedAt: new Date().toISOString(),
            checkpoint: existing?.checkpoint ?? null,
            claimToken: null,
          });
          throw err;
        } finally {
          this.releaseClaim(executionId, claimToken);
          this.activeExecutionClaims.delete(executionId);
          this.activeAbortControllers.delete(executionId);
        }
      })();

      if (!shouldWait) {
        runPromise.catch((err) => {
          console.error(`[FlowService] Background execution failed for flow '${flow.name}':`, err);
        });
        return initialRunning;
      }

      return await runPromise;
    } finally {
      this.pendingExecutionAdmissions.delete(executionId);
    }
  }

  /**
   * Worker handler invoked by QueueService for `_system:flow:${flow.id}` jobs.
   */
  private async processQueuedFlowJob(job: QueueJob): Promise<FlowExecution | null> {
    const payload = job.payload || {};
    const { executionId, flowId, input, actor, executionOptions } = payload;
    if (!executionId || !flowId) {
      return null;
    }

    const existing = this.getExecutionById(executionId);
    if (!existing || existing.status === 'aborted' || existing.status === 'cancelled' || existing.status === 'succeeded') {
      return existing;
    }

    const flow = this.getFlowById(flowId);
    if (!flow || !flow.enabled) {
      const reason = !flow ? `Flow '${flowId}' no longer exists` : `Flow '${flow.name}' is currently disabled`;
      const aborted = this.abortExecution(executionId, reason);
      this.settleWaiter(executionId, undefined, new AppError(reason, !flow ? 404 : 403));
      return aborted;
    }

    if (this.activeExecutionClaims.has(executionId)) {
      return existing;
    }

    this.activeExecutionClaims.add(executionId);
    const claimToken = crypto.randomUUID();
    const abortController = new AbortController();
    this.activeAbortControllers.set(executionId, abortController);
    const startedAt = new Date().toISOString();

    const authContext = existing.actor || (typeof actor === 'object' && actor !== null ? actor : (typeof actor === 'string' ? { id: actor } : null));

    // Transition from 'queued' -> 'running'
    const claimUpdate = this.db.prepare(`
      UPDATE _flow_executions
      SET status = 'running',
          startedAt = COALESCE(startedAt, ?),
          claimToken = ?
      WHERE id = ? AND status = 'queued'
    `).run(startedAt, claimToken, executionId);

    if ( Number(claimUpdate.changes) === 0 ) {
      this.activeExecutionClaims.delete(executionId);
      this.activeAbortControllers.delete(executionId);
      return this.getExecutionById(executionId);
    }

    const isResume = Boolean(payload.isResume);
    const resumeRequired = Boolean(
      isResume ||
      (existing.checkpoint && ((existing.checkpoint.stepCount ?? 0) > 0 || existing.checkpoint.currentStateName !== flow.definition.startAt)) ||
      (existing.stepLogs && existing.stepLogs.length > 0)
    );
    let resumeFrom: FlowResumeOptions | undefined;
    let resumePayload: any;
    if (resumeRequired) {
      const resumeInfo = this.resolveResumeState(existing, flow);
      if ('completed' in resumeInfo) {
        this.saveExecution(resumeInfo.completed);
        this.settleWaiter(executionId, resumeInfo.completed);
        return resumeInfo.completed;
      }
      resumeFrom = resumeInfo.resumeFrom;
      resumePayload = resumeInfo.resumePayload;
    }

    try {
      const execution = await this.engine.execute(
        flow.name,
        flow.definition,
        resumeRequired ? (existing.input !== undefined ? existing.input : input) : input,
        {
          actor: authContext || actor,
          functionService: this.functionService,
          executionId,
          flowId: flow.id,
          executionOptions: executionOptions || {},
          signal: abortController.signal,
          resumeFrom,
          onStepTransition: async (event) => {
            this.persistCheckpoint(executionId, event, claimToken);
            if (this.queueService) {
              void this.queueService.touch(job.id, 60).catch(() => {});
            }
          },
        }
      );

      const finalExecution: FlowExecution = {
        ...execution,
        queuedAt: existing.queuedAt ?? null,
        jobId: job.id,
      };
      this.saveExecution(finalExecution);
      this.settleWaiter(executionId, finalExecution);
      return finalExecution;
    } catch (err: any) {
      const current = this.getExecutionById(executionId);
      if (current?.status === 'aborted') {
        this.settleWaiter(executionId, undefined, err);
        return current;
      }

      const failedExec: FlowExecution = {
        id: executionId,
        flowId: flow.id,
        flowName: flow.name,
        status: 'failed',
        input: input !== undefined ? input : (existing.input ?? null),
        output: current?.output ?? (resumeRequired ? resumePayload : null),
        error: err.message || String(err),
        durationMs: current?.durationMs || (resumeRequired ? existing.durationMs : 0),
        stepLogs: current?.stepLogs || (resumeRequired ? existing.stepLogs : []),
        actorId: existing.actorId,
        actor: authContext,
        queuedAt: existing.queuedAt ?? null,
        jobId: job.id,
        startedAt: current?.startedAt || startedAt,
        finishedAt: new Date().toISOString(),
        checkpoint: current?.checkpoint ?? null,
        claimToken: null,
      };
      this.saveExecution(failedExec);

      if (this.executionWaiters.has(executionId)) {
        this.settleWaiter(executionId, undefined, err);
        return failedExec;
      }

      throw err;
    } finally {
      this.releaseClaim(executionId, claimToken);
      this.activeExecutionClaims.delete(executionId);
      this.activeAbortControllers.delete(executionId);
      if (this.queueService) {
        void this.checkAndCleanupDrainedFlowQueue(flow.id, job.queue);
      }
    }
  }

  private async checkAndCleanupDrainedFlowQueue(flowId: string, queueName: string): Promise<void> {
    if (!this.queueService) return;
    try {
      const flow = this.getFlowById(flowId);
      if (!flow || !flow.maxConcurrentExecutions || flow.maxConcurrentExecutions < 1) {
        const stats = await this.queueService.getStats(queueName, true);
        if (stats.queued === 0 && stats.processing <= 1) {
          const remainingQueued = this.db
            .prepare("SELECT COUNT(*) as count FROM _flow_executions WHERE flowId = ? AND status = 'queued'")
            .get(flowId) as any;
          if (Number(remainingQueued?.count || 0) === 0) {
            await this.queueService.deleteQueue(queueName);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  private settleWaiter(executionId: string, execution?: FlowExecution, error?: any): void {
    const waiter = this.executionWaiters.get(executionId);
    if (!waiter) return;
    this.executionWaiters.delete(executionId);
    if (waiter.timer) {
      clearTimeout(waiter.timer);
    }
    if (error) {
      waiter.reject(error);
    } else if (execution) {
      waiter.resolve(execution);
    }
  }

  private releaseClaim(executionId: string, claimToken: string): void {
    try {
      this.db.prepare(`
        UPDATE _flow_executions
        SET claimToken = NULL
        WHERE id = ? AND claimToken = ?
      `).run(executionId, claimToken);
    } catch (err: any) {
      console.warn(`[FlowService] Failed to release claim for execution '${executionId}': ${err.message}`);
    }
  }

  /**
   * Atomically persists the step logs and execution state after each transition.
   */
  public persistCheckpoint(executionId: string, event: FlowStepTransitionEvent, claimToken?: string): void {
    const controller = this.activeAbortControllers.get(executionId);
    if (controller?.signal.aborted) {
      const cancelErr = new AppError('Execution has been aborted', 499);
      (cancelErr as any).status = 'cancelled';
      throw cancelErr;
    }

    try {
      const isTerminal = event.status !== 'running';
      const finishedAt = isTerminal ? new Date().toISOString() : null;
      const error = event.status === 'failed' ? (event.stepLog?.error || 'Step execution failed') : null;
      const checkpoint = event.status === 'succeeded' ? null : event.checkpoint;

      const updateResult = this.db.prepare(`
        UPDATE _flow_executions SET
          status = ?,
          stepLogs = ?,
          output = ?,
          error = COALESCE(?, error),
          durationMs = ?,
          finishedAt = COALESCE(?, finishedAt),
          checkpoint = ?
        WHERE id = ? AND status = 'running' AND (? IS NULL OR claimToken = ? OR claimToken IS NULL)
      `).run(
        event.status,
        JSON.stringify(event.stepLogs),
        event.payload !== undefined ? JSON.stringify(event.payload) : null,
        error,
        event.durationMs,
        finishedAt,
        checkpoint ? JSON.stringify(checkpoint) : null,
        executionId,
        claimToken || null,
        claimToken || null
      );

      if (updateResult.changes === 0) {
        const current = this.db.prepare('SELECT status, error, claimToken FROM _flow_executions WHERE id = ?').get(executionId) as any;
        if (current && (current.status === 'aborted' || current.status === 'cancelled')) {
          const cancelErr = new AppError(current.error || `Execution '${executionId}' was aborted`, 499);
          (cancelErr as any).status = 'cancelled';
          throw cancelErr;
        }
        if (current && claimToken && current.claimToken && current.claimToken !== claimToken) {
          const supersededErr = new AppError(`Execution '${executionId}' has been claimed by another runner`, 409);
          (supersededErr as any).status = 'superseded';
          throw supersededErr;
        }
      }
    } catch (err: any) {
      if ((err as any)?.status === 'cancelled' || (err as any)?.statusCode === 499 || (err as any)?.statusCode === 409) {
        throw err;
      }
      console.error(`[FlowService] Failed to persist checkpoint for execution '${executionId}': ${err.message}`);
      try {
        this.db.prepare("UPDATE _flow_executions SET checkpoint = NULL, error = ? WHERE id = ?").run(
          `Checkpoint persistence failed: ${err.message}`,
          executionId
        );
      } catch {}
      throw new AppError(`Failed to persist checkpoint for execution '${executionId}': ${err.message}`, 500);
    }
  }

  /**
   * Aborts an active ('running') or pending ('queued') flow execution with status: 'aborted'.
   */
  public abortExecution(executionId: string, reason: string = 'Execution aborted due to server restart'): FlowExecution {
    const controller = this.activeAbortControllers.get(executionId);
    if (controller) {
      controller.abort(reason);
      this.activeAbortControllers.delete(executionId);
    }

    const exec = this.getExecutionById(executionId);
    if (!exec) {
      throw new NotFoundError(`Flow execution '${executionId}' not found`);
    }

    if (exec.status !== 'running' && exec.status !== 'queued') {
      return exec;
    }

    if (exec.jobId && this.queueService) {
      void this.queueService.cancel(exec.jobId).catch(() => {});
    }

    const aborted: FlowExecution = {
      ...exec,
      status: 'aborted',
      error: reason,
      finishedAt: new Date().toISOString(),
      checkpoint: null,
      claimToken: null,
    };
    this.saveExecution(aborted);

    const abortErr = new AppError(reason, 499);
    (abortErr as any).status = 'aborted';
    this.settleWaiter(executionId, undefined, abortErr);

    return aborted;
  }

  /**
   * Resolves the next state, payload, and checkpoint options when resuming an execution.
   */
  private resolveResumeState(
    exec: FlowExecution,
    flow: FlowConfig
  ): { completed: FlowExecution } | { resumeFrom: FlowResumeOptions; nextStateName: string; resumePayload: any } {
    let nextStateName: string | undefined = exec.checkpoint?.currentStateName ?? undefined;
    let resumePayload =
      exec.checkpoint?.currentPayload !== undefined
        ? exec.checkpoint.currentPayload
        : (exec.output ?? exec.input ?? {});

    // If checkpoint.currentStateName is not explicitly set, determine from stepLogs
    if (!nextStateName) {
      if (!exec.stepLogs || exec.stepLogs.length === 0) {
        nextStateName = flow.definition.startAt;
        resumePayload = exec.input !== undefined ? exec.input : {};
      } else {
        const lastStep = exec.stepLogs[exec.stepLogs.length - 1];
        const lastState = flow.definition.states[lastStep.step];

        if (lastStep.status === 'failed') {
          nextStateName = lastStep.step;
          resumePayload = lastStep.input !== undefined ? lastStep.input : {};
        } else if (lastStep.nextState) {
          // Use actual transition persisted in the step log
          nextStateName = lastStep.nextState;
          resumePayload = lastStep.output !== undefined ? lastStep.output : {};
        } else if (lastState && (lastState.end || lastState.type === 'Succeed')) {
          // Explicitly terminal state completed successfully
          const completed: FlowExecution = {
            ...exec,
            status: 'succeeded',
            finishedAt: new Date().toISOString(),
            checkpoint: null,
            claimToken: null,
          };
          return { completed };
        } else if (lastState?.type === 'Choice') {
          // Reconstruct dynamic branch from Choice state definition and payload
          const payload = lastStep.output !== undefined ? lastStep.output : (lastStep.input ?? {});
          const chosenNext = ChoiceEvaluator.findNextState(lastState.choices, lastState.default, payload);
          if (chosenNext) {
            nextStateName = chosenNext;
            resumePayload = payload;
          } else {
            this.abortExecution(
              exec.id,
              `Cannot reconstruct Choice branch for state '${lastStep.step}' (no matching choice and no default)`
            );
            throw new AppError(
              `Cannot reconstruct Choice branch for state '${lastStep.step}' for execution '${exec.id}'`,
              400
            );
          }
        } else if (lastState && typeof (lastState as any).next === 'string' && (lastState as any).next) {
          // Static next transition
          nextStateName = (lastState as any).next;
          resumePayload = lastStep.output !== undefined ? lastStep.output : {};
        } else {
          // Cannot reconstruct next state: abort rather than assuming completion
          const reason = !lastState
            ? `State '${lastStep.step}' no longer exists in flow definition`
            : `Cannot reconstruct next state following '${lastStep.step}' (type '${lastState.type}')`;
          this.abortExecution(exec.id, reason);
          throw new AppError(
            `Cannot reconstruct next state following '${lastStep.step}' for execution '${exec.id}': ${reason}`,
            400
          );
        }
      }
    }

    if (!nextStateName || !flow.definition.states[nextStateName]) {
      this.abortExecution(exec.id, `Checkpoint state '${nextStateName || 'unknown'}' not found in flow definition`);
      throw new AppError(`Checkpoint state '${nextStateName || 'unknown'}' not found in flow definition`, 400);
    }

    return {
      resumeFrom: {
        stateName: nextStateName,
        payload: resumePayload,
        stepLogs: exec.stepLogs || [],
        loopCounters: exec.checkpoint?.loopCounters,
        stepCount: exec.checkpoint?.stepCount || (exec.stepLogs || []).length,
        startedAt: exec.startedAt,
        durationMs: exec.durationMs,
      },
      nextStateName,
      resumePayload,
    };
  }

  /**
   * Resumes an interrupted or orphaned running flow from its last completed checkpoint.
   * If the flow has maxConcurrentExecutions >= 1 and QueueService is configured,
   * routes the resumption through the flow's system queue to acquire a concurrency slot.
   */
  public async resumeExecution(
    executionId: string,
    options: FlowExecutionOptions = {}
  ): Promise<FlowExecution> {
    if (this.activeExecutionClaims.has(executionId) || this.pendingExecutionAdmissions.has(executionId)) {
      throw new ConflictError(`Flow execution '${executionId}' is currently being executed or resumed`);
    }

    const exec = this.getExecutionById(executionId);
    if (!exec) {
      throw new NotFoundError(`Flow execution '${executionId}' not found`);
    }
    if (exec.claimToken) {
      throw new ConflictError(`Flow execution '${executionId}' is already claimed by another runner`);
    }
    if (exec.status !== 'running' && exec.status !== 'failed') {
      throw new AppError(`Cannot resume flow execution '${executionId}' with status '${exec.status}'`, 400);
    }

    const flow = this.getFlowById(exec.flowId) || this.getFlowByName(exec.flowName);
    if (!flow) {
      this.abortExecution(executionId, `Flow '${exec.flowName}' no longer exists`);
      throw new NotFoundError(`Flow '${exec.flowName}' no longer exists`);
    }

    if (!flow.enabled) {
      this.abortExecution(executionId, `Flow '${flow.name}' is currently disabled`);
      throw new AppError(`Flow '${flow.name}' is currently disabled`, 403);
    }

    const resumeInfo = this.resolveResumeState(exec, flow);
    if ('completed' in resumeInfo) {
      this.saveExecution(resumeInfo.completed);
      return resumeInfo.completed;
    }

    this.pendingExecutionAdmissions.add(executionId);

    // Throttled flow path: route through system queue to acquire a concurrency slot
    if (flow.maxConcurrentExecutions && flow.maxConcurrentExecutions >= 1 && this.queueService) {
      const jobId = `job_${executionId}_resume_${Date.now()}`;
      const now = new Date().toISOString();
      const shouldWait = options.wait !== false;

      // Atomically claim and transition to 'queued' synchronously before yielding
      const queueClaimResult = this.db.prepare(`
        UPDATE _flow_executions
        SET status = 'queued',
            claimToken = NULL,
            error = NULL,
            finishedAt = NULL,
            jobId = ?,
            queuedAt = ?
        WHERE id = ?
          AND (status = 'running' OR status = 'failed')
          AND (claimToken IS NULL OR claimToken = '')
      `).run(jobId, now, executionId);

      if (queueClaimResult.changes === 0) {
        this.pendingExecutionAdmissions.delete(executionId);
        const current = this.getExecutionById(executionId);
        if (current?.claimToken) {
          throw new ConflictError(`Flow execution '${executionId}' is already claimed by another runner`);
        }
        if (current?.status === 'queued') {
          throw new ConflictError(`Flow execution '${executionId}' is currently being executed or resumed`);
        }
        throw new ConflictError(`Could not claim flow execution '${executionId}'`);
      }

      let waitPromise: Promise<FlowExecution> | null = null;
      if (shouldWait) {
        const timeoutMs =
          options.timeoutMs || (flow.definition.timeoutSeconds ? flow.definition.timeoutSeconds * 1000 : 30000);

        waitPromise = new Promise<FlowExecution>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.executionWaiters.delete(executionId);
            try {
              this.abortExecution(
                executionId,
                `Flow '${flow.name}' execution timed out after ${timeoutMs}ms`
              );
            } catch {}
            const timeoutErr = new AppError(
              `Flow '${flow.name}' execution timed out after ${timeoutMs}ms`,
              408
            );
            (timeoutErr as any).status = 'timeout';
            reject(timeoutErr);
          }, timeoutMs);

          this.executionWaiters.set(executionId, { resolve, reject, timer });
        });
      }

      try {
        const queueName = FlowService.getFlowQueueName(flow.id);
        const existingQueue = await this.queueService.getQueue(queueName);
        if (!existingQueue || existingQueue.concurrency !== flow.maxConcurrentExecutions) {
          const visibilityTimeoutSeconds = Math.max(60, (flow.definition?.timeoutSeconds || 300) + 30);
          await this.queueService.upsertQueue({
            name: queueName,
            concurrency: flow.maxConcurrentExecutions,
            visibilityTimeoutSeconds,
            maxAttempts: 1,
            backoffDelayMs: 0,
            isSystem: true,
          });
        }

        if (exec.jobId) {
          try {
            await this.queueService.cancel(exec.jobId);
          } catch {}
        }

        await this.queueService.send({
          id: jobId,
          queue: queueName,
          groupKey: flow.id,
          maxAttempts: 1,
          payload: {
            executionId,
            flowId: flow.id,
            input: exec.input,
            actor: exec.actor || (exec.actorId ? { id: exec.actorId } : null),
            isResume: true,
            executionOptions: options,
          },
        });
      } catch (err: any) {
        this.executionWaiters.delete(executionId);
        throw err;
      } finally {
        this.pendingExecutionAdmissions.delete(executionId);
      }

      if (!shouldWait) {
        return this.getExecutionById(executionId)!;
      }

      return await waitPromise!;
    }

    // Unconstrained flow path (no queue / unlimited concurrency)
    try {
      this.activeExecutionClaims.add(executionId);
      const claimToken = crypto.randomUUID();
      let claimed = false;

      try {
        const claimResult = this.db.prepare(`
          UPDATE _flow_executions
          SET claimToken = ?, status = 'running', finishedAt = NULL, error = NULL
          WHERE id = ?
            AND (claimToken IS NULL OR claimToken = '')
            AND (status = 'running' OR status = 'failed')
        `).run(claimToken, executionId);

        if (claimResult.changes === 0) {
          const current = this.getExecutionById(executionId);
          if (current?.claimToken) {
            throw new ConflictError(`Flow execution '${executionId}' is already claimed by another runner`);
          }
          if (current?.status !== 'running' && current?.status !== 'failed') {
            throw new AppError(`Cannot resume flow execution '${executionId}' with status '${current?.status}'`, 400);
          }
          throw new ConflictError(`Could not claim flow execution '${executionId}'`);
        }
        claimed = true;

        const abortController = new AbortController();
        this.activeAbortControllers.set(executionId, abortController);
        const recoveryActor = exec.actor || (exec.actorId ? { id: exec.actorId } : undefined);
        const shouldWait = options.wait !== false;

        const runPromise = (async (): Promise<FlowExecution> => {
          try {
            const execution = await this.engine.execute(flow.name, flow.definition, exec.input, {
              actor: recoveryActor,
              functionService: this.functionService,
              executionId: exec.id,
              flowId: flow.id,
              executionOptions: options,
              signal: abortController.signal,
              onStepTransition: async (event) => {
                this.persistCheckpoint(exec.id, event, claimToken);
              },
              resumeFrom: resumeInfo.resumeFrom,
            });

            const mergedExecution: FlowExecution = {
              ...execution,
              queuedAt: exec.queuedAt ?? null,
              jobId: exec.jobId ?? null,
            };
            this.saveExecution(mergedExecution);
            return mergedExecution;
          } catch (err: any) {
            const existing = this.getExecutionById(executionId);
            if (existing?.status === 'aborted') {
              throw err;
            }
            const failedExec: FlowExecution = {
              id: exec.id,
              flowId: flow.id,
              flowName: flow.name,
              status: 'failed',
              input: exec.input,
              output: existing?.output ?? resumeInfo.resumePayload,
              error: err.message || String(err),
              durationMs: existing?.durationMs || exec.durationMs,
              stepLogs: existing?.stepLogs || exec.stepLogs,
              actorId: exec.actorId,
              actor: exec.actor,
              queuedAt: exec.queuedAt ?? null,
              jobId: exec.jobId ?? null,
              startedAt: exec.startedAt,
              finishedAt: new Date().toISOString(),
              checkpoint: existing?.checkpoint ?? null,
              claimToken: null,
            };
            this.saveExecution(failedExec);
            throw err;
          } finally {
            this.releaseClaim(executionId, claimToken);
            this.activeExecutionClaims.delete(executionId);
            this.activeAbortControllers.delete(executionId);
          }
        })();

        if (!shouldWait) {
          runPromise.catch((err) => {
            console.error(`[FlowService] Background resumed execution failed for flow '${flow.name}':`, err);
          });
          return this.getExecutionById(executionId)!;
        }

        return await runPromise;
      } finally {
        if (!claimed) {
          this.activeExecutionClaims.delete(executionId);
        }
      }
    } finally {
      this.pendingExecutionAdmissions.delete(executionId);
    }
  }

  /**
   * Recovers orphaned running flows on startup (either fails gracefully with 'aborted' or resumes from checkpoint),
   * and ensures any pending 'queued' executions are drained through QueueService.
   */
  public async recoverOrphanedExecutions(strategy: 'abort' | 'resume' = this.recoveryStrategy): Promise<FlowExecution[]> {
    if (strategy !== undefined && strategy !== 'abort' && strategy !== 'resume') {
      throw new AppError(`Invalid recovery strategy '${strategy}'. Must be 'abort' or 'resume'.`, 400);
    }

    try {
      this.db.prepare("UPDATE _flow_executions SET claimToken = NULL WHERE status = 'running'").run();
    } catch {}

    const orphanedRows = this.db
      .prepare("SELECT * FROM _flow_executions WHERE status = 'running'")
      .all() as any[];

    const recovered: FlowExecution[] = [];

    if (orphanedRows && orphanedRows.length > 0) {
      for (const row of orphanedRows) {
        const exec = this.mapRowToExecution(row);
        // Cancel any processing queue job associated with this running execution so QueueService doesn't re-run it from scratch
        if (exec.jobId && this.queueService) {
          try {
            await this.queueService.cancel(exec.jobId);
          } catch {}
        }

        try {
          if (strategy === 'resume') {
            const flow = this.getFlowById(exec.flowId) || this.getFlowByName(exec.flowName);
            const isThrottled = Boolean(
              flow?.maxConcurrentExecutions && flow.maxConcurrentExecutions >= 1 && this.queueService
            );
            // Route through admission mechanism: throttled flows queue without blocking startup; unconstrained flows execute
            const resumed = await this.resumeExecution(exec.id, isThrottled ? { wait: false } : undefined);
            recovered.push(resumed);
          } else {
            const aborted = this.abortExecution(exec.id, 'Execution aborted due to server restart');
            recovered.push(aborted);
          }
        } catch (err: any) {
          console.warn(`[FlowService] Failed to recover orphaned execution '${exec.id}': ${err.message}`);
          if (err instanceof ConflictError || (err as any)?.statusCode === 409) {
            continue;
          }
          if (strategy === 'resume') {
            try {
              const aborted = this.abortExecution(exec.id, `Recovery failed: ${err.message}`);
              recovered.push(aborted);
            } catch {}
          }
        }
      }
    }

    // Reconcile and drain any 'queued' executions waiting in _flow_executions
    if (this.queueService) {
      this.syncAllFlowQueues();
      const queuedRows = this.db
        .prepare("SELECT * FROM _flow_executions WHERE status = 'queued' ORDER BY queuedAt ASC, startedAt ASC")
        .all() as any[];

      for (const row of queuedRows) {
        const exec = this.mapRowToExecution(row);
        const flow = this.getFlowById(exec.flowId);
        if (!flow || !flow.enabled) {
          this.abortExecution(exec.id, !flow ? `Flow '${exec.flowName}' no longer exists` : `Flow '${flow.name}' is disabled`);
          continue;
        }
        this.syncFlowQueue(flow);
        const queueName = FlowService.getFlowQueueName(flow.id);
        const jobId = exec.jobId || `job_${exec.id}`;
        const existingJob = await this.queueService.getJob(jobId);

        if (!existingJob) {
          const isResume = Boolean(
            (exec.checkpoint && ((exec.checkpoint.stepCount ?? 0) > 0 || exec.checkpoint.currentStateName !== flow.definition.startAt)) ||
            (exec.stepLogs && exec.stepLogs.length > 0)
          );
          await this.queueService.send({
            id: jobId,
            queue: queueName,
            groupKey: flow.id,
            maxAttempts: 1,
            payload: {
              executionId: exec.id,
              flowId: flow.id,
              input: exec.input,
              actor: exec.actor || (exec.actorId ? { id: exec.actorId } : null),
              isResume,
            },
          });
        } else {
          this.queueService.wakeWorker(queueName);
        }
      }
    }

    return recovered;
  }

  public async handleStartupRecovery(): Promise<FlowExecution[]> {
    return this.recoverOrphanedExecutions(this.recoveryStrategy);
  }

  public getExecutions(options?: { flowId?: string; status?: string; page?: number; perPage?: number }): {
    items: FlowExecution[];
    totalItems: number;
    page: number;
    perPage: number;
  } {
    const page = Math.max(1, options?.page || 1);
    const perPage = Math.max(1, Math.min(options?.perPage || 20, 100));
    const offset = (page - 1) * perPage;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (options?.flowId) {
      whereClause += ' AND flowId = ?';
      params.push(options.flowId);
    }

    if (options?.status && options.status !== 'all') {
      whereClause += ' AND status = ?';
      params.push(options.status);
    }

    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM _flow_executions ${whereClause}`).get(...params) as any;
    const totalItems = countRow?.total || 0;

    const rows = this.db
      .prepare(`SELECT * FROM _flow_executions ${whereClause} ORDER BY startedAt DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(...params, perPage, offset) as any[];

    const items = rows.map((r) => this.mapRowToExecution(r));
    return { items, totalItems, page, perPage };
  }

  public getExecutionById(id: string): FlowExecution | null {
    const row = this.db.prepare('SELECT * FROM _flow_executions WHERE id = ?').get(id) as any;
    return row ? this.mapRowToExecution(row) : null;
  }

  public clearExecutions(flowId?: string): boolean {
    if (flowId) {
      this.db.prepare('DELETE FROM _flow_executions WHERE flowId = ?').run(flowId);
    } else {
      this.db.prepare('DELETE FROM _flow_executions').run();
    }
    return true;
  }

  private saveExecution(exec: FlowExecution): void {
    try {
      if (exec.status !== 'aborted') {
        const existing = this.db.prepare('SELECT status FROM _flow_executions WHERE id = ?').get(exec.id) as any;
        if (existing && existing.status === 'aborted') {
          return;
        }
      }

      this.db.prepare(`
        INSERT OR REPLACE INTO _flow_executions (
          id, flowId, flowName, status, input, output, error, durationMs,
          stepLogs, actorId, actor, queuedAt, jobId, startedAt, finishedAt, checkpoint, claimToken
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        exec.id,
        exec.flowId,
        exec.flowName,
        exec.status,
        exec.input !== undefined ? JSON.stringify(exec.input) : null,
        exec.output !== undefined ? JSON.stringify(exec.output) : null,
        exec.error || null,
        exec.durationMs,
        JSON.stringify(exec.stepLogs),
        exec.actorId,
        exec.actor ? JSON.stringify(exec.actor) : null,
        exec.queuedAt || null,
        exec.jobId || null,
        exec.startedAt,
        exec.finishedAt || null,
        exec.checkpoint ? JSON.stringify(exec.checkpoint) : null,
        exec.claimToken ?? null
      );
    } catch (err: any) {
      console.warn(`[FlowService] Failed to persist execution log: ${err.message}`);
    }
  }

  private mapRowToConfig(row: any): FlowConfig {
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      enabled: row.enabled === 1,
      triggerType: row.triggerType,
      eventTrigger: row.eventTrigger,
      maxConcurrentExecutions:
        row.maxConcurrentExecutions !== null && row.maxConcurrentExecutions !== undefined
          ? Number(row.maxConcurrentExecutions)
          : null,
      definition: JSON.parse(row.definition),
      created: row.created,
      updated: row.updated,
    };
  }

  private mapRowToExecution(row: any): FlowExecution {
    return {
      id: row.id,
      flowId: row.flowId,
      flowName: row.flowName,
      status: row.status,
      input: row.input ? JSON.parse(row.input) : null,
      output: row.output ? JSON.parse(row.output) : null,
      error: row.error || undefined,
      durationMs: row.durationMs,
      stepLogs: row.stepLogs ? JSON.parse(row.stepLogs) : [],
      actorId: row.actorId,
      actor: row.actor ? JSON.parse(row.actor) : (row.actorId ? { id: row.actorId } : null),
      queuedAt: row.queuedAt || null,
      jobId: row.jobId || null,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      checkpoint: row.checkpoint ? JSON.parse(row.checkpoint) : null,
      claimToken: row.claimToken || null,
    };
  }
}
