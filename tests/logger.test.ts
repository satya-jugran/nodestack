import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../src/core/config/ConfigService';
import { DatabaseService } from '../src/database/DatabaseService';
import { LogService } from '../src/logger/LogService';

describe('LogService In-Memory Buffering & Write Batching Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_logger_data');
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

  it('should buffer log writes and flush them in a single batch', () => {
    const logService = new LogService(db);

    // Log 5 requests
    for (let i = 1; i <= 5; i++) {
      logService.logRequest({
        method: 'GET',
        url: `/api/items/${i}`,
        status: 200,
        duration: 1.5,
        ip: '127.0.0.1',
      });
    }

    // Check raw database table directly before flush or getLogs
    const rawCountBefore = db.get<{ count: number }>('SELECT COUNT(*) as count FROM _logs');
    expect(rawCountBefore?.count).toBe(0);

    // getLogs() automatically flushes the buffer
    const logs = logService.getLogs(1, 10);
    expect(logs.totalItems).toBe(5);
    expect(logs.items).toHaveLength(5);

    const rawCountAfter = db.get<{ count: number }>('SELECT COUNT(*) as count FROM _logs');
    expect(rawCountAfter?.count).toBe(5);

    logService.dispose();
  });

  it('should automatically flush when buffer reaches maxBufferSize', () => {
    const logService = new LogService(db);

    // Log 50 requests (maxBufferSize)
    for (let i = 1; i <= 50; i++) {
      logService.logRequest({
        method: 'POST',
        url: `/api/batch/${i}`,
        status: 201,
        duration: 2.0,
        ip: '127.0.0.1',
      });
    }

    // Should have automatically flushed into SQLite table
    const rawCount = db.get<{ count: number }>('SELECT COUNT(*) as count FROM _logs');
    expect(rawCount?.count).toBe(50);

    logService.dispose();
  });

  it('should clean up timers and pending buffer on dispose()', () => {
    const logService = new LogService(db);

    logService.logRequest({
      method: 'DELETE',
      url: '/api/cleanup',
      status: 204,
      duration: 0.8,
      ip: '127.0.0.1',
    });

    // Calling dispose() flushes remaining items and clears timer
    logService.dispose();

    const rawCount = db.get<{ count: number }>('SELECT COUNT(*) as count FROM _logs');
    expect(rawCount?.count).toBe(1);
  });

  it('should clear buffer and database records on clearLogs()', () => {
    const logService = new LogService(db);

    logService.logRequest({
      method: 'GET',
      url: '/api/to-clear',
      status: 200,
      duration: 1.0,
      ip: '127.0.0.1',
    });

    logService.clearLogs();

    const logs = logService.getLogs(1, 10);
    expect(logs.totalItems).toBe(0);
    expect(logs.items).toHaveLength(0);

    logService.dispose();
  });

  it('should prune logs older than specified days and keep recent logs', () => {
    const logService = new LogService(db);

    // Insert old log (35 days old)
    const oldDate = new Date(Date.now() - 35 * 86400000).toISOString();
    db.prepare(`
      INSERT INTO _logs (id, method, url, status, duration, ip, authId, authCollection, userAgent, data, created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('old_1', 'GET', '/old', 200, 1.0, null, null, null, null, null, oldDate);

    // Insert recent log (1 day old)
    const recentDate = new Date(Date.now() - 1 * 86400000).toISOString();
    db.prepare(`
      INSERT INTO _logs (id, method, url, status, duration, ip, authId, authCollection, userAgent, data, created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('recent_1', 'GET', '/recent', 200, 1.0, null, null, null, null, null, recentDate);

    const deletedCount = logService.pruneLogs(30);
    expect(deletedCount).toBe(1);

    const remaining = logService.getLogs(1, 10);
    expect(remaining.totalItems).toBe(1);
    expect(remaining.items[0].id).toBe('recent_1');

    logService.dispose();
  });

  it('should defensively handle circular references in entry.data without throwing', () => {
    const logService = new LogService(db);

    const circularObj: any = { message: 'hello' };
    circularObj.self = circularObj;

    expect(() => {
      logService.logRequest({
        method: 'POST',
        url: '/api/circular',
        status: 500,
        duration: 12.3,
        data: circularObj,
      });
    }).not.toThrow();

    const logs = logService.getLogs(1, 10);
    expect(logs.totalItems).toBe(1);
    expect(logs.items[0].url).toBe('/api/circular');
    expect(logs.items[0].data).toBeNull();

    logService.dispose();
  });

  it('should safely serialize objects containing BigInt in entry.data without throwing', () => {
    const logService = new LogService(db);

    expect(() => {
      logService.logRequest({
        method: 'GET',
        url: '/api/bigint',
        status: 200,
        duration: 4.5,
        data: { amount: 1000000000000000000n, label: 'wei' },
      });
    }).not.toThrow();

    const logs = logService.getLogs(1, 10);
    expect(logs.totalItems).toBe(1);
    expect(logs.items[0].url).toBe('/api/bigint');
    expect(logs.items[0].data).toEqual({ amount: '1000000000000000000', label: 'wei' });

    logService.dispose();
  });
});
