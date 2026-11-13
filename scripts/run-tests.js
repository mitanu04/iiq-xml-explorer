// Runs the compiled unit tests (out/test/*.test.js) with Node's built-in test runner.
//
// The file list is built here instead of using a pattern like out/test/*.test.js in package.json,
// because Windows (cmd.exe) does not expand such patterns and Node 20 does not expand them either.
// This works the same on Windows, macOS and Linux, with npm or Yarn, on Node 20 and newer.
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, '..', 'out', 'test');

if (!fs.existsSync(testDir)) {
  console.error(`No compiled tests in ${testDir}. Run the compile step first (npm run compile / yarn compile).`);
  process.exit(1);
}

const files = fs.readdirSync(testDir)
  .filter(f => f.endsWith('.test.js'))
  .sort()
  .map(f => path.join(testDir, f));

if (files.length === 0) {
  console.error(`No *.test.js files found in ${testDir}.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
