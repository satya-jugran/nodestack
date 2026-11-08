export interface ISnapshotDriver {
  captureSnapshot(targetDir: string): Promise<{ dbSizeBytes: number }>;
  restoreSnapshot(sourceDir: string): Promise<void>;
}
