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

// 3. Helper to check if a specific package version is already on npm registry
function isAlreadyPublished(pkgName, version) {
  try {
    const raw = execSync(`npm view ${pkgName}@${version} version --json`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed === version || (Array.isArray(parsed) && parsed.includes(version))) {
        return true;
      }
    }
  } catch (e) {
    // Registry returned 404 or package/version not found -> proceed to publish
  }
  return false;
}

// Helper to determine if an npm publish error is an already-published conflict
function isAlreadyPublishedError(errorOutput) {
  const normalized = (errorOutput || '').toLowerCase();
  return (
    normalized.includes('epublishconflict') ||
    normalized.includes('cannot publish over the previously published versions') ||
    normalized.includes('previously published versions') ||
    normalized.includes('version already exists') ||
    normalized.includes('already exists') ||
    normalized.includes('is already published')
  );
}

// 4. Publish each plugin
console.log('\n[2/2] Publishing to npm registry under @nodestackapp with public access...');
let successCount = 0;
let skippedCount = 0;
const failedPackages = [];

for (const relDir of PLUGIN_DIRS) {
  const pkgDir = path.resolve(rootDir, relDir);
  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const pkgName = pkgJson.name;
  const version = pkgJson.version;

  console.log(`\n🚀 Checking \x1b[36m${pkgName}@${version}\x1b[0m...`);

  // Pre-check if already published on npm registry
  if (isAlreadyPublished(pkgName, version)) {
    console.log(`  \x1b[33mℹ Version ${version} is already published on npm. Skipping.\x1b[0m`);
    skippedCount++;
    continue;
  }

  try {
    const output = execSync('npm publish --access=public', {
      cwd: pkgDir,
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    if (output) console.log(output);
    console.log(`  \x1b[32m✓ Successfully published ${pkgName}@${version}\x1b[0m`);
    successCount++;
  } catch (err) {
    const stdout = err.stdout ? err.stdout.toString() : '';
    const stderr = err.stderr ? err.stderr.toString() : '';
    const combinedOutput = `${stdout}\n${stderr}\n${err.message || ''}`;

    if (isAlreadyPublishedError(combinedOutput)) {
      console.log(`  \x1b[33mℹ ${pkgName}@${version} was already published. Skipping.\x1b[0m`);
      skippedCount++;
    } else {
      console.error(`  \x1b[31m✕ Failed to publish ${pkgName}@${version}!\x1b[0m`);
      if (stderr.trim()) {
        console.error(`  \x1b[31m${stderr.trim()}\x1b[0m`);
      } else if (stdout.trim()) {
        console.error(`  \x1b[31m${stdout.trim()}\x1b[0m`);
      } else {
        console.error(`  \x1b[31m${err.message}\x1b[0m`);
      }
      failedPackages.push({ pkgName, version, error: err });
    }
  }
}

console.log('\n========================================================');
console.log(` Summary: ${successCount} published, ${skippedCount} skipped, ${failedPackages.length} failed.`);
console.log('========================================================\n');

if (failedPackages.length > 0) {
  console.error(`\x1b[31mPublish workflow failed! The following ${failedPackages.length} package(s) could not be published:\x1b[0m`);
  for (const f of failedPackages) {
    console.error(`  - \x1b[31m${f.pkgName}@${f.version}\x1b[0m`);
  }
  process.exit(1);
}
