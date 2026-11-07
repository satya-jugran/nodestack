export type QueueMessageStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'dead_letter';

export interface QueueConfig {
  name: string;
  concurrency: number;
  visibilityTimeoutSeconds: number;
  /** Max retry attempts before moving to DLQ. 0 means infinite retries (never auto-DLQ). */
  maxAttempts: number;
  backoffDelayMs: number;
  deadLetterQueue?: string | null;
  targetFunction?: string | null;
  isSystem: boolean;
  strictOrder: boolean;
  created: string;
  updated: string;
}

export interface CreateQueueDto {
  name: string;
  concurrency?: number;
  visibilityTimeoutSeconds?: number;
  /** Max retry attempts before moving to DLQ. 0 means infinite retries (never auto-DLQ). */
  maxAttempts?: number;
  backoffDelayMs?: number;
  deadLetterQueue?: string | null;
  targetFunction?: string | null;
  isSystem?: boolean;
  strictOrder?: boolean;
}

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
  /** @deprecated Use originalMessageId */
  originalJobId?: string | null;
  forwardedToMessageId?: string | null;
  /** @deprecated Use forwardedToMessageId */
  forwardedToJobId?: string | null;
  created: string;
  updated: string;
  finishedAt?: string | null;
}

export interface EnqueueMessageDto<T = any> {
  id?: string;
  queue: string;
  payload: T;
  groupKey?: string | null;
  delaySeconds?: number;
  priority?: number;
  maxAttempts?: number;
  deduplicationId?: string | null;
  originalMessageId?: string | null;
}

export interface MessageFailResult {
  retried: boolean;
  deadLettered: boolean;
  attempts: number;
}

export type MessageHandler<T = any, R = any> = (message: QueueMessage<T>) => Promise<R>;

export interface QueueStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  deadLetter: number;
  dead_letter?: number;
  total: number;
}

export interface GetMessagesOptions {
  queue?: string;
  status?: QueueMessageStatus | string;
  groupKey?: string;
  page?: number;
  perPage?: number;
  includeSystem?: boolean;
}

export interface ReclaimOrphanedOptions {
  forceAll?: boolean;
  reclaimDeadWorkers?: boolean;
}
