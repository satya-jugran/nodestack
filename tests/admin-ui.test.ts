import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { JSDOM } from 'jsdom';
import { AdminUIBundler } from '../src/admin/AdminUIBundler';
import { AdminUIService } from '../src/admin/AdminUIService';

describe('AdminUIBundler', () => {
  const uiDir = path.resolve(__dirname, '../src/admin/ui');

  it('should bundle modular CSS and JS into index.html shell', () => {
    const bundled = AdminUIBundler.bundle(uiDir);

    expect(bundled).toBeDefined();
    expect(bundled.length).toBeGreaterThan(10000);

    // Should include DOCTYPE and HTML head
    expect(bundled).toContain('<!DOCTYPE html>');
    expect(bundled).toContain('<title>NodeStack — Admin Dashboard</title>');

    // External link and script tags should be replaced with inlined tags
    expect(bundled).not.toContain('<link rel="stylesheet" href="./css/main.css">');
    expect(bundled).not.toContain('<script src="./js/app.js"></script>');

    // Should contain inlined styles
    expect(bundled).toContain('<style>');
    expect(bundled).toContain(':root {');
    expect(bundled).toContain('.rules-container');

    // Should contain inlined JavaScript modules
    expect(bundled).toContain('<script>');
    expect(bundled).toContain('const state =');
    expect(bundled).toContain('function renderAccessRulesSection');
    expect(bundled).toContain('function renderSchemaView');
    expect(bundled).toContain('function openNewRecordModal');
    expect(bundled).toContain('function renderHomeView');

    // Records Data Grid Usability enhancements
    expect(bundled).toContain('id="drawer-root"');
    expect(bundled).toContain('function updatePaginationControls');
    expect(bundled).toContain('function changeRecordsPage');
    expect(bundled).toContain('function changeRecordsPerPage');
    expect(bundled).toContain('function goToRecordsPage');
    expect(bundled).toContain('function buildSearchFilter');
    expect(bundled).toContain('function handleSearchFieldChange');
    expect(bundled).toContain('function toggleSort');
    expect(bundled).toContain('function openRecordDrawer');
    expect(bundled).toContain('function closeRecordDrawer');
    expect(bundled).toContain('function renderDrawerContent');
    expect(bundled).toContain('function handleHeaderSort');
    expect(bundled).toContain('function handleRecordRowClick');
    expect(bundled).toContain('function handleDrawerCopyId');
    expect(bundled).toContain('function handleDrawerCopyJsonField');
    expect(bundled).toContain('FilterCodec');
    expect(bundled).toContain('function encodeFilterString');
    expect(bundled).toContain('function decodeFilterString');
    expect(bundled).toContain('search-bar-composite');
    expect(bundled).toContain('pagination-footer');
    expect(bundled).toContain('th-sortable');
    expect(bundled).toContain('th-sort-btn');
    expect(bundled).toContain('aria-sort');
    expect(bundled).toContain('record-drawer');
    expect(bundled).toContain('role="dialog"');
    expect(bundled).toContain('aria-modal="true"');
    expect(bundled).toContain('aria-labelledby="record-drawer-title"');
    expect(bundled).toContain('id="drawer-close-btn"');
    expect(bundled).toContain('function handleRecordRowKeyDown');
    expect(bundled).toContain('function handleDrawerKeyDown');
    expect(bundled).toContain('function focusDrawerOnOpen');

    // Navigation, Spatial Awareness & Wayfinding enhancements
    expect(bundled).toContain('id="sidebar-collection-filter"');
    expect(bundled).toContain('id="collection-filter-input"');
    expect(bundled).toContain('group-user-collections');
    expect(bundled).toContain('group-system-tables');
    expect(bundled).toContain('function handleCollectionFilterInput');
    expect(bundled).toContain('function toggleCollectionSection');
    expect(bundled).toContain('id="breadcrumb-nav"');
    expect(bundled).toContain('id="breadcrumb-trail"');
    expect(bundled).toContain('function updateBreadcrumbs');
    expect(bundled).toContain('id="command-palette-root"');
    expect(bundled).toContain('function openCommandPalette');
    expect(bundled).toContain('function toggleCommandPalette');
    expect(bundled).toContain('function filterCommandPaletteItems');
  });

  it('should return empty string if directory or index.html is missing', () => {
    const nonExistentDir = path.resolve(__dirname, 'non_existent_dir_12345');
    const bundled = AdminUIBundler.bundle(nonExistentDir);
    expect(bundled).toBe('');
  });
});

