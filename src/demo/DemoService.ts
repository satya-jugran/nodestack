import { SnapshotService } from '../snapshots/SnapshotService';
import {
  SnapshotCollectionSummary,
  SnapshotMetadata,
  SnapshotStatus,
  SnapshotRestoreResult,
  SnapshotCreateOptions,
  SnapshotServicePaths,
} from '../snapshots/types';

export type DemoSnapshotOptions = SnapshotCreateOptions;
export type DemoServicePaths = SnapshotServicePaths & { name?: string; description?: string };
export type DemoCollectionSummary = SnapshotCollectionSummary;
export type DemoSnapshotMetadata = SnapshotMetadata;
export type DemoSnapshotStatus = SnapshotStatus;
export type DemoResetResult = SnapshotRestoreResult;

/**
 * DemoService maintains full backwards-compatibility with existing demo freeze & reset APIs,
 * delegating all snapshot operations to the generic SnapshotService.
 */
export class DemoService extends SnapshotService {
  constructor(...args: ConstructorParameters<typeof SnapshotService>) {
    super(...args);
  }
}
