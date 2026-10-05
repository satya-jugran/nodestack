import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
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
    expect(bundled).toContain('search-bar-composite');
    expect(bundled).toContain('pagination-footer');
    expect(bundled).toContain('th-sortable');
    expect(bundled).toContain('record-drawer');
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
