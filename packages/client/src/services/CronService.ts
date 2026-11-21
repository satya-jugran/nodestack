import { BaseService } from './BaseService';
import type { SendOptions } from '../types';

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

export class CronService extends BaseService {
  private getBasePath(): string {
    return this.client.appSlug ? `/api/apps/${encodeURIComponent(this.client.appSlug)}/cron` : '/api/cron';
  }

  public async preview(
    cronExpression: string,
    timezone = 'UTC',
    count = 5,
    options: SendOptions = {}
  ): Promise<CronPreviewResult> {
    return this.send<CronPreviewResult>(`${this.getBasePath()}/preview`, {
      method: 'POST',
      body: { cronExpression, timezone, count },
      ...options,
    });
  }

  public async getStats(options: SendOptions = {}): Promise<CronStats> {
    return this.send<CronStats>(`${this.getBasePath()}/stats`, {
      method: 'GET',
      ...options,
    });
  }

  public async getSchedules(
    filter?: { targetType?: CronTargetType; enabled?: boolean; targetId?: string },
    options: SendOptions = {}
  ): Promise<CronSchedule[]> {
    const params = new URLSearchParams();
    if (filter?.targetType) params.set('targetType', filter.targetType);
    if (filter?.enabled !== undefined) params.set('enabled', String(filter.enabled));
    if (filter?.targetId) params.set('targetId', filter.targetId);

    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.send<CronSchedule[]>(`${this.getBasePath()}/schedules${qs}`, {
      method: 'GET',
      ...options,
    });
  }

  public async listSchedules(
    filter?: { targetType?: CronTargetType; enabled?: boolean; targetId?: string },
    options: SendOptions = {}
  ): Promise<CronSchedule[]> {
    return this.getSchedules(filter, options);
  }

  public async createSchedule(
    dto: CreateCronScheduleDto,
    options: SendOptions = {}
  ): Promise<CronSchedule> {
    return this.send<CronSchedule>(`${this.getBasePath()}/schedules`, {
      method: 'POST',
      body: dto,
      ...options,
    });
  }

  public async getSchedule(id: string, options: SendOptions = {}): Promise<CronSchedule> {
    return this.send<CronSchedule>(`${this.getBasePath()}/schedules/${encodeURIComponent(id)}`, {
      method: 'GET',
      ...options,
    });
  }

  public async updateSchedule(
    id: string,
    dto: UpdateCronScheduleDto,
    options: SendOptions = {}
  ): Promise<CronSchedule> {
    return this.send<CronSchedule>(`${this.getBasePath()}/schedules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: dto,
      ...options,
    });
  }

  public async deleteSchedule(id: string, options: SendOptions = {}): Promise<boolean> {
    const res = await this.send<{ success: boolean }>(
      `${this.getBasePath()}/schedules/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        ...options,
      }
    );
    return Boolean(res?.success);
  }

  public async triggerSchedule(id: string, options: SendOptions = {}): Promise<CronRunLog> {
    return this.send<CronRunLog>(
      `${this.getBasePath()}/schedules/${encodeURIComponent(id)}/trigger`,
      {
        method: 'POST',
        ...options,
      }
    );
  }

  public async getRuns(
    listOptions: CronListRunsOptions = {},
    options: SendOptions = {}
  ): Promise<{ items: CronRunLog[]; total: number; page: number; perPage: number }> {
    const params = new URLSearchParams();
    if (listOptions.scheduleId) params.set('scheduleId', listOptions.scheduleId);
    if (listOptions.targetType) params.set('targetType', listOptions.targetType);
    if (listOptions.status) params.set('status', listOptions.status);
    if (listOptions.page) params.set('page', String(listOptions.page));
    if (listOptions.perPage) params.set('perPage', String(listOptions.perPage));

    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.send<{ items: CronRunLog[]; total: number; page: number; perPage: number }>(
      `${this.getBasePath()}/runs${qs}`,
      {
        method: 'GET',
        ...options,
      }
    );
  }

  public async clearRuns(
    scheduleId?: string,
    options: SendOptions = {}
  ): Promise<{ success: boolean; count: number }> {
    const qs = scheduleId ? `?scheduleId=${encodeURIComponent(scheduleId)}` : '';
    return this.send<{ success: boolean; count: number }>(`${this.getBasePath()}/runs${qs}`, {
      method: 'DELETE',
      ...options,
    });
  }
}
