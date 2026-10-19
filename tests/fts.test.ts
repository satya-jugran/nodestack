import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { sanitizeFtsQuery } from '../src/records/FtsService';
import { NodeStackClient } from '../packages/client/src';

describe('Full-Text Search Engine with SQLite FTS5', () => {
  let app: NodeStack;
  let testDataDir: string;
  const PORT = 8421;

  beforeEach(async () => {
    testDataDir = path.join(__dirname, `../nb_fts_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }

    app = new NodeStack({
      dataDir: testDataDir,
      port: PORT,
    });
  });

  afterEach(async () => {
    try {
      await app.stop();
    } catch {}
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('1. FTS5 Virtual Table & Trigger Lifecycle', () => {
    it('should automatically create FTS5 virtual table and sync triggers when creating collection with text fields', () => {
      const col = app.schema.createCollection({
        name: 'posts',
        schema: [
          { id: 'f1', name: 'title', type: 'text' },
          { id: 'f2', name: 'content', type: 'text' },
          { id: 'f3', name: 'views', type: 'number' },
        ],
      });

      // Verify FTS table exists
      expect(app.fts.hasFtsIndex('posts')).toBe(true);
      expect(app.fts.getFtsTableName('posts')).toBe('_fts_posts');

      // Verify columns in FTS table (only text fields: title, content; views is omitted)
      const cols = app.fts.getFtsIndexColumns('posts');
      expect(cols).toEqual(['title', 'content']);

      // Verify triggers exist in sqlite_master
      const triggers = app.db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '_fts_posts_%'"
      );
      const triggerNames = triggers.map((t) => t.name).sort();
      expect(triggerNames).toEqual(['_fts_posts_ad', '_fts_posts_ai', '_fts_posts_au']);
    });

    it('should automatically index records on insert via AFTER INSERT trigger', async () => {
      app.schema.createCollection({
        name: 'articles',
        listRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
        viewRule: '',
        schema: [
          { id: 'f1', name: 'title', type: 'text' },
          { id: 'f2', name: 'body', type: 'text' },
        ],
      });

      const rec = await app.records.create('articles', {
        title: 'Building a Full-Text Search Engine',
        body: 'SQLite FTS5 delivers fast token stemming and BM25 relevance ranking in TypeScript backends.',
      });

      // Direct inspection of FTS5 table
      const indexed = app.db.get<any>('SELECT * FROM _fts_articles WHERE id = ?', [rec.id]);
      expect(indexed).toBeDefined();
      expect(indexed.id).toBe(rec.id);
      expect(indexed.title).toBe('Building a Full-Text Search Engine');
      expect(indexed.body).toContain('SQLite FTS5 delivers fast token stemming');
    });

    it('should automatically update FTS index on update via AFTER UPDATE trigger', async () => {
      app.schema.createCollection({
        name: 'notes',
        listRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
        viewRule: '',
        schema: [
          { id: 'f1', name: 'title', type: 'text' },
          { id: 'f2', name: 'content', type: 'text' },
        ],
      });

      const rec = await app.records.create('notes', {
        title: 'Initial Note Title',
        content: 'Original draft content',
      });

      await app.records.update('notes', rec.id, {
        title: 'Updated Note Title with TypeScript',
        content: 'Refined production backend content',
      });

      const indexed = app.db.get<any>('SELECT * FROM _fts_notes WHERE id = ?', [rec.id]);
      expect(indexed.title).toBe('Updated Note Title with TypeScript');
      expect(indexed.content).toBe('Refined production backend content');

      // Verify old terms no longer match
      const oldMatches = app.db.all('SELECT * FROM _fts_notes WHERE _fts_notes MATCH ?', ['"Initial"']);
      expect(oldMatches.length).toBe(0);

      // Verify new terms match
      const newMatches = app.db.all('SELECT * FROM _fts_notes WHERE _fts_notes MATCH ?', ['"TypeScript"']);
      expect(newMatches.length).toBe(1);
    });

    it('should automatically delete FTS row on delete via AFTER DELETE trigger', async () => {
      app.schema.createCollection({
        name: 'todos',
        listRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
        viewRule: '',
        schema: [{ id: 'f1', name: 'task', type: 'text' }],
      });

      const rec = await app.records.create('todos', {
        task: 'Implement SQLite full-text search',
      });

      expect(app.db.all('SELECT * FROM _fts_todos WHERE id = ?', [rec.id]).length).toBe(1);

      await app.records.delete('todos', rec.id);

      expect(app.db.all('SELECT * FROM _fts_todos WHERE id = ?', [rec.id]).length).toBe(0);
    });

    it('should respect fts: false to exclude specific text fields from FTS indexing', () => {
      app.schema.createCollection({
        name: 'users_profile',
        schema: [
          { id: 'f1', name: 'bio', type: 'text' },
          { id: 'f2', name: 'internalNote', type: 'text', fts: false },
        ],
      });

      const cols = app.fts.getFtsIndexColumns('users_profile');
      expect(cols).toEqual(['bio']);
      expect(cols).not.toContain('internalNote');
    });

    it('should drop FTS table and triggers when collection is deleted', () => {
      app.schema.createCollection({
        name: 'temp_docs',
        schema: [{ id: 'f1', name: 'content', type: 'text' }],
      });

      expect(app.fts.hasFtsIndex('temp_docs')).toBe(true);

      app.schema.deleteCollection('temp_docs');

      expect(app.fts.hasFtsIndex('temp_docs')).toBe(false);
      const remainingTriggers = app.db.all(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '_fts_temp_docs_%'"
      );
      expect(remainingTriggers.length).toBe(0);
    });

    it('should migrate FTS table and triggers when collection is renamed', async () => {
      const col = app.schema.createCollection({
        name: 'draft_posts',
        listRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
        viewRule: '',
        schema: [{ id: 'f1', name: 'title', type: 'text' }],
      });

      await app.records.create('draft_posts', {
        title: 'Draft Post Title for FTS',
      });

      expect(app.fts.hasFtsIndex('draft_posts')).toBe(true);

      app.schema.updateCollection(col.id, {
        name: 'published_posts',
      });

      expect(app.fts.hasFtsIndex('draft_posts')).toBe(false);
      expect(app.fts.hasFtsIndex('published_posts')).toBe(true);

      // Verify records are accessible via the new FTS table
      const matches = app.db.all('SELECT * FROM _fts_published_posts WHERE _fts_published_posts MATCH ?', ['"Draft"']);
      expect(matches.length).toBe(1);
    });

    it('should reject collection creation when schema uses reserved search metadata names', () => {
      // 1. _score
      expect(() => {
        app.schema.createCollection({
          name: 'invalid_score_col',
          schema: [{ id: 'f1', name: '_score', type: 'number' }],
        });
      }).toThrow(/reserved for search metadata/i);

      // 2. _snippet
      expect(() => {
        app.schema.createCollection({
          name: 'invalid_snippet_col',
          schema: [{ id: 'f2', name: '_snippet', type: 'text' }],
        });
      }).toThrow(/reserved for search metadata/i);

      // 3. _snippets
      expect(() => {
        app.schema.createCollection({
          name: 'invalid_snippets_col',
          schema: [{ id: 'f3', name: '_snippets', type: 'json' }],
        });
      }).toThrow(/reserved for search metadata/i);

      // 4. _snippet_<field> prefix
      expect(() => {
        app.schema.createCollection({
          name: 'invalid_snippet_prefix_col',
          schema: [{ id: 'f4', name: '_snippet_title', type: 'text' }],
        });
      }).toThrow(/reserved for search metadata/i);

      // 5. Internal __fts_ prefix
      expect(() => {
        app.schema.createCollection({
          name: 'invalid_fts_prefix_col',
          schema: [{ id: 'f5', name: '__fts_rank', type: 'number' }],
        });
      }).toThrow(/reserved for search metadata/i);

      // 6. SQLite FTS5 reserved column names 'rank' and 'rowid' with explicit fts: true
      expect(() => {
        app.schema.createCollection({
          name: 'invalid_rank_col',
          schema: [{ id: 'f6', name: 'rank', type: 'text', fts: true }],
        });
      }).toThrow(/reserved SQLite FTS5 column name/i);

      // Verify that invalid_rank_col was NOT created in SQLite or _collections
      expect(app.schema.getCollection('invalid_rank_col')).toBeUndefined();
      const rankTable = app.db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'invalid_rank_col'");
      expect(rankTable).toBeUndefined();

      expect(() => {
        app.schema.createCollection({
          name: 'invalid_rowid_col',
          schema: [{ id: 'f7', name: 'rowid', type: 'text', fts: true }],
        });
      }).toThrow(/reserved SQLite FTS5 column name/i);
      expect(app.schema.getCollection('invalid_rowid_col')).toBeUndefined();
    });

    it('should rollback collection creation transaction if FTS setup fails', () => {
      // Spy on syncCollection and force it to throw
      const originalSync = app.fts.syncCollection.bind(app.fts);
      const syncSpy = vi.spyOn(app.fts, 'syncCollection').mockImplementationOnce(() => {
        throw new Error('Simulated SQLite FTS5 virtual table provisioning failure');
      });

      expect(() => {
        app.schema.createCollection({
          name: 'atomic_rollback_test',
          schema: [{ id: 'f1', name: 'headline', type: 'text' }],
        });
      }).toThrow(/Simulated SQLite FTS5 virtual table provisioning failure/);

      // Verify base table was rolled back and does NOT exist
      const tableCheck = app.db.get(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'atomic_rollback_test'"
      );
      expect(tableCheck).toBeUndefined();

      // Verify _collections row was rolled back and does NOT exist
      expect(app.schema.getCollection('atomic_rollback_test')).toBeUndefined();

      syncSpy.mockRestore();
    });

    it('should reject schema updates that add reserved search metadata names', () => {
      const col = app.schema.createCollection({
        name: 'valid_articles',
        schema: [{ id: 'f1', name: 'title', type: 'text' }],
      });

      expect(() => {
        app.schema.updateCollection(col.id, {
          schema: [
            { id: 'f1', name: 'title', type: 'text' },
            { id: 'f2', name: '_snippet_body', type: 'text' },
          ],
        });
      }).toThrow(/reserved for search metadata/i);

      expect(() => {
        app.schema.updateCollection(col.id, {
          schema: [
            { id: 'f1', name: 'title', type: 'text' },
            { id: 'f3', name: 'rank', type: 'text', fts: true },
          ],
        });
      }).toThrow(/reserved SQLite FTS5 column name/i);
    });

    it('should reject schema inference overrides that collide with reserved search metadata', async () => {
      const payload = [{ title: 'Doc 1', score_val: 10 }];

      await expect(
        app.schemaInference.importJson({
          name: 'inference_override_collision',
          data: payload,
          schemaOverrides: [{ oldName: 'score_val', name: '_score' }],
        })
      ).rejects.toThrow(/reserved for search metadata/i);
    });
  });

  describe('2. Query Sanitization & Robustness', () => {
    it('should safely normalize and sanitize tricky user inputs without throwing syntax errors', () => {
      expect(sanitizeFtsQuery('typescript backend')).toBe('"typescript" "backend"');
      expect(sanitizeFtsQuery('typescript+backend')).toBe('"typescript" "backend"');
      expect(sanitizeFtsQuery('  spaces   around   ')).toBe('"spaces" "around"');
      expect(sanitizeFtsQuery('c++')).toBe('"c"');
      expect(sanitizeFtsQuery('hello: world')).toBe('"hello" "world"');
      expect(sanitizeFtsQuery('"exact phrase" test')).toBe('"exact phrase" "test"');
      expect(sanitizeFtsQuery('prefix*')).toBe('"prefix"*');
      expect(sanitizeFtsQuery('unbalanced"quotes')).toBe('"unbalancedquotes"');
      expect(sanitizeFtsQuery('brackets [test] (yes)')).toBe('"brackets" "test" "yes"');
      expect(sanitizeFtsQuery('')).toBe('');
      expect(sanitizeFtsQuery('   ')).toBe('');
      expect(sanitizeFtsQuery('+++')).toBe('');
    });
  });

  describe('3. Full-Text Search via RecordService & HTTP API', () => {
    beforeEach(async () => {
      app.schema.createCollection({
        name: 'posts',
        listRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
        viewRule: '',
        schema: [
          { id: 'f1', name: 'title', type: 'text' },
          { id: 'f2', name: 'content', type: 'text' },
          { id: 'f3', name: 'status', type: 'text' },
          { id: 'f4', name: 'viewCount', type: 'number' },
        ],
      });

      // Seed diverse posts for testing search, BM25 ranking, stemming, and snippets
      await app.records.create('posts', {
        id: 'post_high_relevance',
        title: 'TypeScript Backend Engineering with SQLite FTS5',
        content: 'Building a modern typescript backend stack using SQLite and full-text search. TypeScript backend developers love fast search engines.',
        status: 'published',
        viewCount: 1500,
      });

      await app.records.create('posts', {
        id: 'post_single_mention',
        title: 'Frontend Frameworks Comparison',
        content: 'We briefly discuss how the frontend connects to a typescript API service.',
        status: 'published',
        viewCount: 800,
      });

      await app.records.create('posts', {
        id: 'post_draft_backend',
        title: 'Draft Architecture Notes',
        content: 'Internal ideas for typescript backend microservices.',
        status: 'draft',
        viewCount: 100,
      });

      await app.records.create('posts', {
        id: 'post_stemming_doc',
        title: 'High-Performance Database Engine',
        content: 'The database optimization engine processes queries and develops efficient plans for developers.',
        status: 'published',
        viewCount: 2200,
      });

      await app.start();
    });

    it('should search records with search query param and return BM25 relevance score ordering', async () => {
      const client = new NodeStackClient(`http://127.0.0.1:${PORT}`);

      const res = await client.collection('posts').getList(1, 10, {
        search: 'typescript backend',
      });

      expect(res.totalItems).toBe(2); // post_high_relevance and post_draft_backend
      expect(res.items.length).toBe(2);

      // Post with higher term density across title and content should rank first
      expect(res.items[0].id).toBe('post_high_relevance');
      expect(res.items[0]._score).toBeDefined();
      expect(typeof res.items[0]._score).toBe('number');
      // In SQLite FTS5, BM25 returns negative values where lower/more negative = higher relevance
      expect(res.items[0]._score).toBeLessThanOrEqual(res.items[1]._score);
    });

    it('should generate highlighted snippets across fields and provide best snippet', async () => {
      const client = new NodeStackClient(`http://127.0.0.1:${PORT}`);

      const res = await client.collection('posts').getList(1, 10, {
        search: 'typescript backend',
      });

      const topResult = res.items[0];
      expect(topResult._snippet).toBeDefined();
      expect(topResult._snippet).toContain('<mark>');
      expect(topResult._snippet).toContain('</mark>');

      expect(topResult._snippets).toBeDefined();
      expect(topResult._snippets.title).toContain('<mark>TypeScript</mark>');
      expect(topResult._snippets.title).toContain('<mark>Backend</mark>');
      expect(topResult._snippets.content).toContain('<mark>typescript</mark>');
      expect(topResult._snippets.content).toContain('<mark>backend</mark>');
    });

    it('should support token stemming with Porter stemmer (e.g. engines -> engine, developing -> develops)', async () => {
      const client = new NodeStackClient(`http://127.0.0.1:${PORT}`);

      // Search for plural "engines", which should stem and match singular "engine"
      const resStem1 = await client.collection('posts').getList(1, 10, {
        search: 'engines',
      });
      expect(resStem1.totalItems).toBeGreaterThanOrEqual(1);
      const foundStem1 = resStem1.items.some((item) => item.id === 'post_stemming_doc');
      expect(foundStem1).toBe(true);

      // Search for "developing", which should stem and match "develops" / "developers"
      const resStem2 = await client.collection('posts').getList(1, 10, {
        search: 'developing',
      });
      const foundStem2 = resStem2.items.some((item) => item.id === 'post_stemming_doc');
      expect(foundStem2).toBe(true);
    });

    it('should support prefix matching via asterisk (*)', async () => {
      const client = new NodeStackClient(`http://127.0.0.1:${PORT}`);

      const res = await client.collection('posts').getList(1, 10, {
        search: 'type*',
      });

      expect(res.totalItems).toBeGreaterThanOrEqual(2);
      expect(res.items.some((i) => i.id === 'post_high_relevance')).toBe(true);
      expect(res.items.some((i) => i.id === 'post_single_mention')).toBe(true);
    });

    it('should support quoted phrase search for exact adjacent phrase matching', async () => {
      const client = new NodeStackClient(`http://127.0.0.1:${PORT}`);

      const res = await client.collection('posts').getList(1, 10, {
        search: '"Database Engine"',
      });

      expect(res.totalItems).toBe(1);
      expect(res.items[0].id).toBe('post_stemming_doc');
    });

    it('should combine search with filter expression without column ambiguity errors', async () => {
      const client = new NodeStackClient(`http://127.0.0.1:${PORT}`);

      // Search for "typescript backend", but restrict to status = 'published'
      const res = await client.collection('posts').getList(1, 10, {
        search: 'typescript backend',
        filter: 'status = "published"',
      });

      expect(res.totalItems).toBe(1);
      expect(res.items[0].id).toBe('post_high_relevance');
      expect(res.items[0].status).toBe('published');
    });

    it('should support custom sorting while retaining BM25 score and snippets', async () => {
      const client = new NodeStackClient(`http://127.0.0.1:${PORT}`);

      const res = await client.collection('posts').getList(1, 10, {
        search: 'typescript',
        sort: '-viewCount',
      });

      expect(res.totalItems).toBeGreaterThanOrEqual(2);
      expect(res.items[0].viewCount).toBeGreaterThanOrEqual(res.items[1].viewCount);
      // Snippets and score are still generated
      expect(res.items[0]._score).toBeDefined();
      expect(res.items[0]._snippet).toBeDefined();
    });

    it('should support custom snippet highlight tags via snippetTag option', async () => {
      const client = new NodeStackClient(`http://127.0.0.1:${PORT}`);

      const res = await client.collection('posts').getList(1, 10, {
        search: 'typescript',
        snippetTag: 'b',
      });

      expect(res.items.length).toBeGreaterThan(0);
      expect(res.items[0]._snippet).toContain('<b>');
      expect(res.items[0]._snippet).toContain('</b>');
    });

    it('should support custom snippetEllipsis and safely escape single quotes and SQL injection attempts', async () => {
      const client = new NodeStackClient(`http://127.0.0.1:${PORT}`);

      // 1. Custom ellipsis
      const resCustom = await client.collection('posts').getList(1, 10, {
        search: 'typescript',
        snippetEllipsis: ' ~~~ ',
      });
      expect(resCustom.items.length).toBeGreaterThan(0);
      expect(resCustom.items[0]._snippet).toBeDefined();

      // 2. Ellipsis with apostrophe (e.g. "it's...")
      const resApostrophe = await client.collection('posts').getList(1, 10, {
        search: 'typescript',
        snippetEllipsis: "it's...",
      });
      expect(resApostrophe.items.length).toBeGreaterThan(0);
      expect(resApostrophe.items[0]._snippet).toBeDefined();

      // 3. Ellipsis with SQL injection attempt
      const resInjection = await client.collection('posts').getList(1, 10, {
        search: 'typescript',
        snippetEllipsis: "'); DROP TABLE posts; --",
      });
      expect(resInjection.items.length).toBeGreaterThan(0);
      expect(resInjection.items[0]._snippet).toBeDefined();
      // Ensure posts table still exists and is intact
      expect(app.db.get('SELECT COUNT(*) as count FROM posts')).toBeDefined();
    });

    it('should handle queries with zero matches gracefully', async () => {
      const client = new NodeStackClient(`http://127.0.0.1:${PORT}`);

      const res = await client.collection('posts').getList(1, 10, {
        search: 'nonexistenttermxyz999',
      });

      expect(res.totalItems).toBe(0);
      expect(res.totalPages).toBe(0);
      expect(res.items).toEqual([]);
    });

    it('should handle special and punctuation characters safely without crashing', async () => {
      const client = new NodeStackClient(`http://127.0.0.1:${PORT}`);

      const trickySearches = [
        'c++',
        'status:published',
        'brackets [test]',
        'unbalanced"quote',
        'AND OR NOT',
        '+++',
      ];

      for (const term of trickySearches) {
        const res = await client.collection('posts').getList(1, 10, {
          search: term,
        });
        expect(res).toBeDefined();
        expect(Array.isArray(res.items)).toBe(true);
      }
    });

    it('should support pagination with search query parameter', async () => {
      const client = new NodeStackClient(`http://127.0.0.1:${PORT}`);

      const page1 = await client.collection('posts').getList(1, 1, {
        search: 'typescript',
      });

      expect(page1.page).toBe(1);
      expect(page1.perPage).toBe(1);
      expect(page1.totalItems).toBeGreaterThanOrEqual(2);
      expect(page1.totalPages).toBeGreaterThanOrEqual(2);
      expect(page1.items.length).toBe(1);

      const page2 = await client.collection('posts').getList(2, 1, {
        search: 'typescript',
      });

      expect(page2.page).toBe(2);
      expect(page2.items.length).toBe(1);
      expect(page2.items[0].id).not.toBe(page1.items[0].id);
    });

    it('should support search in exportRecords', async () => {
      const exportRes = await app.records.exportRecords('posts', 'json', {
        search: 'typescript backend',
      });

      expect(exportRes.data).toBeDefined();
      const parsed = JSON.parse(exportRes.data);
      expect(parsed.length).toBe(2);
      expect(parsed.some((r: any) => r.id === 'post_high_relevance')).toBe(true);
    });

    it('should safely preserve user fields such as score and snippetLength without column collisions or corruption', async () => {
      const client = new NodeStackClient(`http://127.0.0.1:${PORT}`);

      // Create a collection with user fields named 'score' and 'snippetLength'
      app.schema.createCollection({
        name: 'scored_articles',
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
        schema: [
          { id: 'fa1', name: 'title', type: 'text' },
          { id: 'fa2', name: 'content', type: 'text' },
          { id: 'fa3', name: 'score', type: 'number' },
          { id: 'fa4', name: 'snippetLength', type: 'number' },
          { id: 'fa5', name: 'metadata_info', type: 'text' },
        ],
      });

      await app.records.create('scored_articles', {
        title: 'Full-text Search and Scoring Deep Dive',
        content: 'Analyzing SQLite FTS5 relevance scoring mechanisms and BM25 ranking algorithms.',
        score: 95.5,
        snippetLength: 42,
        metadata_info: 'safe-user-data',
      });

      const res = await client.collection('scored_articles').getList(1, 10, {
        search: 'scoring',
      });

      expect(res.items.length).toBe(1);
      const item = res.items[0];

      // 1. Verify user's own fields are intact and NOT corrupted or overwritten
      expect(item.score).toBe(95.5);
      expect(item.snippetLength).toBe(42);
      expect(item.metadata_info).toBe('safe-user-data');

      // 2. Verify search metadata fields are properly populated
      expect(item._score).toBeDefined();
      expect(typeof item._score).toBe('number');
      expect(item._snippet).toBeDefined();
      expect(item._snippet.toLowerCase()).toContain('<mark>scoring</mark>');
      expect(item._snippets).toBeDefined();
      expect(item._snippets.content.toLowerCase()).toContain('<mark>scoring</mark>');

      // 3. Verify internal namespaced columns are cleaned up and do not leak
      expect((item as any).__fts_score).toBeUndefined();
      expect((item as any).__fts_snippet).toBeUndefined();
      expect((item as any).__fts_snippet_title).toBeUndefined();
      expect((item as any).__fts_snippet_content).toBeUndefined();
    });

    it('should support search and custom sorting on collections with user-defined rank field without ambiguous column errors', async () => {
      const client = new NodeStackClient(`http://127.0.0.1:${PORT}`);

      // Create a collection with a user-defined 'rank' field
      app.schema.createCollection({
        name: 'ranked_players',
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
        schema: [
          { id: 'fp1', name: 'name', type: 'text' },
          { id: 'fp2', name: 'bio', type: 'text' },
          { id: 'fp3', name: 'rank', type: 'number' },
        ],
      });

      await app.records.create('ranked_players', {
        id: 'player_1',
        name: 'Alice Developer',
        bio: 'Senior backend architect specializing in search and distributed systems.',
        rank: 10,
      });

      await app.records.create('ranked_players', {
        id: 'player_2',
        name: 'Bob Searcher',
        bio: 'Search engineer building high-performance search clusters.',
        rank: 1,
      });

      // 1. Default search (emits ORDER BY fts.rank ASC): must not fail with "ambiguous column name: rank"
      const resDefault = await client.collection('ranked_players').getList(1, 10, {
        search: 'search',
      });
      expect(resDefault.items.length).toBe(2);
      expect(resDefault.items[0]._score).toBeDefined();
      expect(resDefault.items[0].rank).toBeDefined();

      // 2. User sorts by their own 'rank' field ascending: must order player_2 (rank 1) before player_1 (rank 10)
      const resUserSortAsc = await client.collection('ranked_players').getList(1, 10, {
        search: 'search',
        sort: 'rank',
      });
      expect(resUserSortAsc.items.length).toBe(2);
      expect(resUserSortAsc.items[0].id).toBe('player_2');
      expect(resUserSortAsc.items[0].rank).toBe(1);
      expect(resUserSortAsc.items[1].id).toBe('player_1');
      expect(resUserSortAsc.items[1].rank).toBe(10);

      // 3. User sorts by their own 'rank' field descending: must order player_1 (rank 10) before player_2 (rank 1)
      const resUserSortDesc = await client.collection('ranked_players').getList(1, 10, {
        search: 'search',
        sort: '-rank',
      });
      expect(resUserSortDesc.items.length).toBe(2);
      expect(resUserSortDesc.items[0].id).toBe('player_1');
      expect(resUserSortDesc.items[0].rank).toBe(10);
      expect(resUserSortDesc.items[1].id).toBe('player_2');
      expect(resUserSortDesc.items[1].rank).toBe(1);

      // 4. User explicitly sorts by relevance score using _score
      const resScoreSort = await client.collection('ranked_players').getList(1, 10, {
        search: 'search',
        sort: '-_score',
      });
      expect(resScoreSort.items.length).toBe(2);
      expect(resScoreSort.items[0]._score).toBeDefined();

      // 5. exportRecords with search on collection with user rank field
      const exportRes = await app.records.exportRecords('ranked_players', 'json', {
        search: 'search',
      });
      expect(exportRes.data).toBeDefined();
      const parsedExport = JSON.parse(exportRes.data);
      expect(parsedExport.length).toBe(2);
    });
  });
});
