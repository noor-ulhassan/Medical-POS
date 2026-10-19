'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, loginAs, addProduct, ok } = require('./helpers');
const { localDateString } = require('../src/main/lib/dates');
const pricing = require('../src/shared/pricing');

const stockOf = (app, id) => app.ctx.db.value('SELECT stock_units FROM products WHERE id = ?;', [id]);
const audits = (app, action) => app.ctx.db.all('SELECT * FROM audit_log WHERE action = ? ORDER BY id;', [action]);

/**
 * 10 units at Rs 10.00 (cost Rs 0.80 a unit), Rs 10.00 discount, 10% tax and a Rs 1.00 fee:
 * subtotal 10000, net 9000, tax 900 + fee 100, total 10000, cost 800.
 */
async function setup() {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  app.ctx.db.transaction(() => app.ctx.db.run('UPDATE settings SET tax_rate_percent = 10, pos_fee_cents = 100;'));
  const product = addProduct(app.ctx, { packSize: 10, stockUnits: 100, singlePriceCents: 1000, salePriceCents: 9000, costPriceCents: 800 });
  const sale = ok(
    await app.call('sales.checkout', {
      lines: [{ productId: product.id, unitType: 'SINGLE', quantity: 10 }],
      paymentMethod: 'CASH',
      discount: { type: 'FLAT', value: 1000 }
    })
  );
  assert.equal(sale.total_cents, 10000);
  return { app, product, sale, item: sale.items[0] };
}

const giveBack = (app, sale, item, quantity, extra = {}) =>
  app.call('sales.returnItems', { id: sale.id, lines: [{ saleItemId: item.id, quantity }], reason: 'Doctor changed the medicine', ...extra });

test('returning part of a sale gives back its share of what was paid and puts the items back in stock', async () => {
  const { app, product, sale, item } = await setup();
  assert.equal(stockOf(app, product.id), 90);

  const quote = ok(await app.call('sales.returnQuote', { id: sale.id, lines: [{ saleItemId: item.id, quantity: 3 }] }));
  assert.deepEqual(quote, { refundCents: 3000, netCents: 2700, units: 3 });

  const first = ok(await giveBack(app, sale, item, 3));
  assert.equal(first.returned.return_no, `${sale.invoice_no}-R1`);
  assert.equal(first.returned.refund_cents, 3000);
  assert.equal(first.returned.net_cents, 2700);
  assert.equal(first.sale.items[0].returned_quantity, 3);
  assert.equal(first.sale.returned_cents, 3000);
  assert.equal(stockOf(app, product.id), 93);
  const history = ok(await app.call('products.stockHistory', { id: product.id }));
  assert.equal(history[0].kind, 'RETURNED');
  assert.equal(history[0].value_cents, 240);

  // More than is left is refused; the rest adds up exactly to the bill.
  assert.equal((await giveBack(app, sale, item, 8)).error.code, 'VALIDATION');
  const rest = ok(await giveBack(app, sale, item, 7));
  assert.equal(rest.returned.refund_cents, 7000);
  assert.equal(rest.returned.net_cents, 6300);
  assert.equal(rest.sale.returned_cents, sale.total_cents);
  assert.equal(app.ctx.db.value('SELECT SUM(cost_cents) FROM sale_return_items;'), 800);
  assert.equal(stockOf(app, product.id), 100);
  assert.equal((await giveBack(app, sale, item, 1)).error.code, 'VALIDATION', 'nothing left to return');
  assert.equal(audits(app, 'sales.return').length, 2);
});

test('returns in several goes always add up to the bill, whatever the rounding', () => {
  const sale = { subtotalCents: 999, discountCents: 0, totalCents: 1099 };
  let before = { grossCents: 0, refundCents: 0, netCents: 0 };
  const refunds = [];
  for (let i = 0; i < 3; i++) {
    const share = pricing.returnShares(sale, before, 333);
    refunds.push(share.refundCents);
    before = { grossCents: before.grossCents + 333, refundCents: before.refundCents + share.refundCents, netCents: before.netCents + share.netCents };
  }
  assert.deepEqual(refunds, [366, 367, 366]);
  assert.equal(before.refundCents, 1099);
  assert.equal(before.netCents, 999);
});

test('a sale with returns cannot be cancelled whole, and a cancelled sale cannot be returned', async () => {
  const { app, sale, item } = await setup();
  ok(await giveBack(app, sale, item, 1));
  const cancel = await app.call('sales.void', { id: sale.id, reason: 'mistake' });
  assert.equal(cancel.error.code, 'CONFLICT');
  assert.match(cancel.error.message, /Return items/);

  const other = ok(await app.call('sales.checkout', { lines: [{ productId: item.product_id, unitType: 'SINGLE', quantity: 2 }], paymentMethod: 'CASH' }));
  ok(await app.call('sales.void', { id: other.id, reason: 'mistake' }));
  assert.equal((await giveBack(app, other, other.items[0], 1)).error.code, 'CONFLICT');
});

test('only managers can take back returned items', async () => {
  const { app, sale, item } = await setup();
  await loginAs(app, 'Cashier');
  assert.equal((await giveBack(app, sale, item, 1)).error.code, 'FORBIDDEN');
  assert.equal((await app.call('sales.returnQuote', { id: sale.id, lines: [{ saleItemId: item.id, quantity: 1 }] })).error.code, 'FORBIDDEN');
});

