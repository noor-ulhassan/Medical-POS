'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { AppContext } = require('../src/main/app-context');
const { createRoutes } = require('../src/main/ipc/routes');
const { createDispatcher } = require('../src/main/ipc/dispatcher');
const { hashPin } = require('../src/main/lib/pin');
const { nowIso } = require('../src/main/lib/dates');

// Every test makes a throwaway data folder (database + backups); remove them
// when the test file finishes, so test runs do not fill the disk.
const createdDirs = [];
process.on('exit', () => {
  for (const dir of createdDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      /* still in use: the OS cleans its temp folder eventually */
    }
  }
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noorpos-test-'));
  createdDirs.push(dir);
  return dir;
}

const silentLogger = { error() {}, log() {}, warn() {} };

/** A started AppContext in a fresh temp data folder, plus an IPC dispatcher. */
async function createTestApp({ dataDir = tempDir(), decide, platform = {} } = {}) {
  const ctx = new AppContext({ dataDir, decide, onPersistError: (err) => { throw err; } });
  await ctx.start();
  const call = createDispatcher(ctx, createRoutes(ctx, { appInfo: () => ({}), print: async () => ({}), ...platform }), {
    logger: silentLogger
  });
  return { ctx, call, dataDir, db: () => ctx.db, services: () => ctx.services };
}

/** Insert a user directly (bypassing validation) for tests. */
function addUser(ctx, { name, role, pin, mustChangePin = false }) {
  return ctx.db.transaction(
    () =>
      ctx.db.run('INSERT INTO users (name, role, pin_hash, must_change_pin, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?);', [
        name,
        role,
        hashPin(pin),
        mustChangePin ? 1 : 0,
        nowIso()
      ]).lastInsertRowid
  );
}

/** Log in as a fresh user with the given role and return the session user. */
async function loginAs(app, role, pin = { Admin: '7391', Manager: '8462', Cashier: '9573' }[role]) {
  addUser(app.ctx, { name: `${role} User`, role, pin });
  const res = await app.call('auth.login', { pin });
  if (!res.ok) throw new Error(`login failed: ${res.error.message}`);
  return res.data;
}

function addProduct(ctx, overrides = {}) {
  const p = {
    barcode: `B${Math.random().toString().slice(2, 12)}`,
    title: 'Test Tablet',
    packSize: 10,
    stockUnits: 100,
    salePriceCents: 1000,
    singlePriceCents: 120,
    costPriceCents: 800,
    minStockLevel: 2,
    expiryDate: '2030-01-01',
    allowNegativeStock: false,
    ...overrides
  };
  return ctx.services.products.save({ id: 1, name: 'test' }, p);
}

/** Unwrap an ok envelope or fail with its error. */
function ok(res) {
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}: ${res.error.message}`);
  return res.data;
}

module.exports = { tempDir, createTestApp, addUser, loginAs, addProduct, ok, silentLogger };
