import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import {
  SchemaInferenceService,
  inferFieldType,
  isDateString,
  sanitizeFieldName,
  parsePayload,
} from '../src/schema/SchemaInferenceService';
import { NodeStackClient } from '../packages/client/src/index';

describe('"Paste JSON → Instant API" (Schema Auto-Inference) Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_schema_inference_data');
  let app: NodeStack;
  let adminToken = '';
  let client: NodeStackClient;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDir,
      port: 8104,
      appName: 'Schema Inference Test App',
    });

    await app.start(8104);

    // Create superuser
    await app.auth.createAdmin('admin@nodestack.io', 'supersecret123');
    const authRes = await app.auth.authenticateAdmin('admin@nodestack.io', 'supersecret123');
    adminToken = authRes.token;

    const { MemoryAuthStore } = await import('../packages/client/src/auth/MemoryAuthStore');
    client = new NodeStackClient('http://127.0.0.1:8104', {
      authStore: new MemoryAuthStore(),
    });
    await client.admins.authWithPassword('admin@nodestack.io', 'supersecret123');
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ==========================================
  // Unit Tests: Helper Functions
  // ==========================================
  describe('Unit Tests: Type Inference & Parsing', () => {
    it('isDateString should accurately detect ISO and standard date formats', () => {
      // Valid date formats
      expect(isDateString('2026-09-24T07:59:07Z')).toBe(true);
      expect(isDateString('2026-09-24T07:59:07.123Z')).toBe(true);
      expect(isDateString('2026-09-24T07:59:07+05:30')).toBe(true);
      expect(isDateString('2026-09-24')).toBe(true);
      expect(isDateString('2026/09/24')).toBe(true);
      expect(isDateString('2026-09-24 15:30:00')).toBe(true);

      // Invalid / non-dates
      expect(isDateString('Hello World')).toBe(false);
      expect(isDateString('12345678')).toBe(false);
      expect(isDateString('2026')).toBe(false);
      expect(isDateString('true')).toBe(false);
      expect(isDateString('')).toBe(false);
      expect(isDateString(null)).toBe(false);
      expect(isDateString(12345678)).toBe(false);
    });

    it('inferFieldType should detect text, number, bool, date, and json correctly', () => {
      // Booleans
      expect(inferFieldType([true, false, true])).toBe('bool');
      expect(inferFieldType([true, null, false])).toBe('bool');
      expect(inferFieldType(['true', 'false'])).toBe('bool');

      // Numbers
      expect(inferFieldType([10, 20.5, -5])).toBe('number');
      expect(inferFieldType([0, 100, null])).toBe('number');
      expect(inferFieldType(['10', '20.5', '-5'])).toBe('number');

      // Dates
      expect(inferFieldType(['2026-01-15T00:00:00Z', '2026-02-20T12:00:00Z'])).toBe('date');
      expect(inferFieldType(['2026-01-15', null, '2026-03-30'])).toBe('date');

      // JSON (objects & arrays)
      expect(inferFieldType([{ color: 'blue' }, { color: 'red' }])).toBe('json');
      expect(inferFieldType([['tag1', 'tag2'], ['tag3']])).toBe('json');
      expect(inferFieldType([null, { nested: true }])).toBe('json');

      // Text (strings, mixed types)
      expect(inferFieldType(['Alice', 'Bob'])).toBe('text');
      expect(inferFieldType(['product_1', 'product_2'])).toBe('text');
      expect(inferFieldType([10, 'mixed_string'])).toBe('text');
      expect(inferFieldType([null, undefined, ''])).toBe('text');
    });

    it('sanitizeFieldName should sanitize invalid characters and prevent collisions', () => {
      const existing = new Set<string>(['id', 'created', 'updated']);

      expect(sanitizeFieldName('title', existing)).toBe('title');
      expect(sanitizeFieldName('First Name', existing)).toBe('First_Name');
      expect(sanitizeFieldName('order-total ($)', existing)).toBe('order_total');
      expect(sanitizeFieldName('1st_item', existing)).toBe('f_1st_item');
      expect(sanitizeFieldName('__temp__', existing)).toBe('temp');

      // Collisions
      const field1 = sanitizeFieldName('category', existing);
      expect(field1).toBe('category');
      const field2 = sanitizeFieldName('category', existing);
      expect(field2).toBe('category_2');
    });

    it('parsePayload should unwrap single objects, arrays, and wrapper objects', () => {
      // Array
      const arr = [{ name: 'Item 1' }, { name: 'Item 2' }];
      expect(parsePayload(arr).records).toHaveLength(2);

      // Single object
      const single = { name: 'Item 1', price: 99 };
      const resSingle = parsePayload(single);
      expect(resSingle.records).toHaveLength(1);
      expect(resSingle.records[0].name).toBe('Item 1');

      // JSON string
      const str = JSON.stringify([{ id: 1 }, { id: 2 }]);
      expect(parsePayload(str).records).toHaveLength(2);

      // Wrapper: { "products": [ ... ] }
      const wrapper = { products: [{ name: 'Laptop' }, { name: 'Mouse' }] };
      const resWrapper = parsePayload(wrapper);
      expect(resWrapper.records).toHaveLength(2);
      expect(resWrapper.suggestedName).toBe('products');

      // Wrapper: { "data": [ ... ] }
      const dataWrapper = { data: [{ name: 'A' }], collection: 'custom_col' };
      const resData = parsePayload(dataWrapper);
      expect(resData.records).toHaveLength(1);
      expect(resData.suggestedName).toBe('custom_col');
    });

    it('parsePayload should throw ValidationError on invalid inputs', () => {
      expect(() => parsePayload('')).toThrow('JSON payload cannot be empty');
      expect(() => parsePayload('invalid-json')).toThrow('Invalid JSON format');
      expect(() => parsePayload([])).toThrow('JSON array must contain at least one item');
      expect(() => parsePayload([1, 2, 3])).toThrow('JSON array items must be objects');
      expect(() => parsePayload({})).toThrow('JSON object cannot be empty');
      expect(() => parsePayload(42)).toThrow('JSON payload must be an object or an array of objects');
    });
  });

  // ==========================================
  // Direct Service Tests
  // ==========================================
  describe('SchemaInferenceService Direct Integration', () => {
    it('should infer schema from diverse JSON payload with text, number, bool, date, json', () => {
      const mockPayload = [
        {
          id: 'mock_1',
          name: 'Mechanical Gaming Keyboard',
          price: 129.99,
          inStock: true,
          releasedAt: '2026-01-10T08:00:00Z',
          specs: { switch: 'Red', rgb: true },
        },
        {
          id: 'mock_2',
          name: 'Wireless Mouse',
          price: 69.5,
          inStock: false,
          releasedAt: '2026-02-14T09:30:00Z',
          specs: { dpi: 16000, wireless: true },
          rating: 4.8, // sparse field only in record 2
        },
      ];

      const inference = app.schemaInference.inferSchema(mockPayload);

      expect(inference.recordCount).toBe(2);
      expect(inference.records).toHaveLength(2);

      // "id" is system column, so it must not be in fields
      expect(inference.fields.find((f) => f.name === 'id')).toBeUndefined();

      const nameField = inference.fields.find((f) => f.name === 'name');
      expect(nameField?.type).toBe('text');

      const priceField = inference.fields.find((f) => f.name === 'price');
      expect(priceField?.type).toBe('number');

      const stockField = inference.fields.find((f) => f.name === 'inStock');
      expect(stockField?.type).toBe('bool');

      const dateField = inference.fields.find((f) => f.name === 'releasedAt');
      expect(dateField?.type).toBe('date');

      const specsField = inference.fields.find((f) => f.name === 'specs');
      expect(specsField?.type).toBe('json');

      const ratingField = inference.fields.find((f) => f.name === 'rating');
      expect(ratingField?.type).toBe('number');
    });

    it('should import single JSON object, create collection, SQLite columns, and populate record in < 1 second', async () => {
      const singleJson = {
        title: 'Instant API Launch Announcement',
        views: 1500,
        published: true,
        publishedAt: '2026-09-24T00:00:00Z',
        metadata: { tags: ['release', 'developer-experience'], author: 'NodeStack Team' },
      };

      const start = Date.now();
      const res = await app.schemaInference.importJson({
        name: 'announcements',
        data: singleJson,
      });
      const duration = Date.now() - start;

      // Must complete in under 1 second (1000ms)
      expect(duration).toBeLessThan(1000);
      expect(res.durationMs).toBeLessThan(1000);

      expect(res.success).toBe(true);
      expect(res.collection.name).toBe('announcements');
      expect(res.recordCount).toBe(1);
      expect(res.records).toHaveLength(1);

      // Verify created SQLite table and columns
      const tableInfo = app.db.all<any>('PRAGMA table_info("announcements")');
      const colNames = tableInfo.map((c) => c.name);
      expect(colNames).toContain('id');
      expect(colNames).toContain('title');
      expect(colNames).toContain('views');
      expect(colNames).toContain('published');
      expect(colNames).toContain('publishedAt');
      expect(colNames).toContain('metadata');
      expect(colNames).toContain('created');
      expect(colNames).toContain('updated');

      // Verify record via RecordService
      const list = await app.records.getList('announcements');
      expect(list.totalItems).toBe(1);
      const record = list.items[0];
      expect(record.title).toBe('Instant API Launch Announcement');
      expect(record.views).toBe(1500);
      expect(record.published).toBe(true);
      expect(record.metadata).toEqual({
        tags: ['release', 'developer-experience'],
        author: 'NodeStack Team',
      });
    });

    it('should import array of 100 records and populate SQLite table in well under 1 second', async () => {
      const records = [];
      for (let i = 1; i <= 100; i++) {
        records.push({
          sku: `SKU-${1000 + i}`,
          cost: parseFloat((i * 2.5).toFixed(2)),
          active: i % 2 === 0,
          registeredAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
          attributes: { batch: Math.floor(i / 10), verified: true },
        });
      }

      const start = Date.now();
      const res = await app.schemaInference.importJson({
        name: 'inventory_items',
        data: records,
      });
      const duration = Date.now() - start;

      // High-speed transaction check
      expect(duration).toBeLessThan(1000);
      expect(res.recordCount).toBe(100);

      const countRow = app.db.get<any>('SELECT COUNT(*) as cnt FROM "inventory_items"');
      expect(countRow.cnt).toBe(100);

      // Verify boolean and JSON conversions
      const sample = await app.records.getList('inventory_items', { perPage: 2 });
      expect(typeof sample.items[0].active).toBe('boolean');
      expect(typeof sample.items[0].attributes).toBe('object');
      expect(sample.items[0].attributes.verified).toBe(true);
    });

    it('should respect custom schemaOverrides when user edits inferred types', async () => {
      const payload = [
        { code: '00123', status: 1 },
        { code: '00456', status: 2 },
      ];

      // Code would normally be string (text) or numeric. Suppose user wants code as text and status as text
      const res = await app.schemaInference.importJson({
        name: 'discount_codes',
        data: payload,
        schemaOverrides: [
          { name: 'status', type: 'text' },
        ],
      });

      const statusField = res.collection.schema.find((f) => f.name === 'status');
      expect(statusField?.type).toBe('text');
    });

    it('should reject importing duplicate collection names with ConflictError (409)', async () => {
      await expect(
        app.schemaInference.importJson({
          name: 'announcements', // already created
          data: [{ test: 123 }],
        })
      ).rejects.toThrow(/already exists/i);
    });
  });

  // ==========================================
  // HTTP REST API Endpoints Tests
  // ==========================================
  describe('HTTP REST API Endpoints', () => {
    it('POST /api/collections/infer-schema should analyze payload and return inferred schema preview', async () => {
      const res = await app.server.app.inject({
        method: 'POST',
        url: '/api/collections/infer-schema',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          data: [
            {
              title: 'TypeScript 5.8 Release',
              stars: 95000,
              isOfficial: true,
              date: '2026-03-01T12:00:00Z',
              tags: ['typescript', 'javascript'],
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.recordCount).toBe(1);
      expect(json.fields).toBeDefined();
      expect(json.fields.length).toBe(5);

      const fieldTypes = Object.fromEntries(json.fields.map((f: any) => [f.name, f.type]));
      expect(fieldTypes.title).toBe('text');
      expect(fieldTypes.stars).toBe('number');
      expect(fieldTypes.isOfficial).toBe('bool');
      expect(fieldTypes.date).toBe('date');
      expect(fieldTypes.tags).toBe('json');
    });

    it('POST /api/collections/import-json should create collection and populate records instantly', async () => {
      const res = await app.server.app.inject({
        method: 'POST',
        url: '/api/collections/import-json',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          name: 'tech_conferences',
          data: [
            {
              id: 'conf_1',
              title: 'NodeStack Summit 2026',
              attendees: 1200,
              virtual: true,
              startDate: '2026-06-15T09:00:00Z',
              sponsors: ['Acme Corp', 'CloudTech'],
            },
            {
              id: 'conf_2',
              title: 'TypeScript Global',
              attendees: 2500,
              virtual: false,
              startDate: '2026-08-20T09:00:00Z',
              sponsors: ['DevInc'],
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const json = JSON.parse(res.body);
      expect(json.success).toBe(true);
      expect(json.collection.name).toBe('tech_conferences');
      expect(json.recordCount).toBe(2);
      expect(json.records).toHaveLength(2);
      expect(json.durationMs).toBeLessThan(1000);

      // Verify records are immediately accessible via standard records endpoint
      const recordsRes = await app.server.app.inject({
        method: 'GET',
        url: '/api/collections/tech_conferences/records',
      });
      expect(recordsRes.statusCode).toBe(200);
      const recordsJson = JSON.parse(recordsRes.body);
      expect(recordsJson.totalItems).toBe(2);
      expect(recordsJson.items[0].title).toBe('NodeStack Summit 2026');
      expect(recordsJson.items[0].attendees).toBe(1200);
      expect(recordsJson.items[0].virtual).toBe(true);
      expect(recordsJson.items[0].sponsors).toEqual(['Acme Corp', 'CloudTech']);
    });

    it('POST /api/collections/import-json should reject non-admin requests with 401/403', async () => {
      const res = await app.server.app.inject({
        method: 'POST',
        url: '/api/collections/import-json',
        payload: {
          name: 'unauthorized_col',
          data: [{ key: 'val' }],
        },
      });

      expect([401, 403]).toContain(res.statusCode);
    });
  });

  // ==========================================
  // Client SDK Integration Tests
  // ==========================================
  describe('NodeStackClient SDK Integration', () => {
    it('client.collections.inferSchema should infer schema from raw JSON', async () => {
      const result = await client.collections.inferSchema([
        {
          name: 'Client Test Product',
          price: 49.99,
          active: true,
          createdDate: '2026-04-10T12:00:00Z',
          metadata: { inStock: true },
        },
      ]);

      expect(result.recordCount).toBe(1);
      expect(result.fields).toBeDefined();
      expect(result.fields.length).toBe(5);
    });

    it('client.collections.importJson should create collection and return typed result', async () => {
      const start = Date.now();
      const result = await client.collections.importJson('sdk_imported_items', [
        { item: 'Monitor', cost: 299, inStock: true },
        { item: 'Desk', cost: 450, inStock: false },
      ]);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
      expect(result.success).toBe(true);
      expect(result.collection.name).toBe('sdk_imported_items');
      expect(result.recordCount).toBe(2);

      // Verify with client.collection().getList()
      const list = await client.collection('sdk_imported_items').getList();
      expect(list.totalItems).toBe(2);
      expect(list.items[0].item).toBe('Monitor');
      expect(list.items[0].cost).toBe(299);
      expect(list.items[0].inStock).toBe(true);
    });
  });

  // ==========================================
  // CLI Command Integration
  // ==========================================
  describe('CLI Command Integration', () => {
    it('nodestack import-json should import from JSON file via CLI', async () => {
      const { runCli } = await import('../src/cli/cli');
      const tempJsonFile = path.resolve(testDir, 'temp_mock_data.json');
      fs.writeFileSync(
        tempJsonFile,
        JSON.stringify([
          { name: 'CLI Item 1', score: 98, active: true },
          { name: 'CLI Item 2', score: 85, active: false },
        ]),
        'utf-8'
      );

      await runCli([
        'node',
        'nodestack',
        'import-json',
        'cli_items',
        tempJsonFile,
        '-d',
        testDir,
      ]);

      const list = await app.records.getList('cli_items');
      expect(list.totalItems).toBe(2);
      expect(list.items[0].name).toBe('CLI Item 1');
      expect(list.items[0].score).toBe(98);
      expect(list.items[0].active).toBe(true);
    });
  });

  // ==========================================
  // Admin UI Bundler Verification
  // ==========================================
  describe('Admin UI Integration', () => {
    it('should include "Import from JSON" and schema auto-inference modal in Admin UI', () => {
      const html = app.adminUi.getHtml();

      expect(html).toContain('openImportJsonModal');
      expect(html).toContain('Import from JSON');
      expect(html).toContain('Paste JSON → Instant API');
      expect(html).toContain('loadSampleJson');
      expect(html).toContain('submitImportJson');
      expect(html).toContain('onJsonInputChanged');
      expect(html).toContain('Auto-infer schema in 1 second');
    });
  });
});
