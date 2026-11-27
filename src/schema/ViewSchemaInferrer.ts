import * as crypto from 'crypto';
import { DatabaseService } from '../database/DatabaseService';
import { ColumnMetadata } from '../database/dialects/ISqlDialect';
import { AppError } from '../core/errors/AppError';
import { CollectionModel } from './models/Collection';
import { FieldType, SchemaField } from './models/Field';
import { inferFieldType } from './SchemaInferenceService';

interface ProjectedColumnHint {
  outputName: string;
  sourceTableOrAlias?: string;
  sourceColumn?: string;
  rawExpr: string;
  isWildcard?: boolean;
}

export interface ViewInferenceParams {
  db: DatabaseService | { dialect: any; all: <T = any>(sql: string, ...params: any[]) => Promise<T[]> };
  viewName: string;
  selectSql: string;
  existingCollections: CollectionModel[];
  overrides?: SchemaField[];
}

export interface ViewSchemaDiff {
  added: Array<{ name: string; type: FieldType }>;
  removed: Array<{ name: string; type: FieldType }>;
  typeChanged: Array<{ name: string; from: FieldType; to: FieldType }>;
  hasBreakingChanges: boolean;
}

export class ViewSchemaInferrer {
  /**
   * Infers SchemaField[] for a SQL view across SQLite, PostgreSQL, and MSSQL.
   * Combines source-collection projection mapping, dialect catalog/statement metadata,
   * and SQLite expression/sample-row fallbacks.
   */
  public static infer(params: ViewInferenceParams): SchemaField[] | Promise<SchemaField[]> {
    const { db, viewName, selectSql, existingCollections, overrides } = params;
    const dialect = db.dialect;

    const rootDriver = typeof (db as any).getRootDriver === 'function'
      ? (db as any).getRootDriver()
      : (db as any).getDriver?.();

    const isSyncSqlite =
      dialect.name === 'sqlite' &&
      rootDriver &&
      typeof (rootDriver as any).prepareSync === 'function';

    const colLookup = new Map<string, CollectionModel>();
    for (const c of existingCollections) {
      colLookup.set(c.name.toLowerCase(), c);
    }

    const aliasMap = this.extractTableAliases(selectSql);
    const projections = this.parseTopLevelSelectProjections(selectSql);

    if (isSyncSqlite) {
      const metaQuery = dialect.getViewColumnsSql(viewName);
      const rawMetaRows = (rootDriver as any).prepareSync(metaQuery.sql).all() || [];
      const columns: ColumnMetadata[] = rawMetaRows.map(metaQuery.mapRow);

      let stmtCols: Array<{ name: string; type: string | null }> = [];
      if (typeof (rootDriver as any).getQueryColumnMetadata === 'function') {
        stmtCols = (rootDriver as any).getQueryColumnMetadata(
          `SELECT * FROM ${dialect.quoteIdentifier(viewName)}`
        );
      }

      let sampleRow: Record<string, any> | undefined;
      try {
        sampleRow = (rootDriver as any)
          .prepareSync(`SELECT * FROM ${dialect.quoteIdentifier(viewName)} LIMIT 1`)
          .get();
      } catch {
        sampleRow = undefined;
      }

      return this.buildFieldsFromMetadata({
        columns,
        stmtCols,
        sampleRow,
        projections,
        aliasMap,
        colLookup,
        dialectName: dialect.name,
        overrides,
      });
    }

    return (async () => {
      const metaQuery = dialect.getViewColumnsSql(viewName);
      const rawMetaRows = await db.all<any>(metaQuery.sql, viewName);
      const columns: ColumnMetadata[] = (rawMetaRows || []).map(metaQuery.mapRow);

      return this.buildFieldsFromMetadata({
        columns,
        stmtCols: [],
        sampleRow: undefined,
        projections,
        aliasMap,
        colLookup,
        dialectName: dialect.name,
        overrides,
      });
    })();
  }

