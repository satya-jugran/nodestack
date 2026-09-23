import { describe, it, expect } from 'vitest';
import { RuleEngine } from '../src/rules/RuleEngine';

describe('RuleEngine', () => {
  const engine = new RuleEngine();

  it('should allow everything for admin', () => {
    expect(engine.evaluate(null, { auth: { id: 'adm_1', isAdmin: true } })).toBe(true);
    expect(engine.evaluate('false', { auth: { id: 'adm_1', isAdmin: true } })).toBe(true);
  });

  it('should deny non-admin if rule is null', () => {
    expect(engine.evaluate(null, { auth: { id: 'usr_1', isAdmin: false } })).toBe(false);
    expect(engine.evaluate(null, {})).toBe(false);
  });

  it('should allow anyone if rule is empty string', () => {
    expect(engine.evaluate('', {})).toBe(true);
    expect(engine.evaluate('   ', {})).toBe(true);
  });

  it('should evaluate comparisons with record fields', () => {
    const ctx = {
      record: { status: 'published', views: 50 },
    };

    expect(engine.evaluate('status = "published"', ctx)).toBe(true);
    expect(engine.evaluate('status = "draft"', ctx)).toBe(false);
    expect(engine.evaluate('views > 10', ctx)).toBe(true);
    expect(engine.evaluate('views <= 50', ctx)).toBe(true);
    expect(engine.evaluate('views > 100', ctx)).toBe(false);
  });

  it('should evaluate auth context expressions', () => {
    const ctx = {
      auth: { id: 'usr_123', role: 'editor', isAdmin: false },
      record: { authorId: 'usr_123' },
    };

    expect(engine.evaluate('@request.auth.id != ""', ctx)).toBe(true);
    expect(engine.evaluate('@request.auth.id = authorId', ctx)).toBe(true);
    expect(engine.evaluate('@request.auth.role = "editor"', ctx)).toBe(true);
    expect(engine.evaluate('@request.auth.role = "admin"', ctx)).toBe(false);
  });

  it('should evaluate compound boolean expressions with AND and OR', () => {
    const ctx = {
      auth: { id: 'usr_123', isAdmin: false },
      record: { status: 'published', isArchived: false },
    };

    expect(engine.evaluate('status = "published" && @request.auth.id != ""', ctx)).toBe(true);
    expect(engine.evaluate('status = "draft" || status = "published"', ctx)).toBe(true);
    expect(engine.evaluate('status = "draft" && @request.auth.id != ""', ctx)).toBe(false);
  });

  it('should evaluate contains (~) operator for strings', () => {
    const ctx = {
      auth: { email: 'alice@company.org', isAdmin: false },
      record: { title: 'NodeStack Architecture Guide' },
    };

    expect(engine.evaluate('@request.auth.email ~ "@company.org"', ctx)).toBe(true);
    expect(engine.evaluate('@request.auth.email ~ "@other.com"', ctx)).toBe(false);
    expect(engine.evaluate('title ~ "architecture"', ctx)).toBe(true);
  });
});

