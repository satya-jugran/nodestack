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
      const apps = server.apps.list();
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

    it('should prevent deletion of the ecommerce-demo application', async () => {
      await expect(server.apps.delete('ecommerce-demo')).rejects.toThrow(
        /Cannot delete the default or built-in demo application/
      );
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
      const users = await scope.records.getList('users', { filter: "email = 'alex.vance@nodestack.dev'" });
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
  });

  describe('3. Serverless Functions (Lambdas)', () => {
    it('should register all 6 e-commerce serverless functions', () => {
      const scope = server.apps.get('ecommerce-demo');
      const functions = scope.functions.getAllFunctions();
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
    it('should register OrderFulfillmentFlow and CheckoutPromotionFlow', () => {
      const scope = server.apps.get('ecommerce-demo');
      const flows = scope.flows.getAllFlows();
      const flowNames = flows.map((f) => f.name);

      expect(flowNames).toContain('OrderFulfillmentFlow');
      expect(flowNames).toContain('CheckoutPromotionFlow');

      const fulfillment = scope.flows.getFlowByName('OrderFulfillmentFlow');
      expect(fulfillment).toBeDefined();
      expect(fulfillment?.triggerType).toBe('event');
      expect(fulfillment?.eventTrigger).toBe('orders:create');

      const promo = scope.flows.getFlowByName('CheckoutPromotionFlow');
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
      const flow = scope.flows.getFlowByName('OrderFulfillmentFlow');
      expect(flow).toBeDefined();

      for (let attempt = 0; attempt < 25; attempt++) {
        await new Promise((r) => setTimeout(r, 200));
        const executions = scope.flows.getExecutions({ flowId: flow!.id });
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

      // 4. Attempting to create order without user relation fails
      await expect(
        client.collection('orders').create({
          orderNumber: 'ORD-SECURITY-NOUSER',
          customerName: 'No User',
          customerEmail: 'nouser@bad.com',
          shippingAddress: '123 Fake St',
          total: 50.0,
          status: 'pending',
          items: JSON.stringify([]),
        })
      ).rejects.toThrow();
    });
  });
});
