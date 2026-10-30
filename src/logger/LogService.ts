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
      this.flush();
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
        this.flush();
      }

      // Console output with color formatting
      if (!options.skipConsole) {
        this.printToConsole(entry);
      }
    } catch {
      // Don't let log write errors break request flow
    }
  }

  public flush(): void {
    if (this.buffer.length === 0) return;
    const items = [...this.buffer];
    this.buffer = [];

    try {
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
    } catch {
      // Don't let log write errors break request flow
    }
  }

  public getLogs(page = 1, perPage = 50): { items: any[]; totalItems: number; totalPages: number; page: number; perPage: number } {
    this.flush();
    const offset = (page - 1) * perPage;
    const totalRow = this.db.get<any>('SELECT COUNT(*) as count FROM _logs');
    const totalItems = totalRow?.count || 0;
    const totalPages = Math.ceil(totalItems / perPage);

    const items = this.db.all<any>(
      'SELECT * FROM _logs ORDER BY created DESC LIMIT ? OFFSET ?',
      [perPage, offset]
    );

    return {
      items: items.map((item) => ({
        ...item,
        data: item.data ? JSON.parse(item.data) : null,
      })),
      totalItems,
      totalPages,
      page,
      perPage,
    };
  }

  public clearLogs(): void {
    this.buffer = [];
    this.db.exec('DELETE FROM _logs;');
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
