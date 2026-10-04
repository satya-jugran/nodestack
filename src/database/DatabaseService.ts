import { IDatabaseDriver, IPreparedStatement, RunResult } from './drivers/IDatabaseDriver';
import { NodeSqliteDriver } from './drivers/NodeSqliteDriver';
import { SystemMigrations } from './migrations/SystemMigrations';
import { ConfigService } from '../core/config/ConfigService';

import { ServiceUnavailableError } from '../core/errors/AppError';

export class DatabaseService {
  private driver: IDatabaseDriver;
  private isLocked = false;

  constructor(private config: ConfigService, customDriver?: IDatabaseDriver) {
    if (customDriver) {
      this.driver = customDriver;
    } else {
      this.driver = new NodeSqliteDriver(config.dbPath);
    }
  }

  public init(): void {
    SystemMigrations.run(this.driver);
  }

  public getDriver(): IDatabaseDriver {
    return this.driver;
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

  public exec(sql: string): void {
    this.checkLocked();
    this.driver.exec(sql);
  }

  public prepare(sql: string): IPreparedStatement {
    this.checkLocked();
    return this.driver.prepare(sql);
  }

  public all<T = any>(sql: string, ...params: any[]): T[] {
    this.checkLocked();
    return this.driver.prepare(sql).all<T>(...params);
  }

  public get<T = any>(sql: string, ...params: any[]): T | undefined {
    this.checkLocked();
    return this.driver.prepare(sql).get<T>(...params);
  }

  public run(sql: string, ...params: any[]): RunResult {
    this.checkLocked();
    return this.driver.prepare(sql).run(...params);
  }

  public transaction<T>(fn: () => T): T {
    this.checkLocked();
    return this.driver.transaction(fn);
  }

  public checkpoint(): void {
    try {
      this.driver.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      // ignore
    }
  }

  public reconnect(customDriver?: IDatabaseDriver): void {
    try {
      this.driver.close();
    } catch {}
    if (customDriver) {
      this.driver = customDriver;
    } else {
      this.driver = new NodeSqliteDriver(this.config.dbPath);
    }
  }

  public close(): void {
    this.driver.close();
  }

  public dispose(): void {
    this.close();
  }
}
