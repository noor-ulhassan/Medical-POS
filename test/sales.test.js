'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, loginAs, addProduct, ok } = require('./helpers');

async function setup() {
  const app = await createTestApp();
  const user = await loginAs(app, 'Manager');
  const product = addProduct(app.ctx, { packSize: 10, stockUnits: 100, salePriceCents: 1000, singlePriceCents: 120 });
  return { app, user, product };
}

const stockOf = (app, id) => app.ctx.db.value('SELECT stock_units FROM products WHERE id = ?;', [id]);

test('pack and single lines of the same product are both deducted (v1.1 overwrite bug)', async () => {
  const { app, product } = await setup();
  const sale = ok(
    await app.call('sales.checkout', {
      lines: [
        { productId: product.id, unitType: 'PACK', quantity: 2 },
        { productId: product.id, unitType: 'SINGLE', quantity: 3 }
      ],
      paymentMethod: 'CASH'
    })
  );
  assert.equal(stockOf(app, product.id), 100 - 20 - 3);
  assert.equal(sale.items.length, 2);
  assert.deepEqual(
    sale.items.map((i) => i.base_units),
    [20, 3]
  );
});

test('totals are computed in the main process from database prices', async () => {
  const { app, product } = await setup();
  app.ctx.db.transaction(() => app.ctx.db.run('UPDATE settings SET pos_fee_cents = 100, tax_rate_percent = 0;'));
  const sale = ok(
    await app.call('sales.checkout', {
      // A tampered renderer cannot set prices: there is no price field to send.
      lines: [{ productId: product.id, unitType: 'SINGLE', quantity: 2, priceCents: 1 }],
      paymentMethod: 'CASH',
      paidCents: 1000,
      discount: { type: 'FLAT', value: 40 }
    })
  );
  assert.equal(sale.subtotal_cents, 240);
  assert.equal(sale.discount_cents, 40);
  assert.equal(sale.total_cents, 300);
  assert.equal(sale.change_cents, 700);
});

test('insufficient stock is refused and nothing is written', async () => {
  const { app, product } = await setup();
  const res = await app.call('sales.checkout', {
    lines: [{ productId: product.id, unitType: 'PACK', quantity: 11 }],
    paymentMethod: 'CASH'
  });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'INSUFFICIENT_STOCK');
  assert.equal(stockOf(app, product.id), 100);
  assert.equal(app.ctx.db.value('SELECT COUNT(*) FROM sales;'), 0);
});

test('cash short of the total is refused', async () => {
  const { app, product } = await setup();
  const res = await app.call('sales.checkout', {
    lines: [{ productId: product.id, unitType: 'PACK', quantity: 1 }],
    paymentMethod: 'CASH',
    paidCents: 500
  });
  assert.equal(res.error.code, 'VALIDATION');
});

test('invoice numbers are sequential and unique', async () => {
  const { app, product } = await setup();
  const line = [{ productId: product.id, unitType: 'SINGLE', quantity: 1 }];
  const a = ok(await app.call('sales.checkout', { lines: line, paymentMethod: 'CASH' }));
  const b = ok(await app.call('sales.checkout', { lines: line, paymentMethod: 'CARD' }));
  assert.equal(a.invoice_no, 'INV-000001');
  assert.equal(b.invoice_no, 'INV-000002');
});

test('credit sales: walk-in refused, limit enforced, debt and ledger updated', async () => {
  const { app, product } = await setup();
  const line = [{ productId: product.id, unitType: 'PACK', quantity: 1 }];

  const walkIn = await app.call('sales.checkout', { lines: line, paymentMethod: 'CREDIT', customerId: 1 });
  assert.equal(walkIn.error.code, 'VALIDATION');

  const customer = ok(await app.call('customers.save', { name: 'Ali', creditLimitCents: 1500 }));
  ok(await app.call('sales.checkout', { lines: line, paymentMethod: 'CREDIT', customerId: customer.id }));
  const second = await app.call('sales.checkout', { lines: line, paymentMethod: 'CREDIT', customerId: customer.id });
  assert.equal(second.error.code, 'CREDIT_LIMIT');

  const { customer: after, entries } = ok(await app.call('customers.ledger', { customerId: customer.id }));
  assert.equal(after.current_debt_cents, 1000);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].balance_after_cents, 1000);
});

