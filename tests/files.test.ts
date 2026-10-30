import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { RecordValidator } from '../src/records/RecordValidator';

describe('File Storage and Upload Integration Test', () => {
  const testDir = path.resolve(__dirname, '../.test_file_storage');
  let app: NodeStack;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    app = new NodeStack({ dataDir: testDir, port: 8096 });

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

  it('should reject path traversal attempts in recordId and collectionId', async () => {
    const col = app.schema.getCollectionOrThrow('documents');
    const fileBuffer = Buffer.from('malicious payload');

    await expect(
      app.files.saveFile(col.id, '../../etc', 'hack.txt', fileBuffer, 'text/plain')
    ).rejects.toThrow(/prohibited path traversal characters/i);

    await expect(
      app.files.saveFile('../../evil', 'rec_123', 'hack.txt', fileBuffer, 'text/plain')
    ).rejects.toThrow(/prohibited path traversal characters/i);

    expect(() => {
      app.files.getFilePath(col.id, '../../etc', 'passwd');
    }).toThrow();
  });

  it('should reject path traversal in record creation ID', async () => {
    await expect(
      app.records.create('documents', {
        id: '../../evil_record',
        title: 'Exploit',
      })
    ).rejects.toThrow(/Record ID must only contain alphanumeric/i);
  });

  it('should safely write record files via writeRecordFile and reject traversal', async () => {
    const col = app.schema.getCollectionOrThrow('documents');
    const content = Buffer.from('<svg>avatar</svg>');

    // Valid write
    const writtenPath = await app.files.writeRecordFile(col.id, 'rec_123', 'avatar_custom.svg', content);
    expect(fs.existsSync(writtenPath)).toBe(true);
    expect(fs.readFileSync(writtenPath, 'utf-8')).toBe('<svg>avatar</svg>');

    // Reject traversal in collectionId
    await expect(
      app.files.writeRecordFile('../../../etc', 'rec_123', 'avatar.svg', content)
    ).rejects.toThrow(/prohibited path traversal characters/i);

    // Reject traversal in recordId
    await expect(
      app.files.writeRecordFile(col.id, '../../etc', 'avatar.svg', content)
    ).rejects.toThrow(/prohibited path traversal characters/i);

    // Reject invalid filename
    await expect(
      app.files.writeRecordFile(col.id, 'rec_123', '..', content)
    ).rejects.toThrow(/invalid filename/i);
  });

  it('should reject invalid collection ID in schema createCollection', async () => {
    expect(() => {
      app.schema.createCollection({
        id: '../../evil_col',
        name: 'evil_col',
        type: 'base',
        schema: [],
      });
    }).toThrow(/Collection ID must only contain alphanumeric characters/i);
  });

  it('should reject invalid record ID in importRecords', async () => {
    // With continueOnError: false, it throws ValidationError
    await expect(
      app.records.importRecords(
        'documents',
        [{ id: '../../evil_import', title: 'Malicious Row' }],
        undefined,
        { continueOnError: false }
      )
    ).rejects.toThrow(/prohibited characters/i);

    // With continueOnError: true (default), it reports row failure without inserting
    const res = await app.records.importRecords('documents', [
      { id: '../../evil_import_soft', title: 'Malicious Row' },
    ]);
    expect(res.success).toBe(false);
    expect(res.failed).toBe(1);
    expect(res.imported).toBe(0);
    expect(res.errors[0].error).toMatch(/prohibited characters/i);
  });

  it('should dynamically heal declared avatar safely and reject unvalidated record paths', async () => {
    // Create record with declared missing avatar
    const userRec = await app.records.create('documents', {
      id: 'rec_user_avatar',
      title: 'Alice',
      file: 'avatar_alice.png',
    });
    expect(userRec.id).toBe('rec_user_avatar');

    // Fetch through HTTP file endpoint: should trigger dynamic healing safely
    const res = await app.server.app.inject({
      method: 'GET',
      url: `/api/files/documents/rec_user_avatar/avatar_alice.png`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');

    // Confirm file was written inside storage directory
    const col = app.schema.getCollectionOrThrow('documents');
    const diskPath = app.files.getFilePath(col.id, 'rec_user_avatar', 'avatar_alice.png');
    expect(fs.existsSync(diskPath)).toBe(true);

    // Endpoint should reject path traversal in recordId with 404
    const maliciousRes = await app.server.app.inject({
      method: 'GET',
      url: `/api/files/documents/..%2F..%2Fetc/avatar_alice.png`,
    });
    expect(maliciousRes.statusCode).toBe(404);
  });

  it('should validate and extract record IDs via RecordValidator.validateRecordId', () => {
    expect(RecordValidator.validateRecordId(undefined)).toBeUndefined();
    expect(RecordValidator.validateRecordId(null)).toBeUndefined();
    expect(RecordValidator.validateRecordId('')).toBeUndefined();
    expect(RecordValidator.validateRecordId('   ')).toBeUndefined();
    expect(RecordValidator.validateRecordId('valid_rec-123')).toBe('valid_rec-123');

    expect(() => RecordValidator.validateRecordId('../../etc')).toThrow(/prohibited characters/i);
    expect(() => RecordValidator.validateRecordId('rec/hack')).toThrow(/prohibited characters/i);
    expect(() => RecordValidator.validateRecordId('rec\\hack')).toThrow(/prohibited characters/i);
    expect(() => RecordValidator.validateRecordId('rec.hack')).toThrow(/prohibited characters/i);
  });

  it('should tolerate invalid recordId gracefully in deleteRecordFiles without crashing deletion', async () => {
    const col = app.schema.getCollectionOrThrow('documents');
    await expect(app.files.deleteRecordFiles(col.id, '../../nonexistent')).resolves.not.toThrow();
    await expect(app.files.deleteFile(col.id, '../../nonexistent', 'avatar.png')).resolves.not.toThrow();
  });
});