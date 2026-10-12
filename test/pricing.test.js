'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../src/shared/pricing');
const { toEan13, isValidEan13, generateInternalBarcode } = require('../src/main/lib/barcode');
const { assertAcceptablePin, hashPin, verifyPin } = require('../src/main/lib/pin');
const { daysUntil, localDayRange } = require('../src/main/lib/dates');

test('toCents parses rupee input without float drift', () => {
  assert.equal(pricing.toCents('12.34'), 1234);
  assert.equal(pricing.toCents('0.1'), 10);
  assert.equal(pricing.toCents('1,250.50'), 125050);
  assert.ok(Number.isNaN(pricing.toCents('abc')));
  assert.ok(Number.isNaN(pricing.toCents('')));
});

test('formatCents groups thousands', () => {
  assert.equal(pricing.formatCents(123456789), 'Rs 1,234,567.89');
  assert.equal(pricing.formatCents(5), 'Rs 0.05');
  assert.equal(pricing.formatCents(-100000), '-Rs 1,000.00');
});

test('splitUnits handles normal and negative stock', () => {
  assert.deepEqual(pricing.splitUnits(255, 10), { packs: 25, singles: 5 });
  assert.deepEqual(pricing.splitUnits(-3, 10), { packs: -1, singles: 7 });
  assert.deepEqual(pricing.splitUnits(7, 0), { packs: 7, singles: 0 });
});

test('computeTotals applies discount, tax rate and per-receipt fee', () => {
  const lines = [
    { priceCents: 1000, quantity: 2 },
    { priceCents: 250, quantity: 4 }
  ];
  assert.deepEqual(pricing.computeTotals({ lines, discount: { type: 'PERCENT', value: 10 }, taxRatePercent: 5, posFeeCents: 100 }), {
    subtotalCents: 3000,
    discountCents: 300,
    taxCents: 135 + 100,
    totalCents: 2700 + 235
  });
  // Discount can never exceed the subtotal; fee only applies to non-empty receipts.
  assert.equal(pricing.computeTotals({ lines, discount: { type: 'FLAT', value: 999999 } }).totalCents, 0);
  assert.equal(pricing.computeTotals({ lines: [], posFeeCents: 100 }).totalCents, 0);
});

test('generated barcodes are valid in-store EAN-13 codes', () => {
  assert.equal(toEan13('400638133393'), '4006381333931');
  const code = generateInternalBarcode();
  assert.ok(isValidEan13(code));
  assert.equal(code[0], '2');
});

test('PIN rules reject weak PINs and hashes verify', () => {
  assert.throws(() => assertAcceptablePin('1234'), /too easy/);
  assert.throws(() => assertAcceptablePin('7777'), /too easy/);
  assert.throws(() => assertAcceptablePin('12a4'), /4 to 6 digits/);
  assert.equal(assertAcceptablePin('7391'), '7391');
  const hash = hashPin('7391');
  assert.ok(!hash.includes('7391'));
  assert.ok(verifyPin('7391', hash));
  assert.ok(!verifyPin('7392', hash));
});

test('local day helpers', () => {
  const now = new Date(2026, 9, 12, 1, 30); // 01:30 local
  assert.equal(daysUntil('2026-10-12', now), 0);
  assert.equal(daysUntil('2026-10-11', now), -1);
  assert.equal(daysUntil('2027-10-12', now), 365);
  const range = localDayRange(now);
  assert.ok(new Date(range.start) <= now && now < new Date(range.end));
});
