'use strict';

/**
 * MediDesk POS - Electron main process entry point.
 *
 * Responsibilities: process-level setup, window creation and security
 * hardening, startup recovery dialogs, and wiring IPC to the dispatcher.
 * Business logic lives in ./services, persistence in ./db.
 */

const path = require('path');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { AppContext, QuitRequested } = require('./app-context');
const { createRoutes } = require('./ipc/routes');
const { createDispatcher } = require('./ipc/dispatcher');
const { registerSchemePrivileges, registerAppProtocol, isAppUrl, ENTRY_URL, UI_DIR } = require('./protocol');

const isDev = process.env.MEDIDESK_DEV === '1';
const isSmokeTest = process.env.MEDIDESK_SMOKE === '1';

// Dev/smoke runs use their own Chromium profile so they never touch a real install.
if (process.env.MEDIDESK_USER_DATA_DIR) app.setPath('userData', process.env.MEDIDESK_USER_DATA_DIR);

// Old 32-bit Windows PCs often have GPU drivers that render Chromium windows
// blank; software rendering is the reliable default. MEDIDESK_GPU=1 opts back in.
if (process.env.MEDIDESK_GPU !== '1') app.disableHardwareAcceleration();

// Two instances writing the same database file would lose data.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerSchemePrivileges();
  app.whenReady().then(main).catch((err) => fatal(err));
}

let mainWindow = null;
let ctx = null;

function dataDir() {
  return process.env.MEDIDESK_DATA_DIR || path.join(app.getPath('documents'), 'MediDeskPOS');
}

function fatal(err) {
  console.error('[main] fatal startup error:', err);
  if (!isSmokeTest) dialog.showErrorBox('MediDesk POS could not start', String(err && err.stack ? err.stack : err));
  app.exit(1);
}

/** Ask the user how to recover from a database that cannot be opened as-is. */
async function decideRecovery(kind, { error, latestBackup }) {
  if (isSmokeTest) return 'quit';
  if (kind === 'newer') {
    await dialog.showMessageBox({ type: 'error', title: 'Update required', message: error.message, buttons: ['Quit'] });
    return 'quit';
  }
  const message =
    kind === 'legacy'
      ? 'This database was created by an old, incompatible MediDesk version and cannot be upgraded automatically.'
      : 'The MediDesk database file is damaged and cannot be opened.';
  const buttons = [];
  const actions = [];
  if (latestBackup) {
    buttons.push(`Restore latest backup (${latestBackup.fileName})`);
    actions.push('restoreBackup');
  }
  buttons.push('Start with an empty database', 'Quit');
  actions.push('startFresh', 'quit');
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'Database problem',
    message,
    detail: `${error.message}\n\nThe current file will be kept next to the new one (renamed), so nothing is deleted.`,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true
  });
  return actions[response];
}

function notifyRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

const platform = {
  appInfo: () => ({ version: app.getVersion(), dataDir: ctx.paths.dataDir, isDev }),
  print: () =>
    new Promise((resolve) => {
      mainWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
        resolve({ printed: success, reason: success ? null : failureReason });
      });
    }),
  pickBackupFile: async (defaultPath) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select a MediDesk backup (.db) to restore',
      defaultPath,
      filters: [{ name: 'MediDesk backup', extensions: ['db'] }],
      properties: ['openFile']
    });
    return canceled || filePaths.length === 0 ? null : filePaths[0];
  },
  openFolder: (folder) => shell.openPath(folder).then((error) => ({ opened: !error }))
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 600,
    title: 'MediDesk POS',
    icon: path.join(UI_DIR, 'icon.png'),
    show: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev || isSmokeTest
    }
  });

  if (!isDev) Menu.setApplicationMenu(null);
  mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // The UI never navigates or opens windows; block anything that tries to.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== ENTRY_URL) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  if (isSmokeTest) runSmokeTest(mainWindow);

  mainWindow.loadURL(ENTRY_URL);
}

/**
 * MEDIDESK_SMOKE=1: load the UI, optionally run an end-to-end scenario
 * (MEDIDESK_SMOKE_SCENARIO=path), fail on any renderer error, then exit.
 */
function runSmokeTest(win) {
  const scenarioPath = process.env.MEDIDESK_SMOKE_SCENARIO;
  let errors = 0;
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    if (level >= 3) errors++;
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log(`[smoke] failed to load ${url}: ${desc} (${code})`);
    errors++;
  });
  win.webContents.once('did-finish-load', async () => {
    let scenarioOk = true;
    try {
      await win.webContents.executeJavaScript(
        'new Promise((resolve) => { const t = setInterval(() => { if (document.body.dataset.ready === "true") { clearInterval(t); resolve(); } }, 50); })'
      );
      if (scenarioPath) {
        const result = await win.webContents.executeJavaScript(require('fs').readFileSync(scenarioPath, 'utf8'));
        result.steps.forEach((s) => console.log(`[smoke] ✔ ${s}`));
        result.failures.forEach((f) => console.log(`[smoke] ✖ ${f}`));
        scenarioOk = result.ok;
      }
    } catch (err) {
      console.log('[smoke] scenario crashed:', err);
      scenarioOk = false;
    }
    console.log(`[smoke] scenario=${scenarioOk ? 'passed' : 'FAILED'} renderer-errors=${errors}`);
    app.exit(scenarioOk && errors === 0 ? 0 : 1);
  });
}

async function main() {
  ctx = new AppContext({
    dataDir: dataDir(),
    decide: decideRecovery,
    demoData: process.env.MEDIDESK_DEMO_DATA === '1',
    onPersistError: (err) => {
      console.error('[db] could not save to disk:', err);
      notifyRenderer('app:warning', {
        message: `Could not save data to disk (${err.code || err.message}). Your work is kept in memory; do not close the app until this is fixed.`
      });
    }
  });

  if (!require('fs').existsSync(path.join(UI_DIR, 'index.html'))) {
    throw new Error(`The user interface has not been built. Run "npm run build:ui" first (looked in ${UI_DIR}).`);
  }

  try {
    await ctx.start();
  } catch (err) {
    if (err instanceof QuitRequested) {
      app.exit(0);
      return;
    }
    throw err;
  }

  registerAppProtocol();

  const dispatch = createDispatcher(ctx, createRoutes(ctx, platform));
  ipcMain.handle('rpc', (event, method, payload) => {
    // Only our own UI may call into the main process.
    if (!event.senderFrame || !isAppUrl(event.senderFrame.url)) {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted caller' } };
    }
    return dispatch(String(method), payload);
  });

  createWindow();

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  if (ctx) ctx.shutdown();
});

// Never let a webview or remote content be created.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
