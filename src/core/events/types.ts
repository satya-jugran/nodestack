export interface HookContext {
  [key: string]: any;
}

export interface RecordEventContext {
  collection: string;
  record: Record<string, any>;
  auth?: {
    id: string;
    email?: string;
    collection: string;
    isAdmin: boolean;
  } | null;
  httpContext?: any;
}

export interface RecordBeforeEventContext extends RecordEventContext {
  cancel: (reason?: string) => void;
  isCanceled: boolean;
  cancelReason?: string;
}

export interface RecordAfterEventContext extends RecordEventContext {}

export interface AuthEventContext {
  collection: string;
  identity: string;
  record?: Record<string, any>;
  token?: string;
}

export interface ServeEventContext {
  server: any;
  port: number;
  host: string;
}

export type HookHandler<T> = (context: T) => Promise<void> | void;
