import { IDatabaseDriver, IPreparedStatement, RunResult } from './IDatabaseDriver';
import { ISqlDialect } from '../dialects/ISqlDialect';
import { MssqlDialect } from '../dialects/MssqlDialect';

export interface MssqlDriverOptions {
  connectionString?: string;
  server?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    enableArithAbort?: boolean;
  };
  pool?: {
    max?: number;
    min?: number;
    idleTimeoutMillis?: number;
  };
  schemaName?: string;
  transaction?: any;
  connectionPool?: any;
  readReplicas?: string[];
  replicaPools?: any[];
  isSharedPool?: boolean;
}

export class MssqlDriver implements IDatabaseDriver {
  public readonly dialect: ISqlDialect = new MssqlDialect();
  private pool: any;
  private replicaPools: any[] = [];
  private replicaConnectPromises: Promise<any>[] = [];
  private replicaHealth = new Map<any, number>(); // pool -> last failure timestamp
  private replicaIndex = 0;
  private tx: any;
  private schemaName: string;
  private open = true;
  private isTransaction = false;
  private isSharedPool = false;
  private connectPromise?: Promise<any>;

  constructor(options: string | MssqlDriverOptions) {
    let mssqlModule: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mssqlModule = require('mssql');
    } catch {
      if (!options || typeof options !== 'object' || (!options.connectionPool && !options.transaction)) {
        throw new Error(
          "SQL Server driver requires the 'mssql' package. Install it via 'npm install mssql'."
        );
      }
    }

    const ConnectionPool = mssqlModule ? (mssqlModule.ConnectionPool || mssqlModule.default?.ConnectionPool) : null;

