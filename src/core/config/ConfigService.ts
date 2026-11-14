import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { loadEnvFile } from './EnvLoader';
import { loadOrCreateSecret } from '../crypto/secret';

export type CorsOrigin =
  | boolean
  | string
  | RegExp
  | Array<string | RegExp>
  | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void | Promise<boolean>);

export interface CorsConfigOptions {
  origin?: CorsOrigin;
  credentials?: boolean;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  maxAge?: number;
  allowDevReflection?: boolean;
}

export interface NodeStackConfigOptions {
  dataDir?: string;
  port?: number;
  host?: string;
  jwtSecret?: string;
  apiKeySecret?: string;
  appName?: string;
  dev?: boolean;
  chaosEnabled?: boolean;
  maxMockDelayMs?: number;
  mockDelay?: number | string;
  mockFailRate?: number;
  mockError?: number | string;
  mockJitter?: number;
  mockErrorMessage?: string;
  queueJobRetentionDays?: number;
  cors?: boolean | CorsConfigOptions;
  corsOrigin?: string | string[];
}

// Deprecated alias for backwards compatibility
export type NodeBaseConfigOptions = NodeStackConfigOptions;

export class ConfigService {
  public readonly dataDir: string;
  public readonly dbPath: string;
  public readonly storageDir: string;
  public readonly systemDbPath: string;
  public readonly appsDir: string;
  public readonly port: number;
  public readonly host: string;
  public readonly jwtSecret: string;
  public readonly apiKeySecret?: string;
  public readonly appName: string;
  public readonly dev: boolean;
  public readonly chaosEnabled: boolean;
  public readonly maxMockDelayMs: number;
  public readonly mockDelay?: number | string;
  public readonly mockFailRate?: number;
  public readonly mockError?: number | string;
  public readonly mockJitter?: number;
  public readonly mockErrorMessage?: string;
  public readonly queueJobRetentionDays: number;
  public readonly cors?: boolean | CorsConfigOptions;

