import { getQuickJS, shouldInterruptAfterDeadline, QuickJSWASMModule } from 'quickjs-emscripten';
import { IFunctionRuntime, RuntimeExecutionOptions } from './IFunctionRuntime';
import { FunctionHostServices, FunctionExecutionResult } from '../types';

export class QuickJsWasmRuntime implements IFunctionRuntime {
  public readonly name = 'QuickJS-Wasm';
  public readonly version = '0.32.0';

  private qjs: QuickJSWASMModule | null = null;
  private initPromise: Promise<void> | null = null;

  public async init(): Promise<void> {
    if (this.qjs) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.qjs = await getQuickJS();
      })();
    }
    await this.initPromise;
  }

  public async execute(
    code: string,
    hostServices: FunctionHostServices,
    options: RuntimeExecutionOptions
  ): Promise<FunctionExecutionResult> {
    await this.init();
    if (!this.qjs) {
      throw new Error('[QuickJsWasmRuntime] Runtime failed to initialize');
    }

    const startTime = Date.now();
    const capturedLogs: string[] = [];
    const maxLogs = 50;

    const appendLog = (msg: string) => {
      if (capturedLogs.length < maxLogs) {
        capturedLogs.push(msg.length > 500 ? msg.slice(0, 500) + '...' : msg);
      }
      try {
        hostServices.observability.log(msg);
      } catch {}
    };

    const vm = this.qjs.newContext();
    let isVmDisposed = false;

    try {
      // 1. Memory limit (in bytes)
      const memoryLimitBytes = Math.max(4, options.memoryLimitMb || 32) * 1024 * 1024;
      vm.runtime.setMemoryLimit(memoryLimitBytes);

      // 2. CPU / execution timeout
      const timeoutMs = Math.max(100, Math.min(options.timeoutMs || 1000, 15000));
      const deadline = Date.now() + timeoutMs;
      vm.runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));

      // 3. Register raw host bridge
      const rawInvoke = vm.newFunction(
        '__raw_host_invoke',
        (idHandle, typeHandle, payloadHandle) => {
          const callId = vm.getNumber(idHandle);
          const callType = vm.getString(typeHandle);
          const payloadStr = vm.getString(payloadHandle);

          let payload: any = null;
          if (payloadStr) {
            try {
              payload = JSON.parse(payloadStr);
            } catch {
              payload = payloadStr;
            }
          }

          // Handle synchronous logging
          if (callType === 'log') {
            const logText = Array.isArray(payload)
              ? payload.map((p) => (typeof p === 'object' ? JSON.stringify(p) : String(p))).join(' ')
              : String(payload);
            appendLog(logText);
            return;
          }

          // Handle asynchronous host operations
          (async () => {
            try {
              let result: any = null;

              if (callType === 'records.get') {
                result = await hostServices.sdk.records.get(payload.collection, payload.id);
              } else if (callType === 'records.list') {
                result = await hostServices.sdk.records.list(payload.collection, payload.options);
              } else if (callType === 'records.create') {
                result = await hostServices.sdk.records.create(payload.collection, payload.data);
              } else if (callType === 'records.update') {
                result = await hostServices.sdk.records.update(payload.collection, payload.id, payload.data);
              } else if (callType === 'records.delete') {
                result = await hostServices.sdk.records.delete(payload.collection, payload.id);
              } else if (callType === 'queue.send') {
                if (!hostServices.sdk.queue) {
                  throw new Error('QueueService not available in function context');
                }
                result = await hostServices.sdk.queue.send(payload.queue, payload.payload, payload.options);
              } else if (callType === 'queue.claim') {
                if (!hostServices.sdk.queue) {
                  throw new Error('QueueService not available in function context');
                }
                result = await hostServices.sdk.queue.claim(payload.queue, payload.options);
              } else if (callType === 'queue.complete') {
                if (!hostServices.sdk.queue) {
                  throw new Error('QueueService not available in function context');
                }
                result = await hostServices.sdk.queue.complete(payload.jobId, payload.result);
              } else if (callType === 'queue.fail') {
                if (!hostServices.sdk.queue) {
                  throw new Error('QueueService not available in function context');
                }
                result = await hostServices.sdk.queue.fail(payload.jobId, payload.error, payload.options);
              } else if (callType === 'queue.getJob') {
                if (!hostServices.sdk.queue) {
                  throw new Error('QueueService not available in function context');
                }
                result = await hostServices.sdk.queue.getJob(payload.jobId);
              } else if (callType === 'metric') {
                hostServices.observability.metric?.(payload.name, payload.value, payload.tags);
                result = { ok: true };
              } else if (callType === 'fetch') {
                const response = await hostServices.network.fetch(payload.url, payload.init);
                let responseBody: any = null;
                const contentType = response.headers['content-type'] || '';
                if (contentType.includes('application/json')) {
                  try {
                    responseBody = await response.json();
                  } catch {
                    responseBody = await response.text();
                  }
                } else {
                  responseBody = await response.text();
                }

                result = {
                  ok: response.ok,
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                  data: responseBody,
                };
              } else {
                throw new Error(`Unknown host action: ${callType}`);
              }

              if (isVmDisposed || !vm.alive) return;

              const resJson = JSON.stringify(result ?? null);
              const resolveCode = `__resolve_host_call(${callId}, null, ${resJson});`;
              const res = vm.evalCode(resolveCode);
              if (res.error) {
                res.error.dispose();
              } else {
                res.value.dispose();
              }
              if (isVmDisposed || !vm.alive) return;
              vm.runtime.executePendingJobs();
            } catch (err: any) {
              if (isVmDisposed || !vm.alive) return;
              const errJson = JSON.stringify(err.message || String(err));
              const rejectCode = `__resolve_host_call(${callId}, ${errJson}, null);`;
              const res = vm.evalCode(rejectCode);
              if (res.error) res.error.dispose();
              else res.value.dispose();
              if (isVmDisposed || !vm.alive) return;
              vm.runtime.executePendingJobs();
            }
          })();
        }
      );

      vm.setProp(vm.global, '__raw_host_invoke', rawInvoke);
      rawInvoke.dispose();

      // 4. Inject guest bridge runtime and context object
      const safeContextPayload = {
        app: hostServices.context.app || { id: 'default', slug: 'default' },
        request: hostServices.context.request || {
          method: 'POST',
          path: '/api/functions',
          query: {},
          headers: {},
          body: {},
          auth: null,
        },
        event: hostServices.context.event || null,
        env: hostServices.context.env || {},
        auth: hostServices.context.auth || null,
      };

      const bridgeSetupCode = `
        (function() {
          globalThis.__pendingCalls = new Map();
          globalThis.__resolve_host_call = function(id, err, result) {
            var entry = globalThis.__pendingCalls.get(id);
            if (entry) {
              globalThis.__pendingCalls.delete(id);
              if (err) entry.reject(new Error(err));
              else entry.resolve(result);
            }
          };

          function hostCall(type, payload) {
            return new Promise(function(resolve, reject) {
              var id = Math.floor(Math.random() * 1000000000);
              globalThis.__pendingCalls.set(id, { resolve: resolve, reject: reject });
              __raw_host_invoke(id, type, JSON.stringify(payload || {}));
            });
          }

          function hostHttpFetch(url, init) {
            return hostCall('fetch', { url: url, init: init }).then(function(res) {
              return {
                ok: res.ok,
                status: res.status,
                statusText: res.statusText,
                headers: res.headers,
                json: function() { return Promise.resolve(res.data); },
                text: function() { return Promise.resolve(typeof res.data === 'string' ? res.data : JSON.stringify(res.data)); }
              };
            });
          }

          function emitLog(args) {
            __raw_host_invoke(0, 'log', JSON.stringify(args));
          }

          globalThis.core = {
            version: '2.3.0',
            sdk: {
              collection: function(colName) {
                return {
                  get: function(id, opts) { return hostCall('records.get', { collection: colName, id: id, options: opts }); },
                  list: function(opts) { return hostCall('records.list', { collection: colName, options: opts }); },
                  create: function(data, opts) { return hostCall('records.create', { collection: colName, data: data, options: opts }); },
                  update: function(id, data, opts) { return hostCall('records.update', { collection: colName, id: id, data: data, options: opts }); },
                  delete: function(id, opts) { return hostCall('records.delete', { collection: colName, id: id, options: opts }); }
                };
              },
              queue: function(queueName) {
                return {
                  send: function(payload, opts) {
                    return hostCall('queue.send', { queue: queueName, payload: payload, options: opts });
                  },
                  claim: function(opts) {
                    return hostCall('queue.claim', { queue: queueName, options: opts });
                  },
                  complete: function(jobId, result) {
                    return hostCall('queue.complete', { jobId: jobId, result: result });
                  },
                  fail: function(jobId, error, opts) {
                    return hostCall('queue.fail', { jobId: jobId, error: error, options: opts });
                  },
                  getJob: function(jobId) {
                    return hostCall('queue.getJob', { jobId: jobId });
                  }
                };
              }
            },
            network: {
              http: {
                fetch: function(url, init) { return hostHttpFetch(url, init); },
                get: function(url, opts) { return hostHttpFetch(url, Object.assign({}, opts, { method: 'GET' })); },
                post: function(url, body, opts) { return hostHttpFetch(url, Object.assign({}, opts, { method: 'POST', body: JSON.stringify(body) })); }
              }
            },
            observability: {
              log: function() { emitLog(Array.prototype.slice.call(arguments)); },
              info: function() { emitLog(Array.prototype.slice.call(arguments)); },
              warn: function() { emitLog(Array.prototype.slice.call(arguments)); },
              error: function() { emitLog(Array.prototype.slice.call(arguments)); },
              metric: function(name, value, tags) { hostCall('metric', { name: name, value: value, tags: tags }); }
            }
          };

          var initialCtx = ${JSON.stringify(safeContextPayload)};

          globalThis.ctx = {
            app: initialCtx.app,
            request: initialCtx.request,
            event: initialCtx.event,
            env: initialCtx.env,
            auth: initialCtx.auth
          };

          // JavaScript standard globals delegate to core subsystems
          globalThis.fetch = globalThis.core.network.http.fetch;
          globalThis.console = {
            log: globalThis.core.observability.log,
            info: globalThis.core.observability.info,
            warn: globalThis.core.observability.warn,
            error: globalThis.core.observability.error
          };
        })();
      `;

      const setupRes = vm.evalCode(bridgeSetupCode);
      if (setupRes.error) {
        const errorDetail = vm.dump(setupRes.error);
        setupRes.error.dispose();
        throw new Error(`Failed to configure sandbox bridge: ${JSON.stringify(errorDetail)}`);
      }
      setupRes.value.dispose();

      // 5. Transform user code to execute cleanly
      const normalizedCode = this.prepareUserCode(code);

      // 6. Execute user code
      const evalRes = vm.evalCode(normalizedCode);
      if (evalRes.error) {
        const errObj = vm.dump(evalRes.error);
        evalRes.error.dispose();
        const durationMs = Date.now() - startTime;
        const errMsg = errObj?.message || String(errObj);

        if (errMsg.includes('interrupted')) {
          return {
            status: 'timeout',
            statusCode: 504,
            durationMs,
            logs: capturedLogs,
            error: `Function execution timed out after ${timeoutMs}ms`,
          };
        }

        return {
          status: 'error',
          statusCode: 500,
          durationMs,
          logs: capturedLogs,
          error: errMsg,
        };
      }

      // 7. Resolve promise if returned
      const promiseHandle = vm.resolvePromise(evalRes.value);
      evalRes.value.dispose();
      vm.runtime.executePendingJobs();

      let timeoutTimer: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        const remainingMs = Math.max(0, deadline - Date.now());
        timeoutTimer = setTimeout(() => {
          reject(new Error(`Function execution timed out after ${timeoutMs}ms (interrupted)`));
        }, remainingMs);
      });

      let finalOutcome: any;
      try {
        finalOutcome = await Promise.race([promiseHandle, timeoutPromise]);
      } finally {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
      }
      const durationMs = Date.now() - startTime;

      if (finalOutcome.error) {
        const errDump = vm.dump(finalOutcome.error);
        finalOutcome.error.dispose();
        const errMsg = errDump?.message || String(errDump);

        if (errMsg.includes('interrupted')) {
          return {
            status: 'timeout',
            statusCode: 504,
            durationMs,
            logs: capturedLogs,
            error: `Function execution timed out after ${timeoutMs}ms`,
          };
        }

        return {
          status: 'error',
          statusCode: 500,
          durationMs,
          logs: capturedLogs,
          error: errMsg,
        };
      }

      const rawResult = vm.dump(finalOutcome.value);
      finalOutcome.value.dispose();

      // Parse status, headers, and body from rawResult
      let statusCode = 200;
      let headers: Record<string, string> | undefined;
      let body: any = rawResult;

      if (rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)) {
        if ('status' in rawResult && typeof rawResult.status === 'number') {
          statusCode = rawResult.status;
          if ('body' in rawResult) {
            body = rawResult.body;
          }
        } else if ('statusCode' in rawResult && typeof rawResult.statusCode === 'number') {
          statusCode = rawResult.statusCode;
          if ('body' in rawResult) {
            body = rawResult.body;
          }
        }

        if ('headers' in rawResult && typeof rawResult.headers === 'object') {
          headers = rawResult.headers;
        }
      }

      return {
        status: 'success',
        statusCode,
        body,
        headers,
        durationMs,
        logs: capturedLogs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errMsg = err.message || String(err);

      if (errMsg.includes('interrupted')) {
        return {
          status: 'timeout',
          statusCode: 504,
          durationMs,
          logs: capturedLogs,
          error: `Function execution timed out after ${options.timeoutMs}ms`,
        };
      }

      return {
        status: 'error',
        statusCode: 500,
        durationMs,
        logs: capturedLogs,
        error: errMsg,
      };
    } finally {
      isVmDisposed = true;
      try {
        if (vm.alive) {
          vm.dispose();
        }
      } catch {}
    }
  }

  public async dispose(): Promise<void> {
    this.qjs = null;
    this.initPromise = null;
  }

  /**
   * Normalizes user code into an immediately executed async function.
   * Handles:
   *  - `export default async function(ctx) { ... }`
   *  - `module.exports = async function(ctx) { ... }`
   *  - `async function(ctx) { ... }` or arrow function `async (ctx) => { ... }`
   *  - Direct statements `return { hello: "world" }`
   */
  private prepareUserCode(rawCode: string): string {
    let code = rawCode.trim();

    // 1. If code defines an export default
    if (/^\s*export\s+default\s+/m.test(code)) {
      code = code.replace(/^\s*export\s+default\s+/m, '__fn = ');
    } else {
      // 2. Check for leading comments and identify the first statement / expression
      const leadingCommentRegex = /^(\s*(\/\/[^\r\n]*\r?\n|\/\*[\s\S]*?\*\/))+/;
      const match = leadingCommentRegex.exec(code);
      const leadingComments = match ? match[0] : '';
      const codeBody = code.slice(leadingComments.length).trim();

      // Anonymous function: async function(...) or function(...)
      if (/^(async\s+)?function\s*\(/.test(codeBody)) {
        code = leadingComments + '__fn = ' + codeBody;
      } else if (/^(async\s+)?(\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/.test(codeBody)) {
        // Arrow function
        code = leadingComments + '__fn = ' + codeBody;
      }
    }

    return `
      (async function() {
        var __fn = null;
        var module = { exports: {} };
        var exports = module.exports;

        ${code}

        if (typeof __fn === 'function') {
          return await __fn(globalThis.core, globalThis.ctx);
        } else if (__fn !== null && typeof __fn !== 'undefined') {
          return __fn;
        } else if (typeof module.exports === 'function') {
          return await module.exports(globalThis.core, globalThis.ctx);
        } else if (module.exports && typeof module.exports.default === 'function') {
          return await module.exports.default(globalThis.core, globalThis.ctx);
        } else if (Object.keys(module.exports).length > 0) {
          return module.exports;
        }

        return undefined;
      })();
    `;
  }
}
