import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { AdminUIBundler } from '../src/admin/AdminUIBundler';
import { formatBytes } from '../src/analytics/AnalyticsService';

describe('Analytics & Metrics Subsystem', () => {
  const testDir = path.resolve(__dirname, '../.test_analytics_data');
  let app: NodeStack;
  let adminToken = '';

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDir,
      port: 8097,
    });

    // Create admin account
    const authRes = await app.auth.createAdmin('admin@nodestack.io', 'supersecret123');
    const login = await app.auth.authenticateAdmin('admin@nodestack.io', 'supersecret123');
    adminToken = login.token;

    // Create a couple of collections
    app.schema.createCollection({
      name: 'articles',
      type: 'base',
      schema: [
        { id: 'f1', name: 'title', type: 'text', required: true },
        { id: 'f2', name: 'views', type: 'number', defaultValue: 0 },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });

    app.schema.createCollection({
      name: 'comments',
      type: 'base',
      schema: [
        { id: 'c1', name: 'content', type: 'text', required: true },
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

  describe('formatBytes utility', () => {
    it('should format byte sizes into readable units', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(1073741824)).toBe('1 GB');
    });
  });

  describe('Database Metrics & Active Records Count', () => {
    it('should report database disk size and zero active records initially', () => {
      const dbMetrics = app.analytics.getDatabaseMetrics();

      expect(dbMetrics).toBeDefined();
      expect(dbMetrics.sizeBytes).toBeGreaterThan(0);
      expect(typeof dbMetrics.sizeFormatted).toBe('string');
      expect(dbMetrics.totalRecords).toBe(0);

      const articlesBreakdown = dbMetrics.collectionsBreakdown.find((c) => c.collection === 'articles');
      expect(articlesBreakdown).toBeDefined();
      expect(articlesBreakdown?.count).toBe(0);
    });

    it('should dynamically update totalRecords and collectionsBreakdown as records are added', async () => {
      // Add 3 articles
      await app.records.create('articles', { title: 'Article 1', views: 10 });
      await app.records.create('articles', { title: 'Article 2', views: 25 });
      await app.records.create('articles', { title: 'Article 3', views: 50 });

      // Add 2 comments
      await app.records.create('comments', { content: 'Nice read!' });
      await app.records.create('comments', { content: 'Helpful article' });

      const dbMetrics = app.analytics.getDatabaseMetrics();
      expect(dbMetrics.totalRecords).toBe(5);

      const articles = dbMetrics.collectionsBreakdown.find((c) => c.collection === 'articles');
      const comments = dbMetrics.collectionsBreakdown.find((c) => c.collection === 'comments');
      expect(articles?.count).toBe(3);
      expect(comments?.count).toBe(2);
    });
  });

  describe('Realtime Connected Clients Count', () => {
    it('should report connected SSE clients count', () => {
      expect(app.realtime.getConnectedClientsCount()).toBe(0);

      const realtimeMetrics = app.analytics.getRealtimeMetrics();
      expect(realtimeMetrics.connectedClients).toBe(0);
    });

    it('should reflect connected clients when registered and removed', () => {
      const fakeReply: any = {
        raw: {
          write: () => true,
          on: () => {},
          end: () => {},
        },
      };

      const clientId = app.realtime.registerClient(fakeReply);
      expect(app.realtime.getConnectedClientsCount()).toBe(1);
      expect(app.analytics.getRealtimeMetrics().connectedClients).toBe(1);

      app.realtime.removeClient(clientId);
      expect(app.realtime.getConnectedClientsCount()).toBe(0);
      expect(app.analytics.getRealtimeMetrics().connectedClients).toBe(0);
    });
  });

  describe('24h Traffic & Error Rate Analytics', () => {
    it('should return exactly 24 hourly data points in series', () => {
      const traffic = app.analytics.getTraffic24hMetrics();

      expect(traffic).toBeDefined();
      expect(Array.isArray(traffic.series)).toBe(true);
      expect(traffic.series.length).toBe(24);

      // Verify each series item has expected structure
      const point = traffic.series[0];
      expect(point.timestamp).toBeDefined();
      expect(point.hourKey).toBeDefined();
      expect(point.label).toBeDefined();
      expect(point.totalRequests).toBeGreaterThanOrEqual(0);
      expect(point.errorRequests).toBeGreaterThanOrEqual(0);
      expect(point.errorRate).toBeGreaterThanOrEqual(0);
    });

    it('should accurately aggregate request volume, error rate, and average latency', () => {
      // Simulate recent request logs
      app.logs.logRequest({
        method: 'GET',
        url: '/api/articles/records',
        status: 200,
        duration: 3.5,
      });

      app.logs.logRequest({
        method: 'POST',
        url: '/api/articles/records',
        status: 201,
        duration: 8.2,
      });

      app.logs.logRequest({
        method: 'GET',
        url: '/api/articles/records/invalid_id',
        status: 404,
        duration: 1.5,
      });

      app.logs.logRequest({
        method: 'POST',
        url: '/api/articles/records',
        status: 500,
        duration: 12.0,
      });

      const traffic = app.analytics.getTraffic24hMetrics();

      expect(traffic.totalRequests).toBeGreaterThanOrEqual(4);
      expect(traffic.totalErrors).toBeGreaterThanOrEqual(2);
      expect(traffic.overallErrorRate).toBeGreaterThan(0);
      expect(traffic.avgDuration).toBeGreaterThan(0);
      expect(traffic.peakHourRequests).toBeGreaterThanOrEqual(4);

      // Find current hour bucket in series
      const nowHourKey = new Date().toISOString().substring(0, 13);
      const currentHour = traffic.series.find((s) => s.hourKey === nowHourKey);

      expect(currentHour).toBeDefined();
      expect(currentHour!.totalRequests).toBeGreaterThanOrEqual(4);
      expect(currentHour!.errorRequests).toBeGreaterThanOrEqual(2);
      expect(currentHour!.successRequests).toBeGreaterThanOrEqual(2);
      expect(currentHour!.errorRate).toBeGreaterThan(0);
    });
  });

  describe('HTTP API Endpoints: GET /api/metrics', () => {
    it('should reject unauthenticated requests to /api/metrics with 403', async () => {
      const res = await app.server.app.inject({
        method: 'GET',
        url: '/api/metrics',
      });

      expect(res.statusCode).toBe(403);
    });

    it('should return complete analytics metrics for authorized admin', async () => {
      const res = await app.server.app.inject({
        method: 'GET',
        url: '/api/metrics',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);

      expect(data.database).toBeDefined();
      expect(data.database.totalRecords).toBe(5);
      expect(data.database.sizeBytes).toBeGreaterThan(0);
      expect(data.database.sizeFormatted).toBeDefined();
      expect(data.database.collectionsBreakdown.length).toBeGreaterThanOrEqual(2);

      expect(data.realtime).toBeDefined();
      expect(typeof data.realtime.connectedClients).toBe('number');

      expect(data.traffic24h).toBeDefined();
      expect(data.traffic24h.series.length).toBe(24);
      expect(data.traffic24h.totalRequests).toBeGreaterThanOrEqual(4);

      expect(data.system).toBeDefined();
      expect(data.system.uptime).toBeGreaterThan(0);
    });
  });

  describe('OpenAPI & Bundling Integration', () => {
    it('should include /api/metrics in generated OpenAPI document', () => {
      const spec = app.generateOpenApi();

      expect(spec.paths['/api/metrics']).toBeDefined();
      expect(spec.paths['/api/metrics'].get).toBeDefined();
      expect(spec.paths['/api/metrics'].get.tags).toContain('System');
      expect(spec.components.schemas.AnalyticsMetricsResponse).toBeDefined();
      expect(spec.components.schemas.HourlyDataPoint).toBeDefined();
    });

    it('should bundle analytics.css and analytics.js in AdminUIBundler', () => {
      const uiDir = path.resolve(__dirname, '../src/admin/ui');
      const bundled = AdminUIBundler.bundle(uiDir);

      expect(bundled).toBeDefined();
      // Should include inlined CSS
      expect(bundled).toContain('.analytics-container');
      expect(bundled).toContain('.live-pulse-dot');
      expect(bundled).toContain('.chart-svg-container');

      // Should include inlined JS
      expect(bundled).toContain('renderAnalyticsView');
      expect(bundled).toContain('loadAnalytics');
      expect(bundled).toContain('drawThroughputChart');
      expect(bundled).toContain('drawErrorRateChart');
      expect(bundled).toContain('nav-analytics');
    });
  });
});
