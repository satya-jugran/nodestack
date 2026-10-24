export interface SnapshotCollectionSummary {
  name: string;
  type: string;
  recordsCount: number;
  schemaFieldsCount: number;
}

export interface SnapshotMetadata {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  collections: SnapshotCollectionSummary[];
  totalCollections: number;
  totalRecords: number;
  totalFiles: number;
  storageSizeBytes: number;
  dbSizeBytes: number;
  contentHash?: string;
  isActive?: boolean;
}

export interface SnapshotDrift {
  collectionsDelta: number;
  recordsDelta: number;
  filesDelta: number;
  contentChanged?: boolean;
  isModified: boolean;
}

export interface SnapshotStatus {
  hasSnapshot: boolean;
  total: number;
  maxLimit: number;
  snapshots: SnapshotMetadata[];
  activeSnapshot: SnapshotMetadata | null;
  snapshot: SnapshotMetadata | null; // Backwards-compatible alias for activeSnapshot
  liveStats?: {
    totalCollections: number;
    totalRecords: number;
    totalFiles: number;
    contentHash?: string;
    drift: SnapshotDrift;
  };
}

export interface SnapshotRestoreResult {
  success: boolean;
  message: string;
  durationMs: number;
  snapshot: SnapshotMetadata;
  restoredAt: string;
}

export interface SnapshotCreateOptions {
  name?: string;
  description?: string;
  evictOldest?: boolean;
}

export interface SnapshotServicePaths {
  dbPath?: string;
  storageDir?: string;
  snapshotsDir?: string;
  legacySnapshotDir?: string;
  snapshotDir?: string;
}

export const MAX_SNAPSHOTS = 10;
