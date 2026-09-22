import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

export interface NodeStackConfigOptions {
  dataDir?: string;
  port?: number;
  host?: string;
  jwtSecret?: string;
  appName?: string;
  dev?: boolean;
}

// Deprecated alias for backwards compatibility
export type NodeBaseConfigOptions = NodeStackConfigOptions;

export class ConfigService {
  public readonly dataDir: string;
  public readonly dbPath: string;
  public readonly storageDir: string;
  public readonly port: number;
  public readonly host: string;
  public readonly jwtSecret: string;
  public readonly appName: string;
  public readonly dev: boolean;

  constructor(options: NodeStackConfigOptions = {}) {
    this.dataDir = path.resolve(options.dataDir || process.env.NODESTACK_DATA_DIR || process.env.NODEBASE_DATA_DIR || './nodestack_data');
    this.port = options.port || Number(process.env.NODESTACK_PORT || process.env.NODEBASE_PORT) || 8090;
    this.host = options.host || process.env.NODESTACK_HOST || process.env.NODEBASE_HOST || '0.0.0.0';
    this.appName = options.appName || 'NodeStack';
    this.dev = options.dev ?? process.env.NODE_ENV !== 'production';

    // Ensure storage and data directories exist
    this.storageDir = path.join(this.dataDir, 'storage');
    this.dbPath = path.join(this.dataDir, 'data.db');

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    // JWT Secret persistence or generation
    const secretFilePath = path.join(this.dataDir, '.secret');
    const envSecret = process.env.NODESTACK_JWT_SECRET || process.env.NODEBASE_JWT_SECRET;
    if (options.jwtSecret || envSecret) {
      this.jwtSecret = options.jwtSecret || envSecret!;
    } else if (fs.existsSync(secretFilePath)) {
      this.jwtSecret = fs.readFileSync(secretFilePath, 'utf-8').trim();
    } else {
      this.jwtSecret = crypto.randomBytes(32).toString('hex');
      try {
        fs.writeFileSync(secretFilePath, this.jwtSecret, 'utf-8');
      } catch {
        // ignore if read-only
      }
    }
  }
}
