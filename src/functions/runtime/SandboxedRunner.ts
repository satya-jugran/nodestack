import { IFunctionRuntime, RuntimeExecutionOptions } from './IFunctionRuntime';
import { QuickJsWasmRuntime } from './QuickJsWasmRuntime';
import { FunctionContext, FunctionExecutionResult } from '../types';

export class SandboxedRunner {
  private runtime: IFunctionRuntime;

  constructor(customRuntime?: IFunctionRuntime) {
    this.runtime = customRuntime || new QuickJsWasmRuntime();
  }

  /**
   * Sets or replaces the active execution engine runtime.
   * Enables drop-in replacement (e.g. QuickJS Wasm, V8 Isolates, Worker Threads).
   */
  public setRuntime(runtime: IFunctionRuntime): void {
    this.runtime = runtime;
  }

  /**
   * Returns the current active runtime engine metadata.
   */
  public getRuntimeInfo(): { name: string; version: string } {
    return {
      name: this.runtime.name,
      version: this.runtime.version,
    };
  }

  /**
   * Initializes the underlying runtime engine.
   */
  public async init(): Promise<void> {
    await this.runtime.init();
  }

  /**
   * Executes user code with the given context and resource boundaries.
   */
  public async execute(
    code: string,
    context: FunctionContext,
    options: Partial<RuntimeExecutionOptions> = {}
  ): Promise<FunctionExecutionResult> {
    const safeOptions: RuntimeExecutionOptions = {
      timeoutMs: Math.max(100, Math.min(options.timeoutMs ?? 1000, 15000)),
      memoryLimitMb: Math.max(4, Math.min(options.memoryLimitMb ?? 32, 128)),
    };

    try {
      return await this.runtime.execute(code, context, safeOptions);
    } catch (fatalError: any) {
      return {
        status: 'error',
        statusCode: 500,
        durationMs: 0,
        logs: [],
        error: `Fatal runtime error: ${fatalError.message || String(fatalError)}`,
      };
    }
  }

  /**
   * Disposes the runtime engine.
   */
  public async dispose(): Promise<void> {
    await this.runtime.dispose();
  }
}
