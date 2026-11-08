import { IDatabaseDriver, IPreparedStatement, RunResult } from './IDatabaseDriver';
import { ISqlDialect } from '../dialects/ISqlDialect';
import { PostgresDialect } from '../dialects/PostgresDialect';

export interface PostgresDriverOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: any;
  max?: number;
  min?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  schemaName?: string;
  client?: any;
  pool?: any;
  readReplicas?: string[];
  replicaPools?: any[];
  isSharedPool?: boolean;
}

export class PostgresDriver implements IDatabaseDriver {
  public readonly dialect: ISqlDialect = new PostgresDialect();
  private pool: any;
  private replicaPools: any[] = [];
  private replicaHealth = new Map<any, number>(); // pool -> last failure timestamp
  private replicaIndex = 0;
  private client: any;
  private schemaName: string;
  private open = true;
  private isTransactionClient = false;
  private isSharedPool = false;
  private savepointDepth = 0;
  private options: string | PostgresDriverOptions;

  constructor(options: string | PostgresDriverOptions) {
    this.options = options;
    let pgModule: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      pgModule = require('pg');
    } catch {
      if (!options || typeof options !== 'object' || (!options.pool && !options.client)) {
        throw new Error(
          "PostgreSQL driver requires the 'pg' package. Install it via 'npm install pg'."
        );
      }
    }

    const Pool = pgModule ? (pgModule.Pool || pgModule.default?.Pool) : null;

