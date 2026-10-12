'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, loginAs, addUser, ok } = require('./helpers');

test('everything except public routes requires a session', async () => {
  const app = await createTestApp();
  const res = await app.call('products.list');
  assert.equal(res.error.code, 'UNAUTHENTICATED');
  assert.ok((await app.call('settings.get')).ok, 'settings are public for the lock screen');
  assert.equal((await app.call('db.query', { sql: 'DROP TABLE sales' })).error.code, 'NOT_FOUND');
});

test('fresh install: default admin must change PIN before doing anything', async () => {
  const app = await createTestApp();
  const user = ok(await app.call('auth.login', { pin: '1234' }));
  assert.equal(user.role, 'Admin');
  assert.equal(user.mustChangePin, true);
  assert.equal((await app.call('products.list')).error.code, 'PIN_CHANGE_REQUIRED');

  assert.equal((await app.call('auth.changeOwnPin', { currentPin: '1234', newPin: '0000' })).error.code, 'VALIDATION');
  const changed = ok(await app.call('auth.changeOwnPin', { currentPin: '1234', newPin: '7391' }));
  assert.equal(changed.mustChangePin, false);
  assert.ok((await app.call('products.list')).ok);

  ok(await app.call('auth.logout'));
  assert.equal((await app.call('auth.login', { pin: '1234' })).error.code, 'UNAUTHENTICATED');
  assert.ok((await app.call('auth.login', { pin: '7391' })).ok);
});

test('roles are enforced in the main process', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Cashier');
  assert.equal((await app.call('sales.void', { id: 1, reason: 'x' })).error.code, 'FORBIDDEN');
  assert.equal((await app.call('settings.update', { storeName: 'X' })).error.code, 'FORBIDDEN');
  assert.equal((await app.call('system.factoryReset', { confirm: 'RESET' })).error.code, 'FORBIDDEN');
  assert.equal((await app.call('users.list')).error.code, 'FORBIDDEN');
  assert.ok((await app.call('products.list')).ok);
});

test('repeated wrong PINs lock the keypad', async () => {
  const app = await createTestApp();
  for (let i = 0; i < 5; i++) assert.equal((await app.call('auth.login', { pin: '9999' })).error.code, 'UNAUTHENTICATED');
  const locked = await app.call('auth.login', { pin: '1234' });
  assert.equal(locked.error.code, 'LOCKED_OUT');
});

test('deactivated users lose their session immediately', async () => {
  const app = await createTestApp();
  const cashierId = addUser(app.ctx, { name: 'Temp', role: 'Cashier', pin: '5821' });
  ok(await app.call('auth.login', { pin: '5821' }));
  app.ctx.db.transaction(() => app.ctx.db.run('UPDATE users SET is_active = 0 WHERE id = ?;', [cashierId]));
  assert.equal((await app.call('products.list')).error.code, 'UNAUTHENTICATED');
});

test('user management keeps PINs unique and protects the last admin', async () => {
  const app = await createTestApp();
  const admin = await loginAs(app, 'Admin');
  assert.equal((await app.call('users.create', { name: 'Dup', role: 'Cashier', pin: '7391' })).error.code, 'CONFLICT');
  const cashier = ok(await app.call('users.create', { name: 'New Cashier', role: 'Cashier', pin: '4826' }));
  assert.equal(cashier.mustChangePin, true);

  // Default admin from the seed still exists, so demote it first, then try to remove the last admin (self).
  const seededAdmin = ok(await app.call('users.list')).find((u) => u.name === 'Administrator');
  ok(await app.call('users.update', { id: seededAdmin.id, name: 'Administrator', role: 'Admin', isActive: false }));
  assert.equal((await app.call('users.update', { id: admin.id, name: admin.name, role: 'Manager', isActive: true })).error.code, 'VALIDATION');

  // Reactivation requires a fresh PIN.
  assert.equal((await app.call('users.update', { id: seededAdmin.id, name: 'Administrator', role: 'Admin', isActive: true })).error.code, 'VALIDATION');
  ok(await app.call('users.update', { id: seededAdmin.id, name: 'Administrator', role: 'Admin', isActive: true, pin: '6153' }));

  const audit = ok(await app.call('audit.list'));
  assert.ok(audit.some((a) => a.action === 'users.create'));
  assert.ok(!JSON.stringify(audit).includes('4826'), 'PINs never reach the audit log');
});

test('admin PIN recovery issues a temporary PIN that must be changed', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Admin');
  ok(await app.call('auth.logout'));
  for (let i = 0; i < 5; i++) await app.call('auth.login', { pin: '9999' });
  const { user, pin } = app.ctx.services.auth.recoverAdminPin();
  assert.equal(user.role, 'Admin');
  assert.match(pin, /^\d{6}$/);
  const session = ok(await app.call('auth.login', { pin }));
  assert.equal(session.mustChangePin, true, 'lockout cleared and change forced');
  const audit = app.ctx.services.audit.list();
  assert.ok(audit.some((a) => a.action === 'users.reset_pin' && a.user_name === 'PIN recovery'));
});
