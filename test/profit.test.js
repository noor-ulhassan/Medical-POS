'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, loginAs, addProduct, ok } = require('./helpers');
const { localDateString, addDays, parseLocalDate } = require('../src/main/lib/dates');
const pricing = require('../src/shared/pricing');

const today = () => localDateString();
const yesterday = () => localDateString(addDays(new Date(), -1));

/**
 * A day of trading where every expected figure is worked out by hand below.
 * Tax 10 % and a Rs 1 (100 cent) fee per receipt.
 */
async function tradingDay() {
  const app = await createTestApp();
  const manager = await loginAs(app, 'Manager');
  app.ctx.db.transaction(() => app.ctx.db.run('UPDATE settings SET tax_rate_percent = 10, pos_fee_cents = 100;'));
  const antibiotics = app.ctx.services.catalog.saveCategory(manager, { name: 'Antibiotics' });
  // A: Rs 8.00 cost per pack of 10 -> 80 cents per unit.
  const a = addProduct(app.ctx, { title: 'A', packSize: 10, costPriceCents: 800, salePriceCents: 1000, singlePriceCents: 120, categoryId: antibiotics.id });
  // B: Rs 10.00 per pack of 3 -> one unit costs 333.33 cents, recorded as 333.
  const b = addProduct(app.ctx, { title: 'B', packSize: 3, costPriceCents: 1000, salePriceCents: 1500, singlePriceCents: 600 });
  // C: no cost price entered -> cost unknown, never "free".
  const c = addProduct(app.ctx, { title: 'C', packSize: 1, costPriceCents: 0, salePriceCents: 500, singlePriceCents: 500 });
  // D: written off as expired. 10 units of a pack of 6 at Rs 6.00 -> 1000 cents.
  const d = addProduct(app.ctx, { title: 'D', packSize: 6, costPriceCents: 600, stockUnits: 10 });

  const sell = async (lines, extra = {}) => ok(await app.call('sales.checkout', { lines, paymentMethod: 'CASH', ...extra }));
  // 1: 3 units + 1 pack of A = 360 + 1000 = 1360, discount 60 -> net 1300; tax 130 + fee 100; cost 240 + 800 = 1040.
  const s1 = await sell(
    [
      { productId: a.id, unitType: 'SINGLE', quantity: 3 },
      { productId: a.id, unitType: 'PACK', quantity: 1 }
    ],
    { discount: { type: 'FLAT', value: 60 } }
  );
  // 2: 1 unit of B by card = 600 net; tax 60 + fee 100; cost 333.
  const s2 = await sell([{ productId: b.id, unitType: 'SINGLE', quantity: 1 }], { paymentMethod: 'CARD' });
  // 3: C (unknown cost) + 1 unit of A = 620 net; left out of profit because one line has no cost.
  const s3 = await sell([
    { productId: c.id, unitType: 'SINGLE', quantity: 1 },
    { productId: a.id, unitType: 'SINGLE', quantity: 1 }
  ]);
  // 4: cancelled, so it must not count anywhere.
  const s4 = await sell([{ productId: a.id, unitType: 'SINGLE', quantity: 2 }]);
  ok(await app.call('sales.void', { id: s4.id, reason: 'test' }));

  const expense = (expenseDate, category, amountCents, paidFromDrawer = false) =>
    app.call('expenses.create', { expenseDate, category, amountCents, paidFromDrawer, note: 'test' });
  ok(await expense(today(), 'RENT', 50000));
  ok(await expense(today(), 'REFRESHMENTS', 300, true));
  ok(await expense(yesterday(), 'ELECTRICITY', 2000));
  const mistake = ok(await expense(today(), 'OTHER', 999));
  ok(await app.call('expenses.remove', { id: mistake.id, reason: 'typed twice' }));

  ok(await app.call('products.discardStock', { id: d.id }));
  return { app, manager, a, b, c, d, sales: [s1, s2, s3, s4] };
}

