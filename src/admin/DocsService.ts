import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../core/config/ConfigService';
import { OpenApiGenerator } from '../schema/OpenApiGenerator';
import { AppManager } from '../apps/AppManager';
import { AppModel } from '../apps/models/App';

export class DocsService {
  constructor(
    public readonly openApiGenerator: OpenApiGenerator,
    private config?: ConfigService,
    private appManager?: AppManager
  ) {}

  public setAppManager(appManager: AppManager): void {
    this.appManager = appManager;
  }

  /**
   * Registers documentation routes on the Fastify instance.
   */
  public registerRoutes(server: FastifyInstance): void {
    // 1. OpenAPI 3.0 Specification in JSON format
    const sendOpenApiJson = async (req: FastifyRequest, reply: FastifyReply) => {
      const scope = (req as any).appScope;
      const generator = scope?.openapi || this.openApiGenerator;
      const appName = scope?.app?.slug === 'default'
        ? (this.config?.appName || 'NodeStack')
        : (scope?.app?.name || this.config?.appName || 'NodeStack');
      const appSlug = scope?.app?.slug || 'default';
      const spec = generator.generate({
        title: `${appName} API`,
        appSlug,
        appName,
      });
      reply.header('Content-Type', 'application/json; charset=utf-8');
      return reply.send(spec);
    };

    server.get('/api/openapi.json', sendOpenApiJson);
    server.get('/api/openapi', sendOpenApiJson);
    server.get('/_/openapi.json', sendOpenApiJson);
    server.get('/api/apps/:appId/openapi.json', sendOpenApiJson);
    server.get('/api/apps/:appId/openapi', sendOpenApiJson);

    // 2. Interactive Docs Viewer HTML (Scalar / Swagger UI)
    const sendDocsHtml = async (
      req: FastifyRequest<{ Querystring: { ui?: string; app?: string } }>,
      reply: FastifyReply
    ) => {
      const uiMode = req.query.ui === 'swagger' ? 'swagger' : 'scalar';
      const scope = (req as any).appScope;
      const currentApp: AppModel = scope?.app || {
        id: 'default',
        name: this.config?.appName || 'NodeStack',
        slug: 'default',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };
      const allApps: AppModel[] = this.appManager
        ? this.appManager.list()
        : [currentApp];

      const html = this.renderDocsHtml(uiMode, currentApp, allApps);
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return reply.send(html);
    };

    server.get('/_/docs', sendDocsHtml);
    server.get('/_/docs/', sendDocsHtml);
    server.get('/api/docs', async (req: any, reply: FastifyReply) => {
      const qs = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      return reply.redirect(`/_/docs${qs}`);
    });
    server.get('/api/docs/', async (req: any, reply: FastifyReply) => {
      const qs = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      return reply.redirect(`/_/docs${qs}`);
    });
    server.get('/api/apps/:appId/docs', async (req: any, reply: FastifyReply) => {
      const appId = req.params.appId;
      const ui = req.query?.ui ? `&ui=${encodeURIComponent(req.query.ui)}` : '';
      return reply.redirect(`/_/docs?app=${encodeURIComponent(appId)}${ui}`);
    });
    server.get('/api/apps/:appId/docs/', async (req: any, reply: FastifyReply) => {
      const appId = req.params.appId;
      const ui = req.query?.ui ? `&ui=${encodeURIComponent(req.query.ui)}` : '';
      return reply.redirect(`/_/docs?app=${encodeURIComponent(appId)}${ui}`);
    });

    // 3. Compiled Docusaurus Documentation Portal
    const docsDir = this.resolveDocsDir();
    if (docsDir) {
      server.register(fastifyStatic, {
        root: docsDir,
        prefix: '/documentation/',
        extensions: ['html'],
        decorateReply: false,
      });

      const redirectToDocs = async (_req: FastifyRequest, reply: FastifyReply) => {
        return reply.redirect('/documentation/');
      };

      server.get('/docs', redirectToDocs);
      server.get('/docs/', redirectToDocs);
      server.get('/_/documentation', redirectToDocs);
      server.get('/_/documentation/', redirectToDocs);
    } else {
      const sendNotBuiltHtml = async (_req: FastifyRequest, reply: FastifyReply) => {
        reply.header('Content-Type', 'text/html; charset=utf-8');
        return reply.send(this.renderDocsNotBuiltHtml());
      };

      server.get('/documentation', sendNotBuiltHtml);
      server.get('/documentation/', sendNotBuiltHtml);
      server.get('/documentation/*', sendNotBuiltHtml);
      server.get('/_/documentation', sendNotBuiltHtml);
      server.get('/_/documentation/*', sendNotBuiltHtml);
    }
  }

