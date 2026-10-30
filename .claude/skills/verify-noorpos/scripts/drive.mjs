#!/usr/bin/env node
/**
 * Drive the real Noor Pharmacy POS (Electron) for verification over the
 * Chrome DevTools Protocol. One instance at a time, with throwaway data.
 *
 *   node .claude/skills/verify-noorpos/scripts/drive.mjs launch [--no-build] [--empty] [--size 1280x698]
 *   node .claude/skills/verify-noorpos/scripts/drive.mjs doctor
 *   node .claude/skills/verify-noorpos/scripts/drive.mjs eval <file.js>   |   eval -e "<expression>"
 *   node .claude/skills/verify-noorpos/scripts/drive.mjs shot <name>
 *   node .claude/skills/verify-noorpos/scripts/drive.mjs stop
 *   node .claude/skills/verify-noorpos/scripts/drive.mjs discard
 *
 * eval runs in the app window with page-helpers.js loaded first (window.$v).
 * Evidence (screenshots) goes to <os temp>/noorpos-verify/<run>/evidence and
 * survives stop; discard deletes every run, evidence included.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const RUNS = path.join(os.tmpdir(), 'noorpos-verify');
const STATE = path.join(RUNS, 'state.json');
const HELPERS = fs.readFileSync(path.join(HERE, 'page-helpers.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (message) => {
  console.error(`verify-noorpos: ${message}`);
  process.exit(1);
};
const readState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
};

async function pageTarget(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await res.json();
  return targets.find((t) => t.type === 'page' && t.url.startsWith('app://noorpos/')) || null;
}

/** Minimal CDP session on the app page. */
async function connect(port) {
  const target = await pageTarget(port);
  if (!target) throw new Error('no app://noorpos page target (is the app window open?)');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('cannot open the DevTools connection'));
  });
  let next = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  // Wait for the socket to finish closing: exiting mid-close trips a libuv assertion on Windows.
  const close = () =>
    new Promise((resolve) => {
      ws.onclose = resolve;
      setTimeout(resolve, 1000);
      ws.close();
    });
  return { send, close };
}

