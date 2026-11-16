import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/core/events/EventBus';

describe('EventBus Error Isolation Tests', () => {
  it('should continue executing remaining listeners when an onRecordAfterCreate listener throws', async () => {
    const bus = new EventBus();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let firstExecuted = false;
    let secondExecuted = false;

    bus.onRecordAfterCreate('posts', async () => {
      firstExecuted = true;
      throw new Error('Audit log failure in onRecordAfterCreate');
    });

    bus.onRecordAfterCreate('posts', async () => {
      secondExecuted = true;
    });

    await expect(
      bus.triggerRecordAfterCreate('posts', { id: 'rec_1', title: 'Hello' })
    ).resolves.toBeUndefined();

    expect(firstExecuted).toBe(true);
    expect(secondExecuted).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should continue executing remaining listeners when an onRecordAfterUpdate listener throws', async () => {
    const bus = new EventBus();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let firstExecuted = false;
    let secondExecuted = false;

    bus.onRecordAfterUpdate('posts', async () => {
      firstExecuted = true;
      throw new Error('Audit log failure in onRecordAfterUpdate');
    });

    bus.onRecordAfterUpdate('posts', async () => {
      secondExecuted = true;
    });

    await expect(
      bus.triggerRecordAfterUpdate(
        'posts',
        { id: 'rec_1', title: 'Updated' },
        undefined,
        undefined,
        { id: 'rec_1', title: 'Old' }
      )
    ).resolves.toBeUndefined();

    expect(firstExecuted).toBe(true);
    expect(secondExecuted).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should continue executing remaining listeners when an onRecordAfterDelete listener throws', async () => {
    const bus = new EventBus();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let firstExecuted = false;
    let secondExecuted = false;

    bus.onRecordAfterDelete('posts', async () => {
      firstExecuted = true;
      throw new Error('Audit log failure in onRecordAfterDelete');
    });

    bus.onRecordAfterDelete('posts', async () => {
      secondExecuted = true;
    });

    await expect(
      bus.triggerRecordAfterDelete('posts', { id: 'rec_1', title: 'Deleted' })
    ).resolves.toBeUndefined();

    expect(firstExecuted).toBe(true);
    expect(secondExecuted).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should continue executing remaining listeners when custom emit handler throws', async () => {
    const bus = new EventBus();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let firstExecuted = false;
    let secondExecuted = false;

    bus.on('custom:event', async () => {
      firstExecuted = true;
      throw new Error('Custom event failure');
    });

    bus.on('custom:event', async () => {
      secondExecuted = true;
    });

    await expect(bus.emit('custom:event', { foo: 'bar' })).resolves.toBeUndefined();

    expect(firstExecuted).toBe(true);
    expect(secondExecuted).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should continue executing remaining listeners when onAfterServe throws', async () => {
    const bus = new EventBus();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let firstExecuted = false;
    let secondExecuted = false;

    bus.onAfterServe(async () => {
      firstExecuted = true;
      throw new Error('After serve failure');
    });

    bus.onAfterServe(async () => {
      secondExecuted = true;
    });

    await expect(
      bus.triggerAfterServe({ server: {}, port: 8080, host: '127.0.0.1' })
    ).resolves.toBeUndefined();

    expect(firstExecuted).toBe(true);
    expect(secondExecuted).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should continue executing remaining listeners when onRecordAuthRequest throws', async () => {
    const bus = new EventBus();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let firstExecuted = false;
    let secondExecuted = false;

    bus.onRecordAuthRequest('users', async () => {
      firstExecuted = true;
      throw new Error('Auth request failure');
    });

    bus.onRecordAuthRequest('users', async () => {
      secondExecuted = true;
    });

    await expect(
      bus.triggerAuthRequest({ collection: 'users', identity: 'user@test.com' })
    ).resolves.toBeUndefined();

    expect(firstExecuted).toBe(true);
    expect(secondExecuted).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should still allow onRecordBeforeCreate to cancel or throw and prevent persistence', async () => {
    const bus = new EventBus();

    bus.onRecordBeforeCreate('posts', async (ctx) => {
      ctx.cancel('Explicit cancellation');
    });

    await expect(
      bus.triggerRecordBeforeCreate('posts', { title: 'Test' })
    ).rejects.toThrow('Explicit cancellation');
  });

  describe('NodeStack RecordService Integration with EventBus', () => {
    it('should complete DB write and fire webhooks even if audit/prior listener throws in onRecordAfterCreate', async () => {
      const { NodeStack } = await import('../src/NodeStack');
      const fs = await import('fs');
      const path = await import('path');

      const testDir = path.resolve(__dirname, '../.test_eventbus_integration');
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }

      const app = new NodeStack({
        dataDir: testDir,
        port: 8097,
      });

      app.schema.createCollection({
        name: 'posts',
        type: 'base',
        schema: [
          { id: 'f_title', name: 'title', type: 'text', required: true },
          { id: 'f_views', name: 'views', type: 'number', defaultValue: 0 },
          { id: 'f_published', name: 'published', type: 'bool', defaultValue: false },
        ],
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      let webhookFired = false;

      // 1. First listener throws (e.g. audit log failure)
      app.eventBus.onRecordAfterCreate('posts', async () => {
        throw new Error('Simulated audit log failure during afterCreate');
      });

      // 2. Second listener (e.g. webhooks)
      app.eventBus.onRecordAfterCreate('posts', async () => {
        webhookFired = true;
      });

      try {
        // Create record via RecordService
        const record = await app.records.create('posts', {
          title: 'Post With Resilient EventBus',
          views: 42,
          published: true,
        });

        expect(record).toBeDefined();
        expect(record.id).toBeDefined();
        expect(record.title).toBe('Post With Resilient EventBus');
        expect(webhookFired).toBe(true);

        // Verify DB write actually succeeded
        const fetched = await app.records.getOne('posts', record.id);
        expect(fetched.title).toBe('Post With Resilient EventBus');

        // Test afterUpdate isolation
        let updateWebhookFired = false;
        app.eventBus.onRecordAfterUpdate('posts', async () => {
          throw new Error('Simulated audit log failure during afterUpdate');
        });
        app.eventBus.onRecordAfterUpdate('posts', async () => {
          updateWebhookFired = true;
        });

        const updated = await app.records.update('posts', record.id, {
          title: 'Updated Post With Resilient EventBus',
        });
        expect(updated.title).toBe('Updated Post With Resilient EventBus');
        expect(updateWebhookFired).toBe(true);

        // Test afterDelete isolation
        let deleteWebhookFired = false;
        app.eventBus.onRecordAfterDelete('posts', async () => {
          throw new Error('Simulated audit log failure during afterDelete');
        });
        app.eventBus.onRecordAfterDelete('posts', async () => {
          deleteWebhookFired = true;
        });

        await app.records.delete('posts', record.id);
        expect(deleteWebhookFired).toBe(true);
      } finally {
        consoleErrorSpy.mockRestore();
        await app.stop();
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true, force: true });
        }
      }
    });
  });
});
