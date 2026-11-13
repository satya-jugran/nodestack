import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { RecordValidator } from '../src/records/RecordValidator';
import { buildContentDispositionHeader } from '../src/http/controllers/BaseController';

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

  it('should reject multipart creation when invalid id is supplied and preserve valid supplied id', async () => {
    // 1. Multipart with invalid id=../../evil should be rejected with 422
    const boundary = '----TestBoundary12345';
    const invalidMultipart = [
      `--${boundary}\r\nContent-Disposition: form-data; name="id"\r\n\r\n../../evil\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nHack Attempt\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hack.txt"\r\nContent-Type: text/plain\r\n\r\nPayload\r\n`,
      `--${boundary}--\r\n`,
    ].join('');

    const resInvalid = await app.server.app.inject({
      method: 'POST',
      url: '/api/collections/documents/records',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: invalidMultipart,
    });

    expect(resInvalid.statusCode).toBe(422);
    expect(resInvalid.json().message).toMatch(/prohibited characters/i);

    // 2. Multipart with valid custom id should preserve the identifier
    const validBoundary = '----TestBoundaryValid';
    const validMultipart = [
      `--${validBoundary}\r\nContent-Disposition: form-data; name="id"\r\n\r\ncustom_multipart_123\r\n`,
      `--${validBoundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nPreserved Document\r\n`,
      `--${validBoundary}\r\nContent-Disposition: form-data; name="file"; filename="doc.txt"\r\nContent-Type: text/plain\r\n\r\nHello World\r\n`,
      `--${validBoundary}--\r\n`,
    ].join('');

    const resValid = await app.server.app.inject({
      method: 'POST',
      url: '/api/collections/documents/records',
      headers: {
        'content-type': `multipart/form-data; boundary=${validBoundary}`,
      },
      payload: validMultipart,
    });

    expect(resValid.statusCode).toBe(201);
    const body = resValid.json();
    expect(body.id).toBe('custom_multipart_123');
    expect(body.title).toBe('Preserved Document');
    expect(body.file).toBeDefined();

    // Verify file path on disk used the preserved custom ID
    const col = app.schema.getCollectionOrThrow('documents');
    const diskPath = app.files.getFilePath(col.id, 'custom_multipart_123', body.file);
    expect(fs.existsSync(diskPath)).toBe(true);
  });

  it('should attach security headers and enforce Content-Disposition: attachment on untrusted active content', async () => {
    const col = app.schema.getCollectionOrThrow('documents');

    // 1. Upload .html file with script
    const htmlMeta = await app.files.saveFile(
      col.id,
      'rec_sec_1',
      'malicious.html',
      Buffer.from('<script>alert("xss")</script>'),
      'text/html'
    );
    await app.records.create('documents', {
      id: 'rec_sec_1',
      title: 'HTML Doc',
      file: htmlMeta.filename,
    });

    const resHtml = await app.server.app.inject({
      method: 'GET',
      url: `/api/files/documents/rec_sec_1/${htmlMeta.filename}`,
    });

    expect(resHtml.statusCode).toBe(200);
    expect(resHtml.headers['content-type']).toBe('text/html');
    expect(resHtml.headers['content-security-policy']).toBe("default-src 'none'");
    expect(resHtml.headers['x-content-type-options']).toBe('nosniff');
    expect(resHtml.headers['content-disposition']).toBe(
      `attachment; filename="${htmlMeta.filename}"; filename*=UTF-8''${htmlMeta.filename}`
    );

    // 2. Upload .svg file
    const svgMeta = await app.files.saveFile(
      col.id,
      'rec_sec_2',
      'vector.svg',
      Buffer.from('<svg onload="alert(1)"></svg>'),
      'image/svg+xml'
    );
    await app.records.create('documents', {
      id: 'rec_sec_2',
      title: 'SVG Doc',
      file: svgMeta.filename,
    });

    const resSvg = await app.server.app.inject({
      method: 'GET',
      url: `/api/files/documents/rec_sec_2/${svgMeta.filename}`,
    });

    expect(resSvg.statusCode).toBe(200);
    expect(resSvg.headers['content-type']).toBe('image/svg+xml');
    expect(resSvg.headers['content-security-policy']).toBe("default-src 'none'");
    expect(resSvg.headers['x-content-type-options']).toBe('nosniff');
    expect(resSvg.headers['content-disposition']).toBe(
      `attachment; filename="${svgMeta.filename}"; filename*=UTF-8''${svgMeta.filename}`
    );

    // 3. Upload .xml and .htm files
    const xmlMeta = await app.files.saveFile(
      col.id,
      'rec_sec_3',
      'data.xml',
      Buffer.from('<xml></xml>'),
      'application/xml'
    );
    await app.records.create('documents', {
      id: 'rec_sec_3',
      title: 'XML Doc',
      file: xmlMeta.filename,
    });

    const resXml = await app.server.app.inject({
      method: 'GET',
      url: `/api/files/documents/rec_sec_3/${xmlMeta.filename}`,
    });

    expect(resXml.statusCode).toBe(200);
    expect(resXml.headers['content-type']).toBe('application/xml');
    expect(resXml.headers['content-security-policy']).toBe("default-src 'none'");
    expect(resXml.headers['x-content-type-options']).toBe('nosniff');
    expect(resXml.headers['content-disposition']).toBe(
      `attachment; filename="${xmlMeta.filename}"; filename*=UTF-8''${xmlMeta.filename}`
    );

    // 4. Safe file (.txt) without ?download=1 should not enforce attachment
    const txtMeta = await app.files.saveFile(
      col.id,
      'rec_sec_4',
      'safe.txt',
      Buffer.from('plain text'),
      'text/plain'
    );
    await app.records.create('documents', {
      id: 'rec_sec_4',
      title: 'Plain Text Doc',
      file: txtMeta.filename,
    });

    const resTxt = await app.server.app.inject({
      method: 'GET',
      url: `/api/files/documents/rec_sec_4/${txtMeta.filename}`,
    });

    expect(resTxt.statusCode).toBe(200);
    expect(resTxt.headers['content-type']).toBe('text/plain');
    expect(resTxt.headers['content-security-policy']).toBe("default-src 'none'");
    expect(resTxt.headers['x-content-type-options']).toBe('nosniff');
    expect(resTxt.headers['content-disposition']).toBeUndefined();

    // 5. Safe file (.txt) with ?download=1 should have attachment
    const resTxtDownload = await app.server.app.inject({
      method: 'GET',
      url: `/api/files/documents/rec_sec_4/${txtMeta.filename}?download=1`,
    });

    expect(resTxtDownload.statusCode).toBe(200);
    expect(resTxtDownload.headers['content-disposition']).toBe(
      `attachment; filename="${txtMeta.filename}"; filename*=UTF-8''${txtMeta.filename}`
    );
  });

  it('should sanitize control characters and apply RFC 5987/6266 encoding in Content-Disposition headers', async () => {
    // 1. Direct helper checks for header injection payloads (quotes, CRLF, NUL, DEL, Unicode line seps)
    const injected = buildContentDispositionHeader('evil"\r\nX-Injected: pwned\x00\x1f\x7f\u2028\u2029.html');
    expect(injected).not.toMatch(/[\r\n\x00-\x1f\x7f\u2028\u2029]/);
    expect(injected).toBe(
      `attachment; filename="evil_X-Injected: pwned.html"; filename*=UTF-8''evil%22X-Injected%3A%20pwned.html`
    );

    // 2. RFC 5987 encoding of non-ASCII UTF-8 and attr-char exclusions (' ( ) * !)
    const unicodeHeader = buildContentDispositionHeader("résumé (2026)'*!.pdf");
    expect(unicodeHeader).toBe(
      `attachment; filename="r_sum_ (2026)'*!.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%282026%29%27%2A%21.pdf`
    );

    // 3. Semicolons and backslashes sanitized in quoted fallback, fallback on empty/dot names
    const semiHeader = buildContentDispositionHeader('a;b\\c.txt');
    expect(semiHeader).toBe(`attachment; filename="a_b_c.txt"; filename*=UTF-8''a%3Bb_c.txt`);
    expect(buildContentDispositionHeader('\r\n\x00')).toBe(
      `attachment; filename="download"; filename*=UTF-8''download`
    );
    expect(buildContentDispositionHeader('..')).toBe(
      `attachment; filename="download"; filename*=UTF-8''download`
    );

    // 4. End-to-end HTTP download with special RFC 5987 and UTF-8 characters in filename
    const col = app.schema.getCollectionOrThrow('documents');
    const specialName = "résumé (final)'s;copy.txt";
    await app.files.writeRecordFile(col.id, 'rec_sec_utf8', specialName, Buffer.from('utf8 content'));
    await app.records.create('documents', {
      id: 'rec_sec_utf8',
      title: 'UTF8 Doc',
      file: specialName,
    });

    const resUtf8 = await app.server.app.inject({
      method: 'GET',
      url: `/api/files/documents/rec_sec_utf8/${encodeURIComponent(specialName)}?download=1`,
    });

    expect(resUtf8.statusCode).toBe(200);
    expect(resUtf8.headers['content-disposition']).toBe(
      `attachment; filename="r_sum_ (final)'s_copy.txt"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%28final%29%27s%3Bcopy.txt`
    );
  });

  it('should safely store and retrieve files via store() and retrieve()', async () => {
    const col = app.schema.getCollectionOrThrow('documents');
    const content = Buffer.from('Safe storage file content 123');

    // 4-arg store & retrieve (appId, collection, recordId, filename)
    const storedPath = await app.files.store('app1', col.id, 'rec_100', 'note.txt', content);
    expect(fs.existsSync(storedPath)).toBe(true);

    const retrieved = await app.files.retrieve('app1', col.id, 'rec_100', 'note.txt');
    expect(retrieved.toString('utf-8')).toBe('Safe storage file content 123');

    // 3-arg store & retrieve (collection, recordId, filename)
    await app.files.store(col.id, 'rec_101', 'data.json', '{"status":"ok"}');
    const retrieved3 = await app.files.retrieve(col.id, 'rec_101', 'data.json');
    expect(retrieved3.toString('utf-8')).toBe('{"status":"ok"}');
  });

  it('should reject path traversal, null bytes, and separators in retrieve() and store()', async () => {
    const col = app.schema.getCollectionOrThrow('documents');
    const payload = Buffer.from('malicious payload');

    // Traversal payloads
    const traversalFilenames = [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32',
      '..',
      '.',
      'sub/file.txt',
      'sub\\file.txt',
      'exploit.txt\0.png',
      '\0hack',
    ];

    for (const badFilename of traversalFilenames) {
      await expect(
        app.files.retrieve('app1', col.id, 'rec_safe', badFilename)
      ).rejects.toThrow(/prohibited path traversal characters/i);

      await expect(
        app.files.retrieve(col.id, 'rec_safe', badFilename)
      ).rejects.toThrow(/prohibited path traversal characters/i);

      await expect(
        app.files.store('app1', col.id, 'rec_safe', badFilename, payload)
      ).rejects.toThrow(/prohibited path traversal characters/i);

      await expect(
        app.files.store(col.id, 'rec_safe', badFilename, payload)
      ).rejects.toThrow(/prohibited path traversal characters/i);
    }

    // Traversal in appId, collection, and recordId
    await expect(
      app.files.retrieve('../../evil_app', col.id, 'rec_safe', 'file.txt')
    ).rejects.toThrow(/prohibited path traversal characters/i);

    await expect(
      app.files.retrieve('app1', '../../evil_col', 'rec_safe', 'file.txt')
    ).rejects.toThrow(/prohibited path traversal characters/i);

    await expect(
      app.files.retrieve('app1', col.id, '../../evil_rec', 'file.txt')
    ).rejects.toThrow(/prohibited path traversal characters/i);

    await expect(
      app.files.store('../../evil_app', col.id, 'rec_safe', 'file.txt', payload)
    ).rejects.toThrow(/prohibited path traversal characters/i);

    await expect(
      app.files.store('app1', col.id, '../../evil_rec', 'file.txt', payload)
    ).rejects.toThrow(/prohibited path traversal characters/i);
  });

  it('should verify baseDir property and validate path containment with path.resolve()', async () => {
    expect(app.files.baseDir).toBeDefined();
    expect(typeof app.files.baseDir).toBe('string');
    expect(app.files.baseDir).toBe(app.files.storageDir);

    // validatePathComponent direct check
    expect(() => app.files.validatePathComponent('../secret', 'filename')).toThrow(
      /prohibited path traversal characters/i
    );
    expect(() => app.files.validatePathComponent('foo\0bar', 'filename')).toThrow(
      /prohibited path traversal characters/i
    );
    expect(() => app.files.validatePathComponent('dir/file', 'filename')).toThrow(
      /prohibited path traversal characters/i
    );
    expect(() => app.files.validatePathComponent('dir\\file', 'filename')).toThrow(
      /prohibited path traversal characters/i
    );
    expect(app.files.validatePathComponent('valid-file_123.pdf', 'filename')).toBe(
      'valid-file_123.pdf'
    );
  });
});
