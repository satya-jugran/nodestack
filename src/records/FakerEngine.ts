import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { SchemaField, FieldType } from '../schema/models/Field';

export interface GeneratedFilePayload {
  filename: string;
  originalName: string;
  buffer: Buffer;
  mimeType: string;
}

function crc32(buf: Buffer): number {
  let table = (crc32 as any).table;
  if (!table) {
    table = (crc32 as any).table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const typeAndData = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crcBuf]);
}

export interface FakerContext {
  index: number;
  total: number;
  collectionName: string;
  recordId: string;
  downloadFiles?: boolean;
  relationPool?: Map<string, string[]>; // collectionId/name -> record IDs
}

const FIRST_NAMES = [
  'Sarah', 'Marcus', 'Elena', 'Alex', 'Liam', 'Sophia', 'David', 'Emma',
  'Lucas', 'Olivia', 'James', 'Mia', 'Noah', 'Ava', 'Ethan', 'Isabella',
  'Benjamin', 'Charlotte', 'Mason', 'Amelia', 'Oliver', 'Harper', 'Elijah', 'Evelyn',
  'Daniel', 'Abigail', 'Henry', 'Emily', 'Sebastian', 'Elizabeth', 'Jack', 'Aria',
  'Mateo', 'Ella', 'Samuel', 'Scarlett', 'Julian', 'Chloe', 'Levi', 'Victoria',
  'Adrian', 'Grace', 'Gabriel', 'Zoe', 'Carter', 'Penelope', 'Leo', 'Riley',
  'Theo', 'Nora', 'Caleb', 'Lily', 'Ryan', 'Hannah', 'Nathan', 'Lillian'
];

const LAST_NAMES = [
  'Jenkins', 'Vance', 'Chen', 'Rodriguez', 'Patel', 'Kim', "O'Connor", 'Mendoza',
  'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Thompson',
  'Garcia', 'Martinez', 'Robinson', 'Clark', 'Lewis', 'Lee', 'Walker', 'Hall',
  'Allen', 'Young', 'Hernandez', 'King', 'Wright', 'Lopez', 'Hill', 'Scott',
  'Green', 'Adams', 'Baker', 'Gonzalez', 'Nelson', 'Carter', 'Mitchell', 'Perez',
  'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker', 'Evans', 'Edwards', 'Collins'
];

const DOMAINS = ['example.com', 'techcorp.io', 'cloudstack.dev', 'acmemail.org', 'startup.co', 'venturelab.net'];

const COMPANIES = [
  'Acme Corporation', 'Nexus Digital', 'Apex Technologies', 'Starlight Systems',
  'Vanguard Media', 'Catalyst Innovations', 'Bluefin Dynamics', 'Pulse Creative',
  'Hyperion Labs', 'Crestview Analytics', 'AeroFlow Software', 'OmniPlatform Group'
];

const JOB_TITLES = [
  'Senior Product Designer', 'Fullstack Engineer', 'Head of Engineering',
  'Product Manager', 'DevOps Specialist', 'Marketing Director', 'Lead Data Scientist',
  'Frontend Architect', 'Security Engineer', 'Solutions Architect', 'Growth Lead'
];

const ARTICLE_TITLES = [
  'Top 10 Principles for Modern Interface Design',
  'Building Scalable Realtime Microservices with NodeStack',
  'The Future of Edge Computing and Embedded Databases',
  'Essential Product Strategies for Fast-Moving Startups',
  'Mastering Fullstack TypeScript in 2026',
  'Designing High-Conversion Developer Workflows',
  'A Deep Dive into SQLite and Single-Process Architectures',
  'Continuous Delivery & Zero-Downtime Deployment Best Practices',
  'How Modern Teams Balance Velocity and Reliability',
  'Creating Resilient Offline-First Web Applications'
];

