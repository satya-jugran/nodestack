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

  public async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const items = [...this.buffer];
    this.buffer = [];

    try {
      await this.db.transaction(async (tx) => {
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
    } catch {
      // Don't let log write errors break request flow
    }
  }

  public async getLogs(page = 1, perPage = 50): Promise<any> {
    await this.flush();
    const offset = (page - 1) * perPage;
    const paginatedSql = this.db.dialect.paginate('SELECT * FROM _logs ORDER BY created DESC', perPage, offset);
    const [totalRow, items] = await Promise.all([
      this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM _logs'),
      this.db.all<any>(paginatedSql),
    ]);

    const totalCount = Number(totalRow?.count || 0);
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
  }

  public async pruneLogs(olderThanDays: number): Promise<number> {
    const days = Number(olderThanDays);
    if (!Number.isFinite(days) || days < 0) {
      throw new Error('Invalid olderThanDays parameter: must be a non-negative finite number');
    }
    await this.flush();
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const result = await this.db.prepare('DELETE FROM _logs WHERE created < ?').run(cutoff);
    return Number(result.changes);
  }

  public async clearLogs(olderThanDays?: number): Promise<number> {
    await this.flush();
    if (olderThanDays !== undefined && olderThanDays !== null) {
      return await this.pruneLogs(olderThanDays);
    }
    this.buffer = [];
    const result = await this.db.prepare('DELETE FROM _logs').run();
    return Number(result.changes);
  }

  public dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.flush().catch(() => {});
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
