import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { EventBus } from '../core/events/EventBus';
import { RecordAfterEventContext } from '../core/events/types';
import { FunctionService } from '../functions/FunctionService';
import { FlowEngine } from './FlowEngine';
import {
  FlowConfig,
  CreateFlowDto,
  UpdateFlowDto,
  FlowExecution,
  FlowExecutionOptions,
} from './types';
import { FlowValidator } from './FlowValidator';
import { AppError, NotFoundError, ConflictError } from '../core/errors/AppError';

export interface FlowServiceOptions {
  engine?: FlowEngine;
}

export class FlowService {
  private engine: FlowEngine;

  constructor(
    private db: DatabaseService,
    private functionService?: FunctionService,
    private eventBus?: EventBus,
    private appScope: { id: string; slug: string; name?: string } = { id: 'default', slug: 'default' },
    options: FlowServiceOptions = {}
  ) {
    this.engine = options.engine || new FlowEngine();
    this.initTables();
    this.bindEvents();
  }

  public getEngine(): FlowEngine {
    return this.engine;
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
          startedAt TEXT NOT NULL,
          finishedAt TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_flowexec_flowId ON _flow_executions(flowId);
        CREATE INDEX IF NOT EXISTS idx_flowexec_startedAt ON _flow_executions(startedAt DESC);
      `);
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
      this.executeFlow(flow.id, eventPayload, actor).catch((err) => {
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
  // Execution
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

    const execution = await this.engine.execute(flow.name, flow.definition, input, {
      actor,
      functionService: this.functionService,
      flowId: flow.id,
      executionOptions: options,
    });

    this.saveExecution(execution);
    return execution;
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
      this.db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, error, durationMs, stepLogs, actorId, startedAt, finishedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        exec.startedAt,
        exec.finishedAt || null
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
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    };
  }
}
