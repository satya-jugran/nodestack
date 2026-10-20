import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { NodeStack } from '../src/NodeStack';
import { AuditLogService } from '../src/audit/AuditLogService';

describe('Audit Log & Change History System', () => {
  const testDir = path.resolve(__dirname, '../.test_audit_nodestack_data');
  let app: NodeStack;
  let adminToken = '';
  let postId = '';

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    app = new NodeStack({
      dataDir: testDir,
      port: 8097,
    });

    // Create admin
    const admin = await app.auth.createAdmin('audit_admin@nodestack.io', 'supersecret123');
    const authRes = await app.auth.authenticateAdmin('audit_admin@nodestack.io', 'supersecret123');
    adminToken = authRes.token;

    // Create a 'posts' collection
    app.schema.createCollection({
      name: 'posts',
      type: 'base',
      schema: [
        { id: 'f_title', name: 'title', type: 'text', required: true },
        { id: 'f_content', name: 'content', type: 'text', required: false },
        { id: 'f_status', name: 'status', type: 'select', options: { values: ['draft', 'published', 'archived'] } },
        { id: 'f_views', name: 'views', type: 'number', defaultValue: 0 },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('1. Pure Unit Tests: AuditLogService.computeDiff', () => {
    const service = new AuditLogService(null as any);

    it('should compute create diff for all initial record fields', () => {
      const record = { id: 'r_1', title: 'First Post', views: 0 };
      const { diff, changedFields } = service.computeDiff('create', null, record);

      expect(changedFields).toEqual(['id', 'title', 'views']);
      expect(diff.title).toEqual({ old: null, new: 'First Post' });
      expect(diff.views).toEqual({ old: null, new: 0 });
    });

    it('should compute update diff only for changed fields and ignore updated timestamp', () => {
      const oldRecord = { id: 'r_1', title: 'Old Title', views: 10, status: 'draft', updated: '2026-10-18T10:00:00Z' };
      const newRecord = { id: 'r_1', title: 'New Title', views: 10, status: 'published', updated: '2026-10-18T11:00:00Z' };

      const { diff, changedFields } = service.computeDiff('update', oldRecord, newRecord);

      expect(changedFields).toEqual(['status', 'title']);
      expect(diff.title).toEqual({ old: 'Old Title', new: 'New Title' });
      expect(diff.status).toEqual({ old: 'draft', new: 'published' });
      expect(diff.views).toBeUndefined();
      expect(diff.updated).toBeUndefined();
    });

    it('should return empty changedFields if no user fields were modified on update', () => {
      const oldRecord = { id: 'r_1', title: 'Same', updated: '2026-10-18T10:00:00Z' };
      const newRecord = { id: 'r_1', title: 'Same', updated: '2026-10-18T10:05:00Z' };

      const { diff, changedFields } = service.computeDiff('update', oldRecord, newRecord);
      expect(changedFields).toEqual([]);
      expect(Object.keys(diff)).toHaveLength(0);
    });

    it('should compute delete diff with snapshot of old values', () => {
      const oldRecord = { id: 'r_1', title: 'To Delete', status: 'archived' };
      const { diff, changedFields } = service.computeDiff('delete', oldRecord, null);

      expect(changedFields).toEqual(['id', 'title', 'status']);
      expect(diff.title).toEqual({ old: 'To Delete', new: null });
      expect(diff.status).toEqual({ old: 'archived', new: null });
    });

    it('should automatically redact sensitive fields like password and tokenKey', () => {
      const oldRecord = { id: 'u_1', password: 'oldsecret', tokenKey: 'oldtoken', email: 'test@example.com' };
      const newRecord = { id: 'u_1', password: 'newsecret', tokenKey: 'newtoken', email: 'test@example.com' };

      const { diff, changedFields } = service.computeDiff('update', oldRecord, newRecord);

      expect(changedFields).toContain('password');
      expect(diff.password).toEqual({ old: '[REDACTED]', new: '[REDACTED]' });
      expect(diff.tokenKey).toBeUndefined(); // tokenKey is completely omitted from diffs
    });
  });

  describe('2. End-to-End Lifecycle: EventBus Audit Logging', () => {
    it('should record an audit entry when a record is created', async () => {
      const res = await app.server.inject({
        method: 'POST',
        url: '/api/collections/posts/records',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          title: 'Initial Blog Post',
          content: 'Hello World',
          status: 'draft',
          views: 5,
        },
      });

      expect(res.statusCode).toBe(201);
      const post = JSON.parse(res.body);
      postId = post.id;
      expect(postId).toBeDefined();

      const history = app.auditLogs.getRecordHistory('posts', postId);
      expect(history.items.length).toBeGreaterThanOrEqual(1);

      const createEntry = history.items.find((i) => i.action === 'create');
      expect(createEntry).toBeDefined();
      expect(createEntry?.collection).toBe('posts');
      expect(createEntry?.recordId).toBe(postId);
      expect(createEntry?.diff.title.new).toBe('Initial Blog Post');
      expect(createEntry?.authEmail).toBe('audit_admin@nodestack.io');
      expect(createEntry?.isAdmin).toBe(true);
    });

    it('should record an audit entry with precise field diff when a record is updated', async () => {
      const res = await app.server.inject({
        method: 'PATCH',
        url: `/api/collections/posts/records/${postId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          title: 'Updated Blog Post Title',
          status: 'published',
        },
      });

      expect(res.statusCode).toBe(200);

      const history = app.auditLogs.getRecordHistory('posts', postId);
      const updateEntry = history.items.find((i) => i.action === 'update');

      expect(updateEntry).toBeDefined();
      expect(updateEntry?.changedFields).toEqual(expect.arrayContaining(['status', 'title']));
      expect(updateEntry?.diff.title).toEqual({
        old: 'Initial Blog Post',
        new: 'Updated Blog Post Title',
      });
      expect(updateEntry?.diff.status).toEqual({
        old: 'draft',
        new: 'published',
      });
      // Unchanged fields should NOT be in diff
      expect(updateEntry?.diff.content).toBeUndefined();
    });

    it('should record an audit entry when a record is deleted', async () => {
      // Create a temporary record to delete
      const createRes = await app.server.inject({
        method: 'POST',
        url: '/api/collections/posts/records',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { title: 'To Be Deleted', status: 'draft' },
      });
      const tempId = JSON.parse(createRes.body).id;

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/api/collections/posts/records/${tempId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(deleteRes.statusCode).toBe(204);

      // Verify the delete audit log exists even though the source record is gone!
      const history = app.auditLogs.getRecordHistory('posts', tempId);
      const deleteEntry = history.items.find((i) => i.action === 'delete');

      expect(deleteEntry).toBeDefined();
      expect(deleteEntry?.recordId).toBe(tempId);
      expect(deleteEntry?.diff.title.old).toBe('To Be Deleted');
      expect(deleteEntry?.diff.title.new).toBeNull();
      expect(deleteEntry?.authEmail).toBe('audit_admin@nodestack.io');
    });

    it('should record an audit entry when an auth user updates ONLY their password', async () => {
      // 1. Create a user
      const userRes = await app.server.inject({
        method: 'POST',
        url: '/api/collections/users/records',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          email: 'pw_test@nodestack.io',
          password: 'initialpassword123',
          name: 'Password Test User',
        },
      });
      expect(userRes.statusCode).toBe(201);
      const user = JSON.parse(userRes.body);
      const userId = user.id;

      // 2. Update ONLY the password
      const updateRes = await app.server.inject({
        method: 'PATCH',
        url: `/api/collections/users/records/${userId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          password: 'newpassword45678',
        },
      });
      expect(updateRes.statusCode).toBe(200);

      // 3. Verify audit history captures the password change
      const history = app.auditLogs.getRecordHistory('users', userId);
      const pwUpdate = history.items.find((i) => i.action === 'update');

      expect(pwUpdate).toBeDefined();
      expect(pwUpdate?.changedFields).toContain('password');
      expect(pwUpdate?.diff.password).toEqual({
        old: '[REDACTED]',
        new: '[REDACTED]',
      });
      // Raw hash or tokenKey must NEVER be present in the diff
      expect(pwUpdate?.diff.passwordHash).toBeUndefined();
      expect(pwUpdate?.diff.tokenKey).toBeUndefined();
    });
  });

  describe('3. REST API Endpoints', () => {
    it('should return 401/403 for unauthorized non-admin access to audit endpoints', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: '/api/audit-logs',
      });
      expect([401, 403]).toContain(res.statusCode);

      const historyRes = await app.server.inject({
        method: 'GET',
        url: `/api/collections/posts/records/${postId}/history`,
      });
      expect([401, 403]).toContain(historyRes.statusCode);
    });

    it('should get record-specific history via GET /api/collections/:col/records/:id/history', async () => {
      const res = await app.server.inject({
        method: 'GET',
        url: `/api/collections/posts/records/${postId}/history`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.items).toBeDefined();
      expect(data.totalItems).toBeGreaterThanOrEqual(2);
      expect(data.items.every((i: any) => i.recordId === postId)).toBe(true);
    });

    it('should get global audit logs via GET /api/audit-logs with filters', async () => {
      // All logs
      const allRes = await app.server.inject({
        method: 'GET',
        url: '/api/audit-logs',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(allRes.statusCode).toBe(200);
      const allData = JSON.parse(allRes.body);
      expect(allData.totalItems).toBeGreaterThanOrEqual(3);

      // Filter by collection
      const colRes = await app.server.inject({
        method: 'GET',
        url: '/api/audit-logs?collection=posts',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const colData = JSON.parse(colRes.body);
      expect(colData.items.every((i: any) => i.collection === 'posts')).toBe(true);

      // Filter by action
      const updateRes = await app.server.inject({
        method: 'GET',
        url: '/api/audit-logs?action=update',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const updateData = JSON.parse(updateRes.body);
      expect(updateData.items.every((i: any) => i.action === 'update')).toBe(true);
    });

    it('should paginate record history when there are multiple mutations', async () => {
      for (let i = 1; i <= 30; i++) {
        await app.server.inject({
          method: 'PATCH',
          url: `/api/collections/posts/records/${postId}`,
          headers: { Authorization: `Bearer ${adminToken}` },
          payload: { views: i },
        });
      }

      const page1Res = await app.server.inject({
        method: 'GET',
        url: `/api/collections/posts/records/${postId}/history?page=1&perPage=10`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const p1 = JSON.parse(page1Res.body);
      expect(p1.items.length).toBe(10);
      expect(p1.totalItems).toBeGreaterThanOrEqual(32);
      expect(p1.totalPages).toBeGreaterThanOrEqual(4);
      expect(p1.page).toBe(1);

      const page2Res = await app.server.inject({
        method: 'GET',
        url: `/api/collections/posts/records/${postId}/history?page=2&perPage=10`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const p2 = JSON.parse(page2Res.body);
      expect(p2.items.length).toBe(10);
      expect(p2.page).toBe(2);
      expect(p2.items[0].id).not.toBe(p1.items[0].id);
    });

    it('should prune logs via POST /api/audit-logs/prune', async () => {
      const res = await app.server.inject({
        method: 'POST',
        url: '/api/audit-logs/prune',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { olderThanDays: 365 },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.success).toBe(true);
      expect(data.deletedCount).toBeDefined();
    });
  });

  describe('4. Admin UI Bundling & Integration', () => {
    it('should bundle audit log UI components and timeline styles', () => {
      const html = app.adminUi.getHtml();

      expect(html).toContain('audit-subtabs-bar');
      expect(html).toContain('Data Audit Trail');
      expect(html).toContain('audit-timeline');
      expect(html).toContain('handleToggleDrawerHistory');
      expect(html).toContain('handleDrawerHistoryLoadMore');
      expect(html).toContain('btn-drawer-history-load-more');
      expect(html).toContain('renderAuditLogsContentShell');
      expect(html).toContain('loadAuditLogs');
      expect(html).toContain('function loadLogsSubTab');
      expect(html).toContain('btn-drawer-history');
    });

    it('should only load active subtab data without duplicate or unrelated requests', () => {
      const html = app.adminUi.getHtml();
      const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'http://localhost:8097/_/',
        beforeParse(win: any) {
          win.fetch = vi.fn().mockImplementation(async () => ({
            ok: true,
            json: async () => ({ hasAdmins: true }),
          }));
        },
      });
      const win = dom.window as any;

      win.loadLogs = vi.fn();
      win.loadAuditLogs = vi.fn();

      // Case 1: Initial navigation to logs with default 'traffic' subtab
      win.auditState.subTab = 'traffic';
      win.selectNav('logs');
      expect(win.loadLogs).toHaveBeenCalledTimes(1);
      expect(win.loadAuditLogs).toHaveBeenCalledTimes(0);

      // Reset mocks
      win.loadLogs.mockClear();
      win.loadAuditLogs.mockClear();

      // Case 2: Switch to 'audit' subtab
      win.switchLogsSubTab('audit');
      expect(win.auditState.subTab).toBe('audit');
      expect(win.loadAuditLogs).toHaveBeenCalledTimes(1);
      expect(win.loadLogs).toHaveBeenCalledTimes(0);

      // Reset mocks
      win.loadLogs.mockClear();
      win.loadAuditLogs.mockClear();

      // Case 3: Re-navigate to logs when audit subtab is already active
      win.selectNav('logs');
      expect(win.loadAuditLogs).toHaveBeenCalledTimes(1);
      expect(win.loadLogs).toHaveBeenCalledTimes(0);
    }, 15000);
  });
});