describe('AdminUIService', () => {
  it('should serve bundled HTML with getHtml()', () => {
    const service = new AdminUIService();
    const html = service.getHtml();

    expect(html).toBeDefined();
    expect(html).toContain('NodeStack — Admin Dashboard');
    expect(html).toContain('const state =');
    expect(html).toContain('API Access Rules');
  });
});

describe('Records Data Grid DOM Interactions & Accessibility (Browser/DOM Environment)', () => {
  function createAdminUIDOM(options: {
    collection?: any;
    records?: any[];
    total?: number;
    page?: number;
    perPage?: number;
  } = {}) {
    const uiDir = path.resolve(__dirname, '../src/admin/ui');
    const bundledHtml = AdminUIBundler.bundle(uiDir);

    const dom = new JSDOM(bundledHtml, {
      url: 'http://localhost:8090/_/',
      runScripts: 'dangerously',
      beforeParse(window: any) {
        window.fetch = vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/api/admins/has-admins')) {
            return { ok: true, json: async () => ({ hasAdmins: true }) };
          }
          return { ok: true, json: async () => ({ items: [], totalItems: 0 }) };
        });
      },
    });

    const win = dom.window as any;
    const doc = win.document;

    // Mock API caller to prevent real HTTP calls during DOM tests
    win.api = vi.fn().mockImplementation(async () => ({
      items: [],
      totalItems: 0,
      totalPages: 1,
    }));

    const col = options.collection || {
      name: 'articles',
      type: 'base',
      schema: [
        { id: 'f_title', name: 'title', type: 'text' },
        { id: 'f_author', name: 'author', type: 'email' },
        { id: 'f_url', name: 'website', type: 'url' },
        { id: 'f_views', name: 'views', type: 'number' },
      ],
    };

    const records = options.records || [
      { id: 'rec_01', title: 'First Article', author: 'alice@example.com', website: 'https://alice.io', views: 42, created: '2026-01-01T10:00:00.000Z' },
      { id: 'rec_02', title: 'Second Article', author: 'bob@example.com', website: 'https://bob.dev', views: 120, created: '2026-01-02T10:00:00.000Z' },
    ];

    win.state.activeCollection = col;
    win.state.records = records;
    win.state.recordsTotal = options.total ?? records.length;
    win.state.recordsPage = options.page ?? 1;
    win.state.recordsPerPage = options.perPage ?? 25;
    win.state.recordsTotalPages = Math.max(1, Math.ceil(win.state.recordsTotal / win.state.recordsPerPage));

    win.renderRecordsView();
    win.renderRecordsTable();
    win.updatePaginationControls();

    return { dom, win, doc, col, records };
  }

  describe('Multi-Column Search Bar & Active Indicator Interactions', () => {
    it('should change search field on dropdown selection and update state', () => {
      const { win, doc } = createAdminUIDOM();
      const select = doc.getElementById('records-search-field') as HTMLSelectElement;
      expect(select).not.toBeNull();
      expect(select.value).toBe('_all');

      // Select 'author' column
      select.value = 'author';
      select.dispatchEvent(new win.Event('change'));
      expect(win.state.recordsSearchField).toBe('author');
      expect(win.state.recordsPage).toBe(1);
    });

    it('should update search term, display active badge, and clear search upon clicking clear button', () => {
      const { win, doc } = createAdminUIDOM();
      const searchInput = doc.getElementById('records-search') as HTMLInputElement;
      const indicator = doc.getElementById('search-active-indicator') as HTMLElement;
      const clearBtn = doc.getElementById('search-clear-btn') as HTMLElement;

      expect(searchInput).not.toBeNull();
      expect(indicator.style.display).toBe('none');
      expect(clearBtn.style.display).toBe('none');

      // Enter search query
      searchInput.value = 'First';
      searchInput.dispatchEvent(new win.Event('input'));
      expect(win.state.recordsSearchTerm).toBe('First');
      expect(indicator.style.display).toBe('inline-flex');
      expect(indicator.textContent).toContain('Filtering by');
      expect(indicator.textContent).toContain('First');
      expect(clearBtn.style.display).toBe('block');

      // Click clear button
      clearBtn.click();
      expect(win.state.recordsSearchTerm).toBe('');
      expect(searchInput.value).toBe('');
      expect(indicator.style.display).toBe('none');
      expect(clearBtn.style.display).toBe('none');
    });

    it('should build proper multi-column and single-column search filters with escaping', () => {
      const { win } = createAdminUIDOM();
      const col = win.state.activeCollection;

      // Default '_all': joins all searchable fields (title, author, website) with ||
      const allFilter = win.buildSearchFilter("O'Reilly", '_all', col);
      expect(allFilter).toBe("title ~ 'O\\'Reilly' || author ~ 'O\\'Reilly' || website ~ 'O\\'Reilly'");

      // Specific field: searches only that field
      const fieldFilter = win.buildSearchFilter('alice', 'author', col);
      expect(fieldFilter).toBe("author ~ 'alice'");

      // Empty string returns empty filter
      expect(win.buildSearchFilter('', '_all', col)).toBe('');
      expect(win.buildSearchFilter('   ', '_all', col)).toBe('');
    });
  });

  describe('Clickable Column Sorting & Accessibility Attributes', () => {
    it('should render accessible button inside th with initial aria-sort="none"', () => {
      const { doc } = createAdminUIDOM();
      const titleTh = doc.querySelector('th.th-sortable[data-column="title"]') as HTMLElement;
      expect(titleTh).not.toBeNull();
      expect(titleTh.getAttribute('aria-sort')).toBe('none');

      const sortBtn = titleTh.querySelector('button.th-sort-btn') as HTMLElement;
      expect(sortBtn).not.toBeNull();
      expect(sortBtn.getAttribute('type')).toBe('button');
      expect(sortBtn.getAttribute('data-column')).toBe('title');
      expect(sortBtn.getAttribute('aria-label')).toContain('Sort by title');
    });

    it('should toggle sort between ascending and descending on button click and update aria-sort', () => {
      const { win, doc } = createAdminUIDOM();
      const titleBtn = doc.querySelector('button.th-sort-btn[data-column="title"]') as HTMLElement;

      // Click 1: sort ascending
      titleBtn.click();
      expect(win.state.recordsSort).toBe('title');
      expect(win.state.recordsPage).toBe(1);

      win.renderRecordsTable();
      const thAsc = doc.querySelector('th.th-sortable[data-column="title"]') as HTMLElement;
      expect(thAsc.getAttribute('aria-sort')).toBe('ascending');
      expect(thAsc.className).toContain('sort-active');
      expect(thAsc.className).toContain('sort-asc');
      expect(thAsc.querySelector('.sort-icon')?.textContent).toContain('↑');

      // Click 2: sort descending
      const titleBtnAsc = thAsc.querySelector('button.th-sort-btn') as HTMLElement;
      titleBtnAsc.click();
      expect(win.state.recordsSort).toBe('-title');

      win.renderRecordsTable();
      const thDesc = doc.querySelector('th.th-sortable[data-column="title"]') as HTMLElement;
      expect(thDesc.getAttribute('aria-sort')).toBe('descending');
      expect(thDesc.className).toContain('sort-active');
      expect(thDesc.className).toContain('sort-desc');
      expect(thDesc.querySelector('.sort-icon')?.textContent).toContain('↓');
    });
  });

  describe('Pagination Controls, Counter & Clamping', () => {
    it('should render pagination controls with record range and button states', () => {
      const { doc } = createAdminUIDOM({ total: 60, page: 1, perPage: 25 });
      const footer = doc.getElementById('records-pagination') as HTMLElement;
      expect(footer).not.toBeNull();
      expect(footer.textContent).toContain('Showing 1–25 of 60 records');

      const prevBtn = doc.getElementById('btn-page-prev') as HTMLButtonElement;
      const nextBtn = doc.getElementById('btn-page-next') as HTMLButtonElement;
      expect(prevBtn.disabled).toBe(true);
      expect(nextBtn.disabled).toBe(false);
    });

    it('should advance page on Next button click and update bounds', () => {
      const { win, doc } = createAdminUIDOM({ total: 60, page: 1, perPage: 25 });
      const nextBtn = doc.getElementById('btn-page-next') as HTMLButtonElement;
      nextBtn.click();
      expect(win.state.recordsPage).toBe(2);

      // On last page (page 3)
      win.state.recordsPage = 3;
      win.updatePaginationControls();
      const nextBtnLast = doc.getElementById('btn-page-next') as HTMLButtonElement;
      expect(nextBtnLast.disabled).toBe(true);
    });

    it('should change rows per page and reset page to 1', () => {
      const { win, doc } = createAdminUIDOM({ total: 60, page: 2, perPage: 25 });
      const perPageSelect = doc.getElementById('records-per-page') as HTMLSelectElement;
      expect(perPageSelect.value).toBe('25');

      perPageSelect.value = '50';
      perPageSelect.dispatchEvent(new win.Event('change'));
      expect(win.state.recordsPerPage).toBe(50);
      expect(win.state.recordsPage).toBe(1);
    });

    it('should jump to page via input and clamp out-of-range values', () => {
      const { win, doc } = createAdminUIDOM({ total: 60, page: 1, perPage: 25 });
      const jumpInput = doc.getElementById('page-jump-input') as HTMLInputElement;

      // Jump to page 2
      jumpInput.value = '2';
      jumpInput.dispatchEvent(new win.Event('change'));
      expect(win.state.recordsPage).toBe(2);

      // Clamp out-of-range number (total 60 / 25 = 3 pages max)
      jumpInput.value = '999';
      jumpInput.dispatchEvent(new win.Event('change'));
      expect(win.state.recordsPage).toBe(3);

      // Clamp lower bound (< 1)
      jumpInput.value = '0';
      jumpInput.dispatchEvent(new win.Event('change'));
      expect(win.state.recordsPage).toBe(1);
    });
  });

  describe('Slide-Over Record Detail Drawer & A11y Focus Management', () => {
    it('should render table rows with keyboard accessibility attributes', () => {
      const { doc } = createAdminUIDOM();
      const row = doc.querySelector('tr.record-row[data-id="rec_01"]') as HTMLElement;
      expect(row).not.toBeNull();
      expect(row.getAttribute('role')).toBe('button');
      expect(row.getAttribute('tabindex')).toBe('0');
      expect(row.getAttribute('aria-label')).toBe('Record rec_01, press Enter to view details');
      expect(row.getAttribute('onclick')).toBe('handleRecordRowClick(this)');
      expect(row.getAttribute('onkeydown')).toBe('handleRecordRowKeyDown(event, this)');
    });

    it('should open drawer on row click with dialog semantics and close on close button click', () => {
      const { win, doc } = createAdminUIDOM();
      const row = doc.querySelector('tr.record-row[data-id="rec_01"]') as HTMLElement;

      // Click row
      row.click();
      expect(win.state.selectedRecordId).toBe('rec_01');

      // Verify drawer DOM and WAI-ARIA dialog semantics
      const panel = doc.getElementById('record-drawer-panel') as HTMLElement;
      expect(panel).not.toBeNull();
      expect(panel.getAttribute('role')).toBe('dialog');
      expect(panel.getAttribute('aria-modal')).toBe('true');
      expect(panel.getAttribute('aria-labelledby')).toBe('record-drawer-title');
      expect(panel.getAttribute('tabindex')).toBe('-1');

      const backdrop = doc.getElementById('record-drawer-backdrop') as HTMLElement;
      expect(backdrop).not.toBeNull();
      expect(backdrop.getAttribute('aria-hidden')).toBe('true');

      // Verify drawer title and close button
      const title = doc.getElementById('record-drawer-title') as HTMLElement;
      expect(title).not.toBeNull();
      expect(title.textContent).toBe('Record Details');

      const closeBtn = doc.getElementById('drawer-close-btn') as HTMLElement;
      expect(closeBtn).not.toBeNull();
      expect(closeBtn.getAttribute('aria-label')).toBe('Close drawer');

      // Click close button
      closeBtn.click();
      expect(win.state.selectedRecordId).toBeNull();
    });

    it('should open drawer via Enter or Space keydown on row but ignore inner action buttons', () => {
      const { win, doc } = createAdminUIDOM();
      const row = doc.querySelector('tr.record-row[data-id="rec_01"]') as HTMLElement;

      // 1. Enter key opens drawer
      row.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(win.state.selectedRecordId).toBe('rec_01');

      win.closeRecordDrawer();
      expect(win.state.selectedRecordId).toBeNull();

      // 2. Space key opens drawer
      row.dispatchEvent(new win.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      expect(win.state.selectedRecordId).toBe('rec_01');

      win.closeRecordDrawer();
      expect(win.state.selectedRecordId).toBeNull();

      // 3. Enter key on inner action button (Edit) does NOT open drawer
      const editBtn = row.querySelector('button[title="Edit record"]') as HTMLElement;
      expect(editBtn).not.toBeNull();
      editBtn.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(win.state.selectedRecordId).toBeNull();
    });

    it('should restore focus to triggering row when drawer is closed', () => {
      const { win, doc } = createAdminUIDOM();
      const row = doc.querySelector('tr.record-row[data-id="rec_01"]') as HTMLElement;
      row.focus();
      expect(doc.activeElement).toBe(row);

      // Open drawer
      row.click();
      expect(win.state.selectedRecordId).toBe('rec_01');

      // Close drawer
      win.closeRecordDrawer();
      expect(win.state.selectedRecordId).toBeNull();
      expect(doc.activeElement).toBe(row);
    });

    it('should trap focus within drawer on Tab and Shift+Tab and close on Escape key', () => {
      const { win, doc } = createAdminUIDOM();
      const row = doc.querySelector('tr.record-row[data-id="rec_01"]') as HTMLElement;
      row.click();

      const panel = doc.getElementById('record-drawer-panel') as HTMLElement;
      const closeBtn = doc.getElementById('drawer-close-btn') as HTMLElement;
      expect(panel).not.toBeNull();
      expect(closeBtn).not.toBeNull();

      const focusable = panel.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      expect(focusable.length).toBeGreaterThan(1);
      const firstFocusable = focusable[0] as HTMLElement;
      const lastFocusable = focusable[focusable.length - 1] as HTMLElement;

      // Shift+Tab on first element wraps to last element
      firstFocusable.focus();
      win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      expect(doc.activeElement).toBe(lastFocusable);

      // Tab on last element wraps to first element
      lastFocusable.focus();
      win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, bubbles: true }));
      expect(doc.activeElement).toBe(firstFocusable);

      // Escape key closes drawer
      win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(win.state.selectedRecordId).toBeNull();
    });
  });
});