test('void restores stock and debt exactly once', async () => {
  const { app, product } = await setup();
  const customer = ok(await app.call('customers.save', { name: 'Sara', creditLimitCents: 100000 }));
  const sale = ok(
    await app.call('sales.checkout', {
      lines: [{ productId: product.id, unitType: 'PACK', quantity: 3 }],
      paymentMethod: 'CREDIT',
      customerId: customer.id
    })
  );
  assert.equal(stockOf(app, product.id), 70);

  // Pack size changes after the sale must not change how much is restored.
  app.ctx.db.transaction(() => app.ctx.db.run('UPDATE products SET pack_size = 20 WHERE id = ?;', [product.id]));

  const voided = ok(await app.call('sales.void', { id: sale.id, reason: 'Returned' }));
  assert.equal(voided.status, 'VOIDED');
  assert.equal(stockOf(app, product.id), 100);
  assert.equal(app.ctx.db.value('SELECT current_debt_cents FROM customers WHERE id = ?;', [customer.id]), 0);

  const again = await app.call('sales.void', { id: sale.id, reason: 'Twice' });
  assert.equal(again.error.code, 'CONFLICT');
  assert.equal(stockOf(app, product.id), 100);
});

test('editing a product applies only the stock difference typed by the user', async () => {
  const { app, product } = await setup();
  // Form opened with 100 units; meanwhile 5 units are sold.
  ok(await app.call('sales.checkout', { lines: [{ productId: product.id, unitType: 'SINGLE', quantity: 5 }], paymentMethod: 'CASH' }));
  // User adds 10 units in the stale form (100 -> 110).
  ok(
    await app.call('products.save', {
      id: product.id,
      barcode: product.barcode,
      title: product.title,
      packSize: 10,
      salePriceCents: 1000,
      singlePriceCents: 120,
      costPriceCents: 800,
      minStockLevel: 2,
      expiryDate: '2030-01-01',
      stockUnits: 110,
      originalStockUnits: 100
    })
  );
  assert.equal(stockOf(app, product.id), 105);
  const history = ok(await app.call('products.stockHistory', { id: product.id }));
  assert.equal(history[0].change_units, 10);
});

test('products with sales are archived instead of deleted', async () => {
  const { app, product } = await setup();
  const unsold = addProduct(app.ctx, { title: 'Unsold' });
  ok(await app.call('sales.checkout', { lines: [{ productId: product.id, unitType: 'SINGLE', quantity: 1 }], paymentMethod: 'CASH' }));
  assert.equal(ok(await app.call('products.remove', { id: product.id })).mode, 'archived');
  assert.equal(ok(await app.call('products.remove', { id: unsold.id })).mode, 'deleted');
  const listed = ok(await app.call('products.list')).map((p) => p.id);
  assert.ok(!listed.includes(product.id));
  // Archived products cannot be sold.
  const res = await app.call('sales.checkout', { lines: [{ productId: product.id, unitType: 'SINGLE', quantity: 1 }], paymentMethod: 'CASH' });
  assert.equal(res.error.code, 'NOT_FOUND');
});

test('khata payment cannot exceed the outstanding balance', async () => {
  const { app, product } = await setup();
  const customer = ok(await app.call('customers.save', { name: 'Hamza', creditLimitCents: 100000 }));
  ok(await app.call('sales.checkout', { lines: [{ productId: product.id, unitType: 'PACK', quantity: 1 }], paymentMethod: 'CREDIT', customerId: customer.id }));
  assert.equal((await app.call('customers.recordPayment', { customerId: customer.id, amountCents: 1001 })).error.code, 'VALIDATION');
  const res = ok(await app.call('customers.recordPayment', { customerId: customer.id, amountCents: 400 }));
  assert.equal(res.balanceCents, 600);
});

test('parked carts round-trip', async () => {
  const { app, product } = await setup();
  const { tabKey } = ok(await app.call('parked.park', { lines: [{ productId: product.id, unitType: 'PACK', quantity: 2 }], customerId: 1 }));
  assert.match(tabKey, /^TAB-/);
  const [parked] = ok(await app.call('parked.list'));
  const resumed = ok(await app.call('parked.resume', { id: parked.id }));
  assert.deepEqual(resumed.lines, [{ productId: product.id, unitType: 'PACK', quantity: 2 }]);
  assert.equal((await app.call('parked.resume', { id: parked.id })).error.code, 'NOT_FOUND');
});

test('dashboard counts only completed sales', async () => {
  const { app, product } = await setup();
  const line = [{ productId: product.id, unitType: 'SINGLE', quantity: 1 }];
  ok(await app.call('sales.checkout', { lines: line, paymentMethod: 'CASH' }));
  const voidMe = ok(await app.call('sales.checkout', { lines: line, paymentMethod: 'CASH' }));
  ok(await app.call('sales.void', { id: voidMe.id, reason: 'test' }));
  const dash = ok(await app.call('reports.dashboard'));
  assert.equal(dash.totalInvoices, 1);
  assert.equal(dash.todayInvoices, 1);
  assert.equal(dash.trend.length, 7);
  assert.equal(dash.trend[6].totalCents, dash.todayRevenueCents);
  assert.equal(dash.topProducts[0].total_qty, 1);
});
