import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { CronService } from '../src/cron/CronService';

describe('Native Cron & Scheduled Triggers Service ("app.cron & CronService")', () => {
  const testDir = path.resolve(__dirname, '../.test_cron_nodestack_data');
  let app: NodeStack;
  let adminToken = '';
  const port = 8296;
  const baseUrl = `http://127.0.0.1:${port}`;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDir,
      port,
    });

    await app.start();

    await app.auth.createAdmin('admin@nodestack.io', 'AdminPassword123!');
    const adminAuth = await app.auth.authenticateAdmin('admin@nodestack.io', 'AdminPassword123!');
    adminToken = adminAuth.token;
  });

  afterAll(async () => {
    if (app) {
      await app.stop();
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('1. Standalone Schedule CRUD & Stats', () => {
    let createdScheduleId = '';

    it('should validate cron expression and preview next runs', async () => {
      const preview = app.cron.preview('0 9 * * 1-5', 'America/New_York', 3);
      expect(preview.valid).toBe(true);
      expect(preview.nextRuns.length).toBe(3);
      expect(preview.description).toContain('9:00');
    });

    it('should create a standalone schedule targeting a function', async () => {
      const fn = await app.functions.createFunction({
        name: 'cron-worker-target',
        code: `
          export default async function(core, context) {
            return {
              status: 200,
              body: {
                message: "Cron executed successfully",
                scheduleId: context.cron?.scheduleId,
                isCatchUp: context.cron?.isCatchUp,
                inputPayload: context.request?.body
              }
            };
          }
        `,
        methods: ['POST'],
        enabled: true,
        authPolicy: 'admin',
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const schedule = await app.cron.createSchedule({
        name: 'Worker Schedule 1',
        targetType: 'function',
        targetId: fn.id,
        cronExpression: '*/15 * * * *',
        timezone: 'UTC',
        missedRunPolicy: 'skip',
        payload: { batchSize: 50 },
        enabled: true,
      });

      expect(schedule.id).toBeDefined();
      expect(schedule.name).toBe('Worker Schedule 1');
      expect(schedule.targetType).toBe('function');
      expect(schedule.targetId).toBe(fn.id);
      expect(schedule.nextRunAt).not.toBeNull();
      expect(schedule.payload).toEqual({ batchSize: 50 });
      createdScheduleId = schedule.id;
    });

    it('should get schedule by id and list schedules with filters', async () => {
      const schedule = await app.cron.getSchedule(createdScheduleId);
      expect(schedule).not.toBeNull();
      expect(schedule?.name).toBe('Worker Schedule 1');

      const all = await app.cron.getAllSchedules({ targetType: 'function' });
      expect(all.some((s) => s.id === createdScheduleId)).toBe(true);
    });

    it('should update schedule properties and recompute nextRunAt', async () => {
      const updated = await app.cron.updateSchedule(createdScheduleId, {
        name: 'Worker Schedule Updated',
        cronExpression: '0 0 * * *',
        timezone: 'America/New_York',
        missedRunPolicy: 'catch_up_once',
      });

      expect(updated.name).toBe('Worker Schedule Updated');
      expect(updated.cronExpression).toBe('0 0 * * *');
      expect(updated.timezone).toBe('America/New_York');
      expect(updated.missedRunPolicy).toBe('catch_up_once');
    });

    it('should provide accurate cron stats', async () => {
      const stats = await app.cron.getStats();
      expect(stats.totalSchedules).toBeGreaterThanOrEqual(1);
      expect(stats.activeSchedules).toBeGreaterThanOrEqual(1);
      expect(stats.byTarget.function).toBeGreaterThanOrEqual(1);
    });
  });

  describe('2. Function Target Execution & Context Verification', () => {
    it('should execute a scheduled function and populate context.cron', async () => {
      const fn = await app.functions.createFunction({
        name: 'cron-context-verifier',
        code: `
          export default async function(core, context) {
            return {
              status: 200,
              body: {
                hasCronCtx: Boolean(context.cron),
                scheduleId: context.cron?.scheduleId,
                scheduleName: context.cron?.scheduleName,
                timezone: context.cron?.timezone,
                isCatchUp: context.cron?.isCatchUp,
                receivedPayload: context.request?.body
              }
            };
          }
        `,
        methods: ['POST'],
        enabled: true,
        authPolicy: 'admin',
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const schedule = await app.cron.createSchedule({
        name: 'Context Verification Schedule',
        targetType: 'function',
        targetId: fn.id,
        cronExpression: '0 12 * * *',
        timezone: 'America/Chicago',
        missedRunPolicy: 'skip',
        payload: { sampleKey: 'sampleVal' },
      });

      const runLog = await app.cron.triggerSchedule(schedule.id);
      expect(runLog.status).toBe('succeeded');
      expect(runLog.scheduleId).toBe(schedule.id);
      expect(runLog.error).toBeNull();

      const parsedOutput = JSON.parse(runLog.output!);
      expect(parsedOutput.hasCronCtx).toBe(true);
      expect(parsedOutput.scheduleId).toBe(schedule.id);
      expect(parsedOutput.scheduleName).toBe('Context Verification Schedule');
      expect(parsedOutput.timezone).toBe('America/Chicago');
      expect(parsedOutput.isCatchUp).toBe(false);
      expect(parsedOutput.receivedPayload).toEqual({ sampleKey: 'sampleVal' });

      // Verify function log record has trigger: 'cron'
      const logs = app.functions.getLogs(fn.id, { page: 1, perPage: 10 });
      expect(logs.items.length).toBeGreaterThan(0);
      expect(logs.items[0].trigger).toBe('cron');
      expect(logs.items[0].actorId).toBe(`cron:${schedule.id}`);
    });
  });

  describe('3. Inline 1:1 Function & Flow Schedule Synchronization', () => {
    it('should automatically sync inline cron schedule on function create/update', async () => {
      const fn = await app.functions.createFunction({
        name: 'inline-cron-fn',
        code: `export default async function() { return { status: 200, body: "ok" }; }`,
        methods: ['POST'],
        enabled: true,
        authPolicy: 'admin',
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
        cronSchedule: '*/10 * * * *',
        cronTimezone: 'UTC',
        cronMissedPolicy: 'skip',
      });

      const inlineSchedule = await app.cron.getSchedule(`inline_fn_${fn.id}`);
      expect(inlineSchedule).not.toBeNull();
      expect(inlineSchedule?.cronExpression).toBe('*/10 * * * *');
      expect(inlineSchedule?.isSystemBound).toBe(true);

      // Disable or remove cronSchedule
      await app.functions.updateFunction(fn.id, {
        cronSchedule: null,
      });

      const removedSchedule = await app.cron.getSchedule(`inline_fn_${fn.id}`);
      expect(removedSchedule).toBeNull();
    });

    it('should automatically sync inline cron schedule on flow create/update/delete', async () => {
      const targetFn = await app.functions.createFunction({
        name: 'flow-cron-step',
        code: `export default async function(core, ctx) { return { status: 200, body: { stepDone: true, input: ctx.request?.body } }; }`,
        methods: ['POST'],
        enabled: true,
        authPolicy: 'admin',
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const flow = await app.flows.createFlow({
        name: 'scheduled-daily-flow',
        enabled: true,
        triggerType: 'cron',
        cronSchedule: '0 8 * * *',
        cronTimezone: 'Europe/London',
        cronMissedPolicy: 'skip',
        cronInput: { flowPayload: 123 },
        definition: {
          startAt: 'Step1',
          states: {
            Step1: {
              type: 'Task',
              function: targetFn.name,
              end: true,
            },
          },
        },
      });

      const inlineFlowSchedule = await app.cron.getSchedule(`inline_flow_${flow.id}`);
      expect(inlineFlowSchedule).not.toBeNull();
      expect(inlineFlowSchedule?.cronExpression).toBe('0 8 * * *');
      expect(inlineFlowSchedule?.timezone).toBe('Europe/London');
      expect(inlineFlowSchedule?.targetType).toBe('flow');

      // Trigger flow via cron
      const runLog = await app.cron.triggerSchedule(inlineFlowSchedule!.id);
      expect(runLog.status).toBe('succeeded');
      expect(runLog.executionRefId).toBeDefined();

      // Delete flow should clean up schedule
      await app.flows.deleteFlow(flow.id);
      const afterDelete = await app.cron.getSchedule(`inline_flow_${flow.id}`);
      expect(afterDelete).toBeNull();
    });
  });

  describe('4. Scheduled Snapshots Target & Eviction on SQLite', () => {
    it('should create a scheduled backup snapshot on SQLite', async () => {
      const schedule = await app.cron.createSchedule({
        name: 'Daily SQLite Backup',
        targetType: 'snapshot',
        targetId: 'data.db',
        cronExpression: '0 2 * * *',
        timezone: 'UTC',
        missedRunPolicy: 'catch_up_once',
      });

      expect(schedule.targetType).toBe('snapshot');

      const runLog = await app.cron.triggerSchedule(schedule.id);
      expect(runLog.status).toBe('succeeded');
      expect(runLog.executionRefId).toBeDefined();

      const snapshots = app.snapshots.listSnapshots();
      const createdSnap = snapshots.find((s) => s.id === runLog.executionRefId);
      expect(createdSnap).toBeDefined();
      expect(createdSnap?.name).toContain('cron-daily-sqlite-backup');
    });
  });

  describe('5. Missed-Run Policies Handling', () => {
    it("should handle 'skip' policy by recording skipped log and jumping nextRunAt forward", async () => {
      const fn = await app.functions.createFunction({
        name: 'fn-skip-test',
        code: `export default async function() { return { status: 200, body: 'ran' }; }`,
        methods: ['POST'],
        enabled: true,
        authPolicy: 'admin',
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      // Create schedule with nextRunAt set to 10 minutes in the past
      const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
      const schedule = await app.cron.createSchedule({
        name: 'Skip Policy Test',
        targetType: 'function',
        targetId: fn.id,
        cronExpression: '*/5 * * * *',
        missedRunPolicy: 'skip',
        enabled: true,
      });

      // Manually backdate nextRunAt to simulate missed tick during server downtime
      await app.db.run('UPDATE _cron_schedules SET nextRunAt = ? WHERE id = ?', tenMinutesAgo, schedule.id);

      // Execute tick
      await app.cron.tick();

      const updated = await app.cron.getSchedule(schedule.id);
      expect(updated?.lastStatus).toBe('skipped');
      // nextRunAt should have jumped to future (> now)
      expect(new Date(updated!.nextRunAt!).getTime()).toBeGreaterThan(Date.now());

      const runs = await app.cron.getRuns({ scheduleId: schedule.id });
      expect(runs.items.length).toBeGreaterThan(0);
      expect(runs.items[0].status).toBe('skipped');
      expect(runs.items[0].error).toContain('skipped per policy');
    });

    it("should handle 'catch_up_once' policy by executing once with isCatchUp: true", async () => {
      const fn = await app.functions.createFunction({
        name: 'fn-catch-up-test',
        code: `
          export default async function(core, ctx) {
            return {
              status: 200,
              body: { isCatchUp: ctx.cron?.isCatchUp }
            };
          }
        `,
        methods: ['POST'],
        enabled: true,
        authPolicy: 'admin',
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const twoHoursAgo = new Date(Date.now() - 120 * 60_000).toISOString();
      const schedule = await app.cron.createSchedule({
        name: 'Catch Up Once Test',
        targetType: 'function',
        targetId: fn.id,
        cronExpression: '0 * * * *',
        missedRunPolicy: 'catch_up_once',
        enabled: true,
      });

      await app.db.run('UPDATE _cron_schedules SET nextRunAt = ? WHERE id = ?', twoHoursAgo, schedule.id);

      await app.cron.tick();

      const updated = await app.cron.getSchedule(schedule.id);
      expect(updated?.lastStatus).toBe('succeeded');
      expect(new Date(updated!.nextRunAt!).getTime()).toBeGreaterThan(Date.now());

      const runs = await app.cron.getRuns({ scheduleId: schedule.id });
      expect(runs.items.length).toBeGreaterThan(0);
      expect(runs.items[0].isCatchUp).toBe(true);
      expect(runs.items[0].status).toBe('succeeded');
    });
  });

  describe('6. Multi-Instance Lease Contention (No Double-Firing)', () => {
    it('should prevent two simultaneous CronService instances from claiming the same schedule', async () => {
      const fn = await app.functions.createFunction({
        name: 'fn-race-target',
        code: `export default async function() { return { status: 200, body: 'ok' }; }`,
        methods: ['POST'],
        enabled: true,
        authPolicy: 'admin',
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const schedule = await app.cron.createSchedule({
        name: 'Race Contention Schedule',
        targetType: 'function',
        targetId: fn.id,
        cronExpression: '* * * * *',
        enabled: true,
      });

      // Set nextRunAt to 5 seconds ago (due now)
      const pastDue = new Date(Date.now() - 5000).toISOString();
      await app.db.run('UPDATE _cron_schedules SET nextRunAt = ? WHERE id = ?', pastDue, schedule.id);

      // Create a second CronService connected to the same database (simulating a second cluster node)
      const secondInstance = new CronService(app.db, {
        functionService: app.functions,
        flowService: app.flows,
        snapshotService: app.snapshots,
      });

      // Fire both ticks simultaneously in parallel
      await Promise.all([app.cron.tick(), secondInstance.tick()]);

      // Only 1 run should have been executed for this scheduled slot!
      const runs = await app.cron.getRuns({ scheduleId: schedule.id });
      expect(runs.items.length).toBe(1);

      await secondInstance.dispose();
    });
  });

  describe('7. Concurrent Execution of Multiple Due Schedules (No Head-of-Line Blocking)', () => {
    it('should dispatch and execute multiple due schedules concurrently without sequential blocking', async () => {
      const order: string[] = [];

      // Function 1: Slow job taking ~150ms
      const fnSlow = await app.functions.createFunction({
        name: 'fn-slow-worker',
        code: `
          export default async function() {
            const start = Date.now();
            while (Date.now() - start < 150) {}
            return { status: 200, body: 'slow done' };
          }
        `,
        methods: ['POST'],
        enabled: true,
        authPolicy: 'admin',
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      // Function 2: Fast job
      const fnFast = await app.functions.createFunction({
        name: 'fn-fast-worker',
        code: `
          export default async function() {
            return { status: 200, body: 'fast done' };
          }
        `,
        methods: ['POST'],
        enabled: true,
        authPolicy: 'admin',
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const schedSlow = await app.cron.createSchedule({
        name: 'Concurrent Slow Schedule',
        targetType: 'function',
        targetId: fnSlow.id,
        cronExpression: '* * * * *',
        enabled: true,
      });

      const schedFast = await app.cron.createSchedule({
        name: 'Concurrent Fast Schedule',
        targetType: 'function',
        targetId: fnFast.id,
        cronExpression: '* * * * *',
        enabled: true,
      });

      // Make both due right now
      const pastDue = new Date(Date.now() - 2000).toISOString();
      await app.db.run('UPDATE _cron_schedules SET nextRunAt = ? WHERE id = ?', pastDue, schedSlow.id);
      await app.db.run('UPDATE _cron_schedules SET nextRunAt = ? WHERE id = ?', pastDue, schedFast.id);

      const startTime = Date.now();
      // Tick handles both in parallel
      await app.cron.tick();
      const elapsed = Date.now() - startTime;

      // Both should have executed successfully
      const slowRuns = await app.cron.getRuns({ scheduleId: schedSlow.id });
      const fastRuns = await app.cron.getRuns({ scheduleId: schedFast.id });

      expect(slowRuns.items.length).toBe(1);
      expect(slowRuns.items[0].status).toBe('succeeded');
      expect(fastRuns.items.length).toBe(1);
      expect(fastRuns.items[0].status).toBe('succeeded');

      // The fast job finished in ~10ms while slow finished in ~400ms.
      // In concurrent execution, total time is roughly ~450ms (not 400 + 400)
      expect(elapsed).toBeLessThan(1200);
    });
  });

  describe('8. Bidirectional Sync for System-Bound (1:1) Inline Schedules', () => {
    it('should sync changes made in schedules back to parent functions and flows', async () => {
      // 1. Create a function with an inline cron schedule
      const fn = await app.functions.createFunction({
        name: 'fn-sync-bi-test',
        code: `export default async function() { return { status: 200, body: 'ok' }; }`,
        methods: ['POST'],
        enabled: true,
        cronSchedule: '0 0 * * *',
        cronTimezone: 'UTC',
        cronMissedPolicy: 'skip',
      });

      const inlineSchedId = `inline_fn_${fn.id}`;
      const sched = await app.cron.getSchedule(inlineSchedId);
      expect(sched).not.toBeNull();
      expect(sched?.cronExpression).toBe('0 0 * * *');

      // 2. Update the inline schedule directly via app.cron.updateSchedule
      await app.cron.updateSchedule(inlineSchedId, {
        cronExpression: '0 9 * * 1-5',
        timezone: 'America/New_York',
        missedRunPolicy: 'catch_up_once',
      });

      // 3. Inspect _functions: should reflect the updated cron values!
      const fnInDb = await app.functions.getFunctionById(fn.id);
      expect(fnInDb?.cronSchedule).toBe('0 9 * * 1-5');
      expect(fnInDb?.cronTimezone).toBe('America/New_York');
      expect(fnInDb?.cronMissedPolicy).toBe('catch_up_once');

      // 4. Update the function without changing cron: should NOT overwrite the updated schedule!
      await app.functions.updateFunction(fn.id, {
        description: 'Updated description only',
      });

      const schedAfterFnUpdate = await app.cron.getSchedule(inlineSchedId);
      expect(schedAfterFnUpdate?.cronExpression).toBe('0 9 * * 1-5');
      expect(schedAfterFnUpdate?.timezone).toBe('America/New_York');

      // 5. Delete the schedule from app.cron: should clear cronSchedule on parent function!
      await app.cron.deleteSchedule(inlineSchedId);

      const fnAfterDelete = await app.functions.getFunctionById(fn.id);
      expect(fnAfterDelete?.cronSchedule).toBeNull();
    });
  });

  describe('9. Snapshot Schedule Update Policy on Non-SQLite Engines', () => {
    it('should permit updating paused snapshot schedules while keeping enabled: false, but reject enabled: true', async () => {
      // Create a snapshot schedule on SQLite
      const sched = await app.cron.createSchedule({
        name: 'Snapshot Engine Safety Test',
        targetType: 'snapshot',
        targetId: 'data.db',
        cronExpression: '0 3 * * *',
        enabled: false,
      });

      // Temporarily mock snapshotService.isSupported() to return false (simulating PostgreSQL)
      const originalIsSupported = app.snapshots.isSupported.bind(app.snapshots);
      app.snapshots.isSupported = () => false;

      try {
        // Updating name or cron while enabled: false should SUCCEED
        const updated = await app.cron.updateSchedule(sched.id, {
          name: 'Snapshot Renamed While Paused',
          cronExpression: '0 4 * * *',
          enabled: false,
        });
        expect(updated.name).toBe('Snapshot Renamed While Paused');
        expect(updated.cronExpression).toBe('0 4 * * *');
        expect(updated.enabled).toBe(false);

        // Attempting to enable the snapshot schedule on unsupported engine should FAIL with 400
        await expect(
          app.cron.updateSchedule(sched.id, {
            enabled: true,
          })
        ).rejects.toThrow(/exclusive to embedded SQLite/);
      } finally {
        app.snapshots.isSupported = originalIsSupported;
      }
    });
  });

  describe('10. Scoped Clear History by Schedule ID', () => {
    it('should delete execution runs only for the specified scheduleId and preserve others', async () => {
      const fn = await app.functions.createFunction({
        name: 'fn-scoped-clear-test',
        code: `export default async function() { return { status: 200, body: 'ok' }; }`,
        methods: ['POST'],
        enabled: true,
      });

      const schedA = await app.cron.createSchedule({
        name: 'Schedule A History',
        targetType: 'function',
        targetId: fn.id,
        cronExpression: '* * * * *',
      });

      const schedB = await app.cron.createSchedule({
        name: 'Schedule B History',
        targetType: 'function',
        targetId: fn.id,
        cronExpression: '* * * * *',
      });

      // Trigger runs for both schedules
      await app.cron.triggerSchedule(schedA.id);
      await app.cron.triggerSchedule(schedA.id);
      await app.cron.triggerSchedule(schedB.id);

      const runsABefore = await app.cron.getRuns({ scheduleId: schedA.id });
      const runsBBefore = await app.cron.getRuns({ scheduleId: schedB.id });
      expect(runsABefore.total).toBe(2);
      expect(runsBBefore.total).toBe(1);

      // Clear runs ONLY for schedA
      const clearedCount = await app.cron.clearRuns(schedA.id);
      expect(clearedCount).toBe(2);

      const runsAAfter = await app.cron.getRuns({ scheduleId: schedA.id });
      const runsBAfter = await app.cron.getRuns({ scheduleId: schedB.id });
      expect(runsAAfter.total).toBe(0);
      // schedB runs must be preserved!
      expect(runsBAfter.total).toBe(1);
    });
  });

  describe('11. Group 3 Power Features: Retries, Auto-Pause Circuit Breaker, Expiration, and Rolling Retention', () => {
    it('should retry failed execution with backoff up to maxRetries and record final attempt', async () => {
      const fn = await app.functions.createFunction({
        name: 'fn-retry-power-test',
        code: `export default async function() { return { status: 200, body: 'ok' }; }`,
        methods: ['POST'],
        enabled: true,
      });

      const sched = await app.cron.createSchedule({
        name: 'Retry Schedule Test',
        targetType: 'function',
        targetId: fn.id,
        cronExpression: '* * * * *',
        maxRetries: 2,
      });

      let callCount = 0;
      const originalExec = app.functions.executeScheduledFunction.bind(app.functions);
      app.functions.executeScheduledFunction = async (...args) => {
        callCount++;
        if (callCount === 1) {
          return { status: 'error', statusCode: 500, error: 'Transient connection blip' } as any;
        }
        return { status: 'success', statusCode: 200, body: { attempt: callCount } } as any;
      };

      try {
        const run = await app.cron.triggerSchedule(sched.id);
        expect(callCount).toBe(2);
        expect(run.status).toBe('succeeded');
        expect(run.attempt).toBe(2);

        const updatedSched = await app.cron.getSchedule(sched.id);
        expect(updatedSched?.consecutiveFailures).toBe(0);
        expect(updatedSched?.lastStatus).toBe('succeeded');
      } finally {
        app.functions.executeScheduledFunction = originalExec;
      }
    });

    it('should trip the circuit breaker and auto-pause after consecutive failures reach threshold', async () => {
      const fn = await app.functions.createFunction({
        name: 'fn-circuit-breaker-test',
        code: `export default async function() { return { status: 200, body: 'ok' }; }`,
        methods: ['POST'],
        enabled: true,
      });

      const sched = await app.cron.createSchedule({
        name: 'Circuit Breaker Schedule',
        targetType: 'function',
        targetId: fn.id,
        cronExpression: '* * * * *',
        maxRetries: 0,
        autoPauseAfterFailures: 3,
      });

      let autoPauseEventData: any = null;
      app.eventBus.on('cron:autopause', (data: any) => {
        autoPauseEventData = data;
      });

      const originalExec = app.functions.executeScheduledFunction.bind(app.functions);
      app.functions.executeScheduledFunction = async () => {
        return { status: 'error', statusCode: 503, error: 'Target downstream crashed' } as any;
      };

      try {
        // Run 1: consecutiveFailures = 1
        await app.cron.triggerSchedule(sched.id);
        let s = await app.cron.getSchedule(sched.id);
        expect(s?.enabled).toBe(true);
        expect(s?.consecutiveFailures).toBe(1);

        // Run 2: consecutiveFailures = 2
        await app.cron.triggerSchedule(sched.id);
        s = await app.cron.getSchedule(sched.id);
        expect(s?.enabled).toBe(true);
        expect(s?.consecutiveFailures).toBe(2);

        // Run 3: consecutiveFailures = 3 -> TRIP CIRCUIT BREAKER!
        await app.cron.triggerSchedule(sched.id);
        s = await app.cron.getSchedule(sched.id);
        expect(s?.enabled).toBe(false);
        expect(s?.consecutiveFailures).toBe(3);
        expect(s?.lastError).toContain('Auto-paused: reached 3 consecutive failures');
        expect(autoPauseEventData).not.toBeNull();
        expect(autoPauseEventData?.scheduleId).toBe(sched.id);

        // When user resumes / updates enabled: true, consecutiveFailures resets to 0
        const resumed = await app.cron.updateSchedule(sched.id, { enabled: true });
        expect(resumed.enabled).toBe(true);
        expect(resumed.consecutiveFailures).toBe(0);
      } finally {
        app.functions.executeScheduledFunction = originalExec;
      }
    });

    it('should validate and enforce schedule expiration (expiresAt)', async () => {
      const fn = await app.functions.createFunction({
        name: 'fn-expire-test',
        code: `export default async function() { return { status: 200, body: 'ok' }; }`,
        methods: ['POST'],
        enabled: true,
      });

      // Reject past date on creation
      await expect(
        app.cron.createSchedule({
          name: 'Past Expire Test',
          targetType: 'function',
          targetId: fn.id,
          cronExpression: '* * * * *',
          expiresAt: new Date(Date.now() - 10_000).toISOString(),
        })
      ).rejects.toThrow(/expiresAt must be a future date/);

      // Create schedule expiring in 2 seconds
      const expiresAt = new Date(Date.now() + 2000).toISOString();
      const sched = await app.cron.createSchedule({
        name: 'Future Expire Test',
        targetType: 'function',
        targetId: fn.id,
        cronExpression: '* * * * *',
        expiresAt,
      });
      expect(sched.expiresAt).toBe(expiresAt);
      expect(sched.enabled).toBe(true);

      // Simulate passage of time past expiration
      const pastExpire = new Date(Date.now() + 5000);
      await app.db.run('UPDATE _cron_schedules SET nextRunAt = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), sched.id);

      // Trigger tick after expiration
      await app.cron.tick();

      const expiredSched = await app.cron.getSchedule(sched.id);
      expect(expiredSched?.enabled).toBe(false);
      expect(expiredSched?.nextRunAt).toBeNull();
      expect(expiredSched?.lastError).toContain('expired');
    });

    it('should maintain per-schedule rolling snapshot retention (keepLast)', async () => {
      const sched = await app.cron.createSchedule({
        name: 'Rolling Backup Test',
        targetType: 'snapshot',
        targetId: 'data.db',
        cronExpression: '0 0 * * *',
        keepLast: 2,
      });

      expect(sched.keepLast).toBe(2);

      // Trigger 3 snapshot runs sequentially
      await app.cron.triggerSchedule(sched.id);
      await new Promise((r) => setTimeout(r, 20));
      await app.cron.triggerSchedule(sched.id);
      await new Promise((r) => setTimeout(r, 20));
      await app.cron.triggerSchedule(sched.id);

      // List all snapshots with prefix for this schedule
      const prefix = `cron-${sched.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-`;
      const allSnaps = await app.snapshots.listSnapshots();
      const matching = (allSnaps || []).filter((s: any) => s.name && s.name.startsWith(prefix));

      // Older snapshots beyond keepLast (2) must have been automatically pruned!
      expect(matching.length).toBe(2);
    });
  });
});
