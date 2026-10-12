/**
 * MediDesk POS - Electron Main Process
 * High-Performance Engine optimized for Windows 7, 8, 8.1, 10, 11 (ia32 & x64)
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const { SCHEMA_SQL, INDEX_SQL, DEFAULT_SEED_DATA } = require('./database');

// DISABLE GPU HARDWARE ACCELERATION FOR ULTRA-FAST PERFORMANCE ON LEGACY 32-BIT WINDOWS PCs
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-accelerated-2d-canvas');
app.commandLine.appendSwitch('disable-accelerated-video-decode');
app.commandLine.appendSwitch('disable-accelerated-mjpeg-decode');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('use-gl', 'disabled');

// Application Storage Paths
const DOCUMENTS_DIR = path.join(app.getPath('documents'), 'MediDeskPOS');
const DB_PATH = path.join(DOCUMENTS_DIR, 'medidesk_pos.db');
const LOGO_DIR = path.join(DOCUMENTS_DIR, 'Logo');
const PRESCRIPTIONS_DIR = path.join(DOCUMENTS_DIR, 'Prescriptions');
const BACKUPS_DIR = path.join(DOCUMENTS_DIR, 'Backups');

let mainWindow = null;
let db = null;
let saveTimer = null;
let isSaving = false;
let isSavePending = false;

// Ensure directories exist
function ensureDirectoriesExist() {
  [DOCUMENTS_DIR, LOGO_DIR, PRESCRIPTIONS_DIR, BACKUPS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// Initialize SQLite WASM Engine & Database Connection
async function initDatabase() {
  ensureDirectoriesExist();

  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file)
  });

  if (fs.existsSync(DB_PATH)) {
    try {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
      console.log('Successfully loaded existing SQLite database from:', DB_PATH);
    } catch (err) {
      console.error('Error reading database file, creating fresh instance:', err);
      db = new SQL.Database();
    }
  } else {
    console.log('Creating new SQLite database instance at:', DB_PATH);
    db = new SQL.Database();
  }

  // Fast Memory Speed Pragmas
  try {
    db.run("PRAGMA synchronous = OFF;");
    db.run("PRAGMA journal_mode = MEMORY;");
  } catch(e) {}

  // Create base tables if they do not exist
  try {
    db.run(SCHEMA_SQL);
  } catch(err) {
    console.warn("Base schema creation notice:", err.message);
  }

  // Schema Validation & Migration
  try {
    const cols = queryAll("PRAGMA table_info(products);");
    const colNames = cols.map(c => c.name);

    if (!colNames.includes('title') || !colNames.includes('expiry_date') || !colNames.includes('quantity_packs')) {
      console.log('Migrating database schema to simplified Product-Centric model...');
      executeRun("DROP TABLE IF EXISTS void_sales;");
      executeRun("DROP TABLE IF EXISTS sale_items;");
      executeRun("DROP TABLE IF EXISTS sales;");
      executeRun("DROP TABLE IF EXISTS batches;");
      executeRun("DROP TABLE IF EXISTS products;");
      executeRun("DROP TABLE IF EXISTS customer_ledger;");
      executeRun("DROP TABLE IF EXISTS customers;");
      executeRun("DROP TABLE IF EXISTS users;");
      executeRun("DROP TABLE IF EXISTS categories;");
      executeRun("DROP TABLE IF EXISTS suppliers;");
      executeRun("DROP TABLE IF EXISTS settings;");
      executeRun("DROP TABLE IF EXISTS parked_orders;");

      db.run(SCHEMA_SQL);
      seedInitialData();
    } else {
      seedInitialData();
    }
  } catch (e) {
    console.error("Migration error:", e);
    seedInitialData();
  }

  // Create High-Performance SQL Indices safely after schema validation
  if (INDEX_SQL) {
    try {
      db.run(INDEX_SQL);
      console.log('High-performance database indices verified successfully.');
    } catch (err) {
      console.warn("Index creation warning (safe fallback):", err.message);
    }
  }

  flushDatabaseSaveSync();
}

function seedInitialData() {
  db.run(DEFAULT_SEED_DATA.settings);
  try {
    db.run("UPDATE settings SET store_name = 'Hashmi Medical Store', store_address = 'Muhammdia Colony St 9 Sargodha' WHERE id = 1 AND (store_name = 'MediDesk Pharmacy' OR store_name = 'MediDesk Pharmacy & Wellness' OR store_address LIKE '%Healthcare Boulevard%' OR store_address LIKE '%Medical Center Plaza%');");
  } catch(e) {}
  DEFAULT_SEED_DATA.users.forEach(sql => db.run(sql));
  DEFAULT_SEED_DATA.customers.forEach(sql => db.run(sql));
  DEFAULT_SEED_DATA.categories.forEach(sql => db.run(sql));
  DEFAULT_SEED_DATA.suppliers.forEach(sql => db.run(sql));
  DEFAULT_SEED_DATA.products.forEach(sql => db.run(sql));
  DEFAULT_SEED_DATA.ledger.forEach(sql => db.run(sql));
}

// High-Performance Debounced Asynchronous Disk Persistence
function scheduleDatabaseSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    performAsyncSave();
  }, 300);
}

function performAsyncSave() {
  if (!db || isSaving) {
    isSavePending = true;
    return;
  }
  isSaving = true;
  isSavePending = false;

  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFile(DB_PATH, buffer, (err) => {
      isSaving = false;
      if (err) console.error('Error writing database to disk:', err);
      if (isSavePending) {
        performAsyncSave();
      }
    });
  } catch (err) {
    isSaving = false;
    console.error('Export database error:', err);
  }
}

// Synchronous Flush for App Quit & Critical Operations
function flushDatabaseSaveSync() {
  if (saveTimer) clearTimeout(saveTimer);
  if (db) {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
    } catch(err) {
      console.error('Flush DB error:', err);
    }
  }
}

// Database Exec & Query Helper Functions
function executeRun(sql, params = []) {
  try {
    db.run(sql, params);
    scheduleDatabaseSave();
    return { success: true };
  } catch (err) {
    console.error('Database RUN Error:', err, 'SQL:', sql, 'Params:', params);
    return { success: false, error: err.message };
  }
}

function executeTransaction(statements = []) {
  try {
    db.run("BEGIN TRANSACTION;");
    for (const stmt of statements) {
      db.run(stmt.sql, stmt.params || []);
    }
    db.run("COMMIT;");
    scheduleDatabaseSave();
    return { success: true };
  } catch (err) {
    console.error('Database TRANSACTION Error:', err);
    try { db.run("ROLLBACK;"); } catch(e) {}
    return { success: false, error: err.message };
  }
}

function queryAll(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  } catch (err) {
    console.error('Database QUERY Error:', err, 'SQL:', sql, 'Params:', params);
    return [];
  }
}

function queryGet(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Create Electron Desktop Window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 600,
    title: 'MediDesk POS - Offline Pharmacy Management System',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    show: false, // Don't show until ready to prevent white flash
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
      enableWebSQL: false
    }
  });

  mainWindow.maximize();
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Register Safe Unified IPC Invocation Handler
function registerIpcHandlers(channelAliases, handlerFn) {
  channelAliases.forEach(alias => {
    ipcMain.handle(alias, (event, ...args) => handlerFn(event, ...args));
  });
}

// App Lifecycle Events
app.whenReady().then(async () => {
  await initDatabase();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  flushDatabaseSaveSync();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  flushDatabaseSaveSync();
});

// IPC Handler Declarations
registerIpcHandlers(['db-query', 'db:query'], async (event, { sql, params }) => {
  return { success: true, data: queryAll(sql, params) };
});

registerIpcHandlers(['db-get', 'db:get'], async (event, { sql, params }) => {
  return { success: true, data: queryGet(sql, params) };
});

registerIpcHandlers(['db-run', 'db:run'], async (event, { sql, params }) => {
  return executeRun(sql, params);
});

registerIpcHandlers(['db-transaction', 'db:transaction'], async (event, { statements }) => {
  return executeTransaction(statements);
});

// Save Scanned Prescription File
registerIpcHandlers(['save-prescription', 'file:savePrescription'], async (event, { fileName, base64Data }) => {
  try {
    const ext = path.extname(fileName) || '.jpg';
    const targetName = `rx_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
    const targetPath = path.join(PRESCRIPTIONS_DIR, targetName);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(targetPath, buffer);
    const relativePath = path.join('Prescriptions', targetName);
    return { success: true, filePath: targetPath, relativePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Save Store Logo File
registerIpcHandlers(['save-logo', 'file:saveLogo'], async (event, { fileName, base64Data }) => {
  try {
    const ext = path.extname(fileName) || '.png';
    const targetName = `logo_store${ext}`;
    const targetPath = path.join(LOGO_DIR, targetName);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(targetPath, buffer);
    return { success: true, filePath: targetPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Backup SQLite Database
registerIpcHandlers(['backup-db', 'db:backup'], async () => {
  try {
    flushDatabaseSaveSync();
    const timeStamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `medidesk_pos_backup_${timeStamp}.db`;
    const backupPath = path.join(BACKUPS_DIR, backupFileName);
    fs.copyFileSync(DB_PATH, backupPath);
    return { success: true, backupPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Restore SQLite Database
registerIpcHandlers(['restore-db', 'db:restore'], async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select MediDesk POS Backup File (.db)',
      defaultPath: BACKUPS_DIR,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, error: 'Restore operation cancelled' };
    }

    const selectedFile = filePaths[0];
    if (db) {
      try { db.close(); } catch(e){}
      db = null;
    }

    fs.copyFileSync(selectedFile, DB_PATH);
    await initDatabase();
    return { success: true, message: 'Database Restored Successfully! Reloading...' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Factory Reset Handler
registerIpcHandlers(['factory-reset', 'file:factoryReset'], async () => {
  try {
    if (db) {
      try { db.close(); } catch(e) {}
      db = null;
    }
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }
    await initDatabase();
    return { success: true, message: 'Factory Reset Completed Successfully! System re-initialized with fresh database.' };
  } catch (err) {
    console.error('Factory Reset IPC Error:', err);
    return { success: false, error: err.message };
  }
});

// Native Print Handler
registerIpcHandlers(['print-document', 'app:print'], async (event, options = {}) => {
  if (!mainWindow) return { success: false, error: 'Window not available' };
  try {
    mainWindow.webContents.print({
      silent: false,
      printBackground: true,
      deviceName: options.deviceName || ''
    }, (success, failureReason) => {
      if (!success) console.error('Print failed:', failureReason);
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
