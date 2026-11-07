import {
  QueueConfig,
  CreateQueueDto,
  QueueMessage,
  EnqueueMessageDto,
  MessageFailResult,
  QueueStats,
  GetMessagesOptions,
  ReclaimOrphanedOptions,
} from '../types';

export interface IQueueDriver {
  init(): Promise<void>;
  close(): Promise<void>;
  invalidateInit?(): void;

  upsertQueue(config: CreateQueueDto): Promise<QueueConfig>;
  getQueue(name: string): Promise<QueueConfig | null>;
  getAllQueues(includeSystem?: boolean): Promise<QueueConfig[]>;
  deleteQueue(name: string): Promise<boolean>;

  send<T = any>(message: EnqueueMessageDto<T>): Promise<QueueMessage<T>>;
  sendBatch<T = any>(messages: EnqueueMessageDto<T>[]): Promise<QueueMessage<T>[]>;

  claim<T = any>(
    queueName: string,
    claimedBy: string,
    visibilityTimeoutSeconds: number,
    limit?: number
  ): Promise<QueueMessage<T>[]>;

  touch(messageId: string, extensionSeconds: number, claimToken?: string | null): Promise<boolean>;
  complete(messageId: string, result?: any, claimToken?: string | null): Promise<boolean>;
  fail(messageId: string, error: string, backoffDelayMs?: number, claimToken?: string | null): Promise<MessageFailResult>;
  cancel(messageId: string): Promise<boolean>;
  defer(messageId: string, delayMs: number, reason?: string): Promise<boolean>;
  forceDeadLetter(messageId: string, reason?: string): Promise<boolean>;

  retryDeadLetterMessages(queueName: string, limit?: number, onMessageRequeued?: (queue: string) => void): Promise<number>;
  retryMessage(messageId: string, onMessageRequeued?: (queue: string) => void): Promise<boolean>;
  reclaimOrphaned(queueName?: string, options?: ReclaimOrphanedOptions, onDlqEnqueued?: (dlqQueue: string) => void): Promise<number>;
  cleanup(retentionDays: number, queueName?: string): Promise<number>;
  purge(queueName: string, status?: string): Promise<number>;

  getMessage<T = any>(messageId: string): Promise<QueueMessage<T> | null>;
  getMessages<T = any>(options: GetMessagesOptions): Promise<{ items: QueueMessage<T>[]; total: number }>;
  getStats(queueName?: string, includeSystem?: boolean): Promise<QueueStats>;
  getNextDelayedTimestamp(queueName?: string): Promise<string | null>;
  getQueuesWithPendingMessages(): Promise<string[]>;
}
