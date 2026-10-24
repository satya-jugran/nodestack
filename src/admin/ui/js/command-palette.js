// ==========================================
// Global Command Palette (Ctrl + K / Cmd + K)
// ==========================================

let commandPaletteActiveIndex = 0;
let commandPaletteFilteredItems = [];

function getAllCommandPaletteItems() {
  const items = [];

  // 1. Collections (User & System)
  for (const col of state.collections || []) {
    const isSys = typeof isSystemCollection === 'function' ? isSystemCollection(col) : Boolean(col.system || col.name?.startsWith('_'));
    items.push({
      id: `col-${col.name}`,
      title: col.name,
      description: `Jump to ${col.name} (${col.type}) collection`,
      category: isSys ? 'System Tables' : 'Collections',
      badge: col.type.toUpperCase(),
      icon: isSys ? '⚙️' : '📁',
      keywords: [col.name, col.name.toLowerCase(), 'collection', 'jump', col.type, isSys ? 'system' : 'user'],
      action: () => {
        if (typeof selectCollection === 'function') {
          selectCollection(col.name);
        }
      }
    });
  }

  // 2. Navigation items
  items.push({
    id: 'nav-home',
    title: 'Dashboard Overview',
    description: 'Server status, collections list, quick stats',
    category: 'Navigation',
    badge: 'PAGE',
    icon: '🏠',
    keywords: ['home', 'dashboard', 'overview'],
    action: () => selectNav('home')
  });

  items.push({
    id: 'nav-collections',
    title: 'Collections',
    description: 'Dedicated database collections directory, tables & schema',
    category: 'Navigation',
    badge: 'PAGE',
    icon: '📦',
    keywords: ['collections', 'database', 'tables', 'schema', 'records'],
    action: () => selectNav('collections')
  });

  items.push({
    id: 'nav-plugins',
    title: 'Plugins',
    description: 'Dedicated official extensions & community plugins directory',
    category: 'Navigation',
    badge: 'PAGE',
    icon: '🧩',
    keywords: ['plugins', 'extensions', 'addons', 'stripe', 's3', 'resend', 'webhooks', 'algolia'],
    action: () => selectNav('plugins')
  });

  items.push({
    id: 'nav-webhooks',
    title: 'Webhooks Manager',
    description: 'Configure outbound webhooks, signatures and retry delivery logs',
    category: 'Navigation',
    badge: 'PAGE',
    icon: '🔗',
    keywords: ['webhooks', 'webhook', 'outbound', 'events', 'deliveries', 'retry'],
    action: () => selectNav('webhooks')
  });

  items.push({
    id: 'nav-analytics',
    title: 'Analytics & Metrics',
    description: 'Realtime telemetry, latency and request throughput',
    category: 'Navigation',
    badge: 'PAGE',
    icon: '📊',
    keywords: ['metrics', 'analytics', 'telemetry', 'stats', 'traffic', 'latency'],
    action: () => selectNav('analytics')
  });

  items.push({
    id: 'nav-snapshots',
    title: 'Snapshots',
    description: 'Capture or restore application state snapshots',

    category: 'Navigation',
    badge: 'PAGE',
    icon: '📸',
    keywords: ['snapshots', 'snapshot', 'backup', 'restore', 'demo'],
    action: () => selectNav('snapshots')
  });

  items.push({
    id: 'nav-logs',
    title: 'Traffic & Logs',
    description: 'Live HTTP request activity, errors and slow queries',
    category: 'Navigation',
    badge: 'PAGE',
    icon: '📝',
    keywords: ['logs', 'traffic', 'requests', 'errors', 'debug'],
    action: () => selectNav('logs')
  });

  items.push({
    id: 'nav-settings',
    title: 'System Info',
    description: 'System specifications, runtime version, and server hooks',
    category: 'Navigation',
    badge: 'PAGE',
    icon: '⚙️',
    keywords: ['settings', 'system', 'system info', 'info', 'runtime', 'uptime', 'version', 'hooks'],
    action: () => selectNav('settings')
  });

  // 2.5 Plugin navigation items
  if (state.pluginNavItems && state.pluginNavItems.length > 0) {
    for (const p of state.pluginNavItems) {
      items.push({
        id: 'plugin-' + p.id,
        title: p.title,
        description: (p.view && typeof p.view === 'object' && p.view.description) ? p.view.description : `Plugin extension: ${p.title}`,
        category: 'Plugins',
        badge: p.badge || 'PLUGIN',
        icon: '🧩',
        keywords: [p.id, p.title.toLowerCase(), 'plugin', 'extension'],
        action: () => selectNav(p.id)
      });
    }
  }

  // 2.8 Application Switcher & Actions
  if (Array.isArray(state.apps) && state.apps.length > 0) {
    for (const app of state.apps) {
      items.push({
        id: `app-switch-${app.slug}`,
        title: `Switch App: ${app.name}`,
        description: `Switch active application context to ${app.name} (${app.slug})`,
        category: 'Applications',
        badge: app.isDefault ? 'DEFAULT' : 'APP',
        icon: app.isDefault ? '⚡' : '🚀',
        keywords: ['app', 'application', 'switch', app.name.toLowerCase(), app.slug.toLowerCase()],
        action: () => {
          if (typeof selectApp === 'function') {
            selectApp(app.slug);
          }
        }
      });
      if (!app.isDefault && app.slug !== 'default') {
        items.push({
          id: `app-delete-${app.slug}`,
          title: `Delete App: ${app.name}`,
          description: `Permanently delete application ${app.name} (${app.slug}) and its database`,
          category: 'Applications',
          badge: 'DANGER',
          icon: '🗑️',
          keywords: ['delete app', 'remove app', 'delete application', 'drop app', app.slug.toLowerCase(), app.name.toLowerCase()],
          action: () => {
            if (typeof promptDeleteApp === 'function') {
              promptDeleteApp(app.slug, app.name);
            }
          }
        });
      }
    }
  }

  items.push({
    id: 'action-create-app',
    title: 'Create New Application...',
    description: 'Create a new isolated application scope with dedicated database and storage',
    category: 'Applications',
    badge: 'NEW',
    icon: '➕',
    keywords: ['create app', 'new app', 'new application', 'application', 'tenant'],
    action: () => {
      if (typeof openCreateAppModal === 'function') {
        openCreateAppModal();
      }
    }
  });

  // 3. Actions: Export
  if (state.activeCollection) {
    items.push({
      id: 'action-export-json',
      title: `Export ${state.activeCollection.name} (JSON)`,
      description: `Download ${state.activeCollection.name} records as JSON format`,
      category: 'Actions',
      badge: 'EXPORT',
      icon: '📥',
      keywords: ['export', 'export json', 'download', 'json', 'current collection', state.activeCollection.name],
      action: () => {
        if (typeof exportData === 'function') {
          exportData('json');
        }
      }
    });
    items.push({
      id: 'action-export-csv',
      title: `Export ${state.activeCollection.name} (CSV)`,
      description: `Download ${state.activeCollection.name} records as CSV spreadsheet`,
      category: 'Actions',
      badge: 'EXPORT',
      icon: '📄',
      keywords: ['export', 'export csv', 'download', 'csv', 'current collection', state.activeCollection.name],
      action: () => {
        if (typeof exportData === 'function') {
          exportData('csv');
        }
      }
    });
  } else {
    items.push({
      id: 'action-export',
      title: 'Export Collection Records',
      description: 'Trigger data export (requires active collection)',
      category: 'Actions',
      badge: 'EXPORT',
      icon: '📥',
      keywords: ['export', 'download', 'json', 'csv'],
      action: () => {
        toast('Please select a collection first to export records', 'info');
      }
    });
  }

  // 4. Actions: New Collection
  items.push({
    id: 'action-new-collection',
    title: 'New Collection',
    description: 'Create a new schema from scratch',
    category: 'Actions',
    badge: 'CREATE',
    icon: '➕',
    keywords: ['new', 'create', 'collection', 'add collection', 'new collection'],
    action: () => {
      if (typeof openNewCollectionModal === 'function') {
        openNewCollectionModal();
      }
    }
  });

  items.push({
    id: 'action-new-webhook',
    title: 'New Webhook',
    description: 'Configure an outbound HTTP webhook on collection events',
    category: 'Actions',
    badge: 'CREATE',
    icon: '⚡',
    keywords: ['new webhook', 'create webhook', 'webhook', 'outbound', 'signature'],
    action: () => {
      selectNav('webhooks');
      setTimeout(() => {
        if (typeof openCreateWebhookModal === 'function') openCreateWebhookModal();
      }, 50);
    }
  });

  // 5. Actions: Starter Templates
  items.push({
    id: 'action-templates',
    title: 'Starter Templates',
    description: 'Pre-seeded recipes (E-Commerce, Blog, CRM)',
    category: 'Actions',
    badge: 'RECIPE',
    icon: '✨',
    keywords: ['templates', 'starter templates', 'ecommerce', 'blog', 'crm', 'recipe'],
    action: () => {
      if (typeof openTemplatesModal === 'function') {
        openTemplatesModal();
      }
    }
  });

  // 6. Actions: Import JSON
  items.push({
    id: 'action-import-json',
    title: 'Import JSON Schema',
    description: 'Generate database schema from JSON sample',
    category: 'Actions',
    badge: 'IMPORT',
    icon: '📥',
    keywords: ['import', 'json', 'schema', 'upload'],
    action: () => {
      if (typeof openImportJsonModal === 'function') {
        openImportJsonModal();
      }
    }
  });

  // 7. Action: New Record (if collection active)
  if (state.activeCollection) {
    items.push({
      id: 'action-new-record',
      title: `Create Record in ${state.activeCollection.name}`,
      description: `Insert a new row into ${state.activeCollection.name}`,
      category: 'Actions',
      badge: 'RECORD',
      icon: '📝',
      keywords: ['new record', 'create record', 'add record', 'insert', 'row'],
      action: () => {
        if (typeof openNewRecordModal === 'function') {
          openNewRecordModal();
        }
      }
    });
  }

  // 8. Action: OpenAPI Docs
  items.push({
    id: 'action-docs',
    title: 'API Docs (OpenAPI)',
    description: 'Interactive OpenAPI 3.0 Reference & testing sandbox',
    category: 'Documentation',
    badge: 'DOCS',
    icon: '📖',
    keywords: ['docs', 'openapi', 'swagger', 'api reference'],
    action: () => {
      if (typeof openDocsWithApp === 'function') {
        openDocsWithApp();
      } else {
        const slug = (typeof getActiveAppSlug === 'function')
          ? getActiveAppSlug()
          : (state?.activeApp?.slug || (typeof state?.activeApp === 'string' ? state.activeApp : 'default'));
        const app = slug && slug !== 'default' ? `?app=${encodeURIComponent(slug)}` : '';
        window.open(`/_/docs${app}`, '_blank');
      }
    }
  });

  return items;
}

