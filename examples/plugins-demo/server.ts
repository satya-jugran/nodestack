import * as path from 'path';
import * as fs from 'fs';
import {
  NodeStack,
  stripePlugin,
  s3StoragePlugin,
  resendPlugin,
  webhookPlugin,
  algoliaPlugin,
} from '../../src';

async function bootstrap() {
  const dataDir = path.resolve(__dirname, 'demo_data');
  const port = Number(process.env.PORT) || 8090;

  console.log('\n======================================================');
  console.log('   🚀 Starting NodeStack Plugins Showcase Demo Server   ');
  console.log('======================================================\n');

  const app = new NodeStack({
    dataDir,
    port,
  });

  // 1. Mount Official Community Extensions
  app.use(
    stripePlugin({
      secretKey: process.env.STRIPE_SECRET_KEY || 'sk_test_demo_mock_key_1234567890',
      currency: 'usd',
    })
  );

  app.use(
    s3StoragePlugin({
      bucket: process.env.S3_BUCKET || 'demo-media',
      region: process.env.S3_REGION || 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
      forcePathStyle: true,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'DEMO_ACCESS_KEY',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'DEMO_SECRET_KEY',
    })
  );

  app.use(
    resendPlugin({
      apiKey: process.env.RESEND_API_KEY || 're_demo_mock_key_123456789',
      from: 'demo@nodestack.io',
      dryRun: true,
    })
  );

  app.use(
    webhookPlugin({
      discordWebhookUrl:
        process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/demo/mock-discord-channel',
      slackWebhookUrl:
        process.env.SLACK_WEBHOOK_URL || 'https://hooks.slack.com/services/demo/mock-slack-channel',
      collections: ['support_tickets', 'products'],
      dryRun: true,
    })
  );

  app.use(
    algoliaPlugin({
      appId: process.env.ALGOLIA_APP_ID || 'DEMO_APP',
      apiKey: process.env.ALGOLIA_API_KEY || 'DEMO_API_KEY',
      collections: ['products'],
      dryRun: true,
      autoProcessIntervalMs: 5000,
    })
  );

  // 2. Register Demo App Portal Link in Admin UI Sidebar
  app.use({
    name: 'demo-portal-launcher',
    version: '1.0.0',
    description: 'Direct shortcut to the user-facing demo testing application',
    adminNavItems: [
      {
        id: 'demo-portal',
        title: 'Demo App Portal',
        badge: 'OPEN',
        badgeVariant: 'primary',
        path: '/demo/',
        target: '_blank',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
      },
    ],
  });

  // 3. Serve User-Facing Demo HTML at /demo/ and /demo/*
  const demoHtmlPath = path.resolve(__dirname, 'public/index.html');
  const serveDemo = async (_req: any, reply: any) => {
    if (fs.existsSync(demoHtmlPath)) {
      reply.type('text/html').send(fs.readFileSync(demoHtmlPath, 'utf8'));
    } else {
      reply.status(404).send('Demo page not found');
    }
  };

  app.router.get('/demo', serveDemo);
  app.router.get('/demo/', serveDemo);
  app.router.get('/demo/*', serveDemo);

  // 4. Pre-seed database schema & demo records
  if (!app.schema.getCollection('support_tickets')) {
    app.schema.createCollection({
      name: 'support_tickets',
      type: 'base',
      schema: [
        { id: 'f_title', name: 'title', type: 'text', required: true },
        { id: 'f_priority', name: 'priority', type: 'text', required: true },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });
  }

  if (!app.schema.getCollection('products')) {
    app.schema.createCollection({
      name: 'products',
      type: 'base',
      schema: [
        { id: 'f_name', name: 'name', type: 'text', required: true },
        { id: 'f_price', name: 'price', type: 'number', required: true },
        { id: 'f_category', name: 'category', type: 'text' },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });
  }

  // Pre-seed products if collection is empty
  const products = await app.records.getList('products', { perPage: 1 });
  if (products.totalItems === 0) {
    console.log('📦 Seeding sample products...');
    await app.records.create('products', {
      name: 'Mechanical Keyboard Pro',
      price: 14900,
      category: 'Hardware',
    });
    await app.records.create('products', {
      name: 'Wireless Noise-Canceling Headphones',
      price: 29900,
      category: 'Audio',
    });
    await app.records.create('products', {
      name: 'Ultra-wide Ergonomic Monitor 34"',
      price: 49900,
      category: 'Displays',
    });
    await app.records.create('products', {
      name: 'Dual 4K USB-C Docking Station',
      price: 8900,
      category: 'Accessories',
    });
  }

  // Pre-seed admin user if none exists
  if (!app.auth.hasAdmins()) {
    console.log('👤 Seeding default admin account (admin@nodestack.io)...');
    await app.auth.createAdmin('admin@nodestack.io', 'Password123!');
  }

  // 5. Start server
  await app.start();

  console.log('\n------------------------------------------------------');
  console.log(`  🎉 NodeStack Demo Server is READY!`);
  console.log(`  🌐 Interactive Demo App : http://localhost:${port}/demo/`);
  console.log(`  🛠️  Admin UI Control Panel: http://localhost:${port}/_/`);
  console.log(`  👤 Admin Credentials    : admin@nodestack.io / Password123!`);
  console.log('------------------------------------------------------\n');
}

bootstrap().catch((err) => {
  console.error('Fatal error starting demo server:', err);
  process.exit(1);
});
