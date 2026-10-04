export interface SvgImageOptions {
  title: string;
  category?: string;
  subtitle?: string;
  price?: number;
  icon?: string;
  gradientFrom?: string;
  gradientTo?: string;
  badge?: string;
  width?: number;
  height?: number;
}

const GRADIENT_PALETTES = [
  { from: '#2563eb', to: '#1d4ed8', accent: '#60a5fa' }, // Indigo / Blue
  { from: '#7c3aed', to: '#6d28d9', accent: '#a78bfa' }, // Purple
  { from: '#059669', to: '#047857', accent: '#34d399' }, // Emerald
  { from: '#d97706', to: '#b45309', accent: '#fbbf24' }, // Amber
  { from: '#dc2626', to: '#b91c1c', accent: '#f87171' }, // Crimson
  { from: '#0891b2', to: '#0e7490', accent: '#38bdf8' }, // Cyan
  { from: '#db2777', to: '#be185d', accent: '#f472b6' }, // Rose
  { from: '#4f46e5', to: '#3730a3', accent: '#818cf8' }, // Deep Violet
];

export class TemplateImageGenerator {
  /**
   * Escape XML entities
   */
  public static escapeXml(unsafe: string): string {
    return (unsafe || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Returns vector path icon based on name
   */
  private static getVectorIcon(name = 'default', color = '#ffffff'): string {
    switch (name.toLowerCase()) {
      case 'headphones':
        return `
          <path d="M12 2C6.48 2 2 6.48 2 12v7a3 3 0 003 3h1a2 2 0 002-2v-5a2 2 0 00-2-2H4v-1c0-4.41 3.59-8 8-8s8 3.59 8 8v1h-2a2 2 0 00-2 2v5a2 2 0 002 2h1a3 3 0 003-3v-7c0-5.52-4.48-10-10-10z" fill="${color}" fill-opacity="0.9"/>
        `;
      case 'keyboard':
        return `
          <rect x="2" y="5" width="20" height="14" rx="2" stroke="${color}" stroke-width="2" fill="none"/>
          <line x1="6" y1="9" x2="8" y2="9" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
          <line x1="11" y1="9" x2="13" y2="9" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
          <line x1="16" y1="9" x2="18" y2="9" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
          <line x1="6" y1="13" x2="8" y2="13" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
          <line x1="11" y1="13" x2="18" y2="13" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        `;
      case 'monitor':
        return `
          <rect x="2" y="3" width="20" height="14" rx="2" stroke="${color}" stroke-width="2" fill="none"/>
          <line x1="8" y1="21" x2="16" y2="21" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
          <line x1="12" y1="17" x2="12" y2="21" stroke="${color}" stroke-width="2"/>
        `;
      case 'mic':
        return `
          <path d="M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3z" fill="${color}"/>
          <path d="M19 10v1a7 7 0 01-14 0v-1M12 18v4M8 22h8" stroke="${color}" stroke-width="2" stroke-linecap="round" fill="none"/>
        `;
      case 'lamp':
        return `
          <path d="M9 2h6l2 7H7l2-7z" fill="${color}" fill-opacity="0.9"/>
          <line x1="12" y1="9" x2="12" y2="19" stroke="${color}" stroke-width="2"/>
          <line x1="8" y1="19" x2="16" y2="19" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        `;
      case 'backpack':
        return `
          <rect x="5" y="8" width="14" height="13" rx="3" stroke="${color}" stroke-width="2" fill="none"/>
          <path d="M9 8V5a3 3 0 016 0v3" stroke="${color}" stroke-width="2" fill="none"/>
          <line x1="5" y1="13" x2="19" y2="13" stroke="${color}" stroke-width="2"/>
          <rect x="8" y="15" width="8" height="4" rx="1" fill="${color}" fill-opacity="0.3"/>
        `;
      case 'watch':
        return `
          <circle cx="12" cy="12" r="7" stroke="${color}" stroke-width="2" fill="none"/>
          <polyline points="12 8 12 12 14.5 13.5" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
          <path d="M9 5V2h6v3M9 19v3h6v-3" stroke="${color}" stroke-width="2"/>
        `;
      case 'glasses':
        return `
          <circle cx="6.5" cy="12" r="3.5" stroke="${color}" stroke-width="2" fill="none"/>
          <circle cx="17.5" cy="12" r="3.5" stroke="${color}" stroke-width="2" fill="none"/>
          <path d="M10 12h4M3 11l-1-2M21 11l1-2" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        `;
      case 'wallet':
        return `
          <rect x="3" y="6" width="18" height="12" rx="2" stroke="${color}" stroke-width="2" fill="none"/>
          <path d="M16 10h5v4h-5a2 2 0 010-4z" fill="${color}" fill-opacity="0.8"/>
          <circle cx="18" cy="12" r="1" fill="#fff"/>
        `;
      case 'card':
        return `
          <rect x="2" y="5" width="20" height="14" rx="2" stroke="${color}" stroke-width="2" fill="none"/>
          <line x1="2" y1="10" x2="22" y2="10" stroke="${color}" stroke-width="2"/>
          <line x1="6" y1="15" x2="10" y2="15" stroke="${color}" stroke-width="2"/>
        `;
      case 'hoodie':
      case 'shirt':
        return `
          <path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.5a2 2 0 001.23 1.54L6 11.5V20a2 2 0 002 2h8a2 2 0 002-2v-8.5l1.91-.77a2 2 0 001.23-1.54l.58-3.5a2 2 0 00-1.34-2.23z" stroke="${color}" stroke-width="2" fill="none"/>
        `;
      case 'shoe':
        return `
          <path d="M3 14l3-6 4 2 4-2 7 6v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4z" stroke="${color}" stroke-width="2" fill="none"/>
          <line x1="3" y1="17" x2="21" y2="17" stroke="${color}" stroke-width="2"/>
        `;
      case 'chair':
        return `
          <path d="M7 3h10v7a2 2 0 01-2 2H9a2 2 0 01-2-2V3z" stroke="${color}" stroke-width="2" fill="none"/>
          <path d="M5 13h14v2a2 2 0 01-2 2H7a2 2 0 01-2-2v-2z" fill="${color}" fill-opacity="0.8"/>
          <line x1="12" y1="17" x2="12" y2="20" stroke="${color}" stroke-width="2"/>
          <line x1="8" y1="21" x2="16" y2="21" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        `;
      case 'candle':
        return `
          <rect x="7" y="10" width="10" height="11" rx="2" stroke="${color}" stroke-width="2" fill="none"/>
          <path d="M12 3c-1.5 2-2 3.5-2 4.5a2 2 0 004 0C14 6.5 13.5 5 12 3z" fill="${color}"/>
          <line x1="12" y1="7.5" x2="12" y2="10" stroke="${color}" stroke-width="1.5"/>
        `;
      case 'coffee':
        return `
          <path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" stroke="${color}" stroke-width="2" fill="none"/>
          <line x1="6" y1="2" x2="6" y2="5" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
          <line x1="10" y1="2" x2="10" y2="5" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
          <line x1="14" y1="2" x2="14" y2="5" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        `;
      case 'shelf':
        return `
          <rect x="2" y="7" width="20" height="4" rx="1" fill="${color}" fill-opacity="0.9"/>
          <line x1="6" y1="11" x2="6" y2="17" stroke="${color}" stroke-width="2"/>
          <line x1="18" y1="11" x2="18" y2="17" stroke="${color}" stroke-width="2"/>
        `;
      case 'bottle':
      case 'perfume':
        return `
          <rect x="6" y="8" width="12" height="13" rx="3" stroke="${color}" stroke-width="2" fill="none"/>
          <rect x="10" y="4" width="4" height="4" stroke="${color}" stroke-width="2" fill="none"/>
          <path d="M9 4h6" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
          <circle cx="12" cy="14" r="2.5" fill="${color}" fill-opacity="0.5"/>
        `;
      default:
        return `
          <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" stroke="${color}" stroke-width="2" fill="none"/>
          <circle cx="12" cy="12" r="3" fill="${color}"/>
        `;
    }
  }

  /**
   * Generates high-res SVG image for e-commerce products
   */
  public static generateProductSvg(options: SvgImageOptions, paletteIndex = 0): Buffer {
    const p = GRADIENT_PALETTES[paletteIndex % GRADIENT_PALETTES.length];
    const width = options.width || 600;
    const height = options.height || 400;
    const title = this.escapeXml(options.title);
    const category = this.escapeXml(options.category || 'Product');
    const priceText = options.price !== undefined ? `$${options.price.toFixed(2)}` : '';
    const iconSvg = this.getVectorIcon(options.icon || 'default', '#ffffff');
    const gradId = `pgrad_${Math.abs(paletteIndex)}_${Math.floor(Math.random() * 10000)}`;

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="60%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="${gradId}_accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${p.from}"/>
      <stop offset="100%" stop-color="${p.to}"/>
    </linearGradient>
    <filter id="${gradId}_glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="16" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Background Base -->
  <rect width="${width}" height="${height}" rx="14" fill="url(#${gradId})"/>

  <!-- Top Accent Bar -->
  <rect x="0" y="0" width="${width}" height="6" fill="url(#${gradId}_accent)"/>

  <!-- Ambient Glow Behind Graphic -->
  <circle cx="300" cy="170" r="95" fill="${p.accent}" fill-opacity="0.16" filter="url(#${gradId}_glow)"/>

  <!-- Inner Display Card -->
  <rect x="180" y="60" width="240" height="190" rx="20" fill="#0b0f19" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>

  <!-- Icon Centered inside Card -->
  <g transform="translate(262, 117) scale(3.2)">
    ${iconSvg}
  </g>

  <!-- Category & Price Header Pill -->
  <g transform="translate(32, 34)">
    <rect width="110" height="26" rx="6" fill="${p.from}" fill-opacity="0.2" stroke="${p.from}" stroke-opacity="0.4"/>
    <text x="55" y="17" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="${p.accent}" letter-spacing="0.5">${category.toUpperCase()}</text>
  </g>

  ${
    priceText
      ? `
  <g transform="translate(${width - 120}, 34)">
    <rect width="88" height="26" rx="6" fill="rgba(16, 185, 129, 0.15)" stroke="rgba(16, 185, 129, 0.4)"/>
    <text x="44" y="17" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="700" fill="#34d399">${priceText}</text>
  </g>`
      : ''
  }

  <!-- Product Title & Details Footer -->
  <g transform="translate(300, 298)">
    <text text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="700" fill="#ffffff" letter-spacing="-0.3">${title}</text>
    <text y="28" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="500" fill="#94a3b8">NodeStack E-Commerce Official Catalog</text>
  </g>

  <!-- Verification Badge -->
  <g transform="translate(300, 362)">
    <text text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="600" fill="#64748b" letter-spacing="0.8">★ ★ ★ ★ ★ PREMIUM VERIFIED ITEM</text>
  </g>
</svg>
`.trim();

    return Buffer.from(svg, 'utf-8');
  }

  /**
   * Generates category hero SVG
   */
  public static generateCategorySvg(title: string, icon = 'default', paletteIndex = 0): Buffer {
    const p = GRADIENT_PALETTES[paletteIndex % GRADIENT_PALETTES.length];
    const width = 600;
    const height = 400;
    const safeTitle = this.escapeXml(title);
    const iconSvg = this.getVectorIcon(icon, '#ffffff');
    const gradId = `cgrad_${paletteIndex}_${Math.floor(Math.random() * 10000)}`;

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${p.from}"/>
      <stop offset="100%" stop-color="${p.to}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="14" fill="url(#${gradId})"/>
  <circle cx="300" cy="180" r="70" fill="rgba(255,255,255,0.12)"/>
  <g transform="translate(268, 148) scale(2.7)">
    ${iconSvg}
  </g>
  <text x="300" y="295" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="28" font-weight="800" fill="#ffffff">${safeTitle}</text>
  <text x="300" y="325" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="13" font-weight="600" fill="rgba(255,255,255,0.75)" letter-spacing="1">CURATED COLLECTION</text>
</svg>
`.trim();

    return Buffer.from(svg, 'utf-8');
  }

  /**
   * Generates avatar SVG with initials
   */
  public static generateAvatarSvg(name: string, role = 'Author', paletteIndex = 0): Buffer {
    const p = GRADIENT_PALETTES[paletteIndex % GRADIENT_PALETTES.length];
    const initials = name
      .split(' ')
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('');
    const gradId = `agrad_${paletteIndex}_${Math.floor(Math.random() * 10000)}`;

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${p.from}"/>
      <stop offset="100%" stop-color="${p.to}"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" rx="100" fill="url(#${gradId})"/>
  <circle cx="100" cy="100" r="92" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="3"/>
  <text x="100" y="116" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="64" font-weight="800" fill="#ffffff" letter-spacing="-1">${initials}</text>
</svg>
`.trim();

    return Buffer.from(svg, 'utf-8');
  }

  /**
   * Generates modern editorial blog cover SVG
   */
  public static generateBlogCoverSvg(title: string, tag = 'Tech', paletteIndex = 0): Buffer {
    const p = GRADIENT_PALETTES[paletteIndex % GRADIENT_PALETTES.length];
    const width = 800;
    const height = 450;
    const safeTitle = this.escapeXml(title);
    const safeTag = this.escapeXml(tag);
    const gradId = `bgrad_${paletteIndex}_${Math.floor(Math.random() * 10000)}`;

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090d16"/>
      <stop offset="60%" stop-color="#111827"/>
      <stop offset="100%" stop-color="#090d16"/>
    </linearGradient>
    <linearGradient id="${gradId}_accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${p.from}"/>
      <stop offset="100%" stop-color="${p.to}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="16" fill="url(#${gradId})"/>
  
  <!-- Subtle decorative grid -->
  <path d="M0 100 H${width} M0 200 H${width} M0 300 H${width} M0 400 H${width}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
  <path d="M200 0 V${height} M400 0 V${height} M600 0 V${height}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>

  <!-- Left Accent Glow -->
  <circle cx="160" cy="225" r="140" fill="${p.from}" fill-opacity="0.18"/>
  <rect x="0" y="0" width="8" height="${height}" fill="url(#${gradId}_accent)"/>

  <!-- Tag Pill -->
  <g transform="translate(60, 60)">
    <rect width="110" height="30" rx="8" fill="${p.from}" fill-opacity="0.25" stroke="${p.from}" stroke-opacity="0.6"/>
    <text x="55" y="19" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="12" font-weight="700" fill="${p.accent}" letter-spacing="1">#${safeTag.toUpperCase()}</text>
  </g>

  <!-- Title & Excerpt -->
  <g transform="translate(60, 200)">
    <text font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="36" font-weight="800" fill="#ffffff" letter-spacing="-0.5">${safeTitle}</text>
    <text y="50" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="16" font-weight="400" fill="#94a3b8">Deep dive insights and practical implementation patterns for modern fullstack engineers.</text>
  </g>

  <!-- Footer meta -->
  <g transform="translate(60, 390)">
    <text font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="12" font-weight="600" fill="#64748b" letter-spacing="1">NODESTACK EDITORIAL &bull; 6 MIN READ</text>
  </g>
</svg>
`.trim();

    return Buffer.from(svg, 'utf-8');
  }

  /**
   * Generates company logo SVG
   */
  public static generateCompanyLogoSvg(name: string, industry = 'SaaS', paletteIndex = 0): Buffer {
    const p = GRADIENT_PALETTES[paletteIndex % GRADIENT_PALETTES.length];
    const initial = (name[0] || 'C').toUpperCase();
    const gradId = `cmlogo_${paletteIndex}_${Math.floor(Math.random() * 10000)}`;

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${p.from}"/>
      <stop offset="100%" stop-color="${p.to}"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" rx="36" fill="#0d1117" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
  <rect x="24" y="24" width="152" height="152" rx="28" fill="url(#${gradId})"/>
  <text x="100" y="122" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="76" font-weight="900" fill="#ffffff">${initial}</text>
</svg>
`.trim();

    return Buffer.from(svg, 'utf-8');
  }
}
