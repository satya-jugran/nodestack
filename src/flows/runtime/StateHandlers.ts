import {
  TaskState,
  ChoiceState,
  MapState,
  LoopState,
  ParallelState,
  PassState,
  WaitState,
  SucceedState,
  FailState,
} from '../types';
import { IStateHandler, FlowStateContext, StateExecutionResult } from './IStateHandler';
import { FlowPathMapper } from '../utils/FlowPathMapper';
import { ConcurrencyPool } from '../utils/ConcurrencyPool';
import { ChoiceEvaluator } from './ChoiceEvaluator';
import { AppError, NotFoundError, ForbiddenError, UnauthorizedError } from '../../core/errors/AppError';

export class TaskStateHandler implements IStateHandler<TaskState> {
  public async execute(state: TaskState, context: FlowStateContext): Promise<StateExecutionResult> {
    if (!context.functionService) {
      throw new AppError(`FunctionService is unavailable for task execution`);
    }

    const fn = context.functionService.getFunctionByName(state.function) || context.functionService.getFunctionById(state.function);
    if (!fn) {
      throw new NotFoundError(`Function '${state.function}' not found`);
    }

    // Auth Policy Enforcement:
    // Flow actors must satisfy the function's authPolicy (admin, auth, apiKey)
    // unless the Task step explicitly configures intentional elevated/service-role execution.
    let effectiveActor = context.actor;
    if (state.elevated || state.serviceRole) {
      effectiveActor = context.actor?.isAdmin
        ? context.actor
        : { id: 'system:flow', isAdmin: true, role: 'service-role' };
    } else {
      context.functionService.verifyAuthPolicy(fn, context.actor);
    }

    const taskInput = FlowPathMapper.resolveInput(context.payload, state.inputPath);
    const execution = await context.functionService.executeFunction(
      state.function,
      {
        method: 'POST',
        path: `/flows/${context.flowName}/${context.stateName}`,
        query: {},
        headers: { 'x-flow-name': context.flowName, 'x-flow-step': context.stateName },
        body: taskInput,
        auth: effectiveActor,
      },
      effectiveActor
    );

    if (execution.status !== 'success') {
      const errorMsg = execution.error || `Task function '${state.function}' returned status ${execution.statusCode}`;
      const err = new Error(errorMsg);
      (err as any).statusCode = execution.statusCode;
      (err as any).logs = execution.logs;
      throw err;
    }

    const appliedPayload = FlowPathMapper.applyResult(context.payload, execution.body, state.resultPath);
    const outputPayload = FlowPathMapper.resolveOutput(appliedPayload, state.outputPath);

    return {
      nextState: state.next,
      payload: outputPayload,
      isEnd: state.end,
      status: 'succeeded',
    };
  }
}

export class ChoiceStateHandler implements IStateHandler<ChoiceState> {
  public async execute(state: ChoiceState, context: FlowStateContext): Promise<StateExecutionResult> {
    const nextState = ChoiceEvaluator.findNextState(state.choices, state.default, context.payload);

    if (!nextState) {
      throw new AppError(`Choice state '${context.stateName}' had no matching branch and no default`);
    }

    return {
      nextState,
      payload: context.payload,
      isEnd: state.end,
      status: 'succeeded',
    };
  }
}

export class MapStateHandler implements IStateHandler<MapState> {
  public async execute(state: MapState, context: FlowStateContext): Promise<StateExecutionResult> {
    const rawItems = FlowPathMapper.get(context.payload, state.itemsPath);
    const items = Array.isArray(rawItems) ? rawItems : [];

    const mappedResults = await ConcurrencyPool.map(
      items,
      async (item) => {
        return context.executeSubFlow(state.iterator.states, state.iterator.startAt, item);
      },
      state.maxConcurrency || 5
    );

    const appliedPayload = FlowPathMapper.applyResult(context.payload, mappedResults, state.resultPath);
    const outputPayload = FlowPathMapper.resolveOutput(appliedPayload, state.outputPath);

    return {
      nextState: state.next,
      payload: outputPayload,
      isEnd: state.end,
      status: 'succeeded',
    };
  }
}

export class LoopStateHandler implements IStateHandler<LoopState> {
  public async execute(state: LoopState, context: FlowStateContext): Promise<StateExecutionResult> {
    const maxIterations = state.maxIterations || 100;
    const currentCount = (context.loopCounters.get(context.stateName) || 0) + 1;
    context.loopCounters.set(context.stateName, currentCount);

    if (currentCount > maxIterations) {
      throw new AppError(`Loop state '${context.stateName}' exceeded max iterations limit of ${maxIterations}`);
    }

    const shouldLoop = ChoiceEvaluator.evaluate(state.condition, context.payload);
    const nextState = shouldLoop ? state.target : state.next;

    return {
      nextState,
      payload: context.payload,
      isEnd: !shouldLoop && state.end,
      status: 'succeeded',
    };
  }
}

export class ParallelStateHandler implements IStateHandler<ParallelState> {
  public async execute(state: ParallelState, context: FlowStateContext): Promise<StateExecutionResult> {
    const branchPromises = state.branches.map((branch) =>
      context.executeSubFlow(branch.states, branch.startAt, context.payload)
    );

    const branchResults = await Promise.all(branchPromises);
    const appliedPayload = FlowPathMapper.applyResult(context.payload, branchResults, state.resultPath);
    const outputPayload = FlowPathMapper.resolveOutput(appliedPayload, state.outputPath);

    return {
      nextState: state.next,
      payload: outputPayload,
      isEnd: state.end,
      status: 'succeeded',
    };
  }
}

export class PassStateHandler implements IStateHandler<PassState> {
  public async execute(state: PassState, context: FlowStateContext): Promise<StateExecutionResult> {
    const input = FlowPathMapper.resolveInput(context.payload, state.inputPath);
    const result = state.result !== undefined ? state.result : input;
    const appliedPayload = FlowPathMapper.applyResult(context.payload, result, state.resultPath);
    const outputPayload = FlowPathMapper.resolveOutput(appliedPayload, state.outputPath);

    return {
      nextState: state.next,
      payload: outputPayload,
      isEnd: state.end,
      status: 'succeeded',
    };
  }
}

export class WaitStateHandler implements IStateHandler<WaitState> {
  public async execute(state: WaitState, context: FlowStateContext): Promise<StateExecutionResult> {
    const seconds = Math.max(0, Math.min(state.seconds ?? 1, 60));
    if (seconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }

    return {
      nextState: state.next,
      payload: context.payload,
      isEnd: state.end,
      status: 'succeeded',
    };
  }
}

export class SucceedStateHandler implements IStateHandler<SucceedState> {
  public async execute(_state: SucceedState, context: FlowStateContext): Promise<StateExecutionResult> {
    return {
      payload: context.payload,
      isEnd: true,
      status: 'succeeded',
    };
  }
}

export class FailStateHandler implements IStateHandler<FailState> {
  public async execute(state: FailState, context: FlowStateContext): Promise<StateExecutionResult> {
    const errorMsg = state.error || state.cause || `State machine failed at step '${context.stateName}'`;
    return {
      payload: context.payload,
      isEnd: true,
      status: 'failed',
      error: errorMsg,
    };
  }
}
