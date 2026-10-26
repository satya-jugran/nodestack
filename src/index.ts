// Main application
export { NodeStack, NodeStackOptions, NodeBase, NodeBaseOptions } from './NodeStack';

// IoC & Core
export { Container } from './core/container/Container';
export { TOKENS, ServiceIdentifier } from './core/container/Tokens';
export { ConfigService, NodeStackConfigOptions, NodeBaseConfigOptions } from './core/config/ConfigService';
export { loadEnvFile } from './core/config/EnvLoader';
export { EventBus } from './core/events/EventBus';
export * from './core/events/types';
export * from './core/errors/AppError';

// Database
export { DatabaseService } from './database/DatabaseService';
export { IDatabaseDriver, IPreparedStatement, RunResult } from './database/drivers/IDatabaseDriver';
export { NodeSqliteDriver } from './database/drivers/NodeSqliteDriver';

// Schema
export { SchemaService } from './schema/SchemaService';
export {
  SchemaInferenceService,
  inferFieldType,
  isDateString,
  sanitizeFieldName,
  parsePayload,
  InferredSchemaResult,
  ImportJsonOptions,
  ImportJsonResult,
} from './schema/SchemaInferenceService';
export { TypeGenerator } from './schema/TypeGenerator';
export { OpenApiGenerator, OpenApiGeneratorOptions } from './schema/OpenApiGenerator';
export * from './schema/models/Collection';
export * from './schema/models/Field';

// Records
export { RecordService, ListResult, QueryOptions, ExportResult, ImportOptions, ImportResult } from './records/RecordService';
export { MockDataService, MockGenerateOptions, MockGenerateResult } from './records/MockDataService';
export { FakerEngine, FakerContext, GeneratedFilePayload } from './records/FakerEngine';
export { QueryFilterParser, ParsedFilter, ParsedSort } from './records/QueryFilterParser';
export { CsvHelper } from './records/CsvHelper';
export {
  FtsService,
  FtsQueryOptions,
  sanitizeFtsQuery,
  isFtsField,
  getFtsFields,
  getFtsTableName,
} from './records/FtsService';

// Rules
export { RuleEngine, RuleEvaluationContext } from './rules/RuleEngine';
export {
  RuleBuilder,
  RuleClause,
  ParsedRule,
  RuleOperator,
  RuleMode,
  RuleOperation,
  RuleJoinOp,
  SUPPORTED_OPERATORS,
  COMMON_AUTH_FIELDS,
} from './rules/RuleBuilder';

// Auth, API Keys & OAuth2
export { AuthService, AuthClaims, AuthResult, OAuthAuthResult } from './auth/AuthService';
export {
  ApiKeyService,
  ApiKeyModel,
  SafeApiKeyModel,
  CreateApiKeyDto,
  UpdateApiKeyDto,
  hasScope,
} from './auth/ApiKeyService';
export { OAuthProviderRegistry } from './auth/oauth/OAuthProviderRegistry';
export * from './auth/oauth/types';
export { FileStorageService, SavedFileMeta } from './files/FileStorageService';

// Realtime & Logging
export { RealtimeService, RealtimeAction, RealtimeClient } from './realtime/RealtimeService';
export { LogService, LogEntry } from './logger/LogService';
export {
  AuditLogService,
  AuditLogEntry,
  AuditDiffMap,
  AuditFieldDiff,
  AuditQueryOptions,
  AuditListResult,
} from './audit/AuditLogService';

// Webhooks
export {
  WebhookService,
  WebhookConfig,
  WebhookDeliveryLog,
  WebhookQueryOptions,
  DeliveryQueryOptions,
  DeliveryListResult,
  WebhookStatsResult,
} from './webhooks/WebhookService';

// Analytics & Metrics
export {
  AnalyticsService,
  AnalyticsMetrics,
  DatabaseMetrics,
  RealtimeMetrics,
  Traffic24hMetrics,
  HourlyDataPoint,
  CollectionRecordCount,
  formatBytes,
} from './analytics/AnalyticsService';

// HTTP & Middleware
export { HttpServer } from './http/HttpServer';
export { AuthMiddleware } from './http/middleware/AuthMiddleware';
export {
  ChaosMiddleware,
  ChaosSimulationConfig,
  RequestSimulationParams,
} from './http/middleware/ChaosMiddleware';
export { AdminUIService } from './admin/AdminUIService';
export { AdminUIBundler } from './admin/AdminUIBundler';
export { DocsService } from './admin/DocsService';

// Starter Templates & Recipes
export { TemplateService } from './templates/TemplateService';
export { TemplateImageGenerator } from './templates/TemplateImageGenerator';
export { STARTER_TEMPLATES, ecommerceTemplate, blogTemplate, crmTemplate } from './templates/definitions';
export * from './templates/types';

// Application Snapshots Management
export { SnapshotService } from './snapshots/SnapshotService';
export { SnapshotController } from './http/controllers/SnapshotController';
export * from './snapshots/types';

// Demo State Management ("Reset to Demo State")
export {
  DemoService,
  DemoSnapshotOptions,
  DemoServicePaths,
  DemoCollectionSummary,
  DemoSnapshotMetadata,
  DemoSnapshotStatus,
  DemoResetResult,
} from './demo/DemoService';
export { DemoController } from './http/controllers/DemoController';

// Formal Plugin Architecture (nodestack.use(plugin))
export { PluginManager } from './core/plugins/PluginManager';
export * from './core/plugins/types';
export * from './plugins';

// Multi-Application Architecture
export { AppManager, DatabaseDriverFactory } from './apps/AppManager';
export { AppRegistry } from './apps/AppRegistry';
export { AppScope } from './apps/AppScope';
export * from './apps/models/App';

