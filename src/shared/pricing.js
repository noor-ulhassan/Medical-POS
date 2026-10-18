/**
 * Pure money / stock / totals helpers shared by the main process (CommonJS)
 * and the renderer (exposed as window.NoorPosPricing).
 *
 * All money is integer cents. Stock is tracked as integer base units
 * (single tablets); packs are derived from pack_size.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NoorPosPricing = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const UNIT_TYPES = Object.freeze(['PACK', 'SINGLE']);
  const DISCOUNT_TYPES = Object.freeze(['FLAT', 'PERCENT']);

  /** Parse a user-entered rupee amount ("12.5") into integer cents. Returns NaN when invalid. */
  function toCents(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : NaN;
    const text = String(value == null ? '' : value).trim().replace(/,/g, '');
    if (text === '' || !/^-?\d*(\.\d*)?$/.test(text)) return NaN;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : NaN;
  }

  /** "Rs 12,345.60" (thousands grouped, always two decimals). */
  function formatCents(cents, currency) {
    const value = Number.isFinite(cents) ? cents : 0;
    const sign = value < 0 ? '-' : '';
    const [whole, fraction] = (Math.abs(value) / 100).toFixed(2).split('.');
    return `${sign}${currency || 'Rs'} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
  }

  function normalizePackSize(packSize) {
    const n = Math.trunc(Number(packSize));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }

  /** Number of base units a cart line consumes. */
  function lineUnits(unitType, quantity, packSize) {
    return unitType === 'PACK' ? quantity * normalizePackSize(packSize) : quantity;
  }

  /** Split base units into whole packs + loose singles (handles negative stock). */
  function splitUnits(units, packSize) {
    const size = normalizePackSize(packSize);
    const packs = Math.floor(units / size);
    const singles = units - packs * size;
    return { packs, singles };
  }

  /**
   * Cost of `units` base units at a cost price per pack, in whole cents
   * (rounded once, per line). Returns null when no cost price is set: an
   * unknown cost must never be treated as free, or profit would be overstated.
   */
  function costOfUnitsCents(costPerPackCents, units, packSize) {
    const cost = Number(costPerPackCents);
    if (!Number.isFinite(cost) || cost <= 0) return null;
    return Math.round((cost * units) / normalizePackSize(packSize));
  }

  function unitPriceCents(product, unitType) {
    return unitType === 'PACK' ? product.sale_price_cents || 0 : product.single_price_cents || 0;
  }

  function discountCents(subtotalCents, discount) {
    if (!discount || !discount.value) return 0;
    let cents;
    if (discount.type === 'PERCENT') {
      const pct = Math.min(Math.max(Number(discount.value) || 0, 0), 100);
      cents = Math.round((subtotalCents * pct) / 100);
    } else {
      cents = Math.max(Math.round(Number(discount.value) || 0), 0);
    }
    return Math.min(cents, subtotalCents);
  }

  /**
   * True when a bill discount is no more than `limitPercent` of the subtotal.
   * Compared with the rounded allowance, so a 10% discount always passes a 10% limit.
   */
  function discountWithinLimit(discountCentsValue, subtotalCents, limitPercent) {
    if (!discountCentsValue) return true;
    const limit = Math.min(Math.max(Number(limitPercent) || 0, 0), 100);
    return discountCentsValue <= Math.round((subtotalCents * limit) / 100);
  }

  /**
   * Compute receipt totals.
   * @param {object} input
   * @param {{priceCents:number, quantity:number}[]} input.lines
   * @param {{type:'FLAT'|'PERCENT', value:number}} [input.discount] FLAT value is in cents, PERCENT is 0-100
   * @param {number} [input.taxRatePercent]
   * @param {number} [input.posFeeCents] flat fee charged once per non-empty receipt
   */
  function computeTotals(input) {
    const lines = input.lines || [];
    const subtotalCents = lines.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);
    const discount = discountCents(subtotalCents, input.discount);
    const taxable = subtotalCents - discount;
    const rate = Number(input.taxRatePercent) || 0;
    const fee = lines.length > 0 ? Math.max(Math.round(Number(input.posFeeCents) || 0), 0) : 0;
    const taxCents = Math.round((taxable * rate) / 100) + fee;
    return {
      subtotalCents,
      discountCents: discount,
      taxCents,
      totalCents: taxable + taxCents
    };
  }

  return {
    UNIT_TYPES,
    DISCOUNT_TYPES,
    toCents,
    formatCents,
    normalizePackSize,
    lineUnits,
    splitUnits,
    costOfUnitsCents,
    unitPriceCents,
    discountCents,
    discountWithinLimit,
    computeTotals
  };
});
