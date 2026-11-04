import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { NodeStack } from '../src/NodeStack';

describe('Generic Queue Processor & Pluggable Queue Drivers ("app.queue & SqliteQueueDriver")', () => {
  const testDir = path.resolve(__dirname, '../.test_queue_nodestack_data');
  let app: NodeStack;
  let adminToken = '';
  const port = 8295;
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

  describe('1. SqliteQueueDriver Atomic Claims, Priority, Lease Touch & Orphan Reclaim', () => {
    it('should atomically claim jobs in priority + FIFO order inside SQLite transactions', async () => {
      await app.queue.upsertQueue({
        name: 'priority-fifo-test',
        concurrency: 2,
        maxAttempts: 3,
      });

      const job1 = await app.queue.send('priority-fifo-test', { seq: 1 }, { priority: 1 });
      const job2 = await app.queue.send('priority-fifo-test', { seq: 2 }, { priority: 10 });
      const job3 = await app.queue.send('priority-fifo-test', { seq: 3 }, { priority: 10 });
      const job4 = await app.queue.send('priority-fifo-test', { seq: 4 }, { priority: 5 });

      expect(job1.status).toBe('queued');

      // Claim up to 2 jobs (concurrency is 2, visibilityTimeoutSeconds = 30, limit = 5)
      const claimedBatch1 = await app.queue.claim('priority-fifo-test', 30, 5);
      expect(claimedBatch1.length).toBe(2);
      // Highest priority first (10), then FIFO between job2 and job3
      expect(claimedBatch1[0].id).toBe(job2.id);
      expect(claimedBatch1[0].status).toBe('processing');
      expect(claimedBatch1[0].attempts).toBe(1);
      expect(claimedBatch1[1].id).toBe(job3.id);

      // Attempting to claim more while 2 are processing must return empty because concurrency=2
      const claimedWhileFull = await app.queue.claim('priority-fifo-test', 30, 5);
      expect(claimedWhileFull.length).toBe(0);

      // Complete job2 -> 1 slot opens up
      await app.queue.complete(job2.id, { ok: true });
      const completedJob2 = await app.queue.getJob(job2.id);
      expect(completedJob2?.status).toBe('completed');
      expect(completedJob2?.result).toEqual({ ok: true });

      // Next claim should grab job4 (priority 5)
      const claimedBatch2 = await app.queue.claim('priority-fifo-test', 30, 5);
      expect(claimedBatch2.length).toBe(1);
      expect(claimedBatch2[0].id).toBe(job4.id);

      // Complete job3 and job4, then claim job1
      await app.queue.complete(job3.id);
      await app.queue.complete(job4.id);

      const claimedBatch3 = await app.queue.claim('priority-fifo-test', 30, 5);
      expect(claimedBatch3.length).toBe(1);
      expect(claimedBatch3[0].id).toBe(job1.id);
      await app.queue.complete(job1.id);
    });

    it('should extend visibility lease via touch() and reclaim expired processing jobs via reclaimOrphaned()', async () => {
      await app.queue.upsertQueue({
        name: 'lease-recovery-test',
        concurrency: 5,
        maxAttempts: 2,
        visibilityTimeoutSeconds: 1,
      });

      const job = await app.queue.send('lease-recovery-test', { task: 'long-work' });
      const [claimed] = await app.queue.claim('lease-recovery-test', 30, 1);
      expect(claimed.id).toBe(job.id);
      expect(claimed.status).toBe('processing');

      // Touch extends the lease to 60 seconds in the future
      const touched = await app.queue.touch(job.id, 60);
      expect(touched).toBe(true);

      const afterTouch = (await app.queue.getJob(job.id))!;
      expect(new Date(afterTouch.leaseExpiresAt!).getTime()).toBeGreaterThan(Date.now() + 30000);

      // Simulate expired lease by setting leaseExpiresAt in the past via touch(-10)
      await app.queue.touch(job.id, -10);

      const reclaimedCount = await app.queue.reclaimOrphaned('lease-recovery-test');
      expect(reclaimedCount).toBeGreaterThanOrEqual(1);

      const requeuedJob = (await app.queue.getJob(job.id))!;
      expect(requeuedJob.status).toBe('queued');
      expect(requeuedJob.error).toContain('Visibility timeout expired');

      // Claim again (attempts becomes 2 == maxAttempts)
      const [claimedAgain] = await app.queue.claim('lease-recovery-test', 30, 1);
      expect(claimedAgain.id).toBe(job.id);
      expect(claimedAgain.attempts).toBe(2);

      // Expire lease again when attempts >= maxAttempts -> should mark as dead_letter
      await app.queue.touch(job.id, -10);
      await app.queue.reclaimOrphaned('lease-recovery-test');

      const exhaustedJob = (await app.queue.getJob(job.id))!;
      expect(exhaustedJob.status).toBe('dead_letter');
    });

    it('should support retry with backoff and Dead Letter Queue (DLQ) routing + replay', async () => {
      await app.queue.upsertQueue({
        name: 'orders-dlq',
        concurrency: 5,
      });

      await app.queue.upsertQueue({
        name: 'orders-main',
        concurrency: 5,
        maxAttempts: 2,
        backoffDelayMs: 0,
        deadLetterQueue: 'orders-dlq',
      });

      const job = await app.queue.send('orders-main', { orderId: 'ORD-500' });

      // Attempt 1 -> fail -> requeued (backoffDelayMs = 0)
      const [attempt1] = await app.queue.claim('orders-main', 30, 1);
      expect(attempt1.id).toBe(job.id);
      const failRes1 = await app.queue.fail(job.id, 'Transient gateway timeout', 0);
      expect(failRes1.retried).toBe(true);
      expect(failRes1.deadLettered).toBe(false);

      // Attempt 2 -> fail -> exhausted maxAttempts (2) -> dead_letter + copy in orders-dlq
      const [attempt2] = await app.queue.claim('orders-main', 30, 1);
      expect(attempt2.id).toBe(job.id);
      const failRes2 = await app.queue.fail(job.id, 'Permanent card decline', 0);
      expect(failRes2.retried).toBe(false);
      expect(failRes2.deadLettered).toBe(true);

      const mainJobAfterFail = (await app.queue.getJob(job.id))!;
      expect(mainJobAfterFail.status).toBe('dead_letter');

      const dlqJobs = await app.queue.getJobs({ queue: 'orders-dlq' });
      expect(dlqJobs.items.length).toBe(1);
      expect(dlqJobs.items[0].status).toBe('queued');
      expect(dlqJobs.items[0].payload.originalJobId).toBe(job.id);
      expect(dlqJobs.items[0].payload.payload).toEqual({ orderId: 'ORD-500' });

      // Replay dead_letter jobs in orders-main
      const replayed = await app.queue.retryDeadLetterJobs('orders-main');
      expect(replayed).toBe(1);

      const resetMainJob = (await app.queue.getJob(job.id))!;
      expect(resetMainJob.status).toBe('queued');
      expect(resetMainJob.attempts).toBe(0);
    });

    it('should return per-claim token and prevent late worker operations from overwriting subsequent claim attempts', async () => {
      const q = 'claim-token-test-queue';
      await app.queue.upsertQueue({ name: q, concurrency: 1, maxAttempts: 3 });

      const job = await app.queue.send(q, { task: 'stale-worker-test' });

      // Worker A claims the job with a 1-second visibility lease
      const [claimA] = await app.queue.claim(q, 1, 1, 'worker_A');
      expect(claimA.id).toBe(job.id);
      expect(claimA.claimToken).toBeDefined();
      expect(typeof claimA.claimToken).toBe('string');
      const tokenA = claimA.claimToken!;

      // Wait 1.1s for Worker A's lease to expire
      await new Promise((r) => setTimeout(r, 1100));

      // Reclaim expired lease
      const reclaimed = await app.queue.reclaimOrphaned(q);
      expect(reclaimed).toBe(1);

      // Worker B claims the retried job
      const [claimB] = await app.queue.claim(q, 30, 1, 'worker_B');
      expect(claimB.id).toBe(job.id);
      expect(claimB.claimToken).toBeDefined();
      expect(claimB.claimToken).not.toBe(tokenA);
      const tokenB = claimB.claimToken!;

      // Worker A finishes late and tries to touch, fail, or complete Worker B's job attempt
      const lateTouch = await app.queue.touch(job.id, 60, tokenA);
      expect(lateTouch).toBe(false);

      const lateFail = await app.queue.fail(job.id, 'Stale failure from Worker A', undefined, tokenA);
      expect(lateFail.attempts).toBe(0);

      const lateComplete = await app.queue.complete(job.id, { from: 'stale_worker_A' }, tokenA);
      expect(lateComplete).toBe(false);

      // Verify Worker B's claim is still intact and 'processing'
      const activeJob = (await app.queue.getJob(job.id))!;
      expect(activeJob.status).toBe('processing');
      expect(activeJob.claimedBy).toBe('worker_B');
      expect(activeJob.claimToken).toBe(tokenB);

      // Worker B successfully completes its attempt
      const validComplete = await app.queue.complete(job.id, { from: 'worker_B' }, tokenB);
      expect(validComplete).toBe(true);

      const completedJob = (await app.queue.getJob(job.id))!;
      expect(completedJob.status).toBe('completed');
      expect(completedJob.result).toEqual({ from: 'worker_B' });
      expect(completedJob.claimToken).toBeNull();
    });

    it('should restrict fail() to processing jobs and prevent late or repeated NACKs from mutating completed or dead-lettered jobs', async () => {
      const q = 'terminal-nack-test-queue';
      const dlq = 'terminal-nack-dlq';
      await app.queue.upsertQueue({ name: dlq, concurrency: 1 });
      await app.queue.upsertQueue({ name: q, concurrency: 1, maxAttempts: 2, deadLetterQueue: dlq });

      // 1. Completed job cannot be failed / NACKed
      const job1 = await app.queue.send(q, { test: 'completed-nack-test' });
      await app.queue.claim(q, 30, 1);
      await app.queue.complete(job1.id, { done: true });

      const verifiedCompleted = (await app.queue.getJob(job1.id))!;
      expect(verifiedCompleted.status).toBe('completed');

      // Attempting to fail the completed job (with or without claimToken) must be rejected
      const failCompleted = await app.queue.fail(job1.id, 'Late failure on completed job');
      expect(failCompleted.attempts).toBe(0);
      expect(failCompleted.retried).toBe(false);
      expect(failCompleted.deadLettered).toBe(false);

      // Verify the job remains 'completed' and was NOT requeued
      const stillCompleted = (await app.queue.getJob(job1.id))!;
      expect(stillCompleted.status).toBe('completed');
      expect(stillCompleted.error).toBeNull();

      // 2. Dead-lettered job cannot be failed again to create duplicate DLQ copies
      const job2 = await app.queue.send(q, { test: 'dlq-duplicate-nack-test' });
      await app.queue.claim(q, 30, 1);
      // Attempt 1 fails (0ms backoff) -> immediately claimable for retry
      const res1 = await app.queue.fail(job2.id, 'Failure 1', 0);
      expect(res1.retried).toBe(true);

      const [claim2] = await app.queue.claim(q, 30, 1);
      expect(claim2.id).toBe(job2.id);
      expect(claim2.attempts).toBe(2);

      // Attempt 2 fails -> exhausts maxAttempts -> moves to dead_letter
      const res2 = await app.queue.fail(job2.id, 'Failure 2');
      expect(res2.deadLettered).toBe(true);

      const dlqJobsBefore = await app.queue.getJobs({ queue: dlq });
      expect(dlqJobsBefore.items.length).toBe(1);

      // Attempt a repeated / late NACK on the already dead-lettered job
      const repeatFail = await app.queue.fail(job2.id, 'Repeated failure after DLQ');
      expect(repeatFail.attempts).toBe(0);
      expect(repeatFail.retried).toBe(false);
      expect(repeatFail.deadLettered).toBe(false);

      // Verify no duplicate copies were inserted into the DLQ
      const dlqJobsAfter = await app.queue.getJobs({ queue: dlq });
      expect(dlqJobsAfter.items.length).toBe(1);

      // 3. Unclaimed 'queued' job cannot be failed
      const job3 = await app.queue.send(q, { test: 'queued-nack-test' });
      const failQueued = await app.queue.fail(job3.id, 'Nack without claiming');
      expect(failQueued.attempts).toBe(0);
      const stillQueued = (await app.queue.getJob(job3.id))!;
      expect(stillQueued.status).toBe('queued');
    });
  });

  describe('2. Direct O(1) Map Worker Registry & Concurrency Enforcement', () => {
    it('should register 120 queue workers in the O(1) Map without EventEmitter warnings and process jobs concurrently within limits', async () => {
      // Register 120 distinct queues and workers to verify O(1) Map scalability
      for (let i = 0; i < 120; i++) {
        const qName = `scale-queue-${i}`;
        await app.queue.upsertQueue({ name: qName, concurrency: 2 });
        app.queue.registerWorker(qName, async () => {
          return { index: i };
        });
      }
      expect(app.queue.getWorkerCount()).toBeGreaterThanOrEqual(120);

      // Test concurrency limit on a dedicated worker queue
      const concQueue = 'concurrency-cap-queue';
      await app.queue.upsertQueue({ name: concQueue, concurrency: 3 });

      let activeWorkers = 0;
      let maxObservedWorkers = 0;
      const processedSeqs: number[] = [];

      let resolveAllDone!: () => void;
      const allDonePromise = new Promise<void>((resolve) => {
        resolveAllDone = resolve;
      });

      app.queue.registerWorker(concQueue, async (job) => {
        activeWorkers++;
        if (activeWorkers > maxObservedWorkers) {
          maxObservedWorkers = activeWorkers;
        }
        await new Promise((r) => setTimeout(r, 25));
        processedSeqs.push(job.payload.seq);
        activeWorkers--;
        if (processedSeqs.length === 15) {
          resolveAllDone();
        }
        return { done: job.payload.seq };
      });

      // Enqueue 15 jobs simultaneously
      const dtos = Array.from({ length: 15 }, (_, idx) => ({
        queue: concQueue,
        payload: { seq: idx + 1 },
      }));
      await app.queue.sendBatch(dtos);

      await allDonePromise;
      // Wait briefly for final complete() calls to settle
      await new Promise((r) => setTimeout(r, 30));

      expect(maxObservedWorkers).toBeLessThanOrEqual(3);
      expect(maxObservedWorkers).toBeGreaterThanOrEqual(2);
      expect(processedSeqs.length).toBe(15);

      const stats = await app.queue.getStats(concQueue);
      expect(stats.completed).toBe(15);
      expect(stats.queued).toBe(0);
      expect(stats.processing).toBe(0);
    });

    it('should schedule delayed jobs accurately via precision timer without polling delay', async () => {
      const delayedQueue = 'delayed-timer-queue';
      await app.queue.upsertQueue({ name: delayedQueue, concurrency: 1 });

      let completedAt = 0;
      const enqueuedAt = Date.now();

      const donePromise = new Promise<void>((resolve) => {
        app.queue.registerWorker(delayedQueue, async () => {
          completedAt = Date.now();
          resolve();
          return { delayedRun: true };
        });
      });

      await app.queue.send(delayedQueue, { hello: 'future' }, { delaySeconds: 1 });

      // Immediately after send, job is queued but not visible yet
      const immediateClaim = await app.queue.claim(delayedQueue, 30, 1);
      expect(immediateClaim.length).toBe(0);

      await donePromise;
      const elapsed = completedAt - enqueuedAt;
      expect(elapsed).toBeGreaterThanOrEqual(850);
      expect(elapsed).toBeLessThan(3500);
    });
  });

  describe('3. Serverless Function Worker Binding (targetFunction) & QuickJS ctx.queue Bridge', () => {
    it('should automatically execute bound targetFunction in QuickJS sandbox when jobs arrive on queue', async () => {
      // Create a collection to store processed records from the queue worker function
      app.schema.createCollection({
        name: 'webhook_deliveries',
        type: 'base',
        schema: [
          { id: 'f_evt', name: 'event', type: 'text', required: true },
          { id: 'f_job', name: 'jobId', type: 'text', required: true },
        ],
      });

      app.functions.createFunction({
        name: 'queue-worker-fn',
        code: `
          export default async function(core, context) {
            const body = context.request.body;
            const jobId = context.request.headers['x-queue-job-id'];
            const record = await core.sdk.collection('webhook_deliveries').create({
              event: body.eventName,
              jobId: jobId
            });
            return { deliveredId: record.id, handledEvent: body.eventName };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: true,
        env: {},
      });

      await app.queue.upsertQueue({
        name: 'bound-fn-queue',
        concurrency: 2,
        maxAttempts: 2,
        targetFunction: 'queue-worker-fn',
      });

      const job = await app.queue.send('bound-fn-queue', { eventName: 'user.signup' });

      // Poll until job reaches completed
      let finalJob = await app.queue.getJob(job.id);
      for (let i = 0; i < 40; i++) {
        if (finalJob?.status === 'completed' || finalJob?.status === 'failed') break;
        await new Promise((r) => setTimeout(r, 50));
        finalJob = await app.queue.getJob(job.id);
      }

      expect(finalJob?.status).toBe('completed');
      expect(finalJob?.result?.handledEvent).toBe('user.signup');

      // Verify record was created in webhook_deliveries
      const records = await app.records.getList('webhook_deliveries', {}, { isAdmin: true });
      expect(records.items.length).toBe(1);
      expect(records.items[0].event).toBe('user.signup');
      expect(records.items[0].jobId).toBe(job.id);

      // Verify function execution log was recorded with trigger 'queue:bound-fn-queue'
      const fnDef = app.functions.getFunctionByName('queue-worker-fn')!;
      const logsRes = app.functions.getLogs(fnDef.id);
      expect(logsRes.items.some((l) => l.trigger === 'queue:bound-fn-queue' && l.status === 'success')).toBe(true);
    });

    it('should enforce RuleEngine collection access rules when targetFunction has elevated: false', async () => {
      // Create a collection with admin-only createRule (null = admin only)
      app.schema.createCollection({
        name: 'admin_only_vault',
        type: 'base',
        schema: [
          { id: 'f_key', name: 'secretKey', type: 'text', required: true },
        ],
        createRule: null, // Only admin can create
        listRule: null,   // Only admin can read
      });

      // 1. Create a non-elevated worker function (elevated: false)
      app.functions.createFunction({
        name: 'non-elevated-worker-fn',
        code: `
          export default async function(core, context) {
            const res = await core.sdk.collection('admin_only_vault').create({
              secretKey: context.request.body.secretKey
            });
            return { success: true, id: res.id };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        elevated: false,
      });

      await app.queue.upsertQueue({
        name: 'non-elevated-queue',
        concurrency: 1,
        maxAttempts: 1,
        targetFunction: 'non-elevated-worker-fn',
      });

      const failedJob = await app.queue.send('non-elevated-queue', { secretKey: 'hacked_secret' });

      // Poll until finished
      let j = await app.queue.getJob(failedJob.id);
      for (let i = 0; i < 40; i++) {
        if (j?.status === 'completed' || j?.status === 'failed' || j?.status === 'dead_letter') break;
        await new Promise((r) => setTimeout(r, 50));
        j = await app.queue.getJob(failedJob.id);
      }

      // The non-elevated function threw error because it lacks admin privileges
      expect(j?.status).toBe('dead_letter');
      expect(j?.error).toMatch(/admin|forbidden|access|rule/i);

      // Verify no records were inserted into admin_only_vault
      const vaultCount = app.db.prepare('SELECT COUNT(*) as cnt FROM admin_only_vault').get() as { cnt: number };
      expect(vaultCount.cnt).toBe(0);

      // 2. Now test elevated: true function - it SHOULD succeed with service role
      app.functions.createFunction({
        name: 'elevated-worker-fn',
        code: `
          export default async function(core, context) {
            const res = await core.sdk.collection('admin_only_vault').create({
              secretKey: context.request.body.secretKey
            });
            return { success: true, id: res.id };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        elevated: true,
      });

      await app.queue.upsertQueue({
        name: 'elevated-queue',
        concurrency: 1,
        maxAttempts: 1,
        targetFunction: 'elevated-worker-fn',
      });

      const successJob = await app.queue.send('elevated-queue', { secretKey: 'legit_secret' });

      j = await app.queue.getJob(successJob.id);
      for (let i = 0; i < 40; i++) {
        if (j?.status === 'completed' || j?.status === 'failed' || j?.status === 'dead_letter') break;
        await new Promise((r) => setTimeout(r, 50));
        j = await app.queue.getJob(successJob.id);
      }

      expect(j?.status).toBe('completed');
      expect(j?.result?.success).toBe(true);
    });

    it('should block deleting a Serverless Function while a Queue is bound to it via targetFunction', () => {
      const fnDef = app.functions.getFunctionByName('queue-worker-fn')!;
      expect(() => app.functions.deleteFunction(fnDef.id)).toThrowError(
        /bound as targetFunction by 1 queue/i
      );
    });

    it('should coordinate claiming with available function capacity and defer capacity-rejected jobs without consuming execution attempts', async () => {
      const originalMaxConcurrent = app.functions.getMaxConcurrent();
      // Set function capacity to 2
      (app.functions as any).maxConcurrent = 2;

      app.functions.createFunction({
        name: 'capacity-worker-fn',
        code: `
          export default async function(core, context) {
            const start = Date.now();
            while (Date.now() - start < 80) {}
            return { processed: true, item: context.request.body.item };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: true,
        env: {},
      });

      // Create queue with high concurrency (10) relative to function capacity (2) and strict maxAttempts = 1
      await app.queue.upsertQueue({
        name: 'capacity-coordinated-queue',
        concurrency: 10,
        maxAttempts: 1,
        targetFunction: 'capacity-worker-fn',
      });

      // Enqueue 5 jobs
      const jobs = await Promise.all([
        app.queue.send('capacity-coordinated-queue', { item: 1 }),
        app.queue.send('capacity-coordinated-queue', { item: 2 }),
        app.queue.send('capacity-coordinated-queue', { item: 3 }),
        app.queue.send('capacity-coordinated-queue', { item: 4 }),
        app.queue.send('capacity-coordinated-queue', { item: 5 }),
      ]);

      // All 5 jobs must succeed despite maxAttempts = 1 (no jobs prematurely dead-lettered by 429)
      await vi.waitFor(async () => {
        const statuses = await Promise.all(jobs.map((j) => app.queue.getJob(j.id)));
        const allCompleted = statuses.every((s) => s?.status === 'completed');
        expect(allCompleted).toBe(true);
      }, { timeout: 6000, interval: 50 });

      // Verify each completed job consumed at most 1 attempt
      const completedJobs = await Promise.all(jobs.map((j) => app.queue.getJob(j.id)));
      for (const cj of completedJobs) {
        expect(cj?.status).toBe('completed');
        expect(cj?.attempts).toBe(1);
      }

      // Verify deferral behavior directly rolls back attempt count
      const testJob = await app.queue.send('capacity-coordinated-queue', { item: 'defer-test' });
      const [claimed] = await app.queue.claim('capacity-coordinated-queue', 30, 1);
      expect(claimed.id).toBe(testJob.id);
      expect(claimed.attempts).toBe(1);

      // Deferring the job rolls back attempts from 1 to 0 and returns status to queued
      const deferred = await app.queue.defer(testJob.id, 50, 'Capacity limit reached');
      expect(deferred).toBe(true);

      const afterDefer = (await app.queue.getJob(testJob.id))!;
      expect(afterDefer.status).toBe('queued');
      expect(afterDefer.attempts).toBe(0);
      expect(afterDefer.error).toContain('Capacity limit reached');

      // Restore original function capacity
      (app.functions as any).maxConcurrent = originalMaxConcurrent;
    });

    it('should allow Serverless Functions inside QuickJS-Wasm to enqueue and inspect jobs via core.sdk.queue', async () => {
      app.functions.createFunction({
        name: 'producer-fn',
        code: `
          export default async function(core, context) {
            const enqueued = await core.sdk.queue('producer-target-queue').send({
              fromSandbox: true,
              value: context.request.body.value
            }, { priority: 7 });

            const fetched = await core.sdk.queue('producer-target-queue').getJob(enqueued.id);
            return {
              enqueuedId: enqueued.id,
              fetchedPriority: fetched.priority,
              fetchedPayload: fetched.payload
            };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const execResult = await app.functions.executeFunction('producer-fn', {
        method: 'POST',
        path: '/api/functions/producer-fn',
        headers: {},
        query: {},
        body: { value: 42 },
      });

      expect(execResult.statusCode).toBe(200);
      expect(execResult.body.enqueuedId).toBeDefined();
      expect(execResult.body.fetchedPriority).toBe(7);
      expect(execResult.body.fetchedPayload).toEqual({ fromSandbox: true, value: 42 });

      // Also verify that QuickJS sandbox blocks _system:* queues
      app.functions.createFunction({
        name: 'illegal-system-queue-fn',
        code: `
          export default async function(core, context) {
            return await core.sdk.queue('_system:flow:hack').send({ bad: true });
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const sysResult = await app.functions.executeFunction('illegal-system-queue-fn', {
        method: 'POST',
        path: '/api/functions/illegal-system-queue-fn',
        headers: {},
        query: {},
        body: {},
      });
      expect(sysResult.statusCode).toBe(500);
      expect(JSON.stringify(sysResult.error || sysResult.body)).toContain('reserved _system:* queues');

      // Also verify that complete(), fail(), and getJob() reject mutating/inspecting _system:* jobs
      await app.queue.upsertQueue({ name: '_system:flow:tamper_test', concurrency: 1, isSystem: true });
      const systemJob = await app.queue.send('_system:flow:tamper_test', { flowData: 123 });

      app.functions.createFunction({
        name: 'system-tamper-fn',
        code: `
          export default async function(core, context) {
            const op = context.request.body.op;
            const jobId = context.request.body.jobId;

            if (op === 'complete') {
              return await core.sdk.queue('custom').complete(jobId, { hacked: true });
            }
            if (op === 'fail') {
              return await core.sdk.queue('custom').fail(jobId, 'hack fail');
            }
            if (op === 'getJob') {
              return await core.sdk.queue('custom').getJob(jobId);
            }
            return { ok: true };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      // complete() on _system:* job must throw
      const completeRes = await app.functions.executeFunction('system-tamper-fn', {
        method: 'POST',
        path: '/api/functions/system-tamper-fn',
        headers: {},
        query: {},
        body: { op: 'complete', jobId: systemJob.id },
      });
      expect(completeRes.statusCode).toBe(500);
      expect(JSON.stringify(completeRes.error || completeRes.body)).toMatch(/reserved _system:\* queues/i);

      // fail() on _system:* job must throw
      const failRes = await app.functions.executeFunction('system-tamper-fn', {
        method: 'POST',
        path: '/api/functions/system-tamper-fn',
        headers: {},
        query: {},
        body: { op: 'fail', jobId: systemJob.id },
      });
      expect(failRes.statusCode).toBe(500);
      expect(JSON.stringify(failRes.error || failRes.body)).toMatch(/reserved _system:\* queues/i);

      // getJob() on _system:* job must return null (redacted)
      const getRes = await app.functions.executeFunction('system-tamper-fn', {
        method: 'POST',
        path: '/api/functions/system-tamper-fn',
        headers: {},
        query: {},
        body: { op: 'getJob', jobId: systemJob.id },
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.body).toBeNull();

      // Ensure the system job remained completely intact and queued
      const untouchedJob = await app.queue.getJob(systemJob.id);
      expect(untouchedJob?.status).toBe('queued');
      expect(untouchedJob?.error).toBeNull();

      // Clean up the temporary system job and queue so it doesn't affect subsequent tests
      await app.queue.cancel(systemJob.id);
      await app.queue.deleteQueue('_system:flow:tamper_test');

      // Test that untyped options in core.sdk.queue cannot override queue name to target reserved system queues
      app.functions.createFunction({
        name: 'options-override-tamper-fn',
        code: `
          export default async function(core, context) {
            return await core.sdk.queue('ordinary-producer-queue').send(
              { hello: 'world' },
              { queue: '_system:flow:evil_override' }
            );
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: false,
        env: {},
      });

      const overrideRes = await app.functions.executeFunction('options-override-tamper-fn', {
        method: 'POST',
        path: '/api/functions/options-override-tamper-fn',
        headers: {},
        query: {},
        body: {},
      });
      expect(overrideRes.statusCode).toBe(500);
      expect(JSON.stringify(overrideRes.error || overrideRes.body)).toMatch(/reserved _system:\* queues/i);

      // Verify that direct QueueService.send also applies options first so queue cannot be overwritten
      const directJob = await app.queue.send('ordinary-producer-queue', { direct: true }, { queue: '_system:flow:direct_evil' } as any);
      expect(directJob.queue).toBe('ordinary-producer-queue');
      await app.queue.cancel(directJob.id);
    });
  });

  describe('4. Retention Pruning & Queue REST API (/api/queues/*)', () => {
    it('should prune completed/failed jobs older than retentionDays while preserving active and recent jobs', async () => {
      await app.queue.upsertQueue({ name: 'retention-test-queue', concurrency: 5 });

      const oldJob = await app.queue.send('retention-test-queue', { age: 'old' });
      const recentJob = await app.queue.send('retention-test-queue', { age: 'recent' });
      const activeJob = await app.queue.send('retention-test-queue', { age: 'queued' });

      await app.queue.claim('retention-test-queue', 30, 2);
      await app.queue.complete(oldJob.id);
      await app.queue.complete(recentJob.id);

      // Backdate oldJob finishedAt & updated to 10 days ago
      const tenDaysAgo = new Date(Date.now() - 10 * 86400 * 1000).toISOString();
      app.db
        .prepare('UPDATE _queue_jobs SET finishedAt = ?, updated = ? WHERE id = ?')
        .run(tenDaysAgo, tenDaysAgo, oldJob.id);

      const deleted = await app.queue.cleanup(7);
      expect(deleted).toBeGreaterThanOrEqual(1);

      expect(await app.queue.getJob(oldJob.id)).toBeNull();
      expect(await app.queue.getJob(recentJob.id)).not.toBeNull();
      expect(await app.queue.getJob(activeJob.id)).not.toBeNull();
    });

    it('should recover mid-flight processing jobs and drain pending targetFunction queues from SQLite on server restart without in-memory worker maps', async () => {
      // Create a queue bound to targetFunction 'queue-worker-fn'
      await app.queue.upsertQueue({
        name: 'crash-restart-queue',
        concurrency: 2,
        maxAttempts: 3,
        targetFunction: 'queue-worker-fn',
      });

      // Clear any previous webhook_deliveries
      const existing = await app.records.getList('webhook_deliveries', {}, { isAdmin: true });
      for (const item of existing.items) {
        await app.records.delete('webhook_deliveries', item.id, { isAdmin: true });
      }

      // Directly insert:
      // 1. An expired 'processing' job (simulating an orphaned job from a crashed node whose lease expired)
      // 2. An active 'processing' job with a valid future lease (simulating an external HTTP worker or second node)
      // 3. A 'queued' job on disk
      const expiredLease = new Date(Date.now() - 5000).toISOString();
      const futureLease = new Date(Date.now() + 300000).toISOString();
      const nowIso = new Date().toISOString();
      app.db
        .prepare(`
          INSERT INTO _queue_jobs (
            id, queue, groupKey, status, payload, result, error,
            attempts, maxAttempts, priority, availableAt, claimedBy,
            leaseExpiresAt, deduplicationId, created, updated, finishedAt
          ) VALUES (?, ?, NULL, 'processing', ?, NULL, NULL, 1, 3, 0, ?, 'crashed_worker', ?, NULL, ?, ?, NULL)
        `)
        .run(
          'job_crashed_midflight',
          'crash-restart-queue',
          JSON.stringify({ eventName: 'recovered.from.crash' }),
          nowIso,
          expiredLease,
          nowIso,
          nowIso
        );

      app.db
        .prepare(`
          INSERT INTO _queue_jobs (
            id, queue, groupKey, status, payload, result, error,
            attempts, maxAttempts, priority, availableAt, claimedBy,
            leaseExpiresAt, deduplicationId, created, updated, finishedAt
          ) VALUES (?, ?, NULL, 'processing', ?, NULL, NULL, 1, 3, 0, ?, 'active_external_worker', ?, NULL, ?, ?, NULL)
        `)
        .run(
          'job_active_external_consumer',
          'crash-restart-queue',
          JSON.stringify({ eventName: 'still.running.externally' }),
          nowIso,
          futureLease,
          nowIso,
          nowIso
        );

      app.db
        .prepare(`
          INSERT INTO _queue_jobs (
            id, queue, groupKey, status, payload, result, error,
            attempts, maxAttempts, priority, availableAt, claimedBy,
            leaseExpiresAt, deduplicationId, created, updated, finishedAt
          ) VALUES (?, ?, NULL, 'queued', ?, NULL, NULL, 0, 3, 0, ?, NULL, NULL, NULL, ?, ?, NULL)
        `)
        .run(
          'job_pending_on_disk',
          'crash-restart-queue',
          JSON.stringify({ eventName: 'drained.on.boot' }),
          nowIso,
          nowIso,
          nowIso
        );

      // Simulate server restart by calling app.queue.start()
      await app.queue.start();

      // Poll until the expired and pending jobs complete
      for (let i = 0; i < 40; i++) {
        const j1 = await app.queue.getJob('job_crashed_midflight');
        const j2 = await app.queue.getJob('job_pending_on_disk');
        if (j1?.status === 'completed' && j2?.status === 'completed') break;
        await new Promise((r) => setTimeout(r, 50));
      }

      const finalJ1 = await app.queue.getJob('job_crashed_midflight');
      const finalJ2 = await app.queue.getJob('job_pending_on_disk');
      expect(finalJ1?.status).toBe('completed');
      expect(finalJ1?.attempts).toBe(2); // Reclaimed from attempt 1 and completed on attempt 2
      expect(finalJ2?.status).toBe('completed');

      // The job with a valid future lease must NOT have been reclaimed on startup
      const activeJob = await app.queue.getJob('job_active_external_consumer');
      expect(activeJob?.status).toBe('processing');
      expect(activeJob?.claimedBy).toBe('active_external_worker');
      expect(activeJob?.attempts).toBe(1); // Not incremented or requeued

      await app.queue.cancel('job_active_external_consumer');

      const deliveries = await app.records.getList('webhook_deliveries', {}, { isAdmin: true });
      const events = deliveries.items.map((d: any) => d.event);
      expect(events).toContain('recovered.from.crash');
      expect(events).toContain('drained.on.boot');
    });

    it('should recreate missing queue tables and indexes on init() after database replacement (pre-queue snapshot restore)', async () => {
      // Simulate database replacement by dropping the queue tables from SQLite
      app.db.exec(`
        DROP TABLE IF EXISTS _queue_jobs;
        DROP TABLE IF EXISTS _queues;
      `);

      // Verify tables no longer exist
      const checkTables = () => {
        return app.db.prepare(`
          SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name IN ('_queues', '_queue_jobs')
        `).get() as { cnt: number };
      };
      expect(checkTables().cnt).toBe(0);

      // Re-run idempotent init() (e.g. called by queue.start() on snapshot restore)
      await app.queue.getDriver().init();

      // Tables and indexes must now exist
      expect(checkTables().cnt).toBe(2);

      // Operations continue to succeed
      await app.queue.upsertQueue({ name: 'restored-schema-queue', concurrency: 1 });
      const testJob = await app.queue.send('restored-schema-queue', { alive: true });
      expect(testJob.id).toBeDefined();
    });

    it('should expose full CRUD, message enqueue/poll/ack/nack via REST API and return 403 for _system:* queues', async () => {
      const headers = {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      };

      // 1. Create queue via POST /api/queues
      const createRes = await fetch(`${baseUrl}/api/queues`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'rest-api-queue',
          concurrency: 4,
          maxAttempts: 3,
        }),
      });
      expect(createRes.status).toBe(201);
      const createdQueue = await createRes.json();
      expect(createdQueue.name).toBe('rest-api-queue');
      expect(createdQueue.concurrency).toBe(4);

      // 1b. Support null / 0 / blank concurrency as unbounded (0)
      const unboundedRes = await fetch(`${baseUrl}/api/queues`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'unbounded-null-queue',
          concurrency: null,
        }),
      });
      expect(unboundedRes.status).toBe(201);
      const unboundedQueue = await unboundedRes.json();
      expect(unboundedQueue.concurrency).toBe(0);

      // 1c. Support string numbers in JSON (e.g. "6") and reject negative
      const stringConcRes = await fetch(`${baseUrl}/api/queues`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'string-conc-queue',
          concurrency: '6',
        }),
      });
      expect(stringConcRes.status).toBe(201);
      const stringConcQueue = await stringConcRes.json();
      expect(stringConcQueue.concurrency).toBe(6);

      const invalidConcRes = await fetch(`${baseUrl}/api/queues`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'invalid-conc-queue',
          concurrency: -2,
        }),
      });
      expect(invalidConcRes.status).toBe(400);

      // 2. Reject _system:* manipulation via REST API with 403 Forbidden
      const forbiddenRes = await fetch(`${baseUrl}/api/queues/_system:flow:123/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ payload: { hack: true } }),
      });
      expect(forbiddenRes.status).toBe(403);

      // 3. Enqueue message via POST /api/queues/:name/messages
      const sendRes = await fetch(`${baseUrl}/api/queues/rest-api-queue/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          payload: { task: 'resize-image', file: 'avatar.png' },
          priority: 5,
        }),
      });
      expect(sendRes.status).toBe(201);
      const sentJob = await sendRes.json();
      expect(sentJob.id).toBeDefined();
      expect(sentJob.status).toBe('queued');

      // 4. Claim message via GET /api/queues/:name/messages?limit=1
      const claimRes = await fetch(`${baseUrl}/api/queues/rest-api-queue/messages?limit=1`, {
        method: 'GET',
        headers,
      });
      expect(claimRes.status).toBe(200);
      const claimedItems = await claimRes.json();
      expect(Array.isArray(claimedItems)).toBe(true);
      expect(claimedItems.length).toBe(1);
      expect(claimedItems[0].id).toBe(sentJob.id);
      expect(claimedItems[0].status).toBe('processing');

      // 5. Complete message via POST /api/queues/:name/jobs/:id/ack
      const ackRes = await fetch(`${baseUrl}/api/queues/rest-api-queue/jobs/${sentJob.id}/ack`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ result: { resized: true } }),
      });
      expect(ackRes.status).toBe(200);
      const ackData = await ackRes.json();
      expect(ackData.success).toBe(true);
      expect(ackData.job.status).toBe('completed');

      // 6. Inspect queue stats via GET /api/queues/:name
      const detailRes = await fetch(`${baseUrl}/api/queues/rest-api-queue`, {
        method: 'GET',
        headers,
      });
      expect(detailRes.status).toBe(200);
      const detailData = await detailRes.json();
      expect(detailData.stats.completed).toBe(1);

      // 7. Inspect single job via GET /api/queues/jobs/:id
      const jobRes = await fetch(`${baseUrl}/api/queues/jobs/${sentJob.id}`, {
        method: 'GET',
        headers,
      });
      expect(jobRes.status).toBe(200);
      const jobData = await jobRes.json();
      expect(jobData.id).toBe(sentJob.id);
      expect(jobData.status).toBe('completed');

      // 8. List jobs via GET /api/queues/jobs with and without includeSystem
      const sysJob = await (app.queue as any).driver.send({
        queue: '_system:flow:test',
        payload: { internal: true },
      });

      // Default GET /api/queues/jobs must exclude _system:* jobs
      const defaultJobsRes = await fetch(`${baseUrl}/api/queues/jobs?perPage=100`, { headers });
      expect(defaultJobsRes.status).toBe(200);
      const defaultJobs = await defaultJobsRes.json();
      expect(defaultJobs.items.some((j: any) => j.queue.startsWith('_system:'))).toBe(false);

      // GET /api/queues/jobs?includeSystem=true must include _system:* jobs
      const systemJobsRes = await fetch(`${baseUrl}/api/queues/jobs?includeSystem=true&perPage=100`, { headers });
      expect(systemJobsRes.status).toBe(200);
      const systemJobs = await systemJobsRes.json();
      expect(systemJobs.items.some((j: any) => j.queue === '_system:flow:test')).toBe(true);
      expect(systemJobs.total).toBe(defaultJobs.total + 1);

      // 9. Cross-Queue Isolation & System Queue Mutation Guard:
      // An ordinary queue URL cannot ACK, NACK, touch, or inspect a job from another/system queue
      const crossAckRes = await fetch(`${baseUrl}/api/queues/rest-api-queue/messages/${sysJob.id}/ack`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ result: { evil: true } }),
      });
      expect(crossAckRes.status).toBe(404);

      const crossNackRes = await fetch(`${baseUrl}/api/queues/rest-api-queue/messages/${sysJob.id}/nack`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ error: 'evil nack' }),
      });
      expect(crossNackRes.status).toBe(404);

      const crossTouchRes = await fetch(`${baseUrl}/api/queues/rest-api-queue/messages/${sysJob.id}/touch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ extensionSeconds: 60 }),
      });
      expect(crossTouchRes.status).toBe(404);

      const crossGetRes = await fetch(`${baseUrl}/api/queues/rest-api-queue/messages/${sysJob.id}`, {
        method: 'GET',
        headers,
      });
      expect(crossGetRes.status).toBe(404);

      // Direct operations on reserved _system:* queues via REST API must return 403 Forbidden
      const sysTouchRes = await fetch(`${baseUrl}/api/queues/_system:flow:test/messages/${sysJob.id}/touch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      expect(sysTouchRes.status).toBe(403);

      const sysAckRes = await fetch(`${baseUrl}/api/queues/_system:flow:test/messages/${sysJob.id}/ack`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      expect(sysAckRes.status).toBe(403);

      const sysNackRes = await fetch(`${baseUrl}/api/queues/_system:flow:test/messages/${sysJob.id}/nack`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      expect(sysNackRes.status).toBe(403);

      const sysRetryDlqRes = await fetch(`${baseUrl}/api/queues/_system:flow:test/dlq/retry`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      expect(sysRetryDlqRes.status).toBe(403);

      const sysGetRes = await fetch(`${baseUrl}/api/queues/_system:flow:test/messages/${sysJob.id}`, {
        method: 'GET',
        headers,
      });
      expect(sysGetRes.status).toBe(403);

      await (app.queue as any).driver.cancel(sysJob.id);
    });

    it('should render the Queues Manager in Admin UI (nav-queues, create/configure queue modal, send message modal, and job inspector)', async () => {
      const htmlPath = path.resolve(__dirname, '../dist/admin/ui/index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      const dom = new JSDOM(htmlContent, {
        runScripts: 'dangerously',
        resources: 'usable',
        url: `${baseUrl}/_/`,
      });
      const win = dom.window as any;
      const doc = win.document as Document;

      win.fetch = (url: string, opts?: any) => {
        const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
        return globalThis.fetch(fullUrl, {
          ...opts,
          headers: { ...opts?.headers, Authorization: `Bearer ${adminToken}` },
        });
      };
      win.alert = () => {};
      win.confirm = () => true;

      await new Promise((r) => setTimeout(r, 150));

      // 1. Verify sidebar nav item #nav-queues exists and navigates to #page-view-queues
      const navQueues = doc.getElementById('nav-queues');
      expect(navQueues).not.toBeNull();
      await win.selectNav('queues');
      await new Promise((r) => setTimeout(r, 150));

      const pageViewQueues = doc.getElementById('page-view-queues')!;
      expect(pageViewQueues).not.toBeNull();
      expect(pageViewQueues.style.display).toBe('block');
      expect(pageViewQueues.innerHTML).toContain('Queues Manager');

      // 2. Open Create Queue Modal and create a configured queue via UI
      await win.openCreateQueueModal();
      const nameInput = doc.getElementById('queue-input-name') as HTMLInputElement;
      const concInput = doc.getElementById('queue-input-concurrency') as HTMLInputElement;
      const attemptsInput = doc.getElementById('queue-input-max-attempts') as HTMLInputElement;
      expect(nameInput).not.toBeNull();

      nameInput.value = 'admin-ui-created-queue';
      concInput.value = '3';
      attemptsInput.value = '4';

      await win.submitQueueForm();
      await new Promise((r) => setTimeout(r, 150));

      expect(pageViewQueues.innerHTML).toContain('admin-ui-created-queue');
      expect(pageViewQueues.innerHTML).toContain('3 max concurrent');

      // 2b. Create another queue leaving Max Concurrency blank (unbounded)
      await win.openCreateQueueModal();
      const freshNameInput = doc.getElementById('queue-input-name') as HTMLInputElement;
      const freshConcInput = doc.getElementById('queue-input-concurrency') as HTMLInputElement;
      freshNameInput.value = 'admin-ui-blank-conc-queue';
      freshConcInput.value = ''; // left blank by user!
      await win.submitQueueForm();
      await new Promise((r) => setTimeout(r, 200));
      expect(pageViewQueues.innerHTML).toContain('admin-ui-blank-conc-queue');
      expect(pageViewQueues.innerHTML).toContain('Unbounded');

      // 3. Open Send Message Modal and enqueue a message via UI
      win.openSendMessageModal('admin-ui-created-queue');
      const payloadInput = doc.getElementById('send-msg-payload') as HTMLTextAreaElement;
      expect(payloadInput).not.toBeNull();
      payloadInput.value = JSON.stringify({ orderId: 'ord_999', source: 'admin-ui' });

      await win.submitSendQueueMessage();
      await new Promise((r) => setTimeout(r, 150));

      // 4. Switch to Job Inspector subtab and verify the enqueued job is listed
      win.inspectQueueJobs('admin-ui-created-queue');
      await new Promise((r) => setTimeout(r, 150));
      expect(pageViewQueues.innerHTML).toContain('ord_999');
    }, 20000);

    it('should support full queue lifecycle (claim, complete, fail) via core.sdk.queue inside QuickJS sandbox', async () => {
      await app.queue.upsertQueue({
        name: 'manual-worker-queue',
        concurrency: 1,
        maxAttempts: 3,
      });

      // Send 2 jobs
      const job1 = await app.queue.send('manual-worker-queue', { task: 'send_sms', to: '+123456789' });
      const job2 = await app.queue.send('manual-worker-queue', { task: 'send_email', to: 'test@example.com' });

      // Create a function that claims 1 job and completes it, and verifies context has no records or queue
      app.functions.createFunction({
        name: 'lifecycle-worker-fn',
        code: `
          export default async function(core, context) {
            // Verify strict clean break: records and queue must NOT exist on context
            const ctxHasRecords = typeof context.records !== 'undefined';
            const ctxHasQueue = typeof context.queue !== 'undefined';
            const ctxHasCore = typeof context.core !== 'undefined';

            const claimed = await core.sdk.queue('manual-worker-queue').claim({ limit: 1 });
            if (!claimed || claimed.length === 0) {
              return { status: 200, body: { claimed: 0, ctxHasRecords, ctxHasQueue, ctxHasCore } };
            }

            const item = claimed[0];
            const completed = await core.sdk.queue('manual-worker-queue').complete(item.id, { processed: true });

            return {
              status: 200,
              body: {
                claimedId: item.id,
                completed,
                ctxHasRecords,
                ctxHasQueue,
                ctxHasCore
              }
            };
          }
        `,
        enabled: true,
        authPolicy: 'public',
        methods: ['POST'],
        timeoutMs: 3000,
        memoryLimitMb: 32,
        allowedDomains: [],
        elevated: true,
        env: {},
      });

      const res = await app.functions.executeFunction('lifecycle-worker-fn', {
        method: 'POST',
        path: '/api/functions/lifecycle-worker-fn',
        headers: {},
        query: {},
        body: {},
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.claimedId).toBe(job1.id);
      expect(res.body.completed).toBe(true);
      expect(res.body.ctxHasRecords).toBe(false);
      expect(res.body.ctxHasQueue).toBe(false);
      expect(res.body.ctxHasCore).toBe(false);

      const updatedJob1 = await app.queue.getJob(job1.id);
      expect(updatedJob1?.status).toBe('completed');
    });
  });
});
