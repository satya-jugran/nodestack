const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, 'dist');
if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true });
}
fs.mkdirSync(outDir, { recursive: true });

console.log('[nodestack-client] Generating TypeScript declarations (.d.ts)...');
execSync('npx tsc --project tsconfig.json', { stdio: 'inherit', cwd: __dirname });

console.log('[nodestack-client] Bundling ESM & CJS modules with esbuild...');
// Build ESM
execSync(
  'npx esbuild src/index.ts --bundle --format=esm --target=es2022 --outfile=dist/index.mjs --sourcemap',
  { stdio: 'inherit', cwd: __dirname }
);

// Build CJS
execSync(
  'npx esbuild src/index.ts --bundle --format=cjs --target=es2022 --outfile=dist/index.cjs --sourcemap',
  { stdio: 'inherit', cwd: __dirname }
);

const esmSize = fs.statSync(path.join(outDir, 'index.mjs')).size;
const cjsSize = fs.statSync(path.join(outDir, 'index.cjs')).size;

console.log(`[nodestack-client] Build complete!`);
console.log(`  • ESM: ${(esmSize / 1024).toFixed(2)} KB (dist/index.mjs)`);
console.log(`  • CJS: ${(cjsSize / 1024).toFixed(2)} KB (dist/index.cjs)`);
