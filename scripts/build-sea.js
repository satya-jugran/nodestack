#!/usr/bin/env node

/**
 * Cross-platform Single Executable Application (SEA) Builder for NodeStack
 * Generates standalone binary executables for Windows, macOS, and Linux.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const distDir = path.join(rootDir, 'dist');

  // Parse CLI flags
  const args = process.argv.slice(2);
  let customOut = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) {
      customOut = args[i + 1];
      i++;
    }
  }

  const platform = process.platform;
  const arch = process.arch;
  const isWindows = platform === 'win32';
  const isMac = platform === 'darwin';
  const isLinux = platform === 'linux';

  const ext = isWindows ? '.exe' : '';
  const binaryFileName = customOut || `nodestack-${platform}-${arch}${ext}`;
  const targetBinaryPath = path.isAbsolute(binaryFileName)
    ? binaryFileName
    : path.join(distDir, binaryFileName);

  const bundlePath = path.join(distDir, 'sea-bundle.cjs');
  const blobPath = path.join(distDir, 'sea-prep.blob');
  const seaConfigFile = path.join(rootDir, 'sea-config.json');

  console.log('='.repeat(60));
  console.log(`🚀 Building NodeStack Single Executable Application (SEA)`);
  console.log(`   Platform: ${platform} (${arch})`);
  console.log(`   Target:   ${path.relative(rootDir, targetBinaryPath)}`);
  console.log('='.repeat(60));

  // 1. Ensure dist/admin/ui/index.html is prepared
  const adminHtmlPath = path.join(distDir, 'admin', 'ui', 'index.html');
  if (!fs.existsSync(adminHtmlPath)) {
    console.log('\n📦 [1/6] Building server and admin assets...');
    execSync('npm run build:server', { cwd: rootDir, stdio: 'inherit' });
  } else {
    console.log('\n📦 [1/6] Admin UI assets verified.');
  }

  // 2. Bundle with esbuild
  console.log('\n⚡ [2/6] Bundling JavaScript into single standalone file...');
  const esbuildCmd = [
    'npx --yes esbuild',
    'src/cli/sea-entry.ts',
    '--bundle',
    '--platform=node',
    '--target=node24',
    '--format=cjs',
    `--outfile="${bundlePath}"`
  ].join(' ');

  execSync(esbuildCmd, { cwd: rootDir, stdio: 'inherit' });

  // 3. Generate SEA Blob
  console.log('\n🧬 [3/6] Generating Node SEA preparation blob...');
  execSync(`node --experimental-sea-config "${seaConfigFile}"`, {
    cwd: rootDir,
    stdio: 'inherit',
  });

  // 4. Copy node runtime binary
  console.log(`\n📋 [4/6] Copying Node runtime from: ${process.execPath}...`);
  if (fs.existsSync(targetBinaryPath)) {
    try {
      fs.unlinkSync(targetBinaryPath);
    } catch (err) {
      // If locked, rename then delete
      const tempOld = `${targetBinaryPath}.${Date.now()}.bak`;
      fs.renameSync(targetBinaryPath, tempOld);
    }
  }
  fs.copyFileSync(process.execPath, targetBinaryPath);

  // 5. Windows: Embed official icon and PE version info
  if (isWindows) {
    console.log('\n🎨 [5/6] Embedding official application icon & PE resources...');
    const icoPath = path.join(rootDir, 'src', 'admin', 'ui', 'icon.ico');
    if (fs.existsSync(icoPath)) {
      try {
        const { rcedit } = require('rcedit');
        await rcedit(targetBinaryPath, {
          icon: icoPath,
          'version-string': {
            ProductName: 'NodeStack',
            FileDescription: 'NodeStack — The TypeScript-Native Backend Stack',
            CompanyName: 'NodeStack',
            LegalCopyright: 'MIT'
          }
        });
        console.log('   ✓ Icon and metadata embedded successfully!');
      } catch (err) {
        console.warn(`   ⚠️ Could not embed icon with rcedit: ${err.message}`);
      }
    } else {
      console.warn(`   ⚠️ icon.ico not found at ${icoPath}, skipping icon embedding.`);
    }
  } else {
    console.log('\n🎨 [5/6] Non-Windows target, skipping PE resource embedding.');
  }

  // 6. Inject blob using postject
  console.log('\n💉 [6/6] Injecting SEA blob into binary...');
  const sentinelFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

  if (isWindows) {
    const postjectCmd = `npx --yes postject "${targetBinaryPath}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse ${sentinelFuse}`;
    execSync(postjectCmd, { cwd: rootDir, stdio: 'inherit' });

    // Also create a local nodestack.exe if building default target
    if (!customOut) {
      const defaultExe = path.join(distDir, 'nodestack.exe');
      try {
        fs.copyFileSync(targetBinaryPath, defaultExe);
        console.log(`   🔗 Also copied to ${path.relative(rootDir, defaultExe)}`);
      } catch {}
    }
  } else if (isMac) {
    // macOS requires removing the signature first
    console.log('   Removing pre-existing signature...');
    execSync(`codesign --remove-signature "${targetBinaryPath}"`, { stdio: 'inherit' });

    console.log('   Injecting with Mach-O segment...');
    const postjectCmd = `npx --yes postject "${targetBinaryPath}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse ${sentinelFuse} --macho-segment-name NODE_SEA`;
    execSync(postjectCmd, { cwd: rootDir, stdio: 'inherit' });

    console.log('   Re-signing binary with ad-hoc signature...');
    execSync(`codesign --sign - "${targetBinaryPath}"`, { stdio: 'inherit' });
    fs.chmodSync(targetBinaryPath, 0o755);

    if (!customOut) {
      const defaultBin = path.join(distDir, 'nodestack');
      try {
        fs.copyFileSync(targetBinaryPath, defaultBin);
        fs.chmodSync(defaultBin, 0o755);
        console.log(`   🔗 Also copied to ${path.relative(rootDir, defaultBin)}`);
      } catch {}
    }
  } else {
    // Linux
    const postjectCmd = `npx --yes postject "${targetBinaryPath}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse ${sentinelFuse}`;
    execSync(postjectCmd, { cwd: rootDir, stdio: 'inherit' });
    fs.chmodSync(targetBinaryPath, 0o755);

    if (!customOut) {
      const defaultBin = path.join(distDir, 'nodestack');
      try {
        fs.copyFileSync(targetBinaryPath, defaultBin);
        fs.chmodSync(defaultBin, 0o755);
        console.log(`   🔗 Also copied to ${path.relative(rootDir, defaultBin)}`);
      } catch {}
    }
  }

  const stats = fs.statSync(targetBinaryPath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Binary successfully built!`);
  console.log(`   Path: ${targetBinaryPath}`);
  console.log(`   Size: ${sizeMb} MB`);
  console.log('='.repeat(60) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