  /**
   * Resolves the path to the compiled Docusaurus static build directory.
   */
  public resolveDocsDir(): string | null {
    const candidates = [
      path.resolve(process.cwd(), 'docs/build'),
      path.resolve(__dirname, '../../docs/build'),
      path.resolve(__dirname, '../../../docs/build'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.existsSync(path.join(c, 'index.html'))) {
        return c;
      }
    }
    return null;
  }

  /**
   * Fallback page shown when compiled docs are requested before `npm run docs:build` is run.
   */
  public renderDocsNotBuiltHtml(): string {
    const appName = this.config?.appName || 'NodeStack';
    return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName} — Documentation</title>
  <link rel="icon" type="image/svg+xml" href="/_/icon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      background: #0c0e14;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      text-align: center;
    }
    .card {
      background: #151922;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 2.5rem;
      max-width: 580px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    }
    .icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.75rem;
      color: #f1f5f9;
    }
    p {
      color: #94a3b8;
      font-size: 0.95rem;
      line-height: 1.6;
      margin-bottom: 1.5rem;
    }
    code {
      font-family: 'JetBrains Mono', monospace;
      background: #0f172a;
      border: 1px solid #334155;
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      display: block;
      color: #38bdf8;
      font-size: 0.9rem;
      margin-bottom: 1.25rem;
      text-align: left;
    }
    .btn {
      display: inline-block;
      background: #2563eb;
      color: #fff;
      font-weight: 600;
      padding: 0.6rem 1.25rem;
      border-radius: 8px;
      text-decoration: none;
      transition: background 0.15s;
    }
    .btn:hover {
      background: #1d4ed8;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Documentation Portal Not Yet Compiled</h1>
    <p>The static Docusaurus documentation site has not been built into <code>docs/build</code> yet.</p>
    <p style="text-align: left; font-size: 0.85rem; color: #64748b; margin-bottom: 0.5rem;">To compile for production or local serving:</p>
    <code>npm run docs:build</code>
    <p style="text-align: left; font-size: 0.85rem; color: #64748b; margin-bottom: 0.5rem;">Or launch the live hot-reload docs dev server:</p>
    <code>npm run docs</code>
    <div style="margin-top: 1.5rem;">
      <a href="/_/" class="btn">Return to Admin Dashboard</a>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Renders the interactive documentation HTML page.
   */
  public renderDocsHtml(
    uiMode: 'scalar' | 'swagger' = 'scalar',
    currentApp?: Partial<AppModel>,
    allApps: AppModel[] = []
  ): string {
    const appName = currentApp?.name || this.config?.appName || 'NodeStack';
    const appSlug = currentApp?.slug || 'default';
    const isDefault = appSlug === 'default';
    const isSwagger = uiMode === 'swagger';

    const specQuery = isDefault ? '' : `?app=${encodeURIComponent(appSlug)}`;
    const specUrl = `/api/openapi.json${specQuery}`;
    const typesUrl = `/api/types.d.ts${specQuery}`;
    const swaggerParam = isSwagger ? '&ui=swagger' : '';

    return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName} — Interactive API Reference</title>
  <link rel="icon" type="image/svg+xml" href="/_/icon.svg">
  <link rel="alternate icon" href="/icon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-header: #151821;
      --border-subtle: #242938;
      --accent-primary: #3b82f6;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #0c0e14;
      color: var(--text-main);
      overflow-x: hidden;
    }
    /* Top Bar */
    .docs-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 54px;
      padding: 0 1.25rem;
      background: var(--bg-header);
      border-bottom: 1px solid var(--border-subtle);
      position: sticky;
      top: 0;
      z-index: 1000;
    }
    .brand-section {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      text-decoration: none;
      color: var(--text-main);
    }
    .brand-icon {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .brand-icon img {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      display: block;
    }
    .brand-name {
      font-size: 0.95rem;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .badge {
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      padding: 0.2rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .nav-links {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .nav-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.35rem 0.75rem;
      border-radius: 6px;
      font-size: 0.8125rem;
      font-weight: 500;
      text-decoration: none;
      color: var(--text-muted);
      border: 1px solid transparent;
      transition: all 0.15s ease;
    }
    .nav-btn:hover {
      color: var(--text-main);
      background: #1b1f2b;
    }
    .nav-btn.active {
      color: #fff;
      background: rgba(59, 130, 246, 0.2);
      border-color: rgba(59, 130, 246, 0.4);
    }
    .view-toggle {
      display: flex;
      background: #0c0e14;
      padding: 3px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
    }
    .view-toggle a {
      padding: 0.25rem 0.65rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      text-decoration: none;
      border-radius: 6px;
      transition: all 0.15s ease;
    }
    .view-toggle a.active {
      background: var(--accent-primary);
      color: #fff;
    }
    .view-toggle a:hover:not(.active) {
      color: var(--text-main);
    }
    #viewer-container {
      min-height: calc(100vh - 54px);
    }
    /* Swagger UI Overrides for dark theme */
    .swagger-ui-wrapper {
      padding: 1rem;
      background: #fff;
      min-height: calc(100vh - 54px);
    }
    /* Fallback Banner */
    #offline-notice {
      display: none;
      padding: 2rem;
      text-align: center;
      background: #151821;
      margin: 2rem;
      border-radius: 12px;
      border: 1px solid var(--border-subtle);
    }
    #offline-notice h3 {
      font-size: 1.25rem;
      margin-bottom: 0.5rem;
      color: #f87171;
    }
    #offline-notice p {
      color: var(--text-muted);
      margin-bottom: 1.5rem;
    }
  </style>
  ${
    isSwagger
      ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />`
      : ''
  }
</head>
<body>
  <header class="docs-topbar">
    <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
      <a href="/_/" class="brand-section" title="Back to Admin Dashboard">
        <div class="brand-icon">
          <img src="/_/icon.svg" alt="${appName}">
        </div>
        <span class="brand-name">${appName}</span>
        <span class="badge">OpenAPI 3.0</span>
      </a>

      ${allApps.length > 0 ? `
        <div style="display: inline-flex; align-items: center; gap: 6px; background: #131720; border: 1px solid var(--border-subtle); border-radius: 8px; padding: 2px 8px;">
          <label for="docs-app-select" style="font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);">App:</label>
          <select id="docs-app-select" onchange="window.location.href='/_/docs?app=' + encodeURIComponent(this.value) + '${swaggerParam}'" style="background: transparent; color: #f3f4f6; border: none; font-size: 12px; font-weight: 600; outline: none; cursor: pointer;">
            ${allApps.map(a => `<option value="${a.slug}" ${a.slug === appSlug ? 'selected' : ''} style="background: #181b21; color: #fff;">${a.name} (${a.slug})</option>`).join('')}
          </select>
        </div>
      ` : ''}

      <div class="view-toggle">
        <a href="/_/docs${isDefault ? '' : `?app=${encodeURIComponent(appSlug)}`}" class="${!isSwagger ? 'active' : ''}">Scalar</a>
        <a href="/_/docs?${isDefault ? '' : `app=${encodeURIComponent(appSlug)}&`}ui=swagger" class="${isSwagger ? 'active' : ''}">Swagger UI</a>
      </div>

      <div id="docs-auth-badge" style="display: none; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 9999px; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);" title="Your Admin token from the dashboard is automatically applied to interactive requests">
        <span style="width: 6px; height: 6px; border-radius: 50%; background: #10b981;"></span>
        <span>Admin Token Active</span>
      </div>
    </div>

    <nav class="nav-links">
      <a href="/_/" class="nav-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        <span>Admin Dashboard</span>
      </a>
      <a href="${specUrl}" target="_blank" class="nav-btn" title="Raw OpenAPI Specification JSON">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
        <span>OpenAPI JSON</span>
      </a>
      <a href="${typesUrl}" target="_blank" class="nav-btn" title="Generated TypeScript definitions">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
        <span>TypeScript Types</span>
      </a>
    </nav>
  </header>

  <div id="viewer-container">
    <div id="offline-notice">
      <h3>API Viewer CDN Notice</h3>
      <p>The interactive documentation interface could not be reached via CDN. You can still access the raw OpenAPI 3.0 JSON specification or generated TypeScript types directly:</p>
      <div style="display: flex; gap: 1rem; justify-content: center;">
        <a href="${specUrl}" target="_blank" class="nav-btn active" style="padding: 0.5rem 1rem;">View OpenAPI JSON</a>
        <a href="${typesUrl}" target="_blank" class="nav-btn" style="padding: 0.5rem 1rem;">View TypeScript Types</a>
      </div>
    </div>

    ${
      isSwagger
        ? `<div class="swagger-ui-wrapper"><div id="swagger-ui"></div></div>`
        : `<script id="api-reference" data-url="${specUrl}"></script>
           <script>
             (function() {
               var el = document.getElementById('api-reference');
               var config = {
                 theme: 'purple',
                 darkMode: true,
                 showSidebar: true,
                 searchHotKey: 'k',
                 metaData: {
                   title: ${JSON.stringify(appName + ' API Reference')}
                 }
               };
               var token = localStorage.getItem('nodestack_token') || localStorage.getItem('nb_token');
               if (token) {
                 config.authentication = {
                   preferredSecurityScheme: 'BearerAuth',
                   securitySchemes: {
                     BearerAuth: {
                       token: token
                     }
                   }
                 };
                 var badge = document.getElementById('docs-auth-badge');
                 if (badge) badge.style.display = 'inline-flex';
               }
               el.setAttribute('data-configuration', JSON.stringify(config));
             })();
           </script>`
    }
  </div>

  ${
    isSwagger
      ? `<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" onerror="document.getElementById('offline-notice').style.display='block';"></script>
         <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
         <script>
           window.addEventListener('load', () => {
             if (window.SwaggerUIBundle) {
               var token = localStorage.getItem('nodestack_token') || localStorage.getItem('nb_token');
               if (token) {
                 var badge = document.getElementById('docs-auth-badge');
                 if (badge) badge.style.display = 'inline-flex';
               }
               var ui = window.SwaggerUIBundle({
                 url: '${specUrl}',
                 dom_id: '#swagger-ui',
                 deepLinking: true,
                 presets: [
                   SwaggerUIBundle.presets.apis,
                   SwaggerUIStandalonePreset
                 ],
                 layout: 'StandaloneLayout',
                 onComplete: () => {
                   if (token && ui && ui.preauthorizeApiKey) {
                     ui.preauthorizeApiKey('BearerAuth', token);
                   }
                 }
               });
             }
           });
         </script>`
      : `<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference" onerror="document.getElementById('offline-notice').style.display='block';"></script>`
  }
</body>
</html>`;
  }
}