function filterCommandPaletteItems(query) {
  const all = getAllCommandPaletteItems();
  const q = (query || '').trim().toLowerCase();
  if (!q) {
    return all;
  }

  const scored = [];
  for (const item of all) {
    let score = 0;
    const titleLower = item.title.toLowerCase();

    if (titleLower === q) {
      score += 100;
    } else if (titleLower.startsWith(q)) {
      score += 70;
    } else if (titleLower.includes(q)) {
      score += 40;
    }

    for (const kw of item.keywords || []) {
      if (kw === q) {
        score = Math.max(score, 90);
      } else if (kw.startsWith(q)) {
        score = Math.max(score, 60);
      } else if (kw.includes(q)) {
        score = Math.max(score, 30);
      }
    }

    if (item.description && item.description.toLowerCase().includes(q)) {
      score = Math.max(score, 20);
    }

    if (score > 0) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.item);
}

function renderCommandPaletteResultsHtml(items, selectedIndex) {
  if (!items || items.length === 0) {
    return `<div class="command-palette-empty">No matching commands or collections found</div>`;
  }

  return items.map((item, idx) => `
    <div 
      class="command-palette-item ${idx === selectedIndex ? 'selected' : ''}" 
      id="command-palette-item-${idx}"
      onclick="executeCommandPaletteItem(${idx})"
      onmouseenter="setCommandPaletteActiveIndex(${idx})"
      data-index="${idx}"
      role="option"
      aria-selected="${idx === selectedIndex ? 'true' : 'false'}"
      tabindex="-1"
    >
      <div class="command-palette-item-left">
        <div class="command-palette-item-icon" aria-hidden="true">${item.icon || '▶'}</div>
        <div class="command-palette-item-text">
          <div class="command-palette-item-title">${escapeHtml(item.title)}</div>
          <div class="command-palette-item-desc">${escapeHtml(item.description)}</div>
        </div>
      </div>
      <div class="command-palette-item-badge">${escapeHtml(item.badge || item.category)}</div>
    </div>
  `).join('');
}

