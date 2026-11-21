import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { AdminUIBundler } from '../src/admin/AdminUIBundler';
import { NodeStackClient } from '../packages/client/src/Client';

describe('Cron HTTP REST API, Client SDK, & Admin UI Bundle', () => {
  const testDir = path.resolve(__dirname, '../.test_cron_api_ui_data');
  let app: NodeStack;
  let adminToken = '';
  const port = 8297;
  const baseUrl = `http://127.0.0.1:${port}`;
  let client: NodeStackClient;

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

    client = new NodeStackClient(baseUrl);
    client.authStore.save(adminToken, null);
  });

  afterAll(async () => {
    if (app) {
      await app.stop();
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }, 15000);

  describe('1. Cron HTTP Endpoints (/api/cron/...)', () => {
    let createdScheduleId = '';
    let targetFunctionId = '';

    it('POST /api/cron/preview should preview valid cron expressions', async () => {
      const res = await fetch(`${baseUrl}/api/cron/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          cronExpression: '*/15 * * * *',
          timezone: 'America/New_York',
          count: 4,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.valid).toBe(true);
      expect(data.nextRuns.length).toBe(4);
      expect(data.description).toContain('15');
    });

    it('POST /api/cron/preview should report invalid cron expressions with valid: false', async () => {
      const res = await fetch(`${baseUrl}/api/cron/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          cronExpression: 'invalid-cron-expr',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.valid).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('GET /api/cron/stats should return cron execution stats', async () => {
      const res = await fetch(`${baseUrl}/api/cron/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const stats = await res.json();
      expect(stats).toHaveProperty('activeSchedules');
      expect(stats).toHaveProperty('totalRuns');
      expect(stats).toHaveProperty('successfulRuns');
    });

    it('POST /api/cron/schedules should create a new schedule', async () => {
      const fn = await app.functions.createFunction({
        name: 'scheduled-api-worker',
        code: `
          export default async function(core, context) {
            return { status: 200, body: { ran: true, at: context.cron?.scheduledTime } };
          }
        `,
      });
      targetFunctionId = fn.id;

      const res = await fetch(`${baseUrl}/api/cron/schedules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name: 'Nightly Sync',
          targetType: 'function',
          targetId: targetFunctionId,
          cronExpression: '0 2 * * *',
          timezone: 'America/Chicago',
          missedPolicy: 'skip',
          enabled: true,
        }),
      });

      expect(res.status).toBe(201);
      const created = await res.json();
      expect(created.id).toBeDefined();
      expect(created.name).toBe('Nightly Sync');
      expect(created.targetType).toBe('function');
      expect(created.cronExpression).toBe('0 2 * * *');
      expect(created.nextRunAt).toBeDefined();
      createdScheduleId = created.id;
    });

    it('GET /api/cron/schedules should list schedules with filtering', async () => {
      const res = await fetch(`${baseUrl}/api/cron/schedules?targetType=function`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const schedules = await res.json();
      expect(Array.isArray(schedules)).toBe(true);
      const found = schedules.find((s: any) => s.id === createdScheduleId);
      expect(found).toBeDefined();
      expect(found.name).toBe('Nightly Sync');
    });

    it('GET /api/cron/schedules/:id should retrieve schedule details', async () => {
      const res = await fetch(`${baseUrl}/api/cron/schedules/${createdScheduleId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const schedule = await res.json();
      expect(schedule.id).toBe(createdScheduleId);
      expect(schedule.name).toBe('Nightly Sync');
    });

    it('PATCH /api/cron/schedules/:id should update schedule properties', async () => {
      const res = await fetch(`${baseUrl}/api/cron/schedules/${createdScheduleId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          cronExpression: '30 2 * * *',
          enabled: false,
        }),
      });

      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.cronExpression).toBe('30 2 * * *');
      expect(updated.enabled).toBe(false);
      expect(updated.nextRunAt).toBeNull();
    });

    it('POST /api/cron/schedules/:id/trigger should trigger immediate manual run', async () => {
      const res = await fetch(`${baseUrl}/api/cron/schedules/${createdScheduleId}/trigger`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const run = await res.json();
      expect(run.status).toBe('succeeded');
      expect(run.scheduleId).toBe(createdScheduleId);
      expect(run.targetType).toBe('function');
      expect(run.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('GET /api/cron/runs should list execution audit logs', async () => {
      const res = await fetch(`${baseUrl}/api/cron/runs?scheduleId=${createdScheduleId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items[0].status).toBe('succeeded');
    });

    it('DELETE /api/cron/runs should prune execution logs', async () => {
      const res = await fetch(`${baseUrl}/api/cron/runs?scheduleId=${createdScheduleId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.count).toBeGreaterThanOrEqual(1);

      const check = await fetch(`${baseUrl}/api/cron/runs?scheduleId=${createdScheduleId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const checkBody = await check.json();
      expect(checkBody.items.length).toBe(0);
    });

    it('DELETE /api/cron/schedules/:id should remove schedule', async () => {
      const res = await fetch(`${baseUrl}/api/cron/schedules/${createdScheduleId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);

      const check = await fetch(`${baseUrl}/api/cron/schedules/${createdScheduleId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(check.status).toBe(404);
    });
  });

  describe('2. Multi-Tenant Isolation', () => {
    let tenantAppId = '';
    let tenantScheduleId = '';

    beforeAll(async () => {
      const appRecord = await client.apps.create({
        name: 'Tenant Alpha',
        slug: 'tenant-alpha',
      });
      tenantAppId = appRecord.id;
    });

    it('should create schedule in tenant-alpha scope and verify isolation from default app', async () => {
      const tenantRes = await fetch(`${baseUrl}/api/apps/${tenantAppId}/cron/schedules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name: 'Tenant Alpha Cron',
          targetType: 'flow',
          targetId: 'dummy-flow-id',
          cronExpression: '0 12 * * *',
          timezone: 'UTC',
          missedPolicy: 'catch_up_once',
          enabled: true,
        }),
      });

      expect(tenantRes.status).toBe(201);
      const tenantSchedule = await tenantRes.json();
      tenantScheduleId = tenantSchedule.id;
      expect(tenantSchedule.name).toBe('Tenant Alpha Cron');

      // Verify default app schedules do NOT contain tenant-alpha's schedule
      const defaultRes = await fetch(`${baseUrl}/api/cron/schedules`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const defaultSchedules = await defaultRes.json();
      const leaked = defaultSchedules.find((s: any) => s.id === tenantScheduleId);
      expect(leaked).toBeUndefined();

      // Verify tenant app endpoint DOES contain it
      const tenantCheck = await fetch(`${baseUrl}/api/apps/${tenantAppId}/cron/schedules`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const tenantSchedules = await tenantCheck.json();
      const foundInTenant = tenantSchedules.find((s: any) => s.id === tenantScheduleId);
      expect(foundInTenant).toBeDefined();
      expect(foundInTenant.name).toBe('Tenant Alpha Cron');
    });
  });

  describe('3. Client SDK (packages/client)', () => {
    it('client.cron.preview should preview schedule via SDK', async () => {
      const preview = await client.cron.preview('0 0 * * *', 'UTC', 2);
      expect(preview.valid).toBe(true);
      expect(preview.nextRuns.length).toBe(2);
    });

    it('client.cron.getStats should return stats via SDK', async () => {
      const stats = await client.cron.getStats();
      expect(stats).toHaveProperty('activeSchedules');
      expect(stats).toHaveProperty('totalRuns');
    });

    it('client.cron.createSchedule, listSchedules, and triggerSchedule', async () => {
      const schedule = await client.cron.createSchedule({
        name: 'SDK Hourly Job',
        targetType: 'snapshot',
        targetId: 'snapshot_auto',
        cronExpression: '0 * * * *',
        timezone: 'UTC',
        missedRunPolicy: 'catch_up_once',
        enabled: true,
      });

      expect(schedule.id).toBeDefined();
      expect(schedule.name).toBe('SDK Hourly Job');

      const list = await client.cron.listSchedules({ targetType: 'snapshot' });
      expect(list.some((s) => s.id === schedule.id)).toBe(true);

      const run = await client.cron.triggerSchedule(schedule.id);
      if (run.status === 'failed') {
        console.error('Snapshot trigger failed with error:', run.error);
      }
      expect(run.status).toBe('succeeded');
      expect(run.scheduleId).toBe(schedule.id);

      await client.cron.deleteSchedule(schedule.id);
    }, 15000);
  });

  describe('4. Admin UI Bundler Verification', () => {
    it('AdminUIBundler should inline cron.js, sidebar navigation, and schedules view', () => {
      const uiDir = path.resolve(__dirname, '../src/admin/ui');
      const bundledHtml = AdminUIBundler.bundle(uiDir);

      expect(bundledHtml).toBeDefined();
      expect(bundledHtml.length).toBeGreaterThan(1000);

      // Verify Sidebar Nav contains Schedules
      expect(bundledHtml).toContain('id="nav-schedules"');
      expect(bundledHtml).toContain('selectNav(\'schedules\')');

      // Verify Main view container exists
      expect(bundledHtml).toContain('id="page-view-schedules"');

      // Verify cron.js script is bundled into inlined JS
      expect(bundledHtml).toContain('renderSchedulesView');
      expect(bundledHtml).toContain('openCreateScheduleModal');
      expect(bundledHtml).toContain('renderScheduledBackupsCardHtml');
      expect(bundledHtml).toContain('openSnapshotScheduleModal');

      // Verify Functions workbench cron inputs
      expect(bundledHtml).toContain('id="fn-editor-cron"');
      expect(bundledHtml).toContain('id="fn-editor-timezone"');

      // Verify Flows trigger includes cron
      expect(bundledHtml).toContain('<option value="cron"');
      expect(bundledHtml).toContain('id="flow-edit-cron-schedule"');
      expect(bundledHtml).toContain('id="flow-cron-preview"');
    });

    it('selectNav("schedules") should make page-view-schedules visible in Admin UI without runtime errors', async () => {
      const { JSDOM } = await import('jsdom');
      const uiDir = path.resolve(__dirname, '../src/admin/ui');
      const bundledHtml = AdminUIBundler.bundle(uiDir);

      const dom = new JSDOM(bundledHtml, {
        runScripts: 'dangerously',
        url: 'http://localhost:8297/_/',
      });

      const win = dom.window as any;
      win.fetch = globalThis.fetch;
      win.api = async () => ({ totalSchedules: 0, activeSchedules: 0, schedules: [] });

      // Call selectNav('schedules')
      await win.selectNav('schedules');

      const schedulesPage = win.document.getElementById('page-view-schedules');
      expect(schedulesPage).not.toBeNull();
      expect(schedulesPage.style.display).toBe('block');

      // Verify other views are hidden
      expect(win.document.getElementById('page-view-home').style.display).toBe('none');
      expect(win.document.getElementById('page-view-collections').style.display).toBe('none');

      // Verify active class on nav item
      expect(win.document.getElementById('nav-schedules').classList.contains('active')).toBe(true);

      // Verify schedules header content rendered inside page-view-schedules
      expect(schedulesPage.innerHTML).toContain('Schedules Manager');
      expect(schedulesPage.innerHTML).toContain('id="schedules-manager-root"');

      // Click "New Schedule" button to open slide-over drawer
      const newScheduleBtn = win.document.getElementById('btn-new-schedule');
      expect(newScheduleBtn).not.toBeNull();
      win.openCreateScheduleDrawer();

      // Verify slide-over drawer backdrop and panel exist in drawer-root
      const backdrop = win.document.getElementById('schedule-drawer-backdrop');
      expect(backdrop).not.toBeNull();
      expect(backdrop.classList.contains('drawer-backdrop')).toBe(true);

      const drawer = win.document.getElementById('schedule-drawer-panel');
      expect(drawer).not.toBeNull();
      expect(drawer.classList.contains('schedule-drawer')).toBe(true);
      expect(drawer.querySelector('.drawer-title').textContent).toBe('Create New Schedule');

      // Verify form elements inside drawer
      expect(win.document.getElementById('sched-input-name')).not.toBeNull();
      expect(win.document.getElementById('sched-input-target-type')).not.toBeNull();
      expect(win.document.getElementById('sched-input-target-id')).not.toBeNull();
      expect(win.document.getElementById('sched-input-expr')).not.toBeNull();
      expect(win.document.getElementById('sched-input-tz')).not.toBeNull();
      expect(win.document.getElementById('sched-preview-card')).not.toBeNull();

      // Test preset change
      win.handleModalPresetChange('0 0 * * *');
      expect(win.document.getElementById('sched-input-expr').value).toBe('0 0 * * *');

      // Test backwards compatibility alias
      expect(typeof win.openCreateScheduleModal).toBe('function');
      expect(typeof win.closeScheduleModal).toBe('function');

      // Close drawer
      win.closeScheduleDrawer();
      expect(backdrop.classList.contains('open')).toBe(false);
      expect(drawer.classList.contains('open')).toBe(false);
    }, 20000);

    it('selectApp should refresh schedules view and sidebar count when switching apps', async () => {
      const { JSDOM } = await import('jsdom');
      const uiDir = path.resolve(__dirname, '../src/admin/ui');
      const bundledHtml = AdminUIBundler.bundle(uiDir);

      const dom = new JSDOM(bundledHtml, {
        runScripts: 'dangerously',
        url: 'http://localhost:8297/_/',
      });

      const win = dom.window as any;
      win.fetch = globalThis.fetch;

      // Mock apps state
      win.state.apps = [
        { id: 'app_default', slug: 'default', name: 'Default App', isDefault: true },
        { id: 'app_tenant_b', slug: 'tenant-b', name: 'Tenant B', isDefault: false },
      ];
      win.state.activeApp = win.state.apps[0];

      // Mock api to return different stats and schedules per app
      win.api = async (url: string) => {
        if (url.includes('tenant-b')) {
          if (url.endsWith('/stats')) return { totalSchedules: 5, activeSchedules: 4, successfulRuns: 10, failedRuns: 0, skippedRuns: 0 };
          if (url.endsWith('/schedules')) return [{ id: 'sched-b1', name: 'Tenant B Schedule', targetType: 'function', targetId: 'fn1', cronExpression: '0 * * * *', enabled: true }];
        }
        if (url.endsWith('/stats')) return { totalSchedules: 1, activeSchedules: 1, successfulRuns: 2, failedRuns: 0, skippedRuns: 0 };
        if (url.endsWith('/schedules')) return [{ id: 'sched-def1', name: 'Default Schedule', targetType: 'function', targetId: 'fn0', cronExpression: '0 * * * *', enabled: true }];
        return [];
      };

      // Select schedules nav first and wait for data load
      await win.selectNav('schedules');
      await win.loadCronData();
      const countBadge = win.document.getElementById('sidebar-schedules-count');
      expect(countBadge.textContent).toBe('1');
      expect(countBadge.style.display).toBe('inline-block');

      // Now switch app to tenant-b
      await win.selectApp('tenant-b');
      await win.loadCronData();

      // Count badge should refresh to 5
      expect(countBadge.textContent).toBe('5');

      // Schedules list should display Tenant B Schedule
      const content = win.document.getElementById('cron-tab-content');
      expect(content.innerHTML).toContain('Tenant B Schedule');
    }, 20000);

    it('target type snapshot should not appear in drawer or filters when database is not sqlite', async () => {
      const { JSDOM } = await import('jsdom');
      const uiDir = path.resolve(__dirname, '../src/admin/ui');
      const bundledHtml = AdminUIBundler.bundle(uiDir);

      const dom = new JSDOM(bundledHtml, {
        runScripts: 'dangerously',
        url: 'http://localhost:8297/_/',
      });

      const win = dom.window as any;
      win.fetch = globalThis.fetch;

      // Mock databaseState to be PostgreSQL
      win.databaseState = {
        status: { provider: 'postgres' },
        selectedProvider: 'postgres',
      };
      win.state.demo = { supported: false, provider: 'postgres' };

      win.api = async (url: string) => {
        if (url.endsWith('/stats')) return { totalSchedules: 0, activeSchedules: 0 };
        if (url.endsWith('/schedules')) return [];
        return [];
      };

      // Select schedules nav
      await win.selectNav('schedules');
      await win.loadCronData();

      // Check target filter dropdown on schedules page
      const filterSelect = win.document.getElementById('cron-target-filter');
      expect(filterSelect).not.toBeNull();
      const filterOptions = Array.from(filterSelect.options).map((o: any) => o.value);
      expect(filterOptions).toContain('function');
      expect(filterOptions).toContain('flow');
      expect(filterOptions).not.toContain('snapshot');

      // Open Create Schedule drawer
      win.openCreateScheduleDrawer();
      const targetTypeSelect = win.document.getElementById('sched-input-target-type');
      expect(targetTypeSelect).not.toBeNull();
      const drawerOptions = Array.from(targetTypeSelect.options).map((o: any) => o.value);
      expect(drawerOptions).toContain('function');
      expect(drawerOptions).toContain('flow');
      expect(drawerOptions).not.toContain('snapshot');

      win.closeScheduleDrawer();
    }, 20000);

    it('schedule cards should display human description, quick history button, and search/filter controls', async () => {
      const { JSDOM } = await import('jsdom');
      const uiDir = path.resolve(__dirname, '../src/admin/ui');
      const bundledHtml = AdminUIBundler.bundle(uiDir);

      const dom = new JSDOM(bundledHtml, {
        runScripts: 'dangerously',
        url: 'http://localhost:8297/_/',
      });

      const win = dom.window as any;
      win.fetch = globalThis.fetch;

      const mockSchedules = [
        {
          id: 'sched-1',
          name: 'Morning Digest',
          targetType: 'function',
          targetId: 'fn-digest',
          cronExpression: '0 9 * * 1-5',
          humanDescription: 'At 09:00, Monday through Friday',
          timezone: 'UTC',
          enabled: true,
          nextRunAt: new Date(Date.now() + 60000).toISOString(),
          lastStatus: 'succeeded',
        },
        {
          id: 'sched-2',
          name: 'Weekend Archive',
          targetType: 'flow',
          targetId: 'flow-archive',
          cronExpression: '0 0 * * 0',
          humanDescription: 'At 00:00, on Sun',
          timezone: 'UTC',
          enabled: false,
          lastStatus: 'failed',
          lastError: 'Database connection timeout',
        },
      ];

      win.cronState.schedules = mockSchedules;
      win.cronState.functionsList = [{ id: 'fn-digest', name: 'Morning Digest Function', enabled: true }];
      win.cronState.flowsList = [{ id: 'flow-archive', name: 'Archive Flow', enabled: false }];

      await win.selectNav('schedules');

      const content = win.document.getElementById('cron-tab-content');
      // Human-readable cadence should be displayed
      expect(content.innerHTML).toContain('At 09:00, Monday through Friday');

      // History button should be present
      expect(content.innerHTML).toContain('viewScheduleHistory(\'sched-1\')');

      // Target disabled badge should appear on sched-2
      expect(content.innerHTML).toContain('Target Disabled');

      // Test Search Filter: searching for 'Weekend' should show sched-2 and hide sched-1
      win.handleCronSearchInput('Weekend');
      expect(content.innerHTML).toContain('Weekend Archive');
      expect(content.innerHTML).not.toContain('Morning Digest');

      // Reset search
      win.handleCronSearchInput('');
      expect(content.innerHTML).toContain('Morning Digest');

      // Test Status Filter: 'failed' should only show Failing schedules
      win.handleCronStatusFilter('failed');
      expect(content.innerHTML).toContain('Weekend Archive');
      expect(content.innerHTML).not.toContain('Morning Digest');

      win.handleResetScheduleFilters();
      expect(content.innerHTML).toContain('Morning Digest');
      expect(content.innerHTML).toContain('Weekend Archive');
    });

    it('openRunDetailDrawer should open slide-over panel with formatted output and latency', async () => {
      const { JSDOM } = await import('jsdom');
      const uiDir = path.resolve(__dirname, '../src/admin/ui');
      const bundledHtml = AdminUIBundler.bundle(uiDir);

      const dom = new JSDOM(bundledHtml, {
        runScripts: 'dangerously',
        url: 'http://localhost:8297/_/',
      });

      const win = dom.window as any;
      win.fetch = globalThis.fetch;

      const mockRuns = [
        {
          id: 'run-abc-123',
          scheduleId: 'sched-1',
          scheduleName: 'Morning Digest',
          targetType: 'function',
          targetId: 'fn-digest',
          scheduledAt: new Date(Date.now() - 5000).toISOString(),
          startedAt: new Date(Date.now() - 4980).toISOString(),
          finishedAt: new Date(Date.now() - 4800).toISOString(),
          durationMs: 180,
          status: 'succeeded',
          isCatchUp: false,
          output: JSON.stringify({ processedItems: 42, success: true }),
        },
      ];

      win.cronState.runs = mockRuns;
      win.openRunDetailDrawer('run-abc-123');

      const drawer = win.document.getElementById('run-detail-panel');
      expect(drawer).not.toBeNull();
      expect(drawer.innerHTML).toContain('Morning Digest');
      expect(drawer.innerHTML).toContain('180ms');
      expect(drawer.innerHTML).toContain('processedItems');
      expect(drawer.innerHTML).toContain('run-abc-123');

      win.closeRunDetailDrawer();
    });

    it('renderModalTargetPickerHtml should clean up target names and badge disabled functions', async () => {
      const { JSDOM } = await import('jsdom');
      const uiDir = path.resolve(__dirname, '../src/admin/ui');
      const bundledHtml = AdminUIBundler.bundle(uiDir);

      const dom = new JSDOM(bundledHtml, {
        runScripts: 'dangerously',
        url: 'http://localhost:8297/_/',
      });

      const win = dom.window as any;
      win.cronState.functionsList = [
        { id: 'fn_111', name: 'send-email', enabled: true },
        { id: 'fn_222', name: 'archived-fn', enabled: false },
      ];

      const html = win.renderModalTargetPickerHtml('function', 'fn_111');
      // Active function displays clean name
      expect(html).toContain('>send-email</option>');
      // Disabled function displays [Disabled]
      expect(html).toContain('archived-fn [Disabled]');
    });

    it('renderScheduleDrawer and schedule card should support Group 3 Power Feature controls and badges', async () => {
      const { JSDOM } = await import('jsdom');
      const uiDir = path.resolve(__dirname, '../src/admin/ui');
      const bundledHtml = AdminUIBundler.bundle(uiDir);

      const dom = new JSDOM(bundledHtml, {
        runScripts: 'dangerously',
        url: 'http://localhost:8297/_/',
      });

      const win = dom.window as any;

      // 1. Open Create Schedule Drawer
      win.openCreateScheduleDrawer('function');

      const panel = win.document.getElementById('schedule-drawer-panel');
      expect(panel).not.toBeNull();

      // Check reliability controls present
      expect(win.document.getElementById('sched-input-retries')).not.toBeNull();
      expect(win.document.getElementById('sched-input-autopause')).not.toBeNull();
      expect(win.document.getElementById('sched-input-expires')).not.toBeNull();
      expect(win.document.getElementById('sched-input-keeplast')).not.toBeNull();

      // Check macros and L preset options in drawer
      expect(panel.innerHTML).toContain('@hourly');
      expect(panel.innerHTML).toContain('@daily');
      expect(panel.innerHTML).toContain('0 0 L * *');

      // 2. Check snapshot retention input visibility toggle
      win.handleModalTargetTypeChange('snapshot');
      const retentionContainer = win.document.getElementById('sched-retention-container');
      expect(retentionContainer.style.display).toBe('block');

      win.handleModalTargetTypeChange('function');
      expect(retentionContainer.style.display).toBe('none');

      // 3. Check Power Feature badges on Schedule Card
      const powerSchedule = {
        id: 'sched-power',
        name: 'Critical Sync Schedule',
        targetType: 'function',
        targetId: 'fn-sync',
        cronExpression: '0 0 L * *',
        humanDescription: 'At 00:00, on the last day of the month',
        timezone: 'UTC',
        enabled: true,
        maxRetries: 2,
        autoPauseAfterFailures: 3,
        consecutiveFailures: 2,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        keepLast: null,
      };

      const cardHtml = win.renderScheduleCardHtml(powerSchedule);
      expect(cardHtml).toContain('2x Retries');
      expect(cardHtml).toContain('Auto-pause (3x)');
      expect(cardHtml).toContain('2 Failures');
      expect(cardHtml).toContain('Expires:');

      // Snapshot retention badge
      const snapSchedule = {
        id: 'sched-snap-power',
        name: 'DB Backup',
        targetType: 'snapshot',
        targetId: 'data.db',
        cronExpression: '0 0 * * *',
        timezone: 'UTC',
        enabled: true,
        keepLast: 7,
      };
      const snapCardHtml = win.renderScheduleCardHtml(snapSchedule);
      expect(snapCardHtml).toContain('Retain 7');

      // 4. Run row retry badge and detail drawer attempt count
      const runWithRetry = {
        id: 'run-retry-1',
        scheduleId: 'sched-power',
        scheduleName: 'Critical Sync Schedule',
        targetType: 'function',
        targetId: 'fn-sync',
        startedAt: new Date().toISOString(),
        status: 'succeeded',
        durationMs: 45,
        attempt: 2,
      };

      const rowHtml = win.renderRunRowHtml(runWithRetry);
      expect(rowHtml).toContain('Retry #2');

      win.cronState.runs = [runWithRetry];
      win.openRunDetailDrawer('run-retry-1');
      const detailDrawer = win.document.getElementById('run-detail-panel');
      expect(detailDrawer.innerHTML).toContain('Attempt Count');
      expect(detailDrawer.innerHTML).toContain('2');

      win.closeRunDetailDrawer();
      win.closeScheduleDrawer();
    });

    it('fetchDemoStatus should parse array responses from GET /api/cron/schedules and populate state.snapshotSchedule', async () => {
      const { JSDOM } = await import('jsdom');
      const uiDir = path.resolve(__dirname, '../src/admin/ui');
      const bundledHtml = AdminUIBundler.bundle(uiDir);

      const dom = new JSDOM(bundledHtml, {
        runScripts: 'dangerously',
        url: 'http://localhost:8297/_/',
      });

      const win = dom.window as any;

      const snapScheduleItem = {
        id: 'sched-snap-1',
        name: 'Automated Snapshot Backup',
        targetType: 'snapshot',
        targetId: 'snapshot_auto',
        cronExpression: '0 2 * * *',
        timezone: 'UTC',
        missedRunPolicy: 'catch_up_once',
        enabled: true,
        nextRunAt: '2026-11-22T02:00:00.000Z',
      };

      // Mock api() to return snapshot info and array response from cron schedules endpoint
      win.api = async (url: string) => {
        if (url === '/api/snapshots') {
          return { hasSnapshot: true, supported: true, snapshots: [], total: 0 };
        }
        if (url.includes('/cron/schedules')) {
          // Returns array directly per CronController.getSchedules
          return [snapScheduleItem];
        }
        return {};
      };

      await win.fetchDemoStatus();

      expect(win.state.snapshotSchedule).not.toBeNull();
      expect(win.state.snapshotSchedule?.id).toBe('sched-snap-1');
      expect(win.state.snapshotSchedule?.cronExpression).toBe('0 2 * * *');

      // Verify rendering of automated scheduled backup card
      const cardHtml = win.renderScheduledBackupsCardHtml();
      expect(cardHtml).toContain('Automated Scheduled Backups');
      expect(cardHtml).toContain('Active');
      expect(cardHtml).toContain('0 2 * * *');

      // Verify openSnapshotScheduleModal selects missedRunPolicy
      snapScheduleItem.missedRunPolicy = 'skip';
      win.openSnapshotScheduleModal();
      const policySelect = win.document.getElementById('snap-sched-policy') as HTMLSelectElement;
      expect(policySelect).not.toBeNull();
      expect(policySelect.value).toBe('skip');

      // Verify saveSnapshotScheduleModal passes missedRunPolicy in PATCH payload
      let savedBody: any = null;
      win.api = async (url: string, opts: any) => {
        if (opts?.method === 'PATCH') {
          savedBody = JSON.parse(opts.body);
          return { ...snapScheduleItem, ...savedBody };
        }
        return {};
      };
      await win.saveSnapshotScheduleModal({ preventDefault: () => {} });
      expect(savedBody).not.toBeNull();
      expect(savedBody.missedRunPolicy).toBe('skip');
    });
  });
});
