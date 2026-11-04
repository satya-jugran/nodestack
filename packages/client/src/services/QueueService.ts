import type { ClientInterface } from './BaseService';
import type { SendOptions } from '../types';

export interface QueueJob<T = any> {
  id: string;
  queue: string;
  groupKey?: string | null;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'dead_letter';
  payload: T;
  result?: any;
  error?: string | null;
  /** @deprecated Use error */
  lastError?: string | null;
  attempts: number;
  maxAttempts: number;
  priority: number;
  availableAt: string;
  claimedBy?: string | null;
  leaseExpiresAt?: string | null;
  claimToken?: string | null;
  deduplicationId?: string | null;
  created: string;
  updated: string;
  finishedAt?: string | null;
  executionLogs?: string;
  executionDurationMs?: number;
}

export interface EnqueueJobOptions {
  priority?: number;
  delaySeconds?: number;
  deduplicationId?: string;
  groupKey?: string;
}

export interface ClaimJobsOptions {
  visibilityTimeoutSeconds?: number;
  limit?: number;
  workerId?: string;
}

export class QueueService {
  constructor(protected readonly client: ClientInterface, public readonly queueName: string) {}

  private getAppPrefix(): string {
    return this.client.appSlug ? `/api/apps/${encodeURIComponent(this.client.appSlug)}` : '/api';
  }

  /**
   * Enqueue a message into this queue.
   */
  public async send<T = any>(
    payload: T,
    options: EnqueueJobOptions & Omit<SendOptions, 'body'> = {}
  ): Promise<QueueJob<T>> {
    const { priority, delaySeconds, deduplicationId, groupKey, ...sendOpts } = options;
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}/messages`;
    return this.client.send<QueueJob<T>>(path, {
      method: 'POST',
      body: {
        payload,
        priority,
        delaySeconds,
        deduplicationId,
        groupKey,
      },
      ...sendOpts,
    });
  }

  /**
   * Claim/pull one or more messages from this queue.
   */
  public async claim<T = any>(
    options: ClaimJobsOptions & Omit<SendOptions, 'query'> = {}
  ): Promise<QueueJob<T>[]> {
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}/messages`;
    return this.client.send<QueueJob<T>[]>(path, {
      method: 'GET',
      query: {
        limit: options.limit || 1,
        visibilityTimeoutSeconds: options.visibilityTimeoutSeconds || 30,
        workerId: options.workerId,
      },
      ...options,
    });
  }

  /**
   * Acknowledge and mark a job as completed.
   */
  public async complete(jobId: string, result?: any, options: SendOptions = {}): Promise<boolean> {
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}/jobs/${encodeURIComponent(jobId)}/ack`;
    const res = await this.client.send<{ success: boolean }>(path, {
      method: 'POST',
      body: { result },
      ...options,
    });
    return res?.success ?? true;
  }

  /**
   * Reject / nack a job to schedule a retry with backoff.
   */
  public async fail(
    jobId: string,
    error?: string,
    options: { backoffDelayMs?: number } & SendOptions = {}
  ): Promise<boolean> {
    const { backoffDelayMs, ...sendOpts } = options;
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}/jobs/${encodeURIComponent(jobId)}/nack`;
    const res = await this.client.send<{ success: boolean }>(path, {
      method: 'POST',
      body: { error, backoffDelayMs },
      ...sendOpts,
    });
    return res?.success ?? true;
  }

  /**
   * Get a job by ID.
   */
  public async getJob<T = any>(jobId: string, options: SendOptions = {}): Promise<QueueJob<T> | null> {
    const path = `${this.getAppPrefix()}/queues/jobs/${encodeURIComponent(jobId)}`;
    try {
      return await this.client.send<QueueJob<T>>(path, {
        method: 'GET',
        ...options,
      });
    } catch (err: any) {
      if (err?.status === 404) return null;
      throw err;
    }
  }
}

