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

  public init(): any {
    return SystemMigrations.run(this.driver);
  }

  public async switchDriver(newDriver: IDatabaseDriver): Promise<void> {
    const oldDriver = this.driver;
    this.driver = newDriver;
    await this.init();
    if (oldDriver && oldDriver !== newDriver) {
      try {
        await oldDriver.close();
      } catch {
        // ignore
      }
    }
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

  public isOpen(): boolean {
    return this.driver.isOpen();
  }

  public lock(): void {
    this.isLocked = true;
  }

  public unlock(): void {
    this.isLocked = false;
  }

  public isDatabaseLocked(): boolean {
    return this.isLocked;
  }

  private checkLocked(): void {
    if (this.isLocked) {
      throw new ServiceUnavailableError(
        'Database is temporarily locked for maintenance / demo reset.'
      );
    }
  }

  public exec(sql: string): any {
    this.checkLocked();
    return this.getDriver().exec(sql);
  }

  public prepare(sql: string): IPreparedStatement {
    this.checkLocked();
    return this.getDriver().prepare(sql);
  }

  public all<T = any>(sql: string, ...params: any[]): any {
    this.checkLocked();
    return this.prepare(sql).all<T>(...params);
  }

  public get<T = any>(sql: string, ...params: any[]): any {
    this.checkLocked();
    return this.prepare(sql).get<T>(...params);
  }

  public run(sql: string, ...params: any[]): any {
    this.checkLocked();
    return this.prepare(sql).run(...params);
  }

  public transaction<T>(fn: (txDriver: IDatabaseDriver) => Promise<T> | T): any {
    this.checkLocked();
    if (
      this.driver.dialect.name === 'sqlite' &&
      typeof fn === 'function' &&
      (fn.constructor?.name === 'AsyncFunction' ||
       fn.constructor?.name === 'AsyncGeneratorFunction' ||
       (fn as any)[Symbol.toStringTag] === 'AsyncFunction' ||
       (fn as any)[Symbol.toStringTag] === 'AsyncGeneratorFunction')
    ) {
      throw new Error('Asynchronous functions cannot be used with synchronous transaction(). Use synchronous operations inside transaction().');
    }

    const runWithTx = (txDriver: IDatabaseDriver) => {
      return this.txStorage.run(txDriver, () => fn(txDriver));
    };

    return this.driver.transaction(runWithTx as any);
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
    try {
      await this.driver.close();
    } catch {}
    if (customDriver) {
      this.driver = customDriver;
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
