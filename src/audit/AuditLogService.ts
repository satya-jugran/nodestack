import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { RecordAfterEventContext } from '../core/events/types';

export interface AuditFieldDiff {
  old: any;
  new: any;
}

export type AuditDiffMap = Record<string, AuditFieldDiff>;

export interface AuditLogEntry {
  id: string;
  collection: string;
  recordId: string;
  action: 'create' | 'update' | 'delete';
  diff: AuditDiffMap;
  changedFields: string[];
  authId: string | null;
  authEmail: string | null;
  authCollection: string | null;
  isAdmin: boolean;
  ip: string | null;
  userAgent: string | null;
  created: string;
}

export interface AuditQueryOptions {
  collection?: string;
  recordId?: string;
  action?: string;
  actorId?: string;
  search?: string;
  page?: number;
  perPage?: number;
}

export interface AuditListResult {
  items: AuditLogEntry[];
  totalItems: number;
  totalPages: number;
  page: number;
  perPage: number;
}

const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'tokenKey',
  'secret',
  'apiKey',
  'token',
]);

const IGNORED_UPDATE_FIELDS = new Set(['updated']);

export class AuditLogService {
  constructor(private db: DatabaseService) {}

  /**
   * Generates a field-level JSON diff map comparing original and updated records.
   * Redacts sensitive credentials (passwords, tokens).
   */
  public computeDiff(
    action: 'create' | 'update' | 'delete',
    originalRecord?: Record<string, any> | null,
    currentRecord?: Record<string, any> | null
  ): { diff: AuditDiffMap; changedFields: string[] } {
    const diff: AuditDiffMap = {};
    const changedFields: string[] = [];

    if (action === 'create' && currentRecord) {
      for (const [key, val] of Object.entries(currentRecord)) {
        if (key === 'passwordHash' || key === 'tokenKey') continue;
        const isRedacted = REDACTED_FIELDS.has(key);
        diff[key] = {
          old: null,
          new: isRedacted ? '[REDACTED]' : val,
        };
        changedFields.push(key);
      }
      return { diff, changedFields };
    }

    if (action === 'delete' && originalRecord) {
      for (const [key, val] of Object.entries(originalRecord)) {
        if (key === 'passwordHash' || key === 'tokenKey') continue;
        const isRedacted = REDACTED_FIELDS.has(key);
        diff[key] = {
          old: isRedacted ? '[REDACTED]' : val,
          new: null,
        };
        changedFields.push(key);
      }
      return { diff, changedFields };
    }

    if (action === 'update' && originalRecord && currentRecord) {
      const allKeys = new Set([
        ...Object.keys(originalRecord),
        ...Object.keys(currentRecord),
      ]);

      for (const key of allKeys) {
        if (IGNORED_UPDATE_FIELDS.has(key)) continue;
        if (key === 'passwordHash' || key === 'tokenKey') continue;

        const oldVal = originalRecord[key];
        const newVal = currentRecord[key];

        const isOldUndefined = oldVal === undefined;
        const isNewUndefined = newVal === undefined;

        if (isOldUndefined && isNewUndefined) continue;

        const hasChanged =
          isOldUndefined !== isNewUndefined ||
          JSON.stringify(oldVal) !== JSON.stringify(newVal);

        if (hasChanged) {
          const isRedacted = REDACTED_FIELDS.has(key);
          diff[key] = {
            old: isRedacted ? (oldVal ? '[REDACTED]' : null) : oldVal ?? null,
            new: isRedacted ? (newVal ? '[REDACTED]' : null) : newVal ?? null,
          };
          changedFields.push(key);
        }
      }
    }

    changedFields.sort();
    return { diff, changedFields };
  }

