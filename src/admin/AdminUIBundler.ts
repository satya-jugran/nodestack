import * as fs from 'fs';
import * as path from 'path';

export class AdminUIBundler {
  /**
   * Bundles the modular admin UI assets (HTML shell, CSS files, and JS modules)
   * into a single, self-contained HTML document.
   */
  public static bundle(uiDir: string): string {
    const htmlPath = path.join(uiDir, 'index.html');
    if (!fs.existsSync(htmlPath)) {
      return '';
    }

    let html = fs.readFileSync(htmlPath, 'utf-8');

    // 1. Inline CSS files if css directory exists
    const cssDir = path.join(uiDir, 'css');
    if (fs.existsSync(cssDir)) {
      const cssFiles = ['main.css', 'rules.css'];
      let combinedCss = '';
      for (const file of cssFiles) {
        const filePath = path.join(cssDir, file);
        if (fs.existsSync(filePath)) {
          combinedCss += `\n/* === ${file} === */\n` + fs.readFileSync(filePath, 'utf-8') + '\n';
        }
      }

      // Remove external stylesheet link tags
      html = html.replace(/<link\s+rel=["']stylesheet["']\s+href=["'][^"']*css\/[^"']*["']\s*\/?>/gi, '');

      // Inject combined style block before </head>
      html = html.replace('</head>', `  <style>${combinedCss}  </style>\n</head>`);
    }

    // 2. Inline JS modules if js directory exists
    const jsDir = path.join(uiDir, 'js');
    if (fs.existsSync(jsDir)) {
      const jsFiles = [
        'state.js',
        'api.js',
        'rules.js',
        'schema.js',
        'records.js',
        'modals.js',
        'views.js',
        'app.js',
      ];

      let combinedJs = '';
      for (const file of jsFiles) {
        const filePath = path.join(jsDir, file);
        if (fs.existsSync(filePath)) {
          combinedJs += `\n// === ${file} ===\n` + fs.readFileSync(filePath, 'utf-8') + '\n';
        }
      }

      // Remove script tags with src="./js/..." or "/_/js/..."
      html = html.replace(/<script\s+src=["'][^"']*js\/[^"']*["']><\/script>/gi, '');

      // Inject combined script block before </body>
      html = html.replace('</body>', `  <script>${combinedJs}  </script>\n</body>`);
    }

    return html;
  }
}
