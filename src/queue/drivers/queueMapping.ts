import { QueueConfig, QueueMessage } from '../types';

export function mapRowToQueue(row: any): QueueConfig {
  const isSystem = Boolean(row.isSystem) || Boolean(row.name && row.name.startsWith('_system:'));
  return {
    name: row.name,
    concurrency: Number(row.concurrency ?? 0),
    visibilityTimeoutSeconds: Number(row.visibilityTimeoutSeconds ?? 30),
    maxAttempts: Number(row.maxAttempts ?? 3),
    backoffDelayMs: Number(row.backoffDelayMs ?? 1000),
    deadLetterQueue: row.deadLetterQueue || null,
    targetFunction: row.targetFunction || null,
    isSystem,
    strictOrder: Boolean(row.strictOrder),
    created: row.created,
    updated: row.updated,
  };
}

export function mapRowToMessage<T = any>(row: any): QueueMessage<T> {
  let payload: any = null;
  if (row.payload !== null && row.payload !== undefined) {
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = row.payload;
    }
  }

  let result: any = undefined;
  if (row.result !== null && row.result !== undefined) {
    try {
      result = JSON.parse(row.result);
    } catch {
      result = row.result;
    }
  }

  return {
    id: row.id,
    queue: row.queue,
    groupKey: row.groupKey || null,
    status: row.status,
    payload,
    result,
    error: row.error || null,
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.maxAttempts ?? 3),
    priority: Number(row.priority ?? 0),
    availableAt: row.availableAt,
    claimedBy: row.claimedBy || null,
    leaseExpiresAt: row.leaseExpiresAt || null,
    claimToken: row.claimToken || null,
    deduplicationId: row.deduplicationId || null,
    originalMessageId: row.originalMessageId || null,
    originalJobId: row.originalMessageId || null,
    forwardedToMessageId: row.forwardedToMessageId || null,
    forwardedToJobId: row.forwardedToMessageId || null,
    created: row.created,
    updated: row.updated,
    finishedAt: row.finishedAt || null,
  };
}
