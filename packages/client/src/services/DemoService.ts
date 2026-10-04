import { BaseService } from './BaseService';
import type {
  DemoSnapshotStatus,
  DemoSnapshotMetadata,
  DemoResetResult,
} from '../types';

/**
 * Service for freezing baseline demo state and 1-click restore ("Reset to Demo State").
 */
export class DemoService extends BaseService {
  /**
   * Retrieves the current snapshot availability, metadata, and live drift information.
   */
  public async getStatus(): Promise<DemoSnapshotStatus> {
    return this.send<DemoSnapshotStatus>('/api/demo/status', {
      method: 'GET',
    });
  }

  /**
   * Freezes current database & file storage state as the demo baseline.
   */
  public async snapshot(options?: { name?: string; description?: string }): Promise<DemoSnapshotMetadata> {
    return this.send<DemoSnapshotMetadata>('/api/demo/snapshot', {
      method: 'POST',
      body: options || {},
    });
  }

  /**
   * Restores the exact pristine demo state in one click.
   */
  public async reset(): Promise<DemoResetResult> {
    return this.send<DemoResetResult>('/api/demo/reset', {
      method: 'POST',
    });
  }

  /**
   * Deletes the frozen demo snapshot.
   */
  public async clear(): Promise<void> {
    return this.send<void>('/api/demo/snapshot', {
      method: 'DELETE',
    });
  }
}
