import * as fs from 'fs';
import { DatabaseService } from '../database/DatabaseService';
import { ConfigService } from '../core/config/ConfigService';
import { SchemaService } from '../schema/SchemaService';
import { RealtimeService } from '../realtime/RealtimeService';
import { LogService } from '../logger/LogService';

export interface CollectionRecordCount {
  collection: string;
  type: string;
  count: number;
}

export interface DatabaseMetrics {
  sizeBytes: number;
  sizeFormatted: string;
  walSizeBytes: number;
  totalRecords: number;
  collectionsBreakdown: CollectionRecordCount[];
  provider?: string;
  schemaName?: string;
  totalDatabaseSizeBytes?: number;
  totalDatabaseSizeFormatted?: string;
}

export interface RealtimeMetrics {
  connectedClients: number;
}

export interface HourlyDataPoint {
  timestamp: string;
  hourKey: string;
  label: string;
  totalRequests: number;
  errorRequests: number;
  successRequests: number;
  errorRate: number;
  avgDuration: number;
}

export interface Traffic24hMetrics {
  totalRequests: number;
  totalErrors: number;
  overallErrorRate: number;
  avgDuration: number;
  peakHourRequests: number;
  series: HourlyDataPoint[];
}

export interface AnalyticsMetrics {
  database: DatabaseMetrics;
  realtime: RealtimeMetrics;
  traffic24h: Traffic24hMetrics;
  system: {
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
  };
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export class AnalyticsService {
  private dbPath: string;
  private logService?: LogService;

  constructor(
    private db: DatabaseService,
    private config: ConfigService,
    private schemaService: SchemaService,
    private realtimeService: RealtimeService,
    options?: { dbPath?: string; logService?: LogService }
  ) {
    this.dbPath = options?.dbPath || this.config.dbPath;
    this.logService = options?.logService;
  }

  public async getDatabaseMetrics(): Promise<DatabaseMetrics> {
    let sizeBytes = 0;
    let walSizeBytes = 0;

    try {
      if (fs.existsSync(this.dbPath)) {
        sizeBytes += fs.statSync(this.dbPath).size;
      }
      const walPath = `${this.dbPath}-wal`;
      if (fs.existsSync(walPath)) {
        const walSize = fs.statSync(walPath).size;
        walSizeBytes = walSize;
        sizeBytes += walSize;
      }
      const shmPath = `${this.dbPath}-shm`;
      if (fs.existsSync(shmPath)) {
        sizeBytes += fs.statSync(shmPath).size;
      }
    } catch {
      // In-memory or virtual filesystem fallback
    }

    const collections = await this.schemaService.getAllCollections();
    let effectiveSizeBytes = sizeBytes;
    let totalDatabaseSizeBytes: number | undefined;
    let schemaName: string | undefined;

    if (this.db.dialect?.name === 'postgres') {
      const targetSchema = (this.db as any).getSchemaName?.() || 
        (typeof (this.db.getDriver?.() as any)?.getSchemaName === 'function' ? (this.db.getDriver() as any).getSchemaName() : 'public');
      schemaName = targetSchema;

      try {
        // 1. Measure app-specific schema storage size (tables + indexes + TOAST)
        const schemaSizeRow = await this.db.get<{ size: number | string }>(
          `SELECT COALESCE(SUM(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))), 0) as size ` +
          `FROM pg_tables WHERE schemaname = current_schema() OR schemaname = '${targetSchema.replace(/'/g, "''")}'`
        );
        if (schemaSizeRow && schemaSizeRow.size !== undefined && schemaSizeRow.size !== null) {
          effectiveSizeBytes = Number(schemaSizeRow.size);
        }
      } catch {}

      try {
        // 2. Measure overall shared physical database size for context
        const dbSizeRow = await this.db.get<{ size: number | string }>('SELECT pg_database_size(current_database()) as size');
        if (dbSizeRow && dbSizeRow.size !== undefined && dbSizeRow.size !== null) {
          totalDatabaseSizeBytes = Number(dbSizeRow.size);
        }
      } catch {}
    } else if (this.db.dialect?.name === 'mssql') {
      const targetSchema = (this.db as any).getSchemaName?.() || 
        (typeof (this.db.getDriver?.() as any)?.getSchemaName === 'function' ? (this.db.getDriver() as any).getSchemaName() : 'dbo');
      schemaName = targetSchema;

      try {
        // 1. Measure app-specific schema storage size (tables + indexes + LOB pages)
        const schemaSizeRow = await this.db.get<{ size: number | string }>(
          `SELECT COALESCE(SUM(a.total_pages) * 8 * 1024, 0) as size ` +
          `FROM sys.tables t ` +
          `JOIN sys.schemas s ON t.schema_id = s.schema_id ` +
          `JOIN sys.indexes i ON t.object_id = i.object_id ` +
          `JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id ` +
          `JOIN sys.allocation_units a ON p.partition_id = a.container_id ` +
          `WHERE s.name = '${targetSchema.replace(/'/g, "''")}' OR s.name = SCHEMA_NAME()`
        );
        if (schemaSizeRow && schemaSizeRow.size !== undefined && schemaSizeRow.size !== null) {
          effectiveSizeBytes = Number(schemaSizeRow.size);
        }
      } catch {}

      try {
        // 2. Measure overall database file size
        const dbSizeRow = await this.db.get<{ size: number | string }>('SELECT SUM(size) * 8 * 1024 as size FROM sys.database_files');
        if (dbSizeRow && dbSizeRow.size !== undefined && dbSizeRow.size !== null) {
          totalDatabaseSizeBytes = Number(dbSizeRow.size);
        }
      } catch {}
    }

    let totalRecords = 0;
    const collectionsBreakdown: CollectionRecordCount[] = [];

    for (const col of collections || []) {
      if (col.type === 'view') {
        collectionsBreakdown.push({
          collection: col.name,
          type: col.type,
          count: 0,
        });
        continue;
      }
      try {
        const row = await this.db.get<{ count: number }>(
          `SELECT COUNT(*) as count FROM ${this.db.dialect.quoteIdentifier(col.name)}`
        );
        const count = Number(row?.count || 0);
        totalRecords += count;
        collectionsBreakdown.push({
          collection: col.name,
          type: col.type,
          count,
        });
      } catch {
        collectionsBreakdown.push({
          collection: col.name,
          type: col.type,
          count: 0,
        });
      }
    }

    // Fallback: If catalog query returned 0/empty or was blocked, attempt summing collections relation size
    if (this.db.dialect?.name === 'postgres' && effectiveSizeBytes === 0 && Array.isArray(collections) && collections.length > 0) {
      let fallbackSum = 0;
      for (const col of collections) {
        if (col.type === 'view') continue;
        try {
          const relRow = await this.db.get<{ size: number | string }>(
            `SELECT pg_total_relation_size(${this.db.dialect.quoteIdentifier(col.name)}) as size`
          );
          if (relRow && relRow.size !== undefined && relRow.size !== null) {
            fallbackSum += Number(relRow.size);
          }
        } catch {}
      }
      if (fallbackSum > 0) {
        effectiveSizeBytes = fallbackSum;
      }
    }

    return {
      sizeBytes: effectiveSizeBytes,
      sizeFormatted: formatBytes(effectiveSizeBytes),
      walSizeBytes,
      totalRecords,
      collectionsBreakdown,
      provider: this.db.dialect?.name || 'sqlite',
      schemaName,
      totalDatabaseSizeBytes,
      totalDatabaseSizeFormatted: totalDatabaseSizeBytes !== undefined ? formatBytes(totalDatabaseSizeBytes) : undefined,
    };
  }

  public getRealtimeMetrics(): RealtimeMetrics {
    return {
      connectedClients: this.realtimeService.getConnectedClientsCount(),
    };
  }

  public async getTraffic24hMetrics(): Promise<Traffic24hMetrics> {
    await this.logService?.flush();
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const computeMetrics = (rows: any[], overallRow: any): Traffic24hMetrics => {
      const rowMap = new Map<string, any>();
      for (const r of rows || []) {
        rowMap.set(r.hourKey, r);
      }

      // Build exactly 24 contiguous hourly buckets up to current hour
      const series: HourlyDataPoint[] = [];
      for (let i = 23; i >= 0; i--) {
        const bucketTime = new Date(now.getTime() - i * 60 * 60 * 1000);
        const hourKey = bucketTime.toISOString().substring(0, 13);
        const label = `${hourKey.substring(11, 13)}:00`;
        const matched = rowMap.get(hourKey);

        const totalRequests = matched ? Number(matched.total) : 0;
        const errorRequests = matched ? Number(matched.errors) : 0;
        const successRequests = matched ? Number(matched.successes) : 0;
        const errorRate = totalRequests > 0 ? Number(((errorRequests / totalRequests) * 100).toFixed(2)) : 0;
        const avgDuration = matched && matched.avgDuration ? Number(Number(matched.avgDuration).toFixed(1)) : 0;

        series.push({
          timestamp: `${hourKey}:00:00.000Z`,
          hourKey,
          label,
          totalRequests,
          errorRequests,
          successRequests,
          errorRate,
          avgDuration,
        });
      }

      const totalRequests = overallRow?.total ? Number(overallRow.total) : 0;
      const totalErrors = overallRow?.errors ? Number(overallRow.errors) : 0;
      const overallErrorRate = totalRequests > 0 ? Number(((totalErrors / totalRequests) * 100).toFixed(2)) : 0;
      const avgDuration = overallRow && overallRow.avgDuration ? Number(Number(overallRow.avgDuration).toFixed(1)) : 0;
      const peakHourRequests = Math.max(0, ...series.map((s) => s.totalRequests));

      return {
        totalRequests,
        totalErrors,
        overallErrorRate,
        avgDuration,
        peakHourRequests,
        series,
      };
    };

    try {
      const hourExpr = this.db.dialect.substringSql('created', 1, 13);
      const rows = await this.db.all<{
        hourKey: string;
        total: number;
        errors: number;
        successes: number;
        avgDuration: number;
      }>(
        `SELECT
           ${hourExpr} as hourKey,
           COUNT(*) as total,
           SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) as errors,
           SUM(CASE WHEN status < 400 THEN 1 ELSE 0 END) as successes,
           AVG(duration) as avgDuration
         FROM _logs
         WHERE created >= ?
         GROUP BY ${hourExpr}
         ORDER BY hourKey ASC`,
        since.toISOString()
      );

      const overall = await this.db.get<{ total: number; errors: number; avgDuration: number }>(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) as errors,
           AVG(duration) as avgDuration
         FROM _logs
         WHERE created >= ?`,
        since.toISOString()
      );

      return computeMetrics(rows || [], overall);
    } catch {
      return computeMetrics([], undefined);
    }
  }

  public async getMetrics(): Promise<AnalyticsMetrics> {
    const [dbMetrics, trafficMetrics] = await Promise.all([
      this.getDatabaseMetrics(),
      this.getTraffic24hMetrics(),
    ]);
    const realtime = this.getRealtimeMetrics();
    const system = {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };

    return {
      database: dbMetrics,
      realtime,
      traffic24h: trafficMetrics,
      system,
    };
  }
}