  constructor(options: NodeStackConfigOptions = {}) {
    loadEnvFile();
    this.dataDir = path.resolve(options.dataDir || process.env.NODESTACK_DATA_DIR || process.env.NODEBASE_DATA_DIR || './nodestack_data');
    this.port = options.port || Number(process.env.NODESTACK_PORT || process.env.NODEBASE_PORT) || 8090;
    this.host = options.host || process.env.NODESTACK_HOST || process.env.NODEBASE_HOST || '0.0.0.0';
    this.appName = options.appName || 'NodeStack';
    this.dev = options.dev ?? process.env.NODE_ENV !== 'production';

    // CORS configuration
    const envCorsOrigin = process.env.NODESTACK_CORS_ORIGIN || process.env.NODEBASE_CORS_ORIGIN;
    const envCorsCredentials = process.env.NODESTACK_CORS_CREDENTIALS || process.env.NODEBASE_CORS_CREDENTIALS;

    if (options.cors === false) {
      this.cors = false;
    } else {
      const corsOpts: CorsConfigOptions =
        typeof options.cors === 'object' && options.cors !== null ? { ...options.cors } : {};

      if (corsOpts.origin === undefined) {
        if (options.corsOrigin !== undefined) {
          corsOpts.origin = options.corsOrigin;
        } else if (envCorsOrigin !== undefined) {
          const trimmed = envCorsOrigin.trim();
          if (trimmed === '*') {
            corsOpts.origin = '*';
          } else if (trimmed.toLowerCase() === 'true') {
            corsOpts.origin = true;
          } else if (trimmed.toLowerCase() === 'false') {
            corsOpts.origin = false;
          } else if (trimmed.includes(',')) {
            corsOpts.origin = trimmed
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
          } else {
            corsOpts.origin = trimmed;
          }
        }
      }

      if (corsOpts.credentials === undefined && envCorsCredentials !== undefined) {
        corsOpts.credentials =
          envCorsCredentials.trim().toLowerCase() === 'true' || envCorsCredentials.trim() === '1';
      }

      const isWildcard =
        corsOpts.origin === '*' ||
        (typeof corsOpts.origin === 'string' && corsOpts.origin.trim() === '*') ||
        (Array.isArray(corsOpts.origin) &&
          corsOpts.origin.some((p) => typeof p === 'string' && p.trim() === '*'));

      if (isWildcard) {
        if (corsOpts.credentials === true) {
          (corsOpts as any)._permissiveCredentialsAttempted = true;
        }
        corsOpts.origin = '*';
        corsOpts.credentials = false;
      }

      this.cors = corsOpts;
    }

    const envRetention = process.env.QUEUE_JOB_RETENTION_DAYS || process.env.NODESTACK_QUEUE_RETENTION_DAYS;
    this.queueJobRetentionDays =
      options.queueJobRetentionDays !== undefined
        ? Math.max(0, options.queueJobRetentionDays)
        : envRetention !== undefined && !isNaN(parseInt(envRetention, 10))
          ? Math.max(0, parseInt(envRetention, 10))
          : 7;

    // Chaos simulation feature flag (enabled by default in dev, gated in production)
    const envChaos = process.env.NODESTACK_CHAOS_ENABLED || process.env.NODESTACK_ENABLE_CHAOS;
    if (options.chaosEnabled !== undefined) {
      this.chaosEnabled = options.chaosEnabled;
    } else if (envChaos !== undefined) {
      this.chaosEnabled = envChaos === 'true' || envChaos === '1';
    } else {
      this.chaosEnabled = this.dev && process.env.NODE_ENV !== 'production';
    }

    // Maximum mock delay clamping limit (default 15,000ms)
    const envMaxDelay = process.env.NODESTACK_MAX_MOCK_DELAY || process.env.NODESTACK_MAX_DELAY;
    this.maxMockDelayMs = options.maxMockDelayMs !== undefined
      ? options.maxMockDelayMs
      : (envMaxDelay ? Number(envMaxDelay) : 15000);

    // Simulation / Chaos Configuration defaults
    const envDelay = process.env.NODESTACK_MOCK_DELAY || process.env.NODESTACK_CHAOS_DELAY;
    this.mockDelay = options.mockDelay !== undefined ? options.mockDelay : (envDelay ? (!isNaN(Number(envDelay)) ? Number(envDelay) : envDelay) : undefined);
    const envFailRate = process.env.NODESTACK_MOCK_FAIL_RATE || process.env.NODESTACK_CHAOS_FAIL_RATE;
    this.mockFailRate = options.mockFailRate !== undefined ? options.mockFailRate : (envFailRate ? Number(envFailRate) : undefined);
    const envError = process.env.NODESTACK_MOCK_ERROR || process.env.NODESTACK_CHAOS_ERROR;
    this.mockError = options.mockError !== undefined ? options.mockError : (envError ? (!isNaN(Number(envError)) ? Number(envError) : envError) : undefined);
    const envJitter = process.env.NODESTACK_MOCK_JITTER || process.env.NODESTACK_CHAOS_JITTER;
    this.mockJitter = options.mockJitter !== undefined ? options.mockJitter : (envJitter ? Number(envJitter) : undefined);
    this.mockErrorMessage = options.mockErrorMessage;

    // Ensure storage and data directories exist
    this.storageDir = path.join(this.dataDir, 'storage');
    this.systemDbPath = path.join(this.dataDir, 'system.db');
    this.appsDir = path.join(this.dataDir, 'apps');
    this.dbPath = path.join(this.dataDir, 'data.db');

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.appsDir)) {
      fs.mkdirSync(this.appsDir, { recursive: true });
    }
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    // API Key secret override if specified
    this.apiKeySecret = options.apiKeySecret || process.env.NODESTACK_API_KEY_SECRET;

    // JWT Secret persistence or generation
    const secretFilePath = path.join(this.dataDir, '.secret');
    const envSecret = process.env.NODESTACK_JWT_SECRET || process.env.NODEBASE_JWT_SECRET;
    if (options.jwtSecret || envSecret) {
      this.jwtSecret = options.jwtSecret || envSecret!;
    } else {
      try {
        this.jwtSecret = loadOrCreateSecret(secretFilePath);
      } catch {
        // Fallback to in-memory secret if filesystem is read-only
        this.jwtSecret = crypto.randomBytes(32).toString('hex');
      }
    }
  }

  public get snapshotsDir(): string {
    return path.join(this.dataDir, '.snapshots');
  }

  public getAppDir(slug: string): string {
    return path.join(this.appsDir, slug);
  }

  public getAppDbPath(slug: string): string {
    return path.join(this.appsDir, slug, 'data.db');
  }

  public getAppStorageDir(slug: string): string {
    return path.join(this.appsDir, slug, 'storage');
  }

  public getAppSnapshotDir(slug: string): string {
    return path.join(this.appsDir, slug, '.snapshots');
  }
}
