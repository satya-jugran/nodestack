import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { EventBus } from '../core/events/EventBus';
import { RecordAfterEventContext } from '../core/events/types';
import { FunctionService } from '../functions/FunctionService';
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
} from './types';
import { FlowValidator } from './FlowValidator';
import { ChoiceEvaluator } from './runtime/ChoiceEvaluator';
import { AppError, NotFoundError, ConflictError } from '../core/errors/AppError';

export interface FlowServiceOptions {
  engine?: FlowEngine;
  recoveryStrategy?: 'abort' | 'resume';
  autoRecoverOnStartup?: boolean;
}

export class FlowService {
  private engine: FlowEngine;
  private recoveryStrategy: 'abort' | 'resume';
  private activeAbortControllers = new Map<string, AbortController>();
  private activeExecutionClaims = new Set<string>();

  constructor(
    private db: DatabaseService,
    private functionService?: FunctionService,
    private eventBus?: EventBus,
    private appScope: { id: string; slug: string; name?: string } = { id: 'default', slug: 'default' },
    options: FlowServiceOptions = {}
  ) {
    this.engine = options.engine || new FlowEngine();
    this.recoveryStrategy = options.recoveryStrategy || (process.env.FLOW_RECOVERY_STRATEGY as any) || 'abort';
    this.initTables();
    this.bindEvents();

    if (options.autoRecoverOnStartup !== false) {
      this.handleStartupRecovery().catch((err) => {
        console.warn(`[FlowService] Startup recovery warning: ${err.message}`);
      });
    }
  }

