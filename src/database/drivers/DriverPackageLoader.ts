import { createRequire } from 'module';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Robustly resolves and loads an optional database driver package (e.g. 'pg', 'mssql').
 *
 * Lookup strategy:
 * 1. Standard require (NodeStack's own dependency tree or local project)
 * 2. User's current working directory (process.cwd() / node_modules)
 * 3. NODE_PATH environment variable (if configured)
 * 4. Global npm root directories (supports users who ran `npm install -g <package>`)
 */
export function loadDriverPackage<T = any>(packageName: string): T {
  // 1. Standard require (NodeStack's own dependency tree)
  try {
    return require(packageName);
  } catch (err: any) {
    if (err.code !== 'MODULE_NOT_FOUND' && !err.message?.includes(`Cannot find module '${packageName}'`)) {
      throw err;
    }
  }

  // 2. User's current working directory (process.cwd())
  try {
    const cwdPkgJson = path.join(process.cwd(), 'package.json');
    const cwdRequire = createRequire(cwdPkgJson);
    return cwdRequire(packageName);
  } catch (err: any) {
    if (err.code !== 'MODULE_NOT_FOUND' && !err.message?.includes(`Cannot find module '${packageName}'`)) {
      throw err;
    }
  }

  // 3. NODE_PATH if defined
  if (process.env.NODE_PATH) {
    const paths = process.env.NODE_PATH.split(path.delimiter);
    for (const p of paths) {
      if (p && fs.existsSync(p)) {
        try {
          const req = createRequire(path.join(path.resolve(p), 'package.json'));
          return req(packageName);
        } catch {}
      }
    }
  }

  // 4. Global npm root candidates (supports `npm install -g <package>`)
  const globalCandidates: string[] = [];
  if (process.platform === 'win32') {
    if (process.env.APPDATA) {
      globalCandidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules'));
    }
    const execDir = path.dirname(process.execPath);
    globalCandidates.push(path.join(execDir, 'node_modules'));
  } else {
    globalCandidates.push(
      '/usr/local/lib/node_modules',
      '/usr/lib/node_modules',
      path.join(os.homedir(), '.npm-global', 'lib', 'node_modules')
    );
    const execDir = path.dirname(process.execPath);
    globalCandidates.push(path.resolve(execDir, '..', 'lib', 'node_modules'));
  }

  for (const candidate of globalCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      try {
        const pkgDir = path.join(candidate, packageName);
        if (fs.existsSync(pkgDir)) {
          const req = createRequire(path.join(candidate, 'package.json'));
          return req(packageName);
        }
      } catch {}
    }
  }

  throw new Error(`MODULE_NOT_FOUND: ${packageName}`);
}
