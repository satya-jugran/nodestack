import * as fs from 'fs';
import * as path from 'path';

/**
 * Automatically detects and loads environment variables from a `.env` file into `process.env`.
 * Uses Node.js native `process.loadEnvFile` where available, with a resilient fallback parser.
 * By default, variables already set in `process.env` are preserved (not overwritten).
 */
export function loadEnvFile(explicitPath?: string): boolean {
  const targetPath = explicitPath ? path.resolve(explicitPath) : path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  try {
    // 1. Prefer Node.js 20.6+ native loadEnvFile
    if (typeof (process as any).loadEnvFile === 'function') {
      (process as any).loadEnvFile(targetPath);
      return true;
    }

    // 2. Resilient fallback line-by-line parser
    const content = fs.readFileSync(targetPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      // Handle 'export KEY=VAL'
      const sanitized = line.startsWith('export ') ? line.slice(7).trim() : line;
      const eqIdx = sanitized.indexOf('=');
      if (eqIdx <= 0) continue;

      const key = sanitized.slice(0, eqIdx).trim();
      let val = sanitized.slice(eqIdx + 1).trim();

      // Strip outer quotes if paired
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }

      // Do not overwrite existing process environment variables
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely parses a boolean environment variable.
 * Recognizes 'true', '1', 'yes', 'on' as true; 'false', '0', 'no', 'off' as false.
 * Returns defaultValue if unset, empty, or unparseable.
 */
export function getBoolEnv(key: string, defaultValue = false): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === null) return defaultValue;
  const val = String(raw).trim().toLowerCase();
  if (val === '') return defaultValue;
  if (val === 'true' || val === '1' || val === 'yes' || val === 'on') return true;
  if (val === 'false' || val === '0' || val === 'no' || val === 'off') return false;
  return defaultValue;
}

/**
 * Safely parses an integer environment variable.
 */
export function getIntEnv(key: string, defaultValue?: number): number | undefined {
  const raw = process.env[key];
  if (raw === undefined || raw === null) return defaultValue;
  const val = String(raw).trim();
  if (!val) return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Safely gets a trimmed non-empty string environment variable.
 */
export function getStringEnv(key: string, defaultValue?: string): string | undefined {
  const raw = process.env[key];
  if (raw === undefined || raw === null) return defaultValue;
  const val = String(raw).trim();
  return val.length > 0 ? val : defaultValue;
}
