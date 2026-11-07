import type { ClientInterface } from './BaseService';
import type { SendOptions } from '../types';

export type QueueMessageStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'dead_letter';

export interface QueueMessage<T = any> {
  id: string;
  queue: string;
  groupKey?: string | null;
  status: QueueMessageStatus;
  payload: T;
  result?: any;
  error?: string | null;
  attempts: number;
  maxAttempts: number;
  priority: number;
  availableAt: string;
  claimedBy?: string | null;
  leaseExpiresAt?: string | null;
  claimToken?: string | null;
  deduplicationId?: string | null;
  originalMessageId?: string | null;
  forwardedToMessageId?: string | null;
  created: string;
  updated: string;
  finishedAt?: string | null;
  executionLogs?: string;
  executionDurationMs?: number;
}

/**
 * Type alias for backward compatibility
 */
export type QueueJob<T = any> = QueueMessage<T>;

export interface EnqueueMessageOptions {
  priority?: number;
  delaySeconds?: number;
  deduplicationId?: string;
  groupKey?: string;
  maxAttempts?: number;
}

export type EnqueueJobOptions = EnqueueMessageOptions;

export interface ClaimMessagesOptions {
  visibilityTimeoutSeconds?: number;
  limit?: number;
  workerId?: string;
}

export type ClaimJobsOptions = ClaimMessagesOptions;

export interface QueueStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  deadLetter: number;
  total: number;
}

export interface QueueConfig {
  name: string;
  concurrency: number;
  visibilityTimeoutSeconds: number;
  maxAttempts: number;
  backoffDelayMs: number;
  deadLetterQueue?: string | null;
  targetFunction?: string | null;
  isSystem: boolean;
  strictOrder: boolean;
  created: string;
  updated: string;
  stats?: QueueStats;
}

export interface UpsertQueueOptions {
  concurrency?: number;
  visibilityTimeoutSeconds?: number;
  maxAttempts?: number;
  backoffDelayMs?: number;
  deadLetterQueue?: string | null;
  targetFunction?: string | null;
  strictOrder?: boolean;
}

export class QueueService {
  constructor(protected readonly client: ClientInterface, public readonly queueName: string) {}

  private getAppPrefix(): string {
    return this.client.appSlug ? `/api/apps/${encodeURIComponent(this.client.appSlug)}` : '/api';
  }