    if (typeof options === 'string') {
      this.pool = new Pool({ connectionString: options });
      this.schemaName = 'public';
    } else {
      if (options.isSharedPool || options.pool) {
        this.isSharedPool = true;
      }
      this.schemaName = options.schemaName || 'public';
      if (options.replicaPools) {
        this.replicaPools = options.replicaPools;
      } else if (Array.isArray(options.readReplicas)) {
        for (const uri of options.readReplicas) {
          if (uri && uri.trim()) {
            try {
              const rPool = new Pool({
                connectionString: uri.trim(),
                ssl: options.ssl,
                max: options.max ?? 10,
                min: options.min ?? 1,
                idleTimeoutMillis: options.idleTimeoutMillis ?? 30000,
                connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000,
              });
              this.replicaPools.push(rPool);
            } catch (e) {
              console.warn('Failed to initialize PostgreSQL replica pool:', uri, e);
            }
          }
        }
      }

      if (options.client) {
        this.client = options.client;
        this.pool = options.pool;
        this.isTransactionClient = true;
      } else if (options.pool) {
        this.pool = options.pool;
      } else if (options.connectionString) {
        this.pool = new Pool({
          connectionString: options.connectionString,
          ssl: options.ssl,
          max: options.max ?? 20,
          min: options.min ?? 2,
          idleTimeoutMillis: options.idleTimeoutMillis ?? 30000,
          connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000,
        });
      } else {
        this.pool = new Pool({
          host: options.host || 'localhost',
          port: options.port || 5432,
          user: options.user,
          password: options.password,
          database: options.database,
          ssl: options.ssl,
          max: options.max ?? 20,
          min: options.min ?? 2,
          idleTimeoutMillis: options.idleTimeoutMillis ?? 30000,
          connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000,
        });
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
    // Reject queries that contain mutating keywords anywhere
    if (/\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b/i.test(trimmed)) {
      return false;
    }
    // Reject row locking clauses (SELECT ... FOR UPDATE)
    if (/\bFOR\s+(UPDATE|SHARE|KEY\s+SHARE|NO\s+KEY\s+UPDATE)\b/i.test(trimmed)) {
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
      code === '57P01' || // admin_shutdown
      code === '57P02' || // crash_shutdown
      code === '57P03' || // cannot_connect_now
      code === '08000' || // connection_exception
      code === '08003' || // connection_does_not_exist
      code === '08006' || // connection_failure
      msg.includes('connection terminated') ||
      msg.includes('connection closed') ||
      msg.includes('connection refused') ||
      msg.includes('connection dropped') ||
      msg.includes('connection reset') ||
      msg.includes('timeout') ||
      msg.includes('socket closed') ||
      msg.includes('network')
    );
  }

  private getReadPool(): any {
    if (this.client) {
      return this.client;
    }
    if (this.replicaPools.length > 0) {
      const now = Date.now();
      // Filter out pools that failed within the last 30s (circuit breaker)
      const healthyPools = this.replicaPools.filter(
        (p) => now - (this.replicaHealth.get(p) || 0) > 30000
      );
      const poolsToUse = healthyPools.length > 0 ? healthyPools : this.replicaPools;
      const idx = Math.abs(this.replicaIndex++) % poolsToUse.length;
      return poolsToUse[idx];
    }
    return this.pool;
  }

  private async withClient<T>(
    poolOrClient: any,
    fn: (conn: any) => Promise<T>
  ): Promise<T> {
    if (this.client) {
      return await fn(this.client);
    }
    // If poolOrClient is mock or client without connect()
    if (!poolOrClient || typeof poolOrClient.connect !== 'function') {
      return await fn(poolOrClient);
    }

    const conn = await poolOrClient.connect();
    const targetSchema = this.schemaName ? `"${this.schemaName}", public` : 'public';
    try {
      await conn.query(`SET search_path TO ${targetSchema}`);
      return await fn(conn);
    } finally {
      try {
        await conn.query('DISCARD TEMP; SET search_path TO public;');
      } catch {}
      conn.release();
    }
  }

  public getSchemaName(): string {
    return this.schemaName;
  }

  public async exec(sql: string): Promise<void> {
    this.checkOpen();
    await this.withClient(this.client || this.pool, async (conn) => {
      await conn.query(sql);
    });
  }

  private sanitizeParams(rawParams: any[]): any[] {
    let flatParams = rawParams;
    if (rawParams.length === 1 && Array.isArray(rawParams[0])) {
      flatParams = rawParams[0];
    }

    return flatParams.map((p) => {
      if (p === undefined) return null;
      if (p !== null && typeof p === 'object' && !(p instanceof Buffer) && !(p instanceof Uint8Array) && !(p instanceof Date)) {
        return JSON.stringify(p);
      }
      return p;
    });
  }

  public prepare(sql: string): IPreparedStatement {
    this.checkOpen();
    const rewrittenSql = this.dialect.rewritePlaceholders(sql);
    const isRead = this.isReadOnlySql(rewrittenSql);

    return {
      all: async <T = any>(...params: any[]): Promise<T[]> => {
        this.checkOpen();
        const cleanedParams = this.sanitizeParams(params);
        const targetPool = (isRead && !this.client && this.replicaPools.length > 0)
          ? this.getReadPool()
          : (this.client || this.pool);

        try {
          return await this.withClient(targetPool, async (conn) => {
            const res = await conn.query(rewrittenSql, cleanedParams);
            return (res.rows || []).map((r: any) => ({ ...r }));
          });
        } catch (err) {
          // If query failed on replica pool due to connection/network drop, fallback to primary pool
          if (targetPool !== this.pool && !this.client && this.isConnectionError(err)) {
            this.replicaHealth.set(targetPool, Date.now());
            return await this.withClient(this.pool, async (conn) => {
              const res = await conn.query(rewrittenSql, cleanedParams);
              return (res.rows || []).map((r: any) => ({ ...r }));
            });
          }
          throw err;
        }
      },
      get: async <T = any>(...params: any[]): Promise<T | undefined> => {
        this.checkOpen();
        const cleanedParams = this.sanitizeParams(params);
        const targetPool = (isRead && !this.client && this.replicaPools.length > 0)
          ? this.getReadPool()
          : (this.client || this.pool);

        try {
          return await this.withClient(targetPool, async (conn) => {
            const res = await conn.query(rewrittenSql, cleanedParams);
            return res.rows && res.rows.length > 0 ? { ...res.rows[0] } : undefined;
          });
        } catch (err) {
          // If query failed on replica pool due to connection/network drop, fallback to primary pool
          if (targetPool !== this.pool && !this.client && this.isConnectionError(err)) {
            this.replicaHealth.set(targetPool, Date.now());
            return await this.withClient(this.pool, async (conn) => {
              const res = await conn.query(rewrittenSql, cleanedParams);
              return res.rows && res.rows.length > 0 ? { ...res.rows[0] } : undefined;
            });
          }
          throw err;
        }
      },
      run: async (...params: any[]): Promise<RunResult> => {
        this.checkOpen();
        const cleanedParams = this.sanitizeParams(params);
        const client = this.client || this.pool;

        return await this.withClient(client, async (conn) => {
          const res = await conn.query(rewrittenSql, cleanedParams);
          return {
            changes: res.rowCount ?? 0,
            lastInsertRowid: res.rows?.[0]?.id ?? 0,
          };
        });
      },
    };
  }

  public async transaction<T>(fn: (txDriver: IDatabaseDriver) => Promise<T> | T): Promise<T> {
    this.checkOpen();

    if (this.client) {
      // Nested transaction on existing client via SAVEPOINT
      const sp = `sp_${this.savepointDepth++}`;
      await this.client.query(`SAVEPOINT ${sp};`);
      try {
        const result = await fn(this);
        await this.client.query(`RELEASE SAVEPOINT ${sp};`);
        return result;
      } catch (err) {
        try {
          await this.client.query(`ROLLBACK TO SAVEPOINT ${sp};`);
          await this.client.query(`RELEASE SAVEPOINT ${sp};`);
        } catch {}
        throw err;
      } finally {
        this.savepointDepth--;
      }
    }

    const client = await this.pool.connect();
    const txDriver = new PostgresDriver({
      client,
      pool: this.pool,
      schemaName: this.schemaName,
    });

    try {
      await client.query('BEGIN;');
      const targetSchema = this.schemaName ? `"${this.schemaName}", public` : 'public';
      await client.query(`SET LOCAL search_path TO ${targetSchema};`);
      const result = await fn(txDriver);
      await client.query('COMMIT;');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK;');
      } catch {}
      throw err;
    } finally {
      client.release();
    }
  }

