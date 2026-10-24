import { describe, it, expect, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { RuleEngine } from '../src/rules/RuleEngine';
import { NodeStack } from '../src/NodeStack';
import { ForbiddenError } from '../src/core/errors/AppError';

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

  describe('buildListFilter() - Row-Level Rule Scoping', () => {
    const fields = new Set(['id', 'user', 'customerEmail', 'status', 'created', 'updated']);

    it('should allow admin without applying any row filters', () => {
      const res = engine.buildListFilter('@request.auth.id != "" && user = @request.auth.id', {
        auth: { id: 'adm_1', isAdmin: true },
      }, fields);
      expect(res.allowed).toBe(true);
      expect(res.filter).toBeUndefined();
    });

    it('should deny non-admin if rule is null', () => {
      const res = engine.buildListFilter(null, { auth: { id: 'usr_1' } }, fields);
      expect(res.allowed).toBe(false);
    });

    it('should allow public access with no filter when rule is empty string', () => {
      const res = engine.buildListFilter('', {}, fields);
      expect(res.allowed).toBe(true);
      expect(res.filter).toBeUndefined();
    });

    it('should evaluate pure request-level auth rule without row filters', () => {
      const resAuth = engine.buildListFilter('@request.auth.id != ""', {
        auth: { id: 'usr_123' },
      }, fields);
      expect(resAuth.allowed).toBe(true);
      expect(resAuth.filter).toBeUndefined();

      const resGuest = engine.buildListFilter('@request.auth.id != ""', {}, fields);
      expect(resGuest.allowed).toBe(false);
    });

    it('should extract owner-scoped row filter for authenticated user and deny unauthenticated guest', () => {
      const rule = '@request.auth.id != "" && user = @request.auth.id';

      // Authenticated customer
      const resAuth = engine.buildListFilter(rule, {
        auth: { id: 'usr_cust_99' },
      }, fields);
      expect(resAuth.allowed).toBe(true);
      expect(resAuth.filter).toBe("user = 'usr_cust_99'");

      // Unauthenticated guest must be blocked at request gate
      const resGuest = engine.buildListFilter(rule, {}, fields);
      expect(resGuest.allowed).toBe(false);
    });

    it('should support email substitution for @request.auth.email', () => {
      const res = engine.buildListFilter('customerEmail = @request.auth.email', {
        auth: { id: 'usr_1', email: 'customer@brand.com' },
      }, fields);
      expect(res.allowed).toBe(true);
      expect(res.filter).toBe("customerEmail = 'customer@brand.com'");
    });

    it('should handle compound OR rules with record fields', () => {
      const res = engine.buildListFilter('user = @request.auth.id || status = "published"', {
        auth: { id: 'usr_123' },
      }, fields);
      expect(res.allowed).toBe(true);
      expect(res.filter).toBe('(user = \'usr_123\' || status = "published")');
    });

    it('should bypass row filter if an unconditional OR branch passes for caller', () => {
      const rule = '@request.auth.role = "manager" || user = @request.auth.id';

      // Manager bypasses row filter
      const resManager = engine.buildListFilter(rule, {
        auth: { id: 'usr_m', role: 'manager' },
      }, fields);
      expect(resManager.allowed).toBe(true);
      expect(resManager.filter).toBeUndefined();

      // Regular customer is constrained to their own records
      const resCustomer = engine.buildListFilter(rule, {
        auth: { id: 'usr_c', role: 'customer' },
      }, fields);
      expect(resCustomer.allowed).toBe(true);
      expect(resCustomer.filter).toBe("user = 'usr_c'");
    });
  });

  describe('Owner-Scoped Access Rules & Privacy Boundaries End-to-End', () => {
    const testDir = path.resolve(__dirname, '../.test_rules_e2e_data');
    let app: NodeStack;

    afterAll(async () => {
      if (app) await app.stop();
      if (fs.existsSync(testDir)) {
        try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
      }
    });

    it('should enforce owner scoping on orders template collection', async () => {
      if (fs.existsSync(testDir)) {
        try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
      }
      app = new NodeStack({ dataDir: testDir, port: 8149 });
      await app.templates.apply('ecommerce');

      const ordersCol = app.schema.getCollectionOrThrow('orders');
      expect(ordersCol.listRule).toBe('@request.auth.id != "" && user = @request.auth.id');
      expect(ordersCol.viewRule).toBe('@request.auth.id != "" && user = @request.auth.id');

      // 1. Unauthenticated guest querying orders must be denied with 403 Forbidden
      await expect(app.records.getList('orders')).rejects.toThrow(ForbiddenError);

      // 2. Seed orders for customer 1 and customer 2
      const ord1 = await app.records.create('orders', {
        orderNumber: 'ORD-USER1-001',
        user: 'cust_alpha',
        customerName: 'Customer Alpha',
        customerEmail: 'alpha@domain.com',
        status: 'delivered',
        total: 120.5,
        items: JSON.stringify([{ productId: 'prod_01', quantity: 1, price: 120.5 }]),
        shippingAddress: '100 Alpha St',
        paymentStatus: 'paid',
      });

      const ord2 = await app.records.create('orders', {
        orderNumber: 'ORD-USER2-002',
        user: 'cust_beta',
        customerName: 'Customer Beta',
        customerEmail: 'beta@domain.com',
        status: 'processing',
        total: 250.0,
        items: JSON.stringify([{ productId: 'prod_02', quantity: 2, price: 125.0 }]),
        shippingAddress: '200 Beta Ave',
        paymentStatus: 'paid',
      });

      // 3. Customer Alpha lists orders without filter -> receives ONLY their own orders
      const alphaAuth = { id: 'cust_alpha', email: 'alpha@domain.com' };
      const alphaList = await app.records.getList('orders', {}, alphaAuth);
      expect(alphaList.items.length).toBe(1);
      expect(alphaList.items[0].orderNumber).toBe('ORD-USER1-001');
      expect(alphaList.items[0].user).toBe('cust_alpha');

      // 4. Customer Beta lists orders without filter -> receives ONLY their own orders
      const betaAuth = { id: 'cust_beta', email: 'beta@domain.com' };
      const betaList = await app.records.getList('orders', {}, betaAuth);
      expect(betaList.items.length).toBe(1);
      expect(betaList.items[0].orderNumber).toBe('ORD-USER2-002');
      expect(betaList.items[0].user).toBe('cust_beta');

      // 5. Customer Alpha tries to query Customer Beta's orders via client filter -> receives 0 records
      const maliciousQuery = await app.records.getList('orders', { filter: 'user = "cust_beta"' }, alphaAuth);
      expect(maliciousQuery.items.length).toBe(0);
      expect(maliciousQuery.totalItems).toBe(0);

      // 6. Customer Alpha tries to view Customer Beta's order via getOne -> 403 Forbidden
      await expect(app.records.getOne('orders', ord2.id, {}, alphaAuth)).rejects.toThrow(ForbiddenError);

      // 7. Customer Alpha views their own order via getOne -> succeeds
      const viewSelf = await app.records.getOne('orders', ord1.id, {}, alphaAuth);
      expect(viewSelf.id).toBe(ord1.id);
      expect(viewSelf.orderNumber).toBe('ORD-USER1-001');

      // 8. Super Admin lists orders -> receives all customer orders
      const adminAuth = { id: 'admin_root', isAdmin: true };
      const adminList = await app.records.getList('orders', {}, adminAuth);
      expect(adminList.items.some((o: any) => o.orderNumber === 'ORD-USER1-001')).toBe(true);
      expect(adminList.items.some((o: any) => o.orderNumber === 'ORD-USER2-002')).toBe(true);
    });
  });
});

