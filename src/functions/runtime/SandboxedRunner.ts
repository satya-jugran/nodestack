import { IFunctionRuntime, RuntimeExecutionOptions } from './IFunctionRuntime';
import { QuickJsWasmRuntime } from './QuickJsWasmRuntime';
import { FunctionHostServices, FunctionExecutionResult } from '../types';

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
   * Interrupts currently executing user code on the active runtime.
   */
  public interrupt(): void {
    try {
      if (this.runtime.interrupt) {
        this.runtime.interrupt();
      } else {
        void this.runtime.dispose();
      }
    } catch {}
  }

  /**
   * Executes user code with the given context and resource boundaries.
   */
  public async execute(
    code: string,
    hostServices: FunctionHostServices,
    options: Partial<RuntimeExecutionOptions> = {}
  ): Promise<FunctionExecutionResult> {
    const safeOptions: RuntimeExecutionOptions = {
      timeoutMs: Math.max(100, Math.min(options.timeoutMs ?? 1000, 15000)),
      memoryLimitMb: Math.max(4, Math.min(options.memoryLimitMb ?? 32, 128)),
    };

    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<FunctionExecutionResult>((_, reject) => {
      timer = setTimeout(() => {
        this.interrupt();
        reject(new Error(`Function execution timed out after ${safeOptions.timeoutMs}ms (interrupted)`));
      }, safeOptions.timeoutMs);
    });

    try {
      return await Promise.race([
        this.runtime.execute(code, hostServices, safeOptions),
        timeoutPromise,
      ]);
    } catch (fatalError: any) {
      const errMsg = fatalError?.message || String(fatalError);
      if (errMsg.includes('timed out') || errMsg.includes('interrupted')) {
        return {
          status: 'timeout',
          statusCode: 504,
          durationMs: safeOptions.timeoutMs,
          logs: [],
          error: `Function execution timed out after ${safeOptions.timeoutMs}ms`,
        };
      }
      return {
        status: 'error',
        statusCode: 500,
        durationMs: 0,
        logs: [],
        error: `Fatal runtime error: ${errMsg}`,
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Disposes the runtime engine.
   */
  public async dispose(): Promise<void> {
    await this.runtime.dispose();
  }
}
