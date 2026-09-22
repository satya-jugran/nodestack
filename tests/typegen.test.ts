import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { TypeGenerator } from '../src/schema/TypeGenerator';
import { CollectionModel } from '../src/schema/models/Collection';

describe('TypeScript Definitions Generator (nodestack typegen)', () => {
  const testDir = path.join(__dirname, `../tmp_typegen_test_${Date.now()}`);

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {}
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {}
    }
  });

  describe('TypeGenerator unit tests', () => {
    it('should generate definitions for base and auth collections with various field types', () => {
      const mockCollections: CollectionModel[] = [
        {
          id: 'c_users_123',
          name: 'users',
          type: 'auth',
          system: false,
          schema: [
            { id: 'f_name', name: 'name', type: 'text', required: true },
            { id: 'f_bio', name: 'bio', type: 'text', required: false },
            { id: 'f_role', name: 'role', type: 'select', required: true, options: { values: ['admin', 'member', 'guest'] } },
          ],
          indexes: [],
          listRule: null,
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          options: {},
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-01T00:00:00Z',
        },
        {
          id: 'c_posts_456',
          name: 'posts',
          type: 'base',
          system: false,
          schema: [
            { id: 'f_title', name: 'title', type: 'text', required: true },
            { id: 'f_views', name: 'views', type: 'number', required: false },
            { id: 'f_published', name: 'published', type: 'bool', required: false },
            { id: 'f_website', name: 'website', type: 'url', required: false },
            { id: 'f_contact', name: 'contact', type: 'email', required: false },
            { id: 'f_published_at', name: 'published_at', type: 'date', required: false },
            { id: 'f_metadata', name: 'metadata', type: 'json', required: false },
            { id: 'f_cover', name: 'cover', type: 'file', required: false, options: { maxSelect: 1 } },
            { id: 'f_gallery', name: 'gallery', type: 'file', required: false, options: { maxSelect: 5 } },
            {
              id: 'f_status',
              name: 'status',
              type: 'select',
              required: true,
              options: { values: ['draft', 'review', 'published'] },
            },
            {
              id: 'f_tags',
              name: 'tags',
              type: 'select',
              required: false,
              options: { values: ['tech', 'news', 'lifestyle'], maxSelect: 3 },
            },
            {
              id: 'f_author',
              name: 'author',
              type: 'relation',
              required: true,
              options: { collectionId: 'c_users_123' },
            },
            {
              id: 'f_reviewers',
              name: 'reviewers',
              type: 'relation',
              required: false,
              options: { collectionId: 'users', maxSelect: 5 },
            },
          ],
          indexes: [],
          listRule: null,
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          options: {},
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-01T00:00:00Z',
        },
      ];

      const ts = TypeGenerator.generateFromCollections(mockCollections);

      // Verify Base System Types exist
      expect(ts).toContain('export interface BaseSystemFields');
      expect(ts).toContain('export interface AuthSystemFields extends BaseSystemFields');
      expect(ts).toContain('export interface AdminModel extends BaseSystemFields');
      expect(ts).toContain('export interface ListResult<T = any>');

      // Verify Users (Auth) Collection
      expect(ts).toContain('export interface UsersRecord extends AuthSystemFields');
      expect(ts).toContain('name: string;');
      expect(ts).toContain('bio?: string;');
      expect(ts).toContain("export type UsersRoleOptions = 'admin' | 'member' | 'guest';");
      expect(ts).toContain('role: UsersRoleOptions;');
      expect(ts).toContain('export type UsersExpand = Record<string, unknown>;');
      expect(ts).toContain('export type UsersResponse<TExpand = unknown> = UsersRecord & {');

      // Verify Posts Collection
      expect(ts).toContain('export interface PostsRecord extends BaseSystemFields');
      expect(ts).toContain('title: string;');
      expect(ts).toContain('views?: number;');
      expect(ts).toContain('published?: boolean;');
      expect(ts).toContain('website?: string;');
      expect(ts).toContain('contact?: string;');
      expect(ts).toContain('published_at?: string;');
      expect(ts).toContain('metadata?: any;');
      expect(ts).toContain('cover?: string;');
      expect(ts).toContain('gallery?: string[];');
      expect(ts).toContain("export type PostsStatusOptions = 'draft' | 'review' | 'published';");
      expect(ts).toContain('status: PostsStatusOptions;');
      expect(ts).toContain("export type PostsTagsOptions = 'tech' | 'news' | 'lifestyle';");
      expect(ts).toContain('tags?: PostsTagsOptions[];');
      expect(ts).toContain('author: string;');
      expect(ts).toContain('reviewers?: string[];');

      // Verify Relations Expand
      expect(ts).toContain('export type PostsExpand = {');
      expect(ts).toContain('author?: UsersResponse;');
      expect(ts).toContain('reviewers?: UsersResponse[];');
      expect(ts).toContain('export type PostsResponse<TExpand = PostsExpand> = PostsRecord & {');

      // Verify Schema Collections Map
      expect(ts).toContain('export interface SchemaCollections {');
      expect(ts).toContain('users: UsersRecord;');
      expect(ts).toContain('posts: PostsRecord;');
      expect(ts).toContain('export interface SchemaCollectionResponses {');
      expect(ts).toContain('users: UsersResponse;');
      expect(ts).toContain('posts: PostsResponse;');
      expect(ts).toContain('export type Collections = SchemaCollections;');
      expect(ts).toContain('export type CollectionResponses = SchemaCollectionResponses;');
      expect(ts).toContain('export type CollectionName = keyof SchemaCollections;');
      expect(ts).toContain('export type TypedRecord<T extends CollectionName> = CollectionResponses[T];');
    });

    it('should format special field names and property identifiers safely', () => {
      const mockCollections: CollectionModel[] = [
        {
          id: 'c_hyphen_col',
          name: 'user-events',
          type: 'base',
          system: false,
          schema: [
            { id: 'f_event_name', name: 'event-name', type: 'text', required: true },
            { id: 'f_num', name: '24h_count', type: 'number', required: false },
          ],
          indexes: [],
          listRule: null,
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          options: {},
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-01T00:00:00Z',
        },
      ];

      const ts = TypeGenerator.generateFromCollections(mockCollections);
      expect(ts).toContain('export interface UserEventsRecord extends BaseSystemFields');
      expect(ts).toContain('"event-name": string;');
      expect(ts).toContain('"24h_count"?: number;');
      expect(ts).toContain('"user-events": UserEventsRecord;');
    });
  });

  describe('Integration with NodeStack & HTTP Server', () => {
    let app: NodeStack;

    beforeEach(async () => {
      app = new NodeStack({
        dataDir: testDir,
        port: 0,
      });

      // Create a test collection
      app.schema.createCollection({
        name: 'articles',
        schema: [
          { id: 'f_title', name: 'title', type: 'text', required: true },
          { id: 'f_content', name: 'content', type: 'text', required: false },
          {
            id: 'f_author',
            name: 'author',
            type: 'relation',
            required: false,
            options: { collectionId: 'users' },
          },
        ],
      });
    });

    afterEach(async () => {
      await app.server.close();
      app.db.close();
    });

    it('should generate types via app.generateTypes()', () => {
      const types = app.generateTypes();
      expect(types).toContain('export interface ArticlesRecord extends BaseSystemFields');
      expect(types).toContain('title: string;');
      expect(types).toContain('content?: string;');
      expect(types).toContain('author?: string;');
      expect(types).toContain('author?: UsersResponse;');
      expect(tsCheckHasCollection(types, 'articles')).toBe(true);
      expect(tsCheckHasCollection(types, 'users')).toBe(true);
    });

    it('should serve generated types via GET /_/types.d.ts', async () => {
      const res = await app.server.app.inject({
        method: 'GET',
        url: '/_/types.d.ts',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.body).toContain('export interface ArticlesRecord extends BaseSystemFields');
      expect(res.body).toContain('export interface UsersRecord extends AuthSystemFields');
    });

    it('should serve generated types via GET /api/types.d.ts and /api/types', async () => {
      const res1 = await app.server.app.inject({
        method: 'GET',
        url: '/api/types.d.ts',
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.body).toContain('export interface ArticlesRecord extends BaseSystemFields');

      const res2 = await app.server.app.inject({
        method: 'GET',
        url: '/api/types',
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.body).toContain('export interface ArticlesRecord extends BaseSystemFields');
    });
  });

  describe('CLI typegen command', () => {
    it('should generate types to file with --out flag', async () => {
      const cliTestDir = path.join(testDir, 'cli_test_out');
      fs.mkdirSync(cliTestDir, { recursive: true });

      // Set up a database in cliTestDir
      const app = new NodeStack({ dataDir: cliTestDir });
      app.schema.createCollection({
        name: 'notes',
        schema: [{ id: 'f_text', name: 'text', type: 'text', required: true }],
      });
      app.db.close();

      const outFile = path.join(cliTestDir, 'generated-types.ts');

      // Run CLI in-process
      const { runCli } = await import('../src/cli/cli');
      await runCli(['node', 'nodestack', 'typegen', '-d', cliTestDir, '-o', outFile]);

      expect(fs.existsSync(outFile)).toBe(true);
      const content = fs.readFileSync(outFile, 'utf-8');
      expect(content).toContain('export interface NotesRecord extends BaseSystemFields');
      expect(content).toContain('text: string;');
    });

    it('should output types to stdout when --out is not provided', async () => {
      const cliTestDir = path.join(testDir, 'cli_test_stdout');
      fs.mkdirSync(cliTestDir, { recursive: true });

      const app = new NodeStack({ dataDir: cliTestDir });
      app.schema.createCollection({
        name: 'snippets',
        schema: [{ id: 'f_code', name: 'code', type: 'text', required: true }],
      });
      app.db.close();

      let stdoutOutput = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdoutOutput += chunk.toString();
        return true;
      }) as any;

      try {
        const { runCli } = await import('../src/cli/cli');
        await runCli(['node', 'nodestack', 'typegen', '-d', cliTestDir]);
      } finally {
        process.stdout.write = originalWrite;
      }

      expect(stdoutOutput).toContain('export interface SnippetsRecord extends BaseSystemFields');
      expect(stdoutOutput).toContain('code: string;');
    });
  });
});

function tsCheckHasCollection(content: string, name: string): boolean {
  return content.includes(`${name}: `);
}
