import { IDatabaseDriver, IPreparedStatement, RunResult } from './IDatabaseDriver';

export class NodeSqliteDriver implements IDatabaseDriver {
  private db: any;
  private open = false;

  constructor(filePath: string) {
    // Dynamic require so it only loads in Node environments supporting node:sqlite
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(filePath);
    this.open = true;

    // Enable WAL mode, foreign keys, and sensible timeouts
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA foreign_keys = ON;');
      this.db.exec('PRAGMA busy_timeout = 5000;');
    } catch {
      // ignore pragma failures in memory
    }
  }

  public exec(sql: string): void {
    this.checkOpen();
    this.db.exec(sql);
  }

  public prepare(sql: string): IPreparedStatement {
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

  public transaction<T>(fn: () => T): T {
    this.checkOpen();
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // ignore rollback errors
      }
      throw error;
    }
  }

  public close(): void {
    if (this.open) {
      this.db.close();
      this.open = false;
    }
  }

  public isOpen(): boolean {
    return this.open;
  }

  private checkOpen(): void {
    if (!this.open) {
      throw new Error('Database is closed');
    }
  }
}