test('cost per line is captured at checkout, rounded once per line', async () => {
  const { app, sales } = await tradingDay();
  const cost = (saleId) => app.ctx.db.all('SELECT unit_type, cost_cents FROM sale_items WHERE sale_id = ? ORDER BY id;', [saleId]);
  assert.deepEqual(cost(sales[0].id), [
    { unit_type: 'SINGLE', cost_cents: 240 },
    { unit_type: 'PACK', cost_cents: 800 }
  ]);
  assert.deepEqual(cost(sales[1].id), [{ unit_type: 'SINGLE', cost_cents: 333 }]);
  assert.deepEqual(cost(sales[2].id), [
    { unit_type: 'SINGLE', cost_cents: null },
    { unit_type: 'SINGLE', cost_cents: 80 }
  ]);
  assert.equal(pricing.costOfUnitsCents(0, 5, 10), null, 'no cost price means unknown, not zero');
  assert.equal(pricing.costOfUnitsCents(1000, 2, 3), 667);
});

test('profit report: every figure matches the hand calculation', async () => {
  const { app } = await tradingDay();
  const r = ok(await app.call('reports.profit', { from: yesterday(), to: today() }));
  const s = r.summary;

  assert.equal(s.salesCount, 3, 'cancelled sale excluded');
  assert.equal(s.grossSalesCents, 1360 + 600 + 620);
  assert.equal(s.discountCents, 60);
  assert.equal(s.netSalesCents, 1300 + 600 + 620);
  assert.equal(s.taxAndFeesCents, 230 + 160 + 162);
  assert.equal(s.collectedCents, 1530 + 760 + 782);
  assert.equal(s.collectedCents, s.netSalesCents + s.taxAndFeesCents);

  assert.equal(s.costedSalesCount, 2);
  assert.equal(s.costedNetSalesCents, 1900);
  assert.equal(s.uncostedSalesCount, 1);
  assert.equal(s.uncostedNetSalesCents, 620);
  assert.equal(s.cogsCents, 1040 + 333);
  assert.equal(s.grossProfitCents, 1900 - 1373);
  assert.ok(Math.abs(s.grossMarginPct - (527 / 1900) * 100) < 1e-9);
  assert.ok(Math.abs(s.markupPct - (527 / 1373) * 100) < 1e-9);

  assert.equal(s.expensesCents, 50000 + 300 + 2000, 'deleted expense excluded');
  assert.equal(s.expenseCount, 3);
  assert.equal(s.writeOffCents, 1000);
  assert.equal(s.writeOffCount, 1);
  assert.equal(s.writeOffUnknownCount, 0);
  assert.equal(s.netProfitCents, 527 - 52300 - 1000);
  assert.ok(Math.abs(s.netMarginPct - ((527 - 53300) / 1900) * 100) < 1e-9);
  assert.equal(s.averageSaleCents, Math.round(2520 / 3));

  assert.deepEqual(
    r.expensesByCategory.map((e) => [e.category, e.amountCents, e.count]),
    [
      ['RENT', 50000, 1],
      ['ELECTRICITY', 2000, 1],
      ['REFRESHMENTS', 300, 1]
    ]
  );
  // Per medicine, before bill discounts, every line with a known cost (A's line in sale 3 included).
  assert.deepEqual(
    r.topProducts.map((p) => [p.title, p.revenueCents, p.costCents, p.profitCents, p.units]),
    [
      ['A', 1480, 1120, 360, 3 + 10 + 1],
      ['B', 600, 333, 267, 1]
    ]
  );
  assert.deepEqual(
    r.byCategory.map((c) => [c.name, c.profitCents]),
    [
      ['Antibiotics', 360],
      ['No category', 267]
    ]
  );
  assert.equal(r.productsMissingCost, 1);
});

