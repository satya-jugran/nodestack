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
      const systemHeader = doc.querySelector('#group-system-tables .collection-group-header') as HTMLElement;
      const userItemsBox = doc.getElementById('group-items-user') as HTMLElement;
      const systemItemsBox = doc.getElementById('group-items-system') as HTMLElement;

      expect(userItemsBox.classList.contains('collapsed')).toBe(false);
      expect(userHeader.getAttribute('aria-expanded')).toBe('true');
      expect(userHeader.getAttribute('aria-controls')).toBe('group-items-user');

      expect(systemItemsBox.classList.contains('collapsed')).toBe(false);
      expect(systemHeader.getAttribute('aria-expanded')).toBe('true');
      expect(systemHeader.getAttribute('aria-controls')).toBe('group-items-system');

      // Click to collapse
      userHeader.click();
      expect(win.state.collapsedSections.user).toBe(true);
      const userItemsBoxAfter = doc.getElementById('group-items-user') as HTMLElement;
      const userHeaderAfter = doc.querySelector('#group-user-collections .collection-group-header') as HTMLElement;
      expect(userItemsBoxAfter.classList.contains('collapsed')).toBe(true);
      expect(userHeaderAfter.getAttribute('aria-expanded')).toBe('false');

      // Click again to expand
      userHeaderAfter.click();
      expect(win.state.collapsedSections.user).toBe(false);
      const userItemsBoxExpanded = doc.getElementById('group-items-user') as HTMLElement;
      const userHeaderExpanded = doc.querySelector('#group-user-collections .collection-group-header') as HTMLElement;
      expect(userItemsBoxExpanded.classList.contains('collapsed')).toBe(false);
      expect(userHeaderExpanded.getAttribute('aria-expanded')).toBe('true');
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
      expect(doc.getElementById('nav-settings')).toBeNull();

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

    it('should have primary sidebar navigation items in order: Overview, Analytics, Collections, Webhooks, Functions, Plugins, Snapshots, Audit Logs', () => {
      const { doc } = createTestDOM();

      const topNav = doc.querySelector('.sidebar > div[style*="flex-direction: column"]') as HTMLElement;
      const navItems = Array.from(topNav.querySelectorAll('.sidebar-nav-item')).map((el: any) => ({
        id: el.id,
        label: el.querySelector('span')?.textContent?.trim(),
      }));

      expect(navItems).toEqual([
        { id: 'nav-home', label: 'Overview' },
        { id: 'nav-analytics', label: 'Analytics' },
        { id: 'nav-collections', label: 'Collections' },
        { id: 'nav-webhooks', label: 'Webhooks' },
        { id: 'nav-functions', label: 'Functions' },
        { id: 'nav-plugins', label: 'Plugins' },
        { id: 'nav-snapshots', label: 'Snapshots' },
        { id: 'nav-logs', label: 'Audit Logs' },
      ]);
    });

    it('should have removed System Info item and page view completely from DOM', () => {
      const { doc } = createTestDOM();

      expect(doc.getElementById('nav-settings')).toBeNull();
      expect(doc.getElementById('page-view-settings')).toBeNull();
      expect(doc.querySelector('.sidebar-bottom')?.textContent).not.toContain('System Info');
    });

    it('should display system uptime in the Analytics header', async () => {
      const { win, doc } = createTestDOM();

      win.api = vi.fn().mockImplementation(async (path: string) => {
        if (path === '/api/metrics') {
          return {
            database: { totalRecords: 120, sizeFormatted: '1.2 MB', collectionsBreakdown: [] },
            realtime: { connectedClients: 3 },
            traffic24h: { totalRequests: 500, series: [] },
            system: { uptime: 3665 },
          };
        }
        return {};
      });

      await win.selectNav('analytics');
      const uptimeTag = doc.getElementById('analytics-uptime-tag');
      const uptimeVal = doc.getElementById('analytics-uptime-val');

      expect(uptimeTag).not.toBeNull();
      expect(uptimeVal).not.toBeNull();
      expect(uptimeVal?.textContent).toBe('1h 1m 5s');
      expect(uptimeTag?.getAttribute('title')).toContain('3665 seconds');
    });
  });

  describe('Breadcrumb Top Bar Navigation', () => {
    it('should render "NodeStack / Collections / products / Records" when in collection records view', async () => {
      const { win, doc } = createTestDOM();

      await win.selectCollection('products');
      win.switchCollectionTab('records');

      const trail = doc.getElementById('breadcrumb-trail') as HTMLElement;
      expect(trail).not.toBeNull();

      const items = Array.from(trail.querySelectorAll('.breadcrumb-item')).map((el: any) => el.textContent.replace('/', '').trim());
      expect(items).toEqual(['NodeStack', 'Collections', 'products', 'Records']);

      // The last item (Records) should be active
      const activeItem = trail.querySelector('.breadcrumb-item.active');
      expect(activeItem?.textContent).toBe('Records');
    });

    it('should render "NodeStack / Collections / products / Schema & Rules" when in schema view', async () => {
      const { win, doc } = createTestDOM();

      await win.selectCollection('products');
      win.switchCollectionTab('schema');

      const trail = doc.getElementById('breadcrumb-trail') as HTMLElement;
      expect(trail).not.toBeNull();

      const items = Array.from(trail.querySelectorAll('.breadcrumb-item')).map((el: any) => el.textContent.replace('/', '').trim());
      expect(items).toEqual(['NodeStack', 'Collections', 'products', 'Schema & Rules']);

      const activeItem = trail.querySelector('.breadcrumb-item.active');
      expect(activeItem?.textContent).toBe('Schema & Rules');
    });

    it('should navigate when breadcrumb ancestor links are clicked', async () => {
      const { win, doc } = createTestDOM();

      await win.selectCollection('products');
      win.switchCollectionTab('schema');

      // Click "NodeStack" breadcrumb link
      const nodeStackLink = doc.querySelector('.breadcrumb-trail a.breadcrumb-link') as HTMLElement;
      expect(nodeStackLink).not.toBeNull();
      expect(nodeStackLink.textContent).toBe('NodeStack');

      nodeStackLink.click();
      expect(win.state.activeNav).toBe('home');
      expect(win.state.activeCollection).toBeNull();

      const homeTrail = doc.getElementById('breadcrumb-trail') as HTMLElement;
      expect(homeTrail.textContent).toContain('NodeStack');
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

    it('should render "NodeStack / Audit Logs" when in audit logs view', async () => {
      const { win, doc } = createTestDOM();

      await win.selectNav('logs');

      const trail = doc.getElementById('breadcrumb-trail') as HTMLElement;
      expect(trail).not.toBeNull();

      const items = Array.from(trail.querySelectorAll('.breadcrumb-item')).map((el: any) => el.textContent.replace('/', '').trim());
      expect(items).toEqual(['NodeStack', 'Audit Logs']);
      expect(doc.getElementById('view-title')?.textContent).toBe('Audit Logs');
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
      expect(topTitle).toBe('Analytics');

      // Press Enter
      input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // Palette should close and active nav should be "analytics"
      expect(doc.getElementById('command-palette-backdrop')).toBeNull();
      expect(win.state.activeNav).toBe('analytics');
    });

    it('should jump to Audit Logs when typing "audit" and pressing Enter', async () => {
      const { win, doc } = createTestDOM();

      win.openCommandPalette();
      const input = doc.getElementById('command-palette-input') as HTMLInputElement;

      // Type "audit"
      input.value = 'audit';
      win.handleCommandPaletteInput('audit');

      const results = doc.querySelectorAll('.command-palette-item');
      expect(results.length).toBeGreaterThan(0);

      // Top result should be "Audit Logs"
      const topTitle = results[0].querySelector('.command-palette-item-title')?.textContent;
      expect(topTitle).toBe('Audit Logs');

      // Press Enter
      input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // Palette should close and active nav should be "logs"
      expect(doc.getElementById('command-palette-backdrop')).toBeNull();
      expect(win.state.activeNav).toBe('logs');
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

    it('should support arrow key and hover navigation inside the command palette with semantic ARIA updates', () => {
      const { win, doc } = createTestDOM();

      win.openCommandPalette();
      const input = doc.getElementById('command-palette-input') as HTMLInputElement;
      const listbox = doc.getElementById('command-palette-results') as HTMLElement;

      expect(input.getAttribute('role')).toBe('combobox');
      expect(input.getAttribute('aria-autocomplete')).toBe('list');
      expect(input.getAttribute('aria-expanded')).toBe('true');
      expect(input.getAttribute('aria-haspopup')).toBe('listbox');
      expect(input.getAttribute('aria-controls')).toBe('command-palette-results');
      expect(input.getAttribute('aria-activedescendant')).toBe('command-palette-item-0');

      expect(listbox.getAttribute('role')).toBe('listbox');
      expect(listbox.getAttribute('aria-label')).toBe('Commands and collections');

      const items = doc.querySelectorAll('.command-palette-item');
      expect(items.length).toBeGreaterThan(2);

      // Verify item roles and initial selection
      expect(items[0].getAttribute('role')).toBe('option');
      expect(items[0].getAttribute('id')).toBe('command-palette-item-0');
      expect(items[0].getAttribute('aria-selected')).toBe('true');
      expect(items[0].classList.contains('selected')).toBe(true);

      expect(items[1].getAttribute('role')).toBe('option');
      expect(items[1].getAttribute('id')).toBe('command-palette-item-1');
      expect(items[1].getAttribute('aria-selected')).toBe('false');
      expect(items[1].classList.contains('selected')).toBe(false);

      // Arrow Down moves to item 1
      input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(items[0].classList.contains('selected')).toBe(false);
      expect(items[0].getAttribute('aria-selected')).toBe('false');
      expect(items[1].classList.contains('selected')).toBe(true);
      expect(items[1].getAttribute('aria-selected')).toBe('true');
      expect(input.getAttribute('aria-activedescendant')).toBe('command-palette-item-1');

      // Arrow Up moves back to item 0
      input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      expect(items[0].classList.contains('selected')).toBe(true);
      expect(items[0].getAttribute('aria-selected')).toBe('true');
      expect(items[1].classList.contains('selected')).toBe(false);
      expect(items[1].getAttribute('aria-selected')).toBe('false');
      expect(input.getAttribute('aria-activedescendant')).toBe('command-palette-item-0');

      // Mouse hover on item 2 via setCommandPaletteActiveIndex
      win.setCommandPaletteActiveIndex(2);
      expect(items[2].classList.contains('selected')).toBe(true);
      expect(items[2].getAttribute('aria-selected')).toBe('true');
      expect(items[0].getAttribute('aria-selected')).toBe('false');
      expect(input.getAttribute('aria-activedescendant')).toBe('command-palette-item-2');
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

  describe('Overview Page Hub & Vitals', () => {
    it('should render 7 KPI vital cards including Webhooks, Plugins, and Functions and exclude Quick Access Collections table', () => {
      const { win, doc } = createTestDOM({ activeNav: 'home' });
      win.renderHomeView();

      // Verify 7 KPI vitals are present
      expect(doc.getElementById('home-stat-collections')).not.toBeNull();
      expect(doc.getElementById('home-stat-records')).not.toBeNull();
      expect(doc.getElementById('home-stat-size')).not.toBeNull();
      expect(doc.getElementById('home-stat-realtime')).not.toBeNull();
      expect(doc.getElementById('home-stat-webhooks')).not.toBeNull();
      expect(doc.getElementById('home-stat-plugins')).not.toBeNull();
      expect(doc.getElementById('home-stat-functions')).not.toBeNull();

      // Verify arbitrary Quick Access Collections table is NOT present
      expect(doc.body.innerHTML).not.toContain('Quick Access Collections');
      expect(doc.getElementById('col-count-products')).toBeNull();

      // Verify New Collection button is in Starter Accelerators
      const homeTools = doc.querySelector('.home-tools-grid');
      expect(homeTools).not.toBeNull();
      expect(homeTools?.textContent).toContain('New Collection');
    });
  });
  describe('HTML5 History API Routing, Deep Linking & History Navigation', () => {
    it('should update browser URL pathname when navigating via selectNav', async () => {
      const { win } = createTestDOM();

      await win.selectNav('collections');
      expect(win.location.pathname).toBe('/_/collections');

      await win.selectNav('functions');
      expect(win.location.pathname).toBe('/_/functions');

      await win.selectNav('webhooks');
      expect(win.location.pathname).toBe('/_/webhooks');

      await win.selectNav('analytics');
      expect(win.location.pathname).toBe('/_/analytics');

      await win.selectNav('snapshots');
      expect(win.location.pathname).toBe('/_/snapshots');

      await win.selectNav('logs');
      expect(win.location.pathname).toBe('/_/logs');

      await win.selectNav('home');
      expect(win.location.pathname).toBe('/_/');
    });

    it('should update browser URL when selecting a collection and switching tabs', async () => {
      const { win } = createTestDOM();

      await win.selectCollection('products');
      expect(win.location.pathname).toBe('/_/collections/products');

      win.switchCollectionTab('schema');
      expect(win.location.pathname).toBe('/_/collections/products/schema');

      win.switchCollectionTab('records');
      expect(win.location.pathname).toBe('/_/collections/products');
    });

    it('should update browser URL when switching functions and webhooks subtabs', async () => {
      const { win } = createTestDOM();

      await win.selectNav('functions');
      expect(win.location.pathname).toBe('/_/functions');

      win.switchFunctionsTab('logs');
      expect(win.location.pathname).toBe('/_/functions/logs');

      win.switchFunctionsTab('functions');
      expect(win.location.pathname).toBe('/_/functions');

      await win.selectNav('webhooks');
      expect(win.location.pathname).toBe('/_/webhooks');

      win.switchWebhooksTab('deliveries');
      expect(win.location.pathname).toBe('/_/webhooks/deliveries');

      win.switchWebhooksTab('webhooks');
      expect(win.location.pathname).toBe('/_/webhooks');

      await win.selectNav('logs');
      expect(win.location.pathname).toBe('/_/logs');

      win.switchLogsSubTab('audit');
      expect(win.location.pathname).toBe('/_/logs/audit');

      win.switchLogsSubTab('traffic');
      expect(win.location.pathname).toBe('/_/logs');
    });

    it('should parse deep-link URLs on startup via parseUrlAndNavigate and restore matching view', async () => {
      const { win } = createTestDOM();

      // Deep link to functions execution logs
      win.history.pushState(null, '', '/_/functions/logs');
      await win.parseUrlAndNavigate(true);
      expect(win.state.activeNav).toBe('functions');
      expect(win.functionsState.subTab).toBe('logs');

      // Deep link to collection schema tab
      win.history.pushState(null, '', '/_/collections/orders/schema');
      await win.parseUrlAndNavigate(true);
      expect(win.state.activeNav).toBe('collection');
      expect(win.state.activeCollection?.name).toBe('orders');
      expect(win.state.collectionTab).toBe('schema');

      // Deep link to webhooks deliveries
      win.history.pushState(null, '', '/_/webhooks/deliveries');
      await win.parseUrlAndNavigate(true);
      expect(win.state.activeNav).toBe('webhooks');
      expect(win.webhooksState.subTab).toBe('deliveries');

      // Deep link to logs audit trail
      win.history.pushState(null, '', '/_/logs/audit');
      await win.parseUrlAndNavigate(true);
      expect(win.state.activeNav).toBe('logs');
      expect(win.auditState.subTab).toBe('audit');

      // Deep link to root /_/
      win.history.pushState(null, '', '/_/');
      await win.parseUrlAndNavigate(true);
      expect(win.state.activeNav).toBe('home');
      expect(win.state.activeCollection).toBeNull();
    });

    it('should handle browser popstate back/forward navigation and restore views', async () => {
      const { win } = createTestDOM();

      // Start at home
      await win.selectNav('home');
      expect(win.location.pathname).toBe('/_/');

      // Navigate to analytics
      await win.selectNav('analytics');
      expect(win.location.pathname).toBe('/_/analytics');

      // Navigate to snapshots
      await win.selectNav('snapshots');
      expect(win.location.pathname).toBe('/_/snapshots');

      // Simulate browser Back button (async in JSDOM)
      win.history.back();
      await new Promise(r => setTimeout(r, 50));
      expect(win.location.pathname).toBe('/_/analytics');
      expect(win.state.activeNav).toBe('analytics');

      // Simulate browser Back button again
      win.history.back();
      await new Promise(r => setTimeout(r, 50));
      expect(win.location.pathname).toBe('/_/');
      expect(win.state.activeNav).toBe('home');

      // Simulate browser Forward button
      win.history.forward();
      await new Promise(r => setTimeout(r, 50));
      expect(win.location.pathname).toBe('/_/analytics');
      expect(win.state.activeNav).toBe('analytics');

      // Navigate to logs and switch to audit subtab
      await win.selectNav('logs');
      expect(win.location.pathname).toBe('/_/logs');
      win.switchLogsSubTab('audit');
      expect(win.location.pathname).toBe('/_/logs/audit');
      expect(win.auditState.subTab).toBe('audit');

      // Simulate browser Back button to return to logs traffic subtab
      win.history.back();
      await new Promise(r => setTimeout(r, 50));
      expect(win.location.pathname).toBe('/_/logs');
      expect(win.auditState.subTab).toBe('traffic');
    });

    it('should preserve multi-app query parameter ?app=:slug across URL changes', async () => {
      const { win } = createTestDOM();

      // Configure active non-default app
      win.state.activeApp = { id: 'app_store', slug: 'store', name: 'Store App' };
      win.history.replaceState(null, '', '/_/?app=store');

      await win.selectNav('functions');
      expect(win.location.pathname).toBe('/_/functions');
      expect(win.location.search).toBe('?app=store');

      await win.selectCollection('products');
      expect(win.location.pathname).toBe('/_/collections/products');
      expect(win.location.search).toBe('?app=store');

      win.switchCollectionTab('schema');
      expect(win.location.pathname).toBe('/_/collections/products/schema');
      expect(win.location.search).toBe('?app=store');
    });

    it('should resolve and synchronize state.activeApp from ?app= query parameter on deep link', async () => {
      const { win } = createTestDOM();

      const defaultApp = { id: 'app_default', slug: 'default', name: 'Default App', isDefault: true };
      const storeApp = { id: 'app_store', slug: 'store', name: 'Store App' };
      win.state.apps = [defaultApp, storeApp];
      win.state.activeApp = defaultApp;

      // Deep link directly to /_/functions?app=store
      win.history.pushState(null, '', '/_/functions?app=store');
      await win.parseUrlAndNavigate(true);

      // Verify active application is synchronized to store app
      expect(win.state.activeApp.slug).toBe('store');
      expect(win.state.activeApp.name).toBe('Store App');
      expect(win.getActiveAppSlug()).toBe('store');
      expect(win.state.activeNav).toBe('functions');
    });

    it('should fetch apps on deep link if state.apps is not yet populated and synchronize target app', async () => {
      const { win } = createTestDOM();

      const defaultApp = { id: 'app_default', slug: 'default', name: 'Default App', isDefault: true };
      const storeApp = { id: 'app_store', slug: 'store', name: 'Store App' };

      win.state.token = 'test-admin-token';
      win.state.apps = [];
      win.state.activeApp = defaultApp;

      // Mock api() to return apps list when /api/apps is fetched
      const originalApi = win.api;
      win.api = vi.fn().mockImplementation(async (path: string, options: any) => {
        if (path === '/api/apps') {
          return { items: [defaultApp, storeApp] };
        }
        return originalApi(path, options);
      });

      win.history.pushState(null, '', '/_/functions?app=store');
      await win.parseUrlAndNavigate(true);

      expect(win.state.apps.length).toBe(2);
      expect(win.state.activeApp.slug).toBe('store');
      expect(win.getActiveAppSlug()).toBe('store');
      expect(win.state.activeNav).toBe('functions');
    });

    it('should synchronize state.activeApp on back/forward navigation between different apps', async () => {
      const { win } = createTestDOM();

      const defaultApp = { id: 'app_default', slug: 'default', name: 'Default App', isDefault: true };
      const storeApp = { id: 'app_store', slug: 'store', name: 'Store App' };
      win.state.apps = [defaultApp, storeApp];
      win.state.activeApp = defaultApp;

      // Navigate to store app functions
      win.history.pushState(null, '', '/_/functions?app=store');
      await win.parseUrlAndNavigate(false);
      expect(win.state.activeApp.slug).toBe('store');
      expect(win.state.activeNav).toBe('functions');

      // Navigate back to default app collections (no ?app= in URL)
      win.history.pushState(null, '', '/_/collections');
      await win.parseUrlAndNavigate(false);
      expect(win.state.activeApp.slug).toBe('default');
      expect(win.state.activeNav).toBe('collections');
    });

    it('should update URL with ?app= when switching apps via selectApp', async () => {
      const { win } = createTestDOM();

      const defaultApp = { id: 'app_default', slug: 'default', name: 'Default App', isDefault: true };
      const storeApp = { id: 'app_store', slug: 'store', name: 'Store App' };
      win.state.apps = [defaultApp, storeApp];
      win.state.activeApp = defaultApp;

      win.history.replaceState(null, '', '/_/functions');

      await win.selectApp('store');
      expect(win.state.activeApp.slug).toBe('store');
      expect(win.location.pathname).toBe('/_/functions');
      expect(win.location.search).toBe('?app=store');

      await win.selectApp('default');
      expect(win.state.activeApp.slug).toBe('default');
      expect(win.location.pathname).toBe('/_/functions');
      expect(win.location.search).toBe('');
    });
  });

});
