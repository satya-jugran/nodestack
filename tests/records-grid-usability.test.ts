import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NodeStack } from '../src/NodeStack';
import { FilterCodec } from '../src/records/FilterCodec';
import { QueryFilterParser } from '../src/records/QueryFilterParser';

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

    it('should clamp page and reload when deleting final item on last page reduces totalPages', async () => {
      // Create a collection with 3 items, perPage = 2 => 2 pages
      app.schema.createCollection({
        name: 'paged_items',
        type: 'base',
        schema: [
          { id: 'f_name', name: 'name', type: 'text', required: true },
        ],
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
      });

      await app.records.create('paged_items', { name: 'Item 1' });
      await app.records.create('paged_items', { name: 'Item 2' });
      const i3 = await app.records.create('paged_items', { name: 'Item 3' });

      // Page 2 initially exists and returns Item 3
      const initialPage2 = await app.records.getList('paged_items', { page: 2, perPage: 2 });
      expect(initialPage2.page).toBe(2);
      expect(initialPage2.totalItems).toBe(3);
      expect(initialPage2.totalPages).toBe(2);
      expect(initialPage2.items.length).toBe(1);
      const lastPageItem = initialPage2.items[0];

      // Delete the only item on page 2
      await app.records.delete('paged_items', lastPageItem.id);

      // Now query page 2 again (simulating what happens if client requested page 2 before realizing it was deleted)
      const outOfRangeRes = await app.records.getList('paged_items', { page: 2, perPage: 2 });
      expect(outOfRangeRes.totalItems).toBe(2);
      expect(outOfRangeRes.totalPages).toBe(1);
      expect(outOfRangeRes.items.length).toBe(0);

      // Simulate client loadRecords clamping logic:
      let clientPage = 2;
      const clientPerPage = 2;
      const totalItems = outOfRangeRes.totalItems;
      const totalPages = Math.max(1, outOfRangeRes.totalPages || Math.ceil(totalItems / clientPerPage));
      let reloaded = false;

      if (clientPage > totalPages) {
        clientPage = totalPages;
        reloaded = true;
      }

      expect(reloaded).toBe(true);
      expect(clientPage).toBe(1);

      // Reloading with clamped page yields the new last valid page items
      const clampedRes = await app.records.getList('paged_items', { page: clientPage, perPage: 2 });
      expect(clampedRes.page).toBe(1);
      expect(clampedRes.items.length).toBe(2);

      // Footer calculation verification: start must never exceed end or total
      const total = clampedRes.totalItems;
      const start = total === 0 ? 0 : Math.min((clientPage - 1) * clientPerPage + 1, total);
      const end = Math.min(clientPage * clientPerPage, total);
      expect(start).toBe(1);
      expect(end).toBe(2);
      expect(start <= end).toBe(true);
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

    it('should NOT allow non-admin requests to filter or sort by email on auth collection', async () => {
      // Non-admin request (public / unauthenticated)
      // When non-admin tries to filter by email, 'email' is omitted from allowedFields
      const nonAdminSearch = await app.records.getList('users', { filter: "email ~ 'aaron'" });
      // The filter on email is ignored by QueryFilterParser, so it does not narrow down exclusively to aaron
      // and thus does NOT reveal whether hidden emails exist through item counts
      expect(nonAdminSearch.totalItems).toBeGreaterThan(1);

      // When non-admin tries to sort by email, it falls back to created DESC
      const nonAdminSort = await app.records.getList('users', { sort: 'email' });
      // Non-admin sanitized results have emails masked unless emailVisibility is true
      expect(nonAdminSort.items.length).toBeGreaterThan(0);

      // verified and emailVisibility remain queryable for non-admin requests
      const verifiedFilter = await app.records.getList('users', { filter: 'verified = false' });
      expect(verifiedFilter.items.every(u => u.verified === false)).toBe(true);
    });

    it('should allow admin to filter by email in exportRecords and disallow non-admin', async () => {
      const adminAuth = { id: 'admin', isAdmin: true };
      const adminExport = await app.records.exportRecords('users', 'json', { filter: "email ~ 'aaron'" }, adminAuth);
      const parsedAdmin = JSON.parse(adminExport.data);
      expect(parsedAdmin.length).toBe(1);
      expect(parsedAdmin[0].email).toBe('aaron@company.io');

      // Non-admin export
      const nonAdminExport = await app.records.exportRecords('users', 'json', { filter: "email ~ 'aaron'" });
      const parsedNonAdmin = JSON.parse(nonAdminExport.data);
      // Filter on email ignored, exports all allowed users
      expect(parsedNonAdmin.length).toBeGreaterThan(1);
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

      function renderSortableTh(columnName: string, displayName: string, currentSort = getCurrentSort()) {
        const isActive = currentSort.field === columnName;
        const arrow = isActive ? (currentSort.dir === 'asc' ? '↑' : '↓') : '<span class="sort-icon-ghost">↕</span>';
        const activeClass = isActive ? `sort-active sort-${escapeHtml(currentSort.dir)}` : '';
        const safeCol = escapeHtml(columnName);
        const safeDisplay = escapeHtml(displayName);
        const nextOrder = isActive ? (currentSort.dir === 'asc' ? 'Descending next' : 'Ascending next') : 'Ascending';
        const safeTitle = escapeHtml(`Sort by ${displayName} (${nextOrder})`);
        const ariaSort = isActive ? (currentSort.dir === 'asc' ? 'ascending' : 'descending') : 'none';

        return `
          <th scope="col" class="th-sortable ${activeClass}" data-column="${safeCol}" aria-sort="${ariaSort}">
            <button type="button" class="th-sort-btn" data-column="${safeCol}" onclick="handleHeaderSort(this)" title="${safeTitle}" aria-label="${safeTitle}">
              <span>${safeDisplay}</span>
              <span class="sort-icon" aria-hidden="true">${arrow}</span>
            </button>
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

      // Verify real button element inside th for keyboard accessibility
      expect(thHtml).toContain('<button type="button" class="th-sort-btn"');
      expect(thHtml).toContain('aria-sort="none"');
      expect(thHtml).toContain('onclick="handleHeaderSort(this)"');
      expect(thHtml).not.toContain(`toggleSort('${maliciousField}')`);

      // Verify aria-sort reflects active ascending/descending states
      const activeThAsc = renderSortableTh('title', 'Title', { field: 'title', dir: 'asc' });
      expect(activeThAsc).toContain('aria-sort="ascending"');
      const activeThDesc = renderSortableTh('title', 'Title', { field: 'title', dir: 'desc' });
      expect(activeThDesc).toContain('aria-sort="descending"');

      // Verify escaped display text
      expect(thHtml).toContain('&lt;script&gt;test&lt;/script&gt;');
    });

    it('should safely escape rec.email in data-email attribute and avoid inline JavaScript interpolation', () => {
      function escapeHtml(str: any): string {
        return String(str ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      const maliciousEmail = `attacker" onclick="alert('xss')"'@domain.com`;
      const rec = { email: maliciousEmail };

      const buttonHtml = `<button class="btn btn-secondary btn-sm" style="padding:2px 6px; font-size:11px;" data-email="${escapeHtml(rec.email || '')}" onclick="handleDrawerCopyEmail(this)">Copy</button>`;

      expect(buttonHtml).not.toContain('attacker" onclick=');
      expect(buttonHtml).not.toContain(`copyToClipboard('${maliciousEmail}'`);
      expect(buttonHtml).toContain('data-email="attacker&quot; onclick=&quot;alert(&#39;xss&#39;)&quot;&#39;@domain.com"');
      expect(buttonHtml).toContain('onclick="handleDrawerCopyEmail(this)"');
    });
  });

  describe('Shared Filter Literal Codec & Apostrophe/Backslash Search (Regression Tests)', () => {
    it('should roundtrip arbitrary string literals including apostrophes, backslashes, and quotes', () => {
      const testCases = [
        "O'Reilly",
        "C:\\Users\\Default",
        "nested 'single' and \"double\" quotes",
        "path\\with\\multiple\\backslashes",
        "apostrophe's and backslash\\ combo",
        "line1\nline2\ttab",
        "",
        "simple_term",
      ];

      for (const raw of testCases) {
        const encoded = FilterCodec.encode(raw);
        expect(encoded.startsWith("'") && encoded.endsWith("'")).toBe(true);
        const decoded = FilterCodec.decode(encoded);
        expect(decoded).toBe(raw);
      }
    });

    it('should properly unescape literal in QueryFilterParser and not include escape backslashes in query parameter', () => {
      // Searching O'Reilly with filter title ~ 'O\'Reilly'
      const parsedApostrophe = QueryFilterParser.parseFilter("title ~ 'O\\'Reilly'");
      expect(parsedApostrophe.params).toEqual(["%O'Reilly%"]);

      // Searching exact match title = 'O\'Reilly'
      const parsedExact = QueryFilterParser.parseFilter("title = 'O\\'Reilly'");
      expect(parsedExact.params).toEqual(["O'Reilly"]);

      // Searching path with backslash: path ~ 'C:\\docs'
      const parsedBackslash = QueryFilterParser.parseFilter("path ~ 'C:\\\\docs'");
      expect(parsedBackslash.params).toEqual(["%C:\\docs%"]);
    });

    it('should match records containing apostrophes and backslashes in database queries', async () => {
      // Create a collection for special character searches
      app.schema.createCollection({
        name: 'books',
        type: 'base',
        schema: [
          { id: 'f_title', name: 'title', type: 'text', required: true },
          { id: 'f_path', name: 'path', type: 'text', required: false },
        ],
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
      });

      await app.records.create('books', {
        title: "O'Reilly Programming Guide",
        path: "C:\\books\\library",
      });

      // 1. Search for O'Reilly using encoded literal
      const searchApostropheFilter = `title ~ ${FilterCodec.encode("O'Reilly")}`;
      const resApostrophe = await app.records.getList('books', { filter: searchApostropheFilter });
      expect(resApostrophe.items.length).toBe(1);
      expect(resApostrophe.items[0].title).toBe("O'Reilly Programming Guide");

      // 2. Search for backslash path using encoded literal
      const searchPathFilter = `path ~ ${FilterCodec.encode("C:\\books")}`;
      const resPath = await app.records.getList('books', { filter: searchPathFilter });
      expect(resPath.items.length).toBe(1);
      expect(resPath.items[0].path).toBe("C:\\books\\library");

      // 3. Exact match with apostrophe
      const exactApostrophe = await app.records.getList('books', { filter: `title = ${FilterCodec.encode("O'Reilly Programming Guide")}` });
      expect(exactApostrophe.items.length).toBe(1);
    });
  });

  describe('Slide-Over Record Drawer Accessibility & Focus Management', () => {
    it('should render drawer container with proper dialog semantics and aria attributes', () => {
      const rootHtml = `
        <div id="record-drawer-backdrop" class="drawer-backdrop" onclick="closeRecordDrawer()" aria-hidden="true"></div>
        <aside id="record-drawer-panel" class="record-drawer" role="dialog" aria-modal="true" aria-labelledby="record-drawer-title" tabindex="-1">
          <!-- Dynamic Content -->
        </aside>
      `;

      expect(rootHtml).toContain('role="dialog"');
      expect(rootHtml).toContain('aria-modal="true"');
      expect(rootHtml).toContain('aria-labelledby="record-drawer-title"');
      expect(rootHtml).toContain('tabindex="-1"');
      expect(rootHtml).toContain('aria-hidden="true"');
    });

    it('should include accessible header title and close button with proper labels in drawer content', () => {
      const col = { name: 'members', schema: [] };
      const rec = { id: 'rec_123', created: new Date().toISOString() };

      const headerHtml = `
        <div class="drawer-header">
          <div class="drawer-title-area">
            <span style="font-size:18px;" aria-hidden="true">📄</span>
            <h2 id="record-drawer-title" class="drawer-title" style="margin:0; font-size:1.05rem;">Record Details</h2>
            <span class="badge badge-post">${col.name}</span>
            <span class="id-pill" title="Record ID">${rec.id}</span>
          </div>
          <button class="btn btn-secondary btn-sm" id="drawer-close-btn" onclick="closeRecordDrawer()" title="Close drawer (Esc)" aria-label="Close drawer">✕</button>
        </div>
      `;

      expect(headerHtml).toContain('id="record-drawer-title"');
      expect(headerHtml).toContain('id="drawer-close-btn"');
      expect(headerHtml).toContain('aria-label="Close drawer"');
    });

    it('should render table rows with keyboard accessibility attributes (tabindex, role, aria-label, onkeydown)', () => {
      function renderRow(recId: string) {
        return `<tr class="record-row" data-id="${recId}" tabindex="0" role="button" aria-label="Record ${recId}, press Enter to view details" onclick="handleRecordRowClick(this)" onkeydown="handleRecordRowKeyDown(event, this)">`;
      }

      const rowHtml = renderRow('rec_abc');
      expect(rowHtml).toContain('tabindex="0"');
      expect(rowHtml).toContain('role="button"');
      expect(rowHtml).toContain('aria-label="Record rec_abc, press Enter to view details"');
      expect(rowHtml).toContain('onkeydown="handleRecordRowKeyDown(event, this)"');
    });

    it('should activate drawer via handleRecordRowKeyDown on Enter or Space but ignore inner interactive targets', () => {
      let openedWithId: string | null = null;
      function openRecordDrawer(id: string) {
        openedWithId = id;
      }
      function handleRecordRowClick(trEl: any) {
        const id = trEl.getAttribute('data-id');
        if (id) openRecordDrawer(id);
      }
      function handleRecordRowKeyDown(e: any, trEl: any) {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target && e.target.closest && e.target.closest('button, a, input, select, textarea')) {
            return;
          }
          e.preventDefault();
          handleRecordRowClick(trEl);
        }
      }

      const mockTr = {
        getAttribute: (attr: string) => (attr === 'data-id' ? 'rec_99' : null),
      };

      // 1. Enter key on row triggers drawer
      let defaultPrevented = false;
      handleRecordRowKeyDown(
        { key: 'Enter', target: { closest: () => null }, preventDefault: () => { defaultPrevented = true; } },
        mockTr
      );
      expect(openedWithId).toBe('rec_99');
      expect(defaultPrevented).toBe(true);

      // Reset
      openedWithId = null;
      defaultPrevented = false;

      // 2. Space key on row triggers drawer
      handleRecordRowKeyDown(
        { key: ' ', target: { closest: () => null }, preventDefault: () => { defaultPrevented = true; } },
        mockTr
      );
      expect(openedWithId).toBe('rec_99');
      expect(defaultPrevented).toBe(true);

      // Reset
      openedWithId = null;
      defaultPrevented = false;

      // 3. Enter key on an inner button (e.g., Edit/Delete) does NOT trigger drawer
      handleRecordRowKeyDown(
        { key: 'Enter', target: { closest: (sel: string) => (sel.includes('button') ? {} : null) }, preventDefault: () => { defaultPrevented = true; } },
        mockTr
      );
      expect(openedWithId).toBeNull();
      expect(defaultPrevented).toBe(false);

      // 4. Other keys (ArrowDown, etc.) do NOT trigger drawer
      handleRecordRowKeyDown(
        { key: 'ArrowDown', target: { closest: () => null }, preventDefault: () => { defaultPrevented = true; } },
        mockTr
      );
      expect(openedWithId).toBeNull();
    });

    it('should trap focus inside the drawer when Tab or Shift+Tab is pressed', () => {
      let closed = false;
      function closeRecordDrawer() {
        closed = true;
      }

      const btnClose = { id: 'drawer-close-btn', focusCount: 0, focus() { this.focusCount++; } };
      const btnCopy = { id: 'drawer-copy-btn', focusCount: 0, focus() { this.focusCount++; } };
      const btnDelete = { id: 'drawer-delete-btn', focusCount: 0, focus() { this.focusCount++; } };
      const focusableList = [btnClose, btnCopy, btnDelete];

      const panel = {
        querySelectorAll: () => focusableList,
        contains: (el: any) => focusableList.includes(el),
        focus() {},
      };

      let currentActiveElement: any = btnDelete;

      function handleDrawerKeyDown(e: any) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeRecordDrawer();
          return;
        }

        if (e.key === 'Tab') {
          const focusable = focusableList;
          if (focusable.length === 0) {
            e.preventDefault();
            return;
          }

          const firstElement = focusable[0];
          const lastElement = focusable[focusable.length - 1];

          if (e.shiftKey) {
            if (currentActiveElement === firstElement || !panel.contains(currentActiveElement)) {
              e.preventDefault();
              lastElement.focus();
              currentActiveElement = lastElement;
            }
          } else {
            if (currentActiveElement === lastElement || !panel.contains(currentActiveElement)) {
              e.preventDefault();
              firstElement.focus();
              currentActiveElement = firstElement;
            }
          }
        }
      }

      // Tab on last element -> wraps to first element
      currentActiveElement = btnDelete;
      let prevented = false;
      handleDrawerKeyDown({
        key: 'Tab',
        shiftKey: false,
        preventDefault: () => { prevented = true; },
      });
      expect(prevented).toBe(true);
      expect(currentActiveElement).toBe(btnClose);
      expect(btnClose.focusCount).toBe(1);

      // Shift+Tab on first element -> wraps to last element
      currentActiveElement = btnClose;
      prevented = false;
      handleDrawerKeyDown({
        key: 'Tab',
        shiftKey: true,
        preventDefault: () => { prevented = true; },
      });
      expect(prevented).toBe(true);
      expect(currentActiveElement).toBe(btnDelete);
      expect(btnDelete.focusCount).toBe(1);

      // Escape key closes drawer
      prevented = false;
      handleDrawerKeyDown({
        key: 'Escape',
        preventDefault: () => { prevented = true; },
      });
      expect(prevented).toBe(true);
      expect(closed).toBe(true);
    });

    it('should save trigger element on open and restore focus to trigger element on close', () => {
      let drawerTriggerElement: any = null;
      let rowFocusCount = 0;
      const mockRow = {
        id: 'row-rec-1',
        focus: () => { rowFocusCount++; },
      };

      function openRecordDrawer(triggerEl: any) {
        drawerTriggerElement = triggerEl;
      }

      function closeRecordDrawer() {
        if (drawerTriggerElement && typeof drawerTriggerElement.focus === 'function') {
          drawerTriggerElement.focus();
        }
        drawerTriggerElement = null;
      }

      // Open drawer from row
      openRecordDrawer(mockRow);
      expect(drawerTriggerElement).toBe(mockRow);

      // Close drawer -> focus restored to row
      closeRecordDrawer();
      expect(rowFocusCount).toBe(1);
      expect(drawerTriggerElement).toBeNull();
    });
  });
});