test('profit report: the chart series add up exactly to the totals', async () => {
  const { app } = await tradingDay();
  const r = ok(await app.call('reports.profit', { from: yesterday(), to: today() }));
  assert.equal(r.granularity, 'day');
  assert.deepEqual(
    r.series.map((b) => b.key),
    [yesterday(), today()]
  );
  const sum = (field) => r.series.reduce((n, b) => n + b[field], 0);
  assert.equal(sum('netSalesCents'), r.summary.netSalesCents);
  assert.equal(sum('costedNetSalesCents'), r.summary.costedNetSalesCents);
  assert.equal(sum('cogsCents'), r.summary.cogsCents);
  assert.equal(sum('grossProfitCents'), r.summary.grossProfitCents);
  assert.equal(sum('expensesCents'), r.summary.expensesCents);
  assert.equal(sum('writeOffCents'), r.summary.writeOffCents);
  assert.equal(sum('netProfitCents'), r.summary.netProfitCents);
  assert.equal(sum('salesCount'), r.summary.salesCount);
  assert.equal(r.series[0].expensesCents, 2000, "yesterday's electricity bill is on yesterday");
  assert.equal(r.series[0].netProfitCents, -2000);
});

test('later cost changes never rewrite past profit', async () => {
  const { app, a } = await tradingDay();
  const before = ok(await app.call('reports.profit', { from: today(), to: today() })).summary;
  ok(await app.call('products.receiveStock', { id: a.id, packs: 5, costPriceCents: 950 }));
  const after = ok(await app.call('reports.profit', { from: today(), to: today() })).summary;
  assert.equal(after.cogsCents, before.cogsCents);
  assert.equal(after.grossProfitCents, before.grossProfitCents);
});

test('sales land on the local day they were made, at the edges of the period', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  app.ctx.db.transaction(() => app.ctx.db.run('UPDATE settings SET tax_rate_percent = 0, pos_fee_cents = 0;'));
  const p = addProduct(app.ctx, { singlePriceCents: 100, costPriceCents: 500, packSize: 10 });
  const sale = async () => ok(await app.call('sales.checkout', { lines: [{ productId: p.id, unitType: 'SINGLE', quantity: 1 }], paymentMethod: 'CASH' }));
  const at = async (date) => {
    const s = await sale();
    app.ctx.db.transaction(() => app.ctx.db.run('UPDATE sales SET created_at = ? WHERE id = ?;', [date.toISOString(), s.id]));
  };
  const day = parseLocalDate('2026-03-10');
  await at(new Date(2026, 2, 10, 0, 0, 0, 0)); // first moment of the 10th: in
  await at(new Date(2026, 2, 11, 23, 59, 59, 999)); // last moment of the 11th: in
  await at(new Date(2026, 2, 9, 23, 59, 59, 999)); // the 9th: out
  await at(new Date(2026, 2, 12, 0, 0, 0, 0)); // the 12th: out
  assert.equal(day.getHours(), 0);
  const r = ok(await app.call('reports.profit', { from: '2026-03-10', to: '2026-03-11' }));
  assert.equal(r.summary.salesCount, 2);
  assert.deepEqual(
    r.series.map((b) => [b.key, b.salesCount]),
    [
      ['2026-03-10', 1],
      ['2026-03-11', 1]
    ]
  );
});

test('long periods are grouped by month; bad periods are refused', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  const r = ok(await app.call('reports.profit', { from: '2026-01-15', to: '2026-12-31' }));
  assert.equal(r.granularity, 'month');
  assert.deepEqual(
    r.series.map((b) => b.key),
    ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']
  );
  assert.equal((await app.call('reports.profit', { from: '2026-05-02', to: '2026-05-01' })).error.code, 'VALIDATION');
  assert.equal((await app.call('reports.profit', { from: '2026-02-30', to: '2026-03-01' })).error.code, 'VALIDATION');
});

test("today's drawer cash subtracts expenses paid from the drawer", async () => {
  const { app } = await tradingDay();
  const { today: t } = ok(await app.call('reports.dashboard'));
  // Cash sales still completed today: 1530 + 782. Refreshments of 300 were paid from the drawer; rent was not.
  assert.equal(t.cashSalesCents, 1530 + 782);
  assert.equal(t.drawerExpensesCents, 300);
  assert.equal(t.expectedCashCents, 1530 + 782 - 300);
});

