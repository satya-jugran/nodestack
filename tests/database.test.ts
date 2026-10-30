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

  it('should reject async functions passed to transaction to prevent premature commit', () => {
    db.exec('CREATE TABLE test_items (id TEXT PRIMARY KEY, val TEXT);');

    expect(() => {
      db.transaction((async () => {
        db.run('INSERT INTO test_items VALUES (?, ?)', '1', 'async');
      }) as any);
    }).toThrow(/asynchronous functions cannot be used/i);
  });
});
