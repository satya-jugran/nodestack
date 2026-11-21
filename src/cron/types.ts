export type CronTargetType = 'function' | 'flow' | 'snapshot';
export type MissedRunPolicy = 'skip' | 'catch_up_once' | 'catch_up_all';
export type CronRunStatus = 'running' | 'succeeded' | 'failed' | 'skipped';

export interface CronSchedule {
  id: string;
  name: string;
  targetType: CronTargetType;
  targetId: string;
  cronExpression: string;
  humanDescription?: string;
  timezone: string;
  missedRunPolicy: MissedRunPolicy;
  payload?: any;
  isSystemBound: boolean;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: CronRunStatus | null;
  lastError: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  claimToken: string | null;
  maxRetries?: number;
  autoPauseAfterFailures?: number;
  consecutiveFailures?: number;
  expiresAt?: string | null;
  keepLast?: number | null;
  created: string;
  updated: string;
}

export type CreateCronScheduleDto = {
  id?: string;
  name: string;
  targetType: CronTargetType;
  targetId: string;
  cronExpression: string;
  timezone?: string;
  missedRunPolicy?: MissedRunPolicy;
  payload?: any;
  isSystemBound?: boolean;
  enabled?: boolean;
  maxRetries?: number;
  autoPauseAfterFailures?: number;
  expiresAt?: string | null;
  keepLast?: number | null;
};

export type UpdateCronScheduleDto = Partial<CreateCronScheduleDto>;

export interface CronRunLog {
  id: string;
  scheduleId: string;
  scheduleName: string;
  targetType: CronTargetType;
  targetId: string;
  scheduledAt: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  status: CronRunStatus;
  isCatchUp: boolean;
  attempt?: number;
  executionRefId?: string | null;
  output?: string | null;
  error?: string | null;
}

export interface CronNextRunItem {
  isoUtc: string;
  zonedFormatted: string;
  dstAdjusted?: boolean;
}

export interface CronPreviewResult {
  valid: boolean;
  cronExpression: string;
  timezone: string;
  description?: string;
  nextRuns: CronNextRunItem[];
  error?: string;
}

export interface CronStats {
  totalSchedules: number;
  activeSchedules: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  skippedRuns: number;
  byTarget: {
    function: number;
    flow: number;
    snapshot: number;
  };
}

export interface CronListRunsOptions {
  scheduleId?: string;
  targetType?: CronTargetType;
  status?: string;
  page?: number;
  perPage?: number;
}
