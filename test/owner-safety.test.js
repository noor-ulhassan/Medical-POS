'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, loginAs, addProduct, ok } = require('./helpers');
const { localDateString, addDays } = require('../src/main/lib/dates');

const stockOf = (app, id) => app.ctx.db.value('SELECT stock_units FROM products WHERE id = ?;', [id]);

test('expired medicine cannot be sold and nothing is written', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  const expired = addProduct(app.ctx, { title: 'Old Syrup', expiryDate: localDateString(addDays(new Date(), -1)) });
  const res = await app.call('sales.checkout', { lines: [{ productId: expired.id, unitType: 'SINGLE', quantity: 1 }], paymentMethod: 'CASH' });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'EXPIRED');
  assert.match(res.error.message, /Old Syrup/);
  assert.equal(stockOf(app, expired.id), 100);
  assert.equal(app.ctx.db.value('SELECT COUNT(*) FROM sales;'), 0);
});

test('medicine expiring today, or with no expiry date, can still be sold', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  const today = addProduct(app.ctx, { expiryDate: localDateString() });
  const none = addProduct(app.ctx, { expiryDate: null });
  ok(
    await app.call('sales.checkout', {
      lines: [
        { productId: today.id, unitType: 'SINGLE', quantity: 1 },
        { productId: none.id, unitType: 'SINGLE', quantity: 1 }
      ],
      paymentMethod: 'CASH'
    })
  );
});

test('receiving stock adds to the current stock and records it', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  const product = addProduct(app.ctx, { packSize: 10, stockUnits: 23, costPriceCents: 800 });
  const updated = ok(
    await app.call('products.receiveStock', { id: product.id, packs: 5, singles: 2, expiryDate: '2031-06-30', costPriceCents: 850 })
  );
  assert.equal(updated.stock_units, 23 + 52);
  assert.equal(updated.expiry_date, '2031-06-30');
  assert.equal(updated.cost_price_cents, 850);
  const history = ok(await app.call('products.stockHistory', { id: product.id }));
  assert.equal(history[0].change_units, 52);
  assert.match(history[0].reason, /Stock received/);

  // Leaving expiry and cost empty keeps them.
  const again = ok(await app.call('products.receiveStock', { id: product.id, packs: 1 }));
  assert.equal(again.stock_units, 85);
  assert.equal(again.expiry_date, '2031-06-30');
  assert.equal(again.cost_price_cents, 850);
});

test('receiving stock rejects nothing-received and is manager-only', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  const product = addProduct(app.ctx);
  const empty = await app.call('products.receiveStock', { id: product.id, packs: 0 });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, 'VALIDATION');
  const negative = await app.call('products.receiveStock', { id: product.id, packs: -3 });
  assert.equal(negative.ok, false);

  await loginAs(app, 'Cashier');
  const denied = await app.call('products.receiveStock', { id: product.id, packs: 2 });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'FORBIDDEN');
  assert.equal(stockOf(app, product.id), 100);
});

test("today's report: money by payment method and cash expected in the drawer", async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  app.ctx.db.transaction(() => app.ctx.db.run('UPDATE settings SET pos_fee_cents = 0, tax_rate_percent = 0;'));
  const product = addProduct(app.ctx, { singlePriceCents: 100 });
  const customer = ok(await app.call('customers.save', { name: 'Credit Customer', creditLimitCents: 100000 }));
  const sell = (paymentMethod, quantity, extra = {}) =>
    app.call('sales.checkout', { lines: [{ productId: product.id, unitType: 'SINGLE', quantity }], paymentMethod, ...extra });

  ok(await sell('CASH', 3, { paidCents: 500 })); // 300 cash, 200 change does not stay in the drawer
  ok(await sell('CARD', 2)); // 200 card
  ok(await sell('CREDIT', 4, { customerId: customer.id })); // 400 on khata
  const cancelled = ok(await sell('CASH', 1)); // 100 cash, cancelled today: not in the drawer
  ok(await app.call('sales.void', { id: cancelled.id, reason: 'test' }));
  ok(await app.call('customers.recordPayment', { customerId: customer.id, amountCents: 150 }));

  // A cash sale from yesterday, cancelled today: refunded from today's drawer.
  const old = ok(await sell('CASH', 5));
  const yesterday = addDays(new Date(), -1).toISOString();
  app.ctx.db.transaction(() => app.ctx.db.run('UPDATE sales SET created_at = ? WHERE id = ?;', [yesterday, old.id]));
  ok(await app.call('sales.void', { id: old.id, reason: 'returned' }));

  const { today } = ok(await app.call('reports.dashboard'));
  const method = (m) => today.byMethod.find((x) => x.payment_method === m);
  assert.equal(method('CASH').total_cents, 300);
  assert.equal(method('CASH').count, 1);
  assert.equal(method('CARD').total_cents, 200);
  assert.equal(method('CREDIT').total_cents, 400);
  assert.equal(today.khataPaymentsCents, 150);
  assert.equal(today.cashRefundsCents, 500);
  assert.equal(today.expectedCashCents, 300 + 150 - 500);
  assert.equal(today.voidCount, 2);
});

test('held sales list says whose sale it is and how many lines it has', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Cashier');
  const a = addProduct(app.ctx);
  const b = addProduct(app.ctx);
  ok(
    await app.call('parked.park', {
      lines: [
        { productId: a.id, unitType: 'SINGLE', quantity: 2 },
        { productId: b.id, unitType: 'PACK', quantity: 1 }
      ],
      totalCents: 1240
    })
  );
  const [held] = ok(await app.call('parked.list'));
  assert.equal(held.customer_name, 'Walk-in Customer');
  assert.equal(held.cashier_name, 'Cashier User');
  assert.equal(held.item_count, 2);
  assert.equal(held.cart_json, undefined);
});

test('khata receipts carry the balance right after the sale; cash sales do not', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  app.ctx.db.transaction(() => app.ctx.db.run('UPDATE settings SET pos_fee_cents = 0, tax_rate_percent = 0;'));
  const product = addProduct(app.ctx, { singlePriceCents: 250 });
  const customer = ok(await app.call('customers.save', { name: 'Khata', creditLimitCents: 100000 }));
  const line = [{ productId: product.id, unitType: 'SINGLE', quantity: 2 }];
  const first = ok(await app.call('sales.checkout', { lines: line, paymentMethod: 'CREDIT', customerId: customer.id }));
  const second = ok(await app.call('sales.checkout', { lines: line, paymentMethod: 'CREDIT', customerId: customer.id }));
  assert.equal(first.khata_balance_after_cents, 500);
  assert.equal(second.khata_balance_after_cents, 1000);
  ok(await app.call('customers.recordPayment', { customerId: customer.id, amountCents: 300 }));
  assert.equal(ok(await app.call('sales.get', { id: first.id })).khata_balance_after_cents, 500, 'a reprint shows the balance at the time');
  const cash = ok(await app.call('sales.checkout', { lines: line, paymentMethod: 'CASH' }));
  assert.equal(cash.khata_balance_after_cents, null);
});

test('text size accepts only the offered sizes and works on the lock screen', async () => {
  const app = await createTestApp();
  assert.equal(ok(await app.call('app.setZoom', { factor: 1.15 })).factor, 1.15);
  assert.equal((await app.call('app.setZoom', { factor: 5 })).error.code, 'VALIDATION');
});
