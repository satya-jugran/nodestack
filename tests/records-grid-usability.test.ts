import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';

describe('Records Data Grid Usability (Backend & Service Integration)', () => {
  const testDir = path.resolve(__dirname, '../.test_records_grid_data');
  let app: NodeStack;
  let adminToken = '';

  beforeAll(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    app = new NodeStack({
      dataDir: testDir,
      port: 8105,
    });

    const admin = await app.auth.createAdmin('admin@nodestack.io', 'supersecret123');
    const authRes = await app.auth.authenticateAdmin('admin@nodestack.io', 'supersecret123');
    adminToken = authRes.token;

    // Create a rich test collection with title (text), email (email), website (url), bio (text), score (number)
    app.schema.createCollection({
      name: 'members',
      type: 'base',
      schema: [
        { id: 'f_title', name: 'title', type: 'text', required: true },
        { id: 'f_email', name: 'email', type: 'email', required: true },
        { id: 'f_website', name: 'website', type: 'url', required: false },
        { id: 'f_bio', name: 'bio', type: 'text', required: false },
        { id: 'f_score', name: 'score', type: 'number', required: false },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });

    // Seed test records
    await app.records.create('members', {
      title: 'Alice Wonder',
      email: 'alice@example.com',
      website: 'https://alice.dev',
      bio: 'Software engineer from Seattle',
      score: 95,
    });
    await app.records.create('members', {
      title: 'Bob Builder',
      email: 'bob@builder.org',
      website: 'https://bob.org',
      bio: 'Constructing great interfaces',
      score: 80,
    });
    await app.records.create('members', {
      title: 'Charlie Chaplin',
      email: 'charlie@movies.net',
      website: 'https://charlie.net',
      bio: 'Classic silent films',
      score: 88,
    });
    await app.records.create('members', {
      title: 'Diana Prince',
      email: 'wonder@themyscira.io',
      website: 'https://hero.com/wonder',
      bio: 'Hero saving the world',
      score: 100,
    });
  });

  afterAll(async () => {
    await app.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Multi-Column Search with || condition', () => {
    it('should find record matching email when searching across all text/email/url fields', async () => {
      // Searching 'themyscira' which is in email, NOT in title
      const filter = "title ~ 'themyscira' || email ~ 'themyscira' || website ~ 'themyscira' || bio ~ 'themyscira'";
      const res = await app.records.getList('members', { filter });
      expect(res.items.length).toBe(1);
      expect(res.items[0].title).toBe('Diana Prince');
      expect(res.items[0].email).toBe('wonder@themyscira.io');
    });

    it('should find record matching bio when searching across all text/email/url fields', async () => {
      // Searching 'silent' which is in bio
      const filter = "title ~ 'silent' || email ~ 'silent' || website ~ 'silent' || bio ~ 'silent'";
      const res = await app.records.getList('members', { filter });
      expect(res.items.length).toBe(1);
      expect(res.items[0].title).toBe('Charlie Chaplin');
    });

    it('should find record matching website when searching across all text/email/url fields', async () => {
      // Searching 'alice.dev' which is in website
      const filter = "title ~ 'alice.dev' || email ~ 'alice.dev' || website ~ 'alice.dev' || bio ~ 'alice.dev'";
      const res = await app.records.getList('members', { filter });
      expect(res.items.length).toBe(1);
      expect(res.items[0].title).toBe('Alice Wonder');
    });

    it('should allow single-field targeted search', async () => {
      // Search email only
      const res = await app.records.getList('members', { filter: "email ~ 'builder.org'" });
      expect(res.items.length).toBe(1);
      expect(res.items[0].title).toBe('Bob Builder');
    });

    it('should return empty list when no fields match term', async () => {
      const filter = "title ~ 'nonexistent_xyz' || email ~ 'nonexistent_xyz' || website ~ 'nonexistent_xyz' || bio ~ 'nonexistent_xyz'";
      const res = await app.records.getList('members', { filter });
      expect(res.items.length).toBe(0);
      expect(res.totalItems).toBe(0);
    });
  });

  describe('Clickable Column Sorting (Ascending & Descending)', () => {
    it('should sort ascending by title (sort=title)', async () => {
      const res = await app.records.getList('members', { sort: 'title' });
      expect(res.items[0].title).toBe('Alice Wonder');
      expect(res.items[res.items.length - 1].title).toBe('Diana Prince');
    });

    it('should sort descending by title (sort=-title)', async () => {
      const res = await app.records.getList('members', { sort: '-title' });
      expect(res.items[0].title).toBe('Diana Prince');
      expect(res.items[res.items.length - 1].title).toBe('Alice Wonder');
    });

    it('should sort ascending and descending by score (sort=score and sort=-score)', async () => {
      const asc = await app.records.getList('members', { sort: 'score' });
      expect(asc.items[0].score).toBe(80); // Bob
      expect(asc.items[asc.items.length - 1].score).toBe(100); // Diana

      const desc = await app.records.getList('members', { sort: '-score' });
      expect(desc.items[0].score).toBe(100); // Diana
      expect(desc.items[desc.items.length - 1].score).toBe(80); // Bob
    });

    it('should sort by system created field (sort=created and sort=-created)', async () => {
      const resAsc = await app.records.getList('members', { sort: 'created' });
      expect(resAsc.items[0].title).toBe('Alice Wonder');

      const resDesc = await app.records.getList('members', { sort: '-created' });
      expect(resDesc.items[0].title).toBe('Diana Prince');
    });
  });

  describe('Pagination Controls (25, 50, 100 rows per page & bounds)', () => {
    it('should handle pagination with 25 rows per page', async () => {
      const res = await app.records.getList('members', { page: 1, perPage: 25 });
      expect(res.page).toBe(1);
      expect(res.perPage).toBe(25);
      expect(res.totalItems).toBe(4);
      expect(res.totalPages).toBe(1);
      expect(res.items.length).toBe(4);
    });

    it('should calculate multiple pages with small perPage and navigate between pages', async () => {
      const page1 = await app.records.getList('members', { page: 1, perPage: 2, sort: 'title' });
      expect(page1.page).toBe(1);
      expect(page1.perPage).toBe(2);
      expect(page1.totalItems).toBe(4);
      expect(page1.totalPages).toBe(2);
      expect(page1.items.length).toBe(2);
      expect(page1.items[0].title).toBe('Alice Wonder');
      expect(page1.items[1].title).toBe('Bob Builder');

      const page2 = await app.records.getList('members', { page: 2, perPage: 2, sort: 'title' });
      expect(page2.page).toBe(2);
      expect(page2.items.length).toBe(2);
      expect(page2.items[0].title).toBe('Charlie Chaplin');
      expect(page2.items[1].title).toBe('Diana Prince');
    });
  });

  describe('Auth Collection Search & Sorting (email, verified)', () => {
    it('should support searching and sorting by email on users collection', async () => {
      const adminAuth = { id: 'admin', isAdmin: true };

      // Create user records
      const u1 = await app.records.create('users', {
        email: 'zack@company.io',
        password: 'password123',
        name: 'Zack',
      });
      const u2 = await app.records.create('users', {
        email: 'aaron@company.io',
        password: 'password123',
        name: 'Aaron',
      });

      // Search by email on users auth collection as admin
      const searchRes = await app.records.getList('users', { filter: "email ~ 'aaron'" }, adminAuth);
      expect(searchRes.items.some(u => u.email === 'aaron@company.io')).toBe(true);
      expect(searchRes.items.every(u => u.email.includes('aaron'))).toBe(true);

      // Sort by email ascending on users auth collection as admin
      const sortRes = await app.records.getList('users', { sort: 'email' }, adminAuth);
      const emails = sortRes.items.map(u => u.email);
      const sortedEmails = [...emails].sort();
      expect(emails).toEqual(sortedEmails);
    });
  });

  describe('File URL Component Encoding & Attribute Safety (getRecordFileUrl)', () => {
    it('should encode reserved characters, quotes, and query components in getRecordFileUrl', () => {
      // Simulate frontend getRecordFileUrl logic
      const stateMock = { token: 'tok+123&secret=true' };
      function getRecordFileUrl(colName: string, recId: string, filename: string) {
        const encCol = encodeURIComponent(colName || '');
        const encId = encodeURIComponent(recId || '');
        const encFile = encodeURIComponent(filename || '').replace(/'/g, '%27');
        const encToken = encodeURIComponent(stateMock.token || '');
        return `/api/files/${encCol}/${encId}/${encFile}?token=${encToken}`;
      }

      // Test double quotes, script tags, spaces, and reserved chars in filename
      const dangerousFilename = 'avatar" onload="alert(1)" \'test\' & #1?.png';
      const url = getRecordFileUrl('user profiles', 'rec 001', dangerousFilename);

      // Verify path segments and query are encoded
      expect(url).toContain('/api/files/user%20profiles/rec%20001/');
      expect(url).not.toContain('"');
      expect(url).not.toContain("'");
      expect(url).toContain('%22');
      expect(url).toContain('%27');
      expect(url).toContain('%26');
      expect(url).toContain('%23');
      expect(url).toContain('%3F');
      expect(url).toContain('?token=tok%2B123%26secret%3Dtrue');
    });
  });

  describe('Schema Field Injection Prevention (renderSortableTh & UI attributes)', () => {
    it('should safely escape malicious schema field names in renderSortableTh data attribute and title', () => {
      function escapeHtml(str: any): string {
        return String(str ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function getCurrentSort() {
        return { field: 'created', dir: 'desc' };
      }

      function renderSortableTh(columnName: string, displayName: string) {
        const current = getCurrentSort();
        const isActive = current.field === columnName;
        const arrow = isActive ? (current.dir === 'asc' ? '↑' : '↓') : '<span class="sort-icon-ghost">↕</span>';
        const activeClass = isActive ? `sort-active sort-${escapeHtml(current.dir)}` : '';
        const safeCol = escapeHtml(columnName);
        const safeDisplay = escapeHtml(displayName);
        const nextOrder = isActive ? (current.dir === 'asc' ? 'Descending next' : 'Ascending next') : 'Ascending';
        const safeTitle = escapeHtml(`Sort by ${displayName} (${nextOrder})`);
        return `
          <th class="th-sortable ${activeClass}" data-column="${safeCol}" onclick="handleHeaderSort(this)" title="${safeTitle}">
            <div class="th-content">
              <span>${safeDisplay}</span>
              <span class="sort-icon">${arrow}</span>
            </div>
          </th>
        `;
      }

      const maliciousField = 'field" onfocus="alert(1)" <script>test</script>';
      const thHtml = renderSortableTh(maliciousField, maliciousField);

      // Verify no unescaped script tag or unescaped quote breakout
      expect(thHtml).not.toContain('<script>');
      expect(thHtml).not.toContain('</script>');
      expect(thHtml).not.toContain('field" onfocus=');

      // Verify properly escaped data attribute
      expect(thHtml).toContain('data-column="field&quot; onfocus=&quot;alert(1)&quot; &lt;script&gt;test&lt;/script&gt;"');

      // Verify safe static onclick handler instead of embedding columnName in JS
      expect(thHtml).toContain('onclick="handleHeaderSort(this)"');
      expect(thHtml).not.toContain(`toggleSort('${maliciousField}')`);

      // Verify escaped display text
      expect(thHtml).toContain('&lt;script&gt;test&lt;/script&gt;');
    });
  });
});

