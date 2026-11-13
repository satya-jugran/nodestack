import { describe, it, expect } from 'vitest';
import { QueryFilterParser } from '../src/records/QueryFilterParser';
import { PostgresDialect } from '../src/database/dialects/PostgresDialect';
import { MssqlDialect } from '../src/database/dialects/MssqlDialect';
import { SqliteDialect } from '../src/database/dialects/SqliteDialect';

describe('QueryFilterParser', () => {
  const allowed = new Set(['title', 'status', 'views', 'created', 'author']);

  it('should parse sort expressions correctly', () => {
    expect(QueryFilterParser.parseSort('-created,title', allowed)).toBe('ORDER BY "created" DESC, "title" ASC');
    expect(QueryFilterParser.parseSort('+views', allowed)).toBe('ORDER BY "views" ASC');
    expect(QueryFilterParser.parseSort(undefined, allowed)).toBe('ORDER BY created DESC');
  });

  it('should sanitize sort fields', () => {
    // Malicious injection attempt in sort
    const result = QueryFilterParser.parseSort('title; DROP TABLE users;--', allowed);
    // Invalid characters are rejected by regex
    expect(result).toBe('ORDER BY created DESC');
  });

  it('should ignore unvalidated sort field names not in allowedFields', () => {
    // Single unvalidated field falls back to default
    expect(QueryFilterParser.parseSort('nonexistent_col', allowed)).toBe('ORDER BY created DESC');
    // Mixed valid and unvalidated fields only includes allowed fields
    expect(QueryFilterParser.parseSort('-nonexistent_col,title', allowed)).toBe('ORDER BY "title" ASC');
    expect(QueryFilterParser.parseSort('-created,+unknown_col,-views', allowed)).toBe('ORDER BY "created" DESC, "views" DESC');
  });

  it('should apply dialect-specific identifier quoting for sort clauses', () => {
    const pg = new PostgresDialect();
    const mssql = new MssqlDialect();
    expect(QueryFilterParser.parseSort('-created,title', allowed, undefined, pg)).toBe('ORDER BY "created" DESC, "title" ASC');
    expect(QueryFilterParser.parseSort('-created,title', allowed, undefined, mssql)).toBe('ORDER BY [created] DESC, [title] ASC');
    expect(QueryFilterParser.parseSort('-created,title', allowed, 't', mssql)).toBe('ORDER BY [t].[created] DESC, [t].[title] ASC');
  });

  it('should parse simple filter expressions', () => {
    const { clause, params } = QueryFilterParser.parseFilter("status = 'active'", allowed);
    expect(clause).toBe('WHERE "status" = ?');
    expect(params).toEqual(['active']);
  });

  it('should parse compound filters with logical operators', () => {
    const { clause, params } = QueryFilterParser.parseFilter(
      "status = 'active' && views >= 100",
      allowed
    );
    expect(clause).toBe('WHERE ("status" = ? AND "views" >= ?)');
    expect(params).toEqual(['active', 100]);
  });

  it('should parse like/contains filters (~)', () => {
    const { clause, params } = QueryFilterParser.parseFilter("title ~ 'NodeStack'", allowed);
    expect(clause).toBe("WHERE \"title\" LIKE ? ESCAPE '\\'");
    expect(params).toEqual(['%NodeStack%']);
  });

  it('should escape wildcards in like/contains filters (~ and !~)', () => {
    const { clause: c1, params: p1 } = QueryFilterParser.parseFilter("title ~ '50% off_now\\\\deal'", allowed);
    expect(c1).toBe("WHERE \"title\" LIKE ? ESCAPE '\\'");
    expect(p1).toEqual(['%50\\% off\\_now\\\\deal%']);

    const { clause: c2, params: p2 } = QueryFilterParser.parseFilter("title !~ '100%_pure'", allowed);
    expect(c2).toBe("WHERE \"title\" NOT LIKE ? ESCAPE '\\'");
    expect(p2).toEqual(['%100\\%\\_pure%']);
  });

  it('should emit native boolean params for true and false literals', () => {
    const boolAllowed = new Set(['active']);
    const t = QueryFilterParser.parseFilter('active = true', boolAllowed, undefined, new PostgresDialect());
    expect(t.clause).toBe('WHERE "active" = ?');
    expect(t.params).toEqual([true]);

    const f = QueryFilterParser.parseFilter('active = false', boolAllowed, undefined, new PostgresDialect());
    expect(f.clause).toBe('WHERE "active" = ?');
    expect(f.params).toEqual([false]);
  });

  describe('nested JSON field filtering across dialects', () => {
    const jsonAllowed = new Set(['title', 'metadata']);

    it('should format nested JSON filter correctly in SQLite without double quoting', () => {
      const dialect = new SqliteDialect();

      const { clause: c1, params: p1 } = QueryFilterParser.parseFilter("metadata.author.name = 'John'", jsonAllowed, undefined, dialect);
      expect(c1).toBe("WHERE json_extract(\"metadata\", '$.author.name') = ?");
      expect(p1).toEqual(['John']);

      const { clause: c2, params: p2 } = QueryFilterParser.parseFilter("metadata.age >= 30", jsonAllowed, 't', dialect);
      expect(c2).toBe("WHERE json_extract(\"t\".\"metadata\", '$.age') >= ?");
      expect(p2).toEqual([30]);
    });

    it('should format nested JSON filter correctly in PostgreSQL without double quoting', () => {
      const dialect = new PostgresDialect();

      const { clause: c1, params: p1 } = QueryFilterParser.parseFilter("metadata.author.name = 'John'", jsonAllowed, undefined, dialect);
      expect(c1).toBe("WHERE (\"metadata\"::jsonb #>> ARRAY['author','name']) = ?");
      expect(p1).toEqual(['John']);

      const { clause: c2, params: p2 } = QueryFilterParser.parseFilter("metadata.age >= 30", jsonAllowed, 't', dialect);
      expect(c2).toBe("WHERE (\"t\".\"metadata\"::jsonb #>> ARRAY['age']) >= ?");
      expect(p2).toEqual([30]);
    });

    it('should format nested JSON filter correctly in MSSQL without double quoting', () => {
      const dialect = new MssqlDialect();

      const { clause: c1, params: p1 } = QueryFilterParser.parseFilter("metadata.author.name = 'John'", jsonAllowed, undefined, dialect);
      expect(c1).toBe("WHERE JSON_VALUE([metadata], '$.author.name') = ?");
      expect(p1).toEqual(['John']);

      const { clause: c2, params: p2 } = QueryFilterParser.parseFilter("metadata.age >= 30", jsonAllowed, 't', dialect);
      expect(c2).toBe("WHERE JSON_VALUE([t].[metadata], '$.age') >= ?");
      expect(p2).toEqual([30]);
    });
  });
});
