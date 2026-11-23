import { DatabaseService } from '../../database/DatabaseService';
import { AsyncQueueEngine } from './AsyncQueueEngine';
import {
  QueueMessage,
  EnqueueMessageDto,
  MessageFailResult,
  ReclaimOrphanedOptions,
} from '../types';

/**
 * @deprecated IDatabaseDriver standardizes on Promise returns.
 * SyncQueueEngine delegates to AsyncQueueEngine for compatibility.
 */
export class SyncQueueEngine {
  private engine: AsyncQueueEngine;

  constructor(private db: DatabaseService) {
    this.engine = new AsyncQueueEngine(db);
  }

  public async deleteQueue(name: string): Promise<boolean> {
    return this.engine.deleteQueue(name);
  }

  public async send<T = any>(dto: EnqueueMessageDto<T>): Promise<QueueMessage<T>> {
    return this.engine.send(dto);
  }

  public async sendBatch<T = any>(messages: EnqueueMessageDto<T>[]): Promise<QueueMessage<T>[]> {
    return this.engine.sendBatch(messages);
  }

  public async claim<T = any>(
    queueName: string,
    claimedBy: string,
    visibilityTimeoutSeconds: number,
    limit = 1
  ): Promise<QueueMessage<T>[]> {
    return this.engine.claim(queueName, claimedBy, visibilityTimeoutSeconds, limit);
  }

  public async fail(
    messageId: string,
    error: string,
    backoffDelayMs?: number,
    claimToken?: string | null
  ): Promise<MessageFailResult> {
    return this.engine.fail(messageId, error, backoffDelayMs, claimToken);
  }

  public async forceDeadLetter(
    messageId: string,
    reason = 'Force-skipped to DLQ by operator'
  ): Promise<boolean> {
    return this.engine.forceDeadLetter(messageId, reason);
  }

  public async cancel(messageId: string): Promise<boolean> {
    return this.engine.cancel(messageId);
  }

  public async retryDeadLetterMessages(
    queueName: string,
    limit = 100,
    onMessageRequeued?: (queue: string) => void
  ): Promise<number> {
    return this.engine.retryDeadLetterMessages(queueName, limit, onMessageRequeued);
  }

  public async retryMessage(
    messageId: string,
    onMessageRequeued?: (queue: string) => void
  ): Promise<boolean> {
    return this.engine.retryMessage(messageId, onMessageRequeued);
  }

  public async reclaimOrphaned(
    queueName?: string,
    options: ReclaimOrphanedOptions = {},
    onDlqEnqueued?: (dlqQueue: string) => void
  ): Promise<number> {
    return this.engine.reclaimOrphaned(queueName, options, onDlqEnqueued);
  }
}