  /**
   * Retrieves this queue's configuration and stats.
   */
  public async getConfig(options: SendOptions = {}): Promise<QueueConfig | null> {
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}`;
    try {
      return await this.client.send<QueueConfig>(path, {
        method: 'GET',
        ...options,
      });
    } catch (err: any) {
      if (err?.status === 404) return null;
      throw err;
    }
  }

  /**
   * Creates or updates this queue's settings (concurrency, retry policy, strict ordering).
   */
  public async upsert(
    config: UpsertQueueOptions = {},
    options: SendOptions = {}
  ): Promise<QueueConfig> {
    const path = `${this.getAppPrefix()}/queues`;
    return this.client.send<QueueConfig>(path, {
      method: 'POST',
      body: {
        name: this.queueName,
        ...config,
      },
      ...options,
    });
  }

  /**
   * Deletes this queue and all its messages.
   */
  public async delete(options: SendOptions = {}): Promise<boolean> {
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}`;
    const res = await this.client.send<{ success: boolean }>(path, {
      method: 'DELETE',
      ...options,
    });
    return res?.success ?? true;
  }

  /**
   * Enqueue a message into this queue.
   */
  public async send<T = any>(
    payload: T,
    options: EnqueueMessageOptions & Omit<SendOptions, 'body'> = {}
  ): Promise<QueueMessage<T>> {
    const { priority, delaySeconds, deduplicationId, groupKey, maxAttempts, ...sendOpts } = options;
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}/messages`;
    return this.client.send<QueueMessage<T>>(path, {
      method: 'POST',
      body: {
        payload,
        priority,
        delaySeconds,
        deduplicationId,
        groupKey,
        maxAttempts,
      },
      ...sendOpts,
    });
  }

  /**
   * Claim/pull one or more messages from this queue.
   */
  public async claim<T = any>(
    options: ClaimMessagesOptions & Omit<SendOptions, 'query'> = {}
  ): Promise<QueueMessage<T>[]> {
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}/messages`;
    return this.client.send<QueueMessage<T>[]>(path, {
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
   * Acknowledge and mark a message as completed.
   */
  public async ack(
    messageId: string,
    result?: any,
    options: SendOptions & { claimToken?: string } = {}
  ): Promise<boolean> {
    const { claimToken, ...sendOpts } = options;
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}/messages/${encodeURIComponent(messageId)}/ack`;
    const res = await this.client.send<{ success: boolean }>(path, {
      method: 'POST',
      body: { result, claimToken },
      ...sendOpts,
    });
    return res?.success ?? true;
  }

  /**
   * Alias for ack().
   */
  public async complete(
    messageId: string,
    result?: any,
    options: SendOptions & { claimToken?: string } = {}
  ): Promise<boolean> {
    return this.ack(messageId, result, options);
  }

  /**
   * Reject / nack a message to schedule a retry. In strictOrder queues, re-delivers the exact same message.
   */
  public async nack(
    messageId: string,
    error?: string,
    options: { backoffDelayMs?: number; claimToken?: string } & SendOptions = {}
  ): Promise<boolean> {
    const { backoffDelayMs, claimToken, ...sendOpts } = options;
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}/messages/${encodeURIComponent(messageId)}/nack`;
    const res = await this.client.send<{ success: boolean }>(path, {
      method: 'POST',
      body: { error, backoffDelayMs, claimToken },
      ...sendOpts,
    });
    return res?.success ?? true;
  }

  /**
   * Alias for nack().
   */
  public async fail(
    messageId: string,
    error?: string,
    options: { backoffDelayMs?: number; claimToken?: string } & SendOptions = {}
  ): Promise<boolean> {
    return this.nack(messageId, error, options);
  }

  /**
   * Extends the visibility timeout lease for an active processing message.
   */
  public async touch(
    messageId: string,
    extensionSeconds = 30,
    options: SendOptions & { claimToken?: string } = {}
  ): Promise<boolean> {
    const { claimToken, ...sendOpts } = options;
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}/messages/${encodeURIComponent(messageId)}/touch`;
    const res = await this.client.send<{ success: boolean }>(path, {
      method: 'POST',
      body: { extensionSeconds, claimToken },
      ...sendOpts,
    });
    return res?.success ?? true;
  }

  /**
   * Force skip an active or stuck message immediately to the Dead-Letter Queue (DLQ).
   * In strictOrder queues, this unblocks subsequent messages behind the head-of-line.
   */
  public async forceSkip(
    messageId: string,
    reason = 'Force-skipped to DLQ by operator',
    options: SendOptions = {}
  ): Promise<boolean> {
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}/messages/${encodeURIComponent(messageId)}/skip`;
    const res = await this.client.send<{ success: boolean }>(path, {
      method: 'POST',
      body: { reason },
      ...options,
    });
    return res?.success ?? true;
  }

  /**
   * Requeue or retry an individual message (or replay a forwarded DLQ message back to its original queue).
   */
  public async retry(messageId: string, options: SendOptions = {}): Promise<boolean> {
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}/messages/${encodeURIComponent(messageId)}/retry`;
    const res = await this.client.send<{ success: boolean }>(path, {
      method: 'POST',
      ...options,
    });
    return res?.success ?? true;
  }

  /**
   * Delete / cancel an individual message.
   */
  public async deleteMessage(messageId: string, options: SendOptions = {}): Promise<boolean> {
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}/messages/${encodeURIComponent(messageId)}`;
    const res = await this.client.send<{ success: boolean }>(path, {
      method: 'DELETE',
      ...options,
    });
    return res?.success ?? true;
  }

  /**
   * Alias for deleteMessage().
   */
  public async deleteJob(jobId: string, options: SendOptions = {}): Promise<boolean> {
    return this.deleteMessage(jobId, options);
  }

  /**
   * Get a message by ID.
   */
  public async getMessage<T = any>(messageId: string, options: SendOptions = {}): Promise<QueueMessage<T> | null> {
    const path = `${this.getAppPrefix()}/queues/${encodeURIComponent(this.queueName)}/messages/${encodeURIComponent(messageId)}`;
    try {
      return await this.client.send<QueueMessage<T>>(path, {
        method: 'GET',
        ...options,
      });
    } catch (err: any) {
      if (err?.status === 404) return null;
      throw err;
    }
  }

  /**
   * Alias for getMessage().
   */
  public async getJob<T = any>(jobId: string, options: SendOptions = {}): Promise<QueueMessage<T> | null> {
    return this.getMessage<T>(jobId, options);
  }
}
