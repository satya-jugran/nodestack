export type FlowTriggerType = 'http' | 'event' | 'manual';
export type FlowExecutionStatus = 'running' | 'succeeded' | 'failed' | 'timeout' | 'cancelled';
export type FlowStateType = 'Task' | 'Choice' | 'Map' | 'Loop' | 'Parallel' | 'Pass' | 'Wait' | 'Succeed' | 'Fail';

export interface FlowRetryPolicy {
  errorEquals?: string[];
  intervalSeconds?: number;
  maxAttempts?: number;
  backoffRate?: number;
}

export interface FlowCatchPolicy {
  errorEquals?: string[];
  next: string;
  resultPath?: string;
}

export interface ChoiceRule {
  variable?: string;
  stringEquals?: string;
  numericEquals?: number;
  numericGreaterThan?: number;
  numericLessThan?: number;
  numericGreaterThanEquals?: number;
  numericLessThanEquals?: number;
  booleanEquals?: boolean;
  isPresent?: boolean;
  and?: ChoiceRule[];
  or?: ChoiceRule[];
  not?: ChoiceRule;
  next?: string;
}

export interface BaseState {
  type: FlowStateType;
  comment?: string;
  inputPath?: string;
  resultPath?: string;
  outputPath?: string;
  next?: string;
  end?: boolean;
}

export interface TaskState extends BaseState {
  type: 'Task';
  function: string;
  elevated?: boolean;
  serviceRole?: boolean;
  retry?: FlowRetryPolicy[];
  catch?: FlowCatchPolicy[];
}

export interface ChoiceState extends BaseState {
  type: 'Choice';
  choices: ChoiceRule[];
  default?: string;
}

export interface MapState extends BaseState {
  type: 'Map';
  itemsPath: string;
  maxConcurrency?: number;
  iterator: {
    startAt: string;
    states: Record<string, FlowState>;
  };
  retry?: FlowRetryPolicy[];
  catch?: FlowCatchPolicy[];
}

export interface LoopState extends BaseState {
  type: 'Loop';
  target: string;
  condition: ChoiceRule;
  maxIterations?: number;
}

export interface ParallelBranch {
  startAt: string;
  states: Record<string, FlowState>;
}

export interface ParallelState extends BaseState {
  type: 'Parallel';
  branches: ParallelBranch[];
  retry?: FlowRetryPolicy[];
  catch?: FlowCatchPolicy[];
}

export interface PassState extends BaseState {
  type: 'Pass';
  result?: any;
}

export interface WaitState extends BaseState {
  type: 'Wait';
  seconds?: number;
}

export interface SucceedState extends BaseState {
  type: 'Succeed';
}

export interface FailState extends BaseState {
  type: 'Fail';
  error?: string;
  cause?: string;
}

export type FlowState =
  | TaskState
  | ChoiceState
  | MapState
  | LoopState
  | ParallelState
  | PassState
  | WaitState
  | SucceedState
  | FailState;

export interface FlowDefinition {
  comment?: string;
  startAt: string;
  timeoutSeconds?: number;
  states: Record<string, FlowState>;
}

export interface FlowConfig {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  triggerType: FlowTriggerType;
  eventTrigger?: string | null;
  definition: FlowDefinition;
  created: string;
  updated: string;
}

export type CreateFlowDto = Omit<FlowConfig, 'id' | 'created' | 'updated'> & {
  id?: string;
};

export type UpdateFlowDto = Partial<Omit<FlowConfig, 'id' | 'created' | 'updated'>>;

export interface FlowStepLog {
  step: string;
  type: FlowStateType;
  input: any;
  output?: any;
  status: 'succeeded' | 'failed' | 'retrying';
  durationMs: number;
  error?: string;
  timestamp: string;
}

export interface FlowExecution {
  id: string;
  flowId: string;
  flowName: string;
  status: FlowExecutionStatus;
  input: any;
  output?: any;
  error?: string;
  durationMs: number;
  stepLogs: FlowStepLog[];
  actorId?: string | null;
  startedAt: string;
  finishedAt?: string;
}

export interface FlowExecutionOptions {
  wait?: boolean;
  timeoutMs?: number;
  maxRecursionDepth?: number;
}
