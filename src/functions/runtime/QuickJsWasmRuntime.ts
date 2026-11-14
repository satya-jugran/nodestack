import { getQuickJS, shouldInterruptAfterDeadline, QuickJSWASMModule, QuickJSContext } from 'quickjs-emscripten';
import { IFunctionRuntime, RuntimeExecutionOptions } from './IFunctionRuntime';
import { FunctionHostServices, FunctionExecutionResult } from '../types';

function safeJsonForEval(val: any): string {
  const json = JSON.stringify(val ?? null);
  return json.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

interface ActiveExecutionEntry {
  vm: QuickJSContext;
  interrupt: (reason?: string) => void;
}

export class QuickJsWasmRuntime implements IFunctionRuntime {
  public readonly name = 'QuickJS-Wasm';
  public readonly version = '0.32.0';

  private qjs: QuickJSWASMModule | null = null;
  private initPromise: Promise<void> | null = null;
  private activeExecutions: Set<ActiveExecutionEntry> = new Set();

  public interrupt(): void {
    for (const entry of Array.from(this.activeExecutions)) {
      try {
        entry.interrupt();
      } catch {}
    }
    this.activeExecutions.clear();
  }

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
    let rejectInterrupt: ((err: Error) => void) | null = null;
    const interruptPromise = new Promise<never>((_, reject) => {
      rejectInterrupt = reject;
    });

    const activeEntry: ActiveExecutionEntry = {
      vm,
      interrupt: (reason?: string) => {
        isVmDisposed = true;
        try {
          vm.runtime.setInterruptHandler(() => true);
        } catch {}
        try {
          if (vm.alive) {
            vm.dispose();
          }
        } catch {}
        if (rejectInterrupt) {
          rejectInterrupt(new Error(reason || `Function execution interrupted`));
        }
      },
    };
    this.activeExecutions.add(activeEntry);

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
                const claimToken =
                  payload.claimToken ||
                  (typeof payload.options === 'string'
                    ? payload.options
                    : payload.options?.claimToken);
                result = await hostServices.sdk.queue.complete(payload.messageId || payload.jobId, payload.result, claimToken);
              } else if (callType === 'queue.fail') {
                if (!hostServices.sdk.queue) {
                  throw new Error('QueueService not available in function context');
                }
                const failOptions =
                  typeof payload.options === 'object' && payload.options !== null
                    ? { ...payload.options }
                    : {};
                if (payload.claimToken && !failOptions.claimToken) {
                  failOptions.claimToken = payload.claimToken;
                } else if (typeof payload.options === 'string') {
                  failOptions.claimToken = payload.options;
                }
                result = await hostServices.sdk.queue.fail(payload.messageId || payload.jobId, payload.error, failOptions);
              } else if (callType === 'queue.touch') {
                if (!hostServices.sdk.queue) {
                  throw new Error('QueueService not available in function context');
                }
                const claimToken =
                  payload.claimToken ||
                  (typeof payload.options === 'string'
                    ? payload.options
                    : payload.options?.claimToken);
                result = await hostServices.sdk.queue.touch(payload.messageId || payload.jobId, payload.extensionSeconds, claimToken);
              } else if (callType === 'queue.getMessage' || callType === 'queue.getJob') {
                if (!hostServices.sdk.queue) {
                  throw new Error('QueueService not available in function context');
                }
                const msgId = payload.messageId || payload.jobId;
                result = await hostServices.sdk.queue.getMessage(msgId);
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

              const resJson = safeJsonForEval(result ?? null);
              const resolveCode = `__resolve_host_call(${callId}, null, ${resJson});`;
              const res = vm.evalCode(resolveCode);
              if (res.error) {
                res.error.dispose();
                if (!isVmDisposed && vm.alive) {
                  const fallbackErrJson = safeJsonForEval('Failed to evaluate host response in guest VM');
                  const rejRes = vm.evalCode(`__resolve_host_call(${callId}, ${fallbackErrJson}, null);`);
                  if (rejRes.error) rejRes.error.dispose();
                  else rejRes.value.dispose();
                }
              } else {
                res.value.dispose();
              }
              if (isVmDisposed || !vm.alive) return;
              vm.runtime.executePendingJobs();
            } catch (err: any) {
              if (isVmDisposed || !vm.alive) return;
              const errJson = safeJsonForEval(err.message || String(err));
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

          function createQueueClient(defaultQueueName) {
            return {
              send: function(first, second, third) {
                if (defaultQueueName) {
                  return hostCall('queue.send', { queue: defaultQueueName, payload: first, options: second });
                }
                return hostCall('queue.send', { queue: first, payload: second, options: third });
              },
              claim: function(first, second) {
                if (defaultQueueName) {
                  return hostCall('queue.claim', { queue: defaultQueueName, options: first });
                }
                return hostCall('queue.claim', { queue: first, options: second });
              },
              complete: function(messageId, result, claimToken) {
                return hostCall('queue.complete', { messageId: messageId, jobId: messageId, result: result, claimToken: claimToken });
              },
              fail: function(messageId, error, opts, claimToken) {
                var options = opts;
                var token = claimToken;
                if (typeof opts === 'string') {
                  token = opts;
                  options = { claimToken: token };
                } else if (opts && typeof opts === 'object') {
                  options = Object.assign({}, opts);
                  if (token && !options.claimToken) options.claimToken = token;
                } else if (token) {
                  options = { claimToken: token };
                }
                return hostCall('queue.fail', {
                  messageId: messageId,
                  jobId: messageId,
                  error: error,
                  options: options,
                  claimToken: token || (options && options.claimToken)
                });
              },
              touch: function(messageId, extensionSeconds, claimToken) {
                var ext = typeof extensionSeconds === 'number' ? extensionSeconds : undefined;
                var token = typeof extensionSeconds === 'string' ? extensionSeconds : claimToken;
                return hostCall('queue.touch', { messageId: messageId, jobId: messageId, extensionSeconds: ext, claimToken: token });
              },
              getMessage: function(messageId) {
                return hostCall('queue.getMessage', { messageId: messageId, jobId: messageId });
              },
              getJob: function(jobId) {
                return hostCall('queue.getMessage', { messageId: jobId, jobId: jobId });
              }
            };
          }

          var queueBridge = function(queueName) {
            return createQueueClient(queueName);
          };
          Object.assign(queueBridge, createQueueClient(null));

          globalThis.core = {
            version: '2.4.0',
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
              queue: queueBridge
            },
            queue: queueBridge,
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

          var initialCtx = ${safeJsonForEval(safeContextPayload)};

          globalThis.ctx = {
            app: initialCtx.app,
            request: initialCtx.request,
            event: initialCtx.event,
            env: initialCtx.env,
            auth: initialCtx.auth,
            queue: queueBridge
          };

          // Backward compatibility for legacy 1-parameter functions (ctx):
          // delegate context fields on core so ctx.app, ctx.request, etc. resolve seamlessly
          Object.defineProperties(globalThis.core, {
            app: { get: function() { return globalThis.ctx.app; }, enumerable: true },
            request: { get: function() { return globalThis.ctx.request; }, enumerable: true },
            event: { get: function() { return globalThis.ctx.event; }, enumerable: true },
            env: { get: function() { return globalThis.ctx.env; }, enumerable: true },
            auth: { get: function() { return globalThis.ctx.auth; }, enumerable: true }
          });

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
          activeEntry.interrupt(`Function execution timed out after ${timeoutMs}ms (interrupted)`);
          reject(new Error(`Function execution timed out after ${timeoutMs}ms (interrupted)`));
        }, remainingMs);
      });

      let finalOutcome: any;
      try {
        finalOutcome = await Promise.race([promiseHandle, timeoutPromise, interruptPromise]);
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
      this.activeExecutions.delete(activeEntry);
      isVmDisposed = true;
      try {
        if (vm.alive) {
          vm.dispose();
        }
      } catch {}
    }
  }

  public async dispose(): Promise<void> {
    this.interrupt();
    this.qjs = null;
    this.initPromise = null;
  }

  /**
   * Normalizes user code into an immediately executed async function.
   * Handles:
   *  - `export default async function(core, context) { ... }`
   *  - `module.exports = async function(core, context) { ... }`
   *  - `async function(core, context) { ... }` or arrow function `async (core, context) => { ... }`
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

      // Only infer named entry point if no supported CommonJS export is present
      const codeWithoutCommentsOrStrings = codeBody
        .replace(/\/\/[^\r\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '');
      const hasCjsExport = /(?:\bmodule\s*\.\s*exports\b|\bexports\s*(?:\.|\s*=))/.test(codeWithoutCommentsOrStrings);

      // Named or anonymous function
      const namedFnMatch = /^(async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/.exec(codeBody);
      if (namedFnMatch && !hasCjsExport) {
        const fnName = namedFnMatch[2];
        code = leadingComments + codeBody + `;\n__fn = ${fnName};`;
      } else if (/^(async\s+)?function\s*\(/.test(codeBody)) {
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

        if (typeof module.exports === 'function') {
          return await module.exports(globalThis.core, globalThis.ctx);
        } else if (module.exports && typeof module.exports.default === 'function') {
          return await module.exports.default(globalThis.core, globalThis.ctx);
        } else if (typeof __fn === 'function') {
          return await __fn(globalThis.core, globalThis.ctx);
        } else if (__fn !== null && typeof __fn !== 'undefined') {
          return __fn;
        } else if (module.exports && typeof module.exports === 'object' && Object.keys(module.exports).length > 0) {
          return module.exports;
        }

        return undefined;
      })();
    `;
  }
}