  /**
   * Handler invoked by EventBus lifecycle hooks (onRecordAfterCreate/Update/Delete).
   */
  public async handleRecordEvent(
    action: 'create' | 'update' | 'delete',
    ctx: RecordAfterEventContext
  ): Promise<void> {
    try {
      const recordId = ctx.record?.id || ctx.originalRecord?.id;
      if (!recordId) return;

      const oldRecord = action === 'delete' ? (ctx.originalRecord || ctx.record) : ctx.originalRecord;
      const currentRecord = action === 'delete' ? null : ctx.record;

      const { diff, changedFields } = this.computeDiff(
        action,
        oldRecord,
        currentRecord
      );

      // Skip logging updates with 0 changed fields
      if (action === 'update' && changedFields.length === 0) {
        return;
      }

      const id = `audit_${crypto.randomBytes(8).toString('hex')}`;
      const now = new Date().toISOString();

      const authId = ctx.auth?.id || null;
      const authEmail = ctx.auth?.email || null;
      const authCollection = ctx.auth?.collection || null;
      const isAdmin = ctx.auth?.isAdmin ? 1 : 0;

      const httpReq = ctx.httpContext;
      const ip = httpReq?.ip || httpReq?.raw?.socket?.remoteAddress || null;
      const userAgent = httpReq?.headers
        ? httpReq.headers['user-agent'] || null
        : null;

      this.db.prepare(`
        INSERT INTO _audit_logs (
          id, collection, recordId, action, diff, changedFields,
          authId, authEmail, authCollection, isAdmin, ip, userAgent, created
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        ctx.collection,
        recordId,
        action,
        JSON.stringify(diff),
        JSON.stringify(changedFields),
        authId,
        authEmail,
        authCollection,
        isAdmin,
        ip,
        userAgent,
        now
      );
    } catch (err) {
      // Don't let audit log errors crash record operations
      console.error('[AuditLogService] Error logging change:', err);
    }
  }

  /**
   * Retrieves chronological audit history for a single record.
   */
  public getRecordHistory(
    collection: string,
    recordId: string,
    page = 1,
    perPage = 25
  ): AuditListResult {
    return this.getGlobalLogs({
      collection,
      recordId,
      page,
      perPage,
    });
  }

  /**
   * Retrieves global audit logs across all collections with filtering and pagination.
   */
  public getGlobalLogs(options: AuditQueryOptions = {}): AuditListResult {
    const page = Math.max(1, Number(options.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(options.perPage) || 25));
    const offset = (page - 1) * perPage;

    const whereClauses: string[] = [];
    const params: any[] = [];

    if (options.collection) {
      whereClauses.push('collection = ?');
      params.push(options.collection);
    }

    if (options.recordId) {
      whereClauses.push('recordId = ?');
      params.push(options.recordId);
    }

    if (options.action && options.action !== 'all') {
      whereClauses.push('action = ?');
      params.push(options.action.toLowerCase());
    }

    if (options.actorId) {
      whereClauses.push('authId = ?');
      params.push(options.actorId);
    }

    if (options.search && options.search.trim()) {
      const term = `%${options.search.trim()}%`;
      whereClauses.push('(recordId LIKE ? OR authEmail LIKE ? OR changedFields LIKE ? OR diff LIKE ?)');
      params.push(term, term, term, term);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRow = this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM _audit_logs ${whereSql}`,
      params
    );
    const totalItems = countRow?.count || 0;
    const totalPages = Math.ceil(totalItems / perPage);

    const rows = this.db.all<any>(
      `SELECT * FROM _audit_logs ${whereSql} ORDER BY created DESC LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    const items: AuditLogEntry[] = rows.map((r) => ({
      id: r.id,
      collection: r.collection,
      recordId: r.recordId,
      action: r.action,
      diff: this.safeParseJson(r.diff, {}),
      changedFields: this.safeParseJson(r.changedFields, []),
      authId: r.authId || null,
      authEmail: r.authEmail || null,
      authCollection: r.authCollection || null,
      isAdmin: Boolean(r.isAdmin),
      ip: r.ip || null,
      userAgent: r.userAgent || null,
      created: r.created,
    }));

    return {
      items,
      totalItems,
      totalPages,
      page,
      perPage,
    };
  }

  /**
   * Prunes audit logs older than a given number of days.
   */
  public pruneLogs(olderThanDays: number): number {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    const result = this.db.prepare('DELETE FROM _audit_logs WHERE created < ?').run(cutoff);
    return Number(result.changes);
  }

  private safeParseJson<T>(raw: string, fallback: T): T {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
}
