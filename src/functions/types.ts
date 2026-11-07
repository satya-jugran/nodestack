import { QueueMessage, EnqueueMessageDto, MessageFailResult } from '../queue/types';

export type FunctionAuthPolicy = 'public' | 'auth' | 'admin' | 'apiKey';
export type FunctionTriggerType = 'http' | 'hook' | 'cron' | 'queue';

export interface FunctionConfig {
  id: string;
  name: string;
  description?: string;
  code: string;
  enabled: boolean;
  authPolicy: FunctionAuthPolicy;
  methods: string[];
  eventTrigger?: string | null;
  timeoutMs: number;
  memoryLimitMb: number;
  allowedDomains: string[];
  elevated: boolean;
  env: Record<string, string>;
  created: string;
  updated: string;
}

export type CreateFunctionDto = Omit<FunctionConfig, 'id' | 'created' | 'updated'> & {
  id?: string;
};

export type UpdateFunctionDto = Partial<Omit<FunctionConfig, 'id' | 'created' | 'updated'>>;

export interface FunctionRecordQueryOptions {
  filter?: string;
  sort?: string;
  page?: number;
  perPage?: number;
  search?: string;
}

export interface FunctionListResult<T = any> {
  items: T[];
  totalItems: number;
  totalPages: number;
  page: number;
  perPage: number;
}

export interface FunctionRequestContext {
  method: string;
  path: string;
  query: Record<string, any>;
  headers: Record<string, string>;
  body: any;
  params?: Record<string, string>;
  auth?: {
    id: string | null;
    role: string;
    email?: string;
    [key: string]: any;
  } | null;
}

export interface FunctionEventContext {
  collection: string;
  action: 'create' | 'update' | 'delete' | 'test';
  record: Record<string, any>;
  isBefore?: boolean;
}

export interface FunctionRecordsBridge {
  get(collection: string, id: string): Promise<Record<string, any> | null>;
  list(collection: string, options?: FunctionRecordQueryOptions): Promise<FunctionListResult>;
  create(collection: string, data: Record<string, any>): Promise<Record<string, any>>;
  update(collection: string, id: string, data: Record<string, any>): Promise<Record<string, any>>;
  delete(collection: string, id: string): Promise<boolean>;
}

export interface FunctionQueueBridge {
  send<T = any>(
    queueName: string,
    payload: T,
    options?: Omit<EnqueueMessageDto<T>, 'queue' | 'payload'>
  ): Promise<QueueMessage<T>>;
  claim<T = any>(
    queueName: string,
    options?: { visibilityTimeoutSeconds?: number; limit?: number }
  ): Promise<QueueMessage<T>[]>;
  complete(messageId: string, result?: any, claimToken?: string): Promise<boolean>;
  fail(
    messageId: string,
    error?: string,
    options?: { backoffDelayMs?: number; claimToken?: string }
  ): Promise<MessageFailResult>;
  touch(messageId: string, extensionSeconds?: number, claimToken?: string): Promise<boolean>;
  getMessage<T = any>(messageId: string): Promise<QueueMessage<T> | null>;
}

export interface FunctionSdkBridges {
  records: FunctionRecordsBridge;
  queue?: FunctionQueueBridge;
}

export interface FunctionNetworkBridge {
  fetch(url: string, init?: any): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    json: () => Promise<any>;
    text: () => Promise<string>;
  }>;
}

export interface FunctionObservabilityBridge {
  log(...args: any[]): void;
  metric?(name: string, value: number, tags?: Record<string, string>): void;
}

export interface FunctionContextData {
  app: {
    id: string;
    slug: string;
    name?: string;
  };
  request?: FunctionRequestContext;
  event?: FunctionEventContext;
  env: Record<string, string>;
  auth?: any;
}

export interface FunctionHostServices {
  sdk: FunctionSdkBridges;
  network: FunctionNetworkBridge;
  observability: FunctionObservabilityBridge;
  context: FunctionContextData;
}

/**
 * Type alias for backward compatibility across internal imports
 */
export type FunctionContext = FunctionHostServices;

export interface FunctionExecutionResult {
  status: 'success' | 'error' | 'timeout';
  statusCode: number;
  body?: any;
  headers?: Record<string, string>;
  durationMs: number;
  memoryUsedMb?: number;
  logs: string[];
  error?: string;
}

export interface FunctionLog {
  id: string;
  functionId: string;
  functionName: string;
  trigger: string;
  status: 'success' | 'error' | 'timeout';
  statusCode: number;
  durationMs: number;
  requestPayload?: string;
  responsePayload?: string;
  logs: string;
  error?: string;
  actorId?: string;
  timestamp: string;
}
