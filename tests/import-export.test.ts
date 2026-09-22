import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { CsvHelper } from '../src/records/CsvHelper';

describe('CSV & JSON Import / Export Integration Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_import_export_data');
  let app: NodeStack;
  let adminToken = '';

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDir,
      port: 8103,
      appName: 'Import-Export Test App',
    });

    // Create initial admin
    const admin = await app.auth.createAdmin('admin@nodestack.io', 'supersecret123');
    const authRes = await app.auth.authenticateAdmin('admin@nodestack.io', 'supersecret123');
    adminToken = authRes.token;

    // Create a test collection 'products'
    app.schema.createCollection({
      name: 'products',
      type: 'base',
      schema: [
        { id: 'f_title', name: 'title', type: 'text', required: true },
        { id: 'f_description', name: 'description', type: 'text' },
        { id: 'f_price', name: 'price', type: 'number', defaultValue: 0 },
        { id: 'f_in_stock', name: 'in_stock', type: 'bool', defaultValue: true },
        {
          id: 'f_category',
          name: 'category',
          type: 'select',
          options: { values: ['electronics', 'apparel', 'food', 'books'] },
        },
        { id: 'f_metadata', name: 'metadata', type: 'json' },
      ],
      listRule: '', // public list
      viewRule: '', // public view
      createRule: '', // public create
      updateRule: '', // public update
      deleteRule: '', // public delete
    });
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('CsvHelper Unit Tests', () => {
    it('should detect delimiters correctly', () => {
      expect(CsvHelper.detectDelimiter('name,age,city\nAlice,30,NY')).toBe(',');
      expect(CsvHelper.detectDelimiter('name;age;city\nAlice;30;NY')).toBe(';');
      expect(CsvHelper.detectDelimiter('name\tage\tcity\nAlice\t30\tNY')).toBe('\t');
    });

    it('should parse RFC 4180 CSV with quotes, commas, and newlines in cells', () => {
      const csv = `title,description,price\r\n"Laptop, Pro 15""","Line 1\r\nLine 2",1299.99\r\nPhone,"Simple description",599`;
      const parsed = CsvHelper.parse(csv);

      expect(parsed.length).toBe(2);
      expect(parsed[0].title).toBe('Laptop, Pro 15"');
      expect(parsed[0].description).toBe('Line 1\r\nLine 2');
      expect(parsed[0].price).toBe('1299.99');

      expect(parsed[1].title).toBe('Phone');
      expect(parsed[1].description).toBe('Simple description');
      expect(parsed[1].price).toBe('599');
    });

    it('should serialize records properly escaping quotes and delimiters', () => {
      const headers = ['id', 'title', 'in_stock', 'meta'];
      const items = [
        { id: '1', title: 'Widget, "Deluxe"', in_stock: true, meta: { tags: ['sale'] } },
        { id: '2', title: 'Plain Item', in_stock: false, meta: null },
      ];

      const serialized = CsvHelper.serialize(headers, items);
      expect(serialized).toContain('"Widget, ""Deluxe"""');
      expect(serialized).toContain('true');
      expect(serialized).toContain('"{""tags"":[""sale""]}"');
      expect(serialized).toContain('Plain Item');

      // Parsing it back should match original values
      const roundTrip = CsvHelper.parse(serialized);
      expect(roundTrip[0].title).toBe('Widget, "Deluxe"');
      expect(roundTrip[0].in_stock).toBe('true');
      expect(roundTrip[1].title).toBe('Plain Item');
    });
  });

  describe('Batch Import API (POST /api/collections/:collection/import)', () => {
    it('should import multiple records via JSON array', async () => {
      const payload = {
        records: [
          { title: 'Keyboard Mechanical', price: 89.99, in_stock: true, category: 'electronics' },
          { title: 'Wireless Mouse', price: 39.5, in_stock: true, category: 'electronics' },
          { title: 'Cotton T-Shirt', price: 19.99, in_stock: false, category: 'apparel' },
        ],
      };

      const res = await app.server.app.inject({
        method: 'POST',
        url: '/api/collections/products/import',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.success).toBe(true);
      expect(data.total).toBe(3);
      expect(data.imported).toBe(3);
      expect(data.failed).toBe(0);

      // Verify records are actually in database
      const list = await app.records.getList('products');
      expect(list.totalItems).toBe(3);
      const keyboard = list.items.find((i) => i.title === 'Keyboard Mechanical');
      expect(keyboard).toBeDefined();
      expect(keyboard.price).toBe(89.99);
      expect(keyboard.in_stock).toBe(true);
    });

    it('should import raw CSV text via Content-Type: text/csv', async () => {
      const csvData = [
        'title,description,price,in_stock,category',
        '"Noise Cancelling Headphones","High fidelity sound, with ANC",249.99,true,electronics',
        'Coffee Mug,"Ceramic, 350ml",12.50,true,food',
      ].join('\r\n');

      const res = await app.server.app.inject({
        method: 'POST',
        url: '/api/collections/products/import',
        headers: {
          'Content-Type': 'text/csv',
          Authorization: `Bearer ${adminToken}`,
        },
        body: csvData,
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.imported).toBe(2);

      const list = await app.records.getList('products', { filter: "title ~ 'Headphones'" });
      expect(list.totalItems).toBe(1);
      expect(list.items[0].description).toBe('High fidelity sound, with ANC');
      expect(list.items[0].price).toBe(249.99);
    });

    it('should report errors for invalid rows with continueOnError: true', async () => {
      const payload = {
        records: [
          { title: 'Valid Book', price: 15, category: 'books' },
          { title: '', price: 10, category: 'books' }, // Missing required title
          { title: 'Invalid Category Item', price: 50, category: 'invalid_category_xyz' }, // Invalid select
          { title: 'Another Valid Book', price: 20, category: 'books' },
        ],
        options: { continueOnError: true },
      };

      const res = await app.server.app.inject({
        method: 'POST',
        url: '/api/collections/products/import',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.total).toBe(4);
      expect(data.imported).toBe(2);
      expect(data.failed).toBe(2);
      expect(data.errors.length).toBe(2);
      expect(data.errors[0].row).toBe(2);
      expect(data.errors[0].error).toContain("Field 'title' is required");
      expect(data.errors[1].row).toBe(3);
      expect(data.errors[1].error).toContain("Invalid value for select field 'category'");
    });

    it('should rollback entire transaction if continueOnError: false', async () => {
      const payload = {
        records: [
          { title: 'Should Not Be Saved 1', price: 10, category: 'books' },
          { title: '', price: 10, category: 'books' }, // missing required title
        ],
        options: { continueOnError: false },
      };

      const res = await app.server.app.inject({
        method: 'POST',
        url: '/api/collections/products/import',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        payload,
      });

      expect(res.statusCode).toBe(422);

      // Verify "Should Not Be Saved 1" was not inserted
      const list = await app.records.getList('products', { filter: "title ~ 'Should Not Be Saved'" });
      expect(list.totalItems).toBe(0);
    });

    it('should import into auth collection and hash passwords', async () => {
      const payload = {
        records: [
          { email: 'bob@example.com', password: 'password123', name: 'Bob Smith' },
          { email: 'carol@example.com', password: 'password456', name: 'Carol White' },
        ],
      };

      const res = await app.server.app.inject({
        method: 'POST',
        url: '/api/collections/users/import',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.imported).toBe(2);

      // Authenticate imported user
      const login = await app.auth.authenticateRecord('users', 'bob@example.com', 'password123');
      expect(login.token).toBeDefined();
      expect(login.record.email).toBe('bob@example.com');
      expect(login.record.passwordHash).toBeUndefined();
    });
  });

  describe('One-Click Export API (GET /api/collections/:collection/export)', () => {
    it('should export all records as CSV with attachment headers', async () => {
      const res = await app.server.app.inject({
        method: 'GET',
        url: '/api/collections/products/export?format=csv',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('.csv');

      const csvContent = res.payload;
      const parsed = CsvHelper.parse(csvContent);
      expect(parsed.length).toBeGreaterThanOrEqual(7);

      // Verify columns present
      const firstRow = parsed[0];
      expect(firstRow).toHaveProperty('id');
      expect(firstRow).toHaveProperty('title');
      expect(firstRow).toHaveProperty('price');
      expect(firstRow).toHaveProperty('in_stock');
      expect(firstRow).toHaveProperty('created');
      expect(firstRow).toHaveProperty('updated');
    });

    it('should export via alias route /api/collections/:collection/export/csv', async () => {
      const res = await app.server.app.inject({
        method: 'GET',
        url: '/api/collections/products/export/csv',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const lines = res.payload.split(/\r?\n/);
      expect(lines[0]).toContain('id,title,description,price,in_stock,category,metadata,created,updated');
    });

    it('should export all records as JSON array', async () => {
      const res = await app.server.app.inject({
        method: 'GET',
        url: '/api/collections/products/export?format=json',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['content-disposition']).toContain('.json');

      const json = JSON.parse(res.payload);
      expect(Array.isArray(json)).toBe(true);
      expect(json.length).toBeGreaterThanOrEqual(7);
      expect(json[0].id).toBeDefined();
      expect(json[0].title).toBeDefined();
    });

    it('should respect filter parameter during export', async () => {
      const res = await app.server.app.inject({
        method: 'GET',
        url: '/api/collections/products/export?format=json&filter=' + encodeURIComponent("category = 'electronics'"),
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(Array.isArray(json)).toBe(true);
      expect(json.length).toBeGreaterThan(0);
      for (const item of json) {
        expect(item.category).toBe('electronics');
      }
    });

    it('should not leak sensitive passwordHash or tokenKey when exporting auth collection', async () => {
      const res = await app.server.app.inject({
        method: 'GET',
        url: '/api/collections/users/export?format=json',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const users = JSON.parse(res.payload);
      expect(users.length).toBeGreaterThanOrEqual(2);
      for (const u of users) {
        expect(u.passwordHash).toBeUndefined();
        expect(u.tokenKey).toBeUndefined();
        expect(u.email).toBeDefined();
      }
    });

    it('should allow authentication via query parameter token for direct browser downloads', async () => {
      const res = await app.server.app.inject({
        method: 'GET',
        url: `/api/collections/products/export?format=csv&token=${adminToken}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
    });
  });
});
