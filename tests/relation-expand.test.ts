import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';

describe('Multi-Select & Single-Select Relation Expansion', () => {
  const testDir = path.resolve(__dirname, '../.test_relation_expand_data');
  let app: NodeStack;

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    app = new NodeStack({
      dataDir: testDir,
      port: 0,
    });

    const authorsCol = app.schema.createCollection({
      name: 'authors',
      type: 'base',
      schema: [{ id: 'f_author_name', name: 'name', type: 'text', required: true }],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });

    const tagsCol = app.schema.createCollection({
      name: 'tags',
      type: 'base',
      schema: [
        { id: 'f_tag_label', name: 'label', type: 'text', required: true },
        { id: 'f_tag_public', name: 'isPublic', type: 'bool', defaultValue: true },
      ],
      listRule: '',
      viewRule: 'isPublic = true',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });

    app.schema.createCollection({
      name: 'articles',
      type: 'base',
      schema: [
        { id: 'f_title', name: 'title', type: 'text', required: true },
        {
          id: 'f_author',
          name: 'author',
          type: 'relation',
          options: { collectionId: authorsCol.id, maxSelect: 1 },
        },
        {
          id: 'f_tags',
          name: 'tags',
          type: 'relation',
          options: { collectionId: tagsCol.id, maxSelect: 5 },
        },
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

  it('should expand single-select and multi-select relations (array & JSON string) in getOne and getList', async () => {
    const author = await app.records.create('authors', { name: 'Alice' });
    const tag1 = await app.records.create('tags', { label: 'TypeScript', isPublic: true });
    const tag2 = await app.records.create('tags', { label: 'SQLite', isPublic: true });

    // Created using a native JS array (normalized to JSON array in DB)
    const art1 = await app.records.create('articles', {
      title: 'Post One',
      author: author.id,
      tags: [tag2.id, tag1.id],
    });

    // Created using a pre-serialized JSON string
    const art2 = await app.records.create('articles', {
      title: 'Post Two',
      author: author.id,
      tags: JSON.stringify([tag1.id]),
    });

    const fetchedOne = await app.records.getOne('articles', art1.id, { expand: 'author,tags' });
    expect(fetchedOne.expand).toBeDefined();
    expect(fetchedOne.expand.author).toMatchObject({ id: author.id, name: 'Alice' });
    expect(Array.isArray(fetchedOne.expand.tags)).toBe(true);
    expect(fetchedOne.expand.tags.map((t: any) => t.id)).toEqual([tag2.id, tag1.id]);
    expect(fetchedOne.expand.tags.map((t: any) => t.label)).toEqual(['SQLite', 'TypeScript']);

    const list = await app.records.getList('articles', {
      filter: `id = '${art1.id}' || id = '${art2.id}'`,
      expand: 'author,tags',
      sort: 'created',
    });
    expect(list.items).toHaveLength(2);
    const byId = new Map(list.items.map((r: any) => [r.id, r]));

    expect(byId.get(art1.id).expand.tags.map((t: any) => t.id)).toEqual([tag2.id, tag1.id]);
    expect(byId.get(art2.id).expand.tags.map((t: any) => t.id)).toEqual([tag1.id]);
  });

  it('should skip missing or viewRule-inaccessible IDs while keeping accessible ones', async () => {
    const publicTag = await app.records.create('tags', { label: 'Public', isPublic: true });
    const privateTag = await app.records.create('tags', { label: 'Secret', isPublic: false });

    const article = await app.records.create('articles', {
      title: 'Mixed Visibility',
      tags: [privateTag.id, 'r_nonexistent', publicTag.id],
    });

    const fetched = await app.records.getOne('articles', article.id, { expand: 'tags' });
    expect(fetched.expand).toBeDefined();
    expect(fetched.expand.tags).toHaveLength(1);
    expect(fetched.expand.tags[0]).toMatchObject({ id: publicTag.id, label: 'Public' });
  });

  it('should omit expand when multi-select array is empty or all referenced records fail', async () => {
    const privateTag = await app.records.create('tags', { label: 'Hidden', isPublic: false });

    const emptyArt = await app.records.create('articles', {
      title: 'No Tags',
      tags: [],
    });
    const allHiddenArt = await app.records.create('articles', {
      title: 'All Hidden',
      tags: [privateTag.id, 'r_missing'],
    });

    const fetchedEmpty = await app.records.getOne('articles', emptyArt.id, { expand: 'tags' });
    expect(fetchedEmpty.expand).toBeUndefined();

    const fetchedHidden = await app.records.getOne('articles', allHiddenArt.id, { expand: 'tags' });
    expect(fetchedHidden.expand).toBeUndefined();
  });

  it('should expand a single ID stored on a maxSelect > 1 relation as a single-element array', async () => {
    const tag = await app.records.create('tags', { label: 'Solo', isPublic: true });
    const article = await app.records.create('articles', {
      title: 'Single ID in Multi Field',
      tags: tag.id,
    });

    const fetched = await app.records.getOne('articles', article.id, { expand: 'tags' });
    expect(Array.isArray(fetched.expand.tags)).toBe(true);
    expect(fetched.expand.tags).toHaveLength(1);
    expect(fetched.expand.tags[0].id).toBe(tag.id);
  });

  it('should expand when record[fieldName] is already a JS array on the fetched row', async () => {
    const tag1 = await app.records.create('tags', { label: 'Arr1', isPublic: true });
    const tag2 = await app.records.create('tags', { label: 'Arr2', isPublic: true });

    const cleanRecord: Record<string, any> = {
      id: 'r_virtual',
      title: 'Already Parsed Array',
      tags: [tag1.id, tag2.id],
    };
    const col = app.schema.getCollectionOrThrow('articles');
    await (app.records as any).expandRecord(cleanRecord, col, 'tags');

    expect(cleanRecord.expand).toBeDefined();
    expect(cleanRecord.expand.tags.map((t: any) => t.id)).toEqual([tag1.id, tag2.id]);
  });
});
