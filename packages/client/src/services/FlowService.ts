import { BaseService } from './BaseService';
import type { SendOptions } from '../types';

export interface FlowConfig {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  triggerType: string;
  eventTrigger?: string | null;
  definition: any;
  created: string;
  updated: string;
}

export interface FlowExecution {
  id: string;
  flowId: string;
  flowName: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout' | 'cancelled' | 'aborted';
  input: any;
  output?: any;
  error?: string;
  durationMs: number;
  stepLogs: Array<{
    step: string;
    type: string;
    input: any;
    output?: any;
    status: string;
    durationMs: number;
    error?: string;
    timestamp: string;
  }>;
  actorId?: string | null;
  startedAt: string;
  finishedAt?: string;
  checkpoint?: {
    currentStateName?: string | null;
    currentPayload?: any;
    stepCount?: number;
    loopCounters?: Record<string, number>;
    updatedAt: string;
  } | null;
}

export interface FlowAsyncDispatchResponse {
  executionId: string;
  flowId: string;
  flowName: string;
  status: 'queued' | 'running';
  pollUrl: string;
}

export class FlowService extends BaseService {
  /**
   * Triggers or executes a Flow state machine by ID or name.
   * If wait is true (default), returns the finished FlowExecution object.
   */
  public async execute<TResponse = any, TInput = any>(
    flowIdOrName: string,
    input?: TInput,
    options: { wait?: boolean } & Omit<SendOptions, 'body'> = {}
  ): Promise<TResponse> {
    const encoded = encodeURIComponent(flowIdOrName);
    const appPrefix = this.client.appSlug ? `/api/apps/${encodeURIComponent(this.client.appSlug)}` : '/api';
    const path = `${appPrefix}/flows/${encoded}/execute`;

    const wait = options.wait !== false; // default to wait=true
    return this.send<TResponse>(path, {
      method: 'POST',
      body: input || {},
      query: { wait: wait ? 'true' : 'false' },
      ...options,
    });
  }

  /**
   * Fetch all flows configured in the active application scope (requires admin auth).
   */
  public async getList(options?: { search?: string; enabled?: boolean }): Promise<FlowConfig[]> {
    const appPrefix = this.client.appSlug ? `/api/apps/${encodeURIComponent(this.client.appSlug)}` : '/api';
    return this.send<FlowConfig[]>(`${appPrefix}/flows`, {
      method: 'GET',
      query: options,
    });
  }

  /**
   * Fetch a single flow by ID or name (requires admin auth).
   */
  public async getOne(idOrName: string): Promise<FlowConfig> {
    const appPrefix = this.client.appSlug ? `/api/apps/${encodeURIComponent(this.client.appSlug)}` : '/api';
    return this.send<FlowConfig>(`${appPrefix}/flows/${encodeURIComponent(idOrName)}`, {
      method: 'GET',
    });
  }

  /**
   * Fetch executions history for a specific flow or across all flows (requires admin auth).
   */
  public async getExecutions(options?: {
    flowId?: string;
    status?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ items: FlowExecution[]; totalItems: number; page: number; perPage: number }> {
    const appPrefix = this.client.appSlug ? `/api/apps/${encodeURIComponent(this.client.appSlug)}` : '/api';
    const flowId = options?.flowId ? `/${encodeURIComponent(options.flowId)}/executions` : '/executions';
    return this.send<{ items: FlowExecution[]; totalItems: number; page: number; perPage: number }>(
      `${appPrefix}/flows${flowId}`,
      {
        method: 'GET',
        query: options,
      }
    );
  }

  /**
   * Fetch a single execution record by ID (requires admin auth).
   */
  public async getExecution(executionId: string): Promise<FlowExecution> {
    const appPrefix = this.client.appSlug ? `/api/apps/${encodeURIComponent(this.client.appSlug)}` : '/api';
    return this.send<FlowExecution>(
      `${appPrefix}/flows/executions/${encodeURIComponent(executionId)}`,
      { method: 'GET' }
    );
  }

  /**
   * Resumes an orphaned or interrupted running flow from its last completed checkpoint.
   */
  public async resumeExecution(
    executionId: string,
    options?: { wait?: boolean; timeoutMs?: number }
  ): Promise<FlowExecution> {
    const appPrefix = this.client.appSlug ? `/api/apps/${encodeURIComponent(this.client.appSlug)}` : '/api';
    return this.send<FlowExecution>(
      `${appPrefix}/flows/executions/${encodeURIComponent(executionId)}/resume`,
      {
        method: 'POST',
        query: options,
      }
    );
  }

  /**
   * Aborts an orphaned running flow gracefully with status: 'aborted'.
   */
  public async abortExecution(executionId: string, reason?: string): Promise<FlowExecution> {
    const appPrefix = this.client.appSlug ? `/api/apps/${encodeURIComponent(this.client.appSlug)}` : '/api';
    return this.send<FlowExecution>(
      `${appPrefix}/flows/executions/${encodeURIComponent(executionId)}/abort`,
      {
        method: 'POST',
        body: { reason },
      }
    );
  }
}
