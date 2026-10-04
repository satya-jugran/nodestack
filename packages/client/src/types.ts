import type { BaseAuthStore } from './auth/BaseAuthStore';

export interface BaseSystemFields {
  id: string;
  created: string;
  updated: string;
}

export interface AuthSystemFields extends BaseSystemFields {
  email: string;
  emailVisibility: boolean;
  verified: boolean;
}

export interface RecordModel extends BaseSystemFields {
  [key: string]: any;
}

export interface AdminModel extends BaseSystemFields {
  email: string;
  avatar?: string;
  [key: string]: any;
}

export interface ListResult<T = any> {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
}

export interface ChaosOptions {
  delay?: number | string;
  failRate?: number;
  errorStatus?: number | string;
  errorMessage?: string;
  jitter?: number;
}

export interface QueryOptions {
  page?: number;
  perPage?: number;
  sort?: string;
  filter?: string;
  expand?: string;
  fields?: string;
  mock_delay?: number | string;
  mock_error?: number | string;
  mock_fail_rate?: number;
  mock_jitter?: number;
  mock_error_message?: string;
  mockDelay?: number | string;
  mockError?: number | string;
  mockFailRate?: number;
  mockJitter?: number;
  mockErrorMessage?: string;
  [key: string]: any;
}

export interface RecordAuthResponse<T = RecordModel> {
  token: string;
  record: T;
}

export interface AdminAuthResponse {
  token: string;
  admin: AdminModel;
}

export type RealtimeAction = 'create' | 'update' | 'delete';

export interface RealtimeEvent<T = RecordModel> {
  action: RealtimeAction;
  record: T;
}

export type RealtimeCallback<T = RecordModel> = (event: RealtimeEvent<T>) => void;

export type UnsubscribeFunc = () => Promise<void> | void;

export interface SendOptions extends Omit<RequestInit, 'body'> {
  query?: Record<string, any>;
  body?: any;
  headers?: Record<string, string>;
  autoCancel?: boolean;
  chaos?: ChaosOptions;
  mockDelay?: number | string;
  mockError?: number | string;
  mockFailRate?: number;
  mockJitter?: number;
}

export interface ClientOptions {
  authStore?: BaseAuthStore;
  fetch?: typeof fetch;
  EventSource?: any;
  headers?: Record<string, string>;
  timeout?: number;
  chaos?: ChaosOptions;
}

export interface ImportOptions {
  continueOnError?: boolean;
  [key: string]: any;
}

export interface ImportResult {
  success: boolean;
  total: number;
  imported: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
}

export interface DemoCollectionSummary {
  name: string;
  type: string;
  recordsCount: number;
  schemaFieldsCount: number;
}

export interface DemoSnapshotMetadata {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  collections: DemoCollectionSummary[];
  totalCollections: number;
  totalRecords: number;
  totalFiles: number;
  storageSizeBytes: number;
  dbSizeBytes: number;
  contentHash?: string;
}

export interface DemoSnapshotStatus {
  hasSnapshot: boolean;
  snapshot: DemoSnapshotMetadata | null;
  liveStats?: {
    totalCollections: number;
    totalRecords: number;
    totalFiles: number;
    contentHash?: string;
    drift: {
      collectionsDelta: number;
      recordsDelta: number;
      filesDelta: number;
      contentChanged?: boolean;
      isModified: boolean;
    };
  };
}

export interface DemoResetResult {
  success: boolean;
  message: string;
  durationMs: number;
  snapshot: DemoSnapshotMetadata;
  restoredAt: string;
}
