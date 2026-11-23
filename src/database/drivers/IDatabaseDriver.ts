import { ISqlDialect } from '../dialects/ISqlDialect';

export interface RunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface IPreparedStatement {
  all<T = any>(...params: any[]): Promise<T[]>;
  get<T = any>(...params: any[]): Promise<T | undefined>;
  run(...params: any[]): Promise<RunResult>;
}

export interface IDatabaseDriver {
  readonly dialect: ISqlDialect;
  prepare(sql: string): IPreparedStatement;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (txDriver: IDatabaseDriver) => Promise<T> | T): Promise<T>;
  withSchema(schemaName: string): Promise<IDatabaseDriver>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
  isOpen(): boolean;
  clone?(): IDatabaseDriver;
  getSchemaName?(): string;
  connect?(): Promise<void>;
}
