import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../src/core/config/ConfigService';
import { DatabaseService } from '../src/database/DatabaseService';
import { SchemaService } from '../src/schema/SchemaService';
import { FtsService } from '../src/records/FtsService';
import { RecordService } from '../src/records/RecordService';
import { RuleEngine } from '../src/rules/RuleEngine';
import { EventBus } from '../src/core/events/EventBus';
import { TypeGenerator } from '../src/schema/TypeGenerator';
import { OpenApiGenerator } from '../src/schema/OpenApiGenerator';
import { ViewQueryValidator } from '../src/schema/ViewQueryValidator';
import { ViewSchemaInferrer } from '../src/schema/ViewSchemaInferrer';
import { SqliteDialect } from '../src/database/dialects/SqliteDialect';
import { PostgresDialect } from '../src/database/dialects/PostgresDialect';
import { MssqlDialect } from '../src/database/dialects/MssqlDialect';
import { MssqlDriver } from '../src/database/drivers/MssqlDriver';
import { NodeSqliteDriver } from '../src/database/drivers/NodeSqliteDriver';
import { DatabaseMigrationService } from '../src/database/migration/DatabaseMigrationService';
import { LogicalSnapshotDriver } from '../src/snapshots/drivers/LogicalSnapshotDriver';
import { AnalyticsService } from '../src/analytics/AnalyticsService';
import { RealtimeService } from '../src/realtime/RealtimeService';
import { MockDataService } from '../src/records/MockDataService';
import { FileStorageService } from '../src/files/FileStorageService';

