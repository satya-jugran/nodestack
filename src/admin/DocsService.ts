import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ConfigService } from '../core/config/ConfigService';
import { OpenApiGenerator } from '../schema/OpenApiGenerator';

export class DocsService {
  constructor(
    private openApiGenerator: OpenApiGenerator,
    private config?: ConfigService
  ) {}

  /**
   * Registers documentation routes on the Fastify instance.
   */
  public registerRoutes(server: FastifyInstance): void {
    // 1. OpenAPI 3.0 Specification in JSON format
    const sendOpenApiJson = async (_req: FastifyRequest, reply: FastifyReply) => {
      const spec = this.openApiGenerator.generate({
        title: `${this.config?.appName || 'NodeStack'} API`,
      });
      reply.header('Content-Type', 'application/json; charset=utf-8');
      return reply.send(spec);
    };

    server.get('/api/openapi.json', sendOpenApiJson);
    server.get('/api/openapi', sendOpenApiJson);
    server.get('/_/openapi.json', sendOpenApiJson);

    // 2. Interactive Docs Viewer HTML (Scalar / Swagger UI)
    const sendDocsHtml = async (req: FastifyRequest<{ Querystring: { ui?: string } }>, reply: FastifyReply) => {
      const uiMode = req.query.ui === 'swagger' ? 'swagger' : 'scalar';
      const html = this.renderDocsHtml(uiMode);
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return reply.send(html);
    };

    server.get('/_/docs', sendDocsHtml);
    server.get('/_/docs/', sendDocsHtml);
    server.get('/api/docs', async (_req: FastifyRequest, reply: FastifyReply) => {
      return reply.redirect('/_/docs');
    });
    server.get('/api/docs/', async (_req: FastifyRequest, reply: FastifyReply) => {
      return reply.redirect('/_/docs');
    });
  }

  /**
   * Renders the interactive documentation HTML page.
   */
  public renderDocsHtml(uiMode: 'scalar' | 'swagger' = 'scalar'): string {
    const appName = this.config?.appName || 'NodeStack';
    const isSwagger = uiMode === 'swagger';

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
    <div style="display: flex; align-items: center; gap: 1.25rem;">
      <a href="/_/" class="brand-section" title="Back to Admin Dashboard">
        <div class="brand-icon">
          <img src="/_/icon.svg" alt="${appName}">
        </div>
        <span class="brand-name">${appName}</span>
        <span class="badge">OpenAPI 3.0</span>
      </a>

      <div class="view-toggle">
        <a href="/_/docs" class="${!isSwagger ? 'active' : ''}">Scalar</a>
        <a href="/_/docs?ui=swagger" class="${isSwagger ? 'active' : ''}">Swagger UI</a>
      </div>
    </div>

    <nav class="nav-links">
      <a href="/_/" class="nav-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        <span>Admin Dashboard</span>
      </a>
      <a href="/api/openapi.json" target="_blank" class="nav-btn" title="Raw OpenAPI Specification JSON">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
        <span>OpenAPI JSON</span>
      </a>
      <a href="/api/types.d.ts" target="_blank" class="nav-btn" title="Generated TypeScript definitions">
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
        <a href="/api/openapi.json" target="_blank" class="nav-btn active" style="padding: 0.5rem 1rem;">View OpenAPI JSON</a>
        <a href="/api/types.d.ts" target="_blank" class="nav-btn" style="padding: 0.5rem 1rem;">View TypeScript Types</a>
      </div>
    </div>

    ${
      isSwagger
        ? `<div class="swagger-ui-wrapper"><div id="swagger-ui"></div></div>`
        : `<script
            id="api-reference"
            data-url="/api/openapi.json"
            data-configuration='{
              "theme": "purple",
              "darkMode": true,
              "showSidebar": true,
              "searchHotKey": "k",
              "metaData": {
                "title": "${appName} API Reference"
              }
            }'
          ></script>`
    }
  </div>

  ${
    isSwagger
      ? `<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" onerror="document.getElementById('offline-notice').style.display='block';"></script>
         <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
         <script>
           window.addEventListener('load', () => {
             if (window.SwaggerUIBundle) {
               window.SwaggerUIBundle({
                 url: '/api/openapi.json',
                 dom_id: '#swagger-ui',
                 deepLinking: true,
                 presets: [
                   SwaggerUIBundle.presets.apis,
                   SwaggerUIStandalonePreset
                 ],
                 layout: 'StandaloneLayout'
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
