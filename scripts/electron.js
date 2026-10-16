#!/usr/bin/env node
'use strict';

/**
 * Cross-platform launcher for development modes (env vars in npm scripts
 * don't work the same on Windows and Unix). Builds the UI first.
 *
 *   node scripts/electron.js --dev    rebuilds the UI on every save; devtools + menu,
 *                                     data in ./.devdata, sample products
 *   node scripts/electron.js --smoke  drives the real UI end to end against a
 *                                     throwaway data folder and exits 0/1
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const electron = require('electron');

const mode = process.argv[2];
const root = path.join(__dirname, '..');
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const viteArgs = ['build', '--config', path.join(root, 'vite.config.mjs')];
const env = { ...process.env };

if (mode !== '--dev' && mode !== '--smoke') {
  console.error('Usage: node scripts/electron.js --dev | --smoke');
  process.exit(2);
}

const children = [];
delete env.ELECTRON_RUN_AS_NODE;

function startElectron() {
  const app = spawn(electron, [root], { env, stdio: 'inherit' });
  app.on('exit', (code) => {
    children.forEach((c) => c.kill());
    process.exit(code === null ? 1 : code);
  });
}

if (mode === '--dev') {
  env.NOORPOS_DEV = '1';
  env.NOORPOS_DEMO_DATA = '1';
  env.NOORPOS_DATA_DIR = env.NOORPOS_DATA_DIR || path.join(root, '.devdata');
  env.NOORPOS_USER_DATA_DIR = path.join(env.NOORPOS_DATA_DIR, 'chromium-profile');
  // Rebuild on save; reload the window (Ctrl+R) to see changes. Every watcher
  // build first empties build/renderer, so Electron is started only after the
  // first build has finished - starting it alongside the watcher made it find
  // an empty folder ("The user interface has not been built").
  const watcher = spawn(process.execPath, [vite, ...viteArgs, '--watch'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(watcher);
  let started = false;
  watcher.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    // Show progress and problems, not the list of every output file.
    const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/build[\\/]renderer[\\/]/.test(l));
    if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
    if (!started && /built in/.test(text)) {
      started = true;
      startElectron();
    }
  });
  watcher.on('exit', (code) => {
    if (!started) process.exit(code || 1);
  });
} else {
  const build = spawnSync(process.execPath, [vite, ...viteArgs, '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status || 1);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noorpos-smoke-'));
  env.NOORPOS_SMOKE = '1';
  env.NOORPOS_DEMO_DATA = '1';
  env.NOORPOS_DATA_DIR = path.join(tmp, 'data');
  env.NOORPOS_USER_DATA_DIR = path.join(tmp, 'profile');
  env.NOORPOS_SMOKE_SCENARIO = path.join(__dirname, 'smoke-scenario.js');
  startElectron();
}