async function evaluate(session, source) {
  const { result, exceptionDetails } = await session.send('Runtime.evaluate', {
    expression: `${HELPERS}\n;(async () => { ${source}\n })()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (exceptionDetails) {
    const description = exceptionDetails.exception && exceptionDetails.exception.description;
    throw new Error(description || exceptionDetails.text);
  }
  return result.value;
}

async function setSize(session, size) {
  const [width, height] = size.split('x').map(Number);
  await session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
}

function requireRun() {
  const state = readState();
  if (!state) fail('no running instance. Run `launch` first.');
  return state;
}

const commands = {
  async launch(args) {
    const current = readState();
    if (current && alive(current.pid)) fail(`an instance is already running (pid ${current.pid}). Run \`stop\` first.`);
    const size = args.includes('--size') ? args[args.indexOf('--size') + 1] : '1280x698';
    if (!args.includes('--no-build')) {
      const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
      const build = spawnSync(process.execPath, [vite, 'build', '--config', path.join(ROOT, 'vite.config.mjs'), '--logLevel', 'warn'], {
        cwd: ROOT,
        stdio: 'inherit'
      });
      if (build.status !== 0) fail('the UI build failed');
    }
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = path.join(RUNS, id);
    const dirs = { data: path.join(runDir, 'data'), profile: path.join(runDir, 'profile'), evidence: path.join(runDir, 'evidence') };
    Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
    const port = 9300 + Math.floor(Math.random() * 600);
    const electron = createRequire(path.join(ROOT, 'package.json'))('electron');
    const log = fs.openSync(path.join(runDir, 'app.log'), 'a');
    const env = {
      ...process.env,
      NOORPOS_DATA_DIR: dirs.data,
      NOORPOS_USER_DATA_DIR: dirs.profile,
      NOORPOS_DEMO_DATA: args.includes('--empty') ? '' : '1'
    };
    // Set at all (even empty), it makes Electron run as plain Node with no `app`.
    delete env.ELECTRON_RUN_AS_NODE;
    // Windows stops painting a window that other windows cover completely, and a screenshot of it
    // would then wait forever. These Chromium switches keep it painting behind the user's windows.
    const paintWhenCovered = ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows'];
    const child = spawn(electron, [ROOT, `--remote-debugging-port=${port}`, ...paintWhenCovered], {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', log, log],
      env
    });
    child.unref();
    const state = { pid: child.pid, port, runDir, ...dirs, size, startedAt: new Date().toISOString() };
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (!alive(child.pid)) fail(`the app exited during start-up; see ${path.join(runDir, 'app.log')}`);
      try {
        const session = await connect(port);
        const ready = await evaluate(session, 'return document.body.dataset.ready === "true";');
        if (ready) {
          await setSize(session, size);
          await session.close();
          console.log(JSON.stringify({ ready: true, ...state }, null, 2));
          return;
        }
        await session.close();
      } catch (_) {
        /* not up yet */
      }
      await sleep(400);
    }
    fail(`the app did not become ready within 90 s; see ${path.join(runDir, 'app.log')}`);
  },

  async doctor() {
    const state = requireRun();
    const report = { pid: state.pid, processAlive: alive(state.pid), port: state.port, runDir: state.runDir };
    try {
      const session = await connect(state.port);
      Object.assign(
        report,
        await evaluate(
          session,
          `const info = (await window.noorpos.call('app.info')).data || {};
           return { url: location.href, ready: document.body.dataset.ready === 'true', dataDir: info.dataDir, version: info.version,
                    locked: Boolean(document.getElementById('modalPinAuth')), openDialogs: document.querySelectorAll('[data-modal-overlay]').length };`
        )
      );
      await session.close();
    } catch (err) {
      report.error = err.message;
    }
    report.ownsDataDir = report.dataDir === state.data;
    const healthy = report.processAlive && report.ready && report.ownsDataDir && !report.error;
    console.log(JSON.stringify({ healthy, ...report }, null, 2));
    if (!healthy) process.exit(1);
  },

  async eval(args) {
    const state = requireRun();
    const source = args[0] === '-e' ? args.slice(1).join(' ') : fs.readFileSync(path.resolve(args[0]), 'utf8');
    if (!source) fail('eval needs a file or -e "<code>"');
    const session = await connect(state.port);
    try {
      console.log(JSON.stringify(await evaluate(session, source), null, 2));
    } finally {
      await session.close();
    }
  },

  async shot(args) {
    const state = requireRun();
    const name = (args[0] || `shot-${Date.now()}`).replace(/[^\w.-]+/g, '-');
    const session = await connect(state.port);
    try {
      await setSize(session, state.size);
      await sleep(150);
      // A hidden window paints nothing, so the capture would wait forever: fail with a reason instead.
      const { result } = await session.send('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true });
      if (result.value === 'hidden') throw new Error('the app window is hidden (minimized?): restore it from the taskbar, then shoot again');
      const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(state.evidence, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      console.log(file);
    } finally {
      await session.close();
    }
  },

  async stop() {
    const state = readState();
    if (!state) {
      console.log('nothing running');
      return;
    }
    if (alive(state.pid)) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(state.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-state.pid, 'SIGKILL');
    }
    for (let i = 0; i < 20 && alive(state.pid); i++) await sleep(250);
    // Chromium's helper processes release the profile a few seconds after the main process dies.
    for (const dir of [state.data, state.profile]) {
      for (let attempt = 0; fs.existsSync(dir); attempt++) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch (err) {
          if (attempt >= 30) throw err;
          await sleep(500);
        }
      }
    }
    fs.rmSync(STATE, { force: true });
    console.log(JSON.stringify({ stopped: true, evidence: state.evidence, kept: fs.existsSync(state.evidence) ? fs.readdirSync(state.evidence) : [] }, null, 2));
  },

  async discard() {
    const state = readState();
    if (state && alive(state.pid)) fail('an instance is still running. Run `stop` first.');
    fs.rmSync(RUNS, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    console.log(JSON.stringify({ discarded: RUNS, exists: fs.existsSync(RUNS) }));
  }
};

const [command, ...args] = process.argv.slice(2);
if (!commands[command]) fail(`unknown command "${command || ''}". Use launch, doctor, eval, shot, stop or discard.`);
// Exit explicitly: fetch keep-alive sockets would otherwise hold the process open, and a
// shell timeout that then kills this process takes the launched app down with it. The short
// delay lets closing handles finish (exiting mid-close trips a libuv assertion on Windows).
commands[command](args).then(
  () => setTimeout(() => process.exit(process.exitCode || 0), 100),
  (err) => fail(err.message)
);