  private static buildFieldsFromMetadata(ctx: {
    columns: ColumnMetadata[];
    stmtCols: Array<{ name: string; type: string | null }>;
    sampleRow?: Record<string, any>;
    projections: ProjectedColumnHint[];
    aliasMap: Map<string, string>;
    colLookup: Map<string, CollectionModel>;
    dialectName: string;
    overrides?: SchemaField[];
  }): SchemaField[] {
    const { columns, stmtCols, sampleRow, projections, aliasMap, colLookup, dialectName, overrides } = ctx;

    const stmtTypeByCol = new Map<string, string>();
    for (const sc of stmtCols) {
      if (sc.name && sc.type) {
        stmtTypeByCol.set(sc.name.toLowerCase(), sc.type);
      }
    }

    const projectionByName = new Map<string, ProjectedColumnHint>();
    for (const p of projections) {
      if (!p.isWildcard && p.outputName) {
        projectionByName.set(p.outputName.toLowerCase(), p);
      }
    }

    const overrideMap = new Map<string, SchemaField>();
    if (Array.isArray(overrides)) {
      const colNames = new Set(columns.map((c) => c.name.toLowerCase()));
      for (const ov of overrides) {
        const clean = ov.name?.trim().toLowerCase();
        if (!clean) continue;
        if (colNames.size > 0 && !colNames.has(clean)) {
          throw new AppError(`View override field '${ov.name}' is not returned by viewQuery`, 400);
        }
        overrideMap.set(clean, ov);
      }
    }

    const fields: SchemaField[] = [];
    const authVisibilityColByCollection = new Map<string, string>();
    const authIdColByCollection = new Map<string, string>();

    for (const col of columns) {
      const lowerName = col.name.toLowerCase();
      const proj = projectionByName.get(lowerName);
      const resolved = this.resolveSourceField(col.name, proj, aliasMap, colLookup);
      const sourceField = resolved?.field;
      const sourceCol = resolved?.sourceCol;

      if (sourceCol?.type === 'auth' && sourceField) {
        const srcName = (proj?.sourceColumn || col.name).toLowerCase();
        if (srcName === 'emailvisibility' && !authVisibilityColByCollection.has(sourceCol.name)) {
          authVisibilityColByCollection.set(sourceCol.name, col.name);
        }
        if (srcName === 'id' && !authIdColByCollection.has(sourceCol.name)) {
          authIdColByCollection.set(sourceCol.name, col.name);
        }
      }

      let fieldType: FieldType;
      let fieldOptions: Record<string, any> | undefined;

      if (sourceField) {
        fieldType = sourceField.type;
        fieldOptions = sourceField.options ? { ...sourceField.options } : undefined;
        if ((sourceField as any).hidden || (sourceField as any).private) {
          fieldOptions = { ...(fieldOptions || {}), hidden: true };
        }
      } else {
        const declaredType = col.type || stmtTypeByCol.get(lowerName) || '';
        const mappedFromSql = this.mapSqlTypeToFieldType(declaredType, dialectName);
        if (mappedFromSql) {
          fieldType = mappedFromSql;
        } else if (proj) {
          fieldType = this.inferFromExpressionOrSample(proj.rawExpr, sampleRow?.[col.name]);
        } else if (sampleRow && sampleRow[col.name] !== undefined && sampleRow[col.name] !== null) {
          fieldType = inferFieldType([sampleRow[col.name]]);
        } else {
          fieldType = 'text';
        }

        // Detect expressions referencing an auth collection's email (e.g. LOWER(u.email))
        const authEmailCol = proj ? this.findReferencedAuthEmailCollection(proj.rawExpr, aliasMap, colLookup) : undefined;
        if (authEmailCol) {
          fieldOptions = { ...(fieldOptions || {}), authEmail: true, authCollection: authEmailCol.name };
        }
      }

      const ov = overrideMap.get(lowerName);
      if (ov) {
        if (ov.type) fieldType = ov.type;
        if (ov.options) {
          const preservedAuth = fieldOptions?.authEmail
            ? { authEmail: true, authCollection: fieldOptions.authCollection }
            : {};
          fieldOptions = { ...(fieldOptions || {}), ...ov.options, ...preservedAuth };
        }
      }

      const fieldId =
        ov?.id ||
        `f_${crypto.createHash('sha256').update(lowerName).digest('hex').substring(0, 8)}`;

      fields.push({
        id: fieldId,
        name: col.name,
        type: fieldType,
        required: Boolean(col.notNull),
        ...(fieldOptions ? { options: fieldOptions } : {}),
      });
    }

    // Link authEmail fields to projected emailVisibility / id columns from the same auth collection
    for (const f of fields) {
      if (f.options?.authEmail && f.options.authCollection) {
        const visCol = authVisibilityColByCollection.get(f.options.authCollection);
        const idCol = authIdColByCollection.get(f.options.authCollection);
        if (visCol) f.options.authEmailVisibilityField = visCol;
        if (idCol) f.options.authIdField = idCol;
      }
    }

    return fields;
  }

