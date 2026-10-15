import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { NodeStack } from '../src/NodeStack';
import { INodeStackPlugin } from '../src/core/plugins/types';
import { loadEnvFile } from '../src/core/config/EnvLoader';

describe('Plugin Configuration & Option B Strict DevOps Precedence', () => {
  const testDataDir = path.resolve(__dirname, '../.test_plugin_config_data');
  const testEnvPath = path.resolve(testDataDir, '.test_env');
  let app: NodeStack;

  beforeEach(() => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDataDir, { recursive: true });
  });

  afterEach(async () => {
    if (app) {
      await app.stop();
    }
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
    delete process.env.TEST_PLUGIN_LOCKED_KEY;
    delete process.env.TEST_PLUGIN_DISCORD_URL;
  });

  it('should auto-load environment variables using loadEnvFile()', () => {
    const envContent = `
# Sample comment
TEST_PLUGIN_LOCKED_KEY="super_secret_env_value"
TEST_PLUGIN_DISCORD_URL=https://discord.com/api/webhooks/test
`;
    fs.writeFileSync(testEnvPath, envContent, 'utf8');

    expect(process.env.TEST_PLUGIN_LOCKED_KEY).toBeUndefined();
    const loaded = loadEnvFile(testEnvPath);

    expect(loaded).toBe(true);
    expect(process.env.TEST_PLUGIN_LOCKED_KEY).toBe('super_secret_env_value');
    expect(process.env.TEST_PLUGIN_DISCORD_URL).toBe('https://discord.com/api/webhooks/test');
  });

  it('should lock fields configured via environment variables (source: env)', () => {
    process.env.TEST_PLUGIN_LOCKED_KEY = 'live_env_key_12345';

    app = new NodeStack({ dataDir: testDataDir, port: 8201 });

    const samplePlugin: INodeStackPlugin = {
      name: 'test-env-plugin',
      version: '1.0.0',
      configSchema: {
        fields: [
          {
            name: 'apiKey',
            label: 'API Key',
            type: 'password',
            envKey: 'TEST_PLUGIN_LOCKED_KEY',
          },
          {
            name: 'unlockedParam',
            label: 'Unlocked Parameter',
            type: 'text',
            envKey: 'NON_EXISTENT_ENV_KEY',
            defaultValue: 'default_val',
          },
        ],
      },
    };

    app.use(samplePlugin);

    const config = app.pluginManager.getPluginConfig('test-env-plugin');
    expect(config.hasConfig).toBe(true);

    const apiKeyField = config.fields.find((f) => f.name === 'apiKey');
    expect(apiKeyField).toBeDefined();
    expect(apiKeyField?.isLocked).toBe(true);
    expect(apiKeyField?.source).toBe('env');
    expect(apiKeyField?.lockReason).toContain('TEST_PLUGIN_LOCKED_KEY');
    expect(apiKeyField?.maskedValue).toBeDefined();
    expect(apiKeyField?.value).toBeUndefined();
    expect(apiKeyField?.hasValue).toBe(true);

    const unlockedField = config.fields.find((f) => f.name === 'unlockedParam');
    expect(unlockedField).toBeDefined();
    expect(unlockedField?.isLocked).toBe(false);
    expect(unlockedField?.source).toBe('default');
    expect(unlockedField?.value).toBe('default_val');
  });

  it('should treat codeOptions as editable defaults rather than hard locks (source: code, isLocked: false)', async () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8202 });

    const samplePlugin: INodeStackPlugin = {
      name: 'test-code-plugin',
      version: '1.0.0',
      codeOptions: {
        bucket: 'demo-media',
      },
      configSchema: {
        fields: [
          {
            name: 'bucket',
            label: 'Bucket Name',
            type: 'text',
            envKey: 'S3_BUCKET_NOT_IN_ENV',
          },
          {
            name: 'channel',
            label: 'Channel',
            type: 'text',
            defaultValue: '#general',
          },
        ],
      },
    };

    app.use(samplePlugin);

    // Initial inspection: bucket reflects code fallback, but is NOT locked
    const config = app.pluginManager.getPluginConfig('test-code-plugin');
    const bucketField = config.fields.find((f) => f.name === 'bucket');
    expect(bucketField?.value).toBe('demo-media');
    expect(bucketField?.isLocked).toBe(false);
    expect(bucketField?.source).toBe('code');

    // Admin UI can override code defaults without 400 error!
    const updated = await app.pluginManager.updatePluginConfig('test-code-plugin', {
      bucket: 'production-overridden-bucket',
    });
    const updatedBucket = updated.fields.find((f) => f.name === 'bucket');
    expect(updatedBucket?.value).toBe('production-overridden-bucket');
    expect(updatedBucket?.source).toBe('db');
    expect(updatedBucket?.isLocked).toBe(false);
  });

  it('should reject modifications to locked fields with 400 Bad Request', async () => {
    process.env.TEST_PLUGIN_LOCKED_KEY = 'strictly_locked_env';

    app = new NodeStack({ dataDir: testDataDir, port: 8203 });

    const samplePlugin: INodeStackPlugin = {
      name: 'test-lock-enforcement',
      version: '1.0.0',
      configSchema: {
        fields: [
          {
            name: 'lockedField',
            label: 'Locked Field',
            type: 'text',
            envKey: 'TEST_PLUGIN_LOCKED_KEY',
          },
        ],
      },
    };

    app.use(samplePlugin);

    await expect(
      app.pluginManager.updatePluginConfig('test-lock-enforcement', {
        lockedField: 'malicious_override',
      })
    ).rejects.toThrow(/is locked by/);
  });

  it('should allow modifying unlocked fields, persist to SQLite, and fire onConfigUpdate', async () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8204 });

    let hotUpdatedConfig: any = null;

    const samplePlugin: INodeStackPlugin = {
      name: 'test-editable-plugin',
      version: '1.0.0',
      configSchema: {
        fields: [
          {
            name: 'webhookUrl',
            label: 'Webhook URL',
            type: 'text',
            envKey: 'DISCORD_NOT_SET',
            defaultValue: 'https://default.url',
          },
          {
            name: 'retryCount',
            label: 'Retry Count',
            type: 'number',
            defaultValue: 3,
          },
          {
            name: 'enabled',
            label: 'Enabled',
            type: 'boolean',
            defaultValue: false,
          },
        ],
      },
      onConfigUpdate(newCfg) {
        hotUpdatedConfig = newCfg;
      },
    };

    app.use(samplePlugin);

    // Initial state before update
    const initial = app.pluginManager.getPluginConfig('test-editable-plugin');
    expect(initial.fields.find((f) => f.name === 'webhookUrl')?.value).toBe('https://default.url');

    // Update via Admin UI API
    const updated = await app.pluginManager.updatePluginConfig('test-editable-plugin', {
      webhookUrl: 'https://custom-webhook.io/hook',
      retryCount: 5,
      enabled: true,
    });

    // Check returned updated structure
    const updatedUrl = updated.fields.find((f) => f.name === 'webhookUrl');
    expect(updatedUrl?.value).toBe('https://custom-webhook.io/hook');
    expect(updatedUrl?.source).toBe('db');
    expect(updatedUrl?.isLocked).toBe(false);

    // Check onConfigUpdate hot reload was triggered
    expect(hotUpdatedConfig).toBeDefined();
    expect(hotUpdatedConfig.webhookUrl).toBe('https://custom-webhook.io/hook');
    expect(hotUpdatedConfig.retryCount).toBe(5);
    expect(hotUpdatedConfig.enabled).toBe(true);

    // Verify persistence in SQLite _plugin_settings table directly
    const row = app.db.get<any>('SELECT settings FROM _plugin_settings WHERE pluginName = ?', [
      'test-editable-plugin',
    ]);
    expect(row).toBeDefined();
    const parsed = JSON.parse(row.settings);
    expect(parsed.webhookUrl).toBe('https://custom-webhook.io/hook');
    expect(parsed.retryCount).toBe(5);
    expect(parsed.enabled).toBe(true);
  });

  it('should omit raw password values from responses and support write-only/unchanged-secret updates', async () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8205 });

    let latestRuntimeConfig: any = null;

    const samplePlugin: INodeStackPlugin = {
      name: 'test-secret-plugin',
      version: '1.0.0',
      codeOptions: {
        apiKey: 'initial_secret_token_12345',
        endpoint: 'https://api.service.io',
      },
      configSchema: {
        fields: [
          {
            name: 'apiKey',
            label: 'API Key Secret',
            type: 'password',
            envKey: 'SERVICE_API_KEY_UNSET',
          },
          {
            name: 'endpoint',
            label: 'API Endpoint',
            type: 'text',
          },
        ],
      },
      onConfigUpdate(config) {
        latestRuntimeConfig = config;
      },
    };

    app.use(samplePlugin);

    // 1. Verify getPluginConfig omits raw secret value
    const configResponse = app.pluginManager.getPluginConfig('test-secret-plugin');
    const secretField = configResponse.fields.find((f) => f.name === 'apiKey');
    expect(secretField).toBeDefined();
    expect(secretField?.value).toBeUndefined(); // Raw secret NEVER exposed!
    expect(secretField?.hasValue).toBe(true);
    expect(secretField?.maskedValue).toBe('••••••••');
    expect(secretField?.isLocked).toBe(false);

    // 2. Verify getEffectiveConfig provides raw secret to internal runtime
    const effective = app.pluginManager.getEffectiveConfig('test-secret-plugin');
    expect(effective.apiKey).toBe('initial_secret_token_12345');
    expect(effective.endpoint).toBe('https://api.service.io');

    // 3. Test unchanged-secret update: update endpoint without sending apiKey (or sending empty string)
    const updated1 = await app.pluginManager.updatePluginConfig('test-secret-plugin', {
      endpoint: 'https://new-api.service.io',
      apiKey: '', // Empty string in UI indicates "leave unchanged"
    });

    const secretAfterUpdate1 = updated1.fields.find((f) => f.name === 'apiKey');
    expect(secretAfterUpdate1?.value).toBeUndefined(); // Still omitted
    expect(secretAfterUpdate1?.hasValue).toBe(true); // Still has value

    const effective1 = app.pluginManager.getEffectiveConfig('test-secret-plugin');
    expect(effective1.apiKey).toBe('initial_secret_token_12345'); // Preserved!
    expect(effective1.endpoint).toBe('https://new-api.service.io');
    expect(latestRuntimeConfig.apiKey).toBe('initial_secret_token_12345');

    // 4. Test explicit secret rotation / write-only update: send a new secret
    const updated2 = await app.pluginManager.updatePluginConfig('test-secret-plugin', {
      apiKey: 'rotated_new_secret_99999',
    });

    const secretAfterUpdate2 = updated2.fields.find((f) => f.name === 'apiKey');
    expect(secretAfterUpdate2?.value).toBeUndefined(); // Still omitted from response!
    expect(secretAfterUpdate2?.hasValue).toBe(true);

    const effective2 = app.pluginManager.getEffectiveConfig('test-secret-plugin');
    expect(effective2.apiKey).toBe('rotated_new_secret_99999'); // Successfully rotated!
    expect(latestRuntimeConfig.apiKey).toBe('rotated_new_secret_99999');
  });

  it('should enforce allowed choices for select fields, preserve typed values, and reject arbitrary text with 400', async () => {
    app = new NodeStack({ dataDir: testDataDir, port: 8206 });

    let latestRuntimeConfig: any = null;

    const samplePlugin: INodeStackPlugin = {
      name: 'test-select-plugin',
      version: '1.0.0',
      configSchema: {
        fields: [
          {
            name: 'region',
            label: 'Region',
            type: 'select',
            required: true,
            options: [
              { label: 'US East (N. Virginia)', value: 'us-east-1' },
              { label: 'EU West (Ireland)', value: 'eu-west-1' },
              { label: 'Asia Pacific (Tokyo)', value: 'ap-northeast-1' },
            ],
          },
          {
            name: 'pageSize',
            label: 'Page Size',
            type: 'select',
            defaultValue: 25,
            options: [
              { label: '10 items', value: 10 },
              { label: '25 items', value: 25 },
              { label: '50 items', value: 50 },
            ],
          },
        ],
      },
      onConfigUpdate(config) {
        latestRuntimeConfig = config;
      },
    };

    app.use(samplePlugin);

    // 1. When defaultValue is omitted on required select field, should fall back to first option
    const initialConfig = app.pluginManager.getPluginConfig('test-select-plugin');
    const regionField = initialConfig.fields.find((f) => f.name === 'region');
    expect(regionField?.value).toBe('us-east-1');
    expect(regionField?.source).toBe('default');

    const pageSizeField = initialConfig.fields.find((f) => f.name === 'pageSize');
    expect(pageSizeField?.value).toBe(25);

    // 2. Valid update: updating allowed choice succeeds and preserves original types (e.g. number 50)
    const updated = await app.pluginManager.updatePluginConfig('test-select-plugin', {
      region: 'eu-west-1',
      pageSize: '50', // UI sends string via HTML select
    });

    const updatedRegion = updated.fields.find((f) => f.name === 'region');
    expect(updatedRegion?.value).toBe('eu-west-1');
    expect(updatedRegion?.source).toBe('db');

    const updatedPageSize = updated.fields.find((f) => f.name === 'pageSize');
    expect(updatedPageSize?.value).toBe(50); // Preserved typed number!
    expect(typeof updatedPageSize?.value).toBe('number');

    const effective = app.pluginManager.getEffectiveConfig('test-select-plugin');
    expect(effective.region).toBe('eu-west-1');
    expect(effective.pageSize).toBe(50);
    expect(latestRuntimeConfig.region).toBe('eu-west-1');
    expect(latestRuntimeConfig.pageSize).toBe(50);

    // 3. Choice enforcement: arbitrary text rejected with 400 Bad Request
    await expect(
      app.pluginManager.updatePluginConfig('test-select-plugin', {
        region: 'invalid-region-injection',
      })
    ).rejects.toThrow(/Invalid value "invalid-region-injection" for select field "region"/);

    // 4. Required empty value rejected with 400 Bad Request
    await expect(
      app.pluginManager.updatePluginConfig('test-select-plugin', {
        region: '',
      })
    ).rejects.toThrow(/Field "region" is required/);
  });
});


