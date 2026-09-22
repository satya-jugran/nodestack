import { IDatabaseDriver, IPreparedStatement, RunResult } from './drivers/IDatabaseDriver';
import { NodeSqliteDriver } from './drivers/NodeSqliteDriver';
import { SystemMigrations } from './migrations/SystemMigrations';
import { ConfigService } from '../core/config/ConfigService';

export class DatabaseService {
  private driver: IDatabaseDriver;

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

  public exec(sql: string): void {
    this.driver.exec(sql);
  }

  public prepare(sql: string): IPreparedStatement {
    return this.driver.prepare(sql);
  }

  public all<T = any>(sql: string, ...params: any[]): T[] {
    return this.driver.prepare(sql).all<T>(...params);
  }

  public get<T = any>(sql: string, ...params: any[]): T | undefined {
    return this.driver.prepare(sql).get<T>(...params);
  }

  public run(sql: string, ...params: any[]): RunResult {
    return this.driver.prepare(sql).run(...params);
  }

  public transaction<T>(fn: () => T): T {
    return this.driver.transaction(fn);
  }

  public close(): void {
    this.driver.close();
  }

  public dispose(): void {
    this.close();
  }
}
