'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTestApp, tempDir, loginAs, addUser, addProduct, ok, silentLogger } = require('./helpers');
const { createRoutes } = require('../src/main/ipc/routes');
const { createDispatcher } = require('../src/main/ipc/dispatcher');
const { MAX_FAILED_ATTEMPTS, MAX_PIN_CHANGES_PER_DAY } = require('../src/main/services/auth');
const { COPY_FOLDER_NAME } = require('../src/main/services/backup');
const { localDateString } = require('../src/main/lib/dates');
const pricing = require('../src/shared/pricing');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

const audits = (app, action) => app.ctx.db.all('SELECT * FROM audit_log WHERE action = ? ORDER BY id;', [action]);
const backupsIn = (dir) => fs.readdirSync(path.join(dir, 'Backups'));
const noTaxOrFee = (app) => app.ctx.db.transaction(() => app.ctx.db.run('UPDATE settings SET pos_fee_cents = 0, tax_rate_percent = 0;'));

// ------------------------------------------------------------------ discounts

test('a cashier can discount a bill only up to the limit, a manager can give more, and every discount is logged', async () => {
  const app = await createTestApp();
  noTaxOrFee(app);
  const product = addProduct(app.ctx, { singlePriceCents: 1000, stockUnits: 1000 });
  const lines = [{ productId: product.id, unitType: 'SINGLE', quantity: 10 }]; // subtotal Rs 100.00
  const sell = (discount) => app.call('sales.checkout', { lines, paymentMethod: 'CASH', discount });

  await loginAs(app, 'Cashier');
  assert.equal((await sell({ type: 'PERCENT', value: 100 })).error.code, 'DISCOUNT_LIMIT');
  assert.equal((await sell({ type: 'FLAT', value: 1001 })).error.code, 'DISCOUNT_LIMIT');
  assert.equal(app.ctx.db.value('SELECT COUNT(*) FROM sales;'), 0, 'nothing is sold');
  const atLimit = ok(await sell({ type: 'PERCENT', value: 10 }));
  assert.equal(atLimit.discount_cents, 1000);

  await loginAs(app, 'Manager');
  assert.equal(ok(await sell({ type: 'PERCENT', value: 50 })).total_cents, 5000);
  ok(await sell(null));

  const logged = audits(app, 'sales.discount');
  assert.equal(logged.length, 2, 'only sales with a discount are logged');
  assert.equal(logged[0].user_name, 'Cashier User');
  assert.deepEqual(JSON.parse(logged[0].details), {
    saleId: atLimit.id,
    invoiceNo: atLimit.invoice_no,
    discountCents: 1000,
    subtotalCents: 10000,
    percent: 10
  });
  const { today } = ok(await app.call('reports.dashboard'));
  assert.equal(today.discountCount, 2);
  assert.equal(today.discountCents, 6000);
});

test('the discount limit allows exactly the limit after the bill is rounded', () => {
  const tenPercent = pricing.discountCents(1235, { type: 'PERCENT', value: 10 }); // 123.5 rounds to 124
  assert.equal(pricing.discountWithinLimit(tenPercent, 1235, 10), true);
  assert.equal(pricing.discountWithinLimit(125, 1235, 10), false);
  assert.equal(pricing.discountWithinLimit(0, 1235, 0), true);
  assert.equal(pricing.discountWithinLimit(1, 1235, 0), false);
});

test('the owner sets the cashier discount limit; leaving it out keeps it', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Admin');
  assert.equal(ok(await app.call('settings.get')).cashier_max_discount_percent, 10);
  const base = { storeName: 'Shop', taxRatePercent: 0, posFeeCents: 0 };
  assert.equal((await app.call('settings.update', { ...base, cashierMaxDiscountPercent: 101 })).error.code, 'VALIDATION');
  ok(await app.call('settings.update', { ...base, cashierMaxDiscountPercent: 25 }));
  ok(await app.call('settings.update', base));
  assert.equal(ok(await app.call('settings.get')).cashier_max_discount_percent, 25);
});

test('a medicine with no unit or pack price cannot be sold that way', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  const product = addProduct(app.ctx, { salePriceCents: 1000, singlePriceCents: 0 });
  const res = await app.call('sales.checkout', { lines: [{ productId: product.id, unitType: 'SINGLE', quantity: 9 }], paymentMethod: 'CASH' });
  assert.equal(res.error.code, 'NO_PRICE');
  assert.equal(app.ctx.db.value('SELECT COUNT(*) FROM sales;'), 0);
  ok(await app.call('sales.checkout', { lines: [{ productId: product.id, unitType: 'PACK', quantity: 1 }], paymentMethod: 'CASH' }));
});

