import * as crypto from 'crypto';
import chalk from 'chalk';
import { DatabaseService } from '../database/DatabaseService';

export interface LogEntry {
  id?: string;
  method: string;
  url: string;
  status: number;
  duration: number;
  ip?: string;
  authId?: string;
  authCollection?: string;
  userAgent?: string;
  data?: any;
  created?: string;
}

interface BufferedLogItem {
  id: string;
  method: string;
  url: string;
  status: number;
  duration: number;
  ip: string | null;
  authId: string | null;
  authCollection: string | null;
  userAgent: string | null;
  data: string | null;
  created: string;
}

export class LogService {
  private buffer: BufferedLogItem[] = [];
  private flushTimer?: NodeJS.Timeout;
  private readonly maxBufferSize = 50;

  constructor(private db: DatabaseService) {
    this.flushTimer = setInterval(() => {
      try {
        const res = this.flush();
        if (res && typeof res.catch === 'function') {
          res.catch(() => {});
        }
      } catch {}
    }, 250);
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  public logRequest(entry: LogEntry, options: { skipConsole?: boolean } = {}): void {
    try {
      const id = `log_${crypto.randomBytes(6).toString('hex')}`;
      const now = new Date().toISOString();

      let serializedData: string | null = null;
      if (entry.data !== undefined && entry.data !== null) {
        try {
          serializedData = JSON.stringify(entry.data, (_key, value) =>
            typeof value === 'bigint' ? value.toString() : value
          );
        } catch {
          serializedData = null;
        }
      }

      this.buffer.push({
        id,
        method: entry.method,
        url: entry.url,
        status: entry.status,
        duration: entry.duration,
        ip: entry.ip || null,
        authId: entry.authId || null,
        authCollection: entry.authCollection || null,
        userAgent: entry.userAgent || null,
        data: serializedData,
        created: now,
      });

      if (this.buffer.length >= this.maxBufferSize) {
        this.flush().catch(() => {});
      }

      // Console output with color formatting
      if (!options.skipConsole) {
        this.printToConsole(entry);
      }
    } catch {
      // Don't let log write errors break request flow
    }
  }

  public flush(): any {
    if (this.buffer.length === 0) return;
    const items = [...this.buffer];
    this.buffer = [];

    try {
      if (this.db.dialect.name === 'sqlite') {
        this.db.transaction(() => {
          const stmt = this.db.prepare(`
            INSERT INTO _logs (id, method, url, status, duration, ip, authId, authCollection, userAgent, data, created)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const item of items) {
            stmt.run(
              item.id,
              item.method,
              item.url,
              item.status,
              item.duration,
              item.ip,
              item.authId,
              item.authCollection,
              item.userAgent,
              item.data,
              item.created
            );
          }
        });
      } else {
        return this.db.transaction(async (tx) => {
          for (const item of items) {
            await tx.prepare(`
              INSERT INTO _logs (id, method, url, status, duration, ip, authId, authCollection, userAgent, data, created)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              item.id,
              item.method,
              item.url,
              item.status,
              item.duration,
              item.ip,
              item.authId,
              item.authCollection,
              item.userAgent,
              item.data,
              item.created
            );
          }
        });
      }
    } catch {
      // Don't let log write errors break request flow
    }
  }

  public getLogs(page = 1, perPage = 50): any {
    const flushRes = this.flush();
    const fetch = () => {
      const offset = (page - 1) * perPage;
      const totalRow = this.db.get<any>('SELECT COUNT(*) as count FROM _logs');
      const processItems = (totalCount: number, items: any[]) => {
        const totalPages = Math.ceil(totalCount / perPage);
        return {
          items: (items || []).map((item) => ({
            ...item,
            data: item.data ? (typeof item.data === 'string' ? JSON.parse(item.data) : item.data) : null,
          })),
          totalItems: totalCount,
          totalPages,
          page,
          perPage,
        };
      };

      if (totalRow && typeof (totalRow as any).then === 'function') {
        return (totalRow as any).then(async (tr: any) => {
          const count = tr?.count || 0;
          const paginatedSql = this.db.dialect.paginate('SELECT * FROM _logs ORDER BY created DESC', perPage, offset);
          const items = await this.db.all<any>(paginatedSql);
          return processItems(count, items);
        });
      }

      const totalItems = totalRow?.count || 0;
      const paginatedSql = this.db.dialect.paginate('SELECT * FROM _logs ORDER BY created DESC', perPage, offset);
      const items = this.db.all<any>(paginatedSql);
      if (items && typeof (items as any).then === 'function') {
        return (items as any).then((rawItems: any[]) => processItems(totalItems, rawItems));
      }
      return processItems(totalItems, items);
    };

    if (flushRes && typeof flushRes.then === 'function') {
      return flushRes.then(fetch);
    }
    return fetch();
  }

  public pruneLogs(olderThanDays: number): any {
    const days = Number(olderThanDays);
    if (!Number.isFinite(days) || days < 0) {
      throw new Error('Invalid olderThanDays parameter: must be a non-negative finite number');
    }
    const flushRes = this.flush();
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const doDelete = () => {
      const result = this.db.prepare('DELETE FROM _logs WHERE created < ?').run(cutoff);
      if (result && typeof (result as any).then === 'function') {
        return (result as any).then((res: any) => Number(res.changes));
      }
      return Number((result as any).changes);
    };

    if (flushRes && typeof flushRes.then === 'function') {
      return flushRes.then(doDelete);
    }
    return doDelete();
  }

  public clearLogs(olderThanDays?: number): any {
    const flushRes = this.flush();
    if (olderThanDays !== undefined && olderThanDays !== null) {
      return this.pruneLogs(olderThanDays);
    }
    this.buffer = [];
    const doDelete = () => {
      const result = this.db.prepare('DELETE FROM _logs').run();
      if (result && typeof (result as any).then === 'function') {
        return (result as any).then((res: any) => Number(res.changes));
      }
      return Number((result as any).changes);
    };

    if (flushRes && typeof flushRes.then === 'function') {
      return flushRes.then(doDelete);
    }
    return doDelete();
  }

  public dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.flush();
  }

  private printToConsole(entry: LogEntry): void {
    // Avoid logging static asset requests to reduce console noise
    if (entry.url.startsWith('/_/') && !entry.url.includes('/api/')) {
      return;
    }

    let statusColor = chalk.green;
    if (entry.status >= 500) statusColor = chalk.red;
    else if (entry.status >= 400) statusColor = chalk.yellow;
    else if (entry.status >= 300) statusColor = chalk.cyan;

    const method = chalk.bold(entry.method.padEnd(6));
    const status = statusColor(entry.status.toString().padEnd(4));
    const duration = chalk.gray(`${entry.duration.toFixed(1)}ms`.padStart(8));
    const url = chalk.white(entry.url);

    console.log(`${method} ${status} ${duration} ${url}`);
  }
}
