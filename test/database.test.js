'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTestApp, tempDir, loginAs, addProduct, ok, silentLogger } = require('./helpers');
const { createRoutes } = require('../src/main/ipc/routes');
const { createDispatcher } = require('../src/main/ipc/dispatcher');
const { writeV11Database } = require('./fixtures/v1_1_database');
const { AppContext, QuitRequested } = require('../src/main/app-context');
const { verifyPin } = require('../src/main/lib/pin');
const { LATEST_VERSION } = require('../src/main/db/migrations');

const dbFile = (dir) => path.join(dir, 'noor_pharmacy_pos.db');
const backupsIn = (dir) => fs.readdirSync(path.join(dir, 'Backups'));

test('every committed write is on disk immediately', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  addProduct(app.ctx, { title: 'Persisted Product' });
  // Re-open the file without shutting down: simulates a power cut right after the write.
  const reopened = new AppContext({ dataDir: app.dataDir });
  await reopened.start();
  assert.ok(reopened.services.products.list().some((p) => p.title === 'Persisted Product'));
});

test('Database.run never uses sql.js exec(), which leaks memory on every call', async () => {
  // exec() leaks WASM memory each time it returns rows; ~330k calls in one
  // session (about 40k sales) made the engine fail until the app restarted.
  const { Database } = require('../src/main/db/Database');
  const db = await Database.inMemory();
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);');
  db.sqlDb.exec = () => {
    throw new Error('Database.run must not call exec()');
  };
  assert.deepEqual(db.run('INSERT INTO t (v) VALUES (?);', ['a']), { changes: 1, lastInsertRowid: 1 });
  assert.equal(db.run('INSERT INTO t (v) VALUES (?);', ['b']).lastInsertRowid, 2);
});

test('a damaged database file is never overwritten', async () => {
  const dir = tempDir();
  fs.writeFileSync(dbFile(dir), 'this is not a database');
  const ctx = new AppContext({ dataDir: dir, decide: async () => 'quit' });
  await assert.rejects(ctx.start(), QuitRequested);
  assert.equal(fs.readFileSync(dbFile(dir), 'utf8'), 'this is not a database');
});

test('"start fresh" keeps the damaged file aside', async () => {
  const dir = tempDir();
  fs.writeFileSync(dbFile(dir), 'garbage');
  const ctx = new AppContext({ dataDir: dir, decide: async (kind) => (kind === 'corrupt' ? 'startFresh' : 'quit') });
  await ctx.start();
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('noor_pharmacy_pos.corrupt-')));
});

test('"restore backup" recovers the latest valid backup', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  addProduct(app.ctx, { title: 'In Backup' });
  app.ctx.backup.create('manual');
  app.ctx.shutdown();
  fs.writeFileSync(dbFile(app.dataDir), 'corrupted later');

  const ctx = new AppContext({ dataDir: app.dataDir, decide: async () => 'restoreBackup' });
  await ctx.start();
  assert.ok(ctx.services.products.list().some((p) => p.title === 'In Backup'));
});

test('v1.1 databases are upgraded in place without losing data', async () => {
  const dir = tempDir();
  await writeV11Database(dbFile(dir));
  const ctx = new AppContext({ dataDir: dir });
  await ctx.start();
  const db = ctx.db;

  assert.equal(db.value('PRAGMA user_version;'), LATEST_VERSION);
  assert.ok(backupsIn(dir).some((f) => f.startsWith(`noorpos_pre-migration-v${LATEST_VERSION}_`)), 'original file backed up first');

  // Stock converted from packs + loose singles to base units.
  assert.equal(db.value('SELECT stock_units FROM products WHERE id = 1;'), 25 * 10 + 5);
  assert.equal(db.value('SELECT stock_units FROM products WHERE id = 2;'), 50 * 20 + 10);
  assert.equal(db.value('SELECT category_id FROM products WHERE id = 2;'), null, 'orphan category reference cleared');

  // PINs hashed; published defaults must be changed, custom PINs keep working.
  const users = db.all('SELECT * FROM users ORDER BY id;');
  assert.ok(users.every((u) => !('pin' in u)));
  assert.equal(users[0].must_change_pin, 1);
  assert.equal(users[2].must_change_pin, 0);
  assert.ok(verifyPin('2468', users[2].pin_hash));

  // Store details are the user's own and are kept as-is.
  assert.equal(ctx.services.settings.get().store_name, 'Al-Shifa Pharmacy');
  assert.equal(ctx.services.settings.get().next_invoice_no, 2);
  assert.equal(db.value('SELECT base_units FROM sale_items WHERE sale_id = 1;'), 2);
  assert.equal(db.value('SELECT current_debt_cents FROM customers WHERE id = 2;'), 125000);
  assert.equal(db.all('PRAGMA foreign_key_check;').length, 0);

  // Old-format parked carts still resume.
  const parked = ctx.services.parked.list()[0];
  assert.deepEqual(ctx.services.parked.resume({ id: parked.id }).lines, [{ productId: 1, unitType: 'PACK', quantity: 1 }]);

  // Running again is a no-op.
  ctx.shutdown();
  const again = new AppContext({ dataDir: dir });
  await again.start();
  assert.equal(again.db.value('SELECT stock_units FROM products WHERE id = 1;'), 255);
});

