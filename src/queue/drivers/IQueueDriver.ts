import {
  QueueConfig,
  CreateQueueDto,
  QueueJob,
  EnqueueJobDto,
  JobFailResult,
  QueueStats,
  GetJobsOptions,
} from '../types';

export interface IQueueDriver {
  init(): Promise<void>;
  close(): Promise<void>;
  invalidateInit?(): void;

  upsertQueue(config: CreateQueueDto): Promise<QueueConfig>;
  getQueue(name: string): Promise<QueueConfig | null>;
  getAllQueues(includeSystem?: boolean): Promise<QueueConfig[]>;
  deleteQueue(name: string): Promise<boolean>;

  send<T = any>(job: EnqueueJobDto<T>): Promise<QueueJob<T>>;
  sendBatch<T = any>(jobs: EnqueueJobDto<T>[]): Promise<QueueJob<T>[]>;

  claim<T = any>(
    queueName: string,
    claimedBy: string,
    visibilityTimeoutSeconds: number,
    limit?: number
  ): Promise<QueueJob<T>[]>;

  touch(jobId: string, extensionSeconds: number, claimToken?: string | null): Promise<boolean>;
  complete(jobId: string, result?: any, claimToken?: string | null): Promise<boolean>;
  fail(jobId: string, error: string, backoffDelayMs?: number, claimToken?: string | null): Promise<JobFailResult>;
  cancel(jobId: string): Promise<boolean>;
  defer(jobId: string, delayMs: number, reason?: string): Promise<boolean>;

  retryDeadLetterJobs(queueName: string, limit?: number): Promise<number>;
  reclaimOrphaned(queueName?: string, forceAll?: boolean, onDlqEnqueued?: (dlqQueue: string) => void): Promise<number>;
  cleanup(retentionDays: number, queueName?: string): Promise<number>;
  purge(queueName: string, status?: string): Promise<number>;

  getJob<T = any>(jobId: string): Promise<QueueJob<T> | null>;
  getJobs<T = any>(options: GetJobsOptions): Promise<{ items: QueueJob<T>[]; total: number }>;
  getStats(queueName?: string, includeSystem?: boolean): Promise<QueueStats>;
  getNextDelayedTimestamp(queueName?: string): Promise<string | null>;
  getQueuesWithPendingJobs(): Promise<string[]>;
}
