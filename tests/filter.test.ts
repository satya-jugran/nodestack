import { describe, it, expect } from 'vitest';
import { QueryFilterParser } from '../src/records/QueryFilterParser';

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
});
