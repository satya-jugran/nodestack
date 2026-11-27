import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { NodeStackClient, MemoryAuthStore } from '../packages/client/src';

describe('Built-in E-Commerce Demo Application (ecommerce-demo)', () => {
  const testDir = path.resolve(__dirname, '../.test_ecommerce_demo_data');
  const port = 8249;
  let server: NodeStack;
  let client: NodeStackClient;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    server = new NodeStack({
      dataDir: testDir,
      port,
      appName: 'E-Commerce Demo Test Instance',
    });

    await server.start(port);

    client = new NodeStackClient(`http://127.0.0.1:${port}`, {
      authStore: new MemoryAuthStore(),
      app: 'ecommerce-demo',
    });
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Ignored on Windows file lock
      }
    }
  });

  describe('1. Provisioning & Immutability', () => {
    it('should pre-seed both default and ecommerce-demo apps out of the box', async () => {
      const apps = await server.apps.list();
      expect(apps.length).toBeGreaterThanOrEqual(2);

      const defaultApp = apps.find((a) => a.slug === 'default');
      expect(defaultApp).toBeDefined();
      expect(defaultApp?.isDefault).toBe(true);

      const demoApp = apps.find((a) => a.slug === 'ecommerce-demo');
      expect(demoApp).toBeDefined();
      expect(demoApp?.name).toBe('E-Commerce Demo');
      expect(demoApp?.isDefault).toBe(false);

      const demoDir = path.join(testDir, 'apps', 'ecommerce-demo');
      expect(fs.existsSync(demoDir)).toBe(true);
      expect(fs.existsSync(path.join(demoDir, 'data.db'))).toBe(true);
      expect(fs.existsSync(path.join(demoDir, 'storage'))).toBe(true);
    });

    it('should protect default app but allow deleting and idempotently restoring ecommerce-demo', async () => {
      // 1. Deleting default application must be prevented
      await expect(server.apps.delete('default')).rejects.toThrow(
        /Cannot delete the default application/
      );
      await expect((server.apps as any).registry.deleteApp('default')).rejects.toThrow(
        /Cannot delete the default application/
      );

      // 2. Deleting ecommerce-demo must succeed
      await server.apps.delete('ecommerce-demo');
      expect(server.apps.has('ecommerce-demo')).toBe(false);
      const appsAfterDelete = await server.apps.list();
      expect(appsAfterDelete.some((a) => a.slug === 'ecommerce-demo')).toBe(false);

      // 3. Re-running demo initialization idempotently restores the deleted application
      const restoredScope = await server.apps.ensureDemoAppInitialized(true);
      expect(restoredScope).toBeDefined();
      expect(server.apps.has('ecommerce-demo')).toBe(true);

      const appsAfterRestore = await server.apps.list();
      const restoredApp = appsAfterRestore.find((a) => a.slug === 'ecommerce-demo');
      expect(restoredApp).toBeDefined();
      expect(restoredApp?.name).toBe('E-Commerce Demo');

      // Verify restored scope has collections, catalog products, and baseline snapshot
      const restoredCollections = restoredScope!.schema.getAllCollections();
      expect(restoredCollections.some((c) => c.name === 'products')).toBe(true);
      expect(restoredCollections.some((c) => c.name === 'orders')).toBe(true);
      expect(restoredScope!.snapshots.hasSnapshot()).toBe(true);
    });
  });

  describe('2. Template Data & Seed Verification', () => {
    it('should seed collections, catalog products, demo user, and baseline snapshot', async () => {
      const scope = server.apps.get('ecommerce-demo');
      expect(scope).toBeDefined();

      // Collections
      const collections = scope.schema.getAllCollections();
      const collectionNames = collections.map((c) => c.name);
      expect(collectionNames).toContain('products');
      expect(collectionNames).toContain('categories');
      expect(collectionNames).toContain('orders');
      expect(collectionNames).toContain('reviews');
      expect(collectionNames).toContain('favorites');
      expect(collectionNames).toContain('cart_items');
      expect(collectionNames).toContain('product_social_proof');
      expect(collectionNames).toContain('manager_order_insights');
      expect(collectionNames).toContain('manager_catalog_insights');

      const socialProofRes = await client.collection('product_social_proof').getList(1, 50);
      expect(socialProofRes.totalItems).toBe(20);
      const auraProof = socialProofRes.items.find((item: any) => item.id === 'prod_01');
      expect(auraProof).toBeDefined();
      expect(auraProof.reviewCount).toBe(2);
      expect(auraProof.avgRating).toBe(5);
      expect(auraProof.verifiedReviewCount).toBe(2);
      expect(auraProof.helpfulVotesTotal).toBe(23);

      // Orders collection schema check for tracking & points
      const ordersCol = scope.schema.getCollection('orders');
      expect(ordersCol).toBeDefined();
      const orderFields = ordersCol!.schema.map((f) => f.name);
      expect(orderFields).toContain('discount');
      expect(orderFields).toContain('couponCode');
      expect(orderFields).toContain('trackingNumber');
      expect(orderFields).toContain('carrier');
      expect(orderFields).toContain('loyaltyPoints');

      // Products count (20 catalog items)
      const products = await scope.records.getList('products', { perPage: 50 });
      expect(products.items.length).toBe(20);

      // Demo User
      const users = await scope.records.getList('users', { filter: "email = 'alex.vance@nodestack.dev'" }, { isAdmin: true });
      expect(users.items.length).toBe(1);
      expect(users.items[0].email).toBe('alex.vance@nodestack.dev');

      // Demo User Authentication with DemoPassword123!
      const authRes = await client.collection('users').authWithPassword('alex.vance@nodestack.dev', 'DemoPassword123!');
      expect(authRes.token).toBeDefined();
      expect(authRes.record.email).toBe('alex.vance@nodestack.dev');

      // Baseline snapshot
      const snapshots = await scope.snapshots.listSnapshots();
      const baseline = snapshots.find((s) => s.name === 'ecommerce-demo-baseline');
      expect(baseline).toBeDefined();
    });

    it('should repair missing flows, functions, and baseline snapshot on existing demo scope', async () => {
      const scope = server.apps.get('ecommerce-demo');

      // Simulate an older or partially initialized demo scope that already has products
      // but where a flow, function, or baseline snapshot is missing
      const flow = await scope.flows.getFlowByName('OrderFulfillmentFlow');
      expect(flow).toBeDefined();
      await scope.flows.deleteFlow(flow!.id);
      expect(await scope.flows.getFlowByName('OrderFulfillmentFlow')).toBeNull();

      const fn = await scope.functions.getFunctionByName('validate-order');
      expect(fn).toBeDefined();
      await scope.functions.deleteFunction(fn!.id);
      expect(await scope.functions.getFunctionByName('validate-order')).toBeNull();

      await scope.snapshots.clearAllSnapshots();
      expect(scope.snapshots.hasSnapshot()).toBe(false);

      // Re-invoke ensureDemoAppInitialized with force=true to trigger bootstrap repair
      await server.apps.ensureDemoAppInitialized(true);

      // Verify that missing flow, function, and baseline snapshot were repaired
      expect(await scope.flows.getFlowByName('OrderFulfillmentFlow')).not.toBeNull();
      expect(await scope.functions.getFunctionByName('validate-order')).not.toBeNull();
      expect(scope.snapshots.hasSnapshot()).toBe(true);
      const repairedSnapshots = await scope.snapshots.listSnapshots();
      expect(repairedSnapshots.some((s) => s.name === 'ecommerce-demo-baseline')).toBe(true);
    });
  });

  describe('3. Serverless Functions (Lambdas)', () => {
    it('should register all 6 e-commerce serverless functions', async () => {
      const scope = server.apps.get('ecommerce-demo');
      const functions = await scope.functions.getAllFunctions();
      const fnNames = functions.map((f) => f.name);

      expect(fnNames).toContain('calculate-discount');
      expect(fnNames).toContain('validate-order');
      expect(fnNames).toContain('update-inventory');
      expect(fnNames).toContain('generate-tracking-label');
      expect(fnNames).toContain('grant-loyalty-points');
      expect(fnNames).toContain('send-order-notification');
    });

    it('should accurately calculate percentage discount with calculate-discount lambda', async () => {
      const scope = server.apps.get('ecommerce-demo');
      const result = await scope.functions.executeFunction('calculate-discount', {
        method: 'POST',
        body: {
          couponCode: 'SAVE20',
          subtotal: 100,
        },
      });

      expect(result.statusCode).toBe(200);
      expect(result.body.valid).toBe(true);
      expect(result.body.discountAmount).toBe(20);
      expect(result.body.newTotal).toBe(80);
      expect(result.body.discountPercent).toBe(20);
    });

    it('should apply free shipping coupon with calculate-discount lambda', async () => {
      const scope = server.apps.get('ecommerce-demo');
      const result = await scope.functions.executeFunction('calculate-discount', {
        method: 'POST',
        body: {
          couponCode: 'FREESHIP',
          subtotal: 60,
        },
      });

      expect(result.statusCode).toBe(200);
      expect(result.body.valid).toBe(true);
      expect(result.body.freeShipping).toBe(true);
    });

    it('should reject coupons failing minimum spend threshold', async () => {
      const scope = server.apps.get('ecommerce-demo');
      const result = await scope.functions.executeFunction('calculate-discount', {
        method: 'POST',
        body: {
          couponCode: 'FLAT50',
          subtotal: 40, // FLAT50 requires min $150
        },
      });

      expect(result.statusCode).toBe(400);
      expect(result.body.valid).toBe(false);
      expect(result.body.message).toContain('requires a minimum order');
    });

    it('should reject unrecognized coupons', async () => {
      const scope = server.apps.get('ecommerce-demo');
      const result = await scope.functions.executeFunction('calculate-discount', {
        method: 'POST',
        body: {
          couponCode: 'UNKNOWN_CODE',
          subtotal: 100,
        },
      });

      expect(result.statusCode).toBe(400);
      expect(result.body.valid).toBe(false);
      expect(result.body.message).toContain('Invalid coupon');
    });

    it('should validate customer order payloads and catalog stock with validate-order lambda', async () => {
      const scope = server.apps.get('ecommerce-demo');
      const validRes = await scope.functions.executeFunction('validate-order', {
        method: 'POST',
        body: {
          orderNumber: 'ORD-TEST-1',
          customerEmail: 'alex.vance@nodestack.dev',
          shippingAddress: '404 Research Dr, Black Mesa, NM',
          items: [{ productId: 'prod_01', quantity: 1, price: 299.99 }],
        },
      });

      expect(validRes.statusCode).toBe(200);
      expect(validRes.body.passed).toBe(true);
      expect(validRes.body.riskScore).toBe('low');

      // Invalid customer details
      const invalidRes = await scope.functions.executeFunction('validate-order', {
        method: 'POST',
        body: {
          customerEmail: 'bad-email',
          shippingAddress: '',
          items: [],
        },
      });

      expect(invalidRes.statusCode).toBe(200);
      expect(invalidRes.body.passed).toBe(false);
      expect(invalidRes.body.riskScore).toBe('high');
      expect(invalidRes.body.issues.length).toBeGreaterThanOrEqual(2);

      // Rejection of non-existent catalog product
      const fakeProdRes = await scope.functions.executeFunction('validate-order', {
        method: 'POST',
        body: {
          customerEmail: 'alex.vance@nodestack.dev',
          shippingAddress: '404 Research Dr, Black Mesa, NM',
          items: [{ productId: 'fake_sku_999', quantity: 1, price: 50.0 }],
        },
      });
      expect(fakeProdRes.body.passed).toBe(false);
      expect(fakeProdRes.body.issues.some((i: string) => i.includes('does not exist in catalog'))).toBe(true);

      // Rejection of excessive quantity exceeding available stock
      const stockRes = await scope.functions.executeFunction('validate-order', {
        method: 'POST',
        body: {
          customerEmail: 'alex.vance@nodestack.dev',
          shippingAddress: '404 Research Dr, Black Mesa, NM',
          items: [{ productId: 'prod_01', quantity: 99999, price: 299.99 }],
        },
      });
      expect(stockRes.body.passed).toBe(false);
      expect(stockRes.body.issues.some((i: string) => i.includes('Insufficient stock'))).toBe(true);

      // Rejection of price tampering
      const priceTamperRes = await scope.functions.executeFunction('validate-order', {
        method: 'POST',
        body: {
          customerEmail: 'alex.vance@nodestack.dev',
          shippingAddress: '404 Research Dr, Black Mesa, NM',
          items: [{ productId: 'prod_01', quantity: 1, price: 0.99 }],
        },
      });
      expect(priceTamperRes.body.passed).toBe(false);
      expect(priceTamperRes.body.issues.some((i: string) => i.includes('Price mismatch'))).toBe(true);
    });
  });

  describe('4. Step-Function Flows', () => {
    it('should register OrderFulfillmentFlow and CheckoutPromotionFlow', async () => {
      const scope = server.apps.get('ecommerce-demo');
      const flows = await scope.flows.getAllFlows();
      const flowNames = flows.map((f) => f.name);

      expect(flowNames).toContain('OrderFulfillmentFlow');
      expect(flowNames).toContain('CheckoutPromotionFlow');

      const fulfillment = await scope.flows.getFlowByName('OrderFulfillmentFlow');
      expect(fulfillment).toBeDefined();
      expect(fulfillment?.triggerType).toBe('event');
      expect(fulfillment?.eventTrigger).toBe('orders:create');

      const promo = await scope.flows.getFlowByName('CheckoutPromotionFlow');
      expect(promo).toBeDefined();
      expect(promo?.triggerType).toBe('http');
    });

    it('should execute CheckoutPromotionFlow state machine and unlock gift tier for high-value carts', async () => {
      const scope = server.apps.get('ecommerce-demo');
      const execution = await scope.flows.executeFlow('CheckoutPromotionFlow', {
        cartTotal: 175,
        couponCode: 'SAVE20',
      }, undefined, { wait: true });

      expect(execution.status).toBe('succeeded');
      expect(execution.output).toBeDefined();

      // Check gift perk unlocked by Choice state
      expect(execution.output.bundlePerk).toBeDefined();
      expect(execution.output.bundlePerk.giftCredit).toBe(15);
      expect(execution.output.bundlePerk.unlockedPerk).toContain('Free Premium Express Packaging');

      // Check coupon evaluation Task result
      expect(execution.output.discountResult).toBeDefined();
      expect(execution.output.discountResult.valid).toBe(true);
      expect(execution.output.discountResult.discountAmount).toBe(35);
    });

    it('should execute OrderFulfillmentFlow on order record creation, decrement inventory, and update order tracking', async () => {
      const scope = server.apps.get('ecommerce-demo');

      // 1. Pick a product to order and note stock
      const products = await scope.records.getList('products', { perPage: 1 });
      const testProduct = products.items[0];
      const initialStock = Number(testProduct.stock);

      // 2. Create order record to trigger OrderFulfillmentFlow (orders:create)
      const order = await scope.records.create('orders', {
        orderNumber: 'ORD-INTEG-999',
        customerName: 'Alex Vance',
        customerEmail: 'alex.vance@nodestack.dev',
        shippingAddress: '123 Market St, Suite 500, San Francisco, CA 94105',
        total: 230,
        discount: 20,
        couponCode: 'SAVE20',
        status: 'pending',
        items: JSON.stringify([
          {
            productId: testProduct.id,
            name: testProduct.name,
            price: testProduct.price,
            quantity: 2,
          },
        ]),
      }, { id: 'admin', isAdmin: true });

      expect(order.id).toBeDefined();

      // 3. Wait for background async flow execution to complete
      let executionFinished = false;
      const flow = await scope.flows.getFlowByName('OrderFulfillmentFlow');
      expect(flow).toBeDefined();

      for (let attempt = 0; attempt < 25; attempt++) {
        await new Promise((r) => setTimeout(r, 200));
        const executions = await scope.flows.getExecutions({ flowId: flow!.id });
        if (executions.items.length > 0 && executions.items[0].status === 'succeeded') {
          executionFinished = true;
          break;
        }
      }

      expect(executionFinished).toBe(true);

      // 4. Verify stock was decremented in products collection
      const updatedProduct = await scope.records.getOne('products', testProduct.id);
      expect(Number(updatedProduct.stock)).toBe(initialStock - 2);

      // 5. Verify order record was updated by send-order-notification with carrier, tracking & VIP points
      const updatedOrder = await scope.records.getOne('orders', order.id, {}, { id: 'admin', isAdmin: true });
      expect(updatedOrder.status).toBe('processing');
      expect(updatedOrder.carrier).toBeDefined();
      expect(typeof updatedOrder.carrier).toBe('string');
      expect(updatedOrder.trackingNumber).toMatch(/^TRK-US-\d{6}$/);
      expect(Number(updatedOrder.loyaltyPoints)).toBeGreaterThanOrEqual(2300);
    });
  });

  describe('5. Client SDK Function & Flow Services', () => {
    it('should invoke serverless function via client.functions.invoke and return minTotal', async () => {
      const res = await client.functions.invoke('calculate-discount', {
        couponCode: 'SAVE20',
        cartTotal: 150,
      });

      expect(res.valid).toBe(true);
      expect(res.minTotal).toBe(75);
      expect(res.discountAmount).toBe(30);
      expect(res.newTotal).toBe(120);
    });

    it('should reject coupons when cartTotal is below the minimum order threshold', async () => {
      await expect(
        client.functions.invoke('calculate-discount', {
          couponCode: 'SAVE20',
          cartTotal: 50,
        })
      ).rejects.toThrow(/minimum order/);
    });

    it('should execute flow via client.flows.execute with admin authentication', async () => {
      // Authenticate initial admin
      await client.admins.createInitial('admin@nodestack.dev', 'AdminDemoPass123!');

      const res = await client.flows.execute('CheckoutPromotionFlow', {
        cartTotal: 220,
        couponCode: 'WELCOME10',
      }, { wait: true });

      expect(res.status).toBe('succeeded');
      expect(res.output).toBeDefined();
      expect(res.output.bundlePerk).toBeDefined();
      expect(res.output.bundlePerk.giftCredit).toBe(15);
    });

    it('should allow customer or unauthenticated storefront to execute HTTP-triggered flow', async () => {
      // Clear any admin auth token to simulate unauthenticated / customer client
      client.authStore.clear();

      const res = await client.flows.execute('CheckoutPromotionFlow', {
        cartTotal: 180,
        couponCode: 'SAVE20',
      }, { wait: true });

      expect(res.status).toBe('succeeded');
      expect(res.output.discountResult.valid).toBe(true);
      expect(res.output.discountResult.discountAmount).toBe(36);
      expect(res.output.bundlePerk.giftCredit).toBe(15);
    });

    it('should deny non-admin execution of non-http (event) flows', async () => {
      client.authStore.clear();

      await expect(
        client.flows.execute('OrderFulfillmentFlow', {}, { wait: true })
      ).rejects.toThrow(/requires admin credentials/);
    });

    it('should protect update-inventory with admin authPolicy, denying unauthenticated and customer callers', async () => {
      // 1. Unauthenticated direct invocation via client should fail with 403 Forbidden
      client.authStore.clear();
      await expect(
        client.functions.invoke('update-inventory', {
          record: { orderNumber: 'ORD-HACK-1', items: [{ productId: 'prod_01', quantity: 999 }] }
        })
      ).rejects.toThrow(/Superuser authorization required/i);

      // 2. Authenticated non-admin (customer) direct invocation via client should fail with 403
      await client.collection('users').authWithPassword('alex.vance@nodestack.dev', 'DemoPassword123!');
      await expect(
        client.functions.invoke('update-inventory', {
          record: { orderNumber: 'ORD-HACK-2', items: [{ productId: 'prod_01', quantity: 999 }] }
        })
      ).rejects.toThrow(/Superuser authorization required/i);

      // 3. Admin direct invocation succeeds
      await client.admins.authWithPassword('admin@nodestack.dev', 'AdminDemoPass123!');
      const adminRes = await client.functions.invoke('update-inventory', {
        record: { orderNumber: 'ORD-ADMIN-1', items: [] }
      });
      expect(adminRes.success).toBe(true);
    });

    it('should protect send-order-notification with admin authPolicy, denying unauthenticated and customer callers', async () => {
      // 1. Unauthenticated direct invocation via client should fail with 403 Forbidden
      client.authStore.clear();
      await expect(
        client.functions.invoke('send-order-notification', {
          record: { id: 'ord_fake_123', orderNumber: 'ORD-HACK-1' }
        })
      ).rejects.toThrow(/Superuser authorization required/i);

      // 2. Authenticated non-admin (customer) direct invocation via client should fail with 403
      await client.collection('users').authWithPassword('alex.vance@nodestack.dev', 'DemoPassword123!');
      await expect(
        client.functions.invoke('send-order-notification', {
          record: { id: 'ord_fake_123', orderNumber: 'ORD-HACK-2' }
        })
      ).rejects.toThrow(/Superuser authorization required/i);

      // 3. Admin direct invocation succeeds
      await client.admins.authWithPassword('admin@nodestack.dev', 'AdminDemoPass123!');
      const adminRes = await client.functions.invoke('send-order-notification', {
        record: { orderNumber: 'ORD-ADMIN-1', customerEmail: 'alex.vance@nodestack.dev' }
      });
      expect(adminRes.notified).toBe(true);
    });

    it('should persist and synchronize cart items for authenticated customer in NodeStack backend', async () => {
      // 1. Authenticate as demo customer
      const auth = await client.collection('users').authWithPassword('alex.vance@nodestack.dev', 'DemoPassword123!');
      expect(auth.token).toBeDefined();

      // 2. Add item to backend cart_items
      const created = await client.collection('cart_items').create({
        user: auth.record.id,
        product: 'prod_01',
        quantity: 2,
      });
      expect(created.id).toBeDefined();

      // 3. Retrieve user cart
      const list = await client.collection('cart_items').getList(1, 10, {
        filter: `user = "${auth.record.id}"`,
      });
      expect(list.items.length).toBe(1);
      expect(list.items[0].product).toBe('prod_01');
      expect(list.items[0].quantity).toBe(2);

      // 4. Simulate logout by clearing auth token and verify access rule
      client.authStore.clear();
      await expect(
        client.collection('cart_items').getList(1, 10, {
          filter: `user = "${auth.record.id}"`,
        })
      ).rejects.toThrow();

      // 5. Log back in and verify cart items are still intact
      await client.collection('users').authWithPassword('alex.vance@nodestack.dev', 'DemoPassword123!');
      const restored = await client.collection('cart_items').getList(1, 10, {
        filter: `user = "${auth.record.id}"`,
      });
      expect(restored.items.length).toBe(1);

      // Clean up
      await client.collection('cart_items').delete(created.id);
    });

    it('should persist and synchronize favorites for authenticated customer in NodeStack backend', async () => {
      // 1. Authenticate as demo customer
      const auth = await client.collection('users').authWithPassword('alex.vance@nodestack.dev', 'DemoPassword123!');
      expect(auth.token).toBeDefined();

      // 2. Add product to favorites
      const created = await client.collection('favorites').create({
        user: auth.record.id,
        product: 'prod_02',
      });
      expect(created.id).toBeDefined();

      // 3. Retrieve user favorites
      const list = await client.collection('favorites').getList(1, 10, {
        filter: `user = "${auth.record.id}"`,
      });
      expect(list.items.length).toBeGreaterThanOrEqual(1);
      expect(list.items.some((f) => f.product === 'prod_02')).toBe(true);

      // 4. Simulate logout by clearing auth token and verify access rule
      client.authStore.clear();
      await expect(
        client.collection('favorites').getList(1, 10, {
          filter: `user = "${auth.record.id}"`,
        })
      ).rejects.toThrow();

      // 5. Log back in and verify favorite is still intact
      await client.collection('users').authWithPassword('alex.vance@nodestack.dev', 'DemoPassword123!');
      const restored = await client.collection('favorites').getList(1, 10, {
        filter: `user = "${auth.record.id}"`,
      });
      expect(restored.items.some((f) => f.product === 'prod_02')).toBe(true);

      // Clean up
      await client.collection('favorites').delete(created.id);
    });

    it('should enforce user = @request.auth.id on orders createRule, preventing spoofing other accounts', async () => {
      // 1. Authenticate as demo customer Alex Vance
      const auth = await client.collection('users').authWithPassword('alex.vance@nodestack.dev', 'DemoPassword123!');
      expect(auth.token).toBeDefined();

      // 2. Creating order matching auth.record.id succeeds
      const validOrder = await client.collection('orders').create({
        orderNumber: 'ORD-SECURITY-001',
        user: auth.record.id,
        customerName: 'Alex Vance',
        customerEmail: 'alex.vance@nodestack.dev',
        shippingAddress: '742 Evergreen Terrace, Austin, TX 78701',
        total: 99.0,
        status: 'pending',
        items: JSON.stringify([{ productId: 'prod_01', quantity: 1, price: 99.0 }]),
      });
      expect(validOrder.id).toBeDefined();

      // 3. Attempting to create order with another user ID fails
      await expect(
        client.collection('orders').create({
          orderNumber: 'ORD-SECURITY-HACK',
          user: 'usr_another_victim',
          customerName: 'Imposter',
          customerEmail: 'imposter@bad.com',
          shippingAddress: '123 Fake St',
          total: 50.0,
          status: 'pending',
          items: JSON.stringify([]),
        })
      ).rejects.toThrow();

      // Clean up
      await client.collection('orders').delete(validOrder.id).catch(() => {});
    });
  });

  describe('6. Product Variants & Variant-Specific Stock Levels', () => {
    it('should seed products with variantOptions and variant-specific stock levels', async () => {
      const scope = server.apps.get('ecommerce-demo');
      const hoodie = await scope.records.getOne('products', 'prod_11');

      expect(Array.isArray(hoodie.variantOptions)).toBe(true);
      expect(hoodie.variantOptions).toEqual([
        { name: 'Size', values: ['S', 'M', 'L'] },
        { name: 'Color', values: ['Slate', 'Amber', 'Navy'] },
      ]);
      expect(Array.isArray(hoodie.variants)).toBe(true);
      expect(hoodie.variants.length).toBe(9);

      const sAmber = hoodie.variants.find((v: any) => v.id === 'var_s_amber');
      expect(sAmber).toBeDefined();
      expect(sAmber.options).toEqual({ Size: 'S', Color: 'Amber' });
      expect(sAmber.stock).toBe(0);

      const mSlate = hoodie.variants.find((v: any) => v.id === 'var_m_slate');
      expect(mSlate).toBeDefined();
      expect(mSlate.stock).toBe(8);

      const sumStock = hoodie.variants.reduce((sum: number, v: any) => sum + Number(v.stock), 0);
      expect(Number(hoodie.stock)).toBe(sumStock);
    });

    it('should validate variant availability and variant-specific stock in validate-order lambda', async () => {
      const scope = server.apps.get('ecommerce-demo');

      // 1. Out-of-stock variant (S / Amber has 0 stock, even though total product stock is 42)
      const oosRes = await scope.functions.executeFunction('validate-order', {
        method: 'POST',
        body: {
          orderNumber: 'ORD-VAR-OOS',
          customerEmail: 'alex.vance@nodestack.dev',
          shippingAddress: '742 Evergreen Terrace, Austin, TX 78701',
          items: [
            {
              productId: 'prod_11',
              variantId: 'var_s_amber',
              variantLabel: 'S / Amber',
              variantOptions: { Size: 'S', Color: 'Amber' },
              quantity: 1,
              price: 125.0,
            },
          ],
        },
      });
      expect(oosRes.body.passed).toBe(false);
      expect(oosRes.body.issues.some((i: string) => i.includes('Insufficient stock') && i.includes('S / Amber'))).toBe(true);

      // 2. Non-existent variant ID
      const missingRes = await scope.functions.executeFunction('validate-order', {
        method: 'POST',
        body: {
          orderNumber: 'ORD-VAR-MISSING',
          customerEmail: 'alex.vance@nodestack.dev',
          shippingAddress: '742 Evergreen Terrace, Austin, TX 78701',
          items: [
            {
              productId: 'prod_11',
              variantId: 'var_xxl_neon',
              variantLabel: 'XXL / Neon',
              quantity: 1,
              price: 125.0,
            },
          ],
        },
      });
      expect(missingRes.body.passed).toBe(false);
      expect(missingRes.body.issues.some((i: string) => i.includes('does not exist'))).toBe(true);

      // 3. Valid in-stock variant (M / Slate has 8 units)
      const validRes = await scope.functions.executeFunction('validate-order', {
        method: 'POST',
        body: {
          orderNumber: 'ORD-VAR-OK',
          customerEmail: 'alex.vance@nodestack.dev',
          shippingAddress: '742 Evergreen Terrace, Austin, TX 78701',
          items: [
            {
              productId: 'prod_11',
              variantId: 'var_m_slate',
              variantLabel: 'M / Slate',
              variantOptions: { Size: 'M', Color: 'Slate' },
              quantity: 2,
              price: 125.0,
            },
          ],
        },
      });
      expect(validRes.body.passed).toBe(true);
    });

    it('should decrement only the purchased variant stock and update total product stock via OrderFulfillmentFlow', async () => {
      const scope = server.apps.get('ecommerce-demo');
      const before = await scope.records.getOne('products', 'prod_11');
      const initialTotalStock = Number(before.stock);
      const initialMSlate = before.variants.find((v: any) => v.id === 'var_m_slate').stock;
      const initialLNavy = before.variants.find((v: any) => v.id === 'var_l_navy').stock;

      const order = await scope.records.create('orders', {
        orderNumber: 'ORD-VAR-FLOW-1',
        customerName: 'Alex Vance',
        customerEmail: 'alex.vance@nodestack.dev',
        shippingAddress: '742 Evergreen Terrace, Austin, TX 78701',
        total: 250,
        status: 'pending',
        items: JSON.stringify([
          {
            productId: 'prod_11',
            name: 'Alpine Thermal Merino Wool Hoodie',
            variantId: 'var_m_slate',
            variantLabel: 'M / Slate',
            variantOptions: { Size: 'M', Color: 'Slate' },
            price: 125.0,
            quantity: 2,
          },
        ]),
      }, { id: 'admin', isAdmin: true });

      expect(order.id).toBeDefined();

      const flow = await scope.flows.getFlowByName('OrderFulfillmentFlow');
      let finished = false;
      for (let attempt = 0; attempt < 25; attempt++) {
        await new Promise((r) => setTimeout(r, 200));
        const executions = await scope.flows.getExecutions({ flowId: flow!.id });
        const match = executions.items.find((ex: any) => ex.input?.record?.id === order.id);
        if (match && match.status === 'succeeded') {
          finished = true;
          break;
        }
      }
      expect(finished).toBe(true);

      const after = await scope.records.getOne('products', 'prod_11');
      const afterMSlate = after.variants.find((v: any) => v.id === 'var_m_slate').stock;
      const afterLNavy = after.variants.find((v: any) => v.id === 'var_l_navy').stock;

      expect(afterMSlate).toBe(initialMSlate - 2);
      expect(afterLNavy).toBe(initialLNavy);
      expect(Number(after.stock)).toBe(initialTotalStock - 2);
    });

    it('should persist distinct cart_items rows for different variants of the same product', async () => {
      const auth = await client.collection('users').authWithPassword('alex.vance@nodestack.dev', 'DemoPassword123!');

      const itemA = await client.collection('cart_items').create({
        user: auth.record.id,
        product: 'prod_11',
        quantity: 1,
        variantId: 'var_s_slate',
        variantLabel: 'S / Slate',
        variantOptions: { Size: 'S', Color: 'Slate' },
      });

      const itemB = await client.collection('cart_items').create({
        user: auth.record.id,
        product: 'prod_11',
        quantity: 2,
        variantId: 'var_m_navy',
        variantLabel: 'M / Navy',
        variantOptions: { Size: 'M', Color: 'Navy' },
      });

      const cartList = await client.collection('cart_items').getList(1, 20, {
        filter: `user = "${auth.record.id}"`,
      });
      const hoodieItems = cartList.items.filter((i: any) => i.product === 'prod_11');
      expect(hoodieItems.length).toBe(2);
      expect(hoodieItems.some((i: any) => i.variantId === 'var_s_slate' && i.variantLabel === 'S / Slate')).toBe(true);
      expect(hoodieItems.some((i: any) => i.variantId === 'var_m_navy' && i.variantLabel === 'M / Navy')).toBe(true);

      await client.collection('cart_items').delete(itemA.id);
      await client.collection('cart_items').delete(itemB.id);
    });
  });

  describe('Customer Reviews Enhancements', () => {
    it('should include helpfulVotes field in reviews SQLite schema and support upvote-review function', async () => {
      const scope = server.apps.get('ecommerce-demo')!;
      const reviewsCol = scope.schema.getCollection('reviews');
      expect(reviewsCol).toBeDefined();
      expect(reviewsCol!.schema.some((f) => f.name === 'helpfulVotes' && f.type === 'number')).toBe(true);

      const revBefore = await scope.records.getOne('reviews', 'rev_01');
      const initialVotes = Number(revBefore.helpfulVotes || 0);
      expect(initialVotes).toBeGreaterThanOrEqual(0);

      const fn = await scope.functions.getFunctionByName('upvote-review');
      expect(fn).toBeDefined();

      // Increment helpfulVotes via public elevated serverless function
      let upRes: { success: boolean; reviewId: string; helpfulVotes: number };
      try {
        upRes = await client.functions.invoke<{
          success: boolean;
          reviewId: string;
          helpfulVotes: number;
        }>('upvote-review', { reviewId: 'rev_01', delta: 1 });
      } catch (err: any) {
        throw new Error(`upvote-review failed (${err?.status}): ${JSON.stringify(err?.data || err?.message)}`);
      }

      expect(upRes.success).toBe(true);
      expect(upRes.reviewId).toBe('rev_01');
      expect(upRes.helpfulVotes).toBe(initialVotes + 1);

      // Verify persistence in SQLite
      const rowAfterUp = await scope.db.get<{ helpfulVotes: number }>(
        'SELECT helpfulVotes FROM "reviews" WHERE id = ?',
        'rev_01'
      );
      expect(Number(rowAfterUp?.helpfulVotes)).toBe(initialVotes + 1);

      // Decrement helpfulVotes back
      const downRes = await client.functions.invoke<{
        success: boolean;
        reviewId: string;
        helpfulVotes: number;
      }>('upvote-review', { reviewId: 'rev_01', delta: -1 });

      expect(downRes.success).toBe(true);
      expect(downRes.helpfulVotes).toBe(initialVotes);
    });

    it('should support sorting reviews by -created and -rating', async () => {
      const byRecent = await client.collection('reviews').getList(1, 20, {
        sort: '-created',
      });
      expect(byRecent.items.length).toBeGreaterThan(0);

      const byHighest = await client.collection('reviews').getList(1, 20, {
        sort: '-rating',
      });
      expect(byHighest.items.length).toBeGreaterThan(0);
      for (let i = 1; i < byHighest.items.length; i++) {
        expect(Number(byHighest.items[i - 1].rating)).toBeGreaterThanOrEqual(
          Number(byHighest.items[i].rating)
        );
      }
    });
  });
});
