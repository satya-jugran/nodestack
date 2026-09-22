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
    expect(clause).toBe('WHERE "title" LIKE ?');
    expect(params).toEqual(['%NodeStack%']);
  });
});
