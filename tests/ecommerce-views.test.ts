import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { ViewQueryValidator } from '../src/schema/ViewQueryValidator';
import { ecommerceTemplate, getStoreManagerEmail } from '../src/templates/definitions/ecommerce';

describe('E-Commerce SQL View Collections', () => {
  const testDir = path.resolve(__dirname, '../.test_ecommerce_views_data');
  const port = 8257;
  let server: NodeStack;
  let shopperToken = '';
  let shopperId = '';
  let managerToken = '';

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    server = new NodeStack({
      dataDir: testDir,
      port,
      appName: 'E-Commerce Views Test',
    });

    await server.start(port);
    await server.apps.ensureDemoAppInitialized(true);

    const shopperLoginRes = await fetch(`http://127.0.0.1:${port}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NodeStack-App': 'ecommerce-demo',
      },
      body: JSON.stringify({
        identity: 'alex.vance@nodestack.dev',
        password: 'DemoPassword123!',
      }),
    });
    const shopperLogin = await shopperLoginRes.json();
    shopperToken = shopperLogin.token;
    shopperId = shopperLogin.record.id;

    const managerLoginRes = await fetch(`http://127.0.0.1:${port}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NodeStack-App': 'ecommerce-demo',
      },
      body: JSON.stringify({
        identity: getStoreManagerEmail(),
        password: process.env.STORE_MANAGER_PASSWORD || 'StoreManagerSecret2026!',
      }),
    });
    const managerLogin = await managerLoginRes.json();
    managerToken = managerLogin.token;
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore windows lock
      }
    }
  });

  it('infers clean schemas and accurate initial aggregates for all 3 e-commerce views', async () => {
    const scope = server.apps.get('ecommerce-demo');

    const socialCol = scope.schema.getCollectionOrThrow('product_social_proof');
    expect(socialCol.type).toBe('view');
    expect(socialCol.createRule).toBeNull();
    expect(socialCol.updateRule).toBeNull();
    expect(socialCol.deleteRule).toBeNull();
    const socialFields = new Map(socialCol.schema.map((f) => [f.name, f]));
    expect(socialFields.get('category')?.type).toBe('relation');
    expect(socialFields.get('status')?.type).toBe('select');
    expect(socialFields.get('isFeatured')?.type).toBe('bool');
    expect(socialFields.get('discountPercent')?.type).toBe('number');
    expect(socialFields.get('reviewCount')?.type).toBe('number');
    expect(socialFields.get('avgRating')?.type).toBe('number');
    expect(socialFields.get('verifiedReviewCount')?.type).toBe('number');
    expect(socialFields.get('helpfulVotesTotal')?.type).toBe('number');
    expect(socialFields.get('favoriteCount')?.type).toBe('number');

    const orderInsightsCol = scope.schema.getCollectionOrThrow('manager_order_insights');
    expect(orderInsightsCol.type).toBe('view');
    const orderInsightFields = new Map(orderInsightsCol.schema.map((f) => [f.name, f]));
    expect(orderInsightFields.get('orderCount')?.type).toBe('number');
    expect(orderInsightFields.get('grossRevenue')?.type).toBe('number');
    expect(orderInsightFields.get('totalDiscount')?.type).toBe('number');
    expect(orderInsightFields.get('avgOrderValue')?.type).toBe('number');
    expect(orderInsightFields.get('loyaltyPointsIssued')?.type).toBe('number');

    const catalogInsightsCol = scope.schema.getCollectionOrThrow('manager_catalog_insights');
    expect(catalogInsightsCol.type).toBe('view');
    const catalogFields = new Map(catalogInsightsCol.schema.map((f) => [f.name, f]));
    expect(catalogFields.get('category')?.type).toBe('relation');
    expect(catalogFields.get('categoryName')?.type).toBe('text');
    expect(catalogFields.get('inventoryValue')?.type).toBe('number');
    expect(catalogFields.get('inCartUnits')?.type).toBe('number');
    expect(catalogFields.get('cartShoppersCount')?.type).toBe('number');

    // Verify seeded aggregates
    const socialProof = await scope.records.getList('product_social_proof', { perPage: 50 });
    expect(socialProof.totalItems).toBe(20);
    const prod01 = socialProof.items.find((r) => r.id === 'prod_01');
    expect(prod01.reviewCount).toBe(2);
    expect(prod01.avgRating).toBe(5);
    expect(prod01.verifiedReviewCount).toBe(2);
    expect(prod01.helpfulVotesTotal).toBe(23);
    expect(prod01.favoriteCount).toBe(0);
    expect(prod01.discountPercent).toBe(0);

    const prod02 = socialProof.items.find((r) => r.id === 'prod_02');
    // 189.5 vs 229.0 -> ~17% discount
    expect(prod02.discountPercent).toBe(17);

    const orderInsights = await scope.records.getList('manager_order_insights', { perPage: 50 }, { isAdmin: true });
    const save20Row = orderInsights.items.find((r) => r.couponCode === 'SAVE20');
    expect(save20Row).toBeDefined();
    expect(save20Row.orderCount).toBe(1);
    expect(save20Row.totalDiscount).toBe(60);
    expect(save20Row.loyaltyPointsIssued).toBe(3590);

    const catalogInsights = await scope.records.getList('manager_catalog_insights', { perPage: 50 }, { isAdmin: true });
    expect(catalogInsights.totalItems).toBe(20);
    const catProd01 = catalogInsights.items.find((r) => r.id === 'prod_01');
    expect(catProd01.categoryName).toBe('Electronics');
    expect(catProd01.inventoryValue).toBeCloseTo(299.99 * 45, 2);
  });

  it('prevents multi-table CTE join row multiplication and reflects live mutations immediately', async () => {
    const scope = server.apps.get('ecommerce-demo');

    // Create a second user so cartShoppersCount and favoriteCount can both be >= 2 on prod_01
    const secondUser = await scope.records.create('users', {
      id: 'usr_view_tester_2',
      email: 'view.tester2@nodestack.dev',
      password: 'Password123!',
      emailVisibility: false,
      verified: true,
      name: 'Tester Two',
    }, { isAdmin: true });

    // Add 2 favorites, 2 cart items (2 shoppers, total 5 units), 1 new unverified review, and 1 new order
    const fav1 = await scope.records.create('favorites', { user: shopperId, product: 'prod_01' }, { isAdmin: true });
    const fav2 = await scope.records.create('favorites', { user: secondUser.id, product: 'prod_01' }, { isAdmin: true });

    const cart1 = await scope.records.create('cart_items', { user: shopperId, product: 'prod_01', quantity: 2 }, { isAdmin: true });
    const cart2 = await scope.records.create('cart_items', { user: secondUser.id, product: 'prod_01', quantity: 3 }, { isAdmin: true });

    const revNew = await scope.records.create('reviews', {
      product: 'prod_01',
      user: shopperId,
      author: 'Alex Vance',
      rating: 2,
      title: 'Testing live average',
      content: 'Verifying non-multiplied CTE counts',
      verifiedPurchase: 0,
      helpfulVotes: 5,
    }, { isAdmin: true });

    const ordNew = await scope.records.create('orders', {
      orderNumber: 'ORD-VIEW-LIVE-1',
      user: shopperId,
      customerName: 'Alex Vance',
      customerEmail: 'alex.vance@nodestack.dev',
      status: 'delivered',
      paymentStatus: 'paid',
      total: 200,
      discount: 40,
      couponCode: 'SAVE20',
      loyaltyPoints: 2000,
      items: JSON.stringify([{ productId: 'prod_01', quantity: 1, price: 299.99 }]),
    }, { isAdmin: true });

    // Check product_social_proof: 3 reviews (5, 5, 2 -> avg 4.0), 2 verified, 23+5 = 28 helpfulVotes, 2 favorites
    const socialOne = await scope.records.getOne('product_social_proof', 'prod_01');
    expect(socialOne.reviewCount).toBe(3);
    expect(socialOne.avgRating).toBe(4);
    expect(socialOne.verifiedReviewCount).toBe(2);
    expect(socialOne.helpfulVotesTotal).toBe(28);
    expect(socialOne.favoriteCount).toBe(2);

    // Check manager_catalog_insights: no multiplication between reviews (3), favorites (2), and cart_items (2 rows = 5 units)
    const catalogOne = await scope.records.getOne('manager_catalog_insights', 'prod_01', {}, { isAdmin: true });
    expect(catalogOne.reviewCount).toBe(3);
    expect(catalogOne.helpfulVotesTotal).toBe(28);
    expect(catalogOne.favoriteCount).toBe(2);
    expect(catalogOne.inCartUnits).toBe(5);
    expect(catalogOne.cartShoppersCount).toBe(2);

    // Check manager_order_insights reflects the new SAVE20 delivered/paid order
    const save20Row = await scope.records.getOne('manager_order_insights', 'delivered:paid:SAVE20', {}, { isAdmin: true });
    expect(save20Row.orderCount).toBe(2);
    expect(save20Row.grossRevenue).toBeCloseTo(559.98, 2);
    expect(save20Row.totalDiscount).toBe(100);
    expect(save20Row.loyaltyPointsIssued).toBe(5590);

    // Clean up mutated rows
    await scope.records.delete('favorites', fav1.id, { isAdmin: true });
    await scope.records.delete('favorites', fav2.id, { isAdmin: true });
    await scope.records.delete('cart_items', cart1.id, { isAdmin: true });
    await scope.records.delete('cart_items', cart2.id, { isAdmin: true });
    await scope.records.delete('reviews', revNew.id, { isAdmin: true });
    await scope.records.delete('orders', ordNew.id, { isAdmin: true });
    await scope.records.delete('users', secondUser.id, { isAdmin: true });
  });

  it('enforces access rules, read-only 405, and prevents PII leakage', async () => {
    const baseUrl = `http://127.0.0.1:${port}/api/collections`;
    const appHeaders = (token?: string): Record<string, string> => ({
      'X-NodeStack-App': 'ecommerce-demo',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });

    // 1. Anonymous gets 200 on product_social_proof and 403 on manager_* views
    const anonSocial = await fetch(`${baseUrl}/product_social_proof/records`, {
      headers: appHeaders(),
    });
    expect(anonSocial.status).toBe(200);
    const anonSocialData = await anonSocial.json();
    expect(anonSocialData.items.length).toBe(20);
    for (const item of anonSocialData.items) {
      expect(item).not.toHaveProperty('user');
      expect(item).not.toHaveProperty('customerEmail');
      expect(item).not.toHaveProperty('shippingAddress');
      expect(item).not.toHaveProperty('customerName');
    }

    const anonOrderInsights = await fetch(`${baseUrl}/manager_order_insights/records`, {
      headers: appHeaders(),
    });
    expect(anonOrderInsights.status).toBe(403);

    const anonCatalogInsights = await fetch(`${baseUrl}/manager_catalog_insights/records`, {
      headers: appHeaders(),
    });
    expect(anonCatalogInsights.status).toBe(403);

    // 2. Shopper token gets 200 on product_social_proof and 403 on manager_* views (list & single)
    const shopperSocial = await fetch(`${baseUrl}/product_social_proof/records/prod_01`, {
      headers: appHeaders(shopperToken),
    });
    expect(shopperSocial.status).toBe(200);

    const shopperOrderInsights = await fetch(`${baseUrl}/manager_order_insights/records`, {
      headers: appHeaders(shopperToken),
    });
    expect(shopperOrderInsights.status).toBe(403);

    const shopperCatalogInsights = await fetch(`${baseUrl}/manager_catalog_insights/records/prod_01`, {
      headers: appHeaders(shopperToken),
    });
    expect(shopperCatalogInsights.status).toBe(403);

    // 3. Store Manager token gets 200 on manager_* views and no raw customer PII is exposed
    const mgrOrdersRes = await fetch(`${baseUrl}/manager_order_insights/records`, {
      headers: appHeaders(managerToken),
    });
    expect(mgrOrdersRes.status).toBe(200);
    const mgrOrdersData = await mgrOrdersRes.json();
    expect(mgrOrdersData.items.length).toBeGreaterThan(0);
    for (const row of mgrOrdersData.items) {
      expect(row).not.toHaveProperty('customerEmail');
      expect(row).not.toHaveProperty('customerName');
      expect(row).not.toHaveProperty('shippingAddress');
      expect(row).not.toHaveProperty('user');
    }

    const mgrCatalogRes = await fetch(`${baseUrl}/manager_catalog_insights/records`, {
      headers: appHeaders(managerToken),
    });
    expect(mgrCatalogRes.status).toBe(200);
    const mgrCatalogData = await mgrCatalogRes.json();
    expect(mgrCatalogData.items.length).toBe(20);

    // 4. Write attempts on view collections return 405
    const postRes = await fetch(`${baseUrl}/product_social_proof/records`, {
      method: 'POST',
      headers: { ...appHeaders(managerToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Injected' }),
    });
    expect(postRes.status).toBe(405);
  });

  it('validates postgres and mssql queries for all 3 e-commerce views', async () => {
    const scope = server.apps.get('ecommerce-demo');
    const viewNames = ['product_social_proof', 'manager_order_insights', 'manager_catalog_insights'];

    for (const viewName of viewNames) {
      const colDef = ecommerceTemplate.collections.find((c) => c.name === viewName)!;
      const viewQueries = colDef.dto.options?.viewQueries!;
      expect(viewQueries).toBeDefined();

      for (const dialect of ['sqlite', 'postgres', 'mssql'] as const) {
        const sql = viewQueries[dialect]!;
        expect(sql).toBeTruthy();
        expect(() => ViewQueryValidator.validate(sql, dialect, viewName, new Set(['users']))).not.toThrow();

        const preview = await scope.schema.previewViewQuery({
          name: viewName,
          viewQueries,
          dialect,
        });
        expect(preview.valid).toBe(true);
        if (dialect !== 'sqlite') {
          expect(preview.staticOnly).toBe(true);
        }
      }
    }
  });
});
