import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { NodeStackClient } from '../packages/client/src/Client';
import { runCli } from '../src/cli/cli';

describe('"Reset to Demo State" & Snapshot Demo Baseline Feature Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_demo_state_data');
  const port = 8135;
  let app: NodeStack;
  let client: NodeStackClient;
  let adminToken = '';

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDir,
      port,
      appName: 'Demo State Test App',
    });

    await app.start(port);

    // Create super admin
    await app.auth.createAdmin('presenter@nodestack.io', 'demoPassword123');
    const authRes = await app.auth.authenticateAdmin('presenter@nodestack.io', 'demoPassword123');
    adminToken = authRes.token;

    // Create client SDK instance
    client = new NodeStackClient(`http://localhost:${port}`);
    client.authStore.save(adminToken, authRes.admin);

    // Create a demo collection: "leads"
    app.schema.createCollection({
      name: 'leads',
      type: 'base',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      schema: [
        { name: 'company', type: 'text', required: true },
        { name: 'deal_size', type: 'number', required: false },
        { name: 'status', type: 'text', required: false },
      ],
    });

    // Populate initial clean demo records
    await app.records.create('leads', { company: 'Acme Corp', deal_size: 50000, status: 'negotiation' });
    await app.records.create('leads', { company: 'Globex Inc', deal_size: 120000, status: 'closed_won' });
    await app.records.create('leads', { company: 'Soylent Tech', deal_size: 35000, status: 'discovery' });
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('1. DemoService Core Unit Logic', () => {
    it('should initially report no snapshot exists', () => {
      expect(app.demo.hasSnapshot()).toBe(false);
      const status = app.demo.getStatus();
      expect(status.hasSnapshot).toBe(false);
      expect(status.snapshot).toBeNull();
    });

    it('should throw NotFoundError if attempting to reset before taking a snapshot', async () => {
      await expect(app.demo.reset()).rejects.toThrow(/No demo snapshot found/i);
    });

    it('should freeze the clean baseline state with app.demo.snapshot()', async () => {
      const snap = await app.demo.snapshot({
        name: 'Q3 Investor Pitch Demo',
        description: 'Pristine state with 3 strategic leads',
      });

      expect(snap.name).toBe('Q3 Investor Pitch Demo');
      expect(snap.description).toBe('Pristine state with 3 strategic leads');
      expect(snap.totalCollections).toBeGreaterThanOrEqual(2); // users, leads
      expect(snap.totalRecords).toBeGreaterThanOrEqual(4); // 3 leads + 1 admin
      expect(fs.existsSync(app.demo.snapshotDbPath)).toBe(true);
      expect(fs.existsSync(app.demo.snapshotMetadataPath)).toBe(true);
      expect(app.demo.hasSnapshot()).toBe(true);
    });

    it('should report pristine state with no drift immediately after snapshot', () => {
      const status = app.demo.getStatus();
      expect(status.hasSnapshot).toBe(true);
      expect(status.snapshot?.name).toBe('Q3 Investor Pitch Demo');
      expect(status.liveStats?.drift.isModified).toBe(false);
      expect(status.liveStats?.drift.recordsDelta).toBe(0);
    });

    it('should detect live changes and data mess created during client evaluation', async () => {
      // 1. Add 2 messy test records during demo
      await app.records.create('leads', { company: 'Messy Test Lead 1', deal_size: 10, status: 'trash' });
      await app.records.create('leads', { company: 'Messy Test Lead 2', deal_size: 20, status: 'trash' });

      // 2. Modify an existing record
      const allLeads = await app.records.getList('leads', { filter: 'company = "Acme Corp"' });
      expect(allLeads.items.length).toBe(1);
      await app.records.update('leads', allLeads.items[0].id, { company: 'Acme Corp (VANDALIZED)', deal_size: 1 });

      // 3. Delete a record
      const globex = await app.records.getList('leads', { filter: 'company = "Globex Inc"' });
      expect(globex.items.length).toBe(1);
      await app.records.delete('leads', globex.items[0].id);

      // Now we should have 4 leads total (3 - 1 + 2 = 4)
      const currentLeads = await app.records.getList('leads');
      expect(currentLeads.items.length).toBe(4);

      // Check drift
      const status = app.demo.getStatus();
      expect(status.liveStats?.drift.isModified).toBe(true);
      expect(status.liveStats?.drift.recordsDelta).toBe(1); // net +1 record
    });

    it('should restore the exact clean state in one call with app.demo.reset()', async () => {
      const resetRes = await app.demo.reset();
      expect(resetRes.success).toBe(true);
      expect(resetRes.snapshot.name).toBe('Q3 Investor Pitch Demo');
      expect(resetRes.durationMs).toBeGreaterThanOrEqual(0);

      // Verify the records: Exactly 3 clean leads restored!
      const restoredLeads = await app.records.getList('leads', { sort: 'company' });
      expect(restoredLeads.items.length).toBe(3);

      const companies = restoredLeads.items.map((r: any) => r.company).sort();
      expect(companies).toEqual(['Acme Corp', 'Globex Inc', 'Soylent Tech']);

      // Acme Corp should NOT be vandalized
      const acme = restoredLeads.items.find((r: any) => r.company === 'Acme Corp') as any;
      expect(acme.deal_size).toBe(50000);
      expect(acme.status).toBe('negotiation');

      // Messy leads should be completely gone
      const messyLeads = restoredLeads.items.filter((r: any) => r.company.includes('Messy'));
      expect(messyLeads.length).toBe(0);

      // Drift should now report unmodified / pristine
      const status = app.demo.getStatus();
      expect(status.liveStats?.drift.isModified).toBe(false);
      expect(status.liveStats?.drift.recordsDelta).toBe(0);
    });
  });

  describe('2. HTTP REST Endpoints', () => {
    it('GET /api/demo/status should return current snapshot metadata and live drift', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/demo/status',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.hasSnapshot).toBe(true);
      expect(body.snapshot.name).toBe('Q3 Investor Pitch Demo');
      expect(body.liveStats.drift.isModified).toBe(false);
    });

    it('POST /api/demo/snapshot should reject unauthenticated requests', async () => {
      const res = await app.server.inject({
        method: 'POST',
        url: '/api/demo/snapshot',
        payload: { name: 'Unauthorized Snapshot' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('POST /api/demo/snapshot with admin token should update snapshot baseline', async () => {
      // Add a 4th valid demo lead
      await app.records.create('leads', { company: 'Wayne Enterprises', deal_size: 250000, status: 'closed_won' });

      const res = await app.server.inject({
        method: 'POST',
        url: '/api/demo/snapshot',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          name: 'Updated Enterprise Demo Baseline',
          description: 'Includes Wayne Enterprises deal',
        },
      });

      expect(res.statusCode).toBe(201);
      const snap = JSON.parse(res.body);
      expect(snap.name).toBe('Updated Enterprise Demo Baseline');
      expect(snap.totalRecords).toBeGreaterThanOrEqual(5); // 4 leads + 1 admin
    });

    it('POST /api/demo/reset should reject unauthenticated requests', async () => {
      const res = await app.server.inject({
        method: 'POST',
        url: '/api/demo/reset',
      });

      expect(res.statusCode).toBe(403);
    });

    it('POST /api/demo/reset with admin token should successfully restore data', async () => {
      // Add temporary junk data
      await app.records.create('leads', { company: 'Temporary Junk Inc', deal_size: 0 });

      const res = await app.server.inject({
        method: 'POST',
        url: '/api/demo/reset',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const result = JSON.parse(res.body);
      expect(result.success).toBe(true);
      expect(result.snapshot.name).toBe('Updated Enterprise Demo Baseline');

      // Verify junk data is gone and 4 leads exist
      const leads = await app.records.getList('leads');
      expect(leads.items.length).toBe(4);
      expect(leads.items.some((r: any) => r.company === 'Wayne Enterprises')).toBe(true);
      expect(leads.items.some((r: any) => r.company === 'Temporary Junk Inc')).toBe(false);
    });

    it('DELETE /api/demo/snapshot with admin token should clear the snapshot', async () => {
      const res = await app.server.inject({
        method: 'DELETE',
        url: '/api/demo/snapshot',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(res.statusCode).toBe(204);
      expect(app.demo.hasSnapshot()).toBe(false);

      const statusRes = await app.server.inject({
        method: 'GET',
        url: '/api/demo/status',
      });
      expect(JSON.parse(statusRes.body).hasSnapshot).toBe(false);
    });
  });

  describe('3. NodeStackClient SDK Integration', () => {
    it('client.demo.snapshot() should create a snapshot via client SDK', async () => {
      const snap = await client.demo.snapshot({
        name: 'SDK Frozen Demo State',
        description: 'Frozen via NodeStackClient',
      });

      expect(snap.name).toBe('SDK Frozen Demo State');
      expect(snap.totalCollections).toBeGreaterThanOrEqual(2);
    });

    it('client.demo.getStatus() should return typed status via client SDK', async () => {
      const status = await client.demo.getStatus();
      expect(status.hasSnapshot).toBe(true);
      expect(status.snapshot?.name).toBe('SDK Frozen Demo State');
      expect(status.liveStats?.drift.isModified).toBe(false);
    });

    it('client.demo.reset() should restore clean demo baseline via client SDK', async () => {
      // Create messy record
      await client.collection('leads').create({ company: 'SDK Messy Row' });

      const statusBefore = await client.demo.getStatus();
      expect(statusBefore.liveStats?.drift.isModified).toBe(true);

      // 1-Click reset via SDK
      const resetRes = await client.demo.reset();
      expect(resetRes.success).toBe(true);
      expect(resetRes.snapshot.name).toBe('SDK Frozen Demo State');

      // Confirm messy record is gone
      const leads = await client.collection('leads').getList(1, 50);
      expect(leads.items.some((r: any) => r.company === 'SDK Messy Row')).toBe(false);

      const statusAfter = await client.demo.getStatus();
      expect(statusAfter.liveStats?.drift.isModified).toBe(false);
    });

    it('client.demo.clear() should delete snapshot via client SDK', async () => {
      await client.demo.clear();
      const status = await client.demo.getStatus();
      expect(status.hasSnapshot).toBe(false);
    });
  });

  describe('4. CLI Integration: nodestack demo [action]', () => {
    const cliTestDir = path.resolve(__dirname, '../.test_demo_cli_data');

    beforeAll(async () => {
      if (fs.existsSync(cliTestDir)) {
        fs.rmSync(cliTestDir, { recursive: true, force: true });
      }
      const setupApp = new NodeStack({ dataDir: cliTestDir });
      setupApp.schema.createCollection({
        name: 'demos',
        type: 'base',
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
        schema: [{ name: 'title', type: 'text', required: true }],
      });
      await setupApp.records.create('demos', { title: 'Baseline 1' });
      await setupApp.records.create('demos', { title: 'Baseline 2' });
      setupApp.db.close();
    });

    afterAll(() => {
      if (fs.existsSync(cliTestDir)) {
        fs.rmSync(cliTestDir, { recursive: true, force: true });
      }
    });

    it('should freeze demo snapshot via CLI command', async () => {
      await runCli(['node', 'cli.ts', 'demo', 'snapshot', '-d', cliTestDir, '-n', 'CLI Demo Baseline']);
      const checkApp = new NodeStack({ dataDir: cliTestDir });
      expect(checkApp.demo.hasSnapshot()).toBe(true);
      const status = checkApp.demo.getStatus();
      expect(status.snapshot?.name).toBe('CLI Demo Baseline');
      checkApp.db.close();
    });

    it('should show demo status via CLI command', async () => {
      await runCli(['node', 'cli.ts', 'demo', 'status', '-d', cliTestDir]);
      const checkApp = new NodeStack({ dataDir: cliTestDir });
      expect(checkApp.demo.hasSnapshot()).toBe(true);
      checkApp.db.close();
    });

    it('should restore clean demo state via CLI command', async () => {
      // Add test junk
      const appAdd = new NodeStack({ dataDir: cliTestDir });
      await appAdd.records.create('demos', { title: 'Messy Evaluation Row' });
      const beforeCount = (await appAdd.records.getList('demos')).totalItems;
      expect(beforeCount).toBe(3);
      appAdd.db.close();

      // Run CLI reset
      await runCli(['node', 'cli.ts', 'demo', 'reset', '-d', cliTestDir]);

      // Confirm clean state restored
      const appCheck = new NodeStack({ dataDir: cliTestDir });
      const afterDemos = await appCheck.records.getList('demos');
      expect(afterDemos.totalItems).toBe(2);
      expect(afterDemos.items.some((r: any) => r.title === 'Messy Evaluation Row')).toBe(false);
      appCheck.db.close();
    });

    it('should clear demo snapshot via CLI command', async () => {
      await runCli(['node', 'cli.ts', 'demo', 'clear', '-d', cliTestDir]);
      const checkApp = new NodeStack({ dataDir: cliTestDir });
      expect(checkApp.demo.hasSnapshot()).toBe(false);
      checkApp.db.close();
    });
  });

  describe('5. Maintenance Gate & Concurrency Coordination during Live Reset', () => {
    it('should lock DatabaseService directly and throw ServiceUnavailableError if queries are attempted while locked', async () => {
      expect(app.db.isDatabaseLocked()).toBe(false);
      app.db.lock();
      expect(app.db.isDatabaseLocked()).toBe(true);

      expect(() => {
        app.db.all('SELECT 1');
      }).toThrow('Database is temporarily locked');

      app.db.unlock();
      expect(app.db.isDatabaseLocked()).toBe(false);

      const rows = app.db.all('SELECT 1 as num');
      expect(rows[0].num).toBe(1);
    });

    it('should reject concurrent demo reset calls with ConflictError (409)', async () => {
      // Create snapshot first
      await app.demo.snapshot({ name: 'Concurrency Baseline' });

      // Simulate a long reset operation holding the exclusive gate
      const gate = app.maintenanceGate;
      let released = false;

      const longExclusive = gate.executeExclusive(async () => {
        await new Promise((r) => setTimeout(r, 60));
        released = true;
      });

      // While the gate is held, a concurrent reset attempt must fail with ConflictError
      await expect(
        app.demo.reset()
      ).rejects.toThrow('A demo reset or maintenance operation is already in progress');

      await longExclusive;
      expect(released).toBe(true);
    });

    it('should queue incoming HTTP requests during reset and seamlessly resolve them against restored state', async () => {
      // 1. Snapshot clean baseline
      await app.demo.snapshot({ name: 'Clean Baseline Before Concurrency Test' });

      // 2. Add messy evaluation record
      await app.records.create('leads', { company: 'Messy In-Flight Lead', deal_size: 1000 });

      // 3. Start reset
      const resetPromise = app.server.app.inject({
        method: 'POST',
        url: '/api/demo/reset',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      // 4. Poll until the maintenance gate is active (or small timeout)
      const startWait = Date.now();
      while (!app.maintenanceGate.isMaintenanceActive() && Date.now() - startWait < 500) {
        await new Promise((r) => setTimeout(r, 1));
      }

      // Send GET request specifically while the gate is active
      const getPromise = app.server.app.inject({
        method: 'GET',
        url: '/api/collections/leads/records',
      });

      const [resetRes, getRes] = await Promise.all([resetPromise, getPromise]);

      expect(resetRes.statusCode).toBe(200);
      expect(getRes.statusCode).toBe(200);

      // Verify the queued request observed the clean restored data without error
      const body = JSON.parse(getRes.payload);
      expect(body.items.some((item: any) => item.company === 'Messy In-Flight Lead')).toBe(false);
    });

    it('should drain in-flight requests before database close and swap', async () => {
      // Start an in-flight request with simulated delay
      const inFlightReq = app.server.app.inject({
        method: 'GET',
        url: '/api/collections/leads/records?mock_delay=50',
      });

      // Fire reset while in-flight request is still active
      const resetReq = app.server.app.inject({
        method: 'POST',
        url: '/api/demo/reset',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const [inFlightRes, resetRes] = await Promise.all([inFlightReq, resetReq]);

      expect(inFlightRes.statusCode).toBe(200);
      expect(resetRes.statusCode).toBe(200);
    });

    it('should guarantee maintenance gate release even if exclusive action throws', async () => {
      const gate = app.maintenanceGate;
      expect(gate.isMaintenanceActive()).toBe(false);

      await expect(
        gate.executeExclusive(async () => {
          throw new Error('Simulated failure during filesystem copy');
        })
      ).rejects.toThrow('Simulated failure during filesystem copy');

      // Maintenance gate must be unlocked in finally
      expect(gate.isMaintenanceActive()).toBe(false);
      expect(gate.isExclusiveActive()).toBe(false);
    });
  });
});

