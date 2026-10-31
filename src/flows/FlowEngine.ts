import {
  FlowDefinition,
  FlowState,
  FlowStepLog,
  FlowExecution,
  FlowExecutionOptions,
  FlowStateType,
  FlowRetryPolicy,
  FlowCatchPolicy,
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
   * Executes a complete flow definition from startAt to completion.
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
    } = {}
  ): Promise<FlowExecution> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const executionId = options.executionId || `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const stepLogs: FlowStepLog[] = [];
    const loopCounters = new Map<string, number>();

    const timeoutMs = options.executionOptions?.timeoutMs || (definition.timeoutSeconds ? definition.timeoutSeconds * 1000 : 30000);
    const deadline = startTime + timeoutMs;
    const maxStepTransitions = 500;
    let stepCount = 0;

    let currentStateName: string | undefined = definition.startAt;
    let currentPayload = input !== undefined ? JSON.parse(JSON.stringify(input)) : {};

    const subFlowExecutor = async (states: Record<string, FlowState>, startAt: string, subInput: any): Promise<any> => {
      const remainingMs = Math.max(1, deadline - Date.now());
      const subOptions = {
        ...options,
        executionOptions: {
          ...options.executionOptions,
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
        throw new Error(subExec.error || `Sub-flow execution ${subExec.status}`);
      }
      return subExec.output;
    };

    try {
      while (currentStateName) {
        if (Date.now() > deadline) {
          throw new AppError(`Flow '${flowName}' execution timed out after ${timeoutMs}ms`, 408);
        }

        if (++stepCount > maxStepTransitions) {
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
        };

        const stepStartTime = Date.now();
        const stepInputSnapshot = JSON.parse(JSON.stringify(currentPayload));
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
              stepLogs.push({
                step: currentStateName,
                type: state.type,
                input: stepInputSnapshot,
                output: caught.payload,
                status: 'failed',
                durationMs: Date.now() - stepStartTime,
                error: err.message || String(err),
                timestamp: new Date().toISOString(),
              });

              currentPayload = caught.payload;
              currentStateName = caught.nextState;
              continue;
            }
          }

          stepLogs.push({
            step: currentStateName,
            type: state.type,
            input: stepInputSnapshot,
            status: 'failed',
            durationMs: Date.now() - stepStartTime,
            error: err.message || String(err),
            timestamp: new Date().toISOString(),
          });
          throw err;
        }

        const stepDurationMs = Date.now() - stepStartTime;
        stepLogs.push({
          step: currentStateName,
          type: state.type,
          input: stepInputSnapshot,
          output: JSON.parse(JSON.stringify(stepResult.payload)),
          status: stepResult.status,
          durationMs: stepDurationMs,
          error: stepResult.error,
          timestamp: new Date().toISOString(),
        });

        if (stepResult.status === 'failed') {
          throw new Error(stepResult.error || `Step '${currentStateName}' failed`);
        }

        if (Date.now() > deadline) {
          throw new AppError(`Flow '${flowName}' execution timed out after ${timeoutMs}ms`, 408);
        }

        currentPayload = stepResult.payload;

        if (stepResult.isEnd || !stepResult.nextState) {
          break;
        }

        currentStateName = stepResult.nextState;
      }

      if (Date.now() > deadline) {
        throw new AppError(`Flow '${flowName}' execution timed out after ${timeoutMs}ms`, 408);
      }

      const totalDuration = Date.now() - startTime;
      return {
        id: executionId,
        flowId: options.flowId || 'inline',
        flowName,
        status: 'succeeded',
        input,
        output: currentPayload,
        durationMs: totalDuration,
        stepLogs,
        actorId: options.actor?.id || null,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      const isTimeout =
        (err instanceof AppError && err.statusCode === 408) ||
        (err as any)?.statusCode === 408 ||
        (err as any)?.status === 'timeout';
      const isCancelled =
        (err as any)?.status === 'cancelled' ||
        (err as any)?.statusCode === 499;
      const totalDuration = Date.now() - startTime;
      return {
        id: executionId,
        flowId: options.flowId || 'inline',
        flowName,
        status: isTimeout ? 'timeout' : (isCancelled ? 'cancelled' : 'failed'),
        input,
        output: currentPayload,
        error: err.message || String(err),
        durationMs: totalDuration,
        stepLogs,
        actorId: options.actor?.id || null,
        startedAt,
        finishedAt: new Date().toISOString(),
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
      try {
        return await handler.execute(state, context);
      } catch (err: any) {
        attempt++;
        const policy = this.findMatchingRetryPolicy(retryPolicies, err);

        if (!policy || attempt >= (policy.maxAttempts || 3)) {
          throw err;
        }

        const baseInterval = policy.intervalSeconds || 1;
        const rate = policy.backoffRate || 2;
        const delayMs = baseInterval * Math.pow(rate, attempt - 1) * 1000;

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private findMatchingRetryPolicy(policies: FlowRetryPolicy[] | undefined, error: any): FlowRetryPolicy | undefined {
    if (!policies || policies.length === 0) {
      return undefined;
    }

    const errName = error.name || 'Error';
    const errMsg = error.message || '';

    return policies.find((policy) => {
      if (!policy.errorEquals || policy.errorEquals.length === 0 || policy.errorEquals.includes('*') || policy.errorEquals.includes('States.ALL')) {
        return true;
      }
      return policy.errorEquals.some((expected) => expected === errName || errMsg.includes(expected));
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
    const errMsg = error.message || '';

    const matchingPolicy = catchPolicies.find((policy) => {
      if (!policy.errorEquals || policy.errorEquals.length === 0 || policy.errorEquals.includes('*') || policy.errorEquals.includes('States.ALL')) {
        return true;
      }
      return policy.errorEquals.some((expected) => expected === errName || errMsg.includes(expected));
    });

    if (!matchingPolicy) {
      return null;
    }

    const errorDetails = {
      error: errName,
      message: errMsg,
      statusCode: (error as any).statusCode || 500,
    };

    const nextPayload = FlowPathMapper.applyResult(currentPayload, errorDetails, matchingPolicy.resultPath);
    return {
      nextState: matchingPolicy.next,
      payload: nextPayload,
    };
  }
}
