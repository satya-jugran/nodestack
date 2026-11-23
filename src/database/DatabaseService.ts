import { AsyncLocalStorage } from 'node:async_hooks';
import { IDatabaseDriver, IPreparedStatement, RunResult } from './drivers/IDatabaseDriver';
import { NodeSqliteDriver } from './drivers/NodeSqliteDriver';
import { SystemMigrations } from './migrations/SystemMigrations';
import { ConfigService } from '../core/config/ConfigService';
import { ServiceUnavailableError } from '../core/errors/AppError';
import { ISqlDialect } from './dialects/ISqlDialect';

export class DatabaseService {
  private driver: IDatabaseDriver;
  private isLocked = false;
  private lockReason?: string;
  private txStorage = new AsyncLocalStorage<IDatabaseDriver>();

  constructor(
    private config: ConfigService,
    customDriver?: IDatabaseDriver,
    private customDbPath?: string
  ) {
    if (customDriver) {
      this.driver = customDriver;
    } else {
      this.driver = new NodeSqliteDriver(this.customDbPath || config.dbPath);
    }
  }

  public async init(): Promise<void> {
    return await SystemMigrations.run(this.driver);
  }

  public initSync(): void {
    if (this.driver.dialect.name === 'sqlite') {
      SystemMigrations.runSync(this.driver);
    }
  }

  public async initialize(driver?: IDatabaseDriver): Promise<void> {
    if (driver && this.driver && this.driver !== driver) {
      try {
        await this.driver.close();
      } catch {
        // ignore
      }
    }
    if (driver) {
      this.driver = driver;
    }

    try {
      if (this.driver.connect) {
        await this.driver.connect();
      }
      await this.init();
    } catch (err) {
      try {
        await this.driver.close();
      } catch {
        // ignore
      }
      throw err;
    }
  }

  public async switchDriver(newDriver: IDatabaseDriver): Promise<void> {
    await this.initialize(newDriver);
    this.unlock();
  }

  public get dialect(): ISqlDialect {
    return this.driver.dialect;
  }

  public getDriver(): IDatabaseDriver {
    return this.txStorage.getStore() || this.driver;
  }

  public getRootDriver(): IDatabaseDriver {
    return this.driver;
  }

  public getSchemaName(): string | undefined {
    const driver = this.getDriver();
    if (driver && typeof driver.getSchemaName === 'function') {
      return driver.getSchemaName();
    }
    return undefined;
  }

  public isOpen(): boolean {
    return this.driver.isOpen();
  }

  public lock(reason?: string): void {
    this.isLocked = true;
    this.lockReason = reason;
  }

  public unlock(): void {
    this.isLocked = false;
    this.lockReason = undefined;
  }

  public getLockReason(): string | undefined {
    return this.lockReason;
  }

  public isDatabaseLocked(): boolean {
    return this.isLocked;
  }

  private checkLocked(): void {
    if (this.isLocked) {
      throw new ServiceUnavailableError(
        this.lockReason || 'Database is temporarily locked for maintenance / demo reset.'
      );
    }
  }

  public async exec(sql: string): Promise<void> {
    this.checkLocked();
    return await this.getDriver().exec(sql);
  }

  public execSync(sql: string): void {
    this.checkLocked();
    const driver = this.getDriver();
    if (typeof (driver as any).execSync === 'function') {
      return (driver as any).execSync(sql);
    }
    (driver as any).exec(sql);
  }

  public prepare(sql: string): IPreparedStatement {
    this.checkLocked();
    return this.getDriver().prepare(sql);
  }

  public prepareSync(sql: string): {
    all: <T = any>(...params: any[]) => T[];
    get: <T = any>(...params: any[]) => T | undefined;
    run: (...params: any[]) => RunResult;
  } {
    this.checkLocked();
    const driver = this.getDriver();
    if (typeof (driver as any).prepareSync === 'function') {
      return (driver as any).prepareSync(sql);
    }
    return this.prepare(sql) as any;
  }

