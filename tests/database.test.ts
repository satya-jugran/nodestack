import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../src/core/config/ConfigService';
import { DatabaseService } from '../src/database/DatabaseService';

describe('DatabaseService & NodeSqliteDriver Transaction Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_database_data');
  let config: ConfigService;
  let db: DatabaseService;

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
    fs.mkdirSync(testDir, { recursive: true });
    config = new ConfigService({ dataDir: testDir });
    db = new DatabaseService(config);
    db.init();
  });

  afterEach(() => {
    if (db && db.isOpen()) {
      db.close();
    }
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('should support nested transactions using savepoints with successful commit', () => {
    db.exec('CREATE TABLE test_items (id TEXT PRIMARY KEY, val TEXT);');

    db.transaction(() => {
      db.run('INSERT INTO test_items VALUES (?, ?)', '1', 'outer');

      db.transaction(() => {
        db.run('INSERT INTO test_items VALUES (?, ?)', '2', 'inner1');

        db.transaction(() => {
          db.run('INSERT INTO test_items VALUES (?, ?)', '3', 'inner2');
        });
      });
    });

    const all = db.all<{ id: string; val: string }>('SELECT * FROM test_items ORDER BY id ASC');
    expect(all).toHaveLength(3);
    expect(all.map((r) => r.id)).toEqual(['1', '2', '3']);
  });

  it('should rollback inner savepoint without aborting outer transaction when error is handled', () => {
    db.exec('CREATE TABLE test_items (id TEXT PRIMARY KEY, val TEXT);');

    db.transaction(() => {
      db.run('INSERT INTO test_items VALUES (?, ?)', '1', 'outer_kept');

      try {
        db.transaction(() => {
          db.run('INSERT INTO test_items VALUES (?, ?)', '2', 'inner_rolled_back');
          throw new Error('Inner failure');
        });
      } catch (err: any) {
        expect(err.message).toBe('Inner failure');
      }

      db.run('INSERT INTO test_items VALUES (?, ?)', '3', 'outer_after_inner');
    });

    const all = db.all<{ id: string; val: string }>('SELECT * FROM test_items ORDER BY id ASC');
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.id)).toEqual(['1', '3']);
  });

  it('should rollback entire transaction if top-level throws', () => {
    db.exec('CREATE TABLE test_items (id TEXT PRIMARY KEY, val TEXT);');

    expect(() => {
      db.transaction(() => {
        db.run('INSERT INTO test_items VALUES (?, ?)', '1', 'first');
        db.transaction(() => {
          db.run('INSERT INTO test_items VALUES (?, ?)', '2', 'second');
        });
        throw new Error('Top-level boom');
      });
    }).toThrow('Top-level boom');

    const all = db.all<{ id: string; val: string }>('SELECT * FROM test_items');
    expect(all).toHaveLength(0);
  });

  it('should reject async functions passed to transaction before invocation', () => {
    db.exec('CREATE TABLE test_items (id TEXT PRIMARY KEY, val TEXT);');

    let invoked = false;
    expect(() => {
      db.transaction((async () => {
        invoked = true;
        db.run('INSERT INTO test_items VALUES (?, ?)', '1', 'async');
        await Promise.resolve();
        db.run('INSERT INTO test_items VALUES (?, ?)', '2', 'after_await');
      }) as any);
    }).toThrow(/asynchronous functions cannot be used/i);

    expect(invoked).toBe(false);
    const all = db.all<{ id: string; val: string }>('SELECT * FROM test_items');
    expect(all).toHaveLength(0);
  });

  it('should reject functions returning a Promise to prevent unmanaged async execution', () => {
    db.exec('CREATE TABLE test_items (id TEXT PRIMARY KEY, val TEXT);');

    expect(() => {
      db.transaction((() => {
        db.run('INSERT INTO test_items VALUES (?, ?)', '1', 'promise');
        return Promise.resolve('delayed');
      }) as any);
    }).toThrow(/asynchronous functions|promise-returning/i);

    const all = db.all<{ id: string; val: string }>('SELECT * FROM test_items');
    expect(all).toHaveLength(0);
  });

  describe('DatabaseService.initialize() & Connection Leak Prevention', () => {
    it('should close driver when driver.connect() succeeds but subsequent step (init) fails', async () => {
      let connected = false;
      let closed = false;

      const mockDriver: any = {
        dialect: {
          name: 'mock',
          mapFieldType: () => 'TEXT',
          createTableIfNotExists: () => {
            throw new Error('Migration failure after connect');
          },
          booleanLiteral: () => '0',
        },
        connect: async () => {
          connected = true;
        },
        close: async () => {
          closed = true;
        },
        isOpen: () => true,
      };

      const testDb = new DatabaseService(config);
      await expect(testDb.initialize(mockDriver)).rejects.toThrow('Migration failure after connect');
      expect(connected).toBe(true);
      expect(closed).toBe(true);
    });

    it('should close previous driver before re-assignment when calling initialize twice', async () => {
      const closeOrder: string[] = [];
      let driver1Closed = false;
      let driver2Closed = false;

      const mockDriver1: any = {
        dialect: {
          name: 'mock',
          mapFieldType: () => 'TEXT',
          createTableIfNotExists: () => 'SELECT 1;',
          createIndexIfNotExists: () => 'SELECT 1;',
          booleanLiteral: () => '0',
        },
        prepare: () => ({
          all: () => [],
          get: () => undefined,
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
        }),
        exec: () => {},
        transaction: (fn: any) => fn(mockDriver1),
        connect: async () => {},
        close: async () => {
          driver1Closed = true;
          closeOrder.push('driver1');
        },
        isOpen: () => true,
      };

      const mockDriver2: any = {
        dialect: {
          name: 'mock',
          mapFieldType: () => 'TEXT',
          createTableIfNotExists: () => 'SELECT 1;',
          createIndexIfNotExists: () => 'SELECT 1;',
          booleanLiteral: () => '0',
        },
        prepare: () => ({
          all: () => [],
          get: () => undefined,
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
        }),
        exec: () => {},
        transaction: (fn: any) => fn(mockDriver2),
        connect: async () => {},
        close: async () => {
          driver2Closed = true;
          closeOrder.push('driver2');
        },
        isOpen: () => true,
      };

      const testDb = new DatabaseService(config);
      await testDb.initialize(mockDriver1);
      expect(testDb.getRootDriver()).toBe(mockDriver1);
      expect(driver1Closed).toBe(false);

      // Calling initialize a second time with mockDriver2 should close mockDriver1 before re-assignment
      await testDb.initialize(mockDriver2);
      expect(driver1Closed).toBe(true);
      expect(driver2Closed).toBe(false);
      expect(closeOrder).toEqual(['driver1']);
      expect(testDb.getRootDriver()).toBe(mockDriver2);
    });

    it('should close driver if driver.connect() fails', async () => {
      let closed = false;
      const failingDriver: any = {
        dialect: { name: 'mock' },
        connect: async () => {
          throw new Error('Connection refused');
        },
        close: async () => {
          closed = true;
        },
        isOpen: () => false,
      };

      const testDb = new DatabaseService(config);
      await expect(testDb.initialize(failingDriver)).rejects.toThrow('Connection refused');
      expect(closed).toBe(true);
    });
  });
});
