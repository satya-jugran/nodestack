import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { NodeStackClient } from '../packages/client/src/Client';

describe('Generic Multi-Snapshot Application State & FIFO Retention Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_generic_snapshots_data');
  const port = 8139;
  let app: NodeStack;
  let client: NodeStackClient;
  let adminToken = '';

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }

    app = new NodeStack({
      dataDir: testDir,
      port,
      appName: 'Generic Snapshots Test App',
    });

    await app.start(port);

    // Create super admin
    await app.auth.createAdmin('dev@nodestack.io', 'passWord123456');
    const authRes = await app.auth.authenticateAdmin('dev@nodestack.io', 'passWord123456');
    adminToken = authRes.token;

    // Create client SDK
    client = new NodeStackClient(`http://localhost:${port}`);
    client.authStore.save(adminToken, authRes.admin);

    // Create collection "projects"
    app.schema.createCollection({
      name: 'projects',
      type: 'base',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      schema: [
        { name: 'title', type: 'text', required: true },
        { name: 'stars', type: 'number', required: false },
      ],
    });

    // Seed 2 initial records
    await app.records.create('projects', { title: 'NodeStack Core', stars: 100 });
    await app.records.create('projects', { title: 'Admin UI', stars: 50 });
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore on windows file handle cleanup
      }
    }
  });

  describe('1. Core Multi-Snapshot Creation and Non-Destructive Restore', () => {
    let snap1Id = '';
    let snap2Id = '';
    let snap3Id = '';

    it('should create Snapshot 1 (Baseline with 2 projects)', async () => {
      const snap1 = await app.snapshots.createSnapshot({
        name: 'Checkpoint 1 - Initial 2 Projects',
        description: 'Baseline with 2 projects',
      });

      expect(snap1.id).toBeDefined();
      expect(snap1.name).toBe('Checkpoint 1 - Initial 2 Projects');
      expect(snap1.totalRecords).toBeGreaterThanOrEqual(3); // 2 projects + 1 admin
      snap1Id = snap1.id;

      const list = app.snapshots.listSnapshots();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe(snap1Id);
    });

    it('should add a 3rd project and create Snapshot 2', async () => {
      await app.records.create('projects', { title: 'CLI Tool', stars: 25 });

      const snap2 = await app.snapshots.createSnapshot({
        name: 'Checkpoint 2 - Added CLI',
      });

      expect(snap2.id).toBeDefined();
      expect(snap2.name).toBe('Checkpoint 2 - Added CLI');
      snap2Id = snap2.id;

      const list = app.snapshots.listSnapshots();
      expect(list.length).toBe(2);
      expect(list[0].id).toBe(snap1Id);
      expect(list[1].id).toBe(snap2Id);
    });

    it('should add a 4th project and create Snapshot 3', async () => {
      await app.records.create('projects', { title: 'Realtime SSE', stars: 75 });

      const snap3 = await app.snapshots.createSnapshot({
        name: 'Checkpoint 3 - Added Realtime',
      });

      expect(snap3.id).toBeDefined();
      snap3Id = snap3.id;

      const list = app.snapshots.listSnapshots();
      expect(list.length).toBe(3);
    });

    it('should restore older Snapshot 1 WITHOUT deleting future Snapshots (2 & 3)', async () => {
      // Current records before restore
      const currentProjects = await app.records.getList('projects');
      expect(currentProjects.items.length).toBe(4);

      // Restore older Snapshot 1
      const res = await app.snapshots.restoreSnapshot(snap1Id);
      expect(res.success).toBe(true);
      expect(res.snapshot.id).toBe(snap1Id);

      // Verify live state has reverted to 2 projects
      const restoredProjects = await app.records.getList('projects');
      expect(restoredProjects.items.length).toBe(2);
      const titles = restoredProjects.items.map((p) => p.title);
      expect(titles).toContain('NodeStack Core');
      expect(titles).toContain('Admin UI');
      expect(titles).not.toContain('CLI Tool');
      expect(titles).not.toContain('Realtime SSE');

      // CRITICAL CHECK: Verify future snapshots (Snap 2 and Snap 3) were NOT deleted!
      const remainingList = app.snapshots.listSnapshots();
      expect(remainingList.length).toBe(3);
      const ids = remainingList.map((s) => s.id);
      expect(ids).toContain(snap1Id);
      expect(ids).toContain(snap2Id);
      expect(ids).toContain(snap3Id);
    });

    it('should restore forward to Snapshot 3 and verify full state is recovered', async () => {
      const res = await app.snapshots.restoreSnapshot(snap3Id);
      expect(res.success).toBe(true);
      expect(res.snapshot.id).toBe(snap3Id);

      // Verify live state now has all 4 projects
      const projects = await app.records.getList('projects');
      expect(projects.items.length).toBe(4);
      const titles = projects.items.map((p) => p.title);
      expect(titles).toContain('NodeStack Core');
      expect(titles).toContain('Admin UI');
      expect(titles).toContain('CLI Tool');
      expect(titles).toContain('Realtime SSE');

      // All 3 snapshots still remain intact
      const list = app.snapshots.listSnapshots();
      expect(list.length).toBe(3);
    });

    it('should delete a specific individual snapshot (Snap 2)', async () => {
      await app.snapshots.deleteSnapshot(snap2Id);

      const list = app.snapshots.listSnapshots();
      expect(list.length).toBe(2);
      const ids = list.map((s) => s.id);
      expect(ids).toContain(snap1Id);
      expect(ids).toContain(snap3Id);
      expect(ids).not.toContain(snap2Id);
    });
  });

  describe('2. Snapshot Capacity Limit (Max 10) & FIFO Eviction', () => {
    it('should fill snapshots up to 10', async () => {
      // Currently there are 2 snapshots (Snap 1 and Snap 3)
      const initialCount = app.snapshots.listSnapshots().length;
      for (let i = initialCount + 1; i <= 10; i++) {
        await app.snapshots.createSnapshot({ name: `Batch Snapshot #${i}` });
      }

      const list = app.snapshots.listSnapshots();
      expect(list.length).toBe(10);
    });

    it('should reject taking an 11th snapshot when evictOldest is false / not provided', async () => {
      const listBefore = app.snapshots.listSnapshots();
      expect(listBefore.length).toBe(10);
      const oldestBefore = listBefore[0];

      await expect(
        app.snapshots.createSnapshot({ name: 'Snapshot #11 Without Eviction' })
      ).rejects.toThrow(/Snapshot limit of 10 reached/i);

      // Total still remains exactly 10
      expect(app.snapshots.listSnapshots().length).toBe(10);
      expect(app.snapshots.listSnapshots()[0].id).toBe(oldestBefore.id);
    });

    it('should successfully evict the oldest snapshot and create #11 when evictOldest: true', async () => {
      const listBefore = app.snapshots.listSnapshots();
      expect(listBefore.length).toBe(10);
      const oldestId = listBefore[0].id;

      const newSnap = await app.snapshots.createSnapshot({
        name: 'Snapshot #11 With Eviction',
        evictOldest: true,
      });

      expect(newSnap.id).toBeDefined();
      expect(newSnap.name).toBe('Snapshot #11 With Eviction');

      const listAfter = app.snapshots.listSnapshots();
      // Total remains capped at 10
      expect(listAfter.length).toBe(10);

      // The previous oldest snapshot is now evicted
      const remainingIds = listAfter.map((s) => s.id);
      expect(remainingIds).not.toContain(oldestId);
      expect(remainingIds).toContain(newSnap.id);
    });
  });

  describe('3. HTTP REST API Endpoints', () => {
    it('GET /api/snapshots should return all snapshots and status', async () => {
      const res = await fetch(`http://localhost:${port}/api/snapshots`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.hasSnapshot).toBe(true);
      expect(body.total).toBe(10);
      expect(body.maxLimit).toBe(10);
      expect(Array.isArray(body.snapshots)).toBe(true);
      expect(body.snapshots.length).toBe(10);
      expect(body.activeSnapshot).toBeDefined();
    });

    it('POST /api/snapshots without evictOldest should return 409 Conflict when limit is reached', async () => {
      const res = await fetch(`http://localhost:${port}/api/snapshots`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ name: 'Exceeding snapshot' }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.message).toMatch(/Snapshot limit of 10 reached/i);
      expect(body.data?.code).toBe('SNAPSHOT_LIMIT_REACHED');
      expect(body.data?.limit).toBe(10);
      expect(body.data?.oldestSnapshot).toBeDefined();
    });

    it('POST /api/snapshots with evictOldest: true should succeed and rotate out oldest', async () => {
      const res = await fetch(`http://localhost:${port}/api/snapshots`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ name: 'REST Rotated Snapshot', evictOldest: true }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe('REST Rotated Snapshot');
    });

    it('POST /api/snapshots/:id/restore should restore snapshot via REST', async () => {
      const list = app.snapshots.listSnapshots();
      const target = list[list.length - 1];

      const res = await fetch(`http://localhost:${port}/api/snapshots/${target.id}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.snapshot.id).toBe(target.id);
    });

    it('DELETE /api/snapshots/:id should delete specific snapshot via REST', async () => {
      const list = app.snapshots.listSnapshots();
      const targetId = list[0].id;

      const res = await fetch(`http://localhost:${port}/api/snapshots/${targetId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(204);
      expect(app.snapshots.getSnapshot(targetId)).toBeNull();
    });
  });

  describe('4. NodeStackClient SDK Integration', () => {
    it('client.snapshots.list() should return snapshot status', async () => {
      const status = await client.snapshots.list();
      expect(status.hasSnapshot).toBe(true);
      expect(status.total).toBe(9);
      expect(status.snapshots.length).toBe(9);
    });

    it('client.snapshots.create() should create a snapshot via client SDK', async () => {
      const snap = await client.snapshots.create({
        name: 'Client SDK Snapshot',
        description: 'Created using client.snapshots.create()',
      });

      expect(snap.id).toBeDefined();
      expect(snap.name).toBe('Client SDK Snapshot');
    });

    it('client.snapshots.restore() should restore snapshot via client SDK', async () => {
      const list = await client.snapshots.list();
      const target = list.snapshots[list.snapshots.length - 1];

      const result = await client.snapshots.restore(target.id);
      expect(result.success).toBe(true);
      expect(result.snapshot.id).toBe(target.id);
    });

    it('client.snapshots.delete() should delete snapshot via client SDK', async () => {
      const list = await client.snapshots.list();
      const target = list.snapshots[0];

      await client.snapshots.delete(target.id);
      expect(app.snapshots.getSnapshot(target.id)).toBeNull();
    });
  });

  describe('5. Multi-Application Snapshot Isolation', () => {
    it('should support snapshots per app scope without cross-tenant interference', async () => {
      // Create multi-app
      const scope = await app.apps.create({
        name: 'Tenant Alpha',
        slug: 'tenant-alpha',
      });
      expect(scope).toBeDefined();
      expect(scope.snapshots).toBeDefined();

      // Tenant initial snapshots count should be 0
      expect(scope.snapshots.listSnapshots().length).toBe(0);

      // Create collection in tenant
      scope.schema.createCollection({
        name: 'invoices',
        type: 'base',
        createRule: '',
        schema: [{ name: 'amount', type: 'number', required: true }],
      });
      await scope.records.create('invoices', { amount: 500 });

      // Create snapshot in tenant
      const tenantSnap = await scope.snapshots.createSnapshot({
        name: 'Tenant Alpha Baseline',
      });

      expect(tenantSnap.name).toBe('Tenant Alpha Baseline');
      expect(scope.snapshots.listSnapshots().length).toBe(1);

      // Main app snapshots should not include tenant snapshot
      const mainSnapshots = app.snapshots.listSnapshots();
      const mainIds = mainSnapshots.map((s) => s.id);
      expect(mainIds).not.toContain(tenantSnap.id);

      // Restore tenant snapshot
      const restoreRes = await scope.snapshots.restoreSnapshot(tenantSnap.id);
      expect(restoreRes.success).toBe(true);
      expect(restoreRes.snapshot.name).toBe('Tenant Alpha Baseline');
    });
  });
});
