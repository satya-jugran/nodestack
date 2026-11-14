import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SandboxedRunner } from '../src/functions/runtime/SandboxedRunner';
import { QuickJsWasmRuntime } from '../src/functions/runtime/QuickJsWasmRuntime';
import { IFunctionRuntime, RuntimeExecutionOptions } from '../src/functions/runtime/IFunctionRuntime';
import { FunctionHostServices, FunctionExecutionResult } from '../src/functions/types';

describe('SandboxedRunner — Timeout and CPU Exhaustion Mitigation', () => {
  const dummyServices: FunctionHostServices = {
    sdk: { records: {} as any, queue: {} as any },
    network: { fetch: {} as any },
    observability: { log: vi.fn(), metric: vi.fn() },
    context: {
      app: { id: 'default', slug: 'default' },
      env: {},
    },
  };

  let runner: SandboxedRunner;

  beforeEach(() => {
    runner = new SandboxedRunner();
  });

  afterEach(async () => {
    await runner.dispose();
  });

  it('should initialize and execute code successfully within resource limits', async () => {
    await runner.init();
    const result = await runner.execute(
      'export default async function() { return { status: 200, body: "hello world" }; }',
      dummyServices,
      { timeoutMs: 1000 }
    );

    expect(result.status).toBe('success');
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('hello world');
  });

  it('should abort and return 504 when execution times out in a synchronous infinite loop', async () => {
    await runner.init();
    const start = Date.now();
    const result = await runner.execute(
      `export default async function() {
        while (true) {}
        return "unreachable";
      }`,
      dummyServices,
      { timeoutMs: 200 }
    );
    const duration = Date.now() - start;

    expect(result.status).toBe('timeout');
    expect(result.statusCode).toBe(504);
    expect(result.error).toContain('timed out');
    expect(duration).toBeLessThan(2000);
  });

  it('should abort and return 504 when execution is suspended on an unresolved promise', async () => {
    await runner.init();
    const start = Date.now();
    const result = await runner.execute(
      `export default async function() {
        await new Promise(() => {});
        return "unreachable";
      }`,
      dummyServices,
      { timeoutMs: 200 }
    );
    const duration = Date.now() - start;

    expect(result.status).toBe('timeout');
    expect(result.statusCode).toBe(504);
    expect(result.error).toContain('timed out');
    expect(duration).toBeLessThan(2000);
  });

  it('should call runtime.interrupt() when the timeout timer fires in Promise.race', async () => {
    let interruptCalled = false;
    let executionFinished = false;

    const mockHangingRuntime: IFunctionRuntime = {
      name: 'MockHangingRuntime',
      version: '1.0.0',
      init: vi.fn(async () => {}),
      execute: vi.fn(async () => {
        // Simulates long-running / hanging evaluation
        await new Promise((resolve) => setTimeout(resolve, 5000));
        executionFinished = true;
        return {
          status: 'success',
          statusCode: 200,
          durationMs: 5000,
          logs: [],
          body: 'done',
        };
      }),
      interrupt: vi.fn(() => {
        interruptCalled = true;
      }),
      dispose: vi.fn(async () => {}),
    };

    runner.setRuntime(mockHangingRuntime);

    const start = Date.now();
    const result = await runner.execute('const x = 1;', dummyServices, { timeoutMs: 150 });
    const duration = Date.now() - start;

    expect(result.status).toBe('timeout');
    expect(result.statusCode).toBe(504);
    expect(result.error).toContain('timed out after 150ms');
    expect(duration).toBeLessThan(1000);
    expect(interruptCalled).toBe(true);
    expect(mockHangingRuntime.interrupt).toHaveBeenCalled();
  });

  it('should fall back to runtime.dispose() when runtime does not implement interrupt()', async () => {
    let disposeCalled = false;

    const mockHangingRuntimeWithoutInterrupt: IFunctionRuntime = {
      name: 'MockNoInterruptRuntime',
      version: '1.0.0',
      init: vi.fn(async () => {}),
      execute: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return {
          status: 'success',
          statusCode: 200,
          durationMs: 5000,
          logs: [],
          body: 'done',
        };
      }),
      dispose: vi.fn(async () => {
        disposeCalled = true;
      }),
    };

    runner.setRuntime(mockHangingRuntimeWithoutInterrupt);

    const result = await runner.execute('const x = 1;', dummyServices, { timeoutMs: 150 });

    expect(result.status).toBe('timeout');
    expect(result.statusCode).toBe(504);
    expect(disposeCalled).toBe(true);
    expect(mockHangingRuntimeWithoutInterrupt.dispose).toHaveBeenCalled();
  });

  it('should allow manually interrupting running execution via runner.interrupt()', async () => {
    let interruptCalled = false;

    const mockRuntime: IFunctionRuntime = {
      name: 'MockRuntime',
      version: '1.0.0',
      init: vi.fn(async () => {}),
      execute: vi.fn(async () => {
        return { status: 'success', statusCode: 200, durationMs: 10, logs: [] };
      }),
      interrupt: vi.fn(() => {
        interruptCalled = true;
      }),
      dispose: vi.fn(async () => {}),
    };

    runner.setRuntime(mockRuntime);
    runner.interrupt();

    expect(interruptCalled).toBe(true);
    expect(mockRuntime.interrupt).toHaveBeenCalled();
  });

  it('QuickJsWasmRuntime.interrupt() should dispose active VM contexts to prevent CPU exhaustion', async () => {
    const qjsRuntime = new QuickJsWasmRuntime();
    await qjsRuntime.init();

    // Start a hanging execution in QuickJsWasmRuntime
    const execPromise = qjsRuntime.execute(
      'export default async function() { await new Promise(() => {}); }',
      dummyServices,
      { timeoutMs: 5000, memoryLimitMb: 32 }
    );

    // Give it a small tick to spawn the context
    await new Promise((r) => setTimeout(r, 50));

    // Manually trigger interrupt
    qjsRuntime.interrupt();

    const result = await execPromise;
    expect(result.status).toBe('timeout');
    expect(result.statusCode).toBe(504);

    await qjsRuntime.dispose();
  });

  it('should isolate timeouts across concurrent function executions', async () => {
    await runner.init();

    // Run a fast execution alongside a slow/hanging execution
    const fastPromise = runner.execute(
      'export default async function() { return { status: 200, body: "fast" }; }',
      dummyServices,
      { timeoutMs: 1000 }
    );

    const slowPromise = runner.execute(
      'export default async function() { await new Promise(() => {}); }',
      dummyServices,
      { timeoutMs: 200 }
    );

    const [fastRes, slowRes] = await Promise.all([fastPromise, slowPromise]);

    expect(fastRes.status).toBe('success');
    expect(fastRes.statusCode).toBe(200);
    expect(fastRes.body).toBe('fast');

    expect(slowRes.status).toBe('timeout');
    expect(slowRes.statusCode).toBe(504);
  });

  it('should enforce clamped safeOptions boundaries for timeoutMs', async () => {
    const mockRuntime: IFunctionRuntime = {
      name: 'MockRuntime',
      version: '1.0.0',
      init: vi.fn(async () => {}),
      execute: vi.fn(async (_code, _services, opts) => {
        return { status: 'success', statusCode: 200, durationMs: 1, logs: [], body: opts };
      }),
      dispose: vi.fn(async () => {}),
    };

    runner.setRuntime(mockRuntime);

    // Below min (100) -> clamped to 100
    const resLow = await runner.execute('const x = 1;', dummyServices, { timeoutMs: 10 });
    expect(resLow.body.timeoutMs).toBe(100);

    // Above max (15000) -> clamped to 15000
    const resHigh = await runner.execute('const x = 1;', dummyServices, { timeoutMs: 50000 });
    expect(resHigh.body.timeoutMs).toBe(15000);
  });
});
