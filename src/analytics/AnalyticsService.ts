import * as fs from 'fs';
import { DatabaseService } from '../database/DatabaseService';
import { ConfigService } from '../core/config/ConfigService';
import { SchemaService } from '../schema/SchemaService';
import { RealtimeService } from '../realtime/RealtimeService';

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
}

export interface RealtimeMetrics {
  connectedClients: number;
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
  constructor(
    private db: DatabaseService,
    private config: ConfigService,
    private schemaService: SchemaService,
    private realtimeService: RealtimeService
  ) {}

  public getDatabaseMetrics(): DatabaseMetrics {
    let sizeBytes = 0;
    let walSizeBytes = 0;

    try {
      if (fs.existsSync(this.config.dbPath)) {
        sizeBytes += fs.statSync(this.config.dbPath).size;
      }
      const walPath = `${this.config.dbPath}-wal`;
      if (fs.existsSync(walPath)) {
        const walSize = fs.statSync(walPath).size;
        walSizeBytes = walSize;
        sizeBytes += walSize;
      }
      const shmPath = `${this.config.dbPath}-shm`;
      if (fs.existsSync(shmPath)) {
        sizeBytes += fs.statSync(shmPath).size;
      }
    } catch {
      // In-memory or virtual filesystem fallback
    }

    let totalRecords = 0;
    const collectionsBreakdown: CollectionRecordCount[] = [];
    const collections = this.schemaService.getAllCollections();

    for (const col of collections) {
      try {
        const row = this.db.get<{ count: number }>(`SELECT COUNT(*) as count FROM "${col.name}"`);
        const count = row?.count || 0;
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

    return {
      sizeBytes,
      sizeFormatted: formatBytes(sizeBytes),
      walSizeBytes,
      totalRecords,
      collectionsBreakdown,
    };
  }

  public getRealtimeMetrics(): RealtimeMetrics {
    return {
      connectedClients: this.realtimeService.getConnectedClientsCount(),
    };
  }

  public getTraffic24hMetrics(): Traffic24hMetrics {
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    let rows: Array<{
      hourKey: string;
      total: number;
      errors: number;
      successes: number;
      avgDuration: number;
    }> = [];

    let overallRow: { total: number; errors: number; avgDuration: number } | undefined;

    try {
      rows = this.db.all<{
        hourKey: string;
        total: number;
        errors: number;
        successes: number;
        avgDuration: number;
      }>(
        `SELECT
           substr(created, 1, 13) as hourKey,
           COUNT(*) as total,
           SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) as errors,
           SUM(CASE WHEN status < 400 THEN 1 ELSE 0 END) as successes,
           AVG(duration) as avgDuration
         FROM _logs
         WHERE created >= ?
         GROUP BY hourKey
         ORDER BY hourKey ASC`,
        since.toISOString()
      );

      overallRow = this.db.get<{ total: number; errors: number; avgDuration: number }>(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) as errors,
           AVG(duration) as avgDuration
         FROM _logs
         WHERE created >= ?`,
        since.toISOString()
      );
    } catch {
      // Table might not exist or error
    }

    const rowMap = new Map<string, (typeof rows)[0]>();
    for (const r of rows) {
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
  }

  public getMetrics(): AnalyticsMetrics {
    return {
      database: this.getDatabaseMetrics(),
      realtime: this.getRealtimeMetrics(),
      traffic24h: this.getTraffic24hMetrics(),
      system: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
      },
    };
  }
}