  public static generateExecutionId(): string {
    return FlowEngine.generateExecutionId();
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
          startedAt TEXT NOT NULL,
          finishedAt TEXT,
          checkpoint TEXT,
          claimToken TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_flowexec_flowId ON _flow_executions(flowId);
        CREATE INDEX IF NOT EXISTS idx_flowexec_status ON _flow_executions(status);
        CREATE INDEX IF NOT EXISTS idx_flowexec_startedAt ON _flow_executions(startedAt DESC);
      `);

      // Migration safeguard for existing tables
      try {
        this.db.exec('ALTER TABLE _flow_executions ADD COLUMN checkpoint TEXT');
      } catch {}
      try {
        this.db.exec('ALTER TABLE _flow_executions ADD COLUMN claimToken TEXT');
      } catch {}
      try {
        this.db.exec('ALTER TABLE _flow_executions ADD COLUMN actor TEXT');
      } catch {}
    } catch (err: any) {
      console.warn(`[FlowService] initTables warning: ${err.message}`);
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

      // Asynchronous event trigger (do not block database write loop)
      const eventActor = actor || (flow.eventTrigger ? { id: `event:${flow.eventTrigger}` } : { id: 'system:event' });
      this.executeFlow(flow.id, eventPayload, eventActor).catch((err) => {
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
    const definition = JSON.stringify(dto.definition);

    this.db.prepare(`
      INSERT INTO _flows (id, name, description, enabled, triggerType, eventTrigger, definition, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, trimmedName, description, enabled, triggerType, eventTrigger, definition, now, now);

    return this.getFlowById(id)!;
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
    const definition = dto.definition !== undefined ? JSON.stringify(dto.definition) : JSON.stringify(current.definition);
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE _flows SET
        name = ?, description = ?, enabled = ?, triggerType = ?, eventTrigger = ?, definition = ?, updated = ?
      WHERE id = ?
    `).run(name, description, enabled, triggerType, eventTrigger, definition, now, id);

    return this.getFlowById(id)!;
  }

  public deleteFlow(id: string, actor?: any): boolean {
    const current = this.getFlowById(id);
    if (!current) {
      throw new NotFoundError(`Flow '${id}' not found`);
    }

    this.db.prepare('DELETE FROM _flow_executions WHERE flowId = ?').run(id);
    this.db.prepare('DELETE FROM _flows WHERE id = ?').run(id);
    return true;
  }

  // ==========================================
  // Execution & Step Checkpointing
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
    if (this.activeExecutionClaims.has(executionId)) {
      throw new ConflictError(`Flow execution '${executionId}' is currently running`);
    }
    this.activeExecutionClaims.add(executionId);
    const claimToken = crypto.randomUUID();

    if (options.executionId) {
      const existing = this.getExecutionById(options.executionId);
      if (existing && (existing.status === 'running' || existing.claimToken)) {
        this.activeExecutionClaims.delete(executionId);
        throw new ConflictError(`Flow execution '${options.executionId}' is already running`);
      }
    }

    const abortController = new AbortController();
    this.activeAbortControllers.set(executionId, abortController);

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

    const initialCheckpoint: FlowCheckpoint = {
      currentStateName: flow.definition.startAt,
      currentPayload: input !== undefined ? input : {},
      stepCount: 0,
      loopCounters: {},
      updatedAt: new Date().toISOString(),
    };

    // Atomically persist initial 'running' record so callers can poll immediately
    this.saveExecution({
      id: executionId,
      flowId: flow.id,
      flowName: flow.name,
      status: 'running',
      input: input !== undefined ? input : null,
      durationMs: 0,
      stepLogs: [],
      actorId: authContext?.id || (typeof actor === 'string' ? actor : null),
      actor: authContext,
      startedAt: new Date().toISOString(),
      checkpoint: initialCheckpoint,
      claimToken,
    });

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
        startedAt: existing?.startedAt || new Date().toISOString(),
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
   * Aborts an orphaned running flow gracefully with status: 'aborted'.
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

    if (exec.status !== 'running') {
      return exec;
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
    return aborted;
  }

  /**
   * Resumes an interrupted or orphaned running flow from its last completed checkpoint.
   */
  public async resumeExecution(executionId: string): Promise<FlowExecution> {
    if (this.activeExecutionClaims.has(executionId)) {
      throw new ConflictError(`Flow execution '${executionId}' is currently being executed or resumed`);
    }
    this.activeExecutionClaims.add(executionId);

    const claimToken = crypto.randomUUID();
    let claimed = false;

    try {
      // Atomic claim in DB: only claim if status is 'running' or 'failed', and not already claimed
      const claimResult = this.db.prepare(`
        UPDATE _flow_executions
        SET claimToken = ?, status = 'running', finishedAt = NULL, error = NULL
        WHERE id = ?
          AND (claimToken IS NULL OR claimToken = '')
          AND (status = 'running' OR status = 'failed')
      `).run(claimToken, executionId);

      if (claimResult.changes === 0) {
        const existing = this.getExecutionById(executionId);
        if (!existing) {
          throw new NotFoundError(`Flow execution '${executionId}' not found`);
        }
        if (existing.claimToken) {
          throw new ConflictError(`Flow execution '${executionId}' is already claimed by another runner`);
        }
        if (existing.status !== 'running' && existing.status !== 'failed') {
          throw new AppError(`Cannot resume flow execution '${executionId}' with status '${existing.status}'`, 400);
        }
        throw new ConflictError(`Could not claim flow execution '${executionId}'`);
      }
      claimed = true;

      const exec = this.getExecutionById(executionId)!;
      const flow = this.getFlowById(exec.flowId) || this.getFlowByName(exec.flowName);
      if (!flow) {
        this.abortExecution(executionId, `Flow '${exec.flowName}' no longer exists`);
        throw new NotFoundError(`Flow '${exec.flowName}' no longer exists`);
      }

      if (!flow.enabled) {
        this.abortExecution(executionId, `Flow '${flow.name}' is currently disabled`);
        throw new AppError(`Flow '${flow.name}' is currently disabled`, 403);
      }

      let nextStateName: string | undefined = exec.checkpoint?.currentStateName ?? undefined;
      let resumePayload = exec.checkpoint?.currentPayload !== undefined
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
            this.saveExecution(completed);
            return completed;
          } else if (lastState?.type === 'Choice') {
            // Reconstruct dynamic branch from Choice state definition and payload
            const payload = lastStep.output !== undefined ? lastStep.output : (lastStep.input ?? {});
            const chosenNext = ChoiceEvaluator.findNextState(lastState.choices, lastState.default, payload);
            if (chosenNext) {
              nextStateName = chosenNext;
              resumePayload = payload;
            } else {
              this.abortExecution(
                executionId,
                `Cannot reconstruct Choice branch for state '${lastStep.step}' (no matching choice and no default)`
              );
              throw new AppError(
                `Cannot reconstruct Choice branch for state '${lastStep.step}' for execution '${executionId}'`,
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
            this.abortExecution(executionId, reason);
            throw new AppError(
              `Cannot reconstruct next state following '${lastStep.step}' for execution '${executionId}': ${reason}`,
              400
            );
          }
        }
      }

      if (!nextStateName || !flow.definition.states[nextStateName]) {
        this.abortExecution(executionId, `Checkpoint state '${nextStateName || 'unknown'}' not found in flow definition`);
        throw new AppError(`Checkpoint state '${nextStateName || 'unknown'}' not found in flow definition`, 400);
      }

      const abortController = new AbortController();
      this.activeAbortControllers.set(executionId, abortController);

      const recoveryActor = exec.actor || (exec.actorId ? { id: exec.actorId } : undefined);

      try {
        const execution = await this.engine.execute(flow.name, flow.definition, exec.input, {
          actor: recoveryActor,
          functionService: this.functionService,
          executionId: exec.id,
          flowId: flow.id,
          signal: abortController.signal,
          onStepTransition: async (event) => {
            this.persistCheckpoint(exec.id, event, claimToken);
          },
          resumeFrom: {
            stateName: nextStateName,
            payload: resumePayload,
            stepLogs: exec.stepLogs || [],
            loopCounters: exec.checkpoint?.loopCounters,
            stepCount: exec.checkpoint?.stepCount || (exec.stepLogs || []).length,
            startedAt: exec.startedAt,
            durationMs: exec.durationMs,
          },
        });

        this.saveExecution(execution);
        return execution;
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
          output: existing?.output ?? resumePayload,
          error: err.message || String(err),
          durationMs: existing?.durationMs || exec.durationMs,
          stepLogs: existing?.stepLogs || exec.stepLogs,
          actorId: exec.actorId,
          actor: exec.actor,
          startedAt: exec.startedAt,
          finishedAt: new Date().toISOString(),
          checkpoint: existing?.checkpoint ?? null,
          claimToken: null,
        };
        this.saveExecution(failedExec);
        throw err;
      }
    } finally {
      if (claimed) {
        this.releaseClaim(executionId, claimToken);
      }
      this.activeExecutionClaims.delete(executionId);
      this.activeAbortControllers.delete(executionId);
    }
  }

  /**
   * Recovers orphaned running flows on startup (either fails gracefully with 'aborted' or resumes from checkpoint).
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

    if (!orphanedRows || orphanedRows.length === 0) {
      return [];
    }

    const recovered: FlowExecution[] = [];

    for (const row of orphanedRows) {
      const exec = this.mapRowToExecution(row);
      try {
        if (strategy === 'resume') {
          const resumed = await this.resumeExecution(exec.id);
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

    if (options?.status) {
      whereClause += ' AND status = ?';
      params.push(options.status);
    }

    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM _flow_executions ${whereClause}`).get(...params) as any;
    const totalItems = countRow?.total || 0;

    const rows = this.db
      .prepare(`SELECT * FROM _flow_executions ${whereClause} ORDER BY startedAt DESC LIMIT ? OFFSET ?`)
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
        INSERT OR REPLACE INTO _flow_executions (id, flowId, flowName, status, input, output, error, durationMs, stepLogs, actorId, actor, startedAt, finishedAt, checkpoint, claimToken)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      checkpoint: row.checkpoint ? JSON.parse(row.checkpoint) : null,
      claimToken: row.claimToken || null,
    };
  }
}
