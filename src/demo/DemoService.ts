import { SnapshotService } from '../snapshots/SnapshotService';
import {
  SnapshotCollectionSummary,
  SnapshotMetadata,
  SnapshotStatus,
  SnapshotRestoreResult,
  SnapshotCreateOptions,
  SnapshotServicePaths,
} from '../snapshots/types';
import { ConfigService } from '../core/config/ConfigService';
import { DatabaseService } from '../database/DatabaseService';
import { SchemaService } from '../schema/SchemaService';
import { FileStorageService } from '../files/FileStorageService';
import { EventBus } from '../core/events/EventBus';
import { RealtimeService } from '../realtime/RealtimeService';
import { MaintenanceGate } from '../core/maintenance/MaintenanceGate';

export type DemoSnapshotOptions = SnapshotCreateOptions;
export interface DemoServicePaths extends SnapshotServicePaths {
  snapshotDir?: string;
  name?: string;
  description?: string;
}
export type DemoCollectionSummary = SnapshotCollectionSummary;
export type DemoSnapshotMetadata = SnapshotMetadata;
export type DemoSnapshotStatus = SnapshotStatus;
export type DemoResetResult = SnapshotRestoreResult;

/**
 * DemoService maintains full backwards-compatibility with existing demo freeze & reset APIs,
 * delegating all snapshot operations to the generic SnapshotService.
 */
export class DemoService extends SnapshotService {
  constructor(
    config: ConfigService,
    db: DatabaseService,
    schemaService: SchemaService,
    fileStorageService: FileStorageService,
    eventBus: EventBus,
    realtimeService: RealtimeService,
    maintenanceGate?: MaintenanceGate,
    customPaths?: DemoServicePaths
  ) {
    const resolvedPaths: SnapshotServicePaths | undefined = customPaths
      ? {
          ...customPaths,
          snapshotsDir: customPaths.snapshotsDir ?? customPaths.snapshotDir,
          legacySnapshotDir: customPaths.legacySnapshotDir ?? customPaths.snapshotDir,
        }
      : undefined;

    super(
      config,
      db,
      schemaService,
      fileStorageService,
      eventBus,
      realtimeService,
      maintenanceGate,
      resolvedPaths
    );
  }
}