test('expenses: validation, soft delete with audit, and permissions', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  const future = localDateString(addDays(new Date(), 1));
  assert.equal((await app.call('expenses.create', { expenseDate: future, category: 'RENT', amountCents: 100 })).error.code, 'VALIDATION');
  assert.equal((await app.call('expenses.create', { expenseDate: today(), category: 'MEDICINE_STOCK', amountCents: 100 })).error.code, 'VALIDATION');
  assert.equal((await app.call('expenses.create', { expenseDate: today(), category: 'RENT', amountCents: 0 })).error.code, 'VALIDATION');
  const e = ok(await app.call('expenses.create', { expenseDate: today(), category: 'RENT', amountCents: 2500, note: 'October' }));
  assert.equal(ok(await app.call('expenses.list', { from: today(), to: today() })).length, 1);
  ok(await app.call('expenses.remove', { id: e.id, reason: 'wrong amount' }));
  assert.equal(ok(await app.call('expenses.list', { from: today(), to: today() })).length, 0);
  assert.equal((await app.call('expenses.remove', { id: e.id })).error.code, 'VALIDATION', 'cannot delete twice');
  const row = app.ctx.db.get('SELECT * FROM expenses WHERE id = ?;', [e.id]);
  assert.ok(row.deleted_at, 'kept, marked deleted');
  assert.equal(row.delete_reason, 'wrong amount');
  const audit = app.ctx.services.audit.list().map((a) => a.action);
  assert.ok(audit.includes('expenses.create') && audit.includes('expenses.delete'));

  await loginAs(app, 'Cashier');
  assert.equal((await app.call('expenses.create', { expenseDate: today(), category: 'RENT', amountCents: 1 })).error.code, 'FORBIDDEN');
  assert.equal((await app.call('reports.profit', { from: today(), to: today() })).error.code, 'FORBIDDEN');
});

test('upgraded databases: old sales have no recorded cost and are disclosed, not guessed', async () => {
  const path = require('path');
  const { tempDir } = require('./helpers');
  const { writeV11Database } = require('./fixtures/v1_1_database');
  const dir = tempDir();
  await writeV11Database(path.join(dir, 'noor_pharmacy_pos.db'));
  const app = await createTestApp({ dataDir: dir });
  await loginAs(app, 'Manager');
  assert.equal(app.ctx.db.value('SELECT cost_cents FROM sale_items WHERE sale_id = 1;'), null);
  // The v1.1 fixture sale was made on 2026-07-02 (08:00 UTC).
  const r = ok(await app.call('reports.profit', { from: '2026-07-01', to: '2026-07-03' }));
  assert.equal(r.summary.salesCount, 1);
  assert.equal(r.summary.uncostedSalesCount, 1);
  assert.equal(r.summary.costedSalesCount, 0);
  assert.equal(r.summary.grossProfitCents, 0);
  assert.equal(r.summary.grossMarginPct, null, 'no margin is shown when nothing is costed');
});

