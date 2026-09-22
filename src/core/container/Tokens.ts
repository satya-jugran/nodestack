export type ServiceIdentifier<T = any> = symbol | string | { new (...args: any[]): T };

export const TOKENS = {
  ConfigService: Symbol('ConfigService'),
  DatabaseDriver: Symbol('DatabaseDriver'),
  DatabaseService: Symbol('DatabaseService'),
  SchemaService: Symbol('SchemaService'),
  RuleEngine: Symbol('RuleEngine'),
  AuthService: Symbol('AuthService'),
  RecordService: Symbol('RecordService'),
  FileStorageService: Symbol('FileStorageService'),
  RealtimeService: Symbol('RealtimeService'),
  LogService: Symbol('LogService'),
  EventBus: Symbol('EventBus'),
  HttpServer: Symbol('HttpServer'),
  AdminUIService: Symbol('AdminUIService'),
  TypeGenerator: Symbol('TypeGenerator'),
  OpenApiGenerator: Symbol('OpenApiGenerator'),
  DocsService: Symbol('DocsService'),
} as const;
