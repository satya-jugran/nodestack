import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

export class AdminUIService {
  private adminHtml: string;
  private iconSvg: string;

  constructor() {
    const htmlPath = path.join(__dirname, 'ui', 'index.html');
    if (fs.existsSync(htmlPath)) {
      this.adminHtml = fs.readFileSync(htmlPath, 'utf-8');
    } else {
      this.adminHtml = this.getFallbackHtml();
    }

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
      if (req.url.startsWith('/_/docs') || req.url.startsWith('/_/openapi')) {
        return reply.callNotFound();
      }
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return reply.send(this.adminHtml);
    });

    server.get('/_/', async (_req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return reply.send(this.adminHtml);
    });

    server.get('/_', async (_req: FastifyRequest, reply: FastifyReply) => {
      reply.redirect('/_/');
    });
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
