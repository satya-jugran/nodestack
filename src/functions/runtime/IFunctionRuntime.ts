import { FunctionHostServices, FunctionExecutionResult } from '../types';

export interface RuntimeExecutionOptions {
  timeoutMs: number;
  memoryLimitMb: number;
}

export interface IFunctionRuntime {
  readonly name: string;
  readonly version: string;

  /**
   * Initializes the runtime engine (e.g. loads Wasm binary or sets up worker pool)
   */
  init(): Promise<void>;

  /**
   * Executes user-defined function code in a strictly isolated sandbox
   * using the provided least-privilege context bridge.
   */
  execute(
    code: string,
    hostServices: FunctionHostServices,
    options: RuntimeExecutionOptions
  ): Promise<FunctionExecutionResult>;

  /**
   * Interrupts any active execution running in the runtime.
   */
  interrupt?(): void;

  /**
   * Cleans up and disposes runtime resources
   */
  dispose(): Promise<void>;
}
