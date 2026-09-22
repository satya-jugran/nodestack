export interface RunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface IPreparedStatement {
  all<T = any>(...params: any[]): T[];
  get<T = any>(...params: any[]): T | undefined;
  run(...params: any[]): RunResult;
}

export interface IDatabaseDriver {
  exec(sql: string): void;
  prepare(sql: string): IPreparedStatement;
  transaction<T>(fn: () => T): T;
  close(): void;
  isOpen(): boolean;
}
