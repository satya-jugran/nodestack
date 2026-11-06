import { FailStateHandler } from '../src/flows/runtime/StateHandlers';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { NodeStack } from '../src/NodeStack';
import { FlowPathMapper } from '../src/flows/utils/FlowPathMapper';
import { ConcurrencyPool } from '../src/flows/utils/ConcurrencyPool';
import { ChoiceEvaluator } from '../src/flows/runtime/ChoiceEvaluator';
import { FlowEngine } from '../src/flows/FlowEngine';
import { FlowDefinition } from '../src/flows/types';
import { FlowValidator } from '../src/flows/FlowValidator';

describe('Functions Flow ("NodeStack Functions Flow & State Machine")', () => {
  const testDir = path.resolve(__dirname, '../.test_flows_nodestack_data');
  let app: NodeStack;
  let adminToken = '';

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDir,
      port: 8197,
    });

    await app.start();

    // 1. Setup Admin
    await app.auth.createAdmin('admin@nodestack.io', 'AdminPassword123!');
    const adminAuth = await app.auth.authenticateAdmin('admin@nodestack.io', 'AdminPassword123!');
    adminToken = adminAuth.token;

    // 2. Register sample collection 'orders'
    app.schema.createCollection({
      name: 'orders',
      type: 'base',
      schema: [
        { id: 'f_title', name: 'title', type: 'text', required: true },
        { id: 'f_amount', name: 'amount', type: 'number', required: true },
        { id: 'f_status', name: 'status', type: 'text', required: false },
      ],
    });

    // 3. Register serverless functions for tasks
    app.functions.createFunction({
      name: 'calculate-tax',
      code: `
        export default async function(core, context) {
          const amount = context.request?.body?.amount || 0;
          return {
            tax: amount * 0.1,
            totalWithTax: amount * 1.1
          };
        }
      `,
      enabled: true,
      authPolicy: 'public',
      methods: ['POST'],
      timeoutMs: 2000,
      memoryLimitMb: 32,
      allowedDomains: [],
      elevated: false,
      env: {},
    });

    app.functions.createFunction({
      name: 'apply-discount',
      code: `
        export default async function(core, context) {
          const total = context.request?.body?.calculation?.totalWithTax || context.request?.body?.totalWithTax || 0;
          const discount = context.request?.body?.order?.discount || context.request?.body?.discount || 0;
          return {
            finalTotal: Math.max(0, total - discount)
          };
        }
      `,
      enabled: true,
      authPolicy: 'public',
      methods: ['POST'],
      timeoutMs: 2000,
      memoryLimitMb: 32,
      allowedDomains: [],
      elevated: false,
      env: {},
    });

    app.functions.createFunction({
      name: 'square-item',
      code: `
        export default async function(core, context) {
          const num = context.request?.body?.value || 0;
          return {
            squared: num * num
          };
        }
      `,
      enabled: true,
      authPolicy: 'public',
      methods: ['POST'],
      timeoutMs: 2000,
      memoryLimitMb: 32,
      allowedDomains: [],
      elevated: false,
      env: {},
    });

    app.functions.createFunction({
      name: 'failing-task',
      code: `
        export default async function(core, context) {
          throw new Error('PlannedFunctionFailure');
        }
      `,
      enabled: true,
      authPolicy: 'public',
      methods: ['POST'],
      timeoutMs: 2000,
      memoryLimitMb: 32,
      allowedDomains: [],
      elevated: false,
      env: {},
    });
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ==========================================
  // 1. FlowPathMapper Unit Tests
  // ==========================================
  describe('FlowPathMapper', () => {
    it('should resolve nested paths and array elements correctly', () => {
      const data = {
        order: {
          id: 123,
          items: [{ name: 'Book', price: 20 }, { name: 'Pen', price: 5 }],
        },
      };

      expect(FlowPathMapper.get(data, '$.order.id')).toBe(123);
      expect(FlowPathMapper.get(data, '$.order.items[0].name')).toBe('Book');
      expect(FlowPathMapper.get(data, '$.order.items[1].price')).toBe(5);
      expect(FlowPathMapper.get(data, '$.non.existent', 'fallback')).toBe('fallback');
      expect(FlowPathMapper.get(data, '$')).toEqual(data);
    });

    it('should immutably apply result at target path', () => {
      const payload = { amount: 100 };
      const updated = FlowPathMapper.applyResult(payload, { tax: 10 }, '$.taxDetails');

      expect(updated.amount).toBe(100);
      expect(updated.taxDetails).toEqual({ tax: 10 });
      // original unchanged
      expect((payload as any).taxDetails).toBeUndefined();
    });

    it('should filter output using outputPath', () => {
      const payload = { amount: 100, summary: { approved: true } };
      expect(FlowPathMapper.resolveOutput(payload, '$.summary')).toEqual({ approved: true });
    });
  });

  // ==========================================
  // 2. ConcurrencyPool Unit Tests
  // ==========================================
  describe('ConcurrencyPool', () => {
    it('should execute tasks with bounded concurrency', async () => {
      const items = [1, 2, 3, 4, 5];
      let active = 0;
      let maxActive = 0;

      const results = await ConcurrencyPool.map(
        items,
        async (item) => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 20));
          active--;
          return item * 2;
        },
        2 // concurrency limit 2
      );

      expect(results).toEqual([2, 4, 6, 8, 10]);
      expect(maxActive).toBeLessThanOrEqual(2);
    });
  });

  // ==========================================
  // 3. ChoiceEvaluator Unit Tests
  // ==========================================
  describe('ChoiceEvaluator', () => {
    it('should evaluate numeric, string, boolean, and logical operators', () => {
      const payload = { count: 10, status: 'approved', flag: true };

      expect(ChoiceEvaluator.evaluate({ variable: '$.count', numericGreaterThan: 5, next: 'A' }, payload)).toBe(true);
      expect(ChoiceEvaluator.evaluate({ variable: '$.count', numericLessThan: 5, next: 'A' }, payload)).toBe(false);
      expect(ChoiceEvaluator.evaluate({ variable: '$.status', stringEquals: 'approved', next: 'A' }, payload)).toBe(true);
      expect(ChoiceEvaluator.evaluate({ variable: '$.flag', booleanEquals: true, next: 'A' }, payload)).toBe(true);
      expect(ChoiceEvaluator.evaluate({ variable: '$.count', isPresent: true, next: 'A' }, payload)).toBe(true);
      expect(ChoiceEvaluator.evaluate({ variable: '$.missing', isPresent: false, next: 'A' }, payload)).toBe(true);

      // Logical AND
      expect(
        ChoiceEvaluator.evaluate(
          {
            variable: '$.count',
            and: [
              { variable: '$.count', numericGreaterThan: 5, next: 'A' },
              { variable: '$.status', stringEquals: 'approved', next: 'A' },
            ],
            next: 'A',
          },
          payload
        )
      ).toBe(true);

      // Logical OR and NOT
      expect(
        ChoiceEvaluator.evaluate(
          {
            or: [
              { variable: '$.count', numericLessThan: 5 },
              { variable: '$.status', stringEquals: 'approved' },
            ],
            next: 'A',
          },
          payload
        )
      ).toBe(true);

      expect(
        ChoiceEvaluator.evaluate(
          {
            not: { variable: '$.status', stringEquals: 'rejected' },
            next: 'A',
          },
          payload
        )
      ).toBe(true);

      // Should return false when no comparison or logical operator is present (preventing unconditional bypass)
      expect(ChoiceEvaluator.evaluate({ variable: '$.count', next: 'A' }, payload)).toBe(false);
      expect(ChoiceEvaluator.evaluate({ next: 'A' } as any, payload)).toBe(false);
      expect(ChoiceEvaluator.evaluate({ and: [] } as any, payload)).toBe(false);
      expect(ChoiceEvaluator.evaluate({ or: [] } as any, payload)).toBe(false);
    });
  });

  // ==========================================
  // FlowValidator & Strict Schema Typing Tests
  // ==========================================
  describe('FlowValidator & Strict Typing', () => {
    it('should reject string value in numeric condition', () => {
      const invalidDef: any = {
        startAt: 'ChoiceStep',
        states: {
          ChoiceStep: {
            type: 'Choice',
            choices: [
              { variable: '$.status', numericGreaterThan: 'qqq', next: 'NextStep' },
            ],
          },
          NextStep: { type: 'Pass', end: true },
        },
      };

      expect(() => FlowValidator.validate(invalidDef)).toThrowError(
        /numericGreaterThan must be a finite number/
      );
    });

    it('should reject non-boolean value in booleanEquals', () => {
      const invalidDef: any = {
        startAt: 'ChoiceStep',
        states: {
          ChoiceStep: {
            type: 'Choice',
            choices: [
              { variable: '$.active', booleanEquals: 'not-bool', next: 'NextStep' },
            ],
          },
          NextStep: { type: 'Pass', end: true },
        },
      };

      expect(() => FlowValidator.validate(invalidDef)).toThrowError(
        /booleanEquals must be a boolean/
      );
    });

    it('should reject variable path missing $ prefix', () => {
      const invalidDef: any = {
        startAt: 'ChoiceStep',
        states: {
          ChoiceStep: {
            type: 'Choice',
            choices: [
              { variable: 'status', stringEquals: 'active', next: 'NextStep' },
            ],
          },
          NextStep: { type: 'Pass', end: true },
        },
      };

      expect(() => FlowValidator.validate(invalidDef)).toThrowError(
        /variable must be a valid JSONPath starting with '\$'/
      );
    });

    it('should reject next step pointing to non-existent state', () => {
      const invalidDef: any = {
        startAt: 'Step1',
        states: {
          Step1: { type: 'Pass', next: 'GhostStep' },
        },
      };

      expect(() => FlowValidator.validate(invalidDef)).toThrowError(
        /target 'GhostStep' does not exist in states/
      );
    });

    it('should reject choice rules missing comparison or logical operator', () => {
      const invalidDef: any = {
        startAt: 'ChoiceStep',
        states: {
          ChoiceStep: {
            type: 'Choice',
            choices: [
              { variable: '$.status', next: 'NextStep' },
            ],
          },
          NextStep: { type: 'Pass', end: true },
        },
      };

      expect(() => FlowValidator.validate(invalidDef)).toThrowError(
        /must specify at least one comparison operator or logical operator/
      );
    });

    it('should validate nested logical rules (and, or, not) and reject malformed nested rules', () => {
      // 1. Empty 'and' array rejected
      const emptyAndDef: any = {
        startAt: 'ChoiceStep',
        states: {
          ChoiceStep: {
            type: 'Choice',
            choices: [
              { and: [], next: 'NextStep' },
            ],
          },
          NextStep: { type: 'Pass', end: true },
        },
      };
      expect(() => FlowValidator.validate(emptyAndDef)).toThrowError(
        /'and' must be a non-empty array of choice rules/
      );

      // 2. Nested rule inside 'and' missing operator rejected
      const nestedMissingOpDef: any = {
        startAt: 'ChoiceStep',
        states: {
          ChoiceStep: {
            type: 'Choice',
            choices: [
              {
                and: [
                  { variable: '$.count', numericGreaterThan: 5 },
                  { variable: '$.status' }, // missing operator!
                ],
                next: 'NextStep',
              },
            ],
          },
          NextStep: { type: 'Pass', end: true },
        },
      };
      expect(() => FlowValidator.validate(nestedMissingOpDef)).toThrowError(
        /rule #1\.and\[1\] must specify at least one comparison operator or logical operator/
      );

      // 3. Nested rule with invalid type rejected
      const nestedInvalidTypeDef: any = {
        startAt: 'ChoiceStep',
        states: {
          ChoiceStep: {
            type: 'Choice',
            choices: [
              {
                or: [
                  { variable: '$.count', numericGreaterThan: 'invalid-string' },
                ],
                next: 'NextStep',
              },
            ],
          },
          NextStep: { type: 'Pass', end: true },
        },
      };
      expect(() => FlowValidator.validate(nestedInvalidTypeDef)).toThrowError(
        /rule #1\.or\[0\] numericGreaterThan must be a finite number/
      );

      // 4. Valid nested rule with and/or/not passes validation
      const validNestedDef: any = {
        startAt: 'ChoiceStep',
        states: {
          ChoiceStep: {
            type: 'Choice',
            choices: [
              {
                and: [
                  { variable: '$.count', numericGreaterThan: 10 },
                  {
                    or: [
                      { variable: '$.tier', stringEquals: 'gold' },
                      { not: { variable: '$.isSuspended', booleanEquals: true } },
                    ],
                  },
                ],
                next: 'NextStep',
              },
            ],
          },
          NextStep: { type: 'Pass', end: true },
        },
      };
      expect(() => FlowValidator.validate(validNestedDef)).not.toThrow();
    });

    it('should recursively validate Map state iterator definitions and reject invalid nested states', () => {
      // 1. Missing startAt in iterator
      const missingStartAtDef: any = {
        startAt: 'BatchMap',
        states: {
          BatchMap: {
            type: 'Map',
            itemsPath: '$.items',
            iterator: {
              startAt: 'MissingStep',
              states: {
                ValidStep: { type: 'Pass', end: true },
              },
            },
            end: true,
          },
        },
      };
      expect(() => FlowValidator.validate(missingStartAtDef)).toThrowError(
        /Map state 'BatchMap' iterator: startAt state 'MissingStep' does not exist in flow states/
      );

      // 2. Task missing function inside iterator
      const invalidTaskDef: any = {
        startAt: 'BatchMap',
        states: {
          BatchMap: {
            type: 'Map',
            itemsPath: '$.items',
            iterator: {
              startAt: 'ProcessItem',
              states: {
                ProcessItem: {
                  type: 'Task',
                  function: '',
                  end: true,
                },
              },
            },
            end: true,
          },
        },
      };
      expect(() => FlowValidator.validate(invalidTaskDef)).toThrowError(
        /Map state 'BatchMap' iterator: Task state 'ProcessItem' must specify a serverless function name/
      );

      // 3. Broken transition inside iterator
      const brokenTransitionDef: any = {
        startAt: 'BatchMap',
        states: {
          BatchMap: {
            type: 'Map',
            itemsPath: '$.items',
            iterator: {
              startAt: 'StepA',
              states: {
                StepA: { type: 'Pass', next: 'GhostNext' },
              },
            },
            end: true,
          },
        },
      };
      expect(() => FlowValidator.validate(brokenTransitionDef)).toThrowError(
        /Map state 'BatchMap' iterator: State 'StepA': 'next' target 'GhostNext' does not exist in states/
      );

      // 4. Valid nested Map passes validation
      const validMapDef: any = {
        startAt: 'BatchMap',
        states: {
          BatchMap: {
            type: 'Map',
            itemsPath: '$.items',
            iterator: {
              startAt: 'ProcessItem',
              states: {
                ProcessItem: {
                  type: 'Task',
                  function: 'process-order',
                  end: true,
                },
              },
            },
            end: true,
          },
        },
      };
      expect(() => FlowValidator.validate(validMapDef)).not.toThrow();
    });

    it('should recursively validate Parallel state branch definitions and reject invalid nested states', () => {
      // 1. Missing startAt in branch #1
      const missingStartAtDef: any = {
        startAt: 'Fork',
        states: {
          Fork: {
            type: 'Parallel',
            branches: [
              {
                startAt: 'MissingBranchStart',
                states: {
                  ValidBranchTask: { type: 'Pass', end: true },
                },
              },
            ],
            end: true,
          },
        },
      };
      expect(() => FlowValidator.validate(missingStartAtDef)).toThrowError(
        /Parallel state 'Fork' branch #1: startAt state 'MissingBranchStart' does not exist in flow states/
      );

      // 2. Task missing function inside branch #2
      const invalidBranchTaskDef: any = {
        startAt: 'Fork',
        states: {
          Fork: {
            type: 'Parallel',
            branches: [
              {
                startAt: 'ValidStep',
                states: { ValidStep: { type: 'Pass', end: true } },
              },
              {
                startAt: 'BadStep',
                states: {
                  BadStep: {
                    type: 'Task',
                    function: '   ',
                    end: true,
                  },
                },
              },
            ],
            end: true,
          },
        },
      };
      expect(() => FlowValidator.validate(invalidBranchTaskDef)).toThrowError(
        /Parallel state 'Fork' branch #2: Task state 'BadStep' must specify a serverless function name/
      );

      // 3. Broken transition inside branch #1
      const brokenBranchTransitionDef: any = {
        startAt: 'Fork',
        states: {
          Fork: {
            type: 'Parallel',
            branches: [
              {
                startAt: 'Step1',
                states: {
                  Step1: { type: 'Pass', next: 'NonExistent' },
                },
              },
            ],
            end: true,
          },
        },
      };
      expect(() => FlowValidator.validate(brokenBranchTransitionDef)).toThrowError(
        /Parallel state 'Fork' branch #1: State 'Step1': 'next' target 'NonExistent' does not exist in states/
      );

      // 4. Valid nested Parallel passes validation
      const validParallelDef: any = {
        startAt: 'Fork',
        states: {
          Fork: {
            type: 'Parallel',
            branches: [
              {
                startAt: 'Branch1_Task',
                states: {
                  Branch1_Task: {
                    type: 'Task',
                    function: 'fetch-user',
                    end: true,
                  },
                },
              },
              {
                startAt: 'Branch2_Pass',
                states: {
                  Branch2_Pass: {
                    type: 'Pass',
                    end: true,
                  },
                },
              },
            ],
            end: true,
          },
        },
      };
      expect(() => FlowValidator.validate(validParallelDef)).not.toThrow();
    });
  });

  // ==========================================
  // 4. FlowEngine Workflow Orchestration Tests
  // ==========================================
  describe('FlowEngine State Machine', () => {
    const engine = new FlowEngine();

    it('should execute Task states in sequence and map results', async () => {
      const def: FlowDefinition = {
        startAt: 'ComputeTax',
        states: {
          ComputeTax: {
            type: 'Task',
            function: 'calculate-tax',
            inputPath: '$.order',
            resultPath: '$.calculation',
            next: 'ApplyDiscount',
          },
          ApplyDiscount: {
            type: 'Task',
            function: 'apply-discount',
            inputPath: '$',
            resultPath: '$.discounted',
            end: true,
          },
        },
      };

      const result = await engine.execute('TaxAndDiscountFlow', def, {
        order: { amount: 200, discount: 20 },
      }, {
        functionService: app.functions,
      });

      expect(result.status).toBe('succeeded');
      expect(result.output.calculation.tax).toBe(20);
      expect(result.output.calculation.totalWithTax).toBeCloseTo(220);
      expect(result.output.discounted.finalTotal).toBeCloseTo(200);
      expect(result.stepLogs.length).toBe(2);
    });

    it('should support Choice state branching (if-else logic)', async () => {
      const def: FlowDefinition = {
        startAt: 'CheckEligibility',
        states: {
          CheckEligibility: {
            type: 'Choice',
            choices: [
              {
                variable: '$.user.vip',
                booleanEquals: true,
                next: 'VipPath',
              },
            ],
            default: 'StandardPath',
          },
          VipPath: {
            type: 'Pass',
            result: { tier: 'GOLD', discountRate: 0.2 },
            resultPath: '$.tierInfo',
            end: true,
          },
          StandardPath: {
            type: 'Pass',
            result: { tier: 'REGULAR', discountRate: 0 },
            resultPath: '$.tierInfo',
            end: true,
          },
        },
      };

      // Test VIP branch
      const vipResult = await engine.execute('VipFlow', def, { user: { vip: true } });
      expect(vipResult.status).toBe('succeeded');
      expect(vipResult.output.tierInfo.tier).toBe('GOLD');

      // Test Standard branch
      const stdResult = await engine.execute('StdFlow', def, { user: { vip: false } });
      expect(stdResult.status).toBe('succeeded');
      expect(stdResult.output.tierInfo.tier).toBe('REGULAR');
    });

    it('should support Map state (parallel item processing / map-reduce)', async () => {
      const def: FlowDefinition = {
        startAt: 'ProcessItems',
        states: {
          ProcessItems: {
            type: 'Map',
            itemsPath: '$.numbers',
            maxConcurrency: 2,
            iterator: {
              startAt: 'Square',
              states: {
                Square: {
                  type: 'Task',
                  function: 'square-item',
                  end: true,
                },
              },
            },
            resultPath: '$.squaredNumbers',
            end: true,
          },
        },
      };

      const result = await engine.execute('MapFlow', def, {
        numbers: [{ value: 2 }, { value: 3 }, { value: 4 }],
      }, {
        functionService: app.functions,
      });

      expect(result.status).toBe('succeeded');
      expect(result.output.squaredNumbers).toEqual([
        { squared: 4 },
        { squared: 9 },
        { squared: 16 },
      ]);
    });

    it('should support Loop states with termination and max-iteration guard', async () => {
      const def: FlowDefinition = {
        startAt: 'Increment',
        states: {
          Increment: {
            type: 'Pass',
            resultPath: '$.counter',
            next: 'CheckLoop',
          },
          CheckLoop: {
            type: 'Loop',
            target: 'Increment',
            condition: {
              variable: '$.counter',
              numericLessThan: 3,
              next: 'Increment',
            },
            maxIterations: 10,
            next: 'Finished',
          },
          Finished: {
            type: 'Succeed',
          },
        },
      };

      let count = 0;
      // Mock step modification by mutating counter
      const engineWithLoop = new FlowEngine();
      engineWithLoop.registerHandler('Pass', {
        async execute(state, ctx) {
          count++;
          ctx.payload.counter = count;
          return { nextState: state.next, payload: ctx.payload, isEnd: state.end, status: 'succeeded' };
        },
      });

      const loopResult = await engineWithLoop.execute('CounterLoopFlow', def, { counter: 0 });
      expect(loopResult.status).toBe('succeeded');
      expect(loopResult.output.counter).toBe(3);
    });

    it('should support Parallel state branching', async () => {
      const def: FlowDefinition = {
        startAt: 'Fork',
        states: {
          Fork: {
            type: 'Parallel',
            branches: [
              {
                startAt: 'BranchA',
                states: {
                  BranchA: {
                    type: 'Pass',
                    result: 'ResultA',
                    end: true,
                  },
                },
              },
              {
                startAt: 'BranchB',
                states: {
                  BranchB: {
                    type: 'Pass',
                    result: 'ResultB',
                    end: true,
                  },
                },
              },
            ],
            resultPath: '$.parallelOutputs',
            end: true,
          },
        },
      };

      const result = await engine.execute('ParallelFlow', def, {});
      expect(result.status).toBe('succeeded');
      expect(result.output.parallelOutputs).toEqual(['ResultA', 'ResultB']);
    });

    it('should propagate sub-flow timeout as timeout in parent Map and Parallel states', async () => {
      // 1. Parallel sub-flow timing out
      const parallelDef: FlowDefinition = {
        startAt: 'Fork',
        states: {
          Fork: {
            type: 'Parallel',
            branches: [
              {
                startAt: 'SlowBranch',
                states: {
                  SlowBranch: {
                    type: 'Wait',
                    seconds: 2,
                    end: true,
                  },
                },
              },
            ],
            end: true,
          },
        },
      };

      // Execute with a short 50ms timeout
      const parallelResult = await engine.execute(
        'TimeoutParallelFlow',
        parallelDef,
        {},
        { executionOptions: { timeoutMs: 50 } }
      );

      // Must be 'timeout', NOT 'succeeded' or 'failed'
      expect(parallelResult.status).toBe('timeout');
      expect(parallelResult.error).toContain('timed out');

      // 2. Map sub-flow timing out
      const mapDef: FlowDefinition = {
        startAt: 'BatchProcess',
        states: {
          BatchProcess: {
            type: 'Map',
            itemsPath: '$.items',
            iterator: {
              startAt: 'SlowItem',
              states: {
                SlowItem: {
                  type: 'Wait',
                  seconds: 2,
                  end: true,
                },
              },
            },
            end: true,
          },
        },
      };

      const mapResult = await engine.execute(
        'TimeoutMapFlow',
        mapDef,
        { items: [1, 2] },
        { executionOptions: { timeoutMs: 50 } }
      );

      expect(mapResult.status).toBe('timeout');
      expect(mapResult.error).toContain('timed out');

      // 3. Single terminal state (e.g. Wait) running past deadline
      const singleWaitDef: FlowDefinition = {
        startAt: 'LongWait',
        states: {
          LongWait: {
            type: 'Wait',
            seconds: 2,
            end: true,
          },
        },
      };

      const waitResult = await engine.execute(
        'TimeoutWaitFlow',
        singleWaitDef,
        {},
        { executionOptions: { timeoutMs: 50 } }
      );

      expect(waitResult.status).toBe('timeout');
      expect(waitResult.error).toContain('timed out');
    });

    it('should allow Wait state with seconds: 0 to execute without delay', async () => {
      const zeroWaitDef: FlowDefinition = {
        startAt: 'ZeroDelay',
        states: {
          ZeroDelay: {
            type: 'Wait',
            seconds: 0,
            end: true,
          },
        },
      };

      const start = Date.now();
      const result = await engine.execute('ZeroWaitFlow', zeroWaitDef, { hello: 'world' });
      const duration = Date.now() - start;

      expect(result.status).toBe('succeeded');
      expect(result.output).toEqual({ hello: 'world' });
      expect(duration).toBeLessThan(500);
    });

    it('should support Catch policies on Task failure', async () => {
      const def: FlowDefinition = {
        startAt: 'CallFailingTask',
        states: {
          CallFailingTask: {
            type: 'Task',
            function: 'failing-task',
            catch: [
              {
                errorEquals: ['PlannedFunctionFailure', '*'],
                next: 'ErrorHandler',
                resultPath: '$.caughtError',
              },
            ],
            end: true,
          },
          ErrorHandler: {
            type: 'Pass',
            result: 'RecoveredFromFailure',
            resultPath: '$.recovery',
            end: true,
          },
        },
      };

      const result = await engine.execute('CatchFlow', def, {}, {
        functionService: app.functions,
      });

      expect(result.status).toBe('succeeded');
      expect(result.output.recovery).toBe('RecoveredFromFailure');
      expect(result.output.caughtError).toBeDefined();
    });
  });

  // ==========================================
  // 5. FlowService & SQLite Persistence Tests
  // ==========================================
  describe('FlowService', () => {
    let flowId = '';

    it('should create and retrieve a Flow config', () => {
      const created = app.flows.createFlow({
        name: 'OrderFlow',
        description: 'Processes incoming orders',
        triggerType: 'http',
        enabled: true,
        definition: {
          startAt: 'Step1',
          states: {
            Step1: {
              type: 'Pass',
              result: { processed: true },
              resultPath: '$.step1',
              end: true,
            },
          },
        },
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('OrderFlow');
      flowId = created.id;

      const retrieved = app.flows.getFlowById(flowId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('OrderFlow');
    });

    it('should execute flow and store execution history in SQLite', async () => {
      const execution = await app.flows.executeFlow(flowId, { orderId: 999 }, undefined, { wait: true });

      expect(execution.status).toBe('succeeded');
      expect(execution.output.step1.processed).toBe(true);

      const history = app.flows.getExecutions({ flowId });
      expect(history.totalItems).toBeGreaterThanOrEqual(1);
      expect(history.items[0].flowId).toBe(flowId);
      expect(history.items[0].output.step1.processed).toBe(true);
    });

    it('should trigger flow automatically on database record event', async () => {
      // Create flow listening to "orders:create"
      app.flows.createFlow({
        name: 'AutoOrderNotification',
        triggerType: 'event',
        eventTrigger: 'orders:create',
        enabled: true,
        definition: {
          startAt: 'RecordHandler',
          states: {
            RecordHandler: {
              type: 'Pass',
              result: { notified: true },
              resultPath: '$.notification',
              end: true,
            },
          },
        },
      });

      // Create an order record
      await app.records.create('orders', {
        title: 'New Event Order',
        amount: 350,
        status: 'pending',
      }, { id: 'admin', isAdmin: true });

      // Allow async event trigger execution to complete
      await new Promise((r) => setTimeout(r, 100));

      const flow = app.flows.getFlowByName('AutoOrderNotification');
      expect(flow).not.toBeNull();

      const executions = app.flows.getExecutions({ flowId: flow!.id });
      expect(executions.totalItems).toBeGreaterThanOrEqual(1);
      expect(executions.items[0].status).toBe('succeeded');
    });

    it('should enforce function authPolicy for non-admin actors in task execution unless elevated is explicitly set', async () => {
      // 1. Create a function with authPolicy: 'admin'
      app.functions.createFunction({
        name: 'privileged-admin-task',
        code: `export default async function() { return { status: 200, body: { secure: true } }; }`,
        enabled: true,
        authPolicy: 'admin',
        methods: ['POST'],
        timeoutMs: 1000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      // 2. Create a flow invoking privileged-admin-task WITHOUT elevated flag
      const defaultFlow = app.flows.createFlow({
        name: 'StrictAuthFlow',
        triggerType: 'manual',
        enabled: true,
        definition: {
          startAt: 'RunPrivileged',
          states: {
            RunPrivileged: {
              type: 'Task',
              function: 'privileged-admin-task',
              end: true,
            },
          },
        },
      });

      // 3. Execution by non-admin actor must fail with 403 ForbiddenError
      const nonAdminActor = { id: 'regular_user_1', isAdmin: false };
      const failedExec = await app.flows.executeFlow(defaultFlow.id, {}, nonAdminActor);
      expect(failedExec.status).toBe('failed');
      expect(failedExec.error).toContain('Superuser authorization required to invoke function');

      // 4. Execution by admin actor succeeds
      const adminActor = { id: 'admin_user_1', isAdmin: true };
      const successAdminExec = await app.flows.executeFlow(defaultFlow.id, {}, adminActor);
      expect(successAdminExec.status).toBe('succeeded');
      expect(successAdminExec.output).toEqual({ secure: true });

      // 5. Create a flow with intentional elevated / service-role configuration
      const elevatedFlow = app.flows.createFlow({
        name: 'ElevatedServiceFlow',
        triggerType: 'manual',
        enabled: true,
        definition: {
          startAt: 'RunElevated',
          states: {
            RunElevated: {
              type: 'Task',
              function: 'privileged-admin-task',
              elevated: true,
              end: true,
            },
          },
        },
      });

      // 6. Non-admin actor invoking elevated flow succeeds under service-role execution
      const successElevatedExec = await app.flows.executeFlow(elevatedFlow.id, {}, nonAdminActor);
      expect(successElevatedExec.status).toBe('succeeded');
      expect(successElevatedExec.output).toEqual({ secure: true });
    });

    it('should validate triggerType and eventTrigger patterns on create and update', async () => {
      const dummyDef: FlowDefinition = {
        startAt: 'PassState',
        states: {
          PassState: { type: 'Pass', end: true },
        },
      };

      // 1. Reject invalid triggerType on create
      expect(() => {
        app.flows.createFlow({
          name: 'InvalidTriggerFlow',
          triggerType: 'webhook' as any,
          definition: dummyDef,
        });
      }).toThrow(/Invalid triggerType 'webhook'/);

      // 2. Reject event trigger without eventTrigger pattern
      expect(() => {
        app.flows.createFlow({
          name: 'MissingEventTriggerFlow',
          triggerType: 'event',
          definition: dummyDef,
        });
      }).toThrow(/eventTrigger is required when triggerType is 'event'/);

      expect(() => {
        app.flows.createFlow({
          name: 'EmptyEventTriggerFlow',
          triggerType: 'event',
          eventTrigger: '   ',
          definition: dummyDef,
        });
      }).toThrow(/eventTrigger is required when triggerType is 'event'/);

      // 3. Reject invalid eventTrigger patterns
      expect(() => {
        app.flows.createFlow({
          name: 'NoColonFlow',
          triggerType: 'event',
          eventTrigger: 'orders',
          definition: dummyDef,
        });
      }).toThrow(/Invalid eventTrigger 'orders'/);

      expect(() => {
        app.flows.createFlow({
          name: 'BeforeHookFlow',
          triggerType: 'event',
          eventTrigger: 'orders:beforeCreate',
          definition: dummyDef,
        });
      }).toThrow(/only support post-commit lifecycle actions/);

      expect(() => {
        app.flows.createFlow({
          name: 'BadActionFlow',
          triggerType: 'event',
          eventTrigger: 'orders:read',
          definition: dummyDef,
        });
      }).toThrow(/Invalid action 'read'/);

      // 4. Accept valid patterns: orders:create, users:*, *:delete, *, *:*, orders:afterCreate
      const validFlow = app.flows.createFlow({
        name: 'ValidEventFlow',
        triggerType: 'event',
        eventTrigger: 'orders:create',
        definition: dummyDef,
      });
      expect(validFlow.triggerType).toBe('event');
      expect(validFlow.eventTrigger).toBe('orders:create');

      // 5. Reject invalid triggerType on update
      expect(() => {
        app.flows.updateFlow(validFlow.id, { triggerType: 'cron' as any });
      }).toThrow(/Invalid triggerType 'cron'/);

      // 6. Reject invalid event pattern on update
      expect(() => {
        app.flows.updateFlow(validFlow.id, { eventTrigger: 'bad:pattern:extra' });
      }).toThrow(/Invalid eventTrigger/);

      // 7. Update to valid pattern
      const updatedPattern = app.flows.updateFlow(validFlow.id, { eventTrigger: 'users:*' });
      expect(updatedPattern.eventTrigger).toBe('users:*');

      // 8. Switching from event to http clears eventTrigger to null
      const switchedToHttp = app.flows.updateFlow(validFlow.id, { triggerType: 'http' });
      expect(switchedToHttp.triggerType).toBe('http');
      expect(switchedToHttp.eventTrigger).toBeNull();

      // 9. Verify REST API rejects invalid triggerType
      const apiCreateRes = await fetch('http://localhost:8197/api/flows', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'ApiInvalidTrigger',
          triggerType: 'webhook',
          definition: dummyDef,
        }),
      });
      expect(apiCreateRes.status).toBe(400);
      const apiCreateData = await apiCreateRes.json();
      expect(apiCreateData.message).toContain("Invalid triggerType 'webhook'");

      // 10. Reject blank names on create
      expect(() => {
        app.flows.createFlow({
          name: '   ',
          definition: dummyDef,
        });
      }).toThrow(/Flow name is required/);

      expect(() => {
        app.flows.createFlow({
          name: '',
          definition: dummyDef,
        });
      }).toThrow(/Flow name is required/);

      // 11. Reject blank names on update
      expect(() => {
        app.flows.updateFlow(validFlow.id, { name: '   ' });
      }).toThrow(/Flow name cannot be blank/);

      expect(() => {
        app.flows.updateFlow(validFlow.id, { name: '' });
      }).toThrow(/Flow name cannot be blank/);

      // 12. Verify REST API rejects blank name on PATCH
      const apiPatchRes = await fetch(`http://localhost:8197/api/flows/${validFlow.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: '   ' }),
      });
      expect(apiPatchRes.status).toBe(400);
      const apiPatchData = await apiPatchRes.json();
      expect(apiPatchData.message).toContain('Flow name cannot be blank');

      // 13. Verify valid trimmed update succeeds
      const trimmedUpdate = app.flows.updateFlow(validFlow.id, { name: '  CleanRenamedFlow  ' });
      expect(trimmedUpdate.name).toBe('CleanRenamedFlow');
    });
  });

  // ==========================================
  // 6. FlowController HTTP Endpoints Tests
  // ==========================================
  describe('FlowController REST API', () => {
    it('should list and execute flows via HTTP server', async () => {
      // 1. GET /api/flows
      const listRes = await fetch('http://localhost:8197/api/flows', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      expect(Array.isArray(listData)).toBe(true);

      // 2. POST /api/flows/:id/execute?wait=true
      const flow = app.flows.getFlowByName('OrderFlow')!;
      const execRes = await fetch(`http://localhost:8197/api/flows/${flow.id}/execute?wait=true`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ customer: 'Alice' }),
      });

      expect(execRes.status).toBe(200);
      const execData = await execRes.json();
      expect(execData.status).toBe('succeeded');
      expect(execData.output.step1.processed).toBe(true);

      // 3. GET /api/flows/:id/executions
      const histRes = await fetch(`http://localhost:8197/api/flows/${flow.id}/executions`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(histRes.status).toBe(200);
      const histData = await histRes.json();
      expect(histData.items.length).toBeGreaterThan(0);
    });

    it('should dispatch flow asynchronously with 202 Accepted, executionId, and pollUrl', async () => {
      const flow = app.flows.getFlowByName('OrderFlow')!;
      const asyncRes = await fetch(`http://localhost:8197/api/flows/${flow.id}/execute`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ customer: 'AsyncAlice' }),
      });

      expect(asyncRes.status).toBe(202);
      const asyncData = await asyncRes.json();
      expect(asyncData.status).toBe('running');
      expect(asyncData.flowId).toBe(flow.id);
      expect(asyncData.flowName).toBe(flow.name);
      expect(typeof asyncData.executionId).toBe('string');
      expect(asyncData.executionId).toMatch(/^exec_\d+_[a-z0-9]+$/);
      expect(asyncData.pollUrl).toBe(`/api/flows/executions/${asyncData.executionId}`);

      // Query the pollUrl
      const pollRes = await fetch(`http://localhost:8197${asyncData.pollUrl}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(pollRes.status).toBe(200);
      const pollData = await pollRes.json();
      expect(pollData.id).toBe(asyncData.executionId);
      expect(pollData.flowId).toBe(flow.id);
      expect(['running', 'succeeded']).toContain(pollData.status);

      // Wait for background execution to complete
      let finished = false;
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const checkRes = await fetch(`http://localhost:8197${asyncData.pollUrl}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        const checkData = await checkRes.json();
        if (checkData.status === 'succeeded') {
          finished = true;
          expect(checkData.output.step1.processed).toBe(true);
          expect(checkData.output.customer).toBe('AsyncAlice');
          break;
        }
      }
      expect(finished).toBe(true);
    });

    it('should support client-provided executionId in asynchronous dispatch', async () => {
      const flow = app.flows.getFlowByName('OrderFlow')!;
      const customExecId = `exec_custom_${Date.now()}_test`;
      const asyncRes = await fetch(`http://localhost:8197/api/flows/${flow.name}/execute`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ executionId: customExecId, customer: 'CustomBob' }),
      });

      expect(asyncRes.status).toBe(202);
      const asyncData = await asyncRes.json();
      expect(asyncData.status).toBe('running');
      expect(asyncData.executionId).toBe(customExecId);
      expect(asyncData.flowId).toBe(flow.id);
      expect(asyncData.flowName).toBe(flow.name);
      expect(asyncData.pollUrl).toBe(`/api/flows/executions/${customExecId}`);

      // Wait for execution completion
      let finished = false;
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const checkRes = await fetch(`http://localhost:8197${asyncData.pollUrl}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        const checkData = await checkRes.json();
        if (checkData.status === 'succeeded') {
          finished = true;
          expect(checkData.id).toBe(customExecId);
          expect(checkData.output.customer).toBe('CustomBob');
          break;
        }
      }
      expect(finished).toBe(true);
    });
  });

  // ==========================================
  // 7. Admin UI Bundling & DOM Elements
  // ==========================================
  describe('Admin UI Bundling & DOM Elements', () => {
    let dom: JSDOM;
    let doc: Document;
    let win: any;

    beforeAll(async () => {
      const htmlPath = path.resolve(__dirname, '../dist/admin/ui/index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      dom = new JSDOM(htmlContent, {
        runScripts: 'dangerously',
        resources: 'usable',
        url: 'http://localhost:8197/_/',
      });

      win = dom.window;
      doc = win.document;

      // Polyfill fetch and alert in JSDOM
      win.fetch = (url: string, opts?: any) => {
        const fullUrl = url.startsWith('http') ? url : `http://localhost:8197${url}`;
        return globalThis.fetch(fullUrl, {
          ...opts,
          headers: { ...opts?.headers, Authorization: `Bearer ${adminToken}` },
        });
      };
      win.alert = () => {};
      win.confirm = () => true;

      // Wait for DOM content to initialize
      await new Promise((r) => setTimeout(r, 200));
    });

    it('should bundle flows.js and contain sidebar nav item for Flows', () => {
      const navFlows = doc.getElementById('nav-flows');
      expect(navFlows).not.toBeNull();
      expect(navFlows?.innerHTML).toContain('Flows');

      const pageContainer = doc.getElementById('page-view-flows');
      expect(pageContainer).not.toBeNull();
    });

    it('should update sidebar-flows-count badge when flows are loaded on startup', async () => {
      const badge = doc.getElementById('sidebar-flows-count');
      expect(badge).not.toBeNull();

      await win.loadFlows();
      const flows = win.flowsState.flows || [];
      expect(badge.textContent).toBe(String(flows.length));
      if (flows.length > 0) {
        expect(badge.style.display).toBe('inline-block');
      }
    });

    it('should activate flows tab when selectNav("flows") is invoked', async () => {
      await win.selectNav('flows', false);
      expect(win.state.activeNav).toBe('flows');

      const navFlows = doc.getElementById('nav-flows');
      expect(navFlows?.classList.contains('active')).toBe(true);

      const pageContainer = doc.getElementById('page-view-flows');
      expect(pageContainer?.style.display).toBe('flex');
      expect(pageContainer?.innerHTML).toContain('Functions Flow');
    });

    it('should open Flow Designer and render step cards and live SVG diagram', async () => {
      // Seed a test flow in state
      const mockFlow = {
        id: 'flow_designer_test',
        name: 'OrderPipeline',
        description: 'Automated order pipeline',
        enabled: true,
        triggerType: 'http',
        definition: {
          startAt: 'ValidateCart',
          states: {
            ValidateCart: {
              type: 'Task',
              function: 'calculate-tax',
              next: 'CheckEligibility',
            },
            CheckEligibility: {
              type: 'Choice',
              choices: [
                { variable: '$.inStock', booleanEquals: true, next: 'ShipItems' },
              ],
              default: 'NotifyBackorder',
            },
            ShipItems: {
              type: 'Pass',
              result: { shipped: true },
              end: true,
            },
            NotifyBackorder: {
              type: 'Fail',
              error: 'OutOfStock',
            },
          },
        },
      };

      win.flowsState.flows = [mockFlow];
      try {
        app.flows.createFlow(mockFlow);
      } catch (e) {}

      // Open designer
      await win.openFlowDesigner('flow_designer_test');

      expect(win.flowsState.currentView).toBe('designer');
      expect(win.designerState.activeFlow.id).toBe('flow_designer_test');

      const pageContainer = doc.getElementById('page-view-flows');
      expect(pageContainer?.innerHTML).toContain('OrderPipeline');
      expect(pageContainer?.innerHTML).toContain('START AT:');

      // Verify Step Cards
      const cardValidate = doc.getElementById('step-card-ValidateCart');
      const cardChoice = doc.getElementById('step-card-CheckEligibility');
      expect(cardValidate).not.toBeNull();
      expect(cardChoice).not.toBeNull();

      // Verify SVG Diagram
      const diagramContainer = doc.getElementById('flow-diagram-container');
      expect(diagramContainer?.innerHTML).toContain('<svg');
      expect(diagramContainer?.innerHTML).toContain('START');
      expect(diagramContainer?.innerHTML).toContain('END');
      expect(diagramContainer?.innerHTML).toContain('ValidateCart');
      expect(diagramContainer?.innerHTML).toContain('CheckEligibility');
      // Verify Diamond shape for Choice state
      expect(diagramContainer?.innerHTML).toContain('<polygon');
      // Verify Choice condition rule and default fallback (ELSE) arrows
      expect(diagramContainer?.innerHTML).toContain('inStock == true');
      expect(diagramContainer?.innerHTML).toContain('ELSE');

      // Test upward/backward fallback arrow (e.g. Choice falling back to previous step)
      win.designerState.activeFlow.definition.states.CheckEligibility.default = 'ValidateCart';
      win.renderSvgFlowchart(win.designerState.activeFlow);
      expect(diagramContainer?.innerHTML).toContain('ELSE');
      expect(diagramContainer?.innerHTML).toContain('stroke-dasharray="4,4"');

      // Test multiple conditions targeting the same destination step (smart grouped stacked <tspan> labels)
      win.designerState.activeFlow.definition.states.CheckEligibility.choices = [
        { variable: '$.status', stringEquals: 'approve', next: 'ShipItems' },
        { variable: '$.status', numericGreaterThan: 10, next: 'ShipItems' },
      ];
      win.renderSvgFlowchart(win.designerState.activeFlow);
      expect(diagramContainer?.innerHTML).toContain('status == "approve"');
      expect(diagramContainer?.innerHTML).toContain('or status &gt; 10');
      expect(diagramContainer?.innerHTML).toContain('<tspan');
    });

    it('should toggle Test Runner Drawer and execute flow', () => {
      win.toggleTestDrawer();
      expect(win.designerState.isTestDrawerOpen).toBe(true);

      const drawer = doc.getElementById('flow-test-drawer');
      expect(drawer?.classList.contains('open')).toBe(true);
      expect(drawer?.innerHTML).toContain('Execute Flow Now');

      // Close drawer
      win.toggleTestDrawer();
      expect(win.designerState.isTestDrawerOpen).toBe(false);
      expect(drawer?.classList.contains('open')).toBe(false);
    });

    it('should open Add Step modal with dropdown and dynamic description banner without browser prompt', () => {
      // Open add step modal
      win.openAddStepModal();

      const modalRoot = doc.getElementById('modal-root');
      expect(modalRoot?.innerHTML).toContain('Add Flow Step');
      expect(modalRoot?.innerHTML).toContain('Task');
      expect(modalRoot?.innerHTML).toContain('Choice');
      expect(modalRoot?.innerHTML).toContain('Map');

      // Verify dropdown and name input exist
      const typeSelect = doc.getElementById('new-step-type-select') as HTMLSelectElement;
      expect(typeSelect).not.toBeNull();
      expect(typeSelect.value).toBe('Task');

      // Initial task description
      const descText = doc.getElementById('step-desc-text');
      expect(descText?.textContent).toContain('serverless QuickJS function');

      // Set step name
      const nameInput = doc.getElementById('new-step-name') as HTMLInputElement;
      expect(nameInput).not.toBeNull();
      nameInput.value = 'CustomStep';

      // Select 'Pass' type
      win.selectAddStepType('Pass');
      expect(win.designerState.addStepSelectedType).toBe('Pass');
      expect(typeSelect.value).toBe('Pass');
      expect(descText?.textContent).toContain('Passes payload through');

      // Submit modal
      const form = modalRoot?.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));

      // Modal should be closed and step added
      expect(modalRoot?.innerHTML).toBe('');
      expect(win.designerState.activeFlow.definition.states.CustomStep).toBeDefined();
      expect(win.designerState.activeFlow.definition.states.CustomStep.type).toBe('Pass');

      // Step card should be rendered
      const newCard = doc.getElementById('step-card-CustomStep');
      expect(newCard).not.toBeNull();

      // SVG diagram should include new node
      const diagramContainer = doc.getElementById('flow-diagram-container');
      expect(diagramContainer?.innerHTML).toContain('CustomStep');
    });

    it('should correctly create Parallel step and allow managing parallel branches', () => {
      // 1. Open Add Step modal
      win.openAddStepModal();
      const modalRoot = doc.getElementById('modal-root');
      expect(modalRoot).not.toBeNull();

      const nameInput = doc.getElementById('new-step-name') as HTMLInputElement;
      nameInput.value = 'ParallelBranching';

      // 2. Select Parallel type
      win.selectAddStepType('Parallel');
      expect(win.designerState.addStepSelectedType).toBe('Parallel');

      // 3. Submit modal
      const form = modalRoot?.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));

      // 4. Verify step was added as Parallel (NOT Succeed!)
      const step = win.designerState.activeFlow.definition.states.ParallelBranching;
      expect(step).toBeDefined();
      expect(step.type).toBe('Parallel');
      expect(Array.isArray(step.branches)).toBe(true);
      expect(step.branches.length).toBe(2);

      // 5. Card DOM should render parallel branch controls and resultPath
      const card = doc.getElementById('step-card-ParallelBranching');
      expect(card).not.toBeNull();
      expect(card?.innerHTML).toContain('Parallel Branches (Run Concurrently)');
      expect(card?.innerHTML).toContain('Branch #1');
      expect(card?.innerHTML).toContain('Branch #2');
      expect(card?.innerHTML).toContain('pill-parallel');

      // 6. Update function on branch 1
      win.updateParallelBranchFunction('ParallelBranching', 0, 'calculate-tax');
      expect(step.branches[0].states.Branch1_Task.function).toBe('calculate-tax');

      // 7. Add branch
      win.addParallelBranch('ParallelBranching');
      expect(step.branches.length).toBe(3);
      expect(doc.getElementById('step-card-ParallelBranching')?.innerHTML).toContain('Branch #3');

      // 8. Remove branch
      win.removeParallelBranch('ParallelBranching', 2);
      expect(step.branches.length).toBe(2);

      // 9. SVG diagram shows Parallel with branch count
      const diagramContainer = doc.getElementById('flow-diagram-container');
      expect(diagramContainer?.innerHTML).toContain('Parallel (2 branches)');
    });

    it('should dynamically enable/disable next step select when toggling End State checkbox and vice versa', () => {
      const stepName = 'ParallelBranching';
      const step = win.designerState.activeFlow.definition.states[stepName];

      // Since flow already had steps, newly added ParallelBranching should not have end: true
      expect(step.end).toBeUndefined();

      const nextSelect = doc.getElementById(`step-next-select-${stepName}`) as HTMLSelectElement;
      const endCheck = doc.getElementById(`step-end-check-${stepName}`) as HTMLInputElement;

      expect(nextSelect).not.toBeNull();
      expect(endCheck).not.toBeNull();
      // Dropdown should be enabled because step is not an End State
      expect(nextSelect.disabled).toBe(false);
      expect(endCheck.checked).toBe(false);

      // 1. User checks End State
      win.handleStepEndToggle(stepName, true);
      expect(step.end).toBe(true);
      expect(step.next).toBeUndefined();
      expect(nextSelect.disabled).toBe(true);
      expect(endCheck.checked).toBe(true);

      // 2. User unchecks End State
      win.handleStepEndToggle(stepName, false);
      expect(step.end).toBeUndefined();
      // Dropdown MUST immediately become enabled
      expect(nextSelect.disabled).toBe(false);
      expect(endCheck.checked).toBe(false);

      // 3. User selects a next step
      win.handleStepNextChange(stepName, 'ValidateCart');
      expect(step.next).toBe('ValidateCart');
      expect(step.end).toBeUndefined();
      expect(endCheck.checked).toBe(false);
      expect(nextSelect.disabled).toBe(false);

      // 4. Checking End State again clears next and disables select
      win.handleStepEndToggle(stepName, true);
      expect(step.end).toBe(true);
      expect(step.next).toBeUndefined();
      expect(nextSelect.value).toBe('');
      expect(nextSelect.disabled).toBe(true);
    });

    it('should dynamically switch Trigger Type configuration area between HTTP API, DB Event, and Manual', () => {
      const configArea = doc.getElementById('flow-trigger-config-area');
      expect(configArea).not.toBeNull();

      // 1. Initial should show HTTP API endpoint
      expect(configArea?.innerHTML).toContain('/api/flows/');
      expect(configArea?.innerHTML).toContain('POST');

      // 2. Switch to DB Event
      win.handleFlowTriggerTypeChange('event');
      expect(win.designerState.activeFlow.triggerType).toBe('event');
      expect(configArea?.innerHTML).toContain('orders:create');
      const eventInput = doc.getElementById('flow-edit-event-trigger') as HTMLInputElement;
      expect(eventInput).not.toBeNull();

      // 3. Switch to Manual
      win.handleFlowTriggerTypeChange('manual');
      expect(win.designerState.activeFlow.triggerType).toBe('manual');
      expect(configArea?.innerHTML).toContain('Triggered on-demand');

      // 4. Switch back to HTTP API
      win.handleFlowTriggerTypeChange('http');
      expect(win.designerState.activeFlow.triggerType).toBe('http');
      expect(configArea?.innerHTML).toContain('POST');
    });

    it('should reorder steps up and down and re-render the SVG flow diagram accordingly', () => {
      const flow = win.designerState.activeFlow;
      const initialKeys = Object.keys(flow.definition.states);
      const secondKey = initialKeys[1]; // CheckEligibility

      // Move second step up
      win.moveStepUp(secondKey);

      const reorderedKeys = Object.keys(flow.definition.states);
      expect(reorderedKeys[0]).toBe(secondKey);

      // SVG diagram should rerender with secondKey as first node
      const diagramContainer = doc.getElementById('flow-diagram-container');
      expect(diagramContainer?.innerHTML).toContain(secondKey);

      // Move it back down
      win.moveStepDown(secondKey);
      const finalKeys = Object.keys(flow.definition.states);
      expect(finalKeys[1]).toBe(secondKey);
    });

    it('should dynamically switch input type based on Choice operator and prevent string values in number condition', () => {
      const flow = win.designerState.activeFlow;
      const stepName = 'CheckEligibility';

      // 1. Change operator to numericGreaterThan
      win.updateChoiceBranchOp(stepName, 0, 'numericGreaterThan');
      const branch = flow.definition.states[stepName].choices[0];
      expect(branch.numericGreaterThan).toBe(0);
      expect(branch.stringEquals).toBeUndefined();

      // Card DOM should now render <input type="number"> for the value
      const cardChoice = doc.getElementById(`step-card-${stepName}`);
      const numInput = cardChoice?.querySelector('input[type="number"]');
      expect(numInput).not.toBeNull();

      // 2. Attempting to assign a non-numeric string should trigger warning toast and reject change
      let alertedMsg = '';
      win.toast = (msg: string) => { alertedMsg = msg; };
      win.updateChoiceBranchVal(stepName, 0, 'qqq');
      expect(alertedMsg).toContain('Please enter a valid numeric value');
      expect(typeof branch.numericGreaterThan).toBe('number');
      expect(branch.numericGreaterThan).toBe(0);

      // 3. Valid number should update correctly
      win.updateChoiceBranchVal(stepName, 0, '42');
      expect(branch.numericGreaterThan).toBe(42);

      // 4. Change operator to booleanEquals
      win.updateChoiceBranchOp(stepName, 0, 'booleanEquals');
      expect(branch.booleanEquals).toBe(true);
      expect(branch.numericGreaterThan).toBeUndefined();

      // Card DOM should now render a select element for true/false
      const cardChoiceAfter = doc.getElementById(`step-card-${stepName}`);
      const valSelect = cardChoiceAfter?.querySelector('.flow-choice-rule-card select:nth-of-type(2)');
      expect(valSelect).not.toBeNull();
    });

    it('should synchronize step references across the flow when renaming a step', () => {
      const flow = win.designerState.activeFlow;
      const states = flow.definition.states;

      // ValidateCart currently transitions to CheckEligibility
      expect(states.ValidateCart.next).toBe('CheckEligibility');

      const keysBefore = Object.keys(flow.definition.states);
      const idxBefore = keysBefore.indexOf('CheckEligibility');

      // Rename CheckEligibility -> EvaluateStock
      win.renameStep('CheckEligibility', 'EvaluateStock');

      // CheckEligibility should be gone, EvaluateStock present at the exact same index
      expect(flow.definition.states.CheckEligibility).toBeUndefined();
      expect(flow.definition.states.EvaluateStock).toBeDefined();

      const keysAfter = Object.keys(flow.definition.states);
      expect(keysAfter.indexOf('EvaluateStock')).toBe(idxBefore);

      // ValidateCart's next pointer should be automatically updated to EvaluateStock
      expect(flow.definition.states.ValidateCart.next).toBe('EvaluateStock');

      // Rename it back for subsequent tests and verify index is still preserved
      win.renameStep('EvaluateStock', 'CheckEligibility');
      expect(flow.definition.states.ValidateCart.next).toBe('CheckEligibility');
      expect(Object.keys(flow.definition.states).indexOf('CheckEligibility')).toBe(idxBefore);
    });

    it('should clean up dangling references when deleting a step', () => {
      const flow = win.designerState.activeFlow;
      // Add a temporary step pointed to by CustomStep
      flow.definition.states.TempStep = { type: 'Pass', end: true };
      flow.definition.states.CustomStep.next = 'TempStep';
      delete flow.definition.states.CustomStep.end;

      expect(flow.definition.states.CustomStep.next).toBe('TempStep');

      // Delete TempStep
      win.deleteStep('TempStep');
      expect(flow.definition.states.TempStep).toBeUndefined();
      // CustomStep.next should be cleaned up
      expect(flow.definition.states.CustomStep.next).toBeUndefined();
    });

    it('should cleanly connect terminal Succeed and Fail states to END on the SVG flowchart without next transitions', () => {
      const flow = win.designerState.activeFlow;
      
      // Inject a Succeed state with accidental next reference
      flow.definition.states.EarlyExit = {
        type: 'Succeed',
        next: 'ShipItems', // Should be sanitized/ignored
      };

      win.renderSvgFlowchart(flow);

      const diagramContainer = doc.getElementById('flow-diagram-container');
      const svgHtml = diagramContainer?.innerHTML || '';

      // Should sanitize next on Succeed
      expect(flow.definition.states.EarlyExit.next).toBeUndefined();

      // Should render EarlyExit node as Terminal
      expect(svgHtml).toContain('EarlyExit');
      expect(svgHtml).toContain('Succeed (Terminal)');

      // Should have green transition marker to END
      expect(svgHtml).toContain('url(#flow-arrow-yes)');

      // Clean up EarlyExit
      delete flow.definition.states.EarlyExit;
      win.renderSvgFlowchart(flow);
    });

    it('should curve non-adjacent choice branch transitions around intermediate steps rather than cutting through them', () => {
      const flow = win.designerState.activeFlow;
      
      // Setup a scenario with: Choice -> IntermediateStep -> DistantTarget
      // where Choice default points to DistantTarget
      flow.definition.states.IntermediateStep = { type: 'Pass', next: 'DistantTarget' };
      flow.definition.states.DistantTarget = { type: 'Pass', end: true };
      flow.definition.states.CheckEligibility.default = 'DistantTarget';

      win.renderSvgFlowchart(flow);

      const diagramContainer = doc.getElementById('flow-diagram-container');
      const svgHtml = diagramContainer?.innerHTML || '';

      // DistantTarget is NOT the immediate next neighbor of CheckEligibility,
      // so it must use a curved path (with stroke-dasharray) and flow-arrow-default, NOT a straight cut-through
      expect(svgHtml).toContain('url(#flow-arrow-default)');
      expect(svgHtml).toContain('stroke-dasharray="4,4"');

      // Clean up
      delete flow.definition.states.IntermediateStep;
      delete flow.definition.states.DistantTarget;
      flow.definition.states.CheckEligibility.default = 'ShipItems';
      win.renderSvgFlowchart(flow);
    });

    it('should format trigger label cleanly and open test runner drawer when quickTestFlow is called', async () => {
      // 1. Verify trigger labels
      expect(win.formatFlowTriggerLabel({ triggerType: 'event', eventTrigger: 'orders:create' })).toBe('DB Event: orders:create');
      expect(win.formatFlowTriggerLabel({ triggerType: 'http', eventTrigger: 'orders:create' })).toBe('HTTP API');
      expect(win.formatFlowTriggerLabel({ triggerType: 'manual', eventTrigger: 'orders:create' })).toBe('Manual (On-demand)');

      // 2. Verify quickTestFlow opens the designer with test drawer open
      await win.quickTestFlow('flow_designer_test');
      expect(win.designerState.isTestDrawerOpen).toBe(true);

      // 3. Verify handleFlowTriggerTypeChange clears eventTrigger when switching from event to http
      win.designerState.activeFlow.triggerType = 'event';
      win.designerState.activeFlow.eventTrigger = 'orders:create';
      win.handleFlowTriggerTypeChange('http');
      expect(win.designerState.activeFlow.triggerType).toBe('http');
      expect(win.designerState.activeFlow.eventTrigger).toBeNull();
    });

    it('should update URL and breadcrumbs when opening a flow, closing designer, switching tabs, and deep-linking', async () => {
      // 1. Open designer
      await win.openFlowDesigner('flow_designer_test');
      expect(win.location.pathname).toBe('/_/flows/OrderPipeline');

      // Verify breadcrumbs
      const breadcrumbTrail = doc.getElementById('breadcrumb-trail');
      expect(breadcrumbTrail?.innerHTML).toContain('OrderPipeline');
      expect(breadcrumbTrail?.innerHTML).toContain('Flows');

      // 2. Close designer
      win.closeFlowDesigner();
      expect(win.flowsState.currentView).toBe('list');
      expect(win.location.pathname).toBe('/_/flows');

      // 3. Switch to executions tab
      win.switchFlowsTab('executions');
      expect(win.flowsState.subTab).toBe('executions');
      expect(win.location.pathname).toBe('/_/flows/executions');

      // 4. Switch back to flows tab
      win.switchFlowsTab('flows');
      expect(win.flowsState.subTab).toBe('flows');
      expect(win.location.pathname).toBe('/_/flows');

      // 5. Deep-link parseUrlAndNavigate to /_/flows/OrderPipeline
      win.history.pushState({}, '', 'http://localhost:8197/_/flows/OrderPipeline');
      await win.parseUrlAndNavigate();
      expect(win.flowsState.currentView).toBe('designer');
      expect(win.designerState.activeFlow.name).toBe('OrderPipeline');
      expect(win.location.pathname).toBe('/_/flows/OrderPipeline');

      // Clean up
      win.closeFlowDesigner();
    });

    it('should open execution inspection drawer when inspectExecutionDetail is called', async () => {
      // 1. Mock execution in state
      const mockExec = {
        id: 'exec_test_123',
        flowId: 'flow_designer_test',
        flowName: 'OrderPipeline',
        status: 'succeeded',
        input: { orderId: 456 },
        output: { shipped: true },
        durationMs: 42,
        startedAt: new Date().toISOString(),
        stepLogs: [
          { step: 'ValidateCart', type: 'Task', durationMs: 12, status: 'succeeded', output: { valid: true }, timestamp: new Date().toISOString() },
          { step: 'CheckEligibility', type: 'Choice', durationMs: 2, status: 'succeeded', output: { inStock: true }, timestamp: new Date().toISOString() },
          { step: 'ShipItems', type: 'Pass', durationMs: 1, status: 'succeeded', output: { shipped: true }, timestamp: new Date().toISOString() },
        ],
      };
      win.flowsState.executions = [mockExec];

      // 2. Open inspection drawer
      await win.inspectExecutionDetail('exec_test_123');

      const drawerRoot = doc.getElementById('drawer-root');
      expect(drawerRoot).not.toBeNull();
      expect(drawerRoot?.innerHTML).toContain('SUCCEEDED');
      expect(drawerRoot?.innerHTML).toContain('OrderPipeline');
      expect(drawerRoot?.innerHTML).toContain('exec_test_123');
      expect(drawerRoot?.innerHTML).toContain('ValidateCart');
      expect(drawerRoot?.innerHTML).toContain('CheckEligibility');
      expect(drawerRoot?.innerHTML).toContain('ShipItems');
      expect(drawerRoot?.innerHTML).toContain('42ms');

      // 3. Close execution drawer
      win.closeFlowExecutionDrawer();
      await new Promise((r) => setTimeout(r, 250));
      expect(drawerRoot?.querySelector('#flow-exec-drawer-panel')).toBeNull();
    });

    it('should safely handle step names with apostrophes and special characters in SVG diagram and forms without script injection', () => {
      const specialStepName = "User's \"Custom\" <Step>";
      const flowWithApostrophe = {
        id: 'flow_apostrophe_test',
        name: "User's Flow",
        description: 'Test flow with apostrophes',
        enabled: true,
        triggerType: 'http',
        definition: {
          startAt: specialStepName,
          states: {
            [specialStepName]: {
              type: 'Pass',
              end: true,
            },
          },
        },
      };

      win.designerState.activeFlow = flowWithApostrophe;
      win.renderFlowDesignerWorkbench(flowWithApostrophe);

      // Verify SVG node does NOT contain unescaped single quotes inside inline JS string
      const diagramContainer = doc.getElementById('flow-diagram-container');
      const svgNode = diagramContainer?.querySelector('.flow-svg-node[data-step]');
      expect(svgNode).not.toBeNull();
      expect(svgNode?.getAttribute('data-step')).toBe(specialStepName);
      expect(svgNode?.getAttribute('onclick')).toBe("selectStepFromDiagram(this.getAttribute('data-step'))");

      // Verify clicking the SVG node triggers selectStepFromDiagram safely
      win.selectStepFromDiagram(svgNode?.getAttribute('data-step'));
      expect(win.designerState.selectedStepName).toBe(specialStepName);

      // Verify Step Card has data-step-name
      const stepCard = doc.querySelector('.flow-step-card[data-step-name]');
      expect(stepCard).not.toBeNull();
      expect(stepCard?.getAttribute('data-step-name')).toBe(specialStepName);
      expect(win.getStepName(stepCard)).toBe(specialStepName);
    });

    it('should properly escape search filter input attribute against attribute breakout and XSS', async () => {
      win.flowsState.currentView = 'list';
      win.flowsState.subTab = 'flows';
      const maliciousSearch = '"><script>alert(1)</script><input autofocus="';
      win.flowsState.filter.search = maliciousSearch;

      await win.renderFlowsView();

      const container = doc.getElementById('page-view-flows')!;
      const searchInput = doc.getElementById('flows-search-input') as HTMLInputElement;
      expect(searchInput).not.toBeNull();
      // The DOM value property should equal the exact string
      expect(searchInput.value).toBe(maliciousSearch);
      // It did not break out of value attribute, so no injected script or extra input tags exist
      expect(container.querySelectorAll('script').length).toBe(0);
      expect(container.querySelectorAll('input').length).toBe(1);

      // Clean up search
      win.flowsState.filter.search = '';
    });

    it('should safely render flow cards and action buttons for flows with quotes and special characters in name and id', async () => {
      win.flowsState.currentView = 'list';
      win.flowsState.subTab = 'flows';
      const trickyFlow = {
        id: 'flow_quote_123',
        name: `User's "Tricky" <Flow> & 'Test'`,
        description: 'Special character flow',
        enabled: true,
        triggerType: 'http',
        definition: {
          startAt: 'First',
          states: { First: { type: 'Pass', end: true } },
        },
      };
      win.flowsState.flows = [trickyFlow];
      await win.renderFlowsView();

      const container = doc.getElementById('page-view-flows')!;
      const deleteBtn = container.querySelector('button.btn-danger') as HTMLButtonElement;
      expect(deleteBtn).not.toBeNull();
      expect(deleteBtn.getAttribute('data-flow-id')).toBe('flow_quote_123');
      expect(deleteBtn.getAttribute('data-flow-name')).toBe(`User's "Tricky" <Flow> & 'Test'`);
      expect(deleteBtn.getAttribute('onclick')).toBe("deleteFlowPrompt(this.getAttribute('data-flow-id'), this.getAttribute('data-flow-name'))");

      // Verify that calling onclick does not throw syntax error and passes raw name
      let deletedId = '';
      let deletedName = '';
      win.deleteFlowPrompt = (id: string, name: string) => {
        deletedId = id;
        deletedName = name;
      };

      deleteBtn.click();
      expect(deletedId).toBe('flow_quote_123');
      expect(deletedName).toBe(`User's "Tricky" <Flow> & 'Test'`);
    });

    it('should preserve numeric 0 and boolean false when escaping values via escapeHtml', () => {
      expect(win.escapeHtml(0)).toBe('0');
      expect(win.escapeHtml(false)).toBe('false');
      expect(win.escapeHtml(true)).toBe('true');
      expect(win.escapeHtml(42)).toBe('42');
      expect(win.escapeHtml('')).toBe('');
      expect(win.escapeHtml(null)).toBe('');
      expect(win.escapeHtml(undefined)).toBe('');
      expect(win.escapeHtml('<script>"test"&\'</script>')).toBe('&lt;script&gt;&quot;test&quot;&amp;&#39;&lt;/script&gt;');
    });
  });

  describe('Function-Flow Referential Integrity', () => {
    it('should recursively extract referenced function names from FlowDefinition', () => {
      const complexDef: FlowDefinition = {
        startAt: 'TopTask',
        states: {
          TopTask: {
            type: 'Task',
            function: 'fn-top-level',
            next: 'MapState',
          },
          MapState: {
            type: 'Map',
            itemsPath: '$.items',
            iterator: {
              startAt: 'NestedTaskInMap',
              states: {
                NestedTaskInMap: {
                  type: 'Task',
                  function: 'fn-inside-map',
                  end: true,
                },
              },
            },
            next: 'ParallelState',
          },
          ParallelState: {
            type: 'Parallel',
            branches: [
              {
                startAt: 'Branch1Task',
                states: {
                  Branch1Task: {
                    type: 'Task',
                    function: 'fn-inside-parallel-1',
                    end: true,
                  },
                },
              },
              {
                startAt: 'Branch2Task',
                states: {
                  Branch2Task: {
                    type: 'Task',
                    function: 'fn-inside-parallel-2',
                    end: true,
                  },
                },
              },
            ],
            next: 'Finish',
          },
          Finish: {
            type: 'Succeed',
          },
        },
      };

      const extracted = FlowValidator.extractReferencedFunctions(complexDef);
      expect(extracted.has('fn-top-level')).toBe(true);
      expect(extracted.has('fn-inside-map')).toBe(true);
      expect(extracted.has('fn-inside-parallel-1')).toBe(true);
      expect(extracted.has('fn-inside-parallel-2')).toBe(true);
      expect(extracted.size).toBe(4);
    });

    it('should safely extract from null, undefined, and non-task definitions', () => {
      expect(FlowValidator.extractReferencedFunctions(null).size).toBe(0);
      expect(FlowValidator.extractReferencedFunctions(undefined).size).toBe(0);
      expect(
        FlowValidator.extractReferencedFunctions({
          startAt: 'WaitStep',
          states: { WaitStep: { type: 'Wait', seconds: 1, end: true } },
        }).size
      ).toBe(0);
    });

    it('should prevent deleting a function referenced in a top-level flow task (ConflictError 409)', async () => {
      // 1. Create dedicated function
      const fn = app.functions.createFunction({
        name: 'flow-guarded-fn',
        code: 'export default async function() { return { ok: true }; }',
        enabled: true,
      });

      // 2. Create flow referencing this function
      const flow = app.flows.createFlow({
        name: 'GuardedTaskFlow',
        triggerType: 'http',
        definition: {
          startAt: 'Step1',
          states: {
            Step1: {
              type: 'Task',
              function: 'flow-guarded-fn',
              end: true,
            },
          },
        },
      });

      // 3. Attempt to delete function without force - should throw ConflictError (409)
      expect(() => {
        app.functions.deleteFunction(fn.id);
      }).toThrow(/Cannot delete function 'flow-guarded-fn': referenced by 1 flow\(s\) \('GuardedTaskFlow'\)/);

      // Verify function was NOT deleted
      expect(app.functions.getFunctionById(fn.id)).not.toBeNull();

      // 4. Test REST API DELETE /api/functions/:id - should return 409
      const delRes = await app.server.inject({
        method: 'DELETE',
        url: `/api/functions/${fn.id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(delRes.statusCode).toBe(409);
      expect(delRes.json().message).toContain("Cannot delete function 'flow-guarded-fn': referenced by 1 flow(s) ('GuardedTaskFlow')");

      // 5. Delete flow, then delete function without force - should now succeed
      app.flows.deleteFlow(flow.id);
      expect(app.functions.deleteFunction(fn.id)).toBe(true);
      expect(app.functions.getFunctionById(fn.id)).toBeNull();
    });

    it('should prevent deleting a function referenced in nested Map or Parallel states', async () => {
      const mapFn = app.functions.createFunction({
        name: 'nested-map-fn',
        code: 'export default async function() { return { ok: true }; }',
        enabled: true,
      });

      const parallelFn = app.functions.createFunction({
        name: 'nested-parallel-fn',
        code: 'export default async function() { return { ok: true }; }',
        enabled: true,
      });

      const complexFlow = app.flows.createFlow({
        name: 'NestedIntegrityFlow',
        triggerType: 'http',
        definition: {
          startAt: 'BatchMap',
          states: {
            BatchMap: {
              type: 'Map',
              itemsPath: '$.items',
              iterator: {
                startAt: 'ProcessMapItem',
                states: {
                  ProcessMapItem: {
                    type: 'Task',
                    function: 'nested-map-fn',
                    end: true,
                  },
                },
              },
              next: 'ParallelBranches',
            },
            ParallelBranches: {
              type: 'Parallel',
              branches: [
                {
                  startAt: 'ParallelTask',
                  states: {
                    ParallelTask: {
                      type: 'Task',
                      function: 'nested-parallel-fn',
                      end: true,
                    },
                  },
                },
              ],
              end: true,
            },
          },
        },
      });

      // Both nested functions should be protected
      expect(() => {
        app.functions.deleteFunction(mapFn.id);
      }).toThrow(/Cannot delete function 'nested-map-fn': referenced by 1 flow\(s\)/);

      expect(() => {
        app.functions.deleteFunction(parallelFn.id);
      }).toThrow(/Cannot delete function 'nested-parallel-fn': referenced by 1 flow\(s\)/);

      // Force delete nested-map-fn via API with ?force=true
      const forceRes = await app.server.inject({
        method: 'DELETE',
        url: `/api/functions/${mapFn.id}?force=true`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(forceRes.statusCode).toBe(200);
      expect(forceRes.json().success).toBe(true);
      expect(app.functions.getFunctionById(mapFn.id)).toBeNull();

      // Clean up flow and remaining parallelFn
      app.flows.deleteFlow(complexFlow.id);
      expect(app.functions.deleteFunction(parallelFn.id)).toBe(true);
    });

    it('should list all referencing flows when a function is referenced by multiple flows', async () => {
      const sharedFn = app.functions.createFunction({
        name: 'shared-utility-fn',
        code: 'export default async function() { return { ok: true }; }',
        enabled: true,
      });

      const flowA = app.flows.createFlow({
        name: 'FlowAlpha',
        triggerType: 'http',
        definition: {
          startAt: 'AlphaTask',
          states: {
            AlphaTask: {
              type: 'Task',
              function: 'shared-utility-fn',
              end: true,
            },
          },
        },
      });

      const flowB = app.flows.createFlow({
        name: 'FlowBeta',
        triggerType: 'http',
        definition: {
          startAt: 'BetaTask',
          states: {
            BetaTask: {
              type: 'Task',
              function: 'shared-utility-fn',
              end: true,
            },
          },
        },
      });

      expect(() => {
        app.functions.deleteFunction(sharedFn.id);
      }).toThrow("Cannot delete function 'shared-utility-fn': referenced by 2 flow(s)");

      // Force delete with options { force: true }
      expect(app.functions.deleteFunction(sharedFn.id, undefined, { force: true })).toBe(true);
      expect(app.functions.getFunctionById(sharedFn.id)).toBeNull();

      app.flows.deleteFlow(flowA.id);
      app.flows.deleteFlow(flowB.id);
    });

    it('should preserve referential integrity when referenced by function ID instead of name', async () => {
      const fnById = app.functions.createFunction({
        name: 'id-referenced-fn',
        code: 'export default async function() { return { ok: true }; }',
        enabled: true,
      });

      const flowWithId = app.flows.createFlow({
        name: 'FlowReferencingId',
        triggerType: 'http',
        definition: {
          startAt: 'StepUsingId',
          states: {
            StepUsingId: {
              type: 'Task',
              function: fnById.id,
              end: true,
            },
          },
        },
      });

      expect(() => {
        app.functions.deleteFunction(fnById.id);
      }).toThrow("Cannot delete function 'id-referenced-fn': referenced by 1 flow(s) ('FlowReferencingId')");

      app.flows.deleteFlow(flowWithId.id);
      expect(app.functions.deleteFunction(fnById.id)).toBe(true);
    });

    it('should support direct SQLite fallback when FlowService is unassigned', async () => {
      const isolatedFn = app.functions.createFunction({
        name: 'isolated-check-fn',
        code: 'export default async function() { return { ok: true }; }',
        enabled: true,
      });

      const flow = app.flows.createFlow({
        name: 'IsolatedFlowTest',
        triggerType: 'http',
        definition: {
          startAt: 'IsolatedTask',
          states: {
            IsolatedTask: {
              type: 'Task',
              function: 'isolated-check-fn',
              end: true,
            },
          },
        },
      });

      // Temporarily unset flowService on app.functions to test fallback path
      const originalFlowService = (app.functions as any).flowService;
      (app.functions as any).flowService = undefined;

      try {
        const dependent = app.functions.getDependentFlows('isolated-check-fn', isolatedFn.id);
        expect(dependent.length).toBe(1);
        expect(dependent[0].name).toBe('IsolatedFlowTest');

        expect(() => {
          app.functions.deleteFunction(isolatedFn.id);
        }).toThrow("Cannot delete function 'isolated-check-fn': referenced by 1 flow(s) ('IsolatedFlowTest')");
      } finally {
        (app.functions as any).flowService = originalFlowService;
        app.flows.deleteFlow(flow.id);
        app.functions.deleteFunction(isolatedFn.id);
      }
    });

    it('should fail closed and block function deletion when fallback encounters a malformed flow definition in _flows', async () => {
      const fn = app.functions.createFunction({
        name: 'fail-closed-check-fn',
        code: 'export default async function() { return {}; }',
        enabled: true,
      });

      // Insert a corrupted row in _flows
      (app as any).db.prepare(`
        INSERT INTO _flows (id, name, description, triggerType, enabled, definition, created, updated)
        VALUES ('flow_corrupt_test', 'CorruptFlow', '', 'http', 1, 'INVALID_JSON_CORRUPT{', datetime('now'), datetime('now'))
      `).run();

      const originalFlowService = (app.functions as any).flowService;
      (app.functions as any).flowService = undefined;

      try {
        // Attempting to delete function without force must fail closed (throwing AppError)
        expect(() => {
          app.functions.deleteFunction(fn.id);
        }).toThrow("Failed to inspect flow dependencies: malformed definition in flow 'CorruptFlow'");

        // Function must NOT be deleted
        expect(app.functions.getFunctionById(fn.id)).not.toBeNull();

        // With force: true, deletion succeeds
        expect(app.functions.deleteFunction(fn.id, undefined, { force: true })).toBe(true);
        expect(app.functions.getFunctionById(fn.id)).toBeNull();
      } finally {
        (app.functions as any).flowService = originalFlowService;
        (app as any).db.prepare("DELETE FROM _flows WHERE id = 'flow_corrupt_test'").run();
      }
    });

    it('should fail closed and block function deletion when fallback encounters a database read error on _flows', async () => {
      const fn = app.functions.createFunction({
        name: 'db-err-check-fn',
        code: 'export default async function() { return {}; }',
        enabled: true,
      });

      const originalFlowService = (app.functions as any).flowService;
      (app.functions as any).flowService = undefined;

      // Mock db.prepare to throw error when querying _flows
      const originalPrepare = (app.functions as any).db.prepare.bind((app.functions as any).db);
      (app.functions as any).db.prepare = (sql: string) => {
        if (sql.includes('SELECT id, name, definition FROM _flows')) {
          throw new Error('SQLite database disk I/O error');
        }
        return originalPrepare(sql);
      };

      try {
        expect(() => {
          app.functions.deleteFunction(fn.id);
        }).toThrow('SQLite database disk I/O error');

        // Function must NOT be deleted
        expect(app.functions.getFunctionById(fn.id)).not.toBeNull();
      } finally {
        (app.functions as any).db.prepare = originalPrepare;
        (app.functions as any).flowService = originalFlowService;
        app.functions.deleteFunction(fn.id);
      }
    });

    it('should enforce referential integrity per app scope and allow force delete in tenant app', async () => {
      const tenantScope = await app.apps.create({
        name: 'Tenant CRM',
        slug: 'tenant-crm',
      });

      const tenantFn = tenantScope.functions.createFunction({
        name: 'tenant-mailer',
        code: 'export default async function() { return { mailed: true }; }',
        enabled: true,
      });

      const tenantFlow = tenantScope.flows.createFlow({
        name: 'TenantWorkflow',
        triggerType: 'http',
        definition: {
          startAt: 'SendMail',
          states: {
            SendMail: {
              type: 'Task',
              function: 'tenant-mailer',
              end: true,
            },
          },
        },
      });

      // Attempt to delete via tenant app REST endpoint without force -> 409
      const delRes = await app.server.inject({
        method: 'DELETE',
        url: `/api/apps/tenant-crm/functions/${tenantFn.id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(delRes.statusCode).toBe(409);
      expect(delRes.json().message).toContain("Cannot delete function 'tenant-mailer': referenced by 1 flow(s) ('TenantWorkflow')");

      // Now force delete via tenant app REST endpoint with ?force=true -> 200
      const forceRes = await app.server.inject({
        method: 'DELETE',
        url: `/api/apps/tenant-crm/functions/${tenantFn.id}?force=true`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(forceRes.statusCode).toBe(200);
      expect(forceRes.json().success).toBe(true);
      expect(tenantScope.functions.getFunctionById(tenantFn.id)).toBeNull();

      // Clean up tenant flow and app
      tenantScope.flows.deleteFlow(tenantFlow.id);
      await app.apps.delete('tenant-crm');
    });

    it('should render HTML dialog modal for function deletion and transition to force delete on 409 Conflict', async () => {
      const htmlPath = path.resolve(__dirname, '../dist/admin/ui/index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      const dom = new JSDOM(htmlContent, {
        runScripts: 'dangerously',
        resources: 'usable',
        url: 'http://localhost:8197/_/',
      });
      const win = dom.window as any;
      const doc = win.document;
      win.openLoginModal = () => {};

      const requestedUrls: string[] = [];
      win.api = async (path: string, opts: any) => {
        requestedUrls.push(`${opts?.method || 'GET'} ${path}`);
        if (opts?.method === 'DELETE' && !path.includes('force=true')) {
          const err: any = new Error("Cannot delete function 'flow-task-fn': referenced by 1 flow(s) ('FlowA')");
          err.status = 409;
          throw err;
        }
        return { success: true };
      };

      let toastedMsg = '';
      let toastedType = '';
      win.toast = (msg: string, type: string) => {
        toastedMsg = msg;
        toastedType = type;
      };

      // 1. Open HTML Delete Modal
      win.deleteFunctionPrompt('fn_123', 'flow-task-fn');

      const modalRoot = doc.getElementById('modal-root')!;
      expect(modalRoot.innerHTML).toContain('Delete Function');
      expect(modalRoot.innerHTML).toContain('flow-task-fn');

      const deleteBtn = doc.getElementById('btn-confirm-delete-function') as HTMLButtonElement;
      expect(deleteBtn).not.toBeNull();
      expect(deleteBtn.textContent?.trim()).toBe('Delete Function');

      // 2. Click Delete -> Fails with 409 Conflict -> Modal updates in-place to Conflict State
      await win.confirmDeleteFunction('fn_123', 'flow-task-fn', false);

      expect(modalRoot.innerHTML).toContain('Cannot Delete: Flow Dependencies');
      expect(modalRoot.innerHTML).toContain("referenced by 1 flow(s) ('FlowA')");
      expect(modalRoot.innerHTML).toContain('Force Delete Anyway');

      const forceBtn = doc.getElementById('btn-force-delete-function') as HTMLButtonElement;
      expect(forceBtn).not.toBeNull();

      // 3. Click Force Delete Anyway -> Succeeds with ?force=true and closes modal
      await win.confirmDeleteFunction('fn_123', 'flow-task-fn', true);

      expect(modalRoot.innerHTML).toBe('');

      const deleteCalls = requestedUrls.filter((u) => u.startsWith('DELETE'));
      expect(deleteCalls).toEqual([
        'DELETE /api/functions/fn_123',
        'DELETE /api/functions/fn_123?force=true',
      ]);
      expect(toastedMsg).toContain("Function 'flow-task-fn' deleted (forced)");
      expect(toastedType).toBe('info');
    });

    it('should safely handle function deletion with quotes and tricky names without inline JS syntax breakout or XSS', async () => {
      const htmlPath = path.resolve(__dirname, '../dist/admin/ui/index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      const dom = new JSDOM(htmlContent, {
        runScripts: 'dangerously',
        resources: 'usable',
        url: 'http://localhost:8197/_/',
      });
      const win = dom.window as any;
      const doc = win.document;
      win.openLoginModal = () => {};

      const requestedUrls: string[] = [];
      win.api = async (path: string, opts: any) => {
        requestedUrls.push(`${opts?.method || 'GET'} ${path}`);
        if (opts?.method === 'DELETE' && !path.includes('force=true')) {
          const err = new Error("Cannot delete function: referenced by 1 flow(s) ('FlowA')") as any;
          err.status = 409;
          throw err;
        }
        return { success: true };
      };

      const trickyFnName = 'O\'Connor\'s "Tax" <script>alert(1)</script>';
      win.deleteFunctionPrompt('fn_tricky_99', trickyFnName);

      const modalRoot = doc.getElementById('modal-root')!;
      expect(modalRoot.innerHTML).toContain('Delete Function');
      expect(modalRoot.innerHTML).toContain('O\'Connor\'s "Tax" &lt;script&gt;alert(1)&lt;/script&gt;');
      expect(modalRoot.innerHTML).not.toContain('<script>alert(1)</script>');

      const deleteBtn = doc.getElementById('btn-confirm-delete-function') as HTMLButtonElement;
      expect(deleteBtn).not.toBeNull();
      // Ensure no inline onclick handler
      expect(deleteBtn.getAttribute('onclick')).toBeNull();

      // Click delete button -> triggers listener -> encounters 409 conflict
      deleteBtn.click();
      await new Promise((r) => setTimeout(r, 50));

      expect(modalRoot.innerHTML).toContain('Cannot Delete: Flow Dependencies');
      const forceBtn = doc.getElementById('btn-force-delete-function') as HTMLButtonElement;
      expect(forceBtn).not.toBeNull();
      // Ensure no inline onclick handler on force delete button
      expect(forceBtn.getAttribute('onclick')).toBeNull();

      // Click force delete button -> triggers force delete listener
      forceBtn.click();
      await new Promise((r) => setTimeout(r, 50));

      expect(modalRoot.innerHTML).toBe('');
      expect(requestedUrls).toContain('DELETE /api/functions/fn_tricky_99');
      expect(requestedUrls).toContain('DELETE /api/functions/fn_tricky_99?force=true');
    });

    it('should render HTML dialog modal for flow deletion and close on cancellation or completion', async () => {
      const htmlPath = path.resolve(__dirname, '../dist/admin/ui/index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      const dom = new JSDOM(htmlContent, {
        runScripts: 'dangerously',
        resources: 'usable',
        url: 'http://localhost:8197/_/',
      });
      const win = dom.window as any;
      const doc = win.document;

      let deletedFlowUrl = '';
      win.api = async (path: string, opts: any) => {
        if (opts?.method === 'DELETE') {
          deletedFlowUrl = path;
        }
        return { success: true };
      };

      // 1. Open HTML Delete Modal for Flow
      win.deleteFlowPrompt('flow_abc', 'OrderFulfillmentFlow');

      const modalRoot = doc.getElementById('modal-root')!;
      expect(modalRoot.innerHTML).toContain('Delete Flow');
      expect(modalRoot.innerHTML).toContain('OrderFulfillmentFlow');

      const confirmBtn = doc.getElementById('btn-confirm-delete-flow') as HTMLButtonElement;
      expect(confirmBtn).not.toBeNull();
      expect(confirmBtn.textContent?.trim()).toBe('Delete Flow');

      // 2. Test cancel closes modal without API call
      win.closeDeleteFlowModal();
      expect(modalRoot.innerHTML).toBe('');
      expect(deletedFlowUrl).toBe('');

      // 3. Re-open and confirm deletion
      win.deleteFlowPrompt('flow_abc', 'OrderFulfillmentFlow');
      await win.confirmDeleteFlow('flow_abc', 'OrderFulfillmentFlow');

      expect(deletedFlowUrl).toBe('/api/flows/flow_abc');
      expect(modalRoot.innerHTML).toBe('');
    });

    it('should safely handle flow names with apostrophes, quotes and special characters without inline JS syntax breakout or XSS', async () => {
      const htmlPath = path.resolve(__dirname, '../dist/admin/ui/index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      const dom = new JSDOM(htmlContent, {
        runScripts: 'dangerously',
        resources: 'usable',
        url: 'http://localhost:8197/_/',
      });
      const win = dom.window as any;
      const doc = win.document;

      let deletedFlowUrl = '';
      win.api = async (path: string, opts: any) => {
        if (opts?.method === 'DELETE') {
          deletedFlowUrl = path;
        }
        return { success: true };
      };

      const trickyName = 'User\'s "Tricky" <script>alert(1)</script>';
      win.deleteFlowPrompt('flow_tricky', trickyName);

      const modalRoot = doc.getElementById('modal-root')!;
      expect(modalRoot.innerHTML).toContain('Delete Flow');
      expect(modalRoot.innerHTML).toContain('User\'s "Tricky" &lt;script&gt;alert(1)&lt;/script&gt;');
      expect(modalRoot.innerHTML).not.toContain('<script>alert(1)</script>');

      const confirmBtn = doc.getElementById('btn-confirm-delete-flow') as HTMLButtonElement;
      expect(confirmBtn).not.toBeNull();
      // Ensure the button does not have inline onclick that decodes entities and causes string syntax breakout
      expect(confirmBtn.getAttribute('onclick')).toBeNull();

      // Clicking confirmBtn triggers the attached event listener safely
      confirmBtn.click();
      await new Promise((r) => setTimeout(r, 50));

      expect(deletedFlowUrl).toBe('/api/flows/flow_tricky');
      expect(modalRoot.innerHTML).toBe('');
    });
  });

  // ==========================================
  // Step-by-Step Checkpointing (Crash Recovery)
  // ==========================================
  describe('Step-by-Step Checkpointing & Crash Recovery', () => {
    it('should atomically persist step logs to SQLite after each state transition', async () => {
      // Create a flow with Step1 (Task) -> Step2 (Wait 1s) -> Step3 (Task)
      const flow = app.flows.createFlow({
        name: 'CheckpointPipeline',
        definition: {
          startAt: 'Step1',
          states: {
            Step1: {
              type: 'Task',
              function: 'calculate-tax',
              inputPath: '$.order',
              resultPath: '$.calculation',
              next: 'Step2_Wait',
            },
            Step2_Wait: {
              type: 'Wait',
              seconds: 1,
              next: 'Step3',
            },
            Step3: {
              type: 'Task',
              function: 'apply-discount',
              inputPath: '$',
              resultPath: '$.discountResult',
              end: true,
            },
          },
        },
      });

      const execId = FlowEngine.generateExecutionId();
      // Start flow in background
      const execPromise = app.flows.executeFlow(flow.id, {
        order: { amount: 100, discount: 10 },
      }, undefined, { executionId: execId });

      // Wait 300ms: Step 1 will have completed, and Step 2 (Wait) is actively running
      await new Promise((r) => setTimeout(r, 300));

      const intermediate = app.flows.getExecutionById(execId)!;
      expect(intermediate).not.toBeNull();
      expect(intermediate.status).toBe('running');
      expect(intermediate.stepLogs.length).toBeGreaterThanOrEqual(1);
      expect(intermediate.stepLogs[0].step).toBe('Step1');
      expect(intermediate.stepLogs[0].status).toBe('succeeded');
      expect(intermediate.output.calculation.tax).toBe(10);
      expect(intermediate.checkpoint).not.toBeNull();
      expect(intermediate.checkpoint?.currentStateName).toBe('Step2_Wait');

      // Wait for complete execution to finish
      const finalResult = await execPromise;
      expect(finalResult.status).toBe('succeeded');
      expect(finalResult.stepLogs.length).toBe(3);
      expect(finalResult.output.discountResult.finalTotal).toBeCloseTo(100);
    });

    it('should fail orphaned running flows gracefully with status "aborted" on recovery', async () => {
      // Simulate an orphaned flow that was left running when a crash/restart happened
      const flow = app.flows.createFlow({
        name: 'CrashOrphanFlow',
        definition: {
          startAt: 'InitialStep',
          states: {
            InitialStep: {
              type: 'Pass',
              result: { partialProgress: 'computed_chunk_1' },
              next: 'LongRunningTask',
            },
            LongRunningTask: {
              type: 'Wait',
              seconds: 10,
              next: 'FinalStep',
            },
            FinalStep: {
              type: 'Pass',
              result: { finished: true },
              end: true,
            },
          },
        },
      });

      const orphanedId = 'exec_crash_orphan_99';
      // Insert a simulated orphaned record directly into _flow_executions
      const db = (app.flows as any).db;
      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, error, durationMs, stepLogs, startedAt, checkpoint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orphanedId,
        flow.id,
        flow.name,
        'running',
        JSON.stringify({ inputVal: 42 }),
        JSON.stringify({ partialProgress: 'computed_chunk_1' }),
        null,
        150,
        JSON.stringify([
          {
            step: 'InitialStep',
            type: 'Pass',
            input: { inputVal: 42 },
            output: { partialProgress: 'computed_chunk_1' },
            status: 'succeeded',
            durationMs: 15,
            timestamp: new Date().toISOString(),
          },
        ]),
        new Date().toISOString(),
        JSON.stringify({
          currentStateName: 'LongRunningTask',
          currentPayload: { partialProgress: 'computed_chunk_1' },
          stepCount: 1,
          loopCounters: {},
          updatedAt: new Date().toISOString(),
        })
      );

      // Verify it is currently 'running'
      const beforeRecovery = app.flows.getExecutionById(orphanedId)!;
      expect(beforeRecovery.status).toBe('running');
      expect(beforeRecovery.stepLogs.length).toBe(1);

      // Trigger recovery with strategy 'abort'
      const recovered = await app.flows.recoverOrphanedExecutions('abort');
      const found = recovered.find((r) => r.id === orphanedId);
      expect(found).toBeDefined();
      expect(found!.status).toBe('aborted');
      expect(found!.error).toContain('Execution aborted due to server restart');

      // Verify the persisted state in DB
      const afterRecovery = app.flows.getExecutionById(orphanedId)!;
      expect(afterRecovery.status).toBe('aborted');
      // Previous step logs and intermediate output must be preserved!
      expect(afterRecovery.stepLogs.length).toBe(1);
      expect(afterRecovery.stepLogs[0].step).toBe('InitialStep');
      expect(afterRecovery.output.partialProgress).toBe('computed_chunk_1');
      expect(afterRecovery.finishedAt).toBeDefined();
    });

    it('should resume orphaned running flows from the last completed checkpoint', async () => {
      const flow = app.flows.createFlow({
        name: 'ResumablePipelineFlow',
        definition: {
          startAt: 'Stage1',
          states: {
            Stage1: {
              type: 'Task',
              function: 'calculate-tax',
              inputPath: '$.order',
              resultPath: '$.tax',
              next: 'Stage2',
            },
            Stage2: {
              type: 'Task',
              function: 'apply-discount',
              inputPath: '$',
              resultPath: '$.final',
              next: 'Stage3',
            },
            Stage3: {
              type: 'Pass',
              result: { pipelineCompleted: true },
              outputPath: '$.pipelineCompleted',
              end: true,
            },
          },
        },
      });

      const orphanId = 'exec_resumable_checkpoint_1';
      const db = (app.flows as any).db;
      // Simulate that Stage1 completed, and server crashed right before Stage2
      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, error, durationMs, stepLogs, startedAt, checkpoint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orphanId,
        flow.id,
        flow.name,
        'running',
        JSON.stringify({ order: { amount: 300, discount: 30 } }),
        JSON.stringify({ order: { amount: 300, discount: 30 }, tax: { tax: 30, totalWithTax: 330 } }),
        null,
        120,
        JSON.stringify([
          {
            step: 'Stage1',
            type: 'Task',
            input: { order: { amount: 300, discount: 30 } },
            output: { order: { amount: 300, discount: 30 }, tax: { tax: 30, totalWithTax: 330 } },
            status: 'succeeded',
            durationMs: 40,
            timestamp: new Date().toISOString(),
          },
        ]),
        new Date().toISOString(),
        JSON.stringify({
          currentStateName: 'Stage2',
          currentPayload: { order: { amount: 300, discount: 30 }, tax: { tax: 30, totalWithTax: 330 } },
          stepCount: 1,
          loopCounters: {},
          updatedAt: new Date().toISOString(),
        })
      );

      // Resume execution from last checkpoint
      const resumedResult = await app.flows.resumeExecution(orphanId);
      expect(resumedResult.status).toBe('succeeded');
      expect(resumedResult.output).toBe(true);
      // stepLogs should include Stage1 (from before crash) + Stage2 + Stage3!
      expect(resumedResult.stepLogs.length).toBe(3);
      expect(resumedResult.stepLogs[0].step).toBe('Stage1');
      expect(resumedResult.stepLogs[1].step).toBe('Stage2');
      expect(resumedResult.stepLogs[2].step).toBe('Stage3');

      // Check SQLite record
      const dbRecord = app.flows.getExecutionById(orphanId)!;
      expect(dbRecord.status).toBe('succeeded');
      expect(dbRecord.stepLogs.length).toBe(3);
      expect(dbRecord.finishedAt).toBeDefined();
    });

    it('should support REST API endpoints for resume, abort, and recover', async () => {
      const flow = app.flows.createFlow({
        name: 'RestRecoveryFlow',
        definition: {
          startAt: 'StepA',
          states: {
            StepA: {
              type: 'Pass',
              result: { stepA: true },
              next: 'StepB',
            },
            StepB: {
              type: 'Pass',
              result: { stepB: true },
              end: true,
            },
          },
        },
      });

      // 1. Test POST /api/flows/executions/:id/abort
      const execAbortId = 'exec_rest_abort_1';
      const db = (app.flows as any).db;
      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, durationMs, stepLogs, startedAt, checkpoint)
        VALUES (?, ?, ?, 'running', '{}', '{}', 0, '[]', ?, ?)
      `).run(execAbortId, flow.id, flow.name, new Date().toISOString(), JSON.stringify({ currentStateName: 'StepA', updatedAt: new Date().toISOString() }));

      const abortRes = await app.server.inject({
        method: 'POST',
        url: `/api/flows/executions/${execAbortId}/abort`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { reason: 'Aborted via test' },
      });
      expect(abortRes.statusCode).toBe(200);
      const abortBody = JSON.parse(abortRes.body);
      expect(abortBody.status).toBe('aborted');
      expect(abortBody.error).toBe('Aborted via test');

      // 2. Test POST /api/flows/executions/:id/resume
      const execResumeId = 'exec_rest_resume_1';
      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, durationMs, stepLogs, startedAt, checkpoint)
        VALUES (?, ?, ?, 'running', '{}', '{"stepA":true}', 0, '[]', ?, ?)
      `).run(execResumeId, flow.id, flow.name, new Date().toISOString(), JSON.stringify({ currentStateName: 'StepB', currentPayload: { stepA: true }, updatedAt: new Date().toISOString() }));

      const resumeRes = await app.server.inject({
        method: 'POST',
        url: `/api/flows/executions/${execResumeId}/resume`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(resumeRes.statusCode).toBe(200);
      const resumeBody = JSON.parse(resumeRes.body);
      expect(resumeBody.status).toBe('succeeded');
      expect(resumeBody.stepLogs.length).toBeGreaterThanOrEqual(1);

      // 3. Test POST /api/flows/executions/recover
      const orphanBatchId = 'exec_orphan_batch_1';
      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, durationMs, stepLogs, startedAt, checkpoint)
        VALUES (?, ?, ?, 'running', '{}', '{}', 0, '[]', ?, ?)
      `).run(orphanBatchId, flow.id, flow.name, new Date().toISOString(), JSON.stringify({ currentStateName: 'StepA', updatedAt: new Date().toISOString() }));

      const recoverRes = await app.server.inject({
        method: 'POST',
        url: `/api/flows/executions/recover`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { strategy: 'abort' },
      });
      expect(recoverRes.statusCode).toBe(200);
      const recoverBody = JSON.parse(recoverRes.body);
      expect(recoverBody.count).toBeGreaterThanOrEqual(1);
      const batchItem = recoverBody.recovered.find((r: any) => r.id === orphanBatchId);
      expect(batchItem?.status).toBe('aborted');

      // Test invalid recovery strategy validation (e.g. typos like 'resuem')
      const invalidStrategyRes = await app.server.inject({
        method: 'POST',
        url: `/api/flows/executions/recover`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { strategy: 'resuem' },
      });
      expect(invalidStrategyRes.statusCode).toBe(400);
      const invalidBody = JSON.parse(invalidStrategyRes.body);
      expect(invalidBody.message).toMatch(/Invalid recovery strategy.*abort.*resume/i);

      // Verify programmatic call also throws 400 AppError
      await expect((app.flows as any).recoverOrphanedExecutions('resuem')).rejects.toThrowError(
        /Invalid recovery strategy/i
      );

      // 4. Test GET /api/flows/executions?status=aborted
      const listRes = await app.server.inject({
        method: 'GET',
        url: `/api/flows/executions?status=aborted`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.body);
      expect(listBody.items.some((i: any) => i.id === execAbortId)).toBe(true);
      expect(listBody.items.some((i: any) => i.id === orphanBatchId)).toBe(true);
    });

    it('should isolate subFlowExecutor checkpoints and prevent child Map/Parallel steps from overwriting parent execution', async () => {
      const parentFlow = app.flows.createFlow({
        name: 'NestedMapCheckpointFlow',
        definition: {
          startAt: 'PreMap',
          states: {
            PreMap: {
              type: 'Pass',
              result: { items: [1, 2, 3] },
              next: 'MapStateStep',
            },
            MapStateStep: {
              type: 'Map',
              itemsPath: '$.items',
              iterator: {
                startAt: 'IteratorTask',
                states: {
                  IteratorTask: {
                    type: 'Pass',
                    result: 'item_done',
                    end: true,
                  },
                },
              },
              resultPath: '$.mapped',
              next: 'PostMap',
            },
            PostMap: {
              type: 'Pass',
              result: { allDone: true },
              end: true,
            },
          },
        },
      });

      const transitionEvents: any[] = [];
      const execId = FlowEngine.generateExecutionId();

      const engine = app.flows.getEngine();
      const execution = await engine.execute(
        parentFlow.name,
        parentFlow.definition,
        {},
        {
          executionId: execId,
          flowId: parentFlow.id,
          onStepTransition: (event) => {
            transitionEvents.push({
              step: event.step,
              checkpointState: event.checkpoint.currentStateName,
              stepLogsCount: event.stepLogs.length,
            });
          },
        }
      );

      expect(execution.status).toBe('succeeded');
      // Transitions must ONLY be recorded for parent steps (PreMap, MapStateStep, PostMap)
      // Child steps like 'IteratorTask' must NOT invoke parent's onStepTransition
      const transitionSteps = transitionEvents.map((e) => e.step);
      expect(transitionSteps).toEqual(['PreMap', 'MapStateStep', 'PostMap']);
      expect(transitionSteps).not.toContain('IteratorTask');

      // Checkpoints must never contain child iterator state names
      const checkpointStates = transitionEvents.map((e) => e.checkpointState);
      expect(checkpointStates).toEqual(['MapStateStep', 'PostMap', null]);
      expect(checkpointStates).not.toContain('IteratorTask');

      // Parent execution stepLogs must contain only the 3 top-level steps
      expect(execution.stepLogs.length).toBe(3);
      expect(execution.stepLogs.map((s) => s.step)).toEqual(['PreMap', 'MapStateStep', 'PostMap']);
    });

    it('should keep failed state and pre-step payload in checkpoint so recovery retries that state instead of skipping', async () => {
      app.functions.createFunction({
        name: 'flaky-network-task',
        code: `
          export default async function(core, context) {
            const count = context.request?.body?.count || 0;
            if (count === 1) {
              throw new Error('Temporary 503 upstream gateway outage');
            }
            return {
              recoveredSuccessfully: true,
              receivedCount: count,
            };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 2000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const flow = app.flows.createFlow({
        name: 'RetryableOutageFlow',
        definition: {
          startAt: 'InitialSetup',
          states: {
            InitialSetup: {
              type: 'Pass',
              result: { setupDone: true, count: 1 },
              next: 'FlakyStep',
            },
            FlakyStep: {
              type: 'Task',
              function: 'flaky-network-task',
              inputPath: '$',
              resultPath: '$.flakyOutput',
              next: 'FinalSummary',
            },
            FinalSummary: {
              type: 'Pass',
              result: { flowFinished: true },
              resultPath: '$.summary',
              outputPath: '$.flakyOutput',
              end: true,
            },
          },
        },
      });

      const execId = FlowEngine.generateExecutionId();
      let capturedCheckpoint: any = null;

      const engine = app.flows.getEngine();
      const execution = await engine.execute(
        flow.name,
        flow.definition,
        {},
        {
          executionId: execId,
          flowId: flow.id,
          functionService: app.functions,
          onStepTransition: (event) => {
            if (event.step === 'FlakyStep') {
              capturedCheckpoint = event.checkpoint;
            }
          },
        }
      );

      // Verify the step failed
      expect(execution.status).toBe('failed');
      expect(capturedCheckpoint).not.toBeNull();
      // Checkpoint must point to 'FlakyStep' (the failed state), NOT null!
      expect(capturedCheckpoint.currentStateName).toBe('FlakyStep');
      // Checkpoint payload must be the pre-step input snapshot
      expect(capturedCheckpoint.currentPayload.setupDone).toBe(true);
      expect(capturedCheckpoint.currentPayload.count).toBe(1);

      // Now simulate crash recovery: insert into DB as orphaned 'running' with this checkpoint
      const db = (app.flows as any).db;
      const crashedExecId = 'exec_crash_during_task_failure_1';
      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, error, durationMs, stepLogs, startedAt, checkpoint)
        VALUES (?, ?, ?, 'running', '{}', ?, ?, 50, ?, ?, ?)
      `).run(
        crashedExecId,
        flow.id,
        flow.name,
        JSON.stringify(capturedCheckpoint.currentPayload),
        null,
        JSON.stringify(execution.stepLogs),
        new Date().toISOString(),
        JSON.stringify(capturedCheckpoint)
      );

      // Update function to succeed (simulating transient outage fixed)
      const flakyFn = app.functions.getFunctionByName('flaky-network-task')!;
      app.functions.updateFunction(flakyFn.id, {
        code: `
          export default async function(core, context) {
            return {
              recoveredSuccessfully: true,
              receivedCount: context.request?.body?.count || 0,
            };
          }
        `,
      });

      // Resume execution: it must retry 'FlakyStep' with its pre-step payload, NOT skip to 'FinalSummary'!
      const resumed = await app.flows.resumeExecution(crashedExecId);
      expect(resumed.status).toBe('succeeded');
      expect(resumed.output.recoveredSuccessfully).toBe(true);
      expect(resumed.output.receivedCount).toBe(1);

      // Step logs should show: InitialSetup, failed FlakyStep, retried successful FlakyStep, FinalSummary
      expect(resumed.stepLogs.length).toBe(4);
      expect(resumed.stepLogs[0].step).toBe('InitialSetup');
      expect(resumed.stepLogs[1].step).toBe('FlakyStep');
      expect(resumed.stepLogs[1].status).toBe('failed');
      expect(resumed.stepLogs[2].step).toBe('FlakyStep');
      expect(resumed.stepLogs[2].status).toBe('succeeded');
      expect(resumed.stepLogs[3].step).toBe('FinalSummary');
    });

    it('should persist terminal failed status in persistCheckpoint and recognize terminal failed transition during resume', async () => {
      app.functions.createFunction({
        name: 'terminal-failure-task',
        code: `
          export default async function(core, context) {
            throw new Error('Fatal database connection refused');
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 2000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const flow = app.flows.createFlow({
        name: 'TerminalFailureCheckpointFlow',
        definition: {
          startAt: 'StepOne',
          states: {
            StepOne: {
              type: 'Pass',
              result: { stepOneDone: true },
              next: 'FailingStep',
            },
            FailingStep: {
              type: 'Task',
              function: 'terminal-failure-task',
              inputPath: '$',
              resultPath: '$.failResult',
              next: 'ShouldNeverReach',
            },
            ShouldNeverReach: {
              type: 'Pass',
              result: { reached: true },
              resultPath: '$.finalInfo',
              end: true,
            },
          },
        },
      });

      const execId = FlowEngine.generateExecutionId();
      let capturedStatusDuringTransition: string | null = null;

      // 1. Execute flow through executeFlow
      const db = (app.flows as any).db;
      const execResult = await app.flows.executeFlow(flow.id, { startParam: 123 }, undefined, {
        executionId: execId,
      });
      expect(execResult.status).toBe('failed');
      expect(execResult.error).toContain('Fatal database connection refused');

      // 2. Verify that in SQLite, the row is recorded with status = 'failed' (NOT left as 'running')
      const row = db.prepare('SELECT * FROM _flow_executions WHERE id = ?').get(execId);
      expect(row).toBeDefined();
      expect(row.status).toBe('failed');
      expect(row.error).toContain('Fatal database connection refused');
      expect(row.finishedAt).not.toBeNull();
      const cp = JSON.parse(row.checkpoint);
      expect(cp.currentStateName).toBe('FailingStep');

      // 3. Test that persistCheckpoint directly updates SQLite row terminal status
      const syntheticExecId = 'exec_synthetic_terminal_test';
      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, error, durationMs, stepLogs, startedAt, checkpoint)
        VALUES (?, ?, ?, 'running', '{}', '{}', NULL, 0, '[]', ?, ?)
      `).run(syntheticExecId, flow.id, flow.name, new Date().toISOString(), JSON.stringify({ currentStateName: 'FailingStep' }));

      // Trigger persistCheckpoint with terminal failed event
      app.flows.persistCheckpoint(syntheticExecId, {
        executionId: syntheticExecId,
        flowId: flow.id,
        flowName: flow.name,
        step: 'FailingStep',
        stepLog: {
          step: 'FailingStep',
          type: 'Task',
          input: { startParam: 123 },
          status: 'failed',
          durationMs: 10,
          error: 'Fatal database connection refused',
          timestamp: new Date().toISOString(),
        },
        stepLogs: [
          {
            step: 'FailingStep',
            type: 'Task',
            input: { startParam: 123 },
            status: 'failed',
            durationMs: 10,
            error: 'Fatal database connection refused',
            timestamp: new Date().toISOString(),
          },
        ],
        payload: { startParam: 123 },
        durationMs: 10,
        isEnd: true,
        status: 'failed',
        checkpoint: {
          currentStateName: 'FailingStep',
          currentPayload: { startParam: 123 },
          updatedAt: new Date().toISOString(),
        },
      });

      const syntheticRow = db.prepare('SELECT * FROM _flow_executions WHERE id = ?').get(syntheticExecId);
      expect(syntheticRow.status).toBe('failed');
      expect(syntheticRow.error).toContain('Fatal database connection refused');
      expect(syntheticRow.finishedAt).not.toBeNull();

      // 4. Verify recovery recognizes terminal failed transition even when checkpoint currentStateName is null
      const orphanNullCpId = 'exec_orphan_null_cp_failed_step';
      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, error, durationMs, stepLogs, startedAt, checkpoint)
        VALUES (?, ?, ?, 'running', '{}', '{}', NULL, 10, ?, ?, ?)
      `).run(
        orphanNullCpId,
        flow.id,
        flow.name,
        JSON.stringify([
          {
            step: 'FailingStep',
            type: 'Task',
            input: { startParam: 123 },
            status: 'failed',
            durationMs: 10,
            error: 'Fatal database connection refused',
            timestamp: new Date().toISOString(),
          },
        ]),
        new Date().toISOString(),
        JSON.stringify({ currentStateName: null, updatedAt: new Date().toISOString() })
      );

      // Fix the task function
      const taskFn = app.functions.getFunctionByName('terminal-failure-task')!;
      app.functions.updateFunction(taskFn.id, {
        code: `
          export default async function(core, context) {
            return { fixed: true, received: context.request?.body?.startParam };
          }
        `,
      });

      // Resume: must retry FailingStep (and then proceed to ShouldNeverReach), NOT skip FailingStep!
      const resumed = await app.flows.resumeExecution(orphanNullCpId);
      expect(resumed.status).toBe('succeeded');
      expect(resumed.output.finalInfo.reached).toBe(true);
      expect(resumed.output.failResult.fixed).toBe(true);
      expect(resumed.output.failResult.received).toBe(123);
      // stepLogs must show the failed FailingStep + retried succeeded FailingStep + ShouldNeverReach
      expect(resumed.stepLogs.length).toBe(3);
      expect(resumed.stepLogs[0].step).toBe('FailingStep');
      expect(resumed.stepLogs[0].status).toBe('failed');
      expect(resumed.stepLogs[1].step).toBe('FailingStep');
      expect(resumed.stepLogs[1].status).toBe('succeeded');
      expect(resumed.stepLogs[2].step).toBe('ShouldNeverReach');
    });

    it('should propagate checkpoint persistence failure and halt flow execution without stale checkpoint replay', async () => {
      let stepTwoExecuted = false;

      app.functions.createFunction({
        name: 'checkpoint-test-step2-fn',
        code: `
          export default async function(core, context) {
            return { executed: true };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 2000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const flow = app.flows.createFlow({
        name: 'CheckpointFailureHaltFlow',
        definition: {
          startAt: 'Step1',
          states: {
            Step1: {
              type: 'Pass',
              result: { step1Done: true },
              next: 'Step2',
            },
            Step2: {
              type: 'Task',
              function: 'checkpoint-test-step2-fn',
              inputPath: '$',
              end: true,
            },
          },
        },
      });

      const execId = FlowEngine.generateExecutionId();
      const db = (app.flows as any).db;

      // Intercept db.prepare to simulate error during UPDATE of _flow_executions in persistCheckpoint
      const originalPrepare = db.prepare.bind(db);
      let injectedFailure = false;
      db.prepare = (sql: string) => {
        if (typeof sql === 'string' && sql.includes('UPDATE _flow_executions SET') && !injectedFailure) {
          injectedFailure = true;
          throw new Error('Disk I/O error or SQLite database locked');
        }
        return originalPrepare(sql);
      };

      try {
        const result = await app.flows.executeFlow(flow.id, { test: 1 }, undefined, {
          executionId: execId,
        });

        // Execution must fail because checkpoint persistence failed
        expect(result.status).toBe('failed');
        expect(result.error).toContain('Failed to persist checkpoint');

        // Step 2 must NEVER have executed because flow was halted immediately on Step 1 checkpoint failure!
        expect(result.stepLogs.length).toBe(1);
        expect(result.stepLogs[0].step).toBe('Step1');

        // Checkpoint must NOT be set (not safely recoverable)
        expect(result.checkpoint).toBeNull();
      } finally {
        db.prepare = originalPrepare;
      }
    });

    it('should cancel active in-memory execution on abort and prevent subsequent writes from overwriting aborted state', async () => {
      const flow = app.flows.createFlow({
        name: 'ActiveAbortCancellationFlow',
        definition: {
          startAt: 'WaitStep',
          states: {
            WaitStep: {
              type: 'Wait',
              seconds: 5,
              next: 'ShouldNeverRunAfterAbort',
            },
            ShouldNeverRunAfterAbort: {
              type: 'Pass',
              result: { reached: true },
              end: true,
            },
          },
        },
      });

      const execId = FlowEngine.generateExecutionId();
      const startTime = Date.now();

      // Start the flow in the background
      const runPromise = app.flows.executeFlow(flow.id, {}, undefined, { executionId: execId });

      // Give it 50ms so it starts running the WaitStep
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify it is currently in 'running' state in DB
      const beforeAbort = app.flows.getExecutionById(execId);
      expect(beforeAbort).not.toBeNull();
      expect(beforeAbort?.status).toBe('running');

      // Abort the active running execution
      const abortResult = app.flows.abortExecution(execId, 'Aborted mid-flight by test');
      expect(abortResult.status).toBe('aborted');

      // Wait for runPromise to settle
      const runResult = await runPromise;
      const elapsed = Date.now() - startTime;

      // Must have cancelled immediately without waiting full 5 seconds
      expect(elapsed).toBeLessThan(2000);

      // Verify the final persisted state in SQLite was NOT overwritten with 'running' or 'succeeded'
      const finalDbRecord = app.flows.getExecutionById(execId);
      expect(finalDbRecord).not.toBeNull();
      expect(finalDbRecord?.status).toBe('aborted');
      expect(finalDbRecord?.error).toBe('Aborted mid-flight by test');

      // 'ShouldNeverRunAfterAbort' must never have been reached in stepLogs
      expect(finalDbRecord?.stepLogs.some((s) => s.step === 'ShouldNeverRunAfterAbort')).toBe(false);
    });

    it('should atomically claim execution and prevent racing resume requests from running duplicate tasks', async () => {
      let sideEffectCount = 0;

      app.functions.createFunction({
        name: 'atomic-claim-side-effect-fn',
        code: `
          export default async function(core, context) {
            return { executed: true };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 2000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      // Track executions by wrapping functionService
      const originalExecute = (app.functions as any).executeFunction.bind(app.functions);
      (app.functions as any).executeFunction = async (...args: any[]) => {
        if (args[0] === 'atomic-claim-side-effect-fn') {
          sideEffectCount++;
          // Add a tiny delay to simulate real execution window
          await new Promise((r) => setTimeout(r, 60));
        }
        return originalExecute(...args);
      };

      try {
        const flow = app.flows.createFlow({
          name: 'AtomicClaimResumeFlow',
          definition: {
            startAt: 'SideEffectTask',
            states: {
              SideEffectTask: {
                type: 'Task',
                function: 'atomic-claim-side-effect-fn',
                end: true,
              },
            },
          },
        });

        const raceExecId = FlowEngine.generateExecutionId();
        const db = (app.flows as any).db;

        db.prepare(`
          INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, error, durationMs, stepLogs, startedAt, checkpoint)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          raceExecId,
          flow.id,
          flow.name,
          'running',
          JSON.stringify({ value: 42 }),
          null,
          null,
          0,
          JSON.stringify([]),
          new Date().toISOString(),
          JSON.stringify({
            currentStateName: 'SideEffectTask',
            currentPayload: { value: 42 },
            stepCount: 0,
            loopCounters: {},
            updatedAt: new Date().toISOString(),
          })
        );

        // Fire two racing resume requests concurrently
        const [res1, res2] = await Promise.allSettled([
          app.flows.resumeExecution(raceExecId),
          app.flows.resumeExecution(raceExecId),
        ]);

        const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
        const rejected = [res1, res2].filter((r) => r.status === 'rejected');

        // Exactly one should succeed, and one should be rejected with 409 Conflict
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);

        const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
        expect(rejectedReason.statusCode).toBe(409);
        expect(rejectedReason.message).toMatch(/currently (running|being executed or resumed)|already claimed/i);

        // Side effect must have executed exactly ONCE
        expect(sideEffectCount).toBe(1);

        // Successful execution must have status 'succeeded'
        const successVal = (fulfilled[0] as PromiseFulfilledResult<any>).value;
        expect(successVal.status).toBe('succeeded');

        // DB record should be 'succeeded' and claimToken released (null)
        const dbRecord = app.flows.getExecutionById(raceExecId);
        expect(dbRecord?.status).toBe('succeeded');
        expect(dbRecord?.claimToken).toBeNull();
      } finally {
        (app.functions as any).executeFunction = originalExecute;
      }
    });

    it('should reject resume request with 409 Conflict when execution is claimed by another runner in DB', async () => {
      const flow = app.flows.createFlow({
        name: 'ForeignClaimResumeFlow',
        definition: {
          startAt: 'SimpleStep',
          states: {
            SimpleStep: {
              type: 'Pass',
              result: { done: true },
              end: true,
            },
          },
        },
      });

      const foreignExecId = FlowEngine.generateExecutionId();
      const db = (app.flows as any).db;

      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, error, durationMs, stepLogs, startedAt, checkpoint, claimToken)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        foreignExecId,
        flow.id,
        flow.name,
        'running',
        JSON.stringify({}),
        null,
        null,
        0,
        JSON.stringify([]),
        new Date().toISOString(),
        JSON.stringify({
          currentStateName: 'SimpleStep',
          currentPayload: {},
          stepCount: 0,
          loopCounters: {},
          updatedAt: new Date().toISOString(),
        }),
        'foreign-process-uuid-token'
      );

      // Should be rejected because another runner holds the claim
      await expect(app.flows.resumeExecution(foreignExecId)).rejects.toThrowError(
        /already claimed by another runner/i
      );

      // Verify the claim was NOT overwritten
      const row = db.prepare('SELECT claimToken FROM _flow_executions WHERE id = ?').get(foreignExecId) as any;
      expect(row.claimToken).toBe('foreign-process-uuid-token');
    });

    it('should correctly recover legacy running execution at Choice state without treating it as completed', async () => {
      app.functions.createFunction({
        name: 'choice-branch-test-fn',
        code: `
          export default async function(core, context) {
            return { branchRan: true, score: context.request?.body?.score };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 2000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const flow = app.flows.createFlow({
        name: 'LegacyChoiceRecoveryFlow',
        definition: {
          startAt: 'EvaluateChoice',
          states: {
            EvaluateChoice: {
              type: 'Choice',
              choices: [
                {
                  variable: '$.score',
                  numericGreaterThan: 50,
                  next: 'HighScoreBranch',
                },
              ],
              default: 'LowScoreBranch',
            },
            HighScoreBranch: {
              type: 'Task',
              function: 'choice-branch-test-fn',
              inputPath: '$',
              end: true,
            },
            LowScoreBranch: {
              type: 'Pass',
              result: { low: true },
              end: true,
            },
          },
        },
      });

      const legacyExecId = FlowEngine.generateExecutionId();
      const db = (app.flows as any).db;

      // Simulate legacy execution row: no checkpoint (null), last step logged was EvaluateChoice with score: 85
      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, error, durationMs, stepLogs, startedAt, checkpoint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        legacyExecId,
        flow.id,
        flow.name,
        'running',
        JSON.stringify({ score: 85 }),
        JSON.stringify({ score: 85 }),
        null,
        50,
        JSON.stringify([
          {
            step: 'EvaluateChoice',
            type: 'Choice',
            input: { score: 85 },
            output: { score: 85 },
            status: 'succeeded',
            durationMs: 5,
            timestamp: new Date().toISOString(),
          },
        ]),
        new Date().toISOString(),
        null // No checkpoint
      );

      // Resume execution: MUST NOT treat as completed; must run HighScoreBranch!
      const resumed = await app.flows.resumeExecution(legacyExecId);
      expect(resumed.status).toBe('succeeded');
      expect(resumed.output.branchRan).toBe(true);
      expect(resumed.output.score).toBe(85);
      expect(resumed.stepLogs.length).toBe(2);
      expect(resumed.stepLogs[0].step).toBe('EvaluateChoice');
      expect(resumed.stepLogs[1].step).toBe('HighScoreBranch');
    });

    it('should abort legacy running row when next state cannot be reconstructed instead of marking succeeded', async () => {
      const flow = app.flows.createFlow({
        name: 'UnreconstructableLegacyFlow',
        definition: {
          startAt: 'StepA',
          states: {
            StepA: {
              type: 'Pass',
              result: { ok: true },
              next: 'StepB',
            },
            StepB: {
              type: 'Pass',
              result: { finished: true },
              end: true,
            },
          },
        },
      });

      const legacyInvalidExecId = FlowEngine.generateExecutionId();
      const db = (app.flows as any).db;

      // Simulate a legacy row where last logged step was 'NonExistentOrDeletedStep' which does not exist in flow
      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, error, durationMs, stepLogs, startedAt, checkpoint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        legacyInvalidExecId,
        flow.id,
        flow.name,
        'running',
        JSON.stringify({}),
        null,
        null,
        10,
        JSON.stringify([
          {
            step: 'NonExistentOrDeletedStep',
            type: 'Pass',
            input: {},
            output: {},
            status: 'succeeded',
            durationMs: 5,
            timestamp: new Date().toISOString(),
          },
        ]),
        new Date().toISOString(),
        null // No checkpoint
      );

      // Resuming must reject and mark row 'aborted'
      await expect(app.flows.resumeExecution(legacyInvalidExecId)).rejects.toThrowError(
        /Cannot reconstruct next state/i
      );

      const finalRecord = app.flows.getExecutionById(legacyInvalidExecId);
      expect(finalRecord?.status).toBe('aborted');
      expect(finalRecord?.error).toMatch(/no longer exists|Cannot reconstruct/i);
    });

    it('should preserve and reconstruct authorization context (isAdmin) on recovery for authPolicy: admin tasks', async () => {
      // 1. Create a function that strictly requires admin authorization
      app.functions.createFunction({
        name: 'admin-auth-task-fn',
        code: `
          export default async function(core, context) {
            return { executedWithAdmin: true, caller: context.request?.auth?.email };
          }
        `,
        enabled: true,
        authPolicy: 'admin',
        methods: ['POST'],
        timeoutMs: 2000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      // 2. Create flow with Step1 (Pass) and Step2 (Admin Task)
      const flow = app.flows.createFlow({
        name: 'AdminAuthRecoveryFlow',
        definition: {
          startAt: 'Step1',
          states: {
            Step1: {
              type: 'Pass',
              result: { step1Done: true },
              next: 'AdminTask',
            },
            AdminTask: {
              type: 'Task',
              function: 'admin-auth-task-fn',
              inputPath: '$',
              end: true,
            },
          },
        },
      });

      const execId = FlowEngine.generateExecutionId();
      const adminActor = { id: 'admin-uuid-123', email: 'admin@nodestack.test', isAdmin: true, role: 'admin' };
      const db = (app.flows as any).db;

      // Simulate a crashed execution where Step1 passed under adminActor, and server crashed right before AdminTask
      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, error, durationMs, stepLogs, actorId, actor, startedAt, checkpoint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        execId,
        flow.id,
        flow.name,
        'running',
        JSON.stringify({}),
        JSON.stringify({ step1Done: true }),
        null,
        15,
        JSON.stringify([
          {
            step: 'Step1',
            type: 'Pass',
            input: {},
            output: { step1Done: true },
            status: 'succeeded',
            durationMs: 5,
            timestamp: new Date().toISOString(),
            nextState: 'AdminTask',
          },
        ]),
        adminActor.id,
        JSON.stringify(adminActor),
        new Date().toISOString(),
        JSON.stringify({
          currentStateName: 'AdminTask',
          currentPayload: { step1Done: true },
          stepCount: 1,
          loopCounters: {},
          updatedAt: new Date().toISOString(),
        })
      );

      // 3. Resume the execution: must retain admin authorization claims
      const resumed = await app.flows.resumeExecution(execId);
      expect(resumed.status).toBe('succeeded');
      expect(resumed.output.executedWithAdmin).toBe(true);
      expect(resumed.output.caller).toBe('admin@nodestack.test');
      expect(resumed.actor?.isAdmin).toBe(true);
      expect(resumed.actorId).toBe('admin-uuid-123');
    });
  });

  // ==========================================
  // Flow Concurrency Throttling (maxConcurrentExecutions)
  // ==========================================
  describe('Flow Concurrency Throttling (maxConcurrentExecutions & Per-Flow System Queues)', () => {
    it('should validate maxConcurrentExecutions on flow create and update', async () => {
      expect(() =>
        app.flows.createFlow({
          name: 'InvalidConcurrencyZero',
          maxConcurrentExecutions: 0,
          definition: {
            startAt: 'Step1',
            states: { Step1: { type: 'Pass', end: true } },
          },
        })
      ).toThrowError(/maxConcurrentExecutions/i);

      expect(() =>
        app.flows.createFlow({
          name: 'InvalidConcurrencyFloat',
          maxConcurrentExecutions: 2.5,
          definition: {
            startAt: 'Step1',
            states: { Step1: { type: 'Pass', end: true } },
          },
        })
      ).toThrowError(/maxConcurrentExecutions/i);

      const validFlow = app.flows.createFlow({
        name: 'ValidThrottledFlow',
        maxConcurrentExecutions: 3,
        definition: {
          startAt: 'Step1',
          states: { Step1: { type: 'Pass', end: true } },
        },
      });
      expect(validFlow.maxConcurrentExecutions).toBe(3);

      // Give async queue upsert a brief moment to settle
      await new Promise((r) => setTimeout(r, 20));
      const sysQueue = await app.queue.getQueue(`_system:flow:${validFlow.id}`);
      expect(sysQueue).not.toBeNull();
      expect(sysQueue?.concurrency).toBe(3);
      expect(sysQueue?.isSystem).toBe(true);

      const unbounded = app.flows.updateFlow(validFlow.id, {
        maxConcurrentExecutions: null,
      });
      expect(unbounded.maxConcurrentExecutions).toBeNull();
      await new Promise((r) => setTimeout(r, 20));
      const deletedSysQueue = await app.queue.getQueue(`_system:flow:${validFlow.id}`);
      expect(deletedSysQueue).toBeNull();

      app.flows.deleteFlow(validFlow.id);
    });

    it('should drain pending queued executions when maxConcurrentExecutions is removed instead of stranding them', async () => {
      const throttledFlow = app.flows.createFlow({
        name: 'DrainOnConcurrencyRemovalFlow',
        enabled: true,
        maxConcurrentExecutions: 1,
        definition: {
          startAt: 'Work',
          states: {
            Work: {
              type: 'Wait',
              seconds: 1,
              end: true,
            },
          },
        },
      });

      // Dispatch 3 executions with wait=false
      const exec1 = await app.flows.executeFlow(throttledFlow.id, { item: 1 }, undefined, { wait: false });
      const exec2 = await app.flows.executeFlow(throttledFlow.id, { item: 2 }, undefined, { wait: false });
      const exec3 = await app.flows.executeFlow(throttledFlow.id, { item: 3 }, undefined, { wait: false });

      expect(['queued', 'running']).toContain(exec1.status);
      expect(exec2.status).toBe('queued');
      expect(exec3.status).toBe('queued');

      // Now remove maxConcurrentExecutions while exec2 and exec3 are still queued
      app.flows.updateFlow(throttledFlow.id, {
        maxConcurrentExecutions: null,
      });

      // Poll until all executions complete under the new unlimited setting
      await vi.waitFor(async () => {
        const e1 = app.flows.getExecutionById(exec1.id);
        const e2 = app.flows.getExecutionById(exec2.id);
        const e3 = app.flows.getExecutionById(exec3.id);
        expect(e1?.status).toBe('succeeded');
        expect(e2?.status).toBe('succeeded');
        expect(e3?.status).toBe('succeeded');
      }, { timeout: 4000, interval: 50 });

      // After draining, the system queue should be cleaned up automatically
      await vi.waitFor(async () => {
        const q = await app.queue.getQueue(`_system:flow:${throttledFlow.id}`);
        expect(q).toBeNull();
      }, { timeout: 4000, interval: 50 });

      app.flows.deleteFlow(throttledFlow.id);
    });

    it('should acquire system queue slot when resuming a failed execution on a throttled flow (maxConcurrentExecutions = 1)', async () => {
      const throttledFlow = app.flows.createFlow({
        name: 'ResumeThrottledFlow',
        enabled: true,
        maxConcurrentExecutions: 1,
        definition: {
          startAt: 'Work',
          states: {
            Work: {
              type: 'Wait',
              seconds: 1,
              end: true,
            },
          },
        },
      });

      // Prepare a failed execution in SQLite for this flow
      const failedExecId = 'exec_failed_to_resume_1';
      const db = (app.flows as any).db;
      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, durationMs, stepLogs, startedAt, checkpoint)
        VALUES (?, ?, ?, 'failed', '{"test":true}', null, 100, '[]', ?, ?)
      `).run(
        failedExecId,
        throttledFlow.id,
        throttledFlow.name,
        new Date().toISOString(),
        JSON.stringify({ currentStateName: 'Work', currentPayload: { test: true }, updatedAt: new Date().toISOString() })
      );

      // Start an execution currently occupying the only concurrency slot (maxConcurrentExecutions = 1)
      const runningExec = await app.flows.executeFlow(throttledFlow.id, { item: 'active' }, undefined, { wait: false });
      expect(['queued', 'running']).toContain(runningExec.status);

      // Call resumeExecution with wait = false; it must NOT run immediately outside the queue
      const resumedExec = await app.flows.resumeExecution(failedExecId, { wait: false });
      expect(resumedExec.status).toBe('queued');

      // Verify that while runningExec is active, countRunningExecutions never exceeds 1
      const runningCount = app.flows.countRunningExecutions(throttledFlow.id);
      expect(runningCount).toBeLessThanOrEqual(1);

      // Verify that resumedExec has an active job in the system queue
      const queueJob = await app.queue.getJob(resumedExec.jobId!);
      expect(queueJob).toBeDefined();
      expect(queueJob?.queue).toBe(`_system:flow:${throttledFlow.id}`);

      // Wait until both executions finish in sequence
      await vi.waitFor(async () => {
        const r1 = app.flows.getExecutionById(runningExec.id);
        const r2 = app.flows.getExecutionById(failedExecId);
        expect(r1?.status).toBe('succeeded');
        expect(r2?.status).toBe('succeeded');
      }, { timeout: 4000, interval: 50 });

      app.flows.deleteFlow(throttledFlow.id);
    });

    it('should route orphaned executions through queue admission when recovering with strategy resume on a throttled flow', async () => {
      const throttledFlow = app.flows.createFlow({
        name: 'RecoverThrottledFlow',
        enabled: true,
        maxConcurrentExecutions: 1,
        definition: {
          startAt: 'Step1',
          states: {
            Step1: {
              type: 'Pass',
              result: { step1Done: true },
              end: true,
            },
          },
        },
      });

      const orphanId = 'exec_orphan_throttled_1';
      const db = (app.flows as any).db;
      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, output, durationMs, stepLogs, startedAt, checkpoint)
        VALUES (?, ?, ?, 'running', '{}', '{}', 0, '[]', ?, ?)
      `).run(
        orphanId,
        throttledFlow.id,
        throttledFlow.name,
        new Date().toISOString(),
        JSON.stringify({ currentStateName: 'Step1', currentPayload: {}, updatedAt: new Date().toISOString() })
      );

      // Recover with strategy 'resume'
      const recovered = await app.flows.recoverOrphanedExecutions('resume');
      const found = recovered.find((r) => r.id === orphanId);
      expect(found).toBeDefined();
      expect(found!.status).toBe('queued');

      // Poll until the queue worker executes and completes the resumed execution
      await vi.waitFor(async () => {
        const item = app.flows.getExecutionById(orphanId);
        expect(item?.status).toBe('succeeded');
      }, { timeout: 4000, interval: 50 });

      app.flows.deleteFlow(throttledFlow.id);
    });

    it('should atomically reserve admission before yielding so concurrent executeFlow calls with identical executionId reject cleanly without overwriting waiters or failing queue unique constraints', async () => {
      const throttledFlow = app.flows.createFlow({
        name: 'ConcurrentIdFlow',
        enabled: true,
        maxConcurrentExecutions: 1,
        definition: {
          startAt: 'Work',
          states: {
            Work: {
              type: 'Wait',
              seconds: 0.5,
              end: true,
            },
          },
        },
      });

      const sharedExecutionId = `exec_shared_${Date.now()}`;

      // Fire two concurrent executeFlow() calls with wait=true and the EXACT same executionId
      const [res1, res2] = await Promise.allSettled([
        app.flows.executeFlow(throttledFlow.id, { call: 1 }, undefined, {
          executionId: sharedExecutionId,
          wait: true,
        }),
        app.flows.executeFlow(throttledFlow.id, { call: 2 }, undefined, {
          executionId: sharedExecutionId,
          wait: true,
        }),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      // Exactly one must succeed, and one must be rejected with 409 Conflict
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // Verify successful execution completed properly without waiter loss or timing out
      const successResult = (fulfilled[0] as PromiseFulfilledResult<any>).value;
      expect(successResult.status).toBe('succeeded');
      expect(successResult.id).toBe(sharedExecutionId);

      // Verify rejected execution gave 409 Conflict (not a SQLite unique constraint error or 408 timeout)
      const errorResult = (rejected[0] as PromiseRejectedResult).reason;
      expect(errorResult.statusCode).toBe(409);
      expect(errorResult.message).toMatch(/already running|currently running/i);

      app.flows.deleteFlow(throttledFlow.id);
    });

    it('should reject executeFlow with 409 Conflict if supplied executionId already exists (e.g. completed)', async () => {
      const throttledFlow = app.flows.createFlow({
        name: 'CompletedIdReuseFlow',
        enabled: true,
        maxConcurrentExecutions: 1,
        definition: {
          startAt: 'Done',
          states: {
            Done: {
              type: 'Pass',
              result: { done: true },
              end: true,
            },
          },
        },
      });

      const fixedExecutionId = `exec_completed_${Date.now()}`;

      // First execution completes normally
      const exec1 = await app.flows.executeFlow(throttledFlow.id, {}, undefined, {
        executionId: fixedExecutionId,
        wait: true,
      });
      expect(exec1.status).toBe('succeeded');

      // Attempting to reuse the same executionId must be rejected with 409 Conflict rather than overwriting
      await expect(
        app.flows.executeFlow(throttledFlow.id, {}, undefined, {
          executionId: fixedExecutionId,
          wait: true,
        })
      ).rejects.toThrowError(/already exists/i);

      // Verify original succeeded record was NOT overwritten or corrupted
      const check = app.flows.getExecutionById(fixedExecutionId);
      expect(check?.status).toBe('succeeded');

      app.flows.deleteFlow(throttledFlow.id);
    });

    it('should clean up waiter/timer and mark execution failed on queue dispatch failure without unhandled rejections', async () => {
      const throttledFlow = app.flows.createFlow({
        name: 'DispatchFailureCleanupFlow',
        enabled: true,
        maxConcurrentExecutions: 1,
        definition: {
          startAt: 'Work',
          states: {
            Work: {
              type: 'Wait',
              seconds: 0.1,
              end: true,
            },
          },
        },
      });

      const testExecId = `exec_dispatch_fail_${Date.now()}`;
      const queueService = (app.flows as any).queueService;
      const originalSend = queueService.send.bind(queueService);

      // Simulate queue dispatch failure (e.g. database error, constraint failure, etc.)
      queueService.send = vi.fn().mockRejectedValueOnce(new Error('Simulated queue driver failure'));

      let dispatchError: any;
      try {
        await app.flows.executeFlow(throttledFlow.id, {}, undefined, {
          executionId: testExecId,
          wait: true,
          timeoutMs: 100, // Short timeout to verify timer does NOT fire
        });
      } catch (err: any) {
        dispatchError = err;
      }

      expect(dispatchError).toBeDefined();
      expect(dispatchError.message).toContain('Simulated queue driver failure');

      // Waiter must have been cleaned up immediately from Map
      const waiters = (app.flows as any).executionWaiters;
      expect(waiters.has(testExecId)).toBe(false);

      // Execution in DB must NOT be stranded as 'queued'; it should be marked as 'failed'
      const record = app.flows.getExecutionById(testExecId);
      expect(record?.status).toBe('failed');
      expect(record?.error).toContain('Dispatch failed');

      // Restore original send method
      queueService.send = originalSend;

      // Wait beyond the 100ms timeout to ensure no unhandled promise rejection or orphaned timer fires
      await new Promise((r) => setTimeout(r, 200));

      app.flows.deleteFlow(throttledFlow.id);
    });

    it('should renew lease for remaining execution budget and maintain heartbeat so long steps (Pass -> Wait) do not lose their lease or concurrency slot', async () => {
      const longBudgetFlow = app.flows.createFlow({
        name: 'LongBudgetLeaseFlow',
        enabled: true,
        maxConcurrentExecutions: 1,
        definition: {
          startAt: 'FastPass',
          timeoutSeconds: 300,
          states: {
            FastPass: {
              type: 'Pass',
              next: 'HoldStep',
            },
            HoldStep: {
              type: 'Wait',
              seconds: 0.4,
              end: true,
            },
          },
        },
      });

      const execId1 = `exec_long_budget_${Date.now()}`;
      const exec1Promise = app.flows.executeFlow(longBudgetFlow.id, { step: 1 }, undefined, {
        executionId: execId1,
        wait: true,
      });

      // Wait 80ms for FastPass to complete and HoldStep to be active
      await new Promise((r) => setTimeout(r, 80));

      const exec1 = app.flows.getExecutionById(execId1);
      expect(exec1).not.toBeNull();
      expect(exec1?.status).toBe('running');
      expect(exec1?.jobId).toBeDefined();

      const job = await app.queue.getJob(exec1!.jobId!);
      expect(job).not.toBeNull();
      expect(job?.status).toBe('processing');

      // The lease must retain the remaining ~300+ second execution budget rather than being truncated to 60s
      const leaseExpiry = new Date(job!.leaseExpiresAt!).getTime();
      const minExpectedLeaseExpiry = Date.now() + 250000; // at least 250s in the future
      expect(leaseExpiry).toBeGreaterThan(minExpectedLeaseExpiry);

      // Concurrency check: another execution dispatched while HoldStep is running must stay queued
      const exec2 = await app.flows.executeFlow(longBudgetFlow.id, { step: 2 }, undefined, { wait: false });
      expect(exec2.status).toBe('queued');

      // Wait for exec1 to complete
      const res1 = await exec1Promise;
      expect(res1.status).toBe('succeeded');

      // Wait for queued exec2 to be claimed and complete
      await vi.waitFor(async () => {
        const check2 = app.flows.getExecutionById(exec2.id);
        expect(check2?.status).toBe('succeeded');
      }, { timeout: 3000, interval: 50 });

      app.flows.deleteFlow(longBudgetFlow.id);
    });

    it('should reconcile non-queued job states on startup and restore claimable job when execution is queued', async () => {
      const throttledFlow = app.flows.createFlow({
        name: 'CrashReconciliationFlow',
        enabled: true,
        maxConcurrentExecutions: 1,
        definition: {
          startAt: 'Work',
          states: {
            Work: {
              type: 'Pass',
              result: { crashRecovered: true },
              end: true,
            },
          },
        },
      });

      const queueName = `_system:flow:${throttledFlow.id}`;
      const executionId = `exec_crashed_sim_${Date.now()}`;
      const jobId = `job_${executionId}`;
      const db = (app.flows as any).db;
      const now = new Date().toISOString();

      // 1. Simulate process crashing right after QueueService claimed the job but BEFORE execution became 'running':
      // Execution is still 'queued', while QueueJob is in 'processing' with attempts=1
      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, durationMs, stepLogs, queuedAt, startedAt, jobId)
        VALUES (?, ?, ?, 'queued', '{}', 0, '[]', ?, ?, ?)
      `).run(executionId, throttledFlow.id, throttledFlow.name, now, now, jobId);

      db.prepare(`
        INSERT INTO _queue_jobs (id, queue, groupKey, status, payload, attempts, maxAttempts, claimedBy, leaseExpiresAt, availableAt, created, updated)
        VALUES (?, ?, ?, 'processing', ?, 1, 1, 'dead_worker_pid', ?, ?, ?, ?)
      `).run(
        jobId,
        queueName,
        throttledFlow.id,
        JSON.stringify({ executionId, flowId: throttledFlow.id, input: {} }),
        new Date(Date.now() + 60000).toISOString(),
        now,
        now,
        now
      );

      // Verify simulated pre-conditions
      const preExec = app.flows.getExecutionById(executionId);
      expect(preExec?.status).toBe('queued');
      const preJob = await app.queue.getJob(jobId);
      expect(preJob?.status).toBe('processing');

      // 2. Run startup reconciliation
      await app.flows.recoverOrphanedExecutions();

      // 3. Worker must have been woken, claimed the restored job, and executed the flow to 'succeeded'
      await vi.waitFor(async () => {
        const postExec = app.flows.getExecutionById(executionId);
        expect(postExec?.status).toBe('succeeded');
        expect(postExec?.output).toEqual({ crashRecovered: true });
      }, { timeout: 4000, interval: 50 });

      // Verify the queue job reached 'completed' rather than being dead-lettered
      const postJob = await app.queue.getJob(jobId);
      expect(postJob?.status).toBe('completed');

      // 4. Test second case: an execution whose job became 'dead_letter' before startup reconciliation
      const deadExecId = `exec_dead_letter_sim_${Date.now()}`;
      const deadJobId = `job_${deadExecId}`;

      db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, input, durationMs, stepLogs, queuedAt, startedAt, jobId)
        VALUES (?, ?, ?, 'queued', '{}', 0, '[]', ?, ?, ?)
      `).run(deadExecId, throttledFlow.id, throttledFlow.name, now, now, deadJobId);

      db.prepare(`
        INSERT INTO _queue_jobs (id, queue, groupKey, status, payload, attempts, maxAttempts, claimedBy, leaseExpiresAt, availableAt, created, updated)
        VALUES (?, ?, ?, 'dead_letter', ?, 1, 1, NULL, NULL, ?, ?, ?)
      `).run(
        deadJobId,
        queueName,
        throttledFlow.id,
        JSON.stringify({ executionId: deadExecId, flowId: throttledFlow.id, input: {} }),
        now,
        now,
        now
      );

      // Run startup reconciliation again
      await app.flows.recoverOrphanedExecutions();

      // Must be restored from dead_letter and successfully executed
      await vi.waitFor(async () => {
        const recoveredDeadExec = app.flows.getExecutionById(deadExecId);
        expect(recoveredDeadExec?.status).toBe('succeeded');
      }, { timeout: 4000, interval: 50 });

      app.flows.deleteFlow(throttledFlow.id);
    });

    it('should throttle bulk database event triggers (e.g. 12 concurrent events with maxConcurrentExecutions = 2) and execute all in FIFO without dropping', async () => {
      app.schema.createCollection({
        name: 'bulk_throttle_items',
        type: 'base',
        schema: [
          { id: 'f_seq', name: 'seq', type: 'number', required: true },
        ],
      });

      const throttledFlow = app.flows.createFlow({
        name: 'BulkEventThrottledFlow',
        enabled: true,
        triggerType: 'event',
        eventTrigger: 'bulk_throttle_items:create',
        maxConcurrentExecutions: 2,
        definition: {
          startAt: 'SlowWork',
          states: {
            SlowWork: {
              type: 'Wait',
              seconds: 0.08,
              next: 'Finish',
            },
            Finish: {
              type: 'Pass',
              result: { processed: true },
              resultPath: '$.done',
              end: true,
            },
          },
        },
      });

      await new Promise((r) => setTimeout(r, 20));

      const totalItems = 12;
      for (let i = 1; i <= totalItems; i++) {
        await app.records.create('bulk_throttle_items', { seq: i }, { isAdmin: true });
      }

      await new Promise((r) => setTimeout(r, 20));
      const midExecs = app.flows.getExecutions({ flowId: throttledFlow.id, perPage: 50, page: 1 });
      const runningMid = midExecs.items.filter((e) => e.status === 'running');
      const queuedMid = midExecs.items.filter((e) => e.status === 'queued');

      expect(runningMid.length).toBeLessThanOrEqual(2);
      expect(queuedMid.length).toBeGreaterThanOrEqual(4);

      for (let attempt = 0; attempt < 60; attempt++) {
        const current = app.flows.getExecutions({ flowId: throttledFlow.id, perPage: 50, page: 1 });
        const completedCount = current.items.filter((e) => e.status === 'succeeded').length;
        const activeCount = current.items.filter((e) => e.status === 'running').length;
        expect(activeCount).toBeLessThanOrEqual(2);
        if (completedCount === totalItems) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      const finalExecs = app.flows.getExecutions({ flowId: throttledFlow.id, perPage: 50, page: 1 });
      expect(finalExecs.items.length).toBe(totalItems);
      expect(finalExecs.items.every((e) => e.status === 'succeeded')).toBe(true);

      app.flows.deleteFlow(throttledFlow.id);
    });

    it('should isolate per-flow queues so a backlogged Flow A (maxConcurrentExecutions=1) never blocks Flow B', async () => {
      const flowA = app.flows.createFlow({
        name: 'SlowIsolatedFlowA',
        enabled: true,
        triggerType: 'http',
        maxConcurrentExecutions: 1,
        definition: {
          startAt: 'WaitStep',
          states: {
            WaitStep: {
              type: 'Wait',
              seconds: 0.4,
              end: true,
            },
          },
        },
      });

      const flowB = app.flows.createFlow({
        name: 'FastIsolatedFlowB',
        enabled: true,
        triggerType: 'http',
        maxConcurrentExecutions: 5,
        definition: {
          startAt: 'QuickPass',
          states: {
            QuickPass: {
              type: 'Pass',
              result: { fast: true },
              end: true,
            },
          },
        },
      });

      await new Promise((r) => setTimeout(r, 20));

      const pA1 = app.flows.executeFlow(flowA.id, { run: 1 }, undefined, { wait: false });
      const pA2 = app.flows.executeFlow(flowA.id, { run: 2 }, undefined, { wait: false });
      const pA3 = app.flows.executeFlow(flowA.id, { run: 3 }, undefined, { wait: false });
      await Promise.all([pA1, pA2, pA3]);

      const startB = Date.now();
      const resB = await app.flows.executeFlow(flowB.id, { check: 'isolation' }, undefined, { wait: true });
      const elapsedB = Date.now() - startB;

      expect(resB.status).toBe('succeeded');
      expect(resB.output).toEqual({ fast: true });
      expect(elapsedB).toBeLessThan(300);

      await new Promise((r) => setTimeout(r, 1300));
      app.flows.deleteFlow(flowA.id);
      app.flows.deleteFlow(flowB.id);
    });

    it('should support HTTP wait=false (202 Accepted with status: queued), wait=true (blocks until slot finishes), and 408 Request Timeout when timeoutMs expires in queue', async () => {
      const httpFlow = app.flows.createFlow({
        name: 'HttpThrottledFlow',
        enabled: true,
        triggerType: 'http',
        maxConcurrentExecutions: 1,
        definition: {
          startAt: 'HoldSlot',
          states: {
            HoldSlot: {
              type: 'Wait',
              seconds: 0.35,
              next: 'Done',
            },
            Done: {
              type: 'Pass',
              result: { completedViaQueue: true },
              end: true,
            },
          },
        },
      });

      await new Promise((r) => setTimeout(r, 20));

      const headers = {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      };

      const res1 = await fetch(`http://127.0.0.1:8197/api/flows/${httpFlow.id}/execute?wait=false`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ first: true }),
      });
      expect(res1.status).toBe(202);
      const body1 = await res1.json();
      expect(['queued', 'running']).toContain(body1.status);
      expect(body1.executionId).toBeDefined();

      const res2 = await fetch(`http://127.0.0.1:8197/api/flows/${httpFlow.id}/execute?wait=false`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ second: true }),
      });
      expect(res2.status).toBe(202);
      const body2 = await res2.json();
      expect(body2.status).toBe('queued');

      const resTimeout = await fetch(
        `http://127.0.0.1:8197/api/flows/${httpFlow.id}/execute?wait=true&timeoutMs=80`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ third: 'will-timeout' }),
        }
      );
      expect(resTimeout.status).toBe(408);

      const resSync = await fetch(
        `http://127.0.0.1:8197/api/flows/${httpFlow.id}/execute?wait=true&timeoutMs=5000`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ fourth: 'waits-and-succeeds' }),
        }
      );
      expect(resSync.status).toBe(200);
      const syncExec = await resSync.json();
      expect(syncExec.status).toBe('succeeded');
      expect(syncExec.output).toEqual({ completedViaQueue: true });

      app.flows.deleteFlow(httpFlow.id);
    });

    it('should cancel the underlying queue job and prevent execution when abortExecution() is called on a queued flow execution', async () => {
      const abortFlow = app.flows.createFlow({
        name: 'AbortQueuedFlow',
        enabled: true,
        triggerType: 'http',
        maxConcurrentExecutions: 1,
        definition: {
          startAt: 'SlowStep',
          states: {
            SlowStep: {
              type: 'Wait',
              seconds: 0.4,
              end: true,
            },
          },
        },
      });

      await new Promise((r) => setTimeout(r, 20));

      await app.flows.executeFlow(abortFlow.id, { seq: 1 }, undefined, { wait: false });
      const exec2 = await app.flows.executeFlow(abortFlow.id, { seq: 2 }, undefined, { wait: false });
      expect(exec2.status).toBe('queued');
      expect(exec2.jobId).toBeDefined();

      const aborted = app.flows.abortExecution(exec2.id);
      expect(aborted.status).toBe('aborted');

      await new Promise((r) => setTimeout(r, 20));
      const cancelledJob = await app.queue.getJob(exec2.jobId!);
      expect(cancelledJob).toBeNull();

      await new Promise((r) => setTimeout(r, 550));
      const exec2After = app.flows.getExecutionById(exec2.id)!;
      expect(exec2After.status).toBe('aborted');
      expect(exec2After.stepLogs.length).toBe(0);

      app.flows.deleteFlow(abortFlow.id);
    });

    it('should render maxConcurrentExecutions controls in Admin UI (Create Flow modal, Flow cards, Designer toolbar, and Execution status filter)', async () => {
      const htmlPath = path.resolve(__dirname, '../dist/admin/ui/index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      const dom = new JSDOM(htmlContent, {
        runScripts: 'dangerously',
        resources: 'usable',
        url: 'http://localhost:8197/_/',
      });
      const win = dom.window as any;
      const doc = win.document as Document;

      win.fetch = (url: string, opts?: any) => {
        const fullUrl = url.startsWith('http') ? url : `http://localhost:8197${url}`;
        return globalThis.fetch(fullUrl, {
          ...opts,
          headers: { ...opts?.headers, Authorization: `Bearer ${adminToken}` },
        });
      };
      win.alert = () => {};
      win.confirm = () => true;

      await new Promise((r) => setTimeout(r, 150));

      // 1. Create Flow Modal has #new-flow-concurrency
      win.openCreateFlowModal();
      const concurrencyModalInput = doc.getElementById('new-flow-concurrency') as HTMLInputElement;
      expect(concurrencyModalInput).not.toBeNull();
      expect(concurrencyModalInput.getAttribute('min')).toBe('1');
      win.closeFlowModal();

      // 2. Flow card shows Concurrency badge
      win.flowsState.currentView = 'list';
      win.flowsState.subTab = 'flows';
      win.flowsState.flows = [
        {
          id: 'flow_ui_conc',
          name: 'ThrottledUiFlow',
          description: 'UI test',
          enabled: true,
          triggerType: 'event',
          eventTrigger: 'orders:create',
          maxConcurrentExecutions: 4,
          definition: { startAt: 'S1', states: { S1: { type: 'Pass', end: true } } },
        },
      ];
      await win.renderFlowsView();
      const container = doc.getElementById('page-view-flows')!;
      expect(container.innerHTML).toContain('Concurrency:');
      expect(container.innerHTML).toContain('4');

      // 3. Designer toolbar has #flow-edit-concurrency input
      win.designerState.activeFlow = win.flowsState.flows[0];
      win.renderFlowDesignerWorkbench(win.designerState.activeFlow);
      const editConcInput = doc.getElementById('flow-edit-concurrency') as HTMLInputElement;
      expect(editConcInput).not.toBeNull();
      expect(editConcInput.value).toBe('4');

      // 4. Execution History tab has #flows-status-filter including 'queued'
      win.flowsState.currentView = 'list';
      win.flowsState.subTab = 'executions';
      await win.renderFlowsView();
      const statusFilter = doc.getElementById('flows-status-filter') as HTMLSelectElement;
      expect(statusFilter).not.toBeNull();
      expect(statusFilter.innerHTML).toContain('value="queued"');
    });
  });


  
  describe('State Machine Resilience, Path Mapping & Sub-Flow Error Propagation', () => {
    it('should initialize target object or array when setting paths on primitive or null roots', () => {
      const objResult = FlowPathMapper.set('primitive-string', '$.user.name', 'Alice');
      expect(objResult).toEqual({ user: { name: 'Alice' } });

      const arrResult = FlowPathMapper.set(12345, '$[0]', 'first-item');
      expect(Array.isArray(arrResult)).toBe(true);
      expect(arrResult[0]).toBe('first-item');

      const nullResult = FlowPathMapper.set(null, '$.data.status', 'ready');
      expect(nullResult).toEqual({ data: { status: 'ready' } });
    });

    it('should prevent prototype pollution via __proto__, constructor, or prototype path segments', () => {
      const target = {};
      FlowPathMapper.set(target, '$.__proto__.polluted', true);
      FlowPathMapper.set(target, '$.constructor.prototype.polluted2', true);

      expect((({} as any).polluted)).toBeUndefined();
      expect((({} as any).polluted2)).toBeUndefined();
    });

    it('should reject Loop state definitions missing condition rules or terminal/next transitions', () => {
      // Missing condition
      const defMissingCond: FlowDefinition = {
        startAt: 'LoopStep',
        states: {
          LoopStep: {
            type: 'Loop',
            target: 'LoopStep',
            next: 'Done',
          } as any,
          Done: { type: 'Succeed' },
        },
      };
      expect(() => FlowValidator.validate(defMissingCond)).toThrow(/must specify a condition choice rule/);

      // Missing next and end
      const defMissingNextAndEnd: FlowDefinition = {
        startAt: 'LoopStep',
        states: {
          LoopStep: {
            type: 'Loop',
            target: 'LoopStep',
            condition: { variable: '$.count', numericLessThan: 5 },
          } as any,
        },
      };
      expect(() => FlowValidator.validate(defMissingNextAndEnd)).toThrow(/must specify either 'next' or 'end: true'/);
    });

    it('should recursively update referenced function identifiers across Task, Map, and Parallel states', () => {
      const def: FlowDefinition = {
        startAt: 'Step1',
        states: {
          Step1: { type: 'Task', function: 'old-fn-name', next: 'Step2' },
          Step2: {
            type: 'Map',
            itemsPath: '$.items',
            iterator: {
              startAt: 'MapTask',
              states: {
                MapTask: { type: 'Task', function: 'old-fn-name', end: true },
              },
            },
            next: 'Step3',
          },
          Step3: {
            type: 'Parallel',
            branches: [
              {
                startAt: 'BranchTask',
                states: {
                  BranchTask: { type: 'Task', function: 'old-fn-name', end: true },
                },
              },
            ],
            end: true,
          },
        },
      };

      const modified = FlowValidator.renameReferencedFunction(def, 'old-fn-name', 'new-fn-name');
      expect(modified).toBe(true);
      expect((def.states.Step1 as any).function).toBe('new-fn-name');
      expect((def.states.Step2 as any).iterator.states.MapTask.function).toBe('new-fn-name');
      expect((def.states.Step3 as any).branches[0].states.BranchTask.function).toBe('new-fn-name');
    });

    it('should format error message combining error and cause when both are defined in Fail state', async () => {
      const handler = new FailStateHandler();
      const result = await handler.execute(
        { type: 'Fail', error: 'PaymentDeclined', cause: 'Insufficient funds on credit card' },
        { flowName: 'TestFlow', stateName: 'FailStep', payload: {}, loopCounters: new Map(), executeSubFlow: async () => ({}) }
      );

      expect(result.status).toBe('failed');
      expect(result.error).toBe('PaymentDeclined: Insufficient funds on credit card');
    });

    it('should strictly respect maxAttempts: 0 in retry policy without defaulting to multiple attempts', async () => {
      const engine = new FlowEngine();
      let callCount = 0;

      engine.registerHandler('Task', {
        async execute() {
          callCount++;
          throw new Error('TaskExecutionFailed');
        },
      });

      const def: FlowDefinition = {
        startAt: 'FailingStep',
        states: {
          FailingStep: {
            type: 'Task',
            function: 'any',
            retry: [
              {
                errorEquals: ['*'],
                maxAttempts: 0,
                intervalSeconds: 1,
              },
            ],
            end: true,
          },
        },
      };

      const result = await engine.execute('RetryZeroTest', def, {});
      expect(result.status).toBe('failed');
      expect(callCount).toBe(1);
    });

    it('should propagate sub-flow error codes and names to matching parent catch policies', async () => {
      const engine = new FlowEngine();
      engine.registerHandler('Task', {
        async execute(state: any) {
          if (state.function === 'failing-task') {
            const err = new Error('CustomBusinessError');
            err.name = 'CustomBusinessError';
            throw err;
          }
          return { status: 'succeeded', payload: { ok: true } };
        },
      });
      engine.registerHandler('Pass', {
        async execute(state: any, ctx: any) {
          return { status: 'succeeded', payload: ctx.payload, nextState: state.next, isEnd: state.end };
        },
      });

      const def: FlowDefinition = {
        startAt: 'RunParallel',
        states: {
          RunParallel: {
            type: 'Parallel',
            branches: [
              {
                startAt: 'SubTask',
                states: {
                  SubTask: { type: 'Task', function: 'failing-task', end: true },
                },
              },
            ],
            catch: [
              {
                errorEquals: ['CustomBusinessError'],
                next: 'HandleError',
                resultPath: '$.catchError',
              },
            ],
            end: true,
          },
          HandleError: {
            type: 'Pass',
            end: true,
          },
        },
      };

      const result = await engine.execute('CatchSubFlowTest', def, {});
      expect(result.status).toBe('succeeded');
      expect(result.output?.catchError).toBeDefined();
    });

    it('should preserve in-flight execution claims and active status during crash recovery', async () => {
      const flowService = app.flows;

      // Seed an active claim in activeExecutionClaims
      const testClaimId = 'exec_actively_running_claim_test';
      (flowService as any).activeExecutionClaims.add(testClaimId);

      // Insert mock DB records: one actively claimed, one genuinely orphaned
      (flowService as any).db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, startedAt, durationMs, claimToken)
        VALUES (?, 'f1', 'Flow1', 'running', ?, 0, 'token-123')
      `).run(testClaimId, new Date().toISOString());

      const orphanId = 'exec_truly_orphaned_restart_test';
      (flowService as any).db.prepare(`
        INSERT INTO _flow_executions (id, flowId, flowName, status, startedAt, durationMs, claimToken)
        VALUES (?, 'f1', 'Flow1', 'running', ?, 0, 'token-456')
      `).run(orphanId, new Date().toISOString());

      try {
        const recovered = await flowService.recoverOrphanedExecutions('abort');
        expect(recovered.some(e => e.id === orphanId)).toBe(true);
        expect(recovered.some(e => e.id === testClaimId)).toBe(false);

        // Verify active claimed execution still has its status and claim in DB
        const activeRow = (flowService as any).db.prepare('SELECT status, claimToken FROM _flow_executions WHERE id = ?').get(testClaimId);
        expect(activeRow.status).toBe('running');
        expect(activeRow.claimToken).toBe('token-123');
      } finally {
        (flowService as any).activeExecutionClaims.delete(testClaimId);
        (flowService as any).db.prepare('DELETE FROM _flow_executions WHERE id IN (?, ?)').run(testClaimId, orphanId);
      }
    });

    it('should resolve flow execution history and clear operations by flow name as well as ID', async () => {
      // Create a flow with a specific name
      const createRes = await app.server.inject({
        method: 'POST',
        url: '/api/flows',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'NamedFlowResolvingTest',
          definition: {
            startAt: 'Done',
            states: { Done: { type: 'Succeed' } },
          },
        },
      });
      const createdFlow = createRes.json();

      // Execute it once
      await app.server.inject({
        method: 'POST',
        url: `/api/flows/${createdFlow.id}/execute?wait=true`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });

      // Query executions using flow NAME instead of ID
      const queryByNameRes = await app.server.inject({
        method: 'GET',
        url: '/api/flows/NamedFlowResolvingTest/executions',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(queryByNameRes.statusCode).toBe(200);
      const nameData = queryByNameRes.json();
      expect(nameData.totalItems).toBe(1);

      // Clear executions using flow NAME
      const clearRes = await app.server.inject({
        method: 'DELETE',
        url: '/api/flows/NamedFlowResolvingTest/executions',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(clearRes.statusCode).toBe(200);

      // Query again to confirm cleared
      const queryAfterClear = await app.server.inject({
        method: 'GET',
        url: '/api/flows/NamedFlowResolvingTest/executions',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(queryAfterClear.json().totalItems).toBe(0);
    });
  });
});
