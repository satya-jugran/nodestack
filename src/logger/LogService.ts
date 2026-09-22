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

export class LogService {
  constructor(private db: DatabaseService) {}

  public logRequest(entry: LogEntry): void {
    const id = `log_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    try {
      this.db.prepare(`
        INSERT INTO _logs (id, method, url, status, duration, ip, authId, authCollection, userAgent, data, created)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        entry.method,
        entry.url,
        entry.status,
        entry.duration,
        entry.ip || null,
        entry.authId || null,
        entry.authCollection || null,
        entry.userAgent || null,
        entry.data ? JSON.stringify(entry.data) : null,
        now
      );
    } catch {
      // Don't let log write errors break request flow
    }

    // Console output with color formatting
    this.printToConsole(entry);
  }

  public getLogs(page = 1, perPage = 50): { items: any[]; totalItems: number; totalPages: number; page: number; perPage: number } {
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
    this.db.exec('DELETE FROM _logs;');
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