  private static resolveSourceField(
    outputColName: string,
    proj: ProjectedColumnHint | undefined,
    aliasMap: Map<string, string>,
    colLookup: Map<string, CollectionModel>
  ): { field: SchemaField; sourceCol: CollectionModel } | undefined {
    const candidateColName = (proj?.sourceColumn || outputColName).toLowerCase();

    const lookupInCollection = (col: CollectionModel): SchemaField | undefined => {
      if (candidateColName === 'id') {
        return { id: 'id', name: 'id', type: 'text', required: true };
      }
      if (candidateColName === 'created' || candidateColName === 'updated') {
        return { id: candidateColName, name: candidateColName, type: 'date', required: true };
      }
      if (col.type === 'auth') {
        if (candidateColName === 'email') {
          return {
            id: 'email',
            name: 'email',
            type: 'email',
            required: true,
            options: { authEmail: true, authCollection: col.name },
          };
        }
        if (candidateColName === 'emailvisibility' || candidateColName === 'verified') {
          return { id: candidateColName, name: candidateColName, type: 'bool', required: true };
        }
      }
      return col.schema.find((f) => f.name.toLowerCase() === candidateColName);
    };

    if (proj?.sourceTableOrAlias) {
      const resolvedTable = aliasMap.get(proj.sourceTableOrAlias.toLowerCase()) || proj.sourceTableOrAlias.toLowerCase();
      const sourceCol = colLookup.get(resolvedTable);
      if (sourceCol) {
        const field = lookupInCollection(sourceCol);
        return field ? { field, sourceCol } : undefined;
      }
      return undefined;
    }

    // Unqualified column or wildcard: search referenced collections if unambiguous
    if (aliasMap.size > 0) {
      const matches: Array<{ field: SchemaField; sourceCol: CollectionModel }> = [];
      const seenTables = new Set(aliasMap.values());
      for (const tableName of seenTables) {
        const sourceCol = colLookup.get(tableName);
        if (!sourceCol) continue;
        const found = lookupInCollection(sourceCol);
        if (found) matches.push({ field: found, sourceCol });
      }
      if (matches.length === 1) {
        return matches[0];
      }
    }

    return undefined;
  }

  private static findReferencedAuthEmailCollection(
    rawExpr: string,
    aliasMap: Map<string, string>,
    colLookup: Map<string, CollectionModel>
  ): CollectionModel | undefined {
    if (!rawExpr) return undefined;
    const authCols: CollectionModel[] = [];
    for (const tableName of new Set(aliasMap.values())) {
      const c = colLookup.get(tableName);
      if (c?.type === 'auth') authCols.push(c);
    }
    if (authCols.length === 0) return undefined;

    for (const [aliasOrTable, tableName] of aliasMap.entries()) {
      const c = colLookup.get(tableName);
      if (c?.type !== 'auth') continue;
      const qualifiedRe = new RegExp(`\\b${aliasOrTable}\\s*\\.\\s*email\\b`, 'i');
      if (qualifiedRe.test(rawExpr)) {
        return c;
      }
    }

    if (/\bemail\b/i.test(rawExpr) && authCols.length === 1) {
      return authCols[0];
    }
    return undefined;
  }

  public static mapSqlTypeToFieldType(sqlType: string, dialectName: string): FieldType | null {
    const t = (sqlType || '').trim().toLowerCase();
    if (!t) return null;

    if (t.includes('bool') || t === 'bit') {
      return 'bool';
    }
    if (t.includes('json')) {
      return 'json';
    }
    if (t.includes('timestamp') || t.includes('datetime') || t === 'date' || t === 'smalldatetime') {
      return 'date';
    }
    if (
      t.includes('int') ||
      t.includes('numeric') ||
      t.includes('decimal') ||
      t.includes('float') ||
      t.includes('double') ||
      t.includes('real') ||
      t.includes('money') ||
      t === 'number'
    ) {
      return 'number';
    }
    if (
      dialectName !== 'sqlite' &&
      (t.includes('char') || t.includes('text') || t.includes('clob') || t === 'uniqueidentifier' || t === 'uuid')
    ) {
      return 'text';
    }
    if (dialectName === 'sqlite' && (t === 'text' || t.includes('char') || t.includes('clob'))) {
      return 'text';
    }

    return null;
  }