test("a return from a khata sale comes off the customer's balance", async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  app.ctx.db.transaction(() => app.ctx.db.run('UPDATE settings SET tax_rate_percent = 10, pos_fee_cents = 100;'));
  const buyer = ok(await app.call('customers.save', { name: 'Khata Customer', creditLimitCents: 1000000 }));
  const product = addProduct(app.ctx, { packSize: 10, stockUnits: 100, singlePriceCents: 1000, costPriceCents: 800 });
  const sale = ok(
    await app.call('sales.checkout', {
      lines: [{ productId: product.id, unitType: 'SINGLE', quantity: 10 }],
      paymentMethod: 'CREDIT',
      customerId: buyer.id,
      discount: { type: 'FLAT', value: 1000 }
    })
  );
  ok(await giveBack(app, sale, sale.items[0], 3));
  const { customer, entries } = ok(await app.call('customers.ledger', { customerId: sale.customer_id }));
  assert.equal(customer.current_debt_cents, 7000);
  const last = entries[entries.length - 1];
  assert.equal(last.type, 'ADJUSTMENT');
  assert.equal(last.credit_cents, 3000);
  assert.match(last.notes, /Return .*-R1/);
  // Not cash: the drawer is unaffected.
  const { today } = ok(await app.call('reports.dashboard'));
  assert.equal(today.cashReturnsCents, 0);
  assert.equal(today.returnsCents, 3000);
});

test('returned medicine that cannot be sold again is a loss at cost; stock stays as it was', async () => {
  const { app, product, sale, item } = await setup();
  ok(await giveBack(app, sale, item, 2, { restock: false }));
  assert.equal(stockOf(app, product.id), 90);
  const [loss, back] = ok(await app.call('products.stockHistory', { id: product.id }));
  assert.equal(back.kind, 'RETURNED');
  assert.equal(loss.kind, 'LOSS');
  assert.equal(loss.value_cents, -160);
  const today = localDateString();
  assert.equal(ok(await app.call('reports.profit', { from: today, to: today })).summary.writeOffCents, 160);
});

test("returns come off net sales, cost and the cash in the drawer on the day they happen", async () => {
  const { app, sale, item } = await setup();
  ok(await giveBack(app, sale, item, 3));
  const today = localDateString();
  const { summary: s, series } = ok(await app.call('reports.profit', { from: today, to: today }));
  assert.equal(s.returnsCount, 1);
  assert.equal(s.returnsNetCents, 2700);
  assert.equal(s.grossSalesCents - s.discountCents - s.returnsNetCents, s.netSalesCents);
  assert.equal(s.netSalesCents, 6300);
  assert.equal(s.costedNetSalesCents + s.uncostedNetSalesCents, s.netSalesCents);
  assert.equal(s.cogsCents, 560);
  assert.equal(s.grossProfitCents, 5740);
  assert.equal(s.taxAndFeesCents, 700);
  assert.equal(s.collectedCents, 7000);
  assert.equal(series.reduce((sum, b) => sum + b.netSalesCents, 0), s.netSalesCents);
  assert.equal(series.reduce((sum, b) => sum + b.grossProfitCents, 0), s.grossProfitCents);

  const { today: t } = ok(await app.call('reports.dashboard'));
  assert.equal(t.returnCount, 1);
  assert.equal(t.cashReturnsCents, 3000);
  assert.equal(t.expectedCashCents, 10000 - 3000);
});

// --------------------------------------------------------- opening balances

test('a customer who owed money in the old khata book starts with that balance', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  const customer = ok(await app.call('customers.save', { name: 'Old Book', creditLimitCents: 100000, openingBalanceCents: 25000 }));
  assert.equal(customer.current_debt_cents, 25000);
  const { entries } = ok(await app.call('customers.ledger', { customerId: customer.id }));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, 'OPENING_BALANCE');
  assert.equal(entries[0].debit_cents, 25000);
  assert.equal(entries[0].balance_after_cents, 25000);
  assert.equal(audits(app, 'customers.opening_balance').length, 1);

  // Once there are entries, it cannot be added again; payments work as usual.
  const again = await app.call('customers.save', { id: customer.id, name: 'Old Book', creditLimitCents: 100000, openingBalanceCents: 100 });
  assert.equal(again.error.code, 'VALIDATION');
  assert.equal(ok(await app.call('customers.recordPayment', { customerId: customer.id, amountCents: 5000 })).balanceCents, 20000);
});

test('an existing customer with no entries yet can get an opening balance; nothing else changes it', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  const customer = ok(await app.call('customers.save', { name: 'Added Earlier', creditLimitCents: 100000 }));
  assert.equal(ok(await app.call('customers.list')).find((c) => c.id === customer.id).has_ledger, 0);
  ok(await app.call('customers.save', { id: customer.id, name: 'Added Earlier', creditLimitCents: 100000, openingBalanceCents: 0 }));
  assert.equal(app.ctx.services.customers.get(customer.id).current_debt_cents, 0, 'zero is no opening balance');
  const updated = ok(await app.call('customers.save', { id: customer.id, name: 'Added Earlier', creditLimitCents: 100000, openingBalanceCents: 4000 }));
  assert.equal(updated.current_debt_cents, 4000);
  assert.equal(ok(await app.call('customers.list')).find((c) => c.id === customer.id).has_ledger, 1);
  // Not a sale: profit and loss and today's sales are unchanged.
  const today = localDateString();
  assert.equal(ok(await app.call('reports.profit', { from: today, to: today })).summary.netSalesCents, 0);

  await loginAs(app, 'Cashier');
  assert.equal((await app.call('customers.save', { name: 'By Cashier', creditLimitCents: 0, openingBalanceCents: 100 })).error.code, 'FORBIDDEN');
});
