import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { NodeStack } from '../src/NodeStack';
import { runCli } from '../src/cli/cli';
import { ConfigService } from '../src/core/config/ConfigService';
import { DatabaseService } from '../src/database/DatabaseService';
import { SchemaService } from '../src/schema/SchemaService';
import { FtsService } from '../src/records/FtsService';
import { RecordService } from '../src/records/RecordService';
import { RuleEngine } from '../src/rules/RuleEngine';
import { EventBus } from '../src/core/events/EventBus';
import { RealtimeService } from '../src/realtime/RealtimeService';
import { ViewQueryValidator } from '../src/schema/ViewQueryValidator';
import { ViewSchemaInferrer } from '../src/schema/ViewSchemaInferrer';
import { OpenApiGenerator } from '../src/schema/OpenApiGenerator';
import { NodeSqliteDriver } from '../src/database/drivers/NodeSqliteDriver';
import { AdminUIBundler } from '../src/admin/AdminUIBundler';
import { NodeStackClient, ClientResponseError, MemoryAuthStore } from '../packages/client/src';

describe('SQL View Dependency Validation, Force & Cascade', () => {
  describe('ViewQueryValidator dependency & SQL rewrite helpers', () => {
    it('extracts referenced collections across JOINs/subqueries while ignoring CTEs, strings, and comments', () => {
      const known = ['orders', 'customers', 'products', 'cte_temp', 'other_view'];
      const sql = `
        -- FROM other_view inside comment should be ignored
        WITH cte_temp AS (
          SELECT c.id, c.name FROM "customers" c
        )
        SELECT o.id, ct.name, 'FROM products' AS literal_text
        FROM orders o
        LEFT JOIN cte_temp ct ON ct.id = o.customerId
      `;

      const refs = ViewQueryValidator.extractReferencedCollections(sql, known);
      expect(refs).toEqual(expect.arrayContaining(['customers', 'orders']));
      expect(refs).not.toContain('cte_temp');
      expect(refs).not.toContain('products');
      expect(refs).not.toContain('other_view');
    });

    it('rewrites collection references across SQL dialects while preserving aliases, CTEs, and strings', () => {
      const sqliteSql = `SELECT id, 'orders' AS src FROM "orders" WHERE status = 'paid'`;
      expect(ViewQueryValidator.rewriteCollectionReference(sqliteSql, 'orders', 'sales_orders')).toBe(
        `SELECT id, 'orders' AS src FROM "sales_orders" WHERE status = 'paid'`
      );

      const mssqlSql = `SELECT o.id FROM [orders] o JOIN [items] i ON i.orderId = o.id`;
      expect(ViewQueryValidator.rewriteCollectionReference(mssqlSql, 'orders', 'sales_orders')).toBe(
        `SELECT o.id FROM [sales_orders] o JOIN [items] i ON i.orderId = o.id`
      );

      const mysqlOrPgSql = 'SELECT orders.id FROM `orders` -- keep orders in comment';
      const rewritten = ViewQueryValidator.rewriteCollectionReference(mysqlOrPgSql, 'orders', 'sales_orders');
      expect(rewritten).toContain('FROM `sales_orders`');
      expect(rewritten).toContain('-- keep orders in comment');

      const cteSql = `WITH orders AS (SELECT id FROM items) SELECT id FROM orders`;
      expect(ViewQueryValidator.rewriteCollectionReference(cteSql, 'orders', 'sales_orders')).toBe(cteSql);
    });
  });

  describe('SchemaService direct dependency guard & cascade behavior (SQLite)', () => {
    const testDir = path.resolve(__dirname, `../.test_view_deps_schema_${Date.now()}`);
    let db: DatabaseService;
    let fts: FtsService;
    let schema: SchemaService;
    let records: RecordService;

    beforeEach(async () => {
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
      fs.mkdirSync(testDir, { recursive: true });

      const config = new ConfigService({ dataDir: testDir });
      db = new DatabaseService(config, new NodeSqliteDriver(':memory:'));
      db.initSync();
      fts = new FtsService(db);
      schema = new SchemaService(db, fts);
      const ruleEngine = new RuleEngine();
      const eventBus = new EventBus();
      const realtime = new RealtimeService(ruleEngine, schema);
      records = new RecordService(db, schema, ruleEngine, eventBus, realtime, undefined, fts);

      schema.createCollection({
        name: 'orders',
        type: 'base',
        schema: [
          { id: 'f1', name: 'customer', type: 'text', required: true },
          { id: 'f2', name: 'total', type: 'number', required: true },
        ],
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
      });

      await records.create('orders', { customer: 'Alice', total: 120 });
      await records.create('orders', { customer: 'Bob', total: 80 });

      schema.createCollection({
        name: 'order_summary',
        type: 'view',
        options: {
          viewQueries: {
            sqlite: 'SELECT id, customer, total FROM orders',
          },
        },
        listRule: '',
        viewRule: '',
      });

      schema.createCollection({
        name: 'vip_orders',
        type: 'view',
        options: {
          viewQueries: {
            sqlite: 'SELECT id, customer, total FROM order_summary WHERE total >= 100',
          },
        },
        listRule: '',
        viewRule: '',
      });
    });

    afterEach(async () => {
      await db.close();
      if (fs.existsSync(testDir)) {
        try {
          fs.rmSync(testDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it('rejects cascade=true without force=true with 400 BadRequestError', () => {
      expect(() =>
        schema.deleteCollection('orders', { force: false, cascade: true })
      ).toThrow(/requires 'force=true'/);

      expect(() =>
        schema.updateCollection('orders', { name: 'orders_v2' }, { force: false, cascade: true })
      ).toThrow(/requires 'force=true'/);
    });

    it('rejects non-boolean force/cascade strings (e.g. "false") rather than coercing to true', () => {
      expect(() =>
        schema.updateCollection('orders', {
          name: 'orders_v2',
          force: 'false' as any,
          cascade: 'false' as any,
        })
      ).toThrow(/expected a boolean/);

      expect(() =>
        schema.deleteCollection('orders', { force: 'false' as any })
      ).toThrow(/expected a boolean/);

      expect(schema.getCollection('orders')).toBeDefined();
      expect(schema.getCollection('order_summary')).toBeDefined();
    });

    it('blocks delete with ConflictError (409) listing direct and transitive dependents', () => {
      let caught: any;
      try {
        schema.deleteCollection('orders');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.statusCode).toBe(409);
      expect(caught.data).toMatchObject({
        code: 'VIEW_DEPENDENCY_CONFLICT',
        operation: 'delete',
        target: 'orders',
        requiresForce: true,
        supportsCascade: true,
      });
      expect(caught.data.dependentViews).toEqual(['order_summary', 'vip_orders']);
      expect(schema.getCollection('orders')).toBeDefined();
    });

    it('supports force=true without cascade (deletes target only) and force=true&cascade=true (cleans up all dependents)', () => {
      // Case A: force=true, cascade=false -> leaves order_summary & vip_orders
      schema.deleteCollection('orders', { force: true, cascade: false });
      expect(schema.getCollection('orders')).toBeUndefined();
      expect(schema.getCollection('order_summary')).toBeDefined();
      expect(schema.getCollection('vip_orders')).toBeDefined();

      // Rebuild base & dependents for Case B: force=true, cascade=true
      schema.deleteCollection('vip_orders', { force: true });
      schema.deleteCollection('order_summary', { force: true });
      schema.createCollection({
        name: 'orders',
        type: 'base',
        schema: [{ id: 'f1', name: 'customer', type: 'text' }],
      });
      schema.createCollection({
        name: 'order_summary',
        type: 'view',
        options: { viewQueries: { sqlite: 'SELECT id, customer FROM orders' } },
      });
      schema.createCollection({
        name: 'vip_orders',
        type: 'view',
        options: { viewQueries: { sqlite: 'SELECT id, customer FROM order_summary' } },
      });

      schema.deleteCollection('orders', { force: true, cascade: true });
      expect(schema.getCollection('orders')).toBeUndefined();
      expect(schema.getCollection('order_summary')).toBeUndefined();
      expect(schema.getCollection('vip_orders')).toBeUndefined();

      const remainingSqlViews = db.allSync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'view' AND name IN ('order_summary', 'vip_orders')`
      );
      expect(remainingSqlViews).toHaveLength(0);
    });

    it('blocks rename without force, and with force+cascade renames target, rewrites dependent SQL, and keeps views queryable', async () => {
      // Without force -> 409
      let err409: any;
      try {
        schema.updateCollection('orders', { name: 'customer_orders' });
      } catch (err) {
        err409 = err;
      }
      expect(err409?.statusCode).toBe(409);
      expect(err409?.data?.operation).toBe('rename');
      expect(err409?.data?.dependentViews).toEqual(['order_summary', 'vip_orders']);

      // With force=true & cascade=true -> rewrites order_summary SQL & keeps vip_orders working
      const renamed = schema.updateCollection(
        'orders',
        { name: 'customer_orders' },
        { force: true, cascade: true }
      );
      expect(renamed.name).toBe('customer_orders');

      const summary = schema.getCollection('order_summary')!;
      expect(summary.options?.viewQueries?.sqlite).toContain('FROM customer_orders');

      const vipRows = await records.getList('vip_orders', 1, 10);
      expect(vipRows.items).toHaveLength(1);
      expect(vipRows.items[0].customer).toBe('Alice');
    });

    it('blocks any viewQueries modification on a parent view, allows rule-only edits, and refreshes/cleans up dependents on cascade', async () => {
      // Rule-only update must succeed without force
      const ruleUpdated = schema.updateCollection('order_summary', { listRule: '@request.auth.id != ""' });
      expect(ruleUpdated.listRule).toBe('@request.auth.id != ""');

      // Modifying SQL (even non-breaking extra column) must trigger 409 without force
      let errModify: any;
      try {
        schema.updateCollection('order_summary', {
          options: {
            viewQueries: {
              sqlite: 'SELECT id, customer, total, total * 2 AS doubled FROM orders',
            },
          },
        });
      } catch (err) {
        errModify = err;
      }
      expect(errModify?.statusCode).toBe(409);
      expect(errModify?.data?.operation).toBe('modify');
      expect(errModify?.data?.dependentViews).toEqual(['vip_orders']);

      // Now add another dependent view that relies specifically on `total`, and remove `total` from `order_summary`
      // Compatible views should survive; incompatible ones (`vip_orders`) should be cleanly deleted
      schema.createCollection({
        name: 'customer_directory',
        type: 'view',
        options: {
          viewQueries: {
            sqlite: 'SELECT id, customer FROM order_summary',
          },
        },
        listRule: '',
        viewRule: '',
      });

      schema.updateCollection(
        'order_summary',
        {
          options: {
            viewQueries: {
              sqlite: 'SELECT id, customer FROM orders',
            },
          },
        },
        { force: true, cascade: true }
      );

      // Compatible view remains and works
      expect(schema.getCollection('customer_directory')).toBeDefined();
      const dirRows = await records.getList('customer_directory', 1, 10);
      expect(dirRows.items).toHaveLength(2);

      // Incompatible view (`vip_orders` referenced removed `total`) is completely cleaned up (no stale metadata or SQL view)
      expect(schema.getCollection('vip_orders')).toBeUndefined();
      const staleSqlViews = db.allSync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'view' AND name = 'vip_orders'`
      );
      expect(staleSqlViews).toHaveLength(0);
    });

    it('rethrows operational/unexpected errors during cascade replay and rolls back without deleting dependent views', async () => {
      const origInfer = ViewSchemaInferrer.infer.bind(ViewSchemaInferrer);
      const inferSpy = vi.spyOn(ViewSchemaInferrer, 'infer').mockImplementation((params: any) => {
        if (params.viewName === 'vip_orders') {
          const busyErr: any = new Error('SQLITE_BUSY: database is locked');
          busyErr.code = 'ERR_SQLITE_BUSY';
          busyErr.errcode = 5;
          throw busyErr;
        }
        return origInfer(params);
      });

      try {
        expect(() =>
          schema.updateCollection(
            'order_summary',
            {
              options: {
                viewQueries: {
                  sqlite: 'SELECT id, customer, total FROM orders WHERE total > 0',
                },
              },
            },
            { force: true, cascade: true }
          )
        ).toThrow(/SQLITE_BUSY/);

        // Both parent view edit and dependent view must be rolled back intact
        expect(schema.getCollection('order_summary')?.options?.viewQueries?.sqlite).toBe(
          'SELECT id, customer, total FROM orders'
        );
        expect(schema.getCollection('vip_orders')).toBeDefined();
        const vipRows = await records.getList('vip_orders', 1, 10);
        expect(vipRows.items).toHaveLength(1);
      } finally {
        inferSpy.mockRestore();
      }
    });
  });

  describe('HTTP API, OpenAPI & Client SDK integration', () => {
    const testDir = path.resolve(__dirname, `../.test_view_deps_http_${Date.now()}`);
    const port = 8297;
    let server: NodeStack;
    let client: NodeStackClient;

    beforeAll(async () => {
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
      server = new NodeStack({ dataDir: testDir, port, appName: 'View Dep Test' });
      await server.start(port);

      client = new NodeStackClient(`http://127.0.0.1:${port}`, {
        authStore: new MemoryAuthStore(),
      });
      await client.admins.createInitial('admin@nodestack.test', 'password1234');

      await client.collections.create({
        name: 'items',
        type: 'base',
        schema: [{ id: 'f_title', name: 'title', type: 'text', required: true }],
        listRule: '',
        viewRule: '',
      });
      await client.collections.create({
        name: 'item_titles',
        type: 'view',
        options: { viewQueries: { sqlite: 'SELECT id, title FROM items' } },
        listRule: '',
        viewRule: '',
      });
    });

    afterAll(async () => {
      await server.stop();
      if (fs.existsSync(testDir)) {
        try {
          fs.rmSync(testDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it('exposes force, cascade, 400, and 409 in OpenAPI spec', () => {
      const spec = OpenApiGenerator.generateFromCollections(server.schema.getAllCollections(), { title: 'Test' });
      const colPath = spec.paths['/api/collections/{collection}'];
      expect(colPath.patch.parameters.map((p: any) => p.name)).toEqual(
        expect.arrayContaining(['force', 'cascade'])
      );
      expect(colPath.delete.parameters.map((p: any) => p.name)).toEqual(
        expect.arrayContaining(['force', 'cascade'])
      );
      expect(colPath.patch.responses['400']).toBeDefined();
      expect(colPath.patch.responses['409']).toBeDefined();
      expect(colPath.delete.responses['400']).toBeDefined();
      expect(colPath.delete.responses['409']).toBeDefined();
    });

    it('rejects cascade=true without force=true with 400 via SDK', async () => {
      await expect(
        client.collections.delete('items', { cascade: true })
      ).rejects.toMatchObject({ status: 400 });

      await expect(
        client.collections.update('items', { name: 'items_v2' }, { cascade: true })
      ).rejects.toMatchObject({ status: 400 });
    });

    it('returns 409 without deleting collection files, then cascades rename & delete via SDK', async () => {
      // Create a dummy asset directory for `items` to verify 409 does not wipe storage files!
      const itemsCol = server.schema.getCollection('items')!;
      const colStorageDir = path.join(testDir, 'storage', itemsCol.id);
      fs.mkdirSync(colStorageDir, { recursive: true });
      fs.writeFileSync(path.join(colStorageDir, 'keep.txt'), 'still here');

      // 1. Delete without force -> 409 and file preserved
      let delErr: any;
      try {
        await client.collections.delete('items');
      } catch (err) {
        delErr = err;
      }
      expect(delErr).toBeInstanceOf(ClientResponseError);
      expect(delErr.status).toBe(409);
      expect(delErr.data?.data?.code).toBe('VIEW_DEPENDENCY_CONFLICT');
      expect(delErr.data?.data?.dependentViews).toEqual(['item_titles']);
      expect(fs.existsSync(path.join(colStorageDir, 'keep.txt'))).toBe(true);

      // 2. Reject non-boolean body/query force & cascade values (e.g. "false" string) rather than coercing to true
      await expect(
        client.collections.update('items', {
          name: 'catalog_items',
          force: 'false' as any,
          cascade: 'false' as any,
        })
      ).rejects.toMatchObject({ status: 400 });

      const badQueryRes = await fetch(`http://127.0.0.1:${port}/api/collections/items?force=notabool`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${client.authStore.token}`,
        },
        body: JSON.stringify({ name: 'catalog_items' }),
      });
      expect(badQueryRes.status).toBe(400);

      const falseQueryRes = await fetch(`http://127.0.0.1:${port}/api/collections/items?force=false&cascade=false`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${client.authStore.token}`,
        },
        body: JSON.stringify({ name: 'catalog_items' }),
      });
      expect(falseQueryRes.status).toBe(409);

      // 3. Rename without force -> 409
      await expect(
        client.collections.update('items', { name: 'catalog_items' })
      ).rejects.toMatchObject({ status: 409 });

      // 3. Rename with force + cascade -> rewrites view SQL
      const renamed = await client.collections.update(
        'items',
        { name: 'catalog_items' },
        { force: true, cascade: true }
      );
      expect(renamed.name).toBe('catalog_items');
      const viewCol = await client.collections.getOne('item_titles');
      expect(viewCol.options?.viewQueries?.sqlite).toContain('FROM catalog_items');

      // 4. Delete with force + cascade -> deletes both target and view
      await client.collections.delete('catalog_items', { force: true, cascade: true });
      const cols = await client.collections.getList();
      expect(cols.some((c) => c.name === 'catalog_items')).toBe(false);
      expect(cols.some((c) => c.name === 'item_titles')).toBe(false);
    });

    it('serializes dependency check, file cleanup, and schema drop against concurrent view creation', async () => {
      await client.collections.create({
        name: 'concurrent_base',
        type: 'base',
        schema: [{ id: 'f_name', name: 'name', type: 'text', required: true }],
      });
      const col = server.schema.getCollection('concurrent_base')!;
      const colStorageDir = path.join(testDir, 'storage', col.id);
      fs.mkdirSync(colStorageDir, { recursive: true });
      fs.writeFileSync(path.join(colStorageDir, 'asset.txt'), 'payload');

      const origDeleteFiles = server.files.deleteCollectionFiles.bind(server.files);
      let notifyBeforeDropEntered!: () => void;
      const beforeDropEntered = new Promise<void>((r) => {
        notifyBeforeDropEntered = r;
      });
      let releaseBeforeDrop!: () => void;
      const beforeDropGate = new Promise<void>((r) => {
        releaseBeforeDrop = r;
      });

      (server.files as any).deleteCollectionFiles = async (colId: string) => {
        if (colId === col.id) {
          notifyBeforeDropEntered();
          await beforeDropGate;
        }
        return origDeleteFiles(colId);
      };

      try {
        // Start DELETE while no dependent views exist
        const deletePromise = client.collections.delete('concurrent_base');
        await beforeDropEntered;

        // Launch a concurrent POST trying to create a dependent SQL view while file deletion is in flight
        const createViewPromise = client.collections
          .create({
            name: 'late_view',
            type: 'view',
            options: { viewQueries: { sqlite: 'SELECT id, name FROM concurrent_base' } },
          })
          .then(
            () => ({ ok: true as const }),
            (err) => ({ ok: false as const, status: err?.status })
          );

        // Give the event loop a tick, then allow file cleanup + schema drop to finish
        await new Promise((r) => setTimeout(r, 20));
        releaseBeforeDrop();

        await expect(deletePromise).resolves.toBe(true);
        const viewCreateResult = await createViewPromise;
        // Concurrent view creation must run AFTER deletion finishes and therefore fail validation cleanly
        expect(viewCreateResult.ok).toBe(false);
        expect(server.schema.getCollection('concurrent_base')).toBeUndefined();
      } finally {
        (server.files as any).deleteCollectionFiles = origDeleteFiles;
      }
    });
  });

  describe('CLI collection rename & delete dependency flags', () => {
    const cliDir = path.resolve(__dirname, `../.test_view_deps_cli_${Date.now()}`);

    beforeEach(() => {
      if (fs.existsSync(cliDir)) fs.rmSync(cliDir, { recursive: true, force: true });
      const app = new NodeStack({ dataDir: cliDir });
      app.schema.createCollection({
        name: 'tasks',
        type: 'base',
        schema: [{ id: 'f1', name: 'title', type: 'text', required: true }],
      });
      app.schema.createCollection({
        name: 'open_tasks',
        type: 'view',
        options: { viewQueries: { sqlite: 'SELECT id, title FROM tasks' } },
      });
      app.close();
    });

    afterEach(() => {
      if (fs.existsSync(cliDir)) {
        try {
          fs.rmSync(cliDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it('blocks collection rename without --force, fails on --cascade alone, and succeeds with --force --cascade', async () => {
      const logs: string[] = [];
      const errors: string[] = [];
      const origLog = console.log;
      const origError = console.error;
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code})`);
      }) as any);
      console.log = (...args: any[]) => logs.push(args.join(' '));
      console.error = (...args: any[]) => errors.push(args.join(' '));

      try {
        // Rename blocked without --force
        await expect(
          runCli(['node', 'nodestack', 'collection', 'rename', 'tasks', 'work_items', '-d', cliDir])
        ).rejects.toThrow('process.exit(1)');
        expect(errors.join('\n')).toContain("Cannot rename 'tasks'");

        // --cascade without --force rejected
        errors.length = 0;
        await expect(
          runCli(['node', 'nodestack', 'collection', 'rename', 'tasks', 'work_items', '--cascade', '-d', cliDir])
        ).rejects.toThrow('process.exit(1)');
        expect(errors.join('\n')).toContain("Option '--cascade' requires '--force'");

        // --force --cascade renames table and rewrites view SQL
        await runCli([
          'node',
          'nodestack',
          'collection',
          'rename',
          'tasks',
          'work_items',
          '--force',
          '--cascade',
          '-d',
          cliDir,
        ]);
        expect(logs.join('\n')).toContain("Collection 'tasks' renamed to 'work_items'!");

        const appCheck = new NodeStack({ dataDir: cliDir });
        expect(appCheck.schema.getCollection('tasks')).toBeUndefined();
        expect(appCheck.schema.getCollection('work_items')).toBeDefined();
        expect(appCheck.schema.getCollection('open_tasks')?.options?.viewQueries?.sqlite).toContain(
          'FROM work_items'
        );
        await appCheck.close();
      } finally {
        console.log = origLog;
        console.error = origError;
        exitSpy.mockRestore();
      }
    });
  });

  describe('Admin UI dependency confirmation popups & cascade checkbox (JSDOM)', () => {
    const uiDir = path.resolve(__dirname, '../src/admin/ui');

    async function createUiDom(fetchMock: any) {
      const bundledHtml = AdminUIBundler.bundle(uiDir);
      const dom = new JSDOM(bundledHtml, {
        runScripts: 'dangerously',
        url: 'http://127.0.0.1:8090/_/',
      });
      const win = dom.window as any;
      win.state.token = 'test-token';
      win.fetch = async (url: string, init?: any) => {
        if (typeof url === 'string' && url.includes('/api/admins/has-admins')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ hasAdmins: true }),
            text: async () => '{"hasAdmins":true}',
          };
        }
        if (typeof url === 'string' && url.includes('/api/admins/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'admin1', email: 'admin@test.io' }),
            text: async () => '{"id":"admin1","email":"admin@test.io"}',
          };
        }
        if (typeof url === 'string' && url === '/api/apps') {
          return {
            ok: true,
            status: 200,
            json: async () => [],
            text: async () => '[]',
          };
        }
        return fetchMock(url, init);
      };
      // Wait for DOMContentLoaded init() bootstrap to settle so it never races with modal tests
      await new Promise((r) => setTimeout(r, 25));
      return { win, doc: win.document as Document };
    }

    it('renders inline dependency warning and cascade checkbox in Delete Collection modal on 409 and retries with force/cascade', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      const fetchMock = vi.fn(async (url: string, init?: any) => {
        const method = init?.method || 'GET';
        calls.push({ url, method });

        if (url === '/api/collections' && method === 'GET') {
          return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
        }
        if (url === '/api/collections/orders' && method === 'DELETE') {
          const payload = {
            statusCode: 409,
            message: "Cannot delete 'orders' because views depend on it.",
            data: {
              code: 'VIEW_DEPENDENCY_CONFLICT',
              operation: 'delete',
              target: 'orders',
              dependentViews: ['order_summary', 'vip_orders'],
              requiresForce: true,
              supportsCascade: true,
            },
          };
          return { ok: false, status: 409, json: async () => payload, text: async () => JSON.stringify(payload) };
        }
        if (url === '/api/collections/orders?force=true&cascade=true' && method === 'DELETE') {
          return { ok: true, status: 204, json: async () => ({}), text: async () => '' };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
      });

      const { win, doc } = await createUiDom(fetchMock);
      win.state.collections = [{ name: 'orders', type: 'base', schema: [] }];
      win.openDeleteCollectionModal('orders');

      const input = doc.getElementById('confirm-delete-col-input') as HTMLInputElement;
      const btn = doc.getElementById('btn-confirm-delete-col') as HTMLButtonElement;
      input.value = 'orders';
      input.dispatchEvent(new win.Event('input'));
      expect(btn.disabled).toBe(false);

      // First delete attempt -> triggers 409 and renders dependency warning + unchecked checkbox
      await win.submitDeleteCollection('orders');

      const warning = doc.getElementById('delete-col-dep-warning');
      expect(warning).toBeTruthy();
      expect(warning?.textContent).toContain('order_summary');
      expect(warning?.textContent).toContain('vip_orders');

      const checkbox = doc.getElementById('confirm-delete-cascade-views') as HTMLInputElement;
      expect(checkbox).toBeTruthy();
      expect(checkbox.checked).toBe(false);

      const forceBtn = doc.getElementById('btn-confirm-delete-col') as HTMLButtonElement;
      expect(forceBtn.textContent?.trim()).toBe('Force Delete');
      expect(forceBtn.disabled).toBe(false);

      // Check cascade and click Force Delete
      checkbox.checked = true;
      forceBtn.click();
      await new Promise((r) => setTimeout(r, 20));

      expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/collections/orders?force=true&cascade=true')).toBe(
        true
      );
    });

    it('opens dependency confirmation modal from saveSchemaChanges on 409 and retries PATCH with force=true (&cascade=true)', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      const fetchMock = vi.fn(async (url: string, init?: any) => {
        const method = init?.method || 'GET';
        calls.push({ url, method });

        if (url === '/api/collections' && method === 'GET') {
          return {
            ok: true,
            status: 200,
            json: async () => [{ name: 'orders_renamed', type: 'base', schema: [] }],
            text: async () => '[]',
          };
        }
        if (url === '/api/collections/orders' && method === 'PATCH') {
          const payload = {
            statusCode: 409,
            message: 'Dependent views exist',
            data: {
              code: 'VIEW_DEPENDENCY_CONFLICT',
              operation: 'rename',
              target: 'orders',
              dependentViews: ['order_summary'],
              requiresForce: true,
              supportsCascade: true,
            },
          };
          return { ok: false, status: 409, json: async () => payload, text: async () => JSON.stringify(payload) };
        }
        if (url === '/api/collections/orders?force=true&cascade=true' && method === 'PATCH') {
          const updated = { name: 'orders_renamed', type: 'base', schema: [] };
          return { ok: true, status: 200, json: async () => updated, text: async () => JSON.stringify(updated) };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
      });

      const { win, doc } = await createUiDom(fetchMock);
      win.state.activeCollection = {
        name: 'orders',
        type: 'base',
        schema: [],
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
      };
      // Render schema view elements so saveSchemaChanges can read inputs
      const mainEl = doc.getElementById('main-view') || doc.body;
      const nameInput = doc.createElement('input');
      nameInput.id = 'schema-col-name';
      nameInput.value = 'orders_renamed';
      mainEl.appendChild(nameInput);

      // Mock rule helper if needed or ensure defaults return ''
      win.getRuleValueToSave = () => '';
      win.selectCollection = vi.fn();

      await win.saveSchemaChanges();

      const cascadeCb = doc.getElementById('confirm-patch-cascade-views') as HTMLInputElement;
      const proceedBtn = doc.getElementById('btn-confirm-view-dep-proceed') as HTMLButtonElement;
      expect(cascadeCb).toBeTruthy();
      expect(cascadeCb.checked).toBe(false);
      expect(doc.getElementById('modal-root')?.textContent).toContain('order_summary');

      cascadeCb.checked = true;
      proceedBtn.click();
      await new Promise((r) => setTimeout(r, 20));

      expect(
        calls.some(
          (c) => c.method === 'PATCH' && c.url === '/api/collections/orders?force=true&cascade=true'
        )
      ).toBe(true);
    });

    it('opens dependency confirmation modal from saveViewDesigner edit on 409 and supports force-without-cascade', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      const fetchMock = vi.fn(async (url: string, init?: any) => {
        const method = init?.method || 'GET';
        calls.push({ url, method });

        if (url === '/api/collections' && method === 'GET') {
          return {
            ok: true,
            status: 200,
            json: async () => [{ name: 'parent_view', type: 'view', schema: [] }],
            text: async () => '[]',
          };
        }
        if (url === '/api/collections/parent_view' && method === 'PATCH') {
          const payload = {
            statusCode: 409,
            message: 'Dependent views exist',
            data: {
              code: 'VIEW_DEPENDENCY_CONFLICT',
              operation: 'modify',
              target: 'parent_view',
              dependentViews: ['child_view'],
              requiresForce: true,
              supportsCascade: true,
            },
          };
          return { ok: false, status: 409, json: async () => payload, text: async () => JSON.stringify(payload) };
        }
        if (url === '/api/collections/parent_view?force=true' && method === 'PATCH') {
          const saved = { name: 'parent_view', type: 'view', schema: [] };
          return { ok: true, status: 200, json: async () => saved, text: async () => JSON.stringify(saved) };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
      });

      const { win, doc } = await createUiDom(fetchMock);
      win.selectCollection = vi.fn();
      win.viewDesignerState.mode = 'edit';
      win.viewDesignerState.originalName = 'parent_view';
      win.viewDesignerState.name = 'parent_view';
      win.viewDesignerState.activeDialect = 'sqlite';
      win.viewDesignerState.viewQueries = {
        sqlite: 'SELECT id, title FROM items',
        postgres: '',
        mssql: '',
      };

      const nameInput = doc.createElement('input');
      nameInput.id = 'vd-view-name';
      nameInput.value = 'parent_view';
      doc.body.appendChild(nameInput);

      await win.saveViewDesigner();

      const cascadeCb = doc.getElementById('confirm-patch-cascade-views') as HTMLInputElement;
      const proceedBtn = doc.getElementById('btn-confirm-view-dep-proceed') as HTMLButtonElement;
      expect(cascadeCb).toBeTruthy();
      expect(cascadeCb.checked).toBe(false);

      // Leave cascade unchecked -> sends ?force=true without cascade=true
      proceedBtn.click();
      await new Promise((r) => setTimeout(r, 20));

      expect(
        calls.some((c) => c.method === 'PATCH' && c.url === '/api/collections/parent_view?force=true')
      ).toBe(true);
    });
  });
});