// ----------------------------------------------------------------------- PINs

test('changing your own PIN is limited to a few tries a day, so other PINs cannot be found that way', async () => {
  const app = await createTestApp();
  addUser(app.ctx, { name: 'Owner', role: 'Admin', pin: '2580' });
  await loginAs(app, 'Cashier'); // PIN 9573
  let mine = '9573';
  // Free PINs are accepted (a scan would change and change back)...
  for (const next of ['4000', '9573', '4001', '9573']) {
    ok(await app.call('auth.changeOwnPin', { currentPin: mine, newPin: next }));
    mine = next;
  }
  // ...and a PIN someone else has is refused and logged.
  assert.equal((await app.call('auth.changeOwnPin', { currentPin: mine, newPin: '2580' })).error.code, 'CONFLICT');
  assert.equal(audits(app, 'auth.pin_taken').length, 1);
  assert.equal(MAX_PIN_CHANGES_PER_DAY, 5);

  // Then every further try gets the same answer, whether the PIN is free or taken.
  ok(await app.call('auth.login', { pin: mine }));
  for (const next of ['4002', '2580']) {
    const res = await app.call('auth.changeOwnPin', { currentPin: mine, newPin: next });
    assert.equal(res.error.code, 'LOCKED_OUT');
    assert.doesNotMatch(res.error.message, /already used by another/);
  }
});

test('logging in does not reset the wrong-PIN count, and neither does restarting the app', async () => {
  const app = await createTestApp();
  addUser(app.ctx, { name: 'Owner', role: 'Admin', pin: '2580' });
  await loginAs(app, 'Cashier');
  await app.call('auth.changeOwnPin', { currentPin: '9573', newPin: '2580' }); // a guess through "change my PIN"
  for (let i = 0; i < MAX_FAILED_ATTEMPTS - 2; i++) {
    assert.equal((await app.call('auth.login', { pin: '1111' })).error.code, 'UNAUTHENTICATED');
    ok(await app.call('auth.login', { pin: '9573' })); // the guesser logs in as themselves in between
  }
  assert.equal((await app.call('auth.login', { pin: '1112' })).error.code, 'UNAUTHENTICATED');
  assert.equal((await app.call('auth.login', { pin: '2580' })).error.code, 'LOCKED_OUT');

  const reopened = await createTestApp({ dataDir: app.dataDir });
  assert.equal((await reopened.call('auth.login', { pin: '2580' })).error.code, 'LOCKED_OUT');
  assert.ok(ok(await reopened.call('settings.get')).login_failed_attempts >= MAX_FAILED_ATTEMPTS);
});

test('wrong PINs are forgotten after an hour without one', async () => {
  const app = await createTestApp();
  const hourAgo = Date.now() - 61 * 60 * 1000;
  app.ctx.db.transaction(() =>
    app.ctx.db.run('UPDATE settings SET login_failed_attempts = 4, login_locked_until_ms = 0, login_last_failure_ms = ?;', [hourAgo])
  );
  assert.equal((await app.call('auth.login', { pin: '1111' })).error.code, 'UNAUTHENTICATED');
  assert.equal(app.ctx.services.settings.get().login_failed_attempts, 1);
  ok(await app.call('auth.login', { pin: '1234' }));
});

test("many wrong PINs in a day show on Today's report", async () => {
  const app = await createTestApp();
  for (let i = 0; i < 3; i++) await app.call('auth.login', { pin: '1111' });
  await loginAs(app, 'Manager');
  assert.equal(ok(await app.call('reports.dashboard')).wrongPinsToday, 3);
});

test('a clock moved backwards never locks the keypad for more than five minutes', async () => {
  const app = await createTestApp();
  app.ctx.db.transaction(() =>
    app.ctx.db.run('UPDATE settings SET login_failed_attempts = 9, login_locked_until_ms = ?;', [Date.now() + 24 * 60 * 60 * 1000])
  );
  const res = await app.call('auth.login', { pin: '1234' });
  assert.equal(res.error.code, 'LOCKED_OUT');
  assert.ok(Number(/in (\d+) seconds/.exec(res.error.message)[1]) <= 300);
});

// -------------------------------------------------------------- prescriptions