describe('Schema Designer & Visual Rules Builder (schema.js & rules.js)', () => {
  function createSchemaAndRulesDOM(options: {
    collection?: any;
    collections?: any[];
  } = {}) {
    const uiDir = path.resolve(__dirname, '../src/admin/ui');
    const bundledHtml = AdminUIBundler.bundle(uiDir);

    const dom = new JSDOM(bundledHtml, {
      url: 'http://localhost:8090/_/',
      runScripts: 'dangerously',
      beforeParse(window: any) {
        window.fetch = vi.fn().mockImplementation(async () => ({
          ok: true,
          json: async () => ({ items: [], totalItems: 0 }),
        }));
      },
    });

    const win = dom.window as any;
    const doc = win.document;

    const collections = options.collections || [
      { name: 'posts', id: 'col_posts', schema: [] },
      { name: 'users', id: 'col_users', schema: [] },
      { name: 'comments', id: 'col_comments', schema: [] },
    ];

    const col = options.collection || {
      name: 'articles',
      type: 'base',
      schema: [
        { id: 'f_title', name: 'title', type: 'text', required: true, unique: false },
        { id: 'f_views', name: 'views', type: 'number', required: false, unique: false },
        { id: 'f_author', name: 'author', type: 'relation', required: false, unique: false, options: { collectionId: 'col_users' } },
        { id: 'f_status', name: 'status', type: 'select', required: false, unique: false, options: { values: ['draft', 'published'] } },
      ],
      listRule: '',
      viewRule: '',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: null,
    };

    win.state.collections = collections;
    win.state.activeCollection = col;

    win.renderSchemaView();

    return { dom, win, doc, col, collections };
  }

  describe('Field Type Badges & Targeted Configuration', () => {
    it('should prefix field types with clear iconography in dropdown', () => {
      const { doc } = createSchemaAndRulesDOM();
      const typeSelects = doc.querySelectorAll('.field-type-select');
      expect(typeSelects.length).toBe(4);

      const firstSelect = typeSelects[0] as HTMLSelectElement;
      const optionTexts = Array.from(firstSelect.options).map((opt) => opt.textContent);

      expect(optionTexts).toContain('🔤 text');
      expect(optionTexts).toContain('🔢 number');
      expect(optionTexts).toContain('📧 email');
      expect(optionTexts).toContain('📅 date');
      expect(optionTexts).toContain('📎 file');
      expect(optionTexts).toContain('🔗 relation');
    });

    it('should render field type badges with iconography on each field row', () => {
      const { doc } = createSchemaAndRulesDOM();
      const badges = doc.querySelectorAll('.field-type-badge');
      expect(badges.length).toBe(4);

      expect(badges[0].textContent).toContain('🔤');
      expect(badges[1].textContent).toContain('🔢');
      expect(badges[2].textContent).toContain('🔗');
      expect(badges[3].textContent).toContain('📋');
    });

    it('should show target collection dropdown for relation type with collection ID values and collection name labels', () => {
      const { doc } = createSchemaAndRulesDOM();
      const rows = doc.querySelectorAll('.schema-field-row');

      // Row 2 is relation field ('author') with target collectionId: 'col_users'
      const relationRow = rows[2] as HTMLElement;
      const relationConfig = relationRow.querySelector('.field-relation-config');
      expect(relationConfig).not.toBeNull();
      expect(relationConfig?.textContent).toContain('Relates to:');

      const targetSelect = relationConfig?.querySelector('.field-relation-select') as HTMLSelectElement;
      expect(targetSelect).not.toBeNull();
      expect(targetSelect.value).toBe('col_users');

      // Uses collection ID as option values and collection name as option labels
      const optionValues = Array.from(targetSelect.options).map((opt) => opt.value);
      const optionLabels = Array.from(targetSelect.options).map((opt) => opt.textContent);
      expect(optionValues).toEqual(['col_posts', 'col_users', 'col_comments']);
      expect(optionLabels).toEqual(['posts', 'users', 'comments']);
      expect(targetSelect.options.length).toBe(3);
    });

    it('should maintain relation resolution when a target collection is renamed', () => {
      const { win, doc } = createSchemaAndRulesDOM();

      // Existing relation field has stable ID 'col_users'
      win.state.activeCollection.schema[2].options.collectionId = 'col_users';

      // Rename target collection 'users' -> 'members' (same stable ID 'col_users')
      win.state.collections = [
        { name: 'posts', id: 'col_posts', schema: [] },
        { name: 'members', id: 'col_users', schema: [] },
        { name: 'comments', id: 'col_comments', schema: [] },
      ];

      win.renderFieldRows(win.state.activeCollection.schema);

      const relationSelect = doc.querySelectorAll('.schema-field-row')[2].querySelector('.field-relation-select') as HTMLSelectElement;
      expect(relationSelect.value).toBe('col_users');

      const selectedOption = relationSelect.options[relationSelect.selectedIndex];
      // Label reflects new name 'members' without breaking ID reference or showing raw ID
      expect(selectedOption.textContent).toBe('members');
      expect(selectedOption.value).toBe('col_users');
    });

    it('should show allowed options configuration for select type', () => {
      const { doc } = createSchemaAndRulesDOM();
      const rows = doc.querySelectorAll('.schema-field-row');

      // Row 3 is select field ('status')
      const selectRow = rows[3] as HTMLElement;
      const selectConfig = selectRow.querySelector('.field-select-config');
      expect(selectConfig).not.toBeNull();
      expect(selectConfig?.textContent).toContain('Allowed options:');

      const optionsInput = selectConfig?.querySelector('.field-select-values-input') as HTMLInputElement;
      expect(optionsInput).not.toBeNull();
      expect(optionsInput.value).toBe('draft, published');
    });

    it('should dynamically reveal target collection dropdown when switching type to relation', () => {
      const { win, doc } = createSchemaAndRulesDOM();
      const rows = doc.querySelectorAll('.schema-field-row');

      // Row 0 is text field ('title') - initially no relation config
      expect(rows[0].querySelector('.field-relation-config')).toBeNull();

      // Switch row 0 to relation
      const typeSelect = rows[0].querySelector('.field-type-select') as HTMLSelectElement;
      typeSelect.value = 'relation';
      typeSelect.dispatchEvent(new win.Event('change'));

      const updatedRows = doc.querySelectorAll('.schema-field-row');
      const relationConfig = updatedRows[0].querySelector('.field-relation-config');
      expect(relationConfig).not.toBeNull();
      expect(relationConfig?.textContent).toContain('Relates to:');

      const relationSelect = relationConfig?.querySelector('.field-relation-select') as HTMLSelectElement;
      expect(relationSelect).not.toBeNull();
      // Should default to a stable collection ID
      expect(relationSelect.value).toBe('col_posts');
    });

    it('should provide reordering handles (⋮⋮ and up/down arrows) to rearrange columns', () => {
      const { win, doc } = createSchemaAndRulesDOM();
      const rows = doc.querySelectorAll('.schema-field-row');

      // Verify drag handle ⋮⋮ and up/down buttons exist on rows
      for (const row of rows) {
        expect(row.querySelector('.field-drag-handle')?.textContent).toContain('⋮⋮');
        expect(row.querySelector('.btn-field-up')).not.toBeNull();
        expect(row.querySelector('.btn-field-down')).not.toBeNull();
      }

      // Initial column order: title (0), views (1), author (2), status (3)
      expect(win.state.activeCollection.schema[0].name).toBe('title');
      expect(win.state.activeCollection.schema[1].name).toBe('views');

      // Click down button on first row (title)
      const firstDownBtn = rows[0].querySelector('.btn-field-down') as HTMLButtonElement;
      firstDownBtn.click();

      // Order should now be: views (0), title (1)
      expect(win.state.activeCollection.schema[0].name).toBe('views');
      expect(win.state.activeCollection.schema[1].name).toBe('title');

      // Click up button on second row (title)
      const secondUpBtn = doc.querySelectorAll('.schema-field-row')[1].querySelector('.btn-field-up') as HTMLButtonElement;
      secondUpBtn.click();

      // Order restored: title (0), views (1)
      expect(win.state.activeCollection.schema[0].name).toBe('title');
      expect(win.state.activeCollection.schema[1].name).toBe('views');
    });

    it('should support drag-and-drop reordering with dataTransfer stub and ignore invalid/no-source drops', () => {
      const { win, doc } = createSchemaAndRulesDOM();

      // DataTransfer stub with event recording
      function createDataTransferStub() {
        const store: Record<string, string> = {};
        return {
          effectAllowed: 'none',
          dropEffect: 'none',
          setData: vi.fn((format: string, val: string) => {
            store[format] = String(val);
          }),
          getData: vi.fn((format: string) => store[format] || ''),
          clearData: vi.fn(() => {
            for (const k of Object.keys(store)) delete store[k];
          }),
        };
      }

      function dispatchDragEvent(target: Element, type: string, dt?: any) {
        const evt = new win.Event(type, { bubbles: true, cancelable: true });
        if (dt !== undefined) {
          Object.defineProperty(evt, 'dataTransfer', {
            value: dt,
            writable: true,
            configurable: true,
          });
        }
        target.dispatchEvent(evt);
        return evt;
      }

      // Initial column order: ['title', 'views', 'author', 'status']
      expect(win.state.activeCollection.schema.map((f: any) => f.name)).toEqual([
        'title',
        'views',
        'author',
        'status',
      ]);

      // 1. Drag start on row 0 (title)
      const rows = doc.querySelectorAll('.schema-field-row');
      const dt1 = createDataTransferStub();
      dispatchDragEvent(rows[0], 'dragstart', dt1);
      expect(dt1.effectAllowed).toBe('move');
      expect(dt1.setData).toHaveBeenCalledWith('text/plain', '0');

      // 2. Drag over row 2 (author)
      const dragOverEvt = dispatchDragEvent(rows[2], 'dragover', dt1);
      expect(dragOverEvt.defaultPrevented).toBe(true);
      expect(dt1.dropEffect).toBe('move');

      // 3. Drop on row 2 (author) -> moves index 0 to index 2
      const dropEvt = dispatchDragEvent(rows[2], 'drop', dt1);
      expect(dropEvt.defaultPrevented).toBe(true);

      // Order should now be: ['views', 'author', 'title', 'status']
      expect(win.state.activeCollection.schema.map((f: any) => f.name)).toEqual([
        'views',
        'author',
        'title',
        'status',
      ]);

      // Verify DOM rows reflect new order
      let updatedRows = doc.querySelectorAll('.schema-field-row');
      expect(
        Array.from(updatedRows).map(
          (r) => (r.querySelector('.field-name-input') as HTMLInputElement).value
        )
      ).toEqual(['views', 'author', 'title', 'status']);

      // 4. Drag & drop carrying payload via dataTransfer directly (without prior in-memory dragstart)
      const dt2 = createDataTransferStub();
      dt2.setData('text/plain', '3'); // 'status' at index 3
      dispatchDragEvent(doc.querySelectorAll('.schema-field-row')[0], 'drop', dt2); // drop on index 0

      // Order should now be: ['status', 'views', 'author', 'title']
      expect(win.state.activeCollection.schema.map((f: any) => f.name)).toEqual([
        'status',
        'views',
        'author',
        'title',
      ]);

      // 5. Drag start followed by dragend cleans up draggedFieldIdx
      const dt3 = createDataTransferStub();
      dispatchDragEvent(doc.querySelectorAll('.schema-field-row')[1], 'dragstart', dt3);
      dispatchDragEvent(doc.querySelectorAll('.schema-field-row')[1], 'dragend');

      // 6. Invalid / No-source drop assertions: schema order must NOT mutate
      const validOrder = ['status', 'views', 'author', 'title'];

      // (a) Empty dataTransfer / no source
      const emptyDt = createDataTransferStub();
      dispatchDragEvent(doc.querySelectorAll('.schema-field-row')[1], 'drop', emptyDt);
      expect(win.state.activeCollection.schema.map((f: any) => f.name)).toEqual(validOrder);

      // (b) Non-numeric / invalid string payload
      const invalidDt = createDataTransferStub();
      invalidDt.setData('text/plain', 'not-a-number');
      dispatchDragEvent(doc.querySelectorAll('.schema-field-row')[2], 'drop', invalidDt);
      expect(win.state.activeCollection.schema.map((f: any) => f.name)).toEqual(validOrder);

      // (c) Dropping onto itself (sourceIdx === targetIdx)
      const sameTargetDt = createDataTransferStub();
      sameTargetDt.setData('text/plain', '1');
      dispatchDragEvent(doc.querySelectorAll('.schema-field-row')[1], 'drop', sameTargetDt);
      expect(win.state.activeCollection.schema.map((f: any) => f.name)).toEqual(validOrder);

      // (d) Out-of-bounds source index
      const outOfBoundsDt = createDataTransferStub();
      outOfBoundsDt.setData('text/plain', '99');
      dispatchDragEvent(doc.querySelectorAll('.schema-field-row')[0], 'drop', outOfBoundsDt);
      expect(win.state.activeCollection.schema.map((f: any) => f.name)).toEqual(validOrder);

      // (e) Event with missing / null dataTransfer
      dispatchDragEvent(doc.querySelectorAll('.schema-field-row')[1], 'drop', undefined);
      expect(win.state.activeCollection.schema.map((f: any) => f.name)).toEqual(validOrder);
    });
  });

  describe('Natural-Language Rule Summaries', () => {
    it('should display human-readable translation beneath active preset for Public, Auth, and Admin', () => {
      const { doc } = createSchemaAndRulesDOM();

      // listRule is '' -> Public
      const listCard = doc.getElementById('rule-card-list');
      expect(listCard).not.toBeNull();
      expect(listCard?.textContent).toContain('Anyone can read this without authentication (unrestricted).');

      // createRule is '@request.auth.id != ""' -> Auth
      const createCard = doc.getElementById('rule-card-create');
      expect(createCard).not.toBeNull();
      expect(createCard?.textContent).toContain('Only logged-in users with a valid token can access.');

      // deleteRule is null -> Admin
      const deleteCard = doc.getElementById('rule-card-delete');
      expect(deleteCard).not.toBeNull();
      expect(deleteCard?.textContent).toContain('Restricted strictly to superuser admins.');
    });

    it('should update human-readable translation dynamically when switching presets', () => {
      const { doc } = createSchemaAndRulesDOM();

      // deleteRule starts as Admin
      const deleteCard = doc.getElementById('rule-card-delete') as HTMLElement;
      const summaryEl = deleteCard.querySelector('#rule-preset-summary-delete');
      expect(summaryEl?.textContent).toContain('Restricted strictly to superuser admins.');

      // Click Public preset button
      const publicBtn = deleteCard.querySelector('button[onclick*="\'delete\', \'public\'"]') as HTMLButtonElement;
      expect(publicBtn).not.toBeNull();
      publicBtn.click();

      // Translation updates to Public with action-aware wording on delete card
      const updatedDeleteCard = doc.getElementById('rule-card-delete') as HTMLElement;
      const updatedSummary = updatedDeleteCard.querySelector('#rule-preset-summary-delete');
      expect(updatedSummary?.textContent).toContain('Anyone can delete records without authentication (unrestricted).');

      // Banner on delete card also uses action-aware wording
      const bannerEl = updatedDeleteCard.querySelector('.rule-status-banner.public');
      expect(bannerEl?.textContent).toContain('Anyone can delete records without authentication (unrestricted).');

      // Click Auth preset button
      const authBtn = updatedDeleteCard.querySelector('button[onclick*="\'delete\', \'auth\'"]') as HTMLButtonElement;
      authBtn.click();

      const authCard = doc.getElementById('rule-card-delete') as HTMLElement;
      const authSummary = authCard.querySelector('#rule-preset-summary-delete');
      expect(authSummary?.textContent).toContain('Only logged-in users with a valid token can access.');
    });

    it('should use action-aware wording across create, update, and delete rule cards', () => {
      const { win, doc } = createSchemaAndRulesDOM();

      // Create card set to Public
      win.setRulePreset('create', 'public');
      const createCard = doc.getElementById('rule-card-create');
      expect(createCard?.textContent).toContain('Anyone can create records without authentication (unrestricted).');
      expect(createCard?.querySelector('.rule-status-banner.public')?.textContent).toContain('Anyone can create records without authentication (unrestricted).');

      // Update card set to Public
      win.setRulePreset('update', 'public');
      const updateCard = doc.getElementById('rule-card-update');
      expect(updateCard?.textContent).toContain('Anyone can update records without authentication (unrestricted).');
      expect(updateCard?.querySelector('.rule-status-banner.public')?.textContent).toContain('Anyone can update records without authentication (unrestricted).');

      // Delete card set to Public
      win.setRulePreset('delete', 'public');
      const deleteCard = doc.getElementById('rule-card-delete');
      expect(deleteCard?.textContent).toContain('Anyone can delete records without authentication (unrestricted).');
      expect(deleteCard?.querySelector('.rule-status-banner.public')?.textContent).toContain('Anyone can delete records without authentication (unrestricted).');

      // List & View cards use read wording
      const listCard = doc.getElementById('rule-card-list');
      expect(listCard?.textContent).toContain('Anyone can read this without authentication (unrestricted).');
    });
  });
});


