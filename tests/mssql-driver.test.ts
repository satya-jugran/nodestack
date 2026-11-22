import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as driverLoader from '../src/database/drivers/DriverPackageLoader';
import { MssqlDriver } from '../src/database/drivers/MssqlDriver';

describe('MssqlDriver Unhandled Promise Rejection & Connection Handling', () => {
  let unhandledRejections: any[] = [];
  const onUnhandled = (err: any) => {
    unhandledRejections.push(err);
  };

  beforeEach(() => {
    unhandledRejections = [];
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(() => {
    process.removeListener('unhandledRejection', onUnhandled);
    vi.restoreAllMocks();
  });

  it('should not trigger UnhandledPromiseRejection when SQL Server host is unreachable at instantiation', async () => {
    class FailingConnectionPool {
      public config: any;
      public connectCalled = false;
      constructor(config: any) {
        this.config = config;
      }
      connect() {
        this.connectCalled = true;
        return Promise.reject(new Error('Failed to connect to localhost:1433 - connect ECONNREFUSED'));
      }
      close = vi.fn().mockResolvedValue(undefined);
      request = vi.fn();
    }

    vi.spyOn(driverLoader, 'loadDriverPackage').mockReturnValue({
      ConnectionPool: FailingConnectionPool,
    });

    // 1. String connection uri
    const driver1 = new MssqlDriver('mssql://sa:password@localhost:1433/testdb');
    // 2. Object with connectionString
    const driver2 = new MssqlDriver({ connectionString: 'mssql://sa:password@localhost:1433/testdb' });
    // 3. Object with server/port config
    const driver3 = new MssqlDriver({ server: 'unreachable-host', port: 1433, user: 'sa', password: 'pwd' });

    // Allow microtasks and event loop ticks to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Must NOT have emitted any unhandledRejection events
    expect(unhandledRejections).toHaveLength(0);

    // ensureConnected and connect must catch and re-raise the connection rejection
    await expect(driver1.ensureConnected()).rejects.toThrow('ECONNREFUSED');
    await expect(driver2.ensureConnected()).rejects.toThrow('ECONNREFUSED');
    await expect(driver3.connect()).rejects.toThrow('ECONNREFUSED');
  });

  it('should resolve ensureConnected and connect when connection succeeds', async () => {
    class SuccessfulConnectionPool {
      public config: any;
      constructor(config: any) {
        this.config = config;
      }
      connect() {
        return Promise.resolve(this);
      }
      close = vi.fn().mockResolvedValue(undefined);
      request = vi.fn().mockReturnValue({
        batch: vi.fn().mockResolvedValue({}),
        query: vi.fn().mockResolvedValue({ recordset: [{ ok: 1 }] }),
        input: vi.fn(),
      });
    }

    vi.spyOn(driverLoader, 'loadDriverPackage').mockReturnValue({
      ConnectionPool: SuccessfulConnectionPool,
    });

    const driver = new MssqlDriver({
      server: 'localhost',
      port: 1433,
      user: 'sa',
      password: 'pwd',
      database: 'master',
    });

    await expect(driver.ensureConnected()).resolves.toBeUndefined();
    await expect(driver.connect()).resolves.toBeUndefined();
    expect(driver.isOpen()).toBe(true);

    const pingRes = await driver.ping();
    expect(pingRes).toBe(true);

    await driver.close();
    expect(driver.isOpen()).toBe(false);
  });
});
