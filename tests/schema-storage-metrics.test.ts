import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { AnalyticsService } from '../src/analytics/AnalyticsService';
import { PostgresDialect } from '../src/database/dialects/PostgresDialect';
import { MssqlDialect } from '../src/database/dialects/MssqlDialect';

describe('Per-App Schema Storage Metrics', () => {
  const testDir = path.join(process.cwd(), '.tmp_test_schema_storage');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should query schema-specific relation size and total db size for PostgreSQL', async () => {
    const executedQueries: string[] = [];

    const fakeDriver: any = {
      getSchemaName: () => 'app_test_blog',
    };

    const fakeDb: any = {
      dialect: new PostgresDialect(),
      isOpen: () => true,
      getDriver: () => fakeDriver,
      getSchemaName: () => 'app_test_blog',
      get: async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes('pg_tables')) {
          // Return 5 MB for this specific app schema
          return { size: 5 * 1024 * 1024 };
        }
        if (sql.includes('pg_database_size')) {
          // Return 50 MB for the entire shared postgres instance
          return { size: 50 * 1024 * 1024 };
        }
        if (sql.includes('COUNT(*)')) {
          return { count: 25 };
        }
        return undefined;
      },
    };

    const fakeSchema: any = {
      getAllCollections: async () => [{ name: 'posts', type: 'base' }],
    };

    const fakeConfig: any = { dbPath: path.join(testDir, 'fake.db') };
    const fakeRealtime: any = { getConnectedClientsCount: () => 0 };

    const analytics = new AnalyticsService(
      fakeDb as any,
      fakeConfig as any,
      fakeSchema as any,
      fakeRealtime as any
    );

    const metrics = await analytics.getDatabaseMetrics();

    expect(metrics).toBeDefined();
    // Effective app storage size should be the 5 MB from the schema, NOT the 50 MB from the shared DB
    expect(metrics.sizeBytes).toBe(5 * 1024 * 1024);
    expect(metrics.sizeFormatted).toBe('5 MB');
    expect(metrics.schemaName).toBe('app_test_blog');
    expect(metrics.totalDatabaseSizeBytes).toBe(50 * 1024 * 1024);
    expect(metrics.totalDatabaseSizeFormatted).toBe('50 MB');
    expect(metrics.provider).toBe('postgres');

    // Verify queries executed
    expect(executedQueries.some((q) => q.includes('pg_tables') && q.includes('app_test_blog'))).toBe(true);
    expect(executedQueries.some((q) => q.includes('pg_database_size'))).toBe(true);
  });

  it('should fallback to summing registered collections relation size if pg_tables returns 0 in PostgreSQL', async () => {
    const executedQueries: string[] = [];

    const fakeDriver: any = {
      getSchemaName: () => 'app_blog',
    };

    const fakeDb: any = {
      dialect: new PostgresDialect(),
      isOpen: () => true,
      getDriver: () => fakeDriver,
      getSchemaName: () => 'app_blog',
      get: async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes('pg_tables')) {
          return { size: 0 };
        }
        if (sql.includes('pg_total_relation_size("posts")')) {
          return { size: 2 * 1024 * 1024 };
        }
        if (sql.includes('pg_total_relation_size("authors")')) {
          return { size: 1 * 1024 * 1024 };
        }
        if (sql.includes('pg_database_size')) {
          return { size: 100 * 1024 * 1024 };
        }
        if (sql.includes('COUNT(*)')) {
          return { count: 10 };
        }
        return undefined;
      },
    };

    const fakeSchema: any = {
      getAllCollections: async () => [
        { name: 'posts', type: 'base' },
        { name: 'authors', type: 'base' },
      ],
    };

    const analytics = new AnalyticsService(
      fakeDb as any,
      { dbPath: path.join(testDir, 'fake.db') } as any,
      fakeSchema as any,
      { getConnectedClientsCount: () => 0 } as any
    );

    const metrics = await analytics.getDatabaseMetrics();

    expect(metrics.sizeBytes).toBe(3 * 1024 * 1024);
    expect(metrics.sizeFormatted).toBe('3 MB');
    expect(metrics.totalDatabaseSizeBytes).toBe(100 * 1024 * 1024);
  });

  it('should query schema-specific allocation units for SQL Server (MSSQL)', async () => {
    const executedQueries: string[] = [];

    const fakeDriver: any = {
      getSchemaName: () => 'app_ecommerce',
    };

    const fakeDb: any = {
      dialect: new MssqlDialect(),
      isOpen: () => true,
      getDriver: () => fakeDriver,
      getSchemaName: () => 'app_ecommerce',
      get: async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes('sys.allocation_units')) {
          // Return 12 MB for this app schema
          return { size: 12 * 1024 * 1024 };
        }
        if (sql.includes('sys.database_files')) {
          // Return 250 MB for the shared mssql database file
          return { size: 250 * 1024 * 1024 };
        }
        if (sql.includes('COUNT(*)')) {
          return { count: 100 };
        }
        return undefined;
      },
    };

    const fakeSchema: any = {
      getAllCollections: async () => [{ name: 'products', type: 'base' }],
    };

    const analytics = new AnalyticsService(
      fakeDb as any,
      { dbPath: path.join(testDir, 'fake.db') } as any,
      fakeSchema as any,
      { getConnectedClientsCount: () => 0 } as any
    );

    const metrics = await analytics.getDatabaseMetrics();

    expect(metrics.sizeBytes).toBe(12 * 1024 * 1024);
    expect(metrics.sizeFormatted).toBe('12 MB');
    expect(metrics.schemaName).toBe('app_ecommerce');
    expect(metrics.totalDatabaseSizeBytes).toBe(250 * 1024 * 1024);
    expect(metrics.totalDatabaseSizeFormatted).toBe('250 MB');
    expect(metrics.provider).toBe('mssql');

    expect(executedQueries.some((q) => q.includes('sys.allocation_units') && q.includes('app_ecommerce'))).toBe(true);
  });
});
