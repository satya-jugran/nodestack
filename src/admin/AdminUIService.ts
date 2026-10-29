import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { AdminUIBundler } from './AdminUIBundler';
import { AdminNavItem, PluginMetadata } from '../core/plugins/types';

export class AdminUIService {
  private adminHtml: string = '';
  private iconSvg: string = '';
  private uiDir: string;
  private navItems: AdminNavItem[] = [];
  private plugins: PluginMetadata[] = [];

  constructor() {
    this.uiDir = path.join(__dirname, 'ui');

    // 1. Try to load bundled assets from Single Executable Application (SEA)
    let sea: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      sea = require('node:sea');
    } catch {}

    if (sea && typeof sea.isSea === 'function' && sea.isSea()) {
      try {
        const seaAdminHtml = sea.getAsset('admin.html', 'utf8');
        if (seaAdminHtml) {
          this.adminHtml = seaAdminHtml;
        }
      } catch {}
      try {
        const seaIconSvg = sea.getAsset('icon.svg', 'utf8');
        if (seaIconSvg) {
          this.iconSvg = seaIconSvg;
        }
      } catch {}
    }

    if (!this.adminHtml) {
      const bundled = AdminUIBundler.bundle(this.uiDir);
      if (bundled) {
        this.adminHtml = bundled;
      } else {
        const htmlPath = path.join(this.uiDir, 'index.html');
        if (fs.existsSync(htmlPath)) {
          this.adminHtml = fs.readFileSync(htmlPath, 'utf-8');
        } else {
          this.adminHtml = this.getFallbackHtml();
        }
      }
    }

    if (!this.iconSvg) {
      const iconPath = path.join(__dirname, 'ui', 'icon.svg');
      const faviconPath = path.join(__dirname, 'ui', 'favicon.svg');
      if (fs.existsSync(iconPath)) {
        this.iconSvg = fs.readFileSync(iconPath, 'utf-8');
      } else if (fs.existsSync(faviconPath)) {
        this.iconSvg = fs.readFileSync(faviconPath, 'utf-8');
      } else {
        this.iconSvg = this.getFallbackSvg();
      }
    }
  }

  public registerNavItem(item: AdminNavItem): void {
    const idx = this.navItems.findIndex((i) => i.id === item.id);
    if (idx >= 0) {
      this.navItems[idx] = item;
    } else {
      this.navItems.push(item);
    }
  }

  public getNavItems(db?: any): AdminNavItem[] {
    if (this.navItemsGetter) {
      return this.navItemsGetter(db);
    }
    return [...this.navItems];
  }

  private navItemsGetter?: (db?: any) => AdminNavItem[];

  public setNavItemsGetter(getter: (db?: any) => AdminNavItem[]): void {
    this.navItemsGetter = getter;
  }

  public registerPluginMeta(meta: PluginMetadata): void {
    if (!this.plugins.some((p) => p.name === meta.name)) {
      this.plugins.push(meta);
    }
  }

  public getPluginsMeta(): PluginMetadata[] {
    return [...this.plugins];
  }

  /**
   * Serialize data for safe embedding inside an HTML <script> block.
   * Escapes '<', '>', '&', and Unicode line separators to prevent script tag breakouts and XSS.
   */
  public static serializeForScript(data: any): string {
    return JSON.stringify(data)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  public removeNavItem(id: string): void {
    this.navItems = this.navItems.filter((i) => i.id !== id);
  }

  public removePluginMeta(name: string): void {
    this.plugins = this.plugins.filter((p) => p.name !== name);
  }

  private catalogGetter?: (db?: any) => any[];

  public setCatalogGetter(getter: (db?: any) => any[]): void {
    this.catalogGetter = getter;
  }

  public getHtml(): string {
    let baseHtml: string;
    if (process.env.NODE_ENV !== 'production') {
      const live = AdminUIBundler.bundle(this.uiDir);
      baseHtml = live || this.adminHtml;
    } else {
      baseHtml = this.adminHtml;
    }

    const catalog = this.catalogGetter ? this.catalogGetter() : [];
    if (this.navItems.length > 0 || this.plugins.length > 0 || catalog.length > 0) {
      const injection = `
  <script>
    window.__NODESTACK_PLUGINS__ = ${AdminUIService.serializeForScript(this.plugins)};
    window.__NODESTACK_NAV_ITEMS__ = ${AdminUIService.serializeForScript(this.navItems)};
    window.__NODESTACK_PLUGIN_CATALOG__ = ${AdminUIService.serializeForScript(catalog)};
  </script>`;
      if (baseHtml.includes('</head>')) {
        return baseHtml.replace('</head>', `${injection}\n</head>`);
      }
      return baseHtml + injection;
    }

    return baseHtml;
  }

  public registerRoutes(server: FastifyInstance): void {
    const sendIcon = async (_req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Content-Type', 'image/svg+xml');
      return reply.send(this.iconSvg);
    };

    // Brand icon & Favicon routes
    server.get('/icon.svg', sendIcon);
    server.get('/_/icon.svg', sendIcon);
    server.get('/favicon.svg', sendIcon);
    server.get('/favicon.ico', sendIcon);
    server.get('/_/favicon.svg', sendIcon);
    server.get('/_/favicon.ico', sendIcon);

    // Redirect root to admin UI if accessed directly, or return health
    server.get('/', async (_req: FastifyRequest, reply: FastifyReply) => {
      reply.redirect('/_/');
    });

    // Admin UI route and SPA fallback
    server.get('/_/*', async (req: FastifyRequest, reply: FastifyReply) => {
      if (req.url.startsWith('/_/docs') || req.url.startsWith('/_/openapi') || req.url.startsWith('/_/documentation')) {
        return reply.callNotFound();
      }
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return reply.send(this.getHtml());
    });

    server.get('/_/', async (_req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return reply.send(this.getHtml());
    });

    server.get('/_', async (_req: FastifyRequest, reply: FastifyReply) => {
      reply.redirect('/_/');
    });

    // Plugin & Admin UI Extensions API
    const sendNavItemsResponse = async (req: FastifyRequest, reply: FastifyReply) => {
      const targetDb = (req as any).appScope?.db;
      return reply.send({ items: this.getNavItems(targetDb) });
    };

    server.get('/api/admin/nav-items', sendNavItemsResponse);
    server.get('/api/apps/:appId/admin/nav-items', sendNavItemsResponse);

    const sendPluginsResponse = async (req: FastifyRequest, reply: FastifyReply) => {
      const targetDb = (req as any).appScope?.db;
      return reply.send({
        plugins: this.getPluginsMeta(),
        navItems: this.getNavItems(targetDb),
        catalog: this.catalogGetter ? this.catalogGetter(targetDb) : [],
      });
    };

    server.get('/api/plugins', sendPluginsResponse);
    server.get('/api/apps/:appId/plugins', sendPluginsResponse);
  }

  private getFallbackSvg(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="7" fill="#0c0e14"/><path d="M7 21L16 26L25 21M7 16L16 21L25 16" stroke="#3b82f6" stroke-width="2.2" stroke-linecap="round"/><path d="M16 6L25 11L16 16L7 11L16 6Z" fill="#3b82f6"/><circle cx="16" cy="11" r="2.2" fill="#fff"/></svg>`;
  }

  private getFallbackHtml(): string {
    return `<!DOCTYPE html>
<html>
<head><title>NodeStack Admin</title></head>
<body style="font-family:system-ui;padding:2rem;background:#111;color:#fff;">
  <h2>NodeStack Admin UI</h2>
  <p>Admin assets are loading...</p>
</body>
</html>`;
  }
}
