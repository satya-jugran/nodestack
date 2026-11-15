import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeSqliteDriver } from '../src/database/drivers/NodeSqliteDriver';
import { PostgresDriver } from '../src/database/drivers/PostgresDriver';
import { DatabaseMigrationService, Migration } from '../src/database/migration/DatabaseMigrationService';
import { SystemMigrations } from '../src/database/migrations/SystemMigrations';

describe('DatabaseMigrationService - Migration Transaction Safety', () => {
  let driver: NodeSqliteDriver;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(':memory:');
    await DatabaseMigrationService.ensureMigrationsTable(driver);
  });

  afterEach(async () => {
    if (driver && driver.isOpen()) {
      await driver.close();
    }
  });

  it('should successfully run a migration and record it in _migrations inside a transaction', async () => {
    const migration: Migration = {
      id: '20261115_001_create_products',
      name: 'create_products',
      up: async (db) => {
        await db.exec(`
          CREATE TABLE products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            price REAL NOT NULL
          );
        `);
        await db.prepare('INSERT INTO products (id, name, price) VALUES (?, ?, ?)').run('p1', 'Widget', 19.99);
      },
    };

    const applied = await DatabaseMigrationService.runMigration(driver, migration);
    expect(applied).toBe(true);

    // Verify schema alteration persisted
    const product = await driver.prepare('SELECT * FROM products WHERE id = ?').get<any>('p1');
    expect(product).toBeDefined();
    expect(product.name).toBe('Widget');

    // Verify migration recording persisted
    const recorded = await driver.prepare('SELECT * FROM _migrations WHERE id = ?').get<any>('20261115_001_create_products');
    expect(recorded).toBeDefined();
    expect(recorded.name).toBe('create_products');
    expect(recorded.appliedAt).toBeDefined();

    // Verify getAppliedMigrations
    const appliedList = await DatabaseMigrationService.getAppliedMigrations(driver);
    expect(appliedList).toContain('20261115_001_create_products');
  });

  it('should rollback schema alterations when recording INSERT fails, allowing clean re-application on next restart', async () => {
    const migration: Migration = {
      id: '20261115_002_create_orders',
      name: 'create_orders',
      up: async (db) => {
        await db.exec(`
          CREATE TABLE orders (
            id TEXT PRIMARY KEY,
            total REAL NOT NULL,
            status TEXT NOT NULL
          );
        `);
      },
    };

    // Simulate failure during the recording INSERT into _migrations
    const originalPrepare = driver.prepare.bind(driver);
    driver.prepare = (sql: string) => {
      if (sql.includes('INSERT INTO _migrations')) {
        return {
          run: () => {
            throw new Error('Simulated disk I/O error or constraint failure on INSERT INTO _migrations');
          },
        } as any;
      }
      return originalPrepare(sql);
    };

    // Attempting migration should fail and throw
    await expect(
      DatabaseMigrationService.runMigration(driver, migration)
    ).rejects.toThrow('Simulated disk I/O error or constraint failure on INSERT INTO _migrations');

    // Crucial check: orders table must NOT exist in the database (rolled back)
    const tableCheck = await driver.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orders'
    `).get<any>();
    expect(tableCheck).toBeUndefined();

    // Crucial check: _migrations must NOT contain the migration
    const recordedCheck = await driver.prepare('SELECT id FROM _migrations WHERE id = ?').get<any>('20261115_002_create_orders');
    expect(recordedCheck).toBeUndefined();

    // Restore driver.prepare to simulate subsequent restart / retry
    driver.prepare = originalPrepare;

    // Next restart: re-apply should cleanly succeed without "table orders already exists" error
    const reapplyResult = await DatabaseMigrationService.runMigration(driver, migration);
    expect(reapplyResult).toBe(true);

    const tableAfterRestart = await driver.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orders'
    `).get<any>();
    expect(tableAfterRestart).toBeDefined();

    const recordedAfterRestart = await driver.prepare('SELECT id FROM _migrations WHERE id = ?').get<any>('20261115_002_create_orders');
    expect(recordedAfterRestart).toBeDefined();
  });

  it('should rollback transaction when migration.up() itself throws, leaving no partial schema changes or records', async () => {
    const failingMigration: Migration = {
      id: '20261115_003_failing_migration',
      name: 'failing_migration',
      up: async (db) => {
        await db.exec(`
          CREATE TABLE partial_table (
            id TEXT PRIMARY KEY,
            data TEXT
          );
        `);
        // Mid-migration failure
        throw new Error('Syntax error or fatal assertion inside migration.up()');
      },
    };

    await expect(
      DatabaseMigrationService.runMigration(driver, failingMigration)
    ).rejects.toThrow('Syntax error or fatal assertion inside migration.up()');

    const tableCheck = await driver.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial_table'
    `).get<any>();
    expect(tableCheck).toBeUndefined();

    const recordedCheck = await driver.prepare('SELECT id FROM _migrations WHERE id = ?').get<any>('20261115_003_failing_migration');
    expect(recordedCheck).toBeUndefined();
  });

  it('should skip already applied migration and not re-execute migration.up()', async () => {
    let executionCount = 0;
    const migration: Migration = {
      id: '20261115_004_idempotent',
      up: async () => {
        executionCount++;
      },
    };

    const firstRun = await DatabaseMigrationService.runMigration(driver, migration);
    expect(firstRun).toBe(true);
    expect(executionCount).toBe(1);

    const secondRun = await DatabaseMigrationService.runMigration(driver, migration);
    expect(secondRun).toBe(false);
    expect(executionCount).toBe(1);
  });

  it('should run multiple migrations sequentially via runMigrations', async () => {
    const migrations: Migration[] = [
      {
        id: '20261115_005_users_table',
        up: async (db) => {
          await db.exec('CREATE TABLE test_users (id TEXT PRIMARY KEY, email TEXT);');
        },
      },
      {
        id: '20261115_006_posts_table',
        up: async (db) => {
          await db.exec('CREATE TABLE test_posts (id TEXT PRIMARY KEY, title TEXT);');
        },
      },
    ];

    const applied = await DatabaseMigrationService.runMigrations(driver, migrations);
    expect(applied).toEqual(['20261115_005_users_table', '20261115_006_posts_table']);

    const appliedList = await DatabaseMigrationService.getAppliedMigrations(driver);
    expect(appliedList).toContain('20261115_005_users_table');
    expect(appliedList).toContain('20261115_006_posts_table');
  });

  it('should stop batch on failure and only keep earlier successful migrations', async () => {
    const migrations: Migration[] = [
      {
        id: '20261115_007_first_ok',
        up: async (db) => {
          await db.exec('CREATE TABLE batch_one (id TEXT PRIMARY KEY);');
        },
      },
      {
        id: '20261115_008_second_fail',
        up: async (db) => {
          await db.exec('CREATE TABLE batch_two (id TEXT PRIMARY KEY);');
          throw new Error('Batch stage 2 explosion');
        },
      },
      {
        id: '20261115_009_third_unreached',
        up: async (db) => {
          await db.exec('CREATE TABLE batch_three (id TEXT PRIMARY KEY);');
        },
      },
    ];

    await expect(
      DatabaseMigrationService.runMigrations(driver, migrations)
    ).rejects.toThrow('Batch stage 2 explosion');

    // First migration committed
    const tableOne = await driver.prepare("SELECT name FROM sqlite_master WHERE name = 'batch_one'").get();
    expect(tableOne).toBeDefined();

    // Second migration rolled back
    const tableTwo = await driver.prepare("SELECT name FROM sqlite_master WHERE name = 'batch_two'").get();
    expect(tableTwo).toBeUndefined();

    // Third migration never ran
    const tableThree = await driver.prepare("SELECT name FROM sqlite_master WHERE name = 'batch_three'").get();
    expect(tableThree).toBeUndefined();
  });

  it('should rollback migration via rollbackMigration inside a transaction', async () => {
    const migration: Migration = {
      id: '20261115_010_with_down',
      up: async (db) => {
        await db.exec('CREATE TABLE rollback_target (id TEXT PRIMARY KEY);');
      },
      down: async (db) => {
        await db.exec('DROP TABLE rollback_target;');
      },
    };

    await DatabaseMigrationService.runMigration(driver, migration);
    expect(await driver.prepare("SELECT name FROM sqlite_master WHERE name = 'rollback_target'").get()).toBeDefined();

    const rolledBack = await DatabaseMigrationService.rollbackMigration(driver, migration);
    expect(rolledBack).toBe(true);

    expect(await driver.prepare("SELECT name FROM sqlite_master WHERE name = 'rollback_target'").get()).toBeUndefined();
    expect(await driver.prepare('SELECT id FROM _migrations WHERE id = ?').get('20261115_010_with_down')).toBeUndefined();
  });

  it('should atomic-rollback collection creation in migrateAppScope if metadata recording fails', async () => {
    const sourceDriver = new NodeSqliteDriver(':memory:');
    const targetDriver = new NodeSqliteDriver(':memory:');

    await SystemMigrations.run(sourceDriver);
    await SystemMigrations.run(targetDriver);

    const now = new Date().toISOString();
    await sourceDriver.exec(`
      CREATE TABLE invoices (id TEXT PRIMARY KEY, amount REAL, created TEXT, updated TEXT);
    `);
    await sourceDriver.prepare(`
      INSERT INTO _collections (id, name, type, system, schema, indexes, options, created, updated)
      VALUES ('col_invoices', 'invoices', 'base', 0, '[]', '[]', '{}', ?, ?)
    `).run(now, now);

    // Simulate target failure when inserting into _collections during migrateAppScope
    const originalTargetPrepare = targetDriver.prepare.bind(targetDriver);
    targetDriver.prepare = (sql: string) => {
      if (sql.includes('INSERT INTO _collections')) {
        return {
          run: () => {
            throw new Error('Simulated failure during _collections metadata insert');
          },
        } as any;
      }
      return originalTargetPrepare(sql);
    };

    await expect(
      DatabaseMigrationService.migrateAppScope(sourceDriver, targetDriver)
    ).rejects.toThrow('Simulated failure during _collections metadata insert');

    // Verify physical table was rolled back and not left behind
    const invoiceTable = await targetDriver.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'invoices'
    `).get();
    expect(invoiceTable).toBeUndefined();

    // Verify _collections does not have 'invoices'
    const invoiceMeta = await targetDriver.prepare(`
      SELECT id FROM _collections WHERE name = 'invoices'
    `).get();
    expect(invoiceMeta).toBeUndefined();

    await sourceDriver.close();
    await targetDriver.close();
  });

  it('should support PostgreSQL driver transactions with rollback on failure', async () => {
    const executed: string[] = [];
    let released = false;

    const mockClient = {
      query: async (sql: string, params?: any[]) => {
        executed.push(sql);
        if (sql.includes('INSERT INTO "_migrations"') || sql.includes('INSERT INTO _migrations')) {
          throw new Error('Postgres unique constraint violation or disk failure');
        }
        return { rows: [] };
      },
      release: () => {
        released = true;
      },
    };

    const mockPool = {
      connect: async () => mockClient,
      query: async (sql: string) => mockClient.query(sql),
      end: async () => {},
    };

    const pgDriver = new PostgresDriver({ pool: mockPool as any, schemaName: 'public' });

    const migration: Migration = {
      id: '20261115_pg_001',
      up: async (db) => {
        await db.exec('CREATE TABLE test_pg (id VARCHAR(255) PRIMARY KEY);');
      },
    };

    await expect(
      DatabaseMigrationService.runMigration(pgDriver, migration)
    ).rejects.toThrow('Postgres unique constraint violation or disk failure');

    expect(executed).toContain('BEGIN;');
    expect(executed).toContain('ROLLBACK;');
    expect(executed).not.toContain('COMMIT;');
    expect(released).toBe(true);
  });

  it('should support SQL Server (MSSQL) driver transactions with rollback on failure', async () => {
    const executed: string[] = [];
    let txBegun = false;
    let txRolledBack = false;
    let txCommitted = false;

    const mockTx = {
      begin: async () => {
        txBegun = true;
      },
      commit: async () => {
        txCommitted = true;
      },
      rollback: async () => {
        txRolledBack = true;
      },
    };

    const mockDriver: any = {
      dialect: { name: 'mssql', createTableIfNotExists: () => 'CREATE TABLE [_migrations] (id NVARCHAR(255));', mapFieldType: () => 'NVARCHAR(255)' },
      isOpen: () => true,
      exec: async (sql: string) => {
        executed.push(sql);
      },
      prepare: (sql: string) => ({
        get: async () => null,
        run: async () => {
          executed.push(sql);
          if (sql.includes('INSERT INTO _migrations')) {
            throw new Error('MSSQL duplicate key or deadlock error');
          }
        },
        all: async () => [],
      }),
      transaction: async (fn: any) => {
        await mockTx.begin();
        try {
          const res = await fn(mockDriver);
          await mockTx.commit();
          return res;
        } catch (err) {
          await mockTx.rollback();
          throw err;
        }
      },
    };

    const migration: Migration = {
      id: '20261115_mssql_001',
      up: async (db) => {
        await db.exec('CREATE TABLE [test_mssql] (id NVARCHAR(255) PRIMARY KEY);');
      },
    };

    await expect(
      DatabaseMigrationService.runMigration(mockDriver, migration)
    ).rejects.toThrow('MSSQL duplicate key or deadlock error');

    expect(txBegun).toBe(true);
    expect(txRolledBack).toBe(true);
    expect(txCommitted).toBe(false);
  });

  it('should safely serialize and skip second concurrent runner without failing on unique key or running up twice', async () => {
    let upCallCount = 0;

    const migration: Migration = {
      id: '20261115_concurrent_race_test',
      name: 'concurrent_test',
      up: async (db) => {
        upCallCount++;
        // Small delay to simulate work inside up()
        await new Promise((resolve) => setTimeout(resolve, 20));
        await db.exec('CREATE TABLE concurrent_race (id TEXT PRIMARY KEY);');
      },
    };

    // Run both runners concurrently
    const [result1, result2] = await Promise.all([
      DatabaseMigrationService.runMigration(driver, migration),
      DatabaseMigrationService.runMigration(driver, migration),
    ]);

    // Exactly one must return true (applied), and the other must return false (safely skipped)
    expect([result1, result2].filter(Boolean)).toHaveLength(1);
    expect(upCallCount).toBe(1);

    // Table must exist
    expect(await driver.prepare("SELECT name FROM sqlite_master WHERE name = 'concurrent_race'").get()).toBeDefined();

    // Migration must be recorded once
    const records = await driver.prepare("SELECT * FROM _migrations WHERE id = '20261115_concurrent_race_test'").all();
    expect(records).toHaveLength(1);
  });

  it('should safely serialize concurrent rollbackMigration calls and skip second caller without double-invoking down', async () => {
    let downCallCount = 0;

    const migration: Migration = {
      id: '20261115_concurrent_rollback_test',
      name: 'concurrent_rollback',
      up: async (db) => {
        await db.exec('CREATE TABLE concurrent_rollback_table (id TEXT PRIMARY KEY);');
      },
      down: async (db) => {
        downCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        await db.exec('DROP TABLE concurrent_rollback_table;');
      },
    };

    await DatabaseMigrationService.runMigration(driver, migration);
    expect(await driver.prepare("SELECT name FROM sqlite_master WHERE name = 'concurrent_rollback_table'").get()).toBeDefined();

    // Concurrent rollback calls
    const [res1, res2] = await Promise.all([
      DatabaseMigrationService.rollbackMigration(driver, migration),
      DatabaseMigrationService.rollbackMigration(driver, migration),
    ]);

    // Exactly one should perform the rollback (true), the second should observe unapplied row and return false
    expect([res1, res2].filter(Boolean)).toHaveLength(1);
    expect(downCallCount).toBe(1);

    // Table dropped
    expect(await driver.prepare("SELECT name FROM sqlite_master WHERE name = 'concurrent_rollback_table'").get()).toBeUndefined();
    // Record deleted
    expect(await driver.prepare("SELECT id FROM _migrations WHERE id = '20261115_concurrent_rollback_test'").get()).toBeUndefined();
  });

  it('should check existence inside primary transaction during PostgreSQL rollbackMigration', async () => {
    const executed: string[] = [];
    let released = false;

    const mockClient = {
      query: async (sql: string, params?: any[]) => {
        executed.push(sql);
        if (sql.includes('SELECT id FROM _migrations') || sql.includes('SELECT id FROM "_migrations"')) {
          // Verify that this query was executed after BEGIN; on this primary connection
          expect(executed).toContain('BEGIN;');
          return { rows: [{ id: '20261115_pg_rollback_test' }] };
        }
        return { rows: [] };
      },
      release: () => {
        released = true;
      },
    };

    const mockPool = {
      connect: async () => mockClient,
      query: async (sql: string) => mockClient.query(sql),
      end: async () => {},
    };

    const pgDriver = new PostgresDriver({ pool: mockPool as any, schemaName: 'public' });

    let downExecuted = false;
    const migration: Migration = {
      id: '20261115_pg_rollback_test',
      down: async (db) => {
        downExecuted = true;
        await db.exec('DROP TABLE pg_rollback_table;');
      },
    };

    const res = await DatabaseMigrationService.rollbackMigration(pgDriver, migration);
    expect(res).toBe(true);
    expect(downExecuted).toBe(true);
    expect(executed).toContain('BEGIN;');
    expect(executed).toContain('COMMIT;');
    expect(released).toBe(true);
  });

  it('should support nested driver.transaction() calls inside migration.up() by keeping transactionDepth in sync', async () => {
    let nestedRan = false;

    const migration: Migration = {
      id: '20261115_nested_tx_test',
      name: 'nested_tx_migration',
      up: async (db) => {
        await db.exec('CREATE TABLE outer_tbl (id TEXT PRIMARY KEY);');

        // Nested transaction call using public driver.transaction() API
        db.transaction((tx) => {
          if ('execSync' in tx && typeof (tx as any).execSync === 'function') {
            (tx as any).execSync('CREATE TABLE inner_tbl (id TEXT PRIMARY KEY);');
          } else {
            tx.exec('CREATE TABLE inner_tbl (id TEXT PRIMARY KEY);');
          }
          nestedRan = true;
        });
      },
    };

    const res = await DatabaseMigrationService.runMigration(driver, migration);
    expect(res).toBe(true);
    expect(nestedRan).toBe(true);

    expect(await driver.prepare("SELECT name FROM sqlite_master WHERE name = 'outer_tbl'").get()).toBeDefined();
    expect(await driver.prepare("SELECT name FROM sqlite_master WHERE name = 'inner_tbl'").get()).toBeDefined();
    expect(await driver.prepare("SELECT id FROM _migrations WHERE id = '20261115_nested_tx_test'").get()).toBeDefined();
  });
});
