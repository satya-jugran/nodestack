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

export interface QueryOptions {
  page?: number;
  perPage?: number;
  sort?: string;
  filter?: string;
  expand?: string;
  fields?: string;
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
}

export interface ClientOptions {
  authStore?: BaseAuthStore;
  fetch?: typeof fetch;
  EventSource?: any;
  headers?: Record<string, string>;
  timeout?: number;
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
