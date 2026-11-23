import * as path from 'path';
import * as fs from 'fs';
import { IDatabaseDriver, IPreparedStatement, RunResult } from './IDatabaseDriver';
import { ISqlDialect } from '../dialects/ISqlDialect';
import { SqliteDialect } from '../dialects/SqliteDialect';

export interface NodeSqliteDriverOptions {
  baseDir?: string;
  db?: any;
  isTxDriver?: boolean;
}

export class NodeSqliteDriver implements IDatabaseDriver {
  public readonly dialect: ISqlDialect = new SqliteDialect();
  private db: any;
  private open = false;
  private filePath: string;
  private baseDir?: string;
  public transactionDepth = 0;
  private isTxDriver = false;
  private savepointDepth = 0;
  private txLockQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, options?: NodeSqliteDriverOptions) {
    this.filePath = filePath;
    this.baseDir = options?.baseDir;
    this.isTxDriver = Boolean(options?.isTxDriver);

    if (options?.db) {
      this.db = options.db;
      this.open = true;
      return;
    }

    // Ensure parent directory exists for file-based SQLite
    if (filePath && filePath !== ':memory:') {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Dynamic require so it only loads in Node environments supporting node:sqlite
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(filePath);
    this.open = true;

    // Enable WAL mode, foreign keys, and sensible timeouts
    try {
      if (filePath && filePath !== ':memory:') {
        try {
          const row = this.db.prepare('PRAGMA journal_mode = WAL;').get() as { journal_mode?: string } | undefined;
          const activeMode = String(row?.journal_mode || '').toLowerCase();
          if (activeMode && activeMode !== 'wal') {
            console.warn(
              `[NodeSqliteDriver] WARNING: Requested WAL journal mode, but SQLite database '${filePath}' is operating in '${activeMode}' mode. Concurrency will be reduced.`
            );
          }
        } catch {
          this.db.exec('PRAGMA journal_mode = WAL;');
        }
      } else {
        this.db.exec('PRAGMA journal_mode = WAL;');
      }
      this.db.exec('PRAGMA foreign_keys = ON;');
      this.db.exec('PRAGMA busy_timeout = 5000;');
    } catch {
      // ignore pragma failures in memory
    }
  }

  public get rawDb(): any {
    return this.db;
  }

  public getPath(): string {
    return this.filePath;
  }

  public async exec(sql: string): Promise<void> {
    this.checkOpen();
    this.db.exec(sql);
  }

  public execSync(sql: string): void {
    this.checkOpen();
    this.db.exec(sql);
  }

  public prepare(sql: string): IPreparedStatement {
    this.checkOpen();
    const stmt = this.db.prepare(sql);

    return {
      all: async <T = any>(...params: any[]): Promise<T[]> => {
        const rawResults = this.executeStmt(stmt, 'all', params);
        return (rawResults || []).map((r: any) => ({ ...r }));
      },
      get: async <T = any>(...params: any[]): Promise<T | undefined> => {
        const raw = this.executeStmt(stmt, 'get', params);
        return raw ? { ...raw } : undefined;
      },
      run: async (...params: any[]): Promise<RunResult> => {
        return this.executeStmt(stmt, 'run', params);
      },
    };
  }

  public prepareSync(sql: string): {
    all: <T = any>(...params: any[]) => T[];
    get: <T = any>(...params: any[]) => T | undefined;
    run: (...params: any[]) => RunResult;
  } {
    this.checkOpen();
    const stmt = this.db.prepare(sql);
    return {
      all: <T = any>(...params: any[]): T[] => {
        const rawResults = this.executeStmt(stmt, 'all', params);
        return (rawResults || []).map((r: any) => ({ ...r }));
      },
      get: <T = any>(...params: any[]): T | undefined => {
        const raw = this.executeStmt(stmt, 'get', params);
        return raw ? { ...raw } : undefined;
      },
      run: (...params: any[]): RunResult => {
        return this.executeStmt(stmt, 'run', params);
      },
    };
  }

  private sanitizeParam(val: any): any {
    if (val === undefined) return null;
    if (typeof val === 'boolean') return val ? 1 : 0;
    return val;
  }

  private sanitizeParams(params: any[]): any[] {
    return params.map((p) => {
      if (Array.isArray(p)) return p.map((item) => this.sanitizeParam(item));
      if (p && typeof p === 'object' && !(p instanceof Buffer) && !(p instanceof Uint8Array)) {
        const cleaned: Record<string, any> = {};
        for (const [k, v] of Object.entries(p)) {
          cleaned[k] = this.sanitizeParam(v);
        }
        return cleaned;
      }
      return this.sanitizeParam(p);
    });
  }

  private executeStmt(stmt: any, method: 'all' | 'get' | 'run', rawParams: any[]): any {
    const params = this.sanitizeParams(rawParams);
    if (params.length === 0) {
      return stmt[method]();
    }
    // If a single array was passed: e.g. stmt.run([1, 2])
    if (params.length === 1 && Array.isArray(params[0])) {
      return stmt[method](...params[0]);
    }
    // If a single object was passed: e.g. stmt.run({ key: 'val' })
    if (params.length === 1 && typeof params[0] === 'object' && params[0] !== null) {
      return stmt[method](params[0]);
    }
    // Multiple arguments passed: e.g. stmt.run(1, 2, 3)
    return stmt[method](...params);
  }

  private async acquireTxLock(): Promise<() => void> {
    let releaseLock: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const previousLock = this.txLockQueue;
    this.txLockQueue = currentLock;
    await previousLock;
    return releaseLock!;
  }

  public async transaction<T>(fn: (txDriver: IDatabaseDriver) => Promise<T> | T): Promise<T> {
    this.checkOpen();

    if (this.isTxDriver || this.transactionDepth > 0) {
      const depth = this.transactionDepth > 0 ? this.transactionDepth : this.savepointDepth;
      const sp = `sp_${depth}`;
      if (this.transactionDepth > 0) {
        this.transactionDepth++;
      } else {
        this.savepointDepth++;
      }
      this.db.exec(`SAVEPOINT ${sp};`);
      try {
        const res = await fn(this);
        if (this.open) {
          this.db.exec(`RELEASE SAVEPOINT ${sp};`);
        }
        return res;
      } catch (error) {
        try {
          if (this.open) {
            this.db.exec(`ROLLBACK TO SAVEPOINT ${sp};`);
            this.db.exec(`RELEASE SAVEPOINT ${sp};`);
          }
        } catch {
          // ignore rollback errors
        }
        throw error;
      } finally {
        if (this.transactionDepth > 0) {
          this.transactionDepth--;
        } else {
          this.savepointDepth--;
        }
      }
    }

    const releaseLock = await this.acquireTxLock();
    try {
      this.checkOpen();
      this.db.exec('BEGIN IMMEDIATE;');
      this.transactionDepth++;
      const txDriver = new NodeSqliteDriver(this.filePath, {
        baseDir: this.baseDir,
        db: this.db,
        isTxDriver: true,
      });
      txDriver.transactionDepth = this.transactionDepth;

      try {
        const res = await fn(txDriver);
        if (this.open) {
          this.db.exec('COMMIT;');
        }
        return res;
      } catch (error) {
        try {
          if (this.open) {
            this.db.exec('ROLLBACK;');
          }
        } catch {
          // ignore rollback errors
        }
        throw error;
      } finally {
        this.transactionDepth--;
      }
    } finally {
      releaseLock();
    }
  }

  public async withSchema(schemaName: string): Promise<IDatabaseDriver> {
    // If memory database or no directory structure, create isolated memory db or sibling file
    if (this.filePath === ':memory:') {
      return new NodeSqliteDriver(':memory:');
    }

    let targetDir = this.baseDir;
    if (targetDir) {
      if (path.basename(targetDir) !== 'apps') {
        targetDir = path.join(targetDir, 'apps');
      }
    } else {
      // If filePath is .../apps/default/data.db or .../apps/<slug>/data.db, baseDir is .../apps
      const parent = path.dirname(this.filePath);
      if (path.basename(parent) === 'default' || path.basename(path.dirname(parent)) === 'apps') {
        targetDir = path.dirname(parent);
      } else if (path.basename(parent) === 'apps') {
        targetDir = parent;
      } else if (fs.existsSync(path.join(parent, 'apps'))) {
        targetDir = path.join(parent, 'apps');
      } else {
        targetDir = path.join(parent, 'apps');
      }
    }

    const appDbPath = path.join(targetDir, schemaName, 'data.db');
    return new NodeSqliteDriver(appDbPath, { baseDir: targetDir });
  }

  public async ping(): Promise<boolean> {
    try {
      this.checkOpen();
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    if (this.open) {
      if (!this.isTxDriver) {
        this.db.close();
      }
      this.open = false;
    }
  }

  public isOpen(): boolean {
    return this.open;
  }

  public clone(): NodeSqliteDriver {
    return new NodeSqliteDriver(this.filePath, { baseDir: this.baseDir });
  }

  private checkOpen(): void {
    if (!this.open) {
      throw new Error('Database is closed');
    }
  }
}
