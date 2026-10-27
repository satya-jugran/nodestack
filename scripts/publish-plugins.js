const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const rootDir = path.resolve(__dirname, '..');

const PLUGIN_DIRS = [
  'packages/plugins/stripe',
  'packages/plugins/s3',
  'packages/plugins/resend',
  'packages/plugins/chat-notifications',
  'packages/plugins/webhooks',
  'packages/plugins/algolia',
];

console.log('========================================================');
console.log('  @nodestackapp Plugin Publisher                        ');
console.log('========================================================\n');

// Parse CLI flags: --otp=<code>, --otp <code>, --dry-run
const args = process.argv.slice(2);
let currentOtp = process.env.NPM_OTP || process.env.OTP || '';
const isDryRun = args.includes('--dry-run');

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--otp=')) {
    currentOtp = args[i].split('=')[1].trim();
  } else if (args[i] === '--otp' && args[i + 1]) {
    currentOtp = args[i + 1].trim();
  }
}

// Interactive helper to prompt for 2FA OTP code
function promptOtp(message = 'Enter your 6-digit npm authenticator OTP: ') {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve('');
      return;
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`\x1b[35m🔑 ${message}\x1b[0m`, (ans) => {
      rl.close();
      resolve((ans || '').trim());
    });
  });
}

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

// Helper to check for EOTP error
function isOtpError(errorOutput) {
  const normalized = (errorOutput || '').toLowerCase();
  return (
    normalized.includes('eotp') ||
    normalized.includes('one-time password') ||
    normalized.includes('authenticator')
  );
}

async function run() {
  console.log('\n[2/2] Publishing to npm registry under @nodestackapp with public access...');
  if (isDryRun) {
    console.log('\x1b[33mℹ Running in --dry-run mode: packages will not be sent to registry.\x1b[0m');
  }

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

    if (isDryRun) {
      console.log(`  \x1b[32m[DRY RUN] Would publish ${pkgName}@${version} --access=public\x1b[0m`);
      successCount++;
      continue;
    }

    let published = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!published && attempts < maxAttempts) {
      attempts++;
      const otpFlag = currentOtp ? ` --otp=${currentOtp}` : '';
      const publishCmd = `npm publish --access=public${otpFlag}`;

      try {
        const output = execSync(publishCmd, {
          cwd: pkgDir,
          encoding: 'utf8',
          stdio: ['inherit', 'pipe', 'pipe'],
        });
        if (output && output.trim()) console.log(output.trim());
        console.log(`  \x1b[32m✓ Successfully published ${pkgName}@${version}\x1b[0m`);
        published = true;
        successCount++;
      } catch (err) {
        const stdout = err.stdout ? err.stdout.toString() : '';
        const stderr = err.stderr ? err.stderr.toString() : '';
        const combinedOutput = `${stdout}\n${stderr}\n${err.message || ''}`;

        if (isAlreadyPublishedError(combinedOutput)) {
          console.log(`  \x1b[33mℹ ${pkgName}@${version} was already published. Skipping.\x1b[0m`);
          skippedCount++;
          published = true;
          break;
        }

        // If EOTP error, prompt interactively for fresh OTP and retry
        if (isOtpError(combinedOutput)) {
          if (process.stdin.isTTY) {
            console.log(`  \x1b[33m⚠️ 2FA One-Time Password (OTP) required for ${pkgName}!\x1b[0m`);
            const newOtp = await promptOtp(`Enter 2FA OTP for ${pkgName}: `);
            if (newOtp) {
              currentOtp = newOtp;
              // Loop back and retry with the new OTP
              continue;
            }
          } else {
            console.error(`  \x1b[31m✕ 2FA OTP required but terminal is non-interactive.\x1b[0m`);
            console.error(`  Pass --otp=<code> via CLI: \x1b[33mnpm run publish:plugins -- --otp=123456\x1b[0m`);
          }
        }

        console.error(`  \x1b[31m✕ Failed to publish ${pkgName}@${version}!\x1b[0m`);
        if (stderr.trim()) {
          console.error(`  \x1b[31m${stderr.trim()}\x1b[0m`);
        } else if (stdout.trim()) {
          console.error(`  \x1b[31m${stdout.trim()}\x1b[0m`);
        } else {
          console.error(`  \x1b[31m${err.message}\x1b[0m`);
        }
        failedPackages.push({ pkgName, version, error: err });
        break;
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
    console.error('\nTip: You can pass your authenticator code directly: \x1b[33mnpm run publish:plugins -- --otp=123456\x1b[0m');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unexpected error in publisher:', err);
  process.exit(1);
});