test('prescriptions saved by v1.x with full Documents paths open after the data folder moved', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  const name = 'rx_1700000000000_42.jpg';
  fs.writeFileSync(path.join(app.ctx.paths.prescriptionsDir, name), JPEG);
  const product = addProduct(app.ctx);
  const sale = ok(await app.call('sales.checkout', { lines: [{ productId: product.id, unitType: 'SINGLE', quantity: 1 }], paymentMethod: 'CASH' }));
  const setPath = (p) => app.ctx.db.transaction(() => app.ctx.db.run('UPDATE sales SET prescription_path = ? WHERE id = ?;', [p, sale.id]));

  setPath(path.join(tempDir(), 'Documents', 'MediDeskPOS', 'Prescriptions', name));
  assert.match(ok(await app.call('sales.getPrescription', { id: sale.id })).dataUrl, /^data:image\/jpeg;base64,/);

  // Anything else outside the Prescriptions folder is still refused.
  setPath(path.join(app.dataDir, 'noor_pharmacy_pos.db'));
  assert.equal((await app.call('sales.getPrescription', { id: sale.id })).error.code, 'NOT_FOUND');
  setPath('../noor_pharmacy_pos.db');
  assert.equal((await app.call('sales.getPrescription', { id: sale.id })).error.code, 'NOT_FOUND');
});

test('prescription photos must really be JPG, PNG, GIF or BMP, whatever the file is called', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Cashier');
  const save = (fileName, buffer) => app.call('files.savePrescription', { fileName, base64Data: buffer.toString('base64') });
  assert.equal((await save('photo.webp', WEBP)).error.code, 'VALIDATION');
  assert.equal((await save('photo.jpg', WEBP)).error.code, 'VALIDATION', 'a WebP file renamed to .jpg is refused');
  assert.match(ok(await save('photo.jpg', JPEG)).relativePath, /^Prescriptions\/rx_.*\.jpg$/);

  // A WebP saved by an older version is not decoded on screen.
  fs.writeFileSync(path.join(app.ctx.paths.prescriptionsDir, 'old.webp'), WEBP);
  assert.throws(() => app.ctx.files.readPrescriptionAsDataUrl('Prescriptions/old.webp'), { code: 'VALIDATION' });
});

test('a held sale keeps its prescription photo', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Cashier');
  const product = addProduct(app.ctx);
  const lines = [{ productId: product.id, unitType: 'SINGLE', quantity: 1 }];
  const { relativePath } = ok(await app.call('files.savePrescription', { fileName: 'rx.jpg', base64Data: JPEG.toString('base64') }));
  ok(await app.call('parked.park', { lines, prescriptionPath: relativePath }));
  const [held] = ok(await app.call('parked.list'));
  assert.equal(ok(await app.call('parked.resume', { id: held.id })).prescriptionPath, relativePath);
  assert.equal((await app.call('parked.park', { lines, prescriptionPath: '../noor_pharmacy_pos.db' })).error.code, 'VALIDATION');
});

// --------------------------------------------------------------- backup copies

test('backups and prescription photos are copied to the chosen USB drive or cloud folder', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Admin');
  fs.writeFileSync(path.join(app.ctx.paths.prescriptionsDir, 'rx_1.jpg'), JPEG);
  const usb = tempDir();
  let picked = path.join(app.dataDir, 'Backups');
  const call = createDispatcher(app.ctx, createRoutes(app.ctx, { pickFolder: async () => picked }), { logger: silentLogger });

  assert.equal((await call('system.chooseBackupCopyFolder')).error.code, 'VALIDATION', "not inside the app's own data folder");

  picked = usb;
  const { copy } = ok(await call('system.chooseBackupCopyFolder'));
  assert.equal(copy.ok, true);
  const target = path.join(usb, COPY_FOLDER_NAME);
  assert.deepEqual(
    fs.readdirSync(target).filter((f) => f.endsWith('.db')).sort(),
    backupsIn(app.dataDir).sort()
  );
  assert.ok(fs.existsSync(path.join(target, 'Prescriptions', 'rx_1.jpg')));
  const settings = app.ctx.services.settings.get();
  assert.equal(settings.backup_copy_dir, path.resolve(usb));
  assert.ok(settings.backup_copy_last_at);
  assert.equal(audits(app, 'system.backup_copy_folder').length, 1);

  // "Back up now" copies the new backup straight away.
  const { filePath, copy: again } = ok(await call('system.backup'));
  assert.equal(again.backups, 1);
  assert.ok(fs.existsSync(path.join(target, path.basename(filePath))));
  assert.equal(ok(await call('reports.dashboard')).backupCopy.daysSinceCopy, 0);
});

