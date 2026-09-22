import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { OpenApiGenerator } from '../src/schema/OpenApiGenerator';
import { CollectionModel } from '../src/schema/models/Collection';

describe('OpenAPI 3.0 Specification & Interactive Viewer Tests', () => {
  const testDir = path.resolve(__dirname, '../.test_openapi_data');
  let app: NodeStack;

  beforeAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    app = new NodeStack({
      dataDir: testDir,
      port: 8101,
      appName: 'NodeStack Docs Test',
    });
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('OpenApiGenerator (Pure Generator Unit Tests)', () => {
    const mockCollections: CollectionModel[] = [
      {
        id: 'col_articles',
        name: 'articles',
        type: 'base',
        system: false,
        schema: [
          { id: 'f_title', name: 'title', type: 'text', required: true },
          { id: 'f_content', name: 'content', type: 'text' },
          { id: 'f_views', name: 'views', type: 'number', defaultValue: 0, options: { min: 0, max: 1000000 } },
          { id: 'f_published', name: 'published', type: 'bool', defaultValue: false },
          { id: 'f_contact_email', name: 'contact_email', type: 'email' },
          { id: 'f_website', name: 'website', type: 'url' },
          { id: 'f_publish_date', name: 'publish_date', type: 'date' },
          {
            id: 'f_status',
            name: 'status',
            type: 'select',
            options: { values: ['draft', 'review', 'published'] },
          },
          {
            id: 'f_tags',
            name: 'tags',
            type: 'select',
            options: { values: ['tech', 'news', 'lifestyle'], maxSelect: 5 },
          },
          { id: 'f_metadata', name: 'metadata', type: 'json' },
          { id: 'f_cover', name: 'cover', type: 'file' },
          { id: 'f_gallery', name: 'gallery', type: 'file', options: { maxSelect: 10 } },
          { id: 'f_author', name: 'author', type: 'relation', options: { collectionId: 'users' } },
        ],
        indexes: [],
        listRule: '', // public
        viewRule: '', // public
        createRule: '@request.auth.id != ""', // authenticated
        updateRule: 'author = @request.auth.id',
        deleteRule: null, // admin only
        options: {},
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'col_users',
        name: 'users',
        type: 'auth',
        system: true,
        schema: [
          { id: 'f_name', name: 'name', type: 'text', required: true },
          { id: 'f_avatar', name: 'avatar', type: 'file' },
        ],
        indexes: [],
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: '', // public signup
        updateRule: 'id = @request.auth.id',
        deleteRule: null,
        options: {},
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
      },
    ];

    it('should generate a valid OpenAPI 3.0.3 specification structure', () => {
      const spec = OpenApiGenerator.generateFromCollections(mockCollections, {
        title: 'Custom Test API',
        version: '1.2.3',
      });

      expect(spec.openapi).toBe('3.0.3');
      expect(spec.info.title).toBe('Custom Test API');
      expect(spec.info.version).toBe('1.2.3');
      expect(spec.servers).toBeDefined();
      expect(spec.paths).toBeDefined();
      expect(spec.components?.schemas).toBeDefined();
      expect(spec.components?.securitySchemes?.BearerAuth).toBeDefined();
    });

    it('should map collection schemas and field types properly', () => {
      const spec = OpenApiGenerator.generateFromCollections(mockCollections);
      const schemas = spec.components.schemas;

      // Check Articles schemas
      expect(schemas.ArticlesRecord).toBeDefined();
      expect(schemas.ArticlesCreate).toBeDefined();
      expect(schemas.ArticlesUpdate).toBeDefined();
      expect(schemas.ArticlesListResult).toBeDefined();

      const artProps = schemas.ArticlesRecord.properties;
      expect(artProps.id.type).toBe('string');
      expect(artProps.title.type).toBe('string');
      expect(artProps.views.type).toBe('number');
      expect(artProps.views.minimum).toBe(0);
      expect(artProps.views.maximum).toBe(1000000);
      expect(artProps.published.type).toBe('boolean');
      expect(artProps.contact_email.format).toBe('email');
      expect(artProps.website.format).toBe('uri');
      expect(artProps.publish_date.format).toBe('date-time');
      expect(artProps.status.enum).toEqual(['draft', 'review', 'published']);
      expect(artProps.tags.type).toBe('array');
      expect(artProps.tags.items.enum).toEqual(['tech', 'news', 'lifestyle']);
      expect(artProps.metadata.type).toBe('object');
      expect(artProps.cover.type).toBe('string');
      expect(artProps.gallery.type).toBe('array');
      expect(artProps.author.type).toBe('string');
      expect(artProps.expand.type).toBe('object');

      // Check required fields on Create
      expect(schemas.ArticlesCreate.required).toContain('title');

      // Check Users schemas (auth type)
      expect(schemas.UsersRecord).toBeDefined();
      expect(schemas.UsersCreate).toBeDefined();
      expect(schemas.UsersAuthResponse).toBeDefined();

      const userProps = schemas.UsersRecord.properties;
      expect(userProps.email.format).toBe('email');
      expect(userProps.emailVisibility.type).toBe('boolean');
      expect(userProps.verified.type).toBe('boolean');
      expect(userProps.name.type).toBe('string');

      // Passwords are write-only on create
      expect(schemas.UsersCreate.properties.password.writeOnly).toBe(true);
      expect(schemas.UsersCreate.required).toContain('email');
      expect(schemas.UsersCreate.required).toContain('password');
    });

    it('should generate CRUD paths and file upload schemas', () => {
      const spec = OpenApiGenerator.generateFromCollections(mockCollections);
      const paths = spec.paths;

      // GET /api/collections/articles/records
      const listOp = paths['/api/collections/articles/records']?.get;
      expect(listOp).toBeDefined();
      expect(listOp.summary).toBe('List articles records');
      expect(listOp.description).toContain('Public');
      expect(listOp.parameters.some((p: any) => p.name === 'page')).toBe(true);
      expect(listOp.parameters.some((p: any) => p.name === 'filter')).toBe(true);
      expect(listOp.parameters.some((p: any) => p.name === 'sort')).toBe(true);
      expect(listOp.parameters.some((p: any) => p.name === 'expand')).toBe(true);

      // POST /api/collections/articles/records (should have multipart/form-data for file fields)
      const createOp = paths['/api/collections/articles/records']?.post;
      expect(createOp).toBeDefined();
      expect(createOp.requestBody.content['application/json']).toBeDefined();
      expect(createOp.requestBody.content['multipart/form-data']).toBeDefined();
      const multipartProps = createOp.requestBody.content['multipart/form-data'].schema.properties;
      expect(multipartProps.cover.format).toBe('binary');
      expect(multipartProps.gallery.items.format).toBe('binary');

      // GET /api/collections/articles/records/{id}
      const getOp = paths['/api/collections/articles/records/{id}']?.get;
      expect(getOp).toBeDefined();

      // PATCH /api/collections/articles/records/{id}
      const patchOp = paths['/api/collections/articles/records/{id}']?.patch;
      expect(patchOp).toBeDefined();

      // DELETE /api/collections/articles/records/{id}
      const deleteOp = paths['/api/collections/articles/records/{id}']?.delete;
      expect(deleteOp).toBeDefined();
      expect(deleteOp.description).toContain('Admin only');

      // Auth endpoint for users collection
      const authOp = paths['/api/collections/users/auth-with-password']?.post;
      expect(authOp).toBeDefined();
      expect(authOp.summary).toContain('Authenticate users record');
    });

    it('should generate standard system endpoints and security definitions', () => {
      const spec = OpenApiGenerator.generateFromCollections(mockCollections);
      const paths = spec.paths;

      expect(paths['/api/health']?.get).toBeDefined();
      expect(paths['/api/settings']?.get).toBeDefined();
      expect(paths['/api/admins/has-admins']?.get).toBeDefined();
      expect(paths['/api/admins/create-initial']?.post).toBeDefined();
      expect(paths['/api/admins/auth-with-password']?.post).toBeDefined();
      expect(paths['/api/admins/me']?.get).toBeDefined();
      expect(paths['/api/collections']?.get).toBeDefined();
      expect(paths['/api/collections']?.post).toBeDefined();
      expect(paths['/api/collections/{collection}']?.patch).toBeDefined();
      expect(paths['/api/files/{collection}/{recordId}/{filename}']?.get).toBeDefined();
      expect(paths['/api/realtime']?.get).toBeDefined();
      expect(paths['/api/realtime']?.post).toBeDefined();
      expect(paths['/api/logs']?.get).toBeDefined();
      expect(paths['/api/types']?.get).toBeDefined();
      expect(paths['/api/openapi.json']?.get).toBeDefined();
    });
  });

  describe('NodeStack Programmatic API & HTTP Server Endpoints', () => {
    it('should generate OpenAPI object and JSON via app methods', () => {
      const spec = app.generateOpenApi();
      expect(spec.openapi).toBe('3.0.3');
      expect(spec.info.title).toContain('NodeStack');

      const jsonStr = app.generateOpenApiJson(true);
      expect(typeof jsonStr).toBe('string');
      const parsed = JSON.parse(jsonStr);
      expect(parsed.openapi).toBe('3.0.3');
    });

    it('should serve OpenAPI 3.0 JSON via GET /api/openapi.json, /_/openapi.json, and /api/openapi', async () => {
      // 1. /api/openapi.json
      const res1 = await app.server.app.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.headers['content-type']).toContain('application/json');
      const data1 = JSON.parse(res1.payload);
      expect(data1.openapi).toBe('3.0.3');
      expect(data1.paths['/api/health']).toBeDefined();

      // 2. /_/openapi.json
      const res2 = await app.server.app.inject({
        method: 'GET',
        url: '/_/openapi.json',
      });
      expect(res2.statusCode).toBe(200);
      const data2 = JSON.parse(res2.payload);
      expect(data2.openapi).toBe('3.0.3');

      // 3. /api/openapi
      const res3 = await app.server.app.inject({
        method: 'GET',
        url: '/api/openapi',
      });
      expect(res3.statusCode).toBe(200);
      const data3 = JSON.parse(res3.payload);
      expect(data3.openapi).toBe('3.0.3');
    });

    it('should serve interactive Scalar documentation viewer at GET /_/docs and /_/docs/', async () => {
      const res = await app.server.app.inject({
        method: 'GET',
        url: '/_/docs',
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.payload).toContain('Interactive API Reference');
      expect(res.payload).toContain('@scalar/api-reference');
      expect(res.payload).toContain('/api/openapi.json');
      expect(res.payload).toContain('Scalar');
      expect(res.payload).toContain('Swagger UI');

      // Trailing slash
      const resSlash = await app.server.app.inject({
        method: 'GET',
        url: '/_/docs/',
      });
      expect(resSlash.statusCode).toBe(200);
      expect(resSlash.payload).toContain('Interactive API Reference');
    });

    it('should serve Swagger UI viewer when requested via GET /_/docs?ui=swagger', async () => {
      const res = await app.server.app.inject({
        method: 'GET',
        url: '/_/docs?ui=swagger',
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.payload).toContain('swagger-ui-bundle.js');
      expect(res.payload).toContain('swagger-ui');
      expect(res.payload).toContain('/api/openapi.json');
    });

    it('should redirect /api/docs and /api/docs/ to /_/docs', async () => {
      const res = await app.server.app.inject({
        method: 'GET',
        url: '/api/docs',
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/_/docs');

      const resSlash = await app.server.app.inject({
        method: 'GET',
        url: '/api/docs/',
      });
      expect(resSlash.statusCode).toBe(302);
      expect(resSlash.headers.location).toBe('/_/docs');
    });

    it('should dynamically update OpenAPI spec when a new collection is created', async () => {
      // Create collection 'products'
      app.schema.createCollection({
        name: 'products',
        type: 'base',
        schema: [
          { id: 'f_p_name', name: 'product_name', type: 'text', required: true },
          { id: 'f_p_price', name: 'price', type: 'number', defaultValue: 0 },
        ],
        listRule: '',
        viewRule: '',
      });

      // Request live OpenAPI spec
      const res = await app.server.app.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });
      expect(res.statusCode).toBe(200);
      const spec = JSON.parse(res.payload);

      // Verify 'products' collection is immediately present in paths and schemas
      expect(spec.paths['/api/collections/products/records']).toBeDefined();
      expect(spec.paths['/api/collections/products/records/{id}']).toBeDefined();
      expect(spec.components.schemas.ProductsRecord).toBeDefined();
      expect(spec.components.schemas.ProductsRecord.properties.product_name.type).toBe('string');
      expect(spec.components.schemas.ProductsRecord.properties.price.type).toBe('number');
    });
  });

  describe('CLI openapi command', () => {
    it('should generate OpenAPI JSON to a file via CLI', async () => {
      const tmpOut = path.resolve(__dirname, `../tmp_openapi_test_${Date.now()}.json`);
      const { runCli } = await import('../src/cli/cli');

      await runCli([
        'node',
        'nodestack',
        'openapi',
        '-d',
        testDir,
        '-o',
        tmpOut,
      ]);

      expect(fs.existsSync(tmpOut)).toBe(true);
      const content = fs.readFileSync(tmpOut, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.openapi).toBe('3.0.3');
      expect(parsed.paths['/api/health']).toBeDefined();

      fs.unlinkSync(tmpOut);
    });
  });
});
