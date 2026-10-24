import { BaseService } from './BaseService';
import type {
  SnapshotStatus,
  SnapshotMetadata,
  SnapshotRestoreResult,
  SnapshotCreateOptions,
} from '../types';

/**
 * Service for managing application state snapshots, multi-checkpoint history, and 1-click restore.
 */
export class SnapshotService extends BaseService {
  /**
   * Retrieves all snapshots, active baseline, and live drift information.
   */
  public async list(): Promise<SnapshotStatus> {
    return this.send<SnapshotStatus>('/api/snapshots', {
      method: 'GET',
    });
  }

  /**
   * Alias for list() to retrieve status.
   */
  public async getStatus(): Promise<SnapshotStatus> {
    return this.list();
  }

  /**
   * Creates a new application state snapshot.
   * If snapshot limit (10) is reached, evictOldest: true can be passed to confirm eviction of the oldest.
   */
  public async create(options?: SnapshotCreateOptions): Promise<SnapshotMetadata> {
    return this.send<SnapshotMetadata>('/api/snapshots', {
      method: 'POST',
      body: options || {},
    });
  }

  /**
   * Retrieves a specific snapshot by ID.
   */
  public async get(id: string): Promise<SnapshotMetadata> {
    return this.send<SnapshotMetadata>(`/api/snapshots/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
  }

  /**
   * Restores application state to a specific snapshot.
   * Note: Future snapshots are NOT deleted; history remains intact.
   */
  public async restore(id: string): Promise<SnapshotRestoreResult> {
    return this.send<SnapshotRestoreResult>(`/api/snapshots/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
    });
  }

  /**
   * Deletes a specific snapshot by ID.
   */
  public async delete(id: string): Promise<void> {
    return this.send<void>(`/api/snapshots/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Clears all saved snapshots.
   */
  public async clear(): Promise<void> {
    return this.send<void>('/api/snapshots', {
      method: 'DELETE',
    });
  }
}