  public async withSchema(schemaOrSlug: string): Promise<IDatabaseDriver> {
    this.checkOpen();
    let schemaName: string;
    if (schemaOrSlug === 'default' || schemaOrSlug === 'public') {
      schemaName = 'public';
    } else if (schemaOrSlug.startsWith('app_')) {
      schemaName = schemaOrSlug.replace(/[^a-zA-Z0-9_]/g, '_');
    } else {
      schemaName = `app_${schemaOrSlug.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    }

    if (schemaName !== 'public') {
      await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    }

    return new PostgresDriver({
      pool: this.pool,
      replicaPools: this.replicaPools,
      schemaName,
      isSharedPool: true,
    });
  }

  public async ping(): Promise<boolean> {
    try {
      this.checkOpen();
      const res = await this.pool.query('SELECT 1 AS ok');
      return Boolean(res?.rows?.length);
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    if (this.open) {
      this.open = false;
      if (!this.isTransactionClient && !this.isSharedPool) {
        if (this.pool) {
          try {
            await this.pool.end();
          } catch {}
        }
        for (const rPool of this.replicaPools) {
          try {
            await rPool.end();
          } catch {}
        }
      }
    }
  }

  public isOpen(): boolean {
    return this.open;
  }

  public clone(): PostgresDriver {
    return new PostgresDriver(this.options);
  }

  private checkOpen(): void {
    if (!this.open) {
      throw new Error('Database is closed');
    }
  }
}
