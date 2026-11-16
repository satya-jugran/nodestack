import { FastifyInstance, RouteHandlerMethod } from 'fastify';
import { ServiceIdentifier } from '../container/Tokens';
import { ConfigService } from '../config/ConfigService';
import { DatabaseService } from '../../database/DatabaseService';
import { SchemaService } from '../../schema/SchemaService';
import { RecordService } from '../../records/RecordService';
import { CreateCollectionDto, CollectionModel } from '../../schema/models/Collection';
import {
  HookHandler,
  RecordBeforeEventContext,
  RecordAfterEventContext,
  ServeEventContext,
} from '../events/types';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface AdminCustomView {
  title?: string;
  description?: string;
  html?: string;
  component?: string;
  onMount?: string;
}

export interface AdminNavItem {
  id: string;
  title: string;
  icon?: string;
  badge?: string;
  badgeVariant?: 'primary' | 'success' | 'warning' | 'info' | 'danger';
  path?: string;
  target?: '_blank' | '_self';
  view?: string | AdminCustomView;
  order?: number;
  section?: 'main' | 'bottom' | 'plugins';
  action?: string;
}

export type PluginAuthPolicy = 'admin' | 'adminOrInitial' | 'auth' | 'user' | 'public';

export interface PluginRouteOptions {
  auth?: PluginAuthPolicy;
  requireAdmin?: boolean;
  preHandler?: any;
  schema?: any;
  [key: string]: any;
}

export interface PluginRouteDefinition {
  method: HttpMethod;
  path: string;
  handler: RouteHandlerMethod;
  auth?: PluginAuthPolicy;
  options?: PluginRouteOptions;
}

export interface PluginMetadata {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  hasConfig?: boolean;
}

export type PluginConfigFieldType = 'text' | 'password' | 'number' | 'boolean' | 'select';

export interface PluginConfigFieldOption {
  label: string;
  value: any;
}

export interface PluginConfigField {
  name: string;
  label: string;
  type: PluginConfigFieldType;
  envKey?: string;
  placeholder?: string;
  defaultValue?: any;
  description?: string;
  required?: boolean;
  options?: PluginConfigFieldOption[];
}

export interface PluginConfigSchema {
  fields: PluginConfigField[];
}

export type PluginConfigSource = 'env' | 'code' | 'db' | 'default';

export interface ResolvedPluginConfigField extends PluginConfigField {
  value?: any;
  hasValue?: boolean;
  isLocked: boolean;
  source: PluginConfigSource;
  lockReason?: string;
  maskedValue?: string;
}

export interface PluginConfigResult {
  plugin: string;
  hasConfig: boolean;
  fields: ResolvedPluginConfigField[];
}

export interface PluginManagerFacade {
  /** Resolve the effective configuration for a plugin across precedence layers */
  getEffectiveConfig(name: string, db?: DatabaseService): Record<string, any>;
}

export interface PluginAppFacade {
  /** Database service for queries and migrations */
  readonly db: DatabaseService;
  /** Schema service for collection metadata */
  readonly schema: SchemaService;
  /** Record service for CRUD data operations */
  readonly records: RecordService;
  /** System configuration service */
  readonly config: ConfigService;
  /** Restricted plugin manager facade exposing only read-only configuration resolution */
  readonly plugins?: PluginManagerFacade;
}

export interface PluginEventBus {
  /** Emit an event across the event bus */
  emit(event: string, data?: any): Promise<void>;
  /** Subscribe to an event, returning an unsubscribe callback */
  on(event: string, handler: (data?: any) => Promise<void> | void): () => void;
}

export interface PluginRouter {
  get: (path: string, handler: RouteHandlerMethod, options?: PluginRouteOptions) => void;
  post: (path: string, handler: RouteHandlerMethod, options?: PluginRouteOptions) => void;
  patch: (path: string, handler: RouteHandlerMethod, options?: PluginRouteOptions) => void;
  delete: (path: string, handler: RouteHandlerMethod, options?: PluginRouteOptions) => void;
  put: (path: string, handler: RouteHandlerMethod, options?: PluginRouteOptions) => void;
}

