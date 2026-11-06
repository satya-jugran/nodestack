import {
  FlowDefinition,
  FlowState,
  FlowStepLog,
  FlowExecution,
  FlowExecutionOptions,
  FlowStateType,
  FlowRetryPolicy,
  FlowCatchPolicy,
  FlowCheckpoint,
  FlowStepTransitionEvent,
  FlowResumeOptions,
} from './types';
import { IStateHandler, FlowStateContext, StateExecutionResult } from './runtime/IStateHandler';
import {
  TaskStateHandler,
  ChoiceStateHandler,
  MapStateHandler,
  LoopStateHandler,
  ParallelStateHandler,
  PassStateHandler,
  WaitStateHandler,
  SucceedStateHandler,
  FailStateHandler,
} from './runtime/StateHandlers';
import { FlowPathMapper } from './utils/FlowPathMapper';
import { FunctionService } from '../functions/FunctionService';
import { AppError } from '../core/errors/AppError';

export class FlowEngine {
  private handlers = new Map<FlowStateType, IStateHandler<any>>();

  constructor() {
    this.registerDefaultHandlers();
  }

  public static generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  public registerHandler(type: FlowStateType, handler: IStateHandler<any>): void {
    this.handlers.set(type, handler);
  }

  private registerDefaultHandlers(): void {
    this.handlers.set('Task', new TaskStateHandler());
    this.handlers.set('Choice', new ChoiceStateHandler());
    this.handlers.set('Map', new MapStateHandler());
    this.handlers.set('Loop', new LoopStateHandler());
    this.handlers.set('Parallel', new ParallelStateHandler());
    this.handlers.set('Pass', new PassStateHandler());
    this.handlers.set('Wait', new WaitStateHandler());
    this.handlers.set('Succeed', new SucceedStateHandler());
    this.handlers.set('Fail', new FailStateHandler());
  }