describe('True SQL View Collections (Read-Only Joins & Aggregations)', () => {
  const testDir = path.resolve(__dirname, `../.test_view_collections_${Date.now()}`);
  let db: DatabaseService;
  let fts: FtsService;
  let schema: SchemaService;
  let records: RecordService;
  let ruleEngine: RuleEngine;
  let eventBus: EventBus;
  let realtime: RealtimeService;

  beforeEach(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    const config = new ConfigService({ dataDir: testDir });
    db = new DatabaseService(config, new NodeSqliteDriver(':memory:'));
    db.initSync();
    fts = new FtsService(db);
    schema = new SchemaService(db, fts);
    ruleEngine = new RuleEngine();
    eventBus = new EventBus();
    realtime = new RealtimeService(ruleEngine, schema);
    records = new RecordService(db, schema, ruleEngine, eventBus, realtime, undefined, fts);
  });

  afterEach(async () => {
    await db.close();
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // ------------------------------------------------------------------
  // 1. ViewQueryValidator Security & Dialect Rules
  // ------------------------------------------------------------------
  describe('ViewQueryValidator', () => {
    it('accepts valid SELECT and CTE WITH queries', () => {
      expect(ViewQueryValidator.validate('SELECT id, name FROM users;', 'sqlite')).toBe('SELECT id, name FROM users');
      expect(
        ViewQueryValidator.validate(
          '/* comment */ WITH totals AS (SELECT user_id, COUNT(*) cnt FROM orders GROUP BY user_id) SELECT * FROM totals',
          'postgres'
        )
      ).toContain('WITH totals AS');
    });

    it('rejects empty, multi-statement, and mutating queries', () => {
      expect(() => ViewQueryValidator.validate('', 'sqlite')).toThrow();
      expect(() => ViewQueryValidator.validate('SELECT 1; DROP TABLE users', 'sqlite')).toThrow();
      expect(() => ViewQueryValidator.validate('DELETE FROM users', 'sqlite')).toThrow();
      expect(() => ViewQueryValidator.validate('INSERT INTO users VALUES ("1")', 'sqlite')).toThrow();
      expect(() => ViewQueryValidator.validate('PRAGMA table_info(users)', 'sqlite')).toThrow();
      expect(() => ViewQueryValidator.validate('SELECT * FROM users FOR UPDATE', 'postgres')).toThrow();
    });

    it('blocks sensitive system tables, auth secrets, and self-references', () => {
      expect(() => ViewQueryValidator.validate('SELECT id, email FROM _admins', 'sqlite')).toThrow(/restricted system table/i);
      expect(() => ViewQueryValidator.validate('SELECT id FROM _api_keys', 'sqlite')).toThrow(/restricted system table/i);
      expect(() => ViewQueryValidator.validate('SELECT id, passwordHash FROM users', 'sqlite')).toThrow(/restricted column/i);
      expect(() => ViewQueryValidator.validate('SELECT id, tokenKey FROM users', 'sqlite')).toThrow(/restricted column/i);
      expect(() => ViewQueryValidator.validate('SELECT * FROM my_view', 'sqlite', 'my_view')).toThrow(/cannot reference itself/i);
    });

    it('rejects bare top-level ORDER BY on MSSQL views', () => {
      expect(() =>
        ViewQueryValidator.validate('SELECT id, total FROM orders ORDER BY total DESC', 'mssql')
      ).toThrow(/ORDER BY/i);
      expect(() =>
        ViewQueryValidator.validate('SELECT TOP 10 id, total FROM orders ORDER BY total DESC', 'mssql')
      ).not.toThrow();
    });

    it('flags foreign-dialect syntax with clear hints and resolves per-dialect viewQueries strictly', () => {
      expect(() =>
        ViewQueryValidator.validate("SELECT CONVERT(VARCHAR(10), TRY_CAST(created AS DATETIME2), 23) AS day FROM orders", 'sqlite')
      ).toThrow(/MSSQL/i);
      expect(() =>
        ViewQueryValidator.validate("SELECT strftime('%Y-%m-%d', created) AS day FROM orders", 'postgres')
      ).toThrow(/strftime/i);

      const opts = {
        viewQueries: {
          sqlite: 'SELECT id FROM orders',
          postgres: 'SELECT id, now() AS ts FROM orders',
        },
      };
      expect(ViewQueryValidator.resolveViewQuery(opts, 'sqlite')).toBe('SELECT id FROM orders');
      expect(ViewQueryValidator.resolveViewQuery(opts, 'postgres')).toBe('SELECT id, now() AS ts FROM orders');
      expect(ViewQueryValidator.resolveViewQuery(opts, 'mssql')).toBe('');
    });
  });

  // ------------------------------------------------------------------
  // 2. Dialects & MssqlDriver CTE qualification
  // ------------------------------------------------------------------
  describe('Dialects & Driver View DDL', () => {
    it('generates view DDL across SQLite, Postgres, and MSSQL dialects', () => {
      const sqlite = new SqliteDialect();
      const pg = new PostgresDialect();
      const mssql = new MssqlDialect();

      expect(sqlite.createViewSql('kpi_view', 'SELECT 1 AS c')).toBe('CREATE VIEW "kpi_view" AS SELECT 1 AS c');
      expect(sqlite.dropViewIfExists('kpi_view')).toBe('DROP VIEW IF EXISTS "kpi_view"');

      expect(pg.createViewSql('kpi_view', 'SELECT 1 AS c')).toBe('CREATE OR REPLACE VIEW "kpi_view" AS SELECT 1 AS c');
      expect(pg.dropViewIfExists('kpi_view')).toBe('DROP VIEW IF EXISTS "kpi_view"');
      expect(pg.renameViewSql('old_v', 'new_v')).toBe('ALTER VIEW "old_v" RENAME TO "new_v"');

      expect(mssql.createViewSql('kpi_view', 'SELECT 1 AS c')).toBe('CREATE VIEW [kpi_view] AS SELECT 1 AS c');
      expect(mssql.dropViewIfExists('kpi_view')).toContain("OBJECT_ID('kpi_view', 'V')");
      expect(mssql.getViewColumnsSql('kpi_view').sql).toContain('INFORMATION_SCHEMA.COLUMNS');
    });

    it('does not schema-qualify CTE names in MssqlDriver.qualifySql', () => {
      const driver = new MssqlDriver({
        connectionPool: { request: () => ({}) },
        schemaName: 'app_sales',
      });
      const sql = 'WITH order_totals AS (SELECT customer_id, SUM(amount) AS total FROM orders GROUP BY customer_id) SELECT * FROM order_totals';
      const qualified = driver.qualifySql(sql);
      expect(qualified).toContain('FROM [app_sales].[orders]');
      expect(qualified).toContain('FROM order_totals');
      expect(qualified).not.toContain('[app_sales].[order_totals]');
    });
  });

  // ------------------------------------------------------------------
  // 3. End-to-End SQLite Joins, KPI Rollups, Inference & Safeguards
  // ------------------------------------------------------------------
  describe('SQLite Join & Aggregation Views + Inference + Safeguards', () => {
    beforeEach(async () => {
      await schema.createCollection({
        name: 'customers',
        type: 'base',
        schema: [
          { id: 'f_name', name: 'name', type: 'text', required: true },
          { id: 'f_email', name: 'contact_email', type: 'email' },
          { id: 'f_vip', name: 'is_vip', type: 'bool' },
          { id: 'f_tier', name: 'tier', type: 'select', options: { values: ['free', 'pro', 'enterprise'] } },
        ],
        listRule: '',
        viewRule: '',
      });

      await schema.createCollection({
        name: 'orders',
        type: 'base',
        schema: [
          { id: 'f_cust', name: 'customer', type: 'relation', options: { collectionId: 'customers' }, required: true },
          { id: 'f_amount', name: 'amount', type: 'number', required: true },
          { id: 'f_paid', name: 'paid', type: 'bool' },
          { id: 'f_meta', name: 'meta', type: 'json' },
          { id: 'f_ordered', name: 'ordered_at', type: 'date' },
        ],
        listRule: '',
        viewRule: '',
      });

      const c1 = await records.create('customers', {
        id: 'cust_1',
        name: 'Alice',
        contact_email: 'alice@example.com',
        is_vip: true,
        tier: 'pro',
      }, { isAdmin: true });
      const c2 = await records.create('customers', {
        id: 'cust_2',
        name: 'Bob',
        contact_email: 'bob@example.com',
        is_vip: false,
        tier: 'free',
      }, { isAdmin: true });

      await records.create('orders', {
        id: 'ord_1',
        customer: c1.id,
        amount: 120.5,
        paid: true,
        meta: { channel: 'web' },
        ordered_at: '2026-10-01T10:00:00.000Z',
      }, { isAdmin: true });
      await records.create('orders', {
        id: 'ord_2',
        customer: c1.id,
        amount: 79.5,
        paid: true,
        meta: { channel: 'mobile' },
        ordered_at: '2026-10-02T10:00:00.000Z',
      }, { isAdmin: true });
      await records.create('orders', {
        id: 'ord_3',
        customer: c2.id,
        amount: 40,
        paid: false,
        meta: { channel: 'web' },
        ordered_at: '2026-10-03T10:00:00.000Z',
      }, { isAdmin: true });
    });

    it('infers join column types (including relation, select, email, bool, json, date) and supports expand & rules', async () => {
      const viewCol = await schema.createCollection({
        name: 'order_details',
        type: 'view',
        options: {
          viewQueries: {
            sqlite: `
              SELECT
                o.id AS id,
                o.customer AS customer,
                o.amount AS amount,
                o.paid AS paid,
                o.meta AS meta,
                o.ordered_at AS ordered_at,
                c.name AS customer_name,
                c.contact_email AS customer_email,
                c.tier AS customer_tier,
                o.created AS created
              FROM orders o
              JOIN customers c ON c.id = o.customer
            `,
          },
        },
        listRule: 'customer = @request.auth.id || paid = true',
        viewRule: 'paid = true',
      });

      expect(viewCol.type).toBe('view');
      expect(viewCol.createRule).toBeNull();
      expect(viewCol.updateRule).toBeNull();
      expect(viewCol.deleteRule).toBeNull();

      const fieldMap = new Map(viewCol.schema.map((f) => [f.name, f]));
      expect(fieldMap.get('customer')?.type).toBe('relation');
      expect(fieldMap.get('customer')?.options?.collectionId).toBe('customers');
      expect(fieldMap.get('amount')?.type).toBe('number');
      expect(fieldMap.get('paid')?.type).toBe('bool');
      expect(fieldMap.get('meta')?.type).toBe('json');
      expect(fieldMap.get('ordered_at')?.type).toBe('date');
      expect(fieldMap.get('customer_email')?.type).toBe('email');
      expect(fieldMap.get('customer_tier')?.type).toBe('select');
      expect(fieldMap.get('customer_tier')?.options?.values).toEqual(['free', 'pro', 'enterprise']);

      expect(await fts.hasFtsIndex('order_details')).toBe(false);

      const listRes = await records.getList('order_details', { expand: 'customer', sort: '-amount' });
      expect(listRes.totalItems).toBe(2);
      expect(listRes.items[0].id).toBe('ord_1');
      expect(listRes.items[0].paid).toBe(true);
      expect(listRes.items[0].meta).toEqual({ channel: 'web' });
      expect(listRes.items[0].expand?.customer?.name).toBe('Alice');

      const bobRes = await records.getList('order_details', {}, { id: 'cust_2' });
      expect(bobRes.totalItems).toBe(3);

      const searchRes = await records.getList('order_details', { search: 'Alice' });
      expect(searchRes.totalItems).toBe(2);

      await expect(records.getOne('order_details', 'ord_3')).rejects.toThrow(/not allowed/i);
      const oneRes = await records.getOne('order_details', 'ord_1');
      expect(oneRes.customer_name).toBe('Alice');
    });

    it('supports id-less KPI aggregation views without created/id columns', async () => {
      const kpiCol = await schema.createCollection({
        name: 'customer_kpis',
        type: 'view',
        options: {
          viewQueries: {
            sqlite: `
              SELECT
                c.tier AS tier,
                COUNT(o.id) AS order_count,
                SUM(o.amount) AS total_spent
              FROM customers c
              LEFT JOIN orders o ON o.customer = c.id
              GROUP BY c.tier
            `,
          },
        },
        listRule: '',
        viewRule: '',
      });

      const fieldMap = new Map(kpiCol.schema.map((f) => [f.name, f]));
      expect(fieldMap.get('tier')?.type).toBe('select');
      expect(fieldMap.get('order_count')?.type).toBe('number');
      expect(fieldMap.get('total_spent')?.type).toBe('number');

      const listRes = await records.getList('customer_kpis', { sort: '-total_spent' });
      expect(listRes.totalItems).toBe(2);
      expect(listRes.items[0].tier).toBe('pro');
      expect(listRes.items[0].order_count).toBe(2);
      expect(listRes.items[0].total_spent).toBe(200);

      const defaultSortRes = await records.getList('customer_kpis', {});
      expect(defaultSortRes.totalItems).toBe(2);

      await expect(records.getOne('customer_kpis', 'pro')).rejects.toThrow(/does not expose an 'id' column/i);

      const csvExport = await records.exportRecords('customer_kpis', 'csv');
      const headerLine = String(csvExport.data).split(/\r?\n/)[0];
      expect(headerLine).toBe('tier,order_count,total_spent');
    });

    it('fails fast at save time (WHERE 1 = 0) if view references non-existent table or column', () => {
      expect(() =>
        schema.createCollection({
          name: 'broken_view',
          type: 'view',
          options: {
            viewQueries: { sqlite: 'SELECT nonexistent_col FROM orders' },
          },
        })
      ).toThrow(/no such column/i);
      expect(schema.getCollection('broken_view')).toBeUndefined();
    });

    it('enforces Rule Safeguard and reports Schema Diff when editing an existing view', async () => {
      await schema.createCollection({
        name: 'guarded_view',
        type: 'view',
        options: {
          viewQueries: { sqlite: 'SELECT id, amount, paid FROM orders' },
        },
        listRule: 'paid = true',
        viewRule: 'paid = true',
      });

      // Preview removing 'paid' shows diff + ruleWarnings
      const preview = await schema.previewViewQuery({
        name: 'guarded_view',
        viewQueries: { sqlite: 'SELECT id, amount FROM orders' },
        dialect: 'sqlite',
      });
      expect(preview.valid).toBe(true);
      expect(preview.schemaDiff?.removed.map((c) => c.name)).toEqual(['paid']);
      expect(preview.schemaDiff?.hasBreakingChanges).toBe(true);
      expect(preview.ruleWarnings?.length).toBeGreaterThan(0);

      // Inactive dialect preview runs static validation only
      const pgPreview = await schema.previewViewQuery({
        name: 'guarded_view',
        viewQueries: { postgres: 'SELECT id, amount FROM orders' },
        dialect: 'postgres',
      });
      expect(pgPreview.valid).toBe(true);
      expect(pgPreview.staticOnly).toBe(true);

      // Saving an edit that drops 'paid' without updating listRule/viewRule is blocked
      expect(() =>
        schema.updateCollection('guarded_view', {
          options: { viewQueries: { sqlite: 'SELECT id, amount FROM orders' } },
        })
      ).toThrow(/listRule references missing column 'paid'/i);

      // Updating the rules in the same PATCH succeeds
      const updated = await schema.updateCollection('guarded_view', {
        options: { viewQueries: { sqlite: 'SELECT id, amount FROM orders' } },
        listRule: 'amount > 0',
        viewRule: '',
      });
      expect(updated.schema.map((f) => f.name)).toEqual(['id', 'amount']);
    });

    it('enforces read-only 405 on create, update, delete, importRecords, and MockDataService', async () => {
      await schema.createCollection({
        name: 'readonly_orders',
        type: 'view',
        options: { viewQueries: { sqlite: 'SELECT id, amount FROM orders' } },
      });

      await expect(records.create('readonly_orders', { amount: 10 })).rejects.toMatchObject({ statusCode: 405 });
      await expect(records.update('readonly_orders', 'ord_1', { amount: 10 })).rejects.toMatchObject({ statusCode: 405 });
      await expect(records.delete('readonly_orders', 'ord_1')).rejects.toMatchObject({ statusCode: 405 });
      await expect(records.importRecords('readonly_orders', [{ amount: 10 }])).rejects.toMatchObject({ statusCode: 405 });

      const files = new FileStorageService(new ConfigService({ dataDir: testDir }));
      const mockData = new MockDataService(db, schema, files, eventBus, realtime);
      await expect(mockData.generate('readonly_orders', { count: 2 })).rejects.toMatchObject({ statusCode: 405 });
    });

    it('supports updating viewQueries and deleting view cleanly', async () => {
      await schema.createCollection({
        name: 'dynamic_view',
        type: 'view',
        options: { viewQueries: { sqlite: 'SELECT id, amount FROM orders' } },
        listRule: '',
      });

      const updated = await schema.updateCollection('dynamic_view', {
        options: { viewQueries: { sqlite: 'SELECT id, amount, paid FROM orders WHERE paid = 1' } },
      });
      expect(updated.schema.map((f) => f.name)).toEqual(['id', 'amount', 'paid']);
      const list = await records.getList('dynamic_view');
      expect(list.totalItems).toBe(2);

      await schema.deleteCollection('dynamic_view');
      expect(schema.getCollection('dynamic_view')).toBeUndefined();
      const viewRow = db.prepareSync("SELECT name FROM sqlite_master WHERE type = 'view' AND name = 'dynamic_view'").get();
      expect(viewRow).toBeUndefined();
    });

    it('previews and validates view queries cleanly without leaving temporary views behind', async () => {
      const okPreview = await schema.previewViewQuery({
        name: 'preview_orders',
        viewQueries: {
          sqlite: 'SELECT o.id, o.amount, c.tier FROM orders o JOIN customers c ON c.id = o.customer ORDER BY o.amount DESC',
        },
        dialect: 'sqlite',
        limit: 2,
      });
      expect(okPreview.valid).toBe(true);
      expect(okPreview.rows).toHaveLength(2);
      expect(okPreview.schema.map((f) => [f.name, f.type])).toEqual([
        ['id', 'text'],
        ['amount', 'number'],
        ['tier', 'select'],
      ]);

      const badPreview = await schema.previewViewQuery({
        viewQueries: { sqlite: 'SELECT * FROM nonexistent_table' },
        dialect: 'sqlite',
      });
      expect(badPreview.valid).toBe(false);
      expect(badPreview.error).toBeTruthy();

      const leftover = db.prepareSync("SELECT name FROM sqlite_master WHERE type = 'view' AND name LIKE '_nodestack_preview_%'").all();
      expect(leftover).toHaveLength(0);
    });

    it('masks auth email projections unless emailVisibility is true, caller is owner, or caller is admin, and blocks non-admin filter probing', async () => {
      await schema.createCollection({
        name: 'members',
        type: 'auth',
        schema: [{ id: 'f_nick', name: 'nickname', type: 'text' }],
        listRule: '',
        viewRule: '',
      });

      const hiddenMember = await records.create('members', {
        id: 'mem_hidden',
        email: 'secret@example.com',
        password: 'Password123!',
        emailVisibility: false,
        nickname: 'SecretUser',
      }, { isAdmin: true });

      const publicMember = await records.create('members', {
        id: 'mem_public',
        email: 'public@example.com',
        password: 'Password123!',
        emailVisibility: true,
        nickname: 'PublicUser',
      }, { isAdmin: true });

      // 1. View projecting aliased auth email + expression without emailVisibility or id
      await schema.createCollection({
        name: 'member_contacts_masked',
        type: 'view',
        options: {
          viewQueries: {
            sqlite: 'SELECT id AS row_id, nickname, email AS member_email, LOWER(email) AS lower_email FROM members',
          },
        },
        listRule: '',
        viewRule: '',
      });

      const anonList = await records.getList('member_contacts_masked', { sort: 'nickname' });
      expect(anonList.totalItems).toBe(2);
      expect(anonList.items[0].member_email).toBeUndefined();
      expect(anonList.items[0].lower_email).toBeUndefined();
      expect(anonList.items[1].member_email).toBeUndefined();

      // Non-admin filter/search probing on authEmail column must be rejected / not leak
      await expect(
        records.getList('member_contacts_masked', { filter: "member_email = 'secret@example.com'" })
      ).rejects.toThrow(/Invalid filter field/i);

      const anonSearch = await records.getList('member_contacts_masked', { search: 'secret@example.com' });
      expect(anonSearch.totalItems).toBe(0);

      // Admin sees projected emails
      const adminList = await records.getList('member_contacts_masked', { sort: 'nickname' }, { isAdmin: true });
      expect(adminList.items.map((r) => r.member_email)).toEqual(['public@example.com', 'secret@example.com']);

      // 2. View projecting auth id and emailVisibility preserves per-row visibility & owner access
      await schema.createCollection({
        name: 'member_contacts_with_vis',
        type: 'view',
        options: {
          viewQueries: {
            sqlite: 'SELECT m.id AS uid, m.nickname, m.email AS contact_email, m.emailVisibility AS vis FROM members m',
          },
        },
        listRule: '',
      });

      const anonVisList = await records.getList('member_contacts_with_vis', { sort: 'nickname' });
      const pubRow = anonVisList.items.find((r) => r.uid === publicMember.id);
      const hidRow = anonVisList.items.find((r) => r.uid === hiddenMember.id);
      expect(pubRow?.contact_email).toBe('public@example.com');
      expect(hidRow?.contact_email).toBeUndefined();

      // Owner sees their own hidden email
      const ownerList = await records.getList('member_contacts_with_vis', {}, { id: hiddenMember.id });
      const ownerRow = ownerList.items.find((r) => r.uid === hiddenMember.id);
      expect(ownerRow?.contact_email).toBe('secret@example.com');
    });
  });

  // ------------------------------------------------------------------
  // 4. Simulated Postgres & MSSQL Catalog Inference
  // ------------------------------------------------------------------
  describe('Postgres & MSSQL Catalog Type Inference', () => {
    it('maps PostgreSQL information_schema types to NodeStack FieldTypes', async () => {
      const pgDialect = new PostgresDialect();
      const fakeDb: any = {
        dialect: pgDialect,
        all: async () => [
          { name: 'id', data_type: 'text', type: 'text', is_nullable: 'NO' },
          { name: 'total_amount', data_type: 'numeric', type: 'numeric', is_nullable: 'YES' },
          { name: 'is_active', data_type: 'boolean', type: 'boolean', is_nullable: 'NO' },
          { name: 'payload', data_type: 'jsonb', type: 'jsonb', is_nullable: 'YES' },
          { name: 'created_at', data_type: 'timestamp with time zone', type: 'timestamp with time zone', is_nullable: 'NO' },
        ],
      };

      const fields = await ViewSchemaInferrer.infer({
        db: fakeDb,
        viewName: 'pg_summary',
        selectSql: 'SELECT id, SUM(amount) AS total_amount, is_active, payload, created_at FROM items',
        existingCollections: [],
      });

      expect(fields.map((f) => [f.name, f.type])).toEqual([
        ['id', 'text'],
        ['total_amount', 'number'],
        ['is_active', 'bool'],
        ['payload', 'json'],
        ['created_at', 'date'],
      ]);
    });

    it('maps MSSQL INFORMATION_SCHEMA types to NodeStack FieldTypes', async () => {
      const mssqlDialect = new MssqlDialect();
      const fakeDb: any = {
        dialect: mssqlDialect,
        all: async () => [
          { name: 'category', type: 'nvarchar', IS_NULLABLE: 'NO' },
          { name: 'order_count', type: 'int', IS_NULLABLE: 'NO' },
          { name: 'has_discount', type: 'bit', IS_NULLABLE: 'YES' },
          { name: 'last_order', type: 'datetime2', IS_NULLABLE: 'YES' },
        ],
      };

      const fields = await ViewSchemaInferrer.infer({
        db: fakeDb,
        viewName: 'mssql_summary',
        selectSql: 'SELECT category, COUNT(*) AS order_count, has_discount, MAX(created) AS last_order FROM orders GROUP BY category',
        existingCollections: [],
      });

      expect(fields.map((f) => [f.name, f.type])).toEqual([
        ['category', 'text'],
        ['order_count', 'number'],
        ['has_discount', 'bool'],
        ['last_order', 'date'],
      ]);
    });
  });

  // ------------------------------------------------------------------
  // 5. TypeGenerator, OpenApiGenerator, Migrations, Snapshots & Analytics
  // ------------------------------------------------------------------
  describe('Codegen, OpenAPI, Migrations, Snapshots & Analytics', () => {
    it('emits accurate TypeScript types and read-only OpenAPI spec for views', async () => {
      await schema.createCollection({
        name: 'authors',
        type: 'base',
        schema: [{ id: 'f_name', name: 'name', type: 'text', required: true }],
      });
      await schema.createCollection({
        name: 'articles',
        type: 'base',
        schema: [
          { id: 'f_title', name: 'title', type: 'text', required: true },
          { id: 'f_author', name: 'author', type: 'relation', options: { collectionId: 'authors' } },
        ],
      });
      await schema.createCollection({
        name: 'author_stats',
        type: 'view',
        options: {
          viewQueries: {
            sqlite: 'SELECT a.id AS author, COUNT(art.id) AS article_count FROM authors a LEFT JOIN articles art ON art.author = a.id GROUP BY a.id',
          },
        },
        listRule: '',
      });

      const ts = TypeGenerator.generateFromCollections(schema.getAllCollections());
      expect(ts).toContain('export interface AuthorStatsRecord {');
      expect(ts).not.toContain('export interface AuthorStatsRecord extends BaseSystemFields');
      expect(ts).toContain('article_count?: number;');

      const spec = OpenApiGenerator.generateFromCollections(schema.getAllCollections());
      expect(spec.components.schemas.AuthorStatsRecord).toBeDefined();
      expect(spec.components.schemas.AuthorStatsCreate).toBeUndefined();
      expect(spec.components.schemas.AuthorStatsUpdate).toBeUndefined();
      expect(spec.paths['/api/collections/author_stats/records']?.get).toBeDefined();
      expect(spec.paths['/api/collections/author_stats/records']?.post).toBeUndefined();
      expect(spec.paths['/api/collections/author_stats/records/{id}']).toBeUndefined();
    });

    it('migrates and snapshots views without copying rows and excludes views from AnalyticsService.totalRecords', async () => {
      await schema.createCollection({
        name: 'items',
        type: 'base',
        schema: [{ id: 'f_price', name: 'price', type: 'number', required: true }],
        listRule: '',
      });
      await records.create('items', { id: 'i1', price: 10 }, { isAdmin: true });
      await records.create('items', { id: 'i2', price: 20 }, { isAdmin: true });

      await schema.createCollection({
        name: 'item_totals',
        type: 'view',
        options: { viewQueries: { sqlite: 'SELECT COUNT(*) AS cnt, SUM(price) AS sum_price FROM items' } },
        listRule: '',
      });

      const analytics = new AnalyticsService(db, new ConfigService({ dataDir: testDir }), schema, realtime);
      const metrics = await analytics.getDatabaseMetrics();
      expect(metrics.totalRecords).toBe(2);

      const snapDir = path.join(testDir, 'snap1');
      fs.mkdirSync(snapDir, { recursive: true });
      const snapDriver = new LogicalSnapshotDriver(db);
      await snapDriver.captureSnapshot(snapDir);

      const targetDriver = new NodeSqliteDriver(':memory:');
      const targetDb = new DatabaseService(new ConfigService({ dataDir: testDir }), targetDriver);
      targetDb.initSync();
      const targetSnap = new LogicalSnapshotDriver(targetDb);
      await targetSnap.restoreSnapshot(snapDir);

      const restoredKpi = targetDriver.prepareSync('SELECT cnt, sum_price FROM item_totals').get<{ cnt: number; sum_price: number }>();
      expect(restoredKpi).toEqual({ cnt: 2, sum_price: 30 });

      const migTargetDriver = new NodeSqliteDriver(':memory:');
      await DatabaseMigrationService.migrateAppScope(db.getRootDriver(), migTargetDriver);
      const migKpi = migTargetDriver.prepareSync('SELECT cnt, sum_price FROM item_totals').get<{ cnt: number; sum_price: number }>();
      expect(migKpi).toEqual({ cnt: 2, sum_price: 30 });

      await targetDb.close();
      await migTargetDriver.close();
    });

    it('rolls back all views in a single transaction if migration detects schema drift or missing view query', async () => {
      await schema.createCollection({
        name: 'products',
        type: 'base',
        schema: [{ id: 'f_price', name: 'price', type: 'number', required: true }],
        listRule: '',
      });
      await records.create('products', { id: 'p1', price: 15 }, { isAdmin: true });

      // View 1 is valid
      await schema.createCollection({
        name: 'valid_view_1',
        type: 'view',
        options: { viewQueries: { sqlite: 'SELECT id, price FROM products' } },
        listRule: '',
      });

      // View 2 has drifted stored schema in _collections (simulating cross-dialect drift during migration)
      await schema.createCollection({
        name: 'drifted_view_2',
        type: 'view',
        options: { viewQueries: { sqlite: 'SELECT id, price FROM products' } },
        listRule: '',
      });
      const corruptedSchema = JSON.stringify([
        { id: 'id', name: 'id', type: 'text', required: true },
        { id: 'price', name: 'price', type: 'text', required: false }, // drifted from number -> text
      ]);
      db.prepareSync("UPDATE _collections SET schema = ? WHERE name = 'drifted_view_2'").run(corruptedSchema);

      const targetDriver = new NodeSqliteDriver(':memory:');
      await expect(
        DatabaseMigrationService.migrateAppScope(db.getRootDriver(), targetDriver)
      ).rejects.toThrow(/Schema drift detected for view 'drifted_view_2'/i);

      // Verify rollback: NEITHER valid_view_1 NOR drifted_view_2 should exist in target DB
      const targetViews = targetDriver.prepareSync("SELECT name FROM sqlite_master WHERE type = 'view'").all();
      expect(targetViews).toHaveLength(0);
      const targetViewMeta = targetDriver.prepareSync("SELECT name FROM _collections WHERE type = 'view'").all();
      expect(targetViewMeta).toHaveLength(0);

      await targetDriver.close();
    });
  });
});
