import { ISqlDialect } from '../dialects/ISqlDialect';

export interface RunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface IPreparedStatement {
  all<T = any>(...params: any[]): Promise<T[]> | T[];
  get<T = any>(...params: any[]): Promise<T | undefined> | (T | undefined);
  run(...params: any[]): Promise<RunResult> | RunResult;
}

export interface IDatabaseDriver {
  readonly dialect: ISqlDialect;
  prepare(sql: string): IPreparedStatement;
  exec(sql: string): Promise<void> | void;
  transaction<T>(fn: (txDriver: IDatabaseDriver) => Promise<T> | T): Promise<T> | T;
  withSchema(schemaName: string): Promise<IDatabaseDriver>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
  isOpen(): boolean;
  clone?(): IDatabaseDriver;
}
