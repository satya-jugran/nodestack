export type QueueJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'dead_letter';

export interface QueueConfig {
  name: string;
  concurrency: number;
  visibilityTimeoutSeconds: number;
  maxAttempts: number;
  backoffDelayMs: number;
  deadLetterQueue?: string | null;
  targetFunction?: string | null;
  isSystem: boolean;
  created: string;
  updated: string;
}

export interface CreateQueueDto {
  name: string;
  concurrency?: number;
  visibilityTimeoutSeconds?: number;
  maxAttempts?: number;
  backoffDelayMs?: number;
  deadLetterQueue?: string | null;
  targetFunction?: string | null;
  isSystem?: boolean;
}

export interface QueueJob<T = any> {
  id: string;
  queue: string;
  groupKey?: string | null;
  status: QueueJobStatus;
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
  created: string;
  updated: string;
  finishedAt?: string | null;
}

export interface EnqueueJobDto<T = any> {
  id?: string;
  queue: string;
  payload: T;
  groupKey?: string | null;
  delaySeconds?: number;
  priority?: number;
  maxAttempts?: number;
  deduplicationId?: string | null;
}

export interface JobFailResult {
  retried: boolean;
  deadLettered: boolean;
  attempts: number;
}

export type JobHandler<T = any, R = any> = (job: QueueJob<T>) => Promise<R>;

export interface QueueStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  deadLetter: number;
  total: number;
}

export interface GetJobsOptions {
  queue?: string;
  status?: QueueJobStatus | string;
  groupKey?: string;
  page?: number;
  perPage?: number;
  includeSystem?: boolean;
}