  /**
   * Executes a complete flow definition from startAt (or resume checkpoint) to completion.
   */
  public async execute(
    flowName: string,
    definition: FlowDefinition,
    input: any,
    options: {
      actor?: any;
      functionService?: FunctionService;
      executionId?: string;
      flowId?: string;
      executionOptions?: FlowExecutionOptions;
      onStepTransition?: (event: FlowStepTransitionEvent) => Promise<void> | void;
      resumeFrom?: FlowResumeOptions;
      signal?: AbortSignal;
      sharedStepTracker?: { count: number };
    } = {}
  ): Promise<FlowExecution> {
    const startedAt = options.resumeFrom?.startedAt || new Date().toISOString();
    const startTime = Date.now();
    const baseDurationMs = options.resumeFrom?.durationMs || 0;
    const executionId = options.executionId || options.executionOptions?.executionId || FlowEngine.generateExecutionId();
    const stepLogs: FlowStepLog[] = options.resumeFrom?.stepLogs ? [...options.resumeFrom.stepLogs] : [];

    let loopCounters: Map<string, number>;
    if (options.resumeFrom?.loopCounters) {
      if (options.resumeFrom.loopCounters instanceof Map) {
        loopCounters = new Map(options.resumeFrom.loopCounters);
      } else {
        loopCounters = new Map(Object.entries(options.resumeFrom.loopCounters));
      }
    } else {
      loopCounters = new Map<string, number>();
    }

    const timeoutMs = options.executionOptions?.timeoutMs || (definition.timeoutSeconds ? definition.timeoutSeconds * 1000 : 30000);
    const deadline = startTime + timeoutMs;
    const maxStepTransitions = 500;
    let stepCount = options.resumeFrom?.stepCount || stepLogs.length;
    const stepTracker = options.sharedStepTracker || { count: stepCount };

    let currentStateName: string | undefined = options.resumeFrom ? options.resumeFrom.stateName : definition.startAt;
    let currentPayload = options.resumeFrom?.payload !== undefined
      ? JSON.parse(JSON.stringify(options.resumeFrom.payload))
      : (input !== undefined ? JSON.parse(JSON.stringify(input)) : {});
    let lastStepInputSnapshot: any = currentPayload !== undefined ? JSON.parse(JSON.stringify(currentPayload)) : undefined;

    const subFlowExecutor = async (states: Record<string, FlowState>, startAt: string, subInput: any): Promise<any> => {
      const remainingMs = Math.max(1, deadline - Date.now());
      const subOptions = {
        ...options,
        executionId: undefined,
        onStepTransition: undefined,
        resumeFrom: undefined,
        signal: options.signal,
        sharedStepTracker: stepTracker,
        executionOptions: {
          ...options.executionOptions,
          executionId: undefined,
          timeoutMs: options.executionOptions?.timeoutMs
            ? Math.min(options.executionOptions.timeoutMs, remainingMs)
            : remainingMs,
        },
      };
      const subDef: FlowDefinition = { startAt, states, timeoutSeconds: definition.timeoutSeconds };
      const subExec = await this.execute(flowName, subDef, subInput, subOptions);
      if (subExec.status !== 'succeeded') {
        if (subExec.status === 'timeout') {
          const timeoutErr = new AppError(subExec.error || `Sub-flow in '${flowName}' timed out`, 408);
          (timeoutErr as any).status = 'timeout';
          throw timeoutErr;
        }
        if (subExec.status === 'cancelled') {
          const cancelErr = new AppError(subExec.error || `Sub-flow in '${flowName}' was cancelled`, 499);
          (cancelErr as any).status = 'cancelled';
          throw cancelErr;
        }
        const err = new Error(subExec.error || `Sub-flow execution ${subExec.status}`);
        err.name = subExec.errorName || 'Error';
        if (subExec.errorCode) {
          (err as any).code = subExec.errorCode;
        }
        throw err;
      }
      return subExec.output;
    };

    try {
      while (currentStateName) {
        if (options.signal?.aborted) {
          const cancelErr = new AppError(options.signal.reason || `Flow '${flowName}' execution was cancelled`, 499);
          (cancelErr as any).status = 'cancelled';
          throw cancelErr;
        }

        if (Date.now() > deadline) {
          throw new AppError(`Flow '${flowName}' execution timed out after ${timeoutMs}ms`, 408);
        }

        stepCount++;
        stepTracker.count++;
        if (stepCount > maxStepTransitions || stepTracker.count > maxStepTransitions) {
          throw new AppError(`Flow '${flowName}' exceeded maximum step transitions (${maxStepTransitions})`, 400);
        }

        const state: FlowState | undefined = definition.states[currentStateName];
        if (!state) {
          throw new AppError(`State '${currentStateName}' not found in flow '${flowName}'`);
        }

        const handler = this.handlers.get(state.type);
        if (!handler) {
          throw new AppError(`No handler registered for state type '${state.type}'`);
        }

        const stateContext: FlowStateContext = {
          flowName,
          stateName: currentStateName,
          payload: currentPayload,
          actor: options.actor,
          functionService: options.functionService,
          loopCounters,
          executeSubFlow: subFlowExecutor,
          signal: options.signal,
        };

        const stepStartTime = Date.now();
        const stepInputSnapshot = currentPayload !== undefined
          ? JSON.parse(JSON.stringify(currentPayload))
          : undefined;
        lastStepInputSnapshot = stepInputSnapshot;
        let stepResult: StateExecutionResult;

        const remainingMs = Math.max(1, deadline - Date.now());
        let stepTimer: any;
        const stepTimeoutPromise = new Promise<never>((_, reject) => {
          stepTimer = setTimeout(() => {
            const timeoutErr = new AppError(`Flow '${flowName}' execution timed out after ${timeoutMs}ms`, 408);
            (timeoutErr as any).status = 'timeout';
            reject(timeoutErr);
          }, remainingMs);
        });

        try {
          try {
            stepResult = await Promise.race([
              this.executeWithRetry(handler, state, stateContext),
              stepTimeoutPromise,
            ]);
          } finally {
            clearTimeout(stepTimer);
          }
        } catch (err: any) {
          const isTimeout =
            (err instanceof AppError && err.statusCode === 408) ||
            (err as any)?.statusCode === 408 ||
            (err as any)?.status === 'timeout' ||
            Date.now() > deadline;
          const isCancelled =
            (err as any)?.status === 'cancelled' ||
            (err as any)?.statusCode === 499;

          if (!isTimeout && !isCancelled) {
            const caught = this.tryCatchTransition(state, err, currentPayload);
            if (caught) {
              const stepDuration = Date.now() - stepStartTime;
              const stepLog: FlowStepLog = {
                step: currentStateName,
                type: state.type,
                input: stepInputSnapshot,
                output: caught.payload,
                status: 'failed',
                durationMs: stepDuration,
                error: err.message || String(err),
                timestamp: new Date().toISOString(),
                nextState: caught.nextState,
              };
              stepLogs.push(stepLog);

              currentPayload = caught.payload;
              currentStateName = caught.nextState;

              if (options.onStepTransition) {
                const checkpoint: FlowCheckpoint = {
                  currentStateName,
                  currentPayload,
                  stepCount,
                  loopCounters: Object.fromEntries(loopCounters),
                  updatedAt: new Date().toISOString(),
                };
                await options.onStepTransition({
                  executionId,
                  flowId: options.flowId,
                  flowName,
                  step: stepLog.step,
                  stepLog,
                  stepLogs,
                  nextState: currentStateName,
                  payload: currentPayload,
                  durationMs: baseDurationMs + (Date.now() - startTime),
                  isEnd: false,
                  status: 'running',
                  checkpoint,
                });
              }
              continue;
            }
          }

          const failedStepLog: FlowStepLog = {
            step: currentStateName,
            type: state.type,
            input: stepInputSnapshot,
            status: 'failed',
            durationMs: Date.now() - stepStartTime,
            error: err.message || String(err),
            timestamp: new Date().toISOString(),
          };
          stepLogs.push(failedStepLog);

          if (options.onStepTransition) {
            const checkpoint: FlowCheckpoint = {
              currentStateName,
              currentPayload: stepInputSnapshot,
              stepCount,
              loopCounters: Object.fromEntries(loopCounters),
              updatedAt: new Date().toISOString(),
            };
            await options.onStepTransition({
              executionId,
              flowId: options.flowId,
              flowName,
              step: currentStateName,
              stepLog: failedStepLog,
              stepLogs,
              nextState: undefined,
              payload: stepInputSnapshot,
              durationMs: baseDurationMs + (Date.now() - startTime),
              isEnd: true,
              status: 'failed',
              checkpoint,
            });
          }
          throw err;
        }

        const stepDurationMs = Date.now() - stepStartTime;
        const isEnd = Boolean(stepResult.isEnd || !stepResult.nextState);
        const nextState = isEnd ? undefined : stepResult.nextState;

        const stepLog: FlowStepLog = {
          step: currentStateName,
          type: state.type,
          input: stepInputSnapshot,
          output: stepResult.payload !== undefined ? JSON.parse(JSON.stringify(stepResult.payload)) : undefined,
          status: stepResult.status,
          durationMs: stepDurationMs,
          error: stepResult.error,
          timestamp: new Date().toISOString(),
          nextState,
        };
        stepLogs.push(stepLog);

        if (stepResult.status === 'failed') {
          if (options.onStepTransition) {
            const checkpoint: FlowCheckpoint = {
              currentStateName,
              currentPayload: stepInputSnapshot,
              stepCount,
              loopCounters: Object.fromEntries(loopCounters),
              updatedAt: new Date().toISOString(),
            };
            await options.onStepTransition({
              executionId,
              flowId: options.flowId,
              flowName,
              step: currentStateName,
              stepLog,
              stepLogs,
              nextState: undefined,
              payload: stepInputSnapshot,
              durationMs: baseDurationMs + (Date.now() - startTime),
              isEnd: true,
              status: 'failed',
              checkpoint,
            });
          }
          throw new Error(stepResult.error || `Step '${currentStateName}' failed`);
        }

        if (Date.now() > deadline) {
          throw new AppError(`Flow '${flowName}' execution timed out after ${timeoutMs}ms`, 408);
        }

        currentPayload = stepResult.payload;

        if (options.onStepTransition) {
          const checkpoint: FlowCheckpoint = {
            currentStateName: nextState || null,
            currentPayload,
            stepCount,
            loopCounters: Object.fromEntries(loopCounters),
            updatedAt: new Date().toISOString(),
          };
          await options.onStepTransition({
            executionId,
            flowId: options.flowId,
            flowName,
            step: currentStateName,
            stepLog,
            stepLogs,
            nextState,
            payload: currentPayload,
            durationMs: baseDurationMs + (Date.now() - startTime),
            isEnd,
            status: isEnd ? 'succeeded' : 'running',
            checkpoint,
          });
        }

        if (isEnd) {
          break;
        }

        currentStateName = stepResult.nextState;
      }

      if (Date.now() > deadline) {
        throw new AppError(`Flow '${flowName}' execution timed out after ${timeoutMs}ms`, 408);
      }

      const totalDuration = baseDurationMs + (Date.now() - startTime);
      return {
        id: executionId,
        flowId: options.flowId || 'inline',
        flowName,
        status: 'succeeded',
        input,
        output: currentPayload,
        durationMs: totalDuration,
        stepLogs,
        actorId: typeof options.actor === 'string' ? options.actor : (options.actor?.id || options.actor?.email || null),
        actor: typeof options.actor === 'object' && options.actor !== null ? options.actor : (options.actor ? { id: options.actor } : null),
        startedAt,
        finishedAt: new Date().toISOString(),
        checkpoint: null,
      };
    } catch (err: any) {
      const isTimeout =
        (err instanceof AppError && err.statusCode === 408) ||
        (err as any)?.statusCode === 408 ||
        (err as any)?.status === 'timeout';
      const isCancelled =
        (err as any)?.status === 'cancelled' ||
        (err as any)?.statusCode === 499;
      const totalDuration = baseDurationMs + (Date.now() - startTime);
      const errorName = err?.name || (err instanceof Error ? 'Error' : undefined);
      const errorCode = err?.code ? String(err.code) : undefined;
      return {
        id: executionId,
        flowId: options.flowId || 'inline',
        flowName,
        status: isTimeout ? 'timeout' : (isCancelled ? 'cancelled' : 'failed'),
        input,
        output: currentPayload,
        error: err.message || String(err),
        errorName,
        errorCode,
        durationMs: totalDuration,
        stepLogs,
        actorId: typeof options.actor === 'string' ? options.actor : (options.actor?.id || options.actor?.email || null),
        actor: typeof options.actor === 'object' && options.actor !== null ? options.actor : (options.actor ? { id: options.actor } : null),
        startedAt,
        finishedAt: new Date().toISOString(),
        checkpoint: (currentStateName && !err?.message?.includes('Failed to persist checkpoint')) ? {
          currentStateName,
          currentPayload: lastStepInputSnapshot,
          stepCount,
          loopCounters: Object.fromEntries(loopCounters),
          updatedAt: new Date().toISOString(),
        } : null,
      };
    }
  }