test('an unreachable copy folder is reported and never stops the backup on this computer', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Admin');
  const blocker = path.join(tempDir(), 'not-a-folder');
  fs.writeFileSync(blocker, 'a file where the drive should be');
  app.ctx.db.transaction(() => app.ctx.db.run('UPDATE settings SET backup_copy_dir = ?;', [path.join(blocker, 'usb')]));

  const before = backupsIn(app.dataDir).length;
  const { copy } = ok(await app.call('system.backup'));
  assert.equal(copy.ok, false);
  assert.equal(backupsIn(app.dataDir).length, before + 1, 'the backup here is still made');
  assert.match(app.ctx.services.settings.get().backup_copy_last_error, /Could not copy backups/);
  assert.match(ok(await app.call('reports.dashboard')).backupCopy.lastError, /Could not copy backups/);

  ok(await app.call('system.stopBackupCopies'));
  const cleared = app.ctx.services.settings.get();
  assert.equal(cleared.backup_copy_dir, '');
  assert.equal(cleared.backup_copy_last_error, '');
});

test('a factory reset that fails half-way leaves the till working with its data', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Admin');
  addProduct(app.ctx, { title: 'Still Here' });
  const unlink = fs.unlinkSync;
  fs.unlinkSync = () => {
    throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
  };
  let res;
  try {
    res = await app.call('system.factoryReset', { confirm: 'RESET' });
  } finally {
    fs.unlinkSync = unlink;
  }
  assert.equal(res.ok, false);
  assert.ok(ok(await app.call('products.list')).some((p) => p.title === 'Still Here'));
});

// ------------------------------------------------------------ report accuracy

test('khata payments by card or bank are not counted as cash in the drawer', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  noTaxOrFee(app);
  const product = addProduct(app.ctx, { singlePriceCents: 100 });
  const customer = ok(await app.call('customers.save', { name: 'Credit Customer', creditLimitCents: 100000 }));
  ok(await app.call('sales.checkout', { lines: [{ productId: product.id, unitType: 'SINGLE', quantity: 10 }], paymentMethod: 'CREDIT', customerId: customer.id }));
  const pay = (amountCents, paymentMethod) => app.call('customers.recordPayment', { customerId: customer.id, amountCents, paymentMethod });

  ok(await pay(300)); // cash unless said otherwise
  ok(await pay(200, 'BANK'));
  assert.equal((await pay(1, 'CHEQUE')).error.code, 'VALIDATION');

  const { today } = ok(await app.call('reports.dashboard'));
  assert.equal(today.khataPaymentsCents, 500);
  assert.equal(today.khataCashPaymentsCents, 300);
  assert.equal(today.expectedCashCents, 300);
  const { entries } = ok(await app.call('customers.ledger', { customerId: customer.id }));
  assert.match(entries[entries.length - 1].notes, /bank transfer, received by Manager User/);
  assert.equal(entries[entries.length - 1].payment_method, 'BANK');
});

test('stock recorded as damaged or lost is a loss in profit and loss; a corrected mistake is not', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  const product = addProduct(app.ctx, { packSize: 10, stockUnits: 100, costPriceCents: 1000 }); // Rs 1.00 per unit at cost
  const input = (p, changes) => ({
    id: p.id,
    barcode: p.barcode,
    title: p.title,
    packSize: p.pack_size,
    expiryDate: p.expiry_date,
    minStockLevel: p.min_stock_level,
    costPriceCents: p.cost_price_cents,
    salePriceCents: p.sale_price_cents,
    singlePriceCents: p.single_price_cents,
    originalStockUnits: p.stock_units,
    stockUnits: p.stock_units,
    ...changes
  });

  let p = ok(await app.call('products.save', input(product, { stockUnits: 95, stockChangeReason: 'DAMAGED' }))); // loss 500
  p = ok(await app.call('products.save', input(p, { stockUnits: 85, stockChangeReason: 'MISTAKE' }))); // not a loss
  p = ok(await app.call('products.save', input(p, { stockUnits: 83, stockChangeReason: 'LOST' }))); // loss 200
  assert.equal((await app.call('products.save', input(p, { stockUnits: 80, stockChangeReason: 'GONE' }))).error.code, 'VALIDATION');

  const today = localDateString();
  const { summary } = ok(await app.call('reports.profit', { from: today, to: today }));
  assert.equal(summary.writeOffCents, 700);
  assert.equal(summary.netProfitCents, -700);
  assert.equal(audits(app, 'products.stock_loss').length, 2);
  assert.equal(audits(app, 'products.stock_correction').length, 1);
});