    if (typeof options === 'string') {
      this.pool = new ConnectionPool(options);
      this.schemaName = 'dbo';
      this.connectPromise = this.pool.connect();
    } else {
      if (options.isSharedPool || options.connectionPool) {
        this.isSharedPool = true;
      }
      this.schemaName = options.schemaName || 'dbo';
      if (options.replicaPools) {
        this.replicaPools = options.replicaPools;
      } else if (Array.isArray(options.readReplicas)) {
        for (const uri of options.readReplicas) {
          if (uri && uri.trim()) {
            try {
              const rPool = new ConnectionPool(uri.trim());
              if (rPool.connect) {
                this.replicaConnectPromises.push(rPool.connect().catch((e: any) => {
                  console.warn('MSSQL replica connect error:', uri, e.message);
                }));
              }
              this.replicaPools.push(rPool);
            } catch (e) {
              console.warn('Failed to initialize MSSQL replica pool:', uri, e);
            }
          }
        }
      }

      if (options.transaction) {
        this.tx = options.transaction;
        this.pool = options.connectionPool;
        this.isTransaction = true;
      } else if (options.connectionPool) {
        this.pool = options.connectionPool;
      } else if (options.connectionString) {
        this.pool = new ConnectionPool(options.connectionString);
        this.connectPromise = this.pool.connect();
      } else {
        const config = {
          server: options.server || 'localhost',
          port: options.port || 1433,
          user: options.user,
          password: options.password,
          database: options.database,
          options: {
            encrypt: options.options?.encrypt ?? true,
            trustServerCertificate: options.options?.trustServerCertificate ?? true,
            enableArithAbort: options.options?.enableArithAbort ?? true,
          },
          pool: {
            max: options.pool?.max ?? 20,
            min: options.pool?.min ?? 2,
            idleTimeoutMillis: options.pool?.idleTimeoutMillis ?? 30000,
          },
        };
        this.pool = new ConnectionPool(config);
        this.connectPromise = this.pool.connect();
      }
    }
  }

  public getReplicaPools(): any[] {
    return this.replicaPools;
  }

  private isReadOnlySql(sql: string): boolean {
    const trimmed = sql.trim();
    if (!/^\s*(SELECT|EXPLAIN|SHOW|WITH)\b/i.test(trimmed)) {
      return false;
    }
    if (/\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b/i.test(trimmed)) {
      return false;
    }
    if (/\bFOR\s+(UPDATE|SHARE)\b/i.test(trimmed)) {
      return false;
    }
    return true;
  }

  private isConnectionError(err: any): boolean {
    if (!err) return false;
    const msg = (err.message || String(err)).toLowerCase();
    const code = err.code || '';
    return (
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT' ||
      code === 'EHOSTUNREACH' ||
      msg.includes('connection terminated') ||
      msg.includes('connection closed') ||
      msg.includes('connection refused') ||
      msg.includes('connection dropped') ||
      msg.includes('connection reset') ||
      msg.includes('timeout') ||
      msg.includes('failed to connect') ||
      msg.includes('network')
    );
  }

  private getReadPool(): any {
    if (this.tx) {
      return null;
    }
    if (this.replicaPools.length > 0) {
      const now = Date.now();
      const healthyPools = this.replicaPools.filter(
        (p) => now - (this.replicaHealth.get(p) || 0) > 30000
      );
      const poolsToUse = healthyPools.length > 0 ? healthyPools : this.replicaPools;
      const idx = Math.abs(this.replicaIndex++) % poolsToUse.length;
      return poolsToUse[idx];
    }
    return this.pool;
  }

  public qualifySql(sql: string): string {
    if (!this.schemaName || this.schemaName === 'dbo') {
      return sql;
    }
    const s = this.schemaName;
    let out = sql.replace(/\bSCHEMA_NAME\(\)/gi, `'${s}'`);

    // Qualify table names: FROM, INTO, UPDATE, TABLE, JOIN, MERGE INTO
    out = out.replace(
      /\b(FROM|INTO|UPDATE|TABLE|JOIN|MERGE\s+INTO)\s+((?:\[[a-zA-Z0-9_]+\])|(?:"[a-zA-Z0-9_]+")|(?:[a-zA-Z_][a-zA-Z0-9_]*))(?!\s*\.)/gi,
      (match, clause, table) => {
        const cleanTable = table.replace(/[\[\]"]/g, '');
        if (
          cleanTable.startsWith('sys') ||
          cleanTable.startsWith('INFORMATION_SCHEMA') ||
          cleanTable.toUpperCase() === 'VALUES' ||
          cleanTable.toUpperCase() === 'SELECT'
        ) {
          return match;
        }
        return `${clause} [${s}].[${cleanTable}]`;
      }
    );

    // CREATE INDEX [idx] ON [table]
    out = out.replace(
      /\b(CREATE\s+(?:UNIQUE\s+)?INDEX\s+\[?[a-zA-Z0-9_]+\]?\s+ON)\s+((?:\[[a-zA-Z0-9_]+\])|(?:"[a-zA-Z0-9_]+")|(?:[a-zA-Z_][a-zA-Z0-9_]*))(?!\s*\.)/gi,
      (match, clause, table) => {
        const cleanTable = table.replace(/[\[\]"]/g, '');
        return `${clause} [${s}].[${cleanTable}]`;
      }
    );

    // OBJECT_ID('<table>' -> OBJECT_ID('[schema].[table]'
    out = out.replace(/\bOBJECT_ID\s*\(\s*'([^'.]+)'/gi, (match, table) => {
      const clean = table.replace(/[\[\]]/g, '');
      return `OBJECT_ID('[${s}].[${clean}]'`;
    });

    return out;
  }

  public async ensureConnected(): Promise<void> {
    if (this.connectPromise) {
      await this.connectPromise;
      this.connectPromise = undefined;
    }
    if (this.replicaConnectPromises.length > 0) {
      await Promise.all(this.replicaConnectPromises);
      this.replicaConnectPromises = [];
    }
  }

  public getSchemaName(): string {
    return this.schemaName;
  }

  public async exec(sql: string): Promise<void> {
    this.checkOpen();
    await this.ensureConnected();
    const req = this.tx ? this.tx.request() : this.pool.request();
    await req.batch(this.qualifySql(sql));
  }

  private bindParams(request: any, rawParams: any[]): void {
    let flatParams = rawParams;
    if (rawParams.length === 1 && Array.isArray(rawParams[0])) {
      flatParams = rawParams[0];
    }

    flatParams.forEach((param, index) => {
      const paramName = `p${index + 1}`;
      if (param === undefined || param === null) {
        request.input(paramName, null);
      } else if (typeof param === 'boolean') {
        request.input(paramName, param ? 1 : 0);
      } else if (typeof param === 'object' && !(param instanceof Buffer) && !(param instanceof Uint8Array) && !(param instanceof Date)) {
        request.input(paramName, JSON.stringify(param));
      } else {
        request.input(paramName, param);
      }
    });
  }

  public prepare(sql: string): IPreparedStatement {
    this.checkOpen();
    const rewrittenSql = this.qualifySql(this.dialect.rewritePlaceholders(sql));
    const isRead = this.isReadOnlySql(rewrittenSql);

    return {
      all: async <T = any>(...params: any[]): Promise<T[]> => {
        this.checkOpen();
        await this.ensureConnected();
        const readPool = (isRead && !this.tx && this.replicaPools.length > 0)
          ? this.getReadPool()
          : null;

        if (readPool) {
          try {
            const req = readPool.request();
            this.bindParams(req, params);
            const res = await req.query(rewrittenSql);
            return (res.recordset || []).map((r: any) => ({ ...r }));
          } catch (err: any) {
            if (this.isConnectionError(err)) {
              this.replicaHealth.set(readPool, Date.now());
              // Fallback to primary pool
            } else {
              throw err;
            }
          }
        }

        const req = this.tx ? this.tx.request() : this.pool.request();
        this.bindParams(req, params);
        const res = await req.query(rewrittenSql);
        return (res.recordset || []).map((r: any) => ({ ...r }));
      },
      get: async <T = any>(...params: any[]): Promise<T | undefined> => {
        this.checkOpen();
        await this.ensureConnected();
        const readPool = (isRead && !this.tx && this.replicaPools.length > 0)
          ? this.getReadPool()
          : null;

        if (readPool) {
          try {
            const req = readPool.request();
            this.bindParams(req, params);
            const res = await req.query(rewrittenSql);
            return res.recordset && res.recordset.length > 0 ? { ...res.recordset[0] } : undefined;
          } catch (err: any) {
            if (this.isConnectionError(err)) {
              this.replicaHealth.set(readPool, Date.now());
              // Fallback to primary pool
            } else {
              throw err;
            }
          }
        }

        const req = this.tx ? this.tx.request() : this.pool.request();
        this.bindParams(req, params);
        const res = await req.query(rewrittenSql);
        return res.recordset && res.recordset.length > 0 ? { ...res.recordset[0] } : undefined;
      },
      run: async (...params: any[]): Promise<RunResult> => {
        this.checkOpen();
        await this.ensureConnected();
        const req = this.tx ? this.tx.request() : this.pool.request();
        this.bindParams(req, params);
        const res = await req.query(rewrittenSql);
        const changes = Array.isArray(res.rowsAffected)
          ? res.rowsAffected.reduce((a: number, b: number) => a + b, 0)
          : (res.rowsAffected || 0);
        return {
          changes,
          lastInsertRowid: res.recordset?.[0]?.id ?? 0,
        };
      },
    };
  }

  public async transaction<T>(fn: (txDriver: IDatabaseDriver) => Promise<T> | T): Promise<T> {
    this.checkOpen();
    await this.ensureConnected();

    if (this.tx) {
      // nested inside existing transaction
      return await fn(this);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mssqlModule = require('mssql');
    const Transaction = mssqlModule.Transaction || mssqlModule.default?.Transaction;
    const tx = new Transaction(this.pool);

    await tx.begin();
    const txDriver = new MssqlDriver({
      transaction: tx,
      connectionPool: this.pool,
      replicaPools: this.replicaPools,
      schemaName: this.schemaName,
    });

    try {
      const result = await fn(txDriver);
      await tx.commit();
      return result;
    } catch (err) {
      try {
        await tx.rollback();
      } catch {}
      throw err;
    }
  }

  public async withSchema(schemaOrSlug: string): Promise<IDatabaseDriver> {
    this.checkOpen();
    await this.ensureConnected();
    let schemaName: string;
    if (schemaOrSlug === 'default' || schemaOrSlug === 'dbo') {
      schemaName = 'dbo';
    } else if (schemaOrSlug.startsWith('app_')) {
      schemaName = schemaOrSlug.replace(/[^a-zA-Z0-9_]/g, '_');
    } else {
      schemaName = `app_${schemaOrSlug.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    }

    if (schemaName !== 'dbo') {
      const req = this.pool.request();
      await req.query(`
        IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '${schemaName}')
        EXEC('CREATE SCHEMA [${schemaName}]');
      `);
    }

    return new MssqlDriver({
      connectionPool: this.pool,
      replicaPools: this.replicaPools,
      schemaName,
      isSharedPool: true,
    });
  }

  public async ping(): Promise<boolean> {
    try {
      this.checkOpen();
      await this.ensureConnected();
      const req = this.pool.request();
      const res = await req.query('SELECT 1 AS ok');
      return Boolean(res?.recordset?.length);
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    if (this.open) {
      this.open = false;
      if (!this.isTransaction && !this.isSharedPool) {
        if (this.pool) {
          try {
            await this.pool.close();
          } catch {}
        }
        for (const rPool of this.replicaPools) {
          try {
            await rPool.close();
          } catch {}
        }
      }
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