test('restore validates the file, backs up first and ends the session', async () => {
  const app = await createTestApp();
  const garbage = path.join(app.dataDir, 'not-a-backup.db');
  fs.writeFileSync(garbage, 'nope');
  await loginAs(app, 'Admin');
  addProduct(app.ctx, { title: 'Before Restore' });
  const { filePath: good } = ok(await app.call('system.backup'));
  addProduct(app.ctx, { title: 'After Backup' });

  let picked = garbage;
  const call = createDispatcher(app.ctx, createRoutes(app.ctx, { pickBackupFile: async () => picked }), { logger: silentLogger });

  assert.equal((await call('system.restore')).error.code, 'VALIDATION');
  assert.ok(app.ctx.services.products.list().some((p) => p.title === 'After Backup'), 'live data untouched');

  picked = good;
  const res = ok(await call('system.restore'));
  assert.ok(fs.existsSync(res.safetyBackup));
  assert.equal(app.ctx.session.user, null);
  const titles = app.ctx.services.products.list().map((p) => p.title);
  assert.ok(titles.includes('Before Restore') && !titles.includes('After Backup'));
});

test('factory reset requires confirmation and keeps a backup', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Admin');
  addProduct(app.ctx, { title: 'Will Be Reset' });
  assert.equal((await app.call('system.factoryReset', {})).error.code, 'VALIDATION');
  const res = ok(await app.call('system.factoryReset', { confirm: 'RESET' }));
  assert.ok(fs.existsSync(res.safetyBackup));
  assert.equal(app.ctx.services.products.list().length, 0);
  assert.equal(app.ctx.db.value('SELECT COUNT(*) FROM users;'), 1);
});

test('one automatic backup per day, older ones pruned', async () => {
  const app = await createTestApp();
  const autos = () => backupsIn(app.dataDir).filter((f) => f.startsWith('noorpos_auto_'));
  assert.equal(autos().length, 1);
  app.ctx.backup.autoDaily();
  assert.equal(autos().length, 1);
});

test('data from previous releases is adopted once, never overwriting current data', async () => {
  const { adoptPreviousInstall } = require('../src/main/legacy-data');
  const { DB_FILE_NAME } = require('../src/main/app-context');
  const documentsDir = tempDir();
  const dataDir = path.join(tempDir(), 'LocalAppData', 'NoorPharmacyPOS');

  // Oldest layout: different folder and database file name, in Documents.
  const previous = path.join(documentsDir, 'MediDeskPOS');
  fs.mkdirSync(path.join(previous, 'Backups'), { recursive: true });
  await writeV11Database(path.join(previous, 'medidesk_pos.db'));

  const result = adoptPreviousInstall({ documentsDir, dataDir, dbFileName: DB_FILE_NAME });
  assert.equal(result.action, 'moved');
  assert.ok(fs.existsSync(path.join(dataDir, DB_FILE_NAME)));
  assert.ok(fs.existsSync(path.join(dataDir, 'Backups')));

  // The adopted database opens and upgrades like any other.
  const ctx = new AppContext({ dataDir });
  await ctx.start();
  assert.equal(ctx.services.settings.get().store_name, 'Al-Shifa Pharmacy');
  ctx.shutdown();

  // Once the current folder exists, older folders are never touched again.
  fs.mkdirSync(path.join(documentsDir, 'NoorPharmacyPOS'));
  assert.equal(adoptPreviousInstall({ documentsDir, dataDir, dbFileName: DB_FILE_NAME }), null);
  assert.ok(fs.existsSync(path.join(documentsDir, 'NoorPharmacyPOS')));
});

test('the newer Documents folder is preferred over the oldest one', () => {
  const { adoptPreviousInstall } = require('../src/main/legacy-data');
  const { DB_FILE_NAME } = require('../src/main/app-context');
  const documentsDir = tempDir();
  const dataDir = path.join(tempDir(), 'NoorPharmacyPOS');
  fs.mkdirSync(path.join(documentsDir, 'MediDeskPOS'));
  fs.mkdirSync(path.join(documentsDir, 'NoorPharmacyPOS'));
  fs.writeFileSync(path.join(documentsDir, 'NoorPharmacyPOS', DB_FILE_NAME), 'newer');
  const result = adoptPreviousInstall({ documentsDir, dataDir, dbFileName: DB_FILE_NAME });
  assert.ok(result.from.endsWith('NoorPharmacyPOS'));
  assert.equal(fs.readFileSync(path.join(dataDir, DB_FILE_NAME), 'utf8'), 'newer');
});
