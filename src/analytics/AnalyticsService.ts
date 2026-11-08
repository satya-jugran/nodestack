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

  public getDatabaseMetrics(): any {
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

    const collections = this.schemaService.getAllCollections();

    const processCollections = (cols: any[]) => {
      let totalRecords = 0;
      const collectionsBreakdown: CollectionRecordCount[] = [];

      const queryCol = (col: any) => {
        try {
          const row = this.db.get<{ count: number }>(`SELECT COUNT(*) as count FROM ${this.db.dialect.quoteIdentifier(col.name)}`);
          if (row && typeof (row as any).then === 'function') {
            return (row as any).then((r: any) => {
              const count = Number(r?.count || 0);
              totalRecords += count;
              collectionsBreakdown.push({
                collection: col.name,
                type: col.type,
                count,
              });
            }).catch(() => {
              collectionsBreakdown.push({
                collection: col.name,
                type: col.type,
                count: 0,
              });
            });
          }
          const count = Number((row as any)?.count || 0);
          totalRecords += count;
          collectionsBreakdown.push({
            collection: col.name,
            type: col.type,
            count,
          });
          return null;
        } catch {
          collectionsBreakdown.push({
            collection: col.name,
            type: col.type,
            count: 0,
          });
          return null;
        }
      };

      const promises: Promise<any>[] = [];
      for (const col of cols || []) {
        const res = queryCol(col);
        if (res) promises.push(res);
      }

      const finish = (): DatabaseMetrics => ({
        sizeBytes,
        sizeFormatted: formatBytes(sizeBytes),
        walSizeBytes,
        totalRecords,
        collectionsBreakdown,
      });

      if (promises.length > 0) {
        return Promise.all(promises).then(finish);
      }
      return finish();
    };

    if (collections && typeof (collections as any).then === 'function') {
      return (collections as any).then(processCollections);
    }
    return processCollections(collections);
  }

  public getRealtimeMetrics(): RealtimeMetrics {
    return {
      connectedClients: this.realtimeService.getConnectedClientsCount(),
    };
  }

  public getTraffic24hMetrics(): any {
    this.logService?.flush();
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
      const rowsRes = this.db.all<{
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

      const overallRes = this.db.get<{ total: number; errors: number; avgDuration: number }>(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) as errors,
           AVG(duration) as avgDuration
         FROM _logs
         WHERE created >= ?`,
        since.toISOString()
      );

      if (
        (rowsRes && typeof (rowsRes as any).then === 'function') ||
        (overallRes && typeof (overallRes as any).then === 'function')
      ) {
        return Promise.all([rowsRes, overallRes])
          .then(([rows, overall]) => computeMetrics(rows, overall))
          .catch(() => computeMetrics([], undefined));
      }
      return computeMetrics(rowsRes as any, overallRes as any);
    } catch {
      return computeMetrics([], undefined);
    }
  }

  public getMetrics(): any {
    const dbMetrics = this.getDatabaseMetrics();
    const trafficMetrics = this.getTraffic24hMetrics();
    const realtime = this.getRealtimeMetrics();
    const system = {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };

    if (
      (dbMetrics && typeof (dbMetrics as any).then === 'function') ||
      (trafficMetrics && typeof (trafficMetrics as any).then === 'function')
    ) {
      return Promise.all([dbMetrics, trafficMetrics]).then(([database, traffic24h]) => ({
        database,
        realtime,
        traffic24h,
        system,
      }));
    }

    return {
      database: dbMetrics,
      realtime,
      traffic24h: trafficMetrics,
      system,
    };
  }
}
