import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
        export default async function(context) {
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
        export default async function(context) {
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
        export default async function(context) {
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
        export default async function(context) {
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
  });
});