  private static inferFromExpressionOrSample(rawExpr: string, sampleVal: any): FieldType {
    const expr = (rawExpr || '').trim();
    if (/^(COUNT|SUM|AVG|TOTAL|LENGTH|CHAR_LENGTH|INSTR|ROUND|ABS|CEIL|FLOOR|CAST\s*\([\s\S]+AS\s+(?:INT|INTEGER|REAL|FLOAT|NUMERIC|DECIMAL))\s*\(/i.test(expr)) {
      return 'number';
    }
    if (/^EXISTS\s*\(/i.test(expr) || /\bCASE\s+WHEN\b[\s\S]*\bTHEN\s+(?:1|0|TRUE|FALSE)\b/i.test(expr)) {
      return 'bool';
    }
    if (/^(?:strftime|datetime|date)\s*\(/i.test(expr)) {
      return 'date';
    }
    if (/^(?:json_object|json_array|json_group_array|json_group_object)\s*\(/i.test(expr)) {
      return 'json';
    }
    if (sampleVal !== undefined && sampleVal !== null && sampleVal !== '') {
      return inferFieldType([sampleVal]);
    }
    // Check basic arithmetic expression outside function calls (e.g. a * b, price + tax)
    if (/[+\-*/]/.test(expr) && !/\|\|/.test(expr) && !/'/.test(expr)) {
      return 'number';
    }
    return 'text';
  }

  private static extractTableAliases(selectSql: string): Map<string, string> {
    const map = new Map<string, string>();
    const regex = /\b(?:FROM|JOIN)\s+(?:"([^"]+)"|\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*))(?:\s+(?:AS\s+)?(?:"([^"]+)"|\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*)))?/gi;
    const sqlKeywords = new Set(['WHERE', 'ON', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'EXCEPT', 'INTERSECT', 'SET']);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(selectSql)) !== null) {
      const tableName = (m[1] || m[2] || m[3] || '').toLowerCase();
      const aliasRaw = (m[4] || m[5] || m[6] || '').toLowerCase();
      if (!tableName) continue;
      map.set(tableName, tableName);
      if (aliasRaw && !sqlKeywords.has(aliasRaw.toUpperCase())) {
        map.set(aliasRaw, tableName);
      }
    }
    return map;
  }

  private static parseTopLevelSelectProjections(selectSql: string): ProjectedColumnHint[] {
    const selectClause = this.extractOuterSelectClause(selectSql);
    if (!selectClause) return [];

    const items = this.splitTopLevelCommas(selectClause);
    const hints: ProjectedColumnHint[] = [];

    for (const rawItem of items) {
      const item = rawItem.trim();
      if (!item) continue;
      if (item === '*' || /^[a-zA-Z_][a-zA-Z0-9_]*\.\*$/.test(item)) {
        hints.push({ outputName: '*', rawExpr: item, isWildcard: true });
        continue;
      }

      // Check for explicit AS alias at the end
      const asMatch = item.match(/^([\s\S]+?)\s+AS\s+(?:"([^"]+)"|\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*))$/i);
      let expr = item;
      let outputName = '';

      if (asMatch) {
        expr = asMatch[1].trim();
        outputName = (asMatch[2] || asMatch[3] || asMatch[4] || '').trim();
      } else {
        // Check implicit space alias: e.g. "COUNT(*) total" or "u.email user_email"
        const implicitMatch = item.match(/^([\s\S]+?\)|[a-zA-Z_][a-zA-Z0-9_.]*)\s+(?:"([^"]+)"|\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*))$/);
        if (implicitMatch) {
          expr = implicitMatch[1].trim();
          outputName = (implicitMatch[2] || implicitMatch[3] || implicitMatch[4] || '').trim();
        }
      }

      const colRefMatch = expr.match(/^(?:(?:"([^"]+)"|\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*))\.)?(?:"([^"]+)"|\[([^\]]+)\]|([a-zA-Z_][a-zA-Z0-9_]*))$/);
      if (colRefMatch) {
        const sourceTableOrAlias = (colRefMatch[1] || colRefMatch[2] || colRefMatch[3] || '').trim() || undefined;
        const sourceColumn = (colRefMatch[4] || colRefMatch[5] || colRefMatch[6] || '').trim();
        hints.push({
          outputName: outputName || sourceColumn,
          sourceTableOrAlias,
          sourceColumn,
          rawExpr: expr,
        });
      } else if (outputName) {
        hints.push({
          outputName,
          rawExpr: expr,
        });
      }
    }

    return hints;
  }

