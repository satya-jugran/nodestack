import { describe, it, expect } from 'vitest';
import { RuleBuilder, ParsedRule } from '../src/rules/RuleBuilder';
import { RuleEngine } from '../src/rules/RuleEngine';

describe('RuleBuilder', () => {
  const engine = new RuleEngine();

  describe('parse()', () => {
    it('should parse null or undefined as admin only', () => {
      const parsedNull = RuleBuilder.parse(null);
      expect(parsedNull.mode).toBe('admin');
      expect(parsedNull.raw).toBeNull();
      expect(RuleBuilder.build(parsedNull)).toBeNull();

      const parsedUndefined = RuleBuilder.parse(undefined);
      expect(parsedUndefined.mode).toBe('admin');
      expect(parsedUndefined.raw).toBeNull();
    });

    it('should parse empty string as public access', () => {
      const parsedEmpty = RuleBuilder.parse('');
      expect(parsedEmpty.mode).toBe('public');
      expect(parsedEmpty.raw).toBe('');
      expect(RuleBuilder.build(parsedEmpty)).toBe('');

      const parsedSpaces = RuleBuilder.parse('   ');
      expect(parsedSpaces.mode).toBe('public');
    });

    it('should parse auth preset', () => {
      const parsedAuth = RuleBuilder.parse('@request.auth.id != ""');
      expect(parsedAuth.mode).toBe('auth');
      expect(parsedAuth.clauses).toHaveLength(1);
      expect(parsedAuth.clauses[0]).toEqual({
        field: '@request.auth.id',
        operator: '!=',
        value: '""',
      });
      expect(RuleBuilder.build(parsedAuth)).toBe('@request.auth.id != ""');
    });

    it('should parse single field comparison clause', () => {
      const parsed = RuleBuilder.parse('status = "published"');
      expect(parsed.mode).toBe('custom');
      expect(parsed.clauses).toHaveLength(1);
      expect(parsed.clauses[0].field).toBe('status');
      expect(parsed.clauses[0].operator).toBe('=');
      expect(parsed.clauses[0].value).toBe('"published"');
    });

    it('should parse compound rules with && (AND)', () => {
      const parsed = RuleBuilder.parse('@request.auth.id != "" && status = "published"');
      expect(parsed.mode).toBe('custom');
      expect(parsed.join).toBe('&&');
      expect(parsed.clauses).toHaveLength(2);
      expect(parsed.clauses[0].field).toBe('@request.auth.id');
      expect(parsed.clauses[0].operator).toBe('!=');
      expect(parsed.clauses[1].field).toBe('status');
      expect(parsed.clauses[1].operator).toBe('=');
      expect(parsed.clauses[1].value).toBe('"published"');
    });

    it('should parse compound rules with || (OR)', () => {
      const parsed = RuleBuilder.parse('role = "admin" || role = "editor"');
      expect(parsed.mode).toBe('custom');
      expect(parsed.join).toBe('||');
      expect(parsed.clauses).toHaveLength(2);
      expect(parsed.clauses[0].value).toBe('"admin"');
      expect(parsed.clauses[1].value).toBe('"editor"');
    });

    it('should handle operators like ~, >, <=', () => {
      const parsed = RuleBuilder.parse('email ~ "@acme.com" && age >= 18');
      expect(parsed.clauses).toHaveLength(2);
      expect(parsed.clauses[0].operator).toBe('~');
      expect(parsed.clauses[1].operator).toBe('>=');
      expect(parsed.clauses[1].value).toBe('18');
    });
  });

  describe('build()', () => {
    it('should build null for admin mode', () => {
      expect(RuleBuilder.build({ mode: 'admin', join: '&&', clauses: [], raw: null })).toBeNull();
    });

    it('should build empty string for public mode', () => {
      expect(RuleBuilder.build({ mode: 'public', join: '&&', clauses: [], raw: '' })).toBe('');
    });

    it('should build auth expression for auth mode', () => {
      expect(RuleBuilder.build({ mode: 'auth', join: '&&', clauses: [], raw: '' })).toBe('@request.auth.id != ""');
    });

    it('should build custom expression with formatted values and quotes', () => {
      const parsed: ParsedRule = {
        mode: 'custom',
        join: '&&',
        clauses: [
          { field: '@request.auth.id', operator: '=', value: 'author' },
          { field: 'status', operator: '=', value: 'published' },
        ],
        raw: null,
      };

      const expr = RuleBuilder.build(parsed);
      expect(expr).toBe('@request.auth.id = author && status = "published"');
    });

    it('should build custom expression with || joiner', () => {
      const parsed: ParsedRule = {
        mode: 'custom',
        join: '||',
        clauses: [
          { field: 'status', operator: '=', value: 'draft' },
          { field: 'status', operator: '=', value: 'published' },
        ],
        raw: null,
      };

      const expr = RuleBuilder.build(parsed);
      expect(expr).toBe('status = "draft" || status = "published"');
    });
  });

  describe('Integration with RuleEngine', () => {
    it('should evaluate generated custom rule successfully in RuleEngine', () => {
      const parsed: ParsedRule = {
        mode: 'custom',
        join: '&&',
        clauses: [
          { field: '@request.auth.id', operator: '!=', value: '""' },
          { field: 'status', operator: '=', value: 'published' },
          { field: 'views', operator: '>=', value: '10' },
        ],
        raw: null,
      };

      const ruleStr = RuleBuilder.build(parsed);
      expect(ruleStr).toBe('@request.auth.id != "" && status = "published" && views >= 10');

      // Test against RuleEngine
      const contextMatch = {
        auth: { id: 'usr_abc', isAdmin: false },
        record: { status: 'published', views: 25 },
      };
      const contextNoAuth = {
        record: { status: 'published', views: 25 },
      };
      const contextWrongStatus = {
        auth: { id: 'usr_abc', isAdmin: false },
        record: { status: 'draft', views: 25 },
      };

      expect(engine.evaluate(ruleStr, contextMatch)).toBe(true);
      expect(engine.evaluate(ruleStr, contextNoAuth)).toBe(false);
      expect(engine.evaluate(ruleStr, contextWrongStatus)).toBe(false);
    });

    it('should evaluate owner match rule successfully', () => {
      const parsed: ParsedRule = {
        mode: 'custom',
        join: '&&',
        clauses: [
          { field: '@request.auth.id', operator: '=', value: 'user_id' },
        ],
        raw: null,
      };

      const ruleStr = RuleBuilder.build(parsed);
      expect(ruleStr).toBe('@request.auth.id = user_id');

      expect(engine.evaluate(ruleStr, {
        auth: { id: 'usr_999', isAdmin: false },
        record: { user_id: 'usr_999' },
      })).toBe(true);

      expect(engine.evaluate(ruleStr, {
        auth: { id: 'usr_888', isAdmin: false },
        record: { user_id: 'usr_999' },
      })).toBe(false);
    });
  });

  describe('validate()', () => {
    it('should return valid for well-formed rules', () => {
      expect(RuleBuilder.validate(null).valid).toBe(true);
      expect(RuleBuilder.validate('').valid).toBe(true);
      expect(RuleBuilder.validate('@request.auth.id != "" && (views > 10 || is_public = true)').valid).toBe(true);
    });

    it('should return invalid for unclosed parentheses', () => {
      const res = RuleBuilder.validate('@request.auth.id != "" && (views > 10');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Unclosed parenthesis');
    });

    it('should return invalid for unclosed quotes', () => {
      const res = RuleBuilder.validate('status = "published');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Unclosed quote');
    });
  });

  describe('NodeStack Collection & Rule Enforcement', () => {
    it('should configure and enforce rules built with RuleBuilder in NodeStack', async () => {
      const { NodeStack } = await import('../src/NodeStack');
      const testDir = `tmp_test_rules_${Date.now()}`;
      const app = new NodeStack({
        dataDir: testDir,
        port: 0,
      });

      try {
        // Create an articles collection with custom rules built via RuleBuilder
        const listRule = RuleBuilder.build({
          mode: 'public',
          join: '&&',
          clauses: [],
          raw: '',
        }); // public

        const createRule = RuleBuilder.build({
          mode: 'auth',
          join: '&&',
          clauses: [{ field: '@request.auth.id', operator: '!=', value: '""' }],
          raw: '@request.auth.id != ""',
        }); // auth only

        const deleteRule = RuleBuilder.build({
          mode: 'admin',
          join: '&&',
          clauses: [],
          raw: null,
        }); // admin only

        const col = app.schema.createCollection({
          name: 'articles',
          type: 'base',
          schema: [
            { id: 'f_title', name: 'title', type: 'text' },
            { id: 'f_author', name: 'author', type: 'text' },
          ],
          listRule,
          viewRule: listRule,
          createRule,
          updateRule: createRule,
          deleteRule,
        });

        expect(col.listRule).toBe('');
        expect(col.createRule).toBe('@request.auth.id != ""');
        expect(col.deleteRule).toBeNull();

        // Test 1: Anonymous user can list
        const list = await app.records.getList('articles');
        expect(list.items).toEqual([]);

        // Test 2: Anonymous user cannot create (createRule is auth only)
        await expect(
          app.records.create('articles', { title: 'First Article' }, undefined)
        ).rejects.toThrow(/not allowed to create/);

        // Test 3: Authenticated user can create
        const authUser = { id: 'usr_writer_1', email: 'writer@test.com' };
        const created = await app.records.create(
          'articles',
          { title: 'First Article', author: 'usr_writer_1' },
          authUser
        );
        expect(created.id).toBeDefined();
        expect(created.title).toBe('First Article');

        // Test 4: Authenticated non-admin user cannot delete (deleteRule is admin only)
        await expect(
          app.records.delete('articles', created.id, authUser)
        ).rejects.toThrow(/not allowed to delete/);

        // Test 5: Admin can delete
        const adminUser = { id: 'adm_1', email: 'admin@test.com', isAdmin: true };
        await app.records.delete('articles', created.id, adminUser);
        await expect(
          app.records.getOne('articles', created.id, adminUser)
        ).rejects.toThrow();
      } finally {
        await app.stop();
        const fs = await import('fs');
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true, force: true });
        }
      }
    });
  });
});