const SENTENCES = [
  'Focused on building high-performance systems and intuitive user interfaces.',
  'Passionate about developer tooling, reactive state architecture, and API design.',
  'Dedicated to creating seamless digital experiences that scale effortlessly.',
  'Advocating for modern TypeScript standards, automated testing, and simplicity.',
  'Specializing in embedded database optimization, realtime sync, and clean UX.',
  'Leading engineering teams through hyper-growth while maintaining technical excellence.'
];

const CITIES = [
  'San Francisco', 'Austin', 'New York', 'Seattle', 'Berlin',
  'London', 'Tokyo', 'Toronto', 'Amsterdam', 'Singapore', 'Stockholm', 'Dublin'
];

const COUNTRIES = [
  'United States', 'Germany', 'United Kingdom', 'Japan', 'Canada',
  'Netherlands', 'Australia', 'France', 'Sweden', 'Ireland'
];

const STREETS = [
  '742 Evergreen Terrace', '221B Baker Street', '10 Downing Street',
  '350 Fifth Avenue', '456 Innovation Way', '128 Technology Drive',
  '88 Market Street', '101 Silicon Boulevard', '19 High Street'
];

const GRADIENTS: [string, string][] = [
  ['#3b82f6', '#1d4ed8'], // Blue
  ['#10b981', '#047857'], // Emerald
  ['#8b5cf6', '#6d28d9'], // Purple
  ['#ec4899', '#be185d'], // Pink
  ['#f59e0b', '#d97706'], // Amber
  ['#06b6d4', '#0e7490'], // Cyan
  ['#ef4444', '#b91c1c'], // Red
  ['#6366f1', '#4338ca'], // Indigo
  ['#14b8a6', '#0f766e'], // Teal
  ['#f97316', '#c2410c'], // Orange
];

export class FakerEngine {
  /**
   * Random item from array
   */
  public static sample<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * Random integer between min and max inclusive
   */
  public static randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Random float with fixed decimals
   */
  public static randomFloat(min: number, max: number, decimals = 2): number {
    const val = Math.random() * (max - min) + min;
    return parseFloat(val.toFixed(decimals));
  }

  /**
   * Generate realistic human full name
   */
  public static fullName(): string {
    return `${this.sample(FIRST_NAMES)} ${this.sample(LAST_NAMES)}`;
  }

  /**
   * Generate first name
   */
  public static firstName(): string {
    return this.sample(FIRST_NAMES);
  }

  /**
   * Generate last name
   */
  public static lastName(): string {
    return this.sample(LAST_NAMES);
  }

  /**
   * Generate realistic email
   */
  public static email(nameHint?: string): string {
    const domain = this.sample(DOMAINS);
    const rand = Math.floor(Math.random() * 8999 + 1000);
    if (nameHint) {
      const clean = nameHint.toLowerCase().replace(/[^a-z0-9]/g, '.');
      return `${clean}.${rand}@${domain}`;
    }
    const first = this.sample(FIRST_NAMES).toLowerCase();
    const last = this.sample(LAST_NAMES).toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${first}.${last}${rand}@${domain}`;
  }

  /**
   * Realistic currency / price figures
   */
  public static price(min = 9.99, max = 499.99): number {
    const commonPrices = [9.99, 14.5, 19.99, 29.0, 39.95, 49.0, 79.99, 99.0, 129.5, 149.0, 199.99, 249.0, 299.0, 399.0, 499.0];
    const filtered = commonPrices.filter((p) => p >= min && p <= max);
    if (filtered.length > 0) {
      return this.sample(filtered);
    }
    return this.randomFloat(min, max, 2);
  }

  /**
   * Generate SVG Avatar buffer with initials and vibrant gradient (100% dependency-free)
   */
  public static generateLocalSvgAvatar(name: string, seed: string): Buffer {
    const initials = name
      ? name
          .split(/\s+/)
          .map((n) => n[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()
      : 'NS';

    const hash = crypto.createHash('md5').update(seed || name || 'avatar').digest('hex');
    const colorIndex = parseInt(hash.slice(0, 4), 16) % GRADIENTS.length;
    const [c1, c2] = GRADIENTS[colorIndex];

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="g_${hash.slice(0, 8)}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="100%" stop-color="${c2}" />
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="128" fill="url(#g_${hash.slice(0, 8)})" />
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
        fill="#ffffff" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        font-size="96" font-weight="600" letter-spacing="-1">${initials}</text>
</svg>`.trim();

    return Buffer.from(svg, 'utf-8');
  }