  private async executeWithRetry(
    handler: IStateHandler<any>,
    state: FlowState,
    context: FlowStateContext
  ): Promise<StateExecutionResult> {
    const retryPolicies = (state as any).retry as FlowRetryPolicy[] | undefined;
    let attempt = 0;

    while (true) {
      if (context.signal?.aborted) {
        const cancelErr = new AppError('State execution aborted', 499);
        (cancelErr as any).status = 'cancelled';
        throw cancelErr;
      }

      try {
        return await handler.execute(state, context);
      } catch (err: any) {
        attempt++;
        const policy = this.findMatchingRetryPolicy(retryPolicies, err);

        const maxAttempts = policy?.maxAttempts ?? 3;
        if (!policy || attempt >= maxAttempts) {
          throw err;
        }

        const baseInterval = policy.intervalSeconds ?? 1;
        const rate = policy.backoffRate ?? 2;
        const delayMs = baseInterval * Math.pow(rate, attempt - 1) * 1000;

        if (context.signal?.aborted) {
          const cancelErr = new AppError('State execution aborted during retry backoff', 499);
          (cancelErr as any).status = 'cancelled';
          throw cancelErr;
        }

        await new Promise<void>((resolve, reject) => {
          let timer: any;
          const onAbort = () => {
            clearTimeout(timer);
            const cancelErr = new AppError('State execution aborted during retry backoff', 499);
            (cancelErr as any).status = 'cancelled';
            reject(cancelErr);
          };
          if (context.signal) {
            context.signal.addEventListener('abort', onAbort, { once: true });
          }
          timer = setTimeout(() => {
            if (context.signal) {
              context.signal.removeEventListener('abort', onAbort);
            }
            resolve();
          }, delayMs);
        });
      }
    }
  }