  public transactionSync<T>(fn: () => T): T {
    this.checkLocked();
    const driver = this.getDriver();
    if (typeof driver.transactionSync === 'function') {
      return driver.transactionSync(() => fn());
    }
    const rawDb = (driver as any).rawDb;
    if (rawDb && typeof rawDb.exec === 'function') {
      const sp = `sync_sp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      rawDb.exec(`SAVEPOINT ${sp};`);
      try {
        const res = fn();
        if (res && typeof (res as any).then === 'function') {
          throw new Error('Asynchronous functions cannot be used with synchronous transactionSync()');
        }
        rawDb.exec(`RELEASE SAVEPOINT ${sp};`);
        return res;
      } catch (err) {
        try {
          rawDb.exec(`ROLLBACK TO SAVEPOINT ${sp};`);
          rawDb.exec(`RELEASE SAVEPOINT ${sp};`);
        } catch {}
        throw err;
      }
    }
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      throw new Error('Asynchronous functions cannot be used with synchronous transactionSync()');
    }
    return res;
  }

  public async all<T = any>(sql: string, ...params: any[]): Promise<T[]> {
    this.checkLocked();
    return await this.prepare(sql).all<T>(...params);
  }

  public async get<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
    this.checkLocked();
    return await this.prepare(sql).get<T>(...params);
  }

  public async run(sql: string, ...params: any[]): Promise<RunResult> {
    this.checkLocked();
    return await this.prepare(sql).run(...params);
  }

  public async transaction<T>(fn: (txDriver: IDatabaseDriver) => Promise<T> | T): Promise<T> {
    this.checkLocked();
    const runWithTx = (txDriver: IDatabaseDriver) => {
      return this.txStorage.run(txDriver, () => fn(txDriver));
    };

    return await this.getDriver().transaction(runWithTx as any);
  }

  public async checkpoint(): Promise<void> {
    try {
      if (this.driver.dialect.name === 'sqlite') {
        await this.driver.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      }
    } catch {
      // ignore
    }
  }

  public async reconnect(customDriver?: IDatabaseDriver): Promise<void> {
    if (customDriver) {
      try {
        await this.driver.close();
      } catch {}
      this.driver = customDriver;
      return;
    }

    if (this.driver.dialect?.name && this.driver.dialect.name !== 'sqlite') {
      if (this.driver.isOpen()) {
        try {
          if (typeof (this.driver as any).ping === 'function') {
            const isHealthy = await this.driver.ping();
            if (isHealthy) {
              return;
            }
          } else {
            return;
          }
        } catch {
          // ping failed, attempt recreation below
        }
      }

      if (typeof (this.driver as any).clone === 'function') {
        const oldDriver = this.driver;
        try {
          await oldDriver.close();
        } catch {}
        this.driver = (oldDriver as any).clone();
        return;
      }

      // Preserve existing non-sqlite driver if it cannot be cloned
      return;
    }

    const oldDriver = this.driver;
    try {
      await oldDriver.close();
    } catch {}

    if (typeof (oldDriver as any).clone === 'function') {
      this.driver = (oldDriver as any).clone();
    } else {
      this.driver = new NodeSqliteDriver(this.customDbPath || this.config.dbPath);
    }
  }

  public async close(): Promise<void> {
    await this.driver.close();
  }

  public async dispose(): Promise<void> {
    await this.close();
  }

  public getSync<T = any>(sql: string, ...params: any[]): T | undefined {
    const driver = this.getDriver();
    if ('prepareSync' in driver && typeof (driver as any).prepareSync === 'function') {
      return (driver as any).prepareSync(sql).get(...params);
    }
    return undefined;
  }

  public allSync<T = any>(sql: string, ...params: any[]): T[] {
    const driver = this.getDriver();
    if ('prepareSync' in driver && typeof (driver as any).prepareSync === 'function') {
      return (driver as any).prepareSync(sql).all(...params);
    }
    return [];
  }

  public runSync(sql: string, ...params: any[]): RunResult {
    const driver = this.getDriver();
    if ('prepareSync' in driver && typeof (driver as any).prepareSync === 'function') {
      return (driver as any).prepareSync(sql).run(...params);
    }
    return { changes: 0, lastInsertRowid: 0 };
  }
}