test('random trading: the report matches an independent recalculation from the raw rows, to the cent', async () => {
  const app = await createTestApp();
  await loginAs(app, 'Manager');
  app.ctx.db.transaction(() => app.ctx.db.run('UPDATE settings SET tax_rate_percent = 17, pos_fee_cents = 100;'));
  let seed = 20261016;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

  const products = [];
  for (let i = 0; i < 12; i++) {
    const packSize = [1, 3, 6, 7, 10, 14, 20, 30][int(0, 7)];
    const cost = i % 5 === 4 ? 0 : int(100, 90000); // every fifth medicine has no cost price
    const pack = cost + int(0, 30000);
    products.push(addProduct(app.ctx, { packSize, costPriceCents: cost, salePriceCents: pack, singlePriceCents: Math.ceil(pack / packSize) + int(0, 50), stockUnits: 1e7 }));
  }
  const from = '2026-04-01';
  const to = '2026-06-30';
  const days = [];
  for (let d = new Date(2026, 3, 1); d <= new Date(2026, 5, 30); d.setDate(d.getDate() + 1)) days.push(new Date(d));
  for (let i = 0; i < 300; i++) {
    const lines = [];
    for (let k = int(1, 4); k > 0; k--) lines.push({ productId: products[int(0, 11)].id, unitType: rand() < 0.4 ? 'PACK' : 'SINGLE', quantity: int(1, 5) });
    const discount = rand() < 0.2 ? { type: 'PERCENT', value: int(1, 15) } : rand() < 0.2 ? { type: 'FLAT', value: int(1, 500) } : null;
    const sale = ok(await app.call('sales.checkout', { lines, paymentMethod: ['CASH', 'CARD', 'MOBILE WALLET'][int(0, 2)], discount }));
    const day = days[int(0, days.length - 1)];
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), int(0, 23), int(0, 59), int(0, 59));
    app.ctx.db.transaction(() => app.ctx.db.run('UPDATE sales SET created_at = ? WHERE id = ?;', [at.toISOString(), sale.id]));
    if (rand() < 0.05) ok(await app.call('sales.void', { id: sale.id, reason: 'random' }));
  }
  const categories = ['RENT', 'SALARIES', 'ELECTRICITY', 'REFRESHMENTS', 'OTHER'];
  for (let i = 0; i < 40; i++) {
    const day = days[int(0, days.length - 1)];
    const e = ok(
      await app.call('expenses.create', { expenseDate: localDateString(day), category: categories[int(0, 4)], amountCents: int(1, 5000000), paidFromDrawer: rand() < 0.5 })
    );
    if (rand() < 0.1) ok(await app.call('expenses.remove', { id: e.id }));
  }

  // Independent recalculation straight from the stored rows.
  const db = app.ctx.db;
  const startIso = parseLocalDate(from).toISOString();
  const endIso = parseLocalDate('2026-07-01').toISOString();
  const sales = db.all("SELECT * FROM sales WHERE status = 'COMPLETED' AND created_at >= ? AND created_at < ?;", [startIso, endIso]);
  const productById = new Map(products.map((p) => [p.id, p]));
  let net = 0;
  let costedNet = 0;
  let cogs = 0;
  let uncosted = 0;
  for (const sale of sales) {
    const saleNet = sale.total_cents - sale.tax_cents;
    net += saleNet;
    const items = db.all('SELECT * FROM sale_items WHERE sale_id = ?;', [sale.id]);
    for (const item of items) {
      // The stored cost equals the product's cost price for the units sold (prices never changed in this test).
      const p = productById.get(item.product_id);
      const expected = p.cost_price_cents > 0 ? Math.round((p.cost_price_cents * item.base_units) / p.pack_size) : null;
      assert.equal(item.cost_cents, expected);
    }
    if (items.every((item) => item.cost_cents !== null)) {
      costedNet += saleNet;
      cogs += items.reduce((n, item) => n + item.cost_cents, 0);
    } else {
      uncosted += 1;
    }
  }
  const expenses = db.value('SELECT COALESCE(SUM(amount_cents), 0) FROM expenses WHERE deleted_at IS NULL AND expense_date BETWEEN ? AND ?;', [from, to]);

  const r = ok(await app.call('reports.profit', { from, to }));
  assert.equal(r.granularity, 'month');
  assert.equal(r.summary.salesCount, sales.length);
  assert.equal(r.summary.netSalesCents, net);
  assert.equal(r.summary.costedNetSalesCents, costedNet);
  assert.equal(r.summary.uncostedSalesCount, uncosted);
  assert.equal(r.summary.cogsCents, cogs);
  assert.equal(r.summary.grossProfitCents, costedNet - cogs);
  assert.equal(r.summary.expensesCents, expenses);
  assert.equal(r.summary.netProfitCents, costedNet - cogs - expenses);
  for (const field of ['netSalesCents', 'cogsCents', 'grossProfitCents', 'expensesCents', 'netProfitCents', 'salesCount']) {
    assert.equal(
      r.series.reduce((n, b) => n + b[field], 0),
      r.summary[field],
      `monthly ${field} add up to the total`
    );
  }
  // Each month on its own equals a report for just that month.
  const june = ok(await app.call('reports.profit', { from: '2026-06-01', to: '2026-06-30' })).summary;
  const juneBucket = r.series.find((b) => b.key === '2026-06');
  assert.equal(juneBucket.netProfitCents, june.netProfitCents);
  assert.equal(juneBucket.netSalesCents, june.netSalesCents);
});