  private static extractOuterSelectClause(sql: string): string {
    const trimmed = sql.trim();
    let startIdx = 0;

    // Skip leading CTEs: WITH ... SELECT ...
    if (/^WITH\b/i.test(trimmed)) {
      let depth = 0;
      let inSingle = false;
      for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (ch === "'") inSingle = !inSingle;
        if (inSingle) continue;
        if (ch === '(') depth++;
        else if (ch === ')' && depth > 0) depth--;
        else if (depth === 0 && /^SELECT\b/i.test(trimmed.slice(i))) {
          startIdx = i;
          break;
        }
      }
    }

    const afterSelect = trimmed.slice(startIdx).replace(/^SELECT\s+(?:DISTINCT\s+|ALL\s+)?(?:TOP\s+\d+\s+)?/i, '');
    let depth = 0;
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < afterSelect.length; i++) {
      const ch = afterSelect[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      if (inSingle || inDouble) continue;

      if (ch === '(') depth++;
      else if (ch === ')' && depth > 0) depth--;
      else if (depth === 0 && /^\bFROM\b/i.test(afterSelect.slice(i))) {
        const prev = i > 0 ? afterSelect[i - 1] : ' ';
        if (/\s/.test(prev)) {
          return afterSelect.slice(0, i).trim();
        }
      }
    }

    return afterSelect.trim();
  }

  private static splitTopLevelCommas(clause: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < clause.length; i++) {
      const ch = clause[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;

      if (!inSingle && !inDouble) {
        if (ch === '(') depth++;
        else if (ch === ')' && depth > 0) depth--;
        else if (ch === ',' && depth === 0) {
          parts.push(current);
          current = '';
          continue;
        }
      }
      current += ch;
    }
    if (current.trim()) parts.push(current);
    return parts;
  }

  /**
   * Computes column additions, removals, and type changes between two view schemas.
   */
  public static diffSchemas(oldSchema: SchemaField[], newSchema: SchemaField[]): ViewSchemaDiff {
    const oldMap = new Map<string, SchemaField>();
    for (const f of oldSchema || []) {
      oldMap.set(f.name.toLowerCase(), f);
    }
    const newMap = new Map<string, SchemaField>();
    for (const f of newSchema || []) {
      newMap.set(f.name.toLowerCase(), f);
    }

    const added: Array<{ name: string; type: FieldType }> = [];
    const removed: Array<{ name: string; type: FieldType }> = [];
    const typeChanged: Array<{ name: string; from: FieldType; to: FieldType }> = [];

    for (const f of newSchema || []) {
      const prev = oldMap.get(f.name.toLowerCase());
      if (!prev) {
        added.push({ name: f.name, type: f.type });
      } else if (prev.type !== f.type) {
        typeChanged.push({ name: f.name, from: prev.type, to: f.type });
      }
    }

    for (const f of oldSchema || []) {
      if (!newMap.has(f.name.toLowerCase())) {
        removed.push({ name: f.name, type: f.type });
      }
    }

    return {
      added,
      removed,
      typeChanged,
      hasBreakingChanges: removed.length > 0 || typeChanged.length > 0,
    };
  }

  /**
   * Throws an error if a target-dialect view schema has drifted from the expected schema.
   */
  public static assertNoSchemaDrift(
    expectedSchema: SchemaField[],
    actualSchema: SchemaField[],
    viewName: string
  ): void {
    const diff = this.diffSchemas(expectedSchema, actualSchema);
    if (diff.added.length === 0 && diff.removed.length === 0 && diff.typeChanged.length === 0) {
      return;
    }
    const parts: string[] = [];
    if (diff.removed.length > 0) {
      parts.push(`missing columns: ${diff.removed.map((c) => c.name).join(', ')}`);
    }
    if (diff.added.length > 0) {
      parts.push(`unexpected columns: ${diff.added.map((c) => c.name).join(', ')}`);
    }
    if (diff.typeChanged.length > 0) {
      parts.push(`type mismatches: ${diff.typeChanged.map((c) => `${c.name} (${c.from} -> ${c.to})`).join(', ')}`);
    }
    throw new AppError(`Schema drift detected for view '${viewName}': ${parts.join('; ')}`, 400);
  }
}
