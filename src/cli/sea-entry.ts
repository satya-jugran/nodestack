import { runCli } from './cli';

runCli().catch((err) => {
  console.error('\n✗ Error starting NodeStack:\n', err);
  if (process.platform === 'win32' && process.stdin.isTTY) {
    console.log('\nPress Enter to exit...');
    try {
      require('child_process').execSync('pause', { stdio: 'inherit' });
    } catch {}
  }
  process.exit(1);
});
