const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');

const PLUGIN_DIRS = [
  'packages/plugins/stripe',
  'packages/plugins/s3',
  'packages/plugins/resend',
  'packages/plugins/webhooks',
  'packages/plugins/algolia',
];

console.log('========================================================');
console.log('  @nodestackapp Plugin Publisher                        ');
console.log('========================================================\n');

// 1. Check npm login
let currentUser = '';
try {
  currentUser = execSync('npm whoami', { encoding: 'utf8' }).trim();
  console.log(`✓ Authenticated as npm user: \x1b[32m${currentUser}\x1b[0m`);
} catch (e) {
  console.error('\x1b[31m✕ You are not logged in to npm.\x1b[0m');
  console.error('Please run \x1b[33mnpm login\x1b[0m in your terminal first, then re-run this script.');
  process.exit(1);
}

// 2. Build plugins first
console.log('\n[1/2] Compiling all plugins (ESM, CJS, Types)...');
execSync('node scripts/build-plugins.js', { stdio: 'inherit', cwd: rootDir });

// 3. Publish each plugin
console.log('\n[2/2] Publishing to npm registry under @nodestackapp with public access...');
let successCount = 0;
let skippedCount = 0;

for (const relDir of PLUGIN_DIRS) {
  const pkgDir = path.resolve(rootDir, relDir);
  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const pkgName = pkgJson.name;
  const version = pkgJson.version;

  console.log(`\n🚀 Publishing \x1b[36m${pkgName}@${version}\x1b[0m...`);
  try {
    execSync('npm publish --access=public', { stdio: 'inherit', cwd: pkgDir });
    console.log(`  \x1b[32m✓ Successfully published ${pkgName}@${version}\x1b[0m`);
    successCount++;
  } catch (err) {
    console.warn(`  \x1b[33m! Note: Failed to publish ${pkgName} (it may already be published at version ${version})\x1b[0m`);
    skippedCount++;
  }
}

console.log('\n========================================================');
console.log(` Summary: ${successCount} published, ${skippedCount} skipped/failed.`);
console.log('========================================================\n');