  /**
   * Generate PNG Avatar buffer with silhouette and vibrant gradient (100% dependency-free)
   */
  public static generateLocalPngAvatar(name: string, seed: string): Buffer {
    const w = 128;
    const h = 128;
    const hash = crypto.createHash('md5').update(seed || name || 'avatar').digest('hex');
    const colorIndex = parseInt(hash.slice(0, 4), 16) % GRADIENTS.length;
    const hexColor = GRADIENTS[colorIndex][0];
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);

    const raw = Buffer.alloc(h * (1 + w * 4));
    let pos = 0;
    const cx = w / 2;
    const cy = h / 2;
    const radius = w / 2 - 2;

    for (let y = 0; y < h; y++) {
      raw[pos++] = 0;
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= radius) {
          const factor = 1 - (y / h) * 0.25;
          const hx = x - cx;
          const hy = y - (cy - 14);
          const isHead = (hx * hx + hy * hy) <= (18 * 18);
          const bx = x - cx;
          const by = y - (cy + 38);
          const isBody = (bx * bx + by * by) <= (32 * 32);

          if (isHead || isBody) {
            raw[pos++] = 255;
            raw[pos++] = 255;
            raw[pos++] = 255;
            raw[pos++] = 240;
          } else {
            raw[pos++] = Math.round(r * factor);
            raw[pos++] = Math.round(g * factor);
            raw[pos++] = Math.round(b * factor);
            raw[pos++] = 255;
          }
        } else {
          raw[pos++] = 0;
          raw[pos++] = 0;
          raw[pos++] = 0;
          raw[pos++] = 0;
        }
      }
    }

    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const idat = zlib.deflateSync(raw);
    return Buffer.concat([
      sig,
      makePngChunk('IHDR', ihdr),
      makePngChunk('IDAT', idat),
      makePngChunk('IEND', Buffer.alloc(0)),
    ]);
  }

  /**
   * Fetch avatar from DiceBear or Unsplash with fast timeout and local fallback
   */
  public static async fetchOrGenerateAvatar(
    name: string,
    seed: string,
    downloadFiles = true,
    preferredFormat: 'png' | 'svg' = 'png'
  ): Promise<GeneratedFilePayload> {
    const safeSeed = encodeURIComponent(seed || name || 'user').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);

    if (preferredFormat === 'png') {
      const fallbackBuffer = this.generateLocalPngAvatar(name, safeSeed);

      if (!downloadFiles) {
        return {
          filename: `avatar_${safeSeed}.png`,
          originalName: `avatar_${safeSeed}.png`,
          buffer: fallbackBuffer,
          mimeType: 'image/png',
        };
      }

      try {
        const diceBearUrl = `https://api.dicebear.com/7.x/avataaars/png?seed=${safeSeed}&size=256`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);

        const res = await fetch(diceBearUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'NodeStack-Faker-Engine/1.0' },
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const ab = await res.arrayBuffer();
          const buf = Buffer.from(ab);
          if (buf.length > 50 && buf.subarray(1, 4).toString('ascii') === 'PNG') {
            return {
              filename: `avatar_${safeSeed}.png`,
              originalName: `avatar_${safeSeed}.png`,
              buffer: buf,
              mimeType: 'image/png',
            };
          }
        }
      } catch {}

      return {
        filename: `avatar_${safeSeed}.png`,
        originalName: `avatar_${safeSeed}.png`,
        buffer: fallbackBuffer,
        mimeType: 'image/png',
      };
    }

    // Default SVG format
    const fallbackBuffer = this.generateLocalSvgAvatar(name, safeSeed);

    if (!downloadFiles) {
      return {
        filename: `avatar_${safeSeed}.svg`,
        originalName: `avatar_${safeSeed}.svg`,
        buffer: fallbackBuffer,
        mimeType: 'image/svg+xml',
      };
    }

    try {
      const diceBearUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${safeSeed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const res = await fetch(diceBearUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'NodeStack-Faker-Engine/1.0' },
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const text = await res.text();
        if (text && text.includes('<svg')) {
          return {
            filename: `avatar_${safeSeed}.svg`,
            originalName: `avatar_${safeSeed}.svg`,
            buffer: Buffer.from(text, 'utf-8'),
            mimeType: 'image/svg+xml',
          };
        }
      }
    } catch {}

    return {
      filename: `avatar_${safeSeed}.svg`,
      originalName: `avatar_${safeSeed}.svg`,
      buffer: fallbackBuffer,
      mimeType: 'image/svg+xml',
    };
  }

  /**
   * Generate generic image placeholder for non-avatar file fields
   */
  public static generatePlaceholderImage(
    title: string,
    seed: string,
    preferredFormat: 'png' | 'svg' = 'png'
  ): GeneratedFilePayload {
    const safeSeed = encodeURIComponent(seed || title || 'image').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
    if (preferredFormat === 'png') {
      const buffer = this.generateLocalPngAvatar(title, safeSeed);
      return {
        filename: `image_${safeSeed}.png`,
        originalName: `image_${safeSeed}.png`,
        buffer,
        mimeType: 'image/png',
      };
    }

    const hash = crypto.createHash('md5').update(seed || title).digest('hex');
    const colorIndex = parseInt(hash.slice(0, 4), 16) % GRADIENTS.length;
    const [c1, c2] = GRADIENTS[colorIndex];
    const safeTitle = (title || 'NodeStack Image')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .slice(0, 24);

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400">
  <defs>
    <linearGradient id="img_${hash.slice(0, 8)}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="100%" stop-color="${c2}" />
    </linearGradient>
  </defs>
  <rect width="600" height="400" rx="16" fill="url(#img_${hash.slice(0, 8)})" />
  <circle cx="300" cy="170" r="48" fill="rgba(255,255,255,0.2)" />
  <path d="M280 185 L320 185 L305 160 Z" fill="#ffffff" />
  <text x="50%" y="260" dominant-baseline="middle" text-anchor="middle"
        fill="#ffffff" font-family="system-ui, -apple-system, sans-serif"
        font-size="24" font-weight="600">${safeTitle}</text>
</svg>`.trim();

    return {
      filename: `image_${hash.slice(0, 8)}.svg`,
      originalName: `image_${hash.slice(0, 8)}.svg`,
      buffer: Buffer.from(svg, 'utf-8'),
      mimeType: 'image/svg+xml',
    };
  }

  /**
   * Generates realistic value for a field based on schema type and semantic name
   */
  public static async generateFieldValue(
    field: SchemaField,
    context: FakerContext,
    recordAcc: Record<string, any>
  ): Promise<{ value: any; filePayload?: GeneratedFilePayload }> {
    const rawName = field.name.toLowerCase();
    const cleanName = rawName.replace(/[^a-z0-9]/g, '');

    // 1. SELECT field
    if (field.type === 'select') {
      const allowed = field.options?.values || ['draft', 'published', 'archived'];
      if (field.options?.maxSelect && field.options.maxSelect > 1) {
        const count = this.randomInt(1, Math.min(allowed.length, field.options.maxSelect));
        const shuffled = [...allowed].sort(() => 0.5 - Math.random());
        return { value: shuffled.slice(0, count).join(',') };
      }
      return { value: this.sample(allowed) };
    }

    // 2. EMAIL field or text field representing email
    if (field.type === 'email' || (field.type === 'text' && (cleanName === 'email' || cleanName.includes('mail')))) {
      const nameHint = recordAcc.name || recordAcc.full_name || recordAcc.title;
      return { value: this.email(nameHint) };
    }

    // 3. FILE field (avatar, cover, attachment)
    if (field.type === 'file') {
      const isAvatar =
        cleanName.includes('avatar') ||
        cleanName.includes('photo') ||
        cleanName.includes('profile') ||
        cleanName.includes('userimage');

      const nameHint = recordAcc.name || recordAcc.full_name || recordAcc.title || `user_${context.index}`;
      const seed = `rec_${context.recordId}_${cleanName}_${context.index}`;

      const allowedMimes = field.options?.mimeTypes || [];
      let preferredFormat: 'png' | 'svg' = 'png';
      if (allowedMimes.length > 0) {
        if (allowedMimes.includes('image/svg+xml') && !allowedMimes.includes('image/png') && !allowedMimes.includes('image/jpeg')) {
          preferredFormat = 'svg';
        } else {
          preferredFormat = 'png';
        }
      } else {
        preferredFormat = 'png';
      }

      if (isAvatar) {
        const filePayload = await this.fetchOrGenerateAvatar(nameHint, seed, context.downloadFiles, preferredFormat);
        return { value: filePayload.filename, filePayload };
      } else {
        const filePayload = this.generatePlaceholderImage(nameHint, seed, preferredFormat);
        return { value: filePayload.filename, filePayload };
      }
    }

    // 4. RELATION field
    if (field.type === 'relation') {
      const targetColId = field.options?.collectionId;
      if (targetColId && context.relationPool) {
        const candidateIds = context.relationPool.get(targetColId) || [];
        if (candidateIds.length > 0) {
          return { value: this.sample(candidateIds) };
        }
      }
      return { value: null };
    }

    // 5. NUMBER field
    if (field.type === 'number') {
      const min = field.options?.min !== undefined ? Number(field.options.min) : undefined;
      const max = field.options?.max !== undefined ? Number(field.options.max) : undefined;

      // Price / currency
      if (
        cleanName.includes('price') ||
        cleanName.includes('cost') ||
        cleanName.includes('amount') ||
        cleanName.includes('fee') ||
        cleanName.includes('salary') ||
        cleanName.includes('rate')
      ) {
        return { value: this.price(min ?? 9.99, max ?? 499.0) };
      }

      // Age
      if (cleanName === 'age') {
        return { value: this.randomInt(min ?? 18, max ?? 70) };
      }

      // Rating / score
      if (cleanName.includes('rating') || cleanName.includes('score')) {
        return { value: this.randomFloat(min ?? 3.5, max ?? 5.0, 1) };
      }

      // Quantity / stock / count / views / likes
      if (
        cleanName.includes('stock') ||
        cleanName.includes('qty') ||
        cleanName.includes('quantity') ||
        cleanName.includes('inventory')
      ) {
        return { value: this.randomInt(min ?? 0, max ?? 150) };
      }

      if (
        cleanName.includes('views') ||
        cleanName.includes('likes') ||
        cleanName.includes('clicks') ||
        cleanName.includes('count')
      ) {
        return { value: this.randomInt(min ?? 10, max ?? 2500) };
      }

      if (cleanName.includes('year')) {
        return { value: this.randomInt(min ?? 2020, max ?? 2026) };
      }

      return { value: this.randomInt(min ?? 1, max ?? 100) };
    }

    // 6. BOOLEAN field
    if (field.type === 'bool') {
      if (
        cleanName.includes('active') ||
        cleanName.includes('published') ||
        cleanName.includes('verified') ||
        cleanName.includes('enabled')
      ) {
        return { value: Math.random() < 0.75 };
      }
      return { value: Math.random() < 0.5 };
    }

    // 7. DATE field
    if (field.type === 'date') {
      const now = Date.now();
      const pastDays = this.randomInt(1, 180);
      const isFuture = cleanName.includes('due') || cleanName.includes('expire') || cleanName.includes('deadline');
      const timeOffset = pastDays * 24 * 60 * 60 * 1000 * (isFuture ? 1 : -1);
      return { value: new Date(now + timeOffset).toISOString() };
    }

    // 8. URL field
    if (field.type === 'url' || cleanName.includes('website') || cleanName.includes('link')) {
      const domain = this.sample(DOMAINS);
      return { value: `https://${domain}/${cleanName}/${context.index + 1}` };
    }

    // 9. JSON field
    if (field.type === 'json') {
      if (cleanName.includes('tag')) {
        return { value: ['nodestack', 'sqlite', 'backend', 'fastify'].slice(0, this.randomInt(1, 4)) };
      }
      if (cleanName.includes('setting') || cleanName.includes('pref') || cleanName.includes('config')) {
        return {
          value: {
            theme: this.sample(['dark', 'light', 'system']),
            notifications: Math.random() > 0.3,
            emailDigest: this.sample(['daily', 'weekly', 'never']),
          },
        };
      }
      if (cleanName.includes('address')) {
        return {
          value: {
            street: this.sample(STREETS),
            city: this.sample(CITIES),
            country: this.sample(COUNTRIES),
            zip: `${this.randomInt(10000, 99999)}`,
          },
        };
      }
      return {
        value: {
          views: this.randomInt(50, 1500),
          featured: Math.random() < 0.3,
          category: this.sample(['technology', 'lifestyle', 'productivity', 'design']),
        },
      };
    }

    // 10. TEXT field semantic matching
    if (
      cleanName === 'name' ||
      cleanName === 'fullname' ||
      cleanName === 'author' ||
      cleanName === 'authorname' ||
      cleanName === 'customer' ||
      cleanName === 'customername' ||
      cleanName === 'user' ||
      cleanName === 'username'
    ) {
      return { value: this.fullName() };
    }

    if (cleanName === 'firstname') {
      return { value: this.firstName() };
    }

    if (cleanName === 'lastname') {
      return { value: this.lastName() };
    }

    if (cleanName.includes('company') || cleanName.includes('organization') || cleanName.includes('org')) {
      return { value: this.sample(COMPANIES) };
    }

    if (cleanName.includes('role') || cleanName.includes('job') || cleanName.includes('position') || cleanName.includes('title') && cleanName.includes('job')) {
      return { value: this.sample(JOB_TITLES) };
    }

    if (cleanName.includes('title') || cleanName.includes('headline') || cleanName.includes('subject')) {
      return { value: this.sample(ARTICLE_TITLES) };
    }

    if (
      cleanName.includes('description') ||
      cleanName.includes('bio') ||
      cleanName.includes('about') ||
      cleanName.includes('summary') ||
      cleanName.includes('notes') ||
      cleanName.includes('content')
    ) {
      return { value: this.sample(SENTENCES) };
    }

    if (cleanName.includes('street') || cleanName.includes('address')) {
      return { value: this.sample(STREETS) };
    }

    if (cleanName.includes('city')) {
      return { value: this.sample(CITIES) };
    }

    if (cleanName.includes('country')) {
      return { value: this.sample(COUNTRIES) };
    }

    if (cleanName.includes('zip') || cleanName.includes('postal')) {
      return { value: `${this.randomInt(10000, 99999)}` };
    }

    if (cleanName.includes('phone') || cleanName.includes('mobile') || cleanName.includes('tel')) {
      return { value: `+1 (555) ${this.randomInt(100, 999)}-${this.randomInt(1000, 9999)}` };
    }

    if (cleanName.includes('slug')) {
      const phrase = this.sample(ARTICLE_TITLES).toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return { value: `${phrase}-${context.index + 1}` };
    }

    if (cleanName.includes('status')) {
      return { value: this.sample(['active', 'pending', 'completed', 'archived']) };
    }

    // Default text fallback
    return { value: `${field.name.charAt(0).toUpperCase() + field.name.slice(1)} ${context.index + 1}` };
  }
}
