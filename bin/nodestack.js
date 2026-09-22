#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

const distCli = path.join(__dirname, '..', 'dist', 'cli', 'cli.js');

if (fs.existsSync(distCli)) {
  const { runCli } = require(distCli);
  runCli();
} else {
  // If running directly from source in development
  try {
    require('tsx/cjs');
    const { runCli } = require('../src/cli/cli');
    runCli();
  } catch {
    console.error('Error: NodeStack must be built first. Run "npm run build".');
    process.exit(1);
  }
}