export interface NodeStackPluginContext {
  /** Application facade providing safe domain capabilities (records, db, schema, etc.) without host runtime controls */
  readonly app: PluginAppFacade;
  /** System Configuration Service */
  readonly config: ConfigService;
  /** Database Service */
  readonly db: DatabaseService;
  /** Schema & Collections Service */
  readonly schema: SchemaService;
  /** Record Service for CRUD operations on collections */
  readonly records: RecordService;
  /** Sandboxed EventBus for event dispatching without destructive clear() */
  readonly eventBus: PluginEventBus;
  /** Auth prehandlers and policy helpers for securing plugin routes */
  readonly auth: {
    requireAdmin: () => (req: any, reply: any) => Promise<void>;
    requireAdminOrInitial: () => (req: any, reply: any) => Promise<void>;
    requireAuth: () => (req: any, reply: any) => Promise<void>;
  };
  /** Expressive router helper without raw Fastify access */
  readonly router: PluginRouter;

  /** Register a custom route with Fastify and optional auth policy */
  registerRoute: (
    method: HttpMethod,
    path: string,
    handler: RouteHandlerMethod,
    options?: PluginRouteOptions
  ) => void;

  /** Register lifecycle hooks (beforeCreate, afterCreate, beforeUpdate, afterUpdate, beforeDelete, afterDelete, beforeServe, afterServe, or custom) */
  registerHook: (
    event: 'beforeCreate' | 'afterCreate' | 'beforeUpdate' | 'afterUpdate' | 'beforeDelete' | 'afterDelete' | 'beforeServe' | 'afterServe' | string,
    handler: any,
    collection?: string
  ) => void;

  /** Register or idempotently declare a system collection */
  registerSystemCollection: (dto: CreateCollectionDto) => Promise<CollectionModel> | CollectionModel;

  /** Register a navigation item in the Admin UI sidebar */
  registerAdminNav: (item: AdminNavItem) => void;

  /** Resolve a service from the container (read-only capability) */
  getService: <T>(token: ServiceIdentifier<T>) => T;

  /** Bind a custom plugin service instance. Core tokens are protected and cannot be re-registered. */
  bindService: <T>(token: ServiceIdentifier<T>, instance: T) => void;
}

export type PluginContext = NodeStackPluginContext;

export interface INodeStackPlugin {
  /** Unique name of the plugin, e.g. 'stripe', 's3-storage', 'resend' */
  name: string;
  /** Semantic version string */
  version?: string;
  /** Human-readable description of the plugin */
  description?: string;
  /** Names of other plugins that must be registered before this plugin */
  dependencies?: string[];

  // Declarative definitions
  routes?: PluginRouteDefinition[];
  collections?: (CreateCollectionDto & { system?: boolean })[];
  adminNavItems?: AdminNavItem[];
  buildAdminNavItems?(effectiveConfig: Record<string, any>, context?: NodeStackPluginContext): AdminNavItem[];

  // Option B: Configuration Schema & Dynamic Update
  /** Configuration schema for Option B strict precedence and Admin UI editing */
  configSchema?: PluginConfigSchema;
  /** Programmatic options passed into the plugin on construction */
  codeOptions?: Record<string, any>;
  /** Callback fired when an admin updates configuration via Admin UI */
  onConfigUpdate?(newConfig: Record<string, any>): void | Promise<void>;

  // Lifecycle methods
  register?(context: NodeStackPluginContext): void | Promise<void>;
  onRegister?(context: NodeStackPluginContext): void | Promise<void>;
  init?(context: NodeStackPluginContext): void | Promise<void>;
  onBeforeServe?(context: ServeEventContext): void | Promise<void>;
  onAfterServe?(context: ServeEventContext): void | Promise<void>;
  onDestroy?(context: NodeStackPluginContext): void | Promise<void>;
}

export type NodeStackPluginFunction = (context: NodeStackPluginContext) => void | Promise<void>;
export type NodeStackPlugin = INodeStackPlugin | NodeStackPluginFunction;

export interface RegisteredPluginRecord {
  name: string;
  plugin: INodeStackPlugin;
  context: NodeStackPluginContext;
  status: 'registered' | 'initialized' | 'error';
  error?: Error;
}