  private findMatchingRetryPolicy(policies: FlowRetryPolicy[] | undefined, error: any): FlowRetryPolicy | undefined {
    if (!policies || policies.length === 0) {
      return undefined;
    }

    const errName = error.name || 'Error';
    const errCode = error.code ? String(error.code) : undefined;
    const errMsg = error.message || '';

    return policies.find((policy) => {
      if (!policy.errorEquals || policy.errorEquals.length === 0 || policy.errorEquals.includes('*') || policy.errorEquals.includes('States.ALL')) {
        return true;
      }
      return policy.errorEquals.some((expected) => expected === errName || (errCode && expected === errCode) || errMsg.includes(expected));
    });
  }

  private tryCatchTransition(
    state: FlowState,
    error: any,
    currentPayload: any
  ): { nextState: string; payload: any } | null {
    const catchPolicies = (state as any).catch as FlowCatchPolicy[] | undefined;
    if (!catchPolicies || catchPolicies.length === 0) {
      return null;
    }

    const errName = error.name || 'Error';
    const errCode = error.code ? String(error.code) : undefined;
    const errMsg = error.message || '';

    const matchingPolicy = catchPolicies.find((policy) => {
      if (!policy.errorEquals || policy.errorEquals.length === 0 || policy.errorEquals.includes('*') || policy.errorEquals.includes('States.ALL')) {
        return true;
      }
      return policy.errorEquals.some((expected) => expected === errName || (errCode && expected === errCode) || errMsg.includes(expected));
    });

    if (!matchingPolicy) {
      return null;
    }

    const errorDetails = {
      error: errName,
      message: errMsg,
      code: errCode,
      statusCode: (error as any).statusCode || 500,
    };

    const nextPayload = FlowPathMapper.applyResult(currentPayload, errorDetails, matchingPolicy.resultPath);
    return {
      nextState: matchingPolicy.next,
      payload: nextPayload,
    };
  }
}
