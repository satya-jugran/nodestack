import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';

describe('File Storage and Upload Integration Test', () => {
  const testDir = path.resolve(__dirname, '../.test_file_storage');
  let app: NodeStack;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    app = new NodeStack({ dataDir: testDir, port: 8098 });

    // Create collection with file field
    app.schema.createCollection({
      name: 'documents',
      type: 'base',
      schema: [
        { id: 'f_title', name: 'title', type: 'text', required: true },
        { id: 'f_file', name: 'file', type: 'file', required: false },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should save and serve files properly', async () => {
    const col = app.schema.getCollectionOrThrow('documents');
    const fileBuffer = Buffer.from('Hello, NodeStack File Storage!');
    const savedMeta = await app.files.saveFile(
      col.id,
      'rec_123',
      'test_document.txt',
      fileBuffer,
      'text/plain'
    );

    expect(savedMeta.filename).toBeDefined();
    expect(savedMeta.size).toBe(fileBuffer.length);
    expect(savedMeta.mimeType).toBe('text/plain');

    // Verify file exists on disk
    const diskPath = app.files.getFilePath(col.id, 'rec_123', savedMeta.filename);
    expect(fs.existsSync(diskPath)).toBe(true);

    const content = fs.readFileSync(diskPath, 'utf-8');
    expect(content).toBe('Hello, NodeStack File Storage!');

    // Create record referencing this file
    const rec = await app.records.create('documents', {
      id: 'rec_123',
      title: 'Report',
      file: savedMeta.filename,
    });
    expect(rec.file).toBe(savedMeta.filename);

    // Test file download via HTTP endpoint
    const res = await app.server.app.inject({
      method: 'GET',
      url: `/api/files/documents/rec_123/${savedMeta.filename}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('Hello, NodeStack File Storage!');
  });
});