function openCommandPalette() {
  commandPaletteActiveIndex = 0;
  commandPaletteFilteredItems = filterCommandPaletteItems('');
  const root = document.getElementById('command-palette-root');
  if (!root) return;

  root.innerHTML = `
    <div class="command-palette-backdrop" id="command-palette-backdrop" onclick="handleCommandPaletteBackdrop(event)" onkeydown="if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeCommandPalette();}">
      <div class="command-palette-modal" role="dialog" aria-modal="true" aria-label="Command Palette">
        <div class="command-palette-header">
          <svg class="command-palette-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input 
            type="text" 
            id="command-palette-input" 
            class="command-palette-input" 
            placeholder="Type a command or jump to... (e.g. users, metrics, export, new)" 
            autocomplete="off" 
            spellcheck="false"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="${commandPaletteFilteredItems.length > 0 ? 'true' : 'false'}"
            aria-haspopup="listbox"
            aria-controls="command-palette-results"
            ${commandPaletteFilteredItems.length > 0 ? 'aria-activedescendant="command-palette-item-0"' : ''}
            oninput="handleCommandPaletteInput(this.value)"
            onkeydown="handleCommandPaletteKeyDown(event)"
          />
          <span class="command-palette-esc-badge" onclick="closeCommandPalette()" role="button" aria-label="Close command palette">ESC</span>
        </div>
        <div class="command-palette-results" id="command-palette-results" role="listbox" aria-label="Commands and collections">
          ${renderCommandPaletteResultsHtml(commandPaletteFilteredItems, 0)}
        </div>
        <div class="command-palette-footer">
          <div class="command-palette-footer-shortcuts">
            <span><kbd class="palette-kbd">↑</kbd><kbd class="palette-kbd">↓</kbd> navigate</span>
            <span><kbd class="palette-kbd">↵</kbd> select</span>
            <span><kbd class="palette-kbd">esc</kbd> close</span>
          </div>
          <div style="font-size:10px; opacity:0.7;">NodeStack Quick Jump</div>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    const input = document.getElementById('command-palette-input');
    if (input) input.focus();
  }, 20);
}

function closeCommandPalette() {
  const root = document.getElementById('command-palette-root');
  if (root) root.innerHTML = '';
}

function handleCommandPaletteBackdrop(e) {
  if (e.target && e.target.id === 'command-palette-backdrop') {
    closeCommandPalette();
  }
}

function toggleCommandPalette() {
  const root = document.getElementById('command-palette-root');
  if (root && root.innerHTML.trim().length > 0) {
    closeCommandPalette();
  } else {
    openCommandPalette();
  }
}

function handleCommandPaletteInput(val) {
  commandPaletteActiveIndex = 0;
  commandPaletteFilteredItems = filterCommandPaletteItems(val);
  const container = document.getElementById('command-palette-results');
  const input = document.getElementById('command-palette-input');

  if (container) {
    container.innerHTML = renderCommandPaletteResultsHtml(commandPaletteFilteredItems, 0);
  }

  if (input) {
    if (commandPaletteFilteredItems.length > 0) {
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-activedescendant', 'command-palette-item-0');
    } else {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
  }
}

function handleCommandPaletteKeyDown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (commandPaletteFilteredItems.length > 0) {
      commandPaletteActiveIndex = (commandPaletteActiveIndex + 1) % commandPaletteFilteredItems.length;
      updateCommandPaletteActiveItem();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (commandPaletteFilteredItems.length > 0) {
      commandPaletteActiveIndex = (commandPaletteActiveIndex - 1 + commandPaletteFilteredItems.length) % commandPaletteFilteredItems.length;
      updateCommandPaletteActiveItem();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    executeCommandPaletteItem(commandPaletteActiveIndex);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeCommandPalette();
  }
}

function updateCommandPaletteActiveItem() {
  const input = document.getElementById('command-palette-input');
  const items = document.querySelectorAll('.command-palette-item');
  let activeId = null;

  items.forEach((el, idx) => {
    if (idx === commandPaletteActiveIndex) {
      el.classList.add('selected');
      el.setAttribute('aria-selected', 'true');
      activeId = el.id;
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest' });
      }
    } else {
      el.classList.remove('selected');
      el.setAttribute('aria-selected', 'false');
    }
  });

  if (input) {
    if (activeId) {
      input.setAttribute('aria-activedescendant', activeId);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }
}

function setCommandPaletteActiveIndex(idx) {
  commandPaletteActiveIndex = idx;
  const input = document.getElementById('command-palette-input');
  const items = document.querySelectorAll('.command-palette-item');
  let activeId = null;

  items.forEach((el, i) => {
    if (i === idx) {
      el.classList.add('selected');
      el.setAttribute('aria-selected', 'true');
      activeId = el.id;
    } else {
      el.classList.remove('selected');
      el.setAttribute('aria-selected', 'false');
    }
  });

  if (input) {
    if (activeId) {
      input.setAttribute('aria-activedescendant', activeId);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }
}

function executeCommandPaletteItem(index) {
  const item = commandPaletteFilteredItems[index];
  if (!item) return;
  closeCommandPalette();
  if (typeof item.action === 'function') {
    item.action();
  }
}

// Expose helpers on window for browser event handlers & tests
if (typeof window !== 'undefined') {
  window.openCommandPalette = openCommandPalette;
  window.closeCommandPalette = closeCommandPalette;
  window.toggleCommandPalette = toggleCommandPalette;
  window.getAllCommandPaletteItems = getAllCommandPaletteItems;
  window.filterCommandPaletteItems = filterCommandPaletteItems;
  window.executeCommandPaletteItem = executeCommandPaletteItem;
  window.handleCommandPaletteInput = handleCommandPaletteInput;
  window.handleCommandPaletteKeyDown = handleCommandPaletteKeyDown;
  window.setCommandPaletteActiveIndex = setCommandPaletteActiveIndex;
}
