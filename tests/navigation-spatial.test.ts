import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { AdminUIBundler } from '../src/admin/AdminUIBundler';

describe('Navigation, Spatial Awareness & Wayfinding', () => {
  const uiDir = path.resolve(__dirname, '../src/admin/ui');

  function createTestDOM(options: {
    collections?: any[];
    activeNav?: string;
    activeCollection?: any;
    collectionTab?: string;
  } = {}) {
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

    win.api = vi.fn().mockImplementation(async () => ({
      items: [],
      totalItems: 0,
      totalPages: 1,
    }));

    const mockCollections = options.collections || [
      { name: 'products', type: 'base', system: false, schema: [] },
      { name: 'users', type: 'auth', system: false, schema: [] },
      { name: 'orders', type: 'base', system: false, schema: [] },
      { name: '_admins', type: 'auth', system: true, schema: [] },
    ];

    win.state.collections = mockCollections;
    win.state.activeNav = options.activeNav || 'home';
    win.state.activeCollection = options.activeCollection || null;
    win.state.collectionTab = options.collectionTab || 'records';

    win.renderCollectionsList();
    win.updateBreadcrumbs();

    return { dom, win, doc, mockCollections };
  }

  describe('Sidebar Collection Filter & Categorization', () => {
    it('should group collections into User Collections and System Tables (_admins)', () => {
      const { doc } = createTestDOM();

      const userGroup = doc.getElementById('group-user-collections');
      const systemGroup = doc.getElementById('group-system-tables');
      expect(userGroup).not.toBeNull();
      expect(systemGroup).not.toBeNull();

      // Check header titles and counts
      expect(userGroup.textContent).toContain('User Collections');
      expect(userGroup.querySelector('.collection-group-count').textContent).toBe('3');

      expect(systemGroup.textContent).toContain('System Tables');
      expect(systemGroup.querySelector('.collection-group-count').textContent).toBe('1');

      // Check user items container
      const userItems = doc.querySelectorAll('#group-items-user .collection-item');
      expect(userItems.length).toBe(3);
      const userNames = Array.from(userItems).map((el: any) => el.textContent.trim());
      expect(userNames.some(t => t.includes('products'))).toBe(true);
      expect(userNames.some(t => t.includes('users'))).toBe(true);
      expect(userNames.some(t => t.includes('orders'))).toBe(true);

      // Check system items container
      const systemItems = doc.querySelectorAll('#group-items-system .collection-item');
      expect(systemItems.length).toBe(1);
      expect(systemItems[0].textContent).toContain('_admins');
    });

    it('should filter collections dynamically when typing into collection-filter-input', () => {
      const { win, doc } = createTestDOM();
      const input = doc.getElementById('collection-filter-input') as HTMLInputElement;
      const clearBtn = doc.getElementById('collection-filter-clear-btn') as HTMLElement;

      expect(input).not.toBeNull();
      expect(clearBtn.style.display).toBe('none');

      // 1. Type "ord" -> matches "orders" in user collections, 0 in system
      input.value = 'ord';
      win.handleCollectionFilterInput('ord');

      expect(win.state.collectionFilterTerm).toBe('ord');
      expect(clearBtn.style.display).toBe('inline-flex');

      let userItems = doc.querySelectorAll('#group-items-user .collection-item');
      let systemItems = doc.querySelectorAll('#group-items-system .collection-item');
      expect(userItems.length).toBe(1);
      expect(userItems[0].textContent).toContain('orders');
      expect(systemItems.length).toBe(0);
      expect(doc.querySelector('#group-items-system .collection-group-empty')?.textContent).toContain('No matching system tables');

      // 2. Type "admin" -> matches "_admins" in system tables, 0 in user collections
      input.value = 'admin';
      win.handleCollectionFilterInput('admin');

      userItems = doc.querySelectorAll('#group-items-user .collection-item');
      systemItems = doc.querySelectorAll('#group-items-system .collection-item');
      expect(userItems.length).toBe(0);
      expect(doc.querySelector('#group-items-user .collection-group-empty')?.textContent).toContain('No matching collections');
      expect(systemItems.length).toBe(1);
      expect(systemItems[0].textContent).toContain('_admins');

      // 3. Clear filter using clear button
      clearBtn.click();
      expect(win.state.collectionFilterTerm).toBe('');
      expect(input.value).toBe('');
      expect(clearBtn.style.display).toBe('none');

      userItems = doc.querySelectorAll('#group-items-user .collection-item');
      systemItems = doc.querySelectorAll('#group-items-system .collection-item');
      expect(userItems.length).toBe(3);
      expect(systemItems.length).toBe(1);
    });

    it('should collapse and expand collection sections when clicking section headers', () => {
      const { win, doc } = createTestDOM();

      const userHeader = doc.querySelector('#group-user-collections .collection-group-header') as HTMLElement;
      const userItemsBox = doc.getElementById('group-items-user') as HTMLElement;
      expect(userItemsBox.classList.contains('collapsed')).toBe(false);

      // Click to collapse
      userHeader.click();
      expect(win.state.collapsedSections.user).toBe(true);
      const userItemsBoxAfter = doc.getElementById('group-items-user') as HTMLElement;
      expect(userItemsBoxAfter.classList.contains('collapsed')).toBe(true);

      // Click again to expand
      const userHeaderAgain = doc.querySelector('#group-user-collections .collection-group-header') as HTMLElement;
      userHeaderAgain.click();
      expect(win.state.collapsedSections.user).toBe(false);
      const userItemsBoxExpanded = doc.getElementById('group-items-user') as HTMLElement;
      expect(userItemsBoxExpanded.classList.contains('collapsed')).toBe(false);
    });

    it('should fix active state bug: clicking a collection removes .active from Analytics and Snapshots tabs', async () => {
      const { win, doc } = createTestDOM();

      // First set Analytics tab active
      await win.selectNav('analytics');
      expect(doc.getElementById('nav-analytics')?.classList.contains('active')).toBe(true);
      expect(doc.getElementById('nav-snapshots')?.classList.contains('active')).toBe(false);

      // Now click/select "products" collection
      await win.selectCollection('products');

      // Analytics must NOT have .active anymore!
      expect(doc.getElementById('nav-analytics')?.classList.contains('active')).toBe(false);
      expect(doc.getElementById('nav-snapshots')?.classList.contains('active')).toBe(false);
      expect(doc.getElementById('nav-home')?.classList.contains('active')).toBe(false);
      expect(doc.getElementById('nav-logs')?.classList.contains('active')).toBe(false);
      expect(doc.getElementById('nav-settings')?.classList.contains('active')).toBe(false);

      // Products collection item must have .active
      const activeColItem = doc.querySelector('.collection-item.active');
      expect(activeColItem).not.toBeNull();
      expect(activeColItem?.textContent).toContain('products');

      // Now switch to Snapshots tab
      await win.selectNav('snapshots');
      expect(doc.getElementById('nav-snapshots')?.classList.contains('active')).toBe(true);
      expect(doc.querySelector('.collection-item.active')).toBeNull();

      // Select "_admins" collection
      await win.selectCollection('_admins');
      expect(doc.getElementById('nav-snapshots')?.classList.contains('active')).toBe(false);
      expect(doc.getElementById('nav-analytics')?.classList.contains('active')).toBe(false);
      const adminColItem = doc.querySelector('.collection-item.active');
      expect(adminColItem?.textContent).toContain('_admins');
    });
  });

  describe('Breadcrumb Top Bar Navigation', () => {
    it('should render "Dashboard / Collections / products / Records" when in collection records view', async () => {
      const { win, doc } = createTestDOM();

      await win.selectCollection('products');
      win.switchCollectionTab('records');

      const trail = doc.getElementById('breadcrumb-trail') as HTMLElement;
      expect(trail).not.toBeNull();

      const items = Array.from(trail.querySelectorAll('.breadcrumb-item')).map((el: any) => el.textContent.replace('/', '').trim());
      expect(items).toEqual(['Dashboard', 'Collections', 'products', 'Records']);

      // The last item (Records) should be active
      const activeItem = trail.querySelector('.breadcrumb-item.active');
      expect(activeItem?.textContent).toBe('Records');
    });

    it('should render "Dashboard / Collections / products / Schema & Rules" when in schema view', async () => {
      const { win, doc } = createTestDOM();

      await win.selectCollection('products');
      win.switchCollectionTab('schema');

      const trail = doc.getElementById('breadcrumb-trail') as HTMLElement;
      expect(trail).not.toBeNull();

      const items = Array.from(trail.querySelectorAll('.breadcrumb-item')).map((el: any) => el.textContent.replace('/', '').trim());
      expect(items).toEqual(['Dashboard', 'Collections', 'products', 'Schema & Rules']);

      const activeItem = trail.querySelector('.breadcrumb-item.active');
      expect(activeItem?.textContent).toBe('Schema & Rules');
    });

    it('should navigate when breadcrumb ancestor links are clicked', async () => {
      const { win, doc } = createTestDOM();

      await win.selectCollection('products');
      win.switchCollectionTab('schema');

      // Click "Dashboard" breadcrumb link
      const dashboardLink = doc.querySelector('.breadcrumb-trail a.breadcrumb-link') as HTMLElement;
      expect(dashboardLink).not.toBeNull();
      expect(dashboardLink.textContent).toBe('Dashboard');

      dashboardLink.click();
      expect(win.state.activeNav).toBe('home');
      expect(win.state.activeCollection).toBeNull();

      const homeTrail = doc.getElementById('breadcrumb-trail') as HTMLElement;
      expect(homeTrail.textContent).toContain('Dashboard');
      expect(homeTrail.textContent).toContain('Overview');
    });

    it('should switch back to records tab when collection name link is clicked from schema tab', async () => {
      const { win, doc } = createTestDOM();

      await win.selectCollection('products');
      win.switchCollectionTab('schema');
      expect(win.state.collectionTab).toBe('schema');

      // In schema tab, "products" in breadcrumb should be a link back to records
      const links = doc.querySelectorAll('.breadcrumb-trail a.breadcrumb-link');
      const productsLink = Array.from(links).find((el: any) => el.textContent === 'products') as HTMLElement;
      expect(productsLink).toBeDefined();

      productsLink.click();
      expect(win.state.collectionTab).toBe('records');

      const trail = doc.getElementById('breadcrumb-trail') as HTMLElement;
      expect(trail.textContent).toContain('Records');
    });
  });

  describe('Global Command Palette (Ctrl + K / Cmd + K)', () => {
    it('should toggle command palette on Ctrl+K and Cmd+K keydown', () => {
      const { win, doc } = createTestDOM();

      expect(doc.getElementById('command-palette-backdrop')).toBeNull();

      // Press Ctrl+K
      win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      expect(doc.getElementById('command-palette-backdrop')).not.toBeNull();
      expect(doc.getElementById('command-palette-input')).not.toBeNull();

      // Press Ctrl+K again to toggle closed
      win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      expect(doc.getElementById('command-palette-backdrop')).toBeNull();

      // Press Cmd+K (metaKey)
      win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
      expect(doc.getElementById('command-palette-backdrop')).not.toBeNull();

      // Press Escape to close
      win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(doc.getElementById('command-palette-backdrop')).toBeNull();
    });

    it('should jump to users collection when typing "users" and pressing Enter', async () => {
      const { win, doc } = createTestDOM();

      win.openCommandPalette();
      const input = doc.getElementById('command-palette-input') as HTMLInputElement;

      // Type "users"
      input.value = 'users';
      win.handleCommandPaletteInput('users');

      const results = doc.querySelectorAll('.command-palette-item');
      expect(results.length).toBeGreaterThan(0);

      // Top result should be "users" collection
      const topTitle = results[0].querySelector('.command-palette-item-title')?.textContent;
      expect(topTitle).toBe('users');

      // Press Enter
      input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // Palette should close and active collection should be "users"
      expect(doc.getElementById('command-palette-backdrop')).toBeNull();
      expect(win.state.activeCollection?.name).toBe('users');
      expect(win.state.activeNav).toBe('collection');
    });

    it('should jump to Analytics when typing "metrics" and pressing Enter', async () => {
      const { win, doc } = createTestDOM();

      win.openCommandPalette();
      const input = doc.getElementById('command-palette-input') as HTMLInputElement;

      // Type "metrics"
      input.value = 'metrics';
      win.handleCommandPaletteInput('metrics');

      const results = doc.querySelectorAll('.command-palette-item');
      expect(results.length).toBeGreaterThan(0);

      // Top result should be "Analytics & Metrics"
      const topTitle = results[0].querySelector('.command-palette-item-title')?.textContent;
      expect(topTitle).toBe('Analytics & Metrics');

      // Press Enter
      input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // Palette should close and active nav should be "analytics"
      expect(doc.getElementById('command-palette-backdrop')).toBeNull();
      expect(win.state.activeNav).toBe('analytics');
    });

    it('should trigger current collection export when typing "export" and pressing Enter', async () => {
      const { win, doc } = createTestDOM();

      // Select "products" collection first
      await win.selectCollection('products');

      win.exportData = vi.fn();

      win.openCommandPalette();
      const input = doc.getElementById('command-palette-input') as HTMLInputElement;

      // Type "export"
      input.value = 'export';
      win.handleCommandPaletteInput('export');

      const results = doc.querySelectorAll('.command-palette-item');
      expect(results.length).toBeGreaterThan(0);

      const topTitle = results[0].querySelector('.command-palette-item-title')?.textContent;
      expect(topTitle).toContain('Export products');

      // Press Enter
      input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(doc.getElementById('command-palette-backdrop')).toBeNull();
      expect(win.exportData).toHaveBeenCalledWith('json');
    });

    it('should open New Collection modal when typing "new" and pressing Enter', () => {
      const { win, doc } = createTestDOM();

      win.openNewCollectionModal = vi.fn();

      win.openCommandPalette();
      const input = doc.getElementById('command-palette-input') as HTMLInputElement;

      // Type "new"
      input.value = 'new';
      win.handleCommandPaletteInput('new');

      const results = doc.querySelectorAll('.command-palette-item');
      expect(results.length).toBeGreaterThan(0);

      const topTitle = results[0].querySelector('.command-palette-item-title')?.textContent;
      expect(topTitle).toBe('New Collection');

      // Press Enter
      input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(doc.getElementById('command-palette-backdrop')).toBeNull();
      expect(win.openNewCollectionModal).toHaveBeenCalled();
    });

    it('should support arrow key navigation inside the command palette', () => {
      const { win, doc } = createTestDOM();

      win.openCommandPalette();
      const input = doc.getElementById('command-palette-input') as HTMLInputElement;

      const items = doc.querySelectorAll('.command-palette-item');
      expect(items.length).toBeGreaterThan(2);

      // Initially item 0 is selected
      expect(items[0].classList.contains('selected')).toBe(true);
      expect(items[1].classList.contains('selected')).toBe(false);

      // Arrow Down moves to item 1
      input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(items[0].classList.contains('selected')).toBe(false);
      expect(items[1].classList.contains('selected')).toBe(true);

      // Arrow Up moves back to item 0
      input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      expect(items[0].classList.contains('selected')).toBe(true);
      expect(items[1].classList.contains('selected')).toBe(false);
    });

    it('should stop Escape propagation so pressing Escape in command palette closes only palette, not underlying record drawer', async () => {
      const { win, doc } = createTestDOM();

      // Open a collection and its records view
      await win.selectCollection('products');
      win.state.records = [{ id: 'prod_01', title: 'Test Product', created: '2026-01-01' }];
      win.renderRecordsView();
      win.renderRecordsTable();

      // Open the record detail drawer (which attaches window-level Escape handler)
      win.openRecordDrawer('prod_01');
      expect(win.state.selectedRecordId).toBe('prod_01');
      expect(doc.getElementById('record-drawer-panel')).not.toBeNull();

      // Now open command palette over the drawer
      win.openCommandPalette();
      expect(doc.getElementById('command-palette-backdrop')).not.toBeNull();
      const paletteInput = doc.getElementById('command-palette-input') as HTMLInputElement;

      // Press Escape on the palette input
      const escapeEvent = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      paletteInput.dispatchEvent(escapeEvent);

      // Command palette must be closed
      expect(doc.getElementById('command-palette-backdrop')).toBeNull();

      // Record drawer must STILL BE OPEN!
      expect(win.state.selectedRecordId).toBe('prod_01');
      expect(doc.getElementById('record-drawer-panel')).not.toBeNull();

      // A subsequent Escape now closes the record drawer
      win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(win.state.selectedRecordId).toBeNull();
      const panel = doc.getElementById('record-drawer-panel');
      expect(panel?.classList.contains('open')).toBe(false);
    });
  });
});
