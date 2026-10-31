import { FlowState } from '../types';
import { FunctionService } from '../../functions/FunctionService';

export interface FlowStateContext {
  flowName: string;
  stateName: string;
  payload: any;
  actor?: any;
  functionService?: FunctionService;
  loopCounters: Map<string, number>;
  executeSubFlow: (states: Record<string, FlowState>, startAt: string, input: any) => Promise<any>;
}

export interface StateExecutionResult {
  nextState?: string;
  payload: any;
  isEnd?: boolean;
  status: 'succeeded' | 'failed';
  error?: string;
}

export interface IStateHandler<T extends FlowState = FlowState> {
  execute(state: T, context: FlowStateContext): Promise<StateExecutionResult>;
}
