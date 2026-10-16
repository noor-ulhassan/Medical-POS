'use strict';

const v = require('../lib/validate');
const { notFound, conflict, validationError } = require('../lib/errors');
const { generateInternalBarcode } = require('../lib/barcode');
const { nowIso } = require('../lib/dates');
const { splitUnits, costOfUnitsCents } = require('../../shared/pricing');
const { recordAudit } = require('./audit');

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, s.name AS supplier_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id`;

function withDerivedStock(row) {
  const { packs, singles } = splitUnits(row.stock_units, row.pack_size);
  return { ...row, stock_packs: packs, stock_singles: singles };
}

/** What a stock adjustment was, so reports never have to guess from the free-text reason. */
const ADJUSTMENT_KINDS = Object.freeze({ OPENING: 'OPENING', CORRECTION: 'CORRECTION', RECEIVED: 'RECEIVED', WRITE_OFF: 'WRITE_OFF' });

/**
 * Apply a relative stock change and record it in stock_adjustments.
 * `valueCents` is the change valued at cost (signed like the change; null
 * when the cost is unknown). Must be called inside a transaction.
 */
function adjustStock(db, actor, productId, changeUnits, reason, { kind = null, valueCents = null } = {}) {
  if (changeUnits === 0) return;
  db.run('UPDATE products SET stock_units = stock_units + ? WHERE id = ?;', [changeUnits, productId]);
  const after = db.value('SELECT stock_units FROM products WHERE id = ?;', [productId]);
  db.run(
    `INSERT INTO stock_adjustments (product_id, change_units, stock_after_units, reason, user_id, user_name, created_at, kind, value_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [productId, changeUnits, after, reason, actor ? actor.id : null, actor ? actor.name : '', nowIso(), kind, valueCents]
  );
}

/** Signed cost value of a stock change, or null when the product has no cost price. */
function changeValueCents(costPerPackCents, changeUnits, packSize) {
  const value = costOfUnitsCents(costPerPackCents, Math.abs(changeUnits), packSize);
  return value === null ? null : Math.sign(changeUnits) * value;
}

function createProductsService(db) {
  function get(id) {
    const row = db.get(`${PRODUCT_SELECT} WHERE p.id = ?;`, [id]);
    if (!row) throw notFound('Product not found');
    return withDerivedStock(row);
  }

  function barcodeExists(code) {
    return Boolean(db.get('SELECT 1 FROM products WHERE barcode = ?;', [code]));
  }

  function parseProductInput(data) {
    const packSize = v.integer(data.packSize, 'Pack size', { min: 1, max: 10000 });
    const salePriceCents = v.cents(data.salePriceCents, 'Sale price per pack');
    const singlePriceCents = v.cents(data.singlePriceCents, 'Single unit price');
    return {
      barcode: v.string(data.barcode, 'Barcode', { required: true, max: 64 }),
      title: v.string(data.title, 'Product title', { required: true, max: 200 }),
      genericName: v.string(data.genericName, 'Generic name', { max: 200 }),
      categoryId: v.id(data.categoryId, 'Category', { required: false }),
      supplierId: v.id(data.supplierId, 'Supplier', { required: false }),
      packSize,
      expiryDate: v.date(data.expiryDate, 'Expiry date', { required: false }),
      minStockLevel: v.integer(data.minStockLevel, 'Minimum stock level', { min: 0, max: 1e6 }),
      costPriceCents: v.cents(data.costPriceCents, 'Cost price per pack'),
      salePriceCents,
      singlePriceCents,
      allowNegativeStock: v.boolean(data.allowNegativeStock) ? 1 : 0,
      prescriptionRequired: v.boolean(data.prescriptionRequired) ? 1 : 0,
      stockUnits: v.integer(data.stockUnits, 'Stock quantity', { min: -1e9, max: 1e9 })
    };
  }

  function assertReferences(p) {
    if (p.categoryId && !db.get('SELECT 1 FROM categories WHERE id = ?;', [p.categoryId])) throw notFound('Category not found');
    if (p.supplierId && !db.get('SELECT 1 FROM suppliers WHERE id = ?;', [p.supplierId])) throw notFound('Supplier not found');
  }

  return {
    get,
    withDerivedStock,

    list({ includeInactive = false } = {}) {
      const where = includeInactive ? '' : 'WHERE p.is_active = 1';
      return db.all(`${PRODUCT_SELECT} ${where} ORDER BY p.title COLLATE NOCASE;`).map(withDerivedStock);
    },

    generateBarcode() {
      return generateInternalBarcode(barcodeExists);
    },

    /**
     * Create or update a product. For edits, `originalStockUnits` is the stock
     * the form was opened with; only the difference the user typed is applied,
     * so sales made while the form was open are not overwritten.
     */
    save(actor, input) {
      const data = v.object(input);
      const id = v.id(data.id, 'Product', { required: false });
      const p = parseProductInput(data);
      if (!p.allowNegativeStock && p.stockUnits < 0) throw validationError('Stock cannot be negative for this product');
      assertReferences(p);

      const clash = db.get('SELECT id, is_active FROM products WHERE barcode = ? AND id != ?;', [p.barcode, id || 0]);
      if (clash) {
        throw conflict(
          clash.is_active ? 'Another product already uses this barcode' : 'This barcode belongs to an archived product'
        );
      }

      const columns = [
        p.barcode, p.title, p.genericName, p.categoryId, p.supplierId, p.packSize, p.expiryDate, p.minStockLevel,
        p.costPriceCents, p.salePriceCents, p.singlePriceCents, p.allowNegativeStock, p.prescriptionRequired
      ];

      const productId = db.transaction(() => {
        if (!id) {
          const res = db.run(
            `INSERT INTO products (barcode, title, generic_name, category_id, supplier_id, pack_size, expiry_date,
               min_stock_level, cost_price_cents, sale_price_cents, single_price_cents, allow_negative_stock,
               is_prescription_required, stock_units)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0);`,
            columns
          );
          adjustStock(db, actor, res.lastInsertRowid, p.stockUnits, 'Opening stock', {
            kind: ADJUSTMENT_KINDS.OPENING,
            valueCents: changeValueCents(p.costPriceCents, p.stockUnits, p.packSize)
          });
          recordAudit(db, actor, 'products.create', { id: res.lastInsertRowid, title: p.title, barcode: p.barcode });
          return res.lastInsertRowid;
        }

        const before = get(id);
        const originalStockUnits = v.integer(data.originalStockUnits, 'Original stock', { min: -1e9, max: 1e9 });
        db.run(
          `UPDATE products SET barcode = ?, title = ?, generic_name = ?, category_id = ?, supplier_id = ?, pack_size = ?,
             expiry_date = ?, min_stock_level = ?, cost_price_cents = ?, sale_price_cents = ?, single_price_cents = ?,
             allow_negative_stock = ?, is_prescription_required = ?
           WHERE id = ?;`,
          [...columns, id]
        );
        const correction = p.stockUnits - originalStockUnits;
        adjustStock(db, actor, id, correction, 'Manual stock correction', {
          kind: ADJUSTMENT_KINDS.CORRECTION,
          valueCents: changeValueCents(p.costPriceCents, correction, p.packSize)
        });
        if (before.sale_price_cents !== p.salePriceCents || before.single_price_cents !== p.singlePriceCents) {
          recordAudit(db, actor, 'products.price_change', {
            id,
            title: p.title,
            from: { pack: before.sale_price_cents, single: before.single_price_cents },
            to: { pack: p.salePriceCents, single: p.singlePriceCents }
          });
        }
        return id;
      });
      return get(productId);
    },

    /** Products with sales history are archived (kept for reports/voids); unused ones are deleted. */
    remove(actor, input) {
      const id = v.id(v.object(input).id, 'Product');
      const product = get(id);
      return db.transaction(() => {
        const hasHistory = db.get('SELECT 1 FROM sale_items WHERE product_id = ? LIMIT 1;', [id]);
        if (hasHistory) {
          db.run('UPDATE products SET is_active = 0 WHERE id = ?;', [id]);
          recordAudit(db, actor, 'products.archive', { id, title: product.title });
          return { mode: 'archived' };
        }
        db.run('DELETE FROM stock_adjustments WHERE product_id = ?;', [id]);
        db.run('DELETE FROM products WHERE id = ?;', [id]);
        recordAudit(db, actor, 'products.delete', { id, title: product.title });
        return { mode: 'deleted' };
      });
    },

    /**
     * A delivery arrived: add the received packs/units to whatever is already
     * in stock (relative, so nobody has to work out the new total by hand),
     * and optionally update the shelf expiry date and the cost price.
     */
    receiveStock(actor, input) {
      const data = v.object(input);
      const id = v.id(data.id, 'Product');
      const blank = (x) => x === undefined || x === null || x === '';
      const packs = v.integer(blank(data.packs) ? 0 : data.packs, 'Packs received', { min: 0, max: 1e6 });
      const singles = v.integer(blank(data.singles) ? 0 : data.singles, 'Loose units received', { min: 0, max: 1e7 });
      const expiryDate = v.date(data.expiryDate, 'Expiry date', { required: false });
      const costPriceCents = blank(data.costPriceCents) ? null : v.cents(data.costPriceCents, 'Cost price per pack');
      const product = get(id);
      if (!product.is_active) throw validationError('This product has been removed and cannot receive stock');
      const units = packs * product.pack_size + singles;
      if (units <= 0) throw validationError('Enter how many packs (or loose units) arrived');

      db.transaction(() => {
        const what = `${packs} pack(s)${singles ? ` + ${singles} loose unit(s)` : ''}`;
        adjustStock(db, actor, id, units, `Stock received: ${what}`, {
          kind: ADJUSTMENT_KINDS.RECEIVED,
          valueCents: changeValueCents(costPriceCents !== null ? costPriceCents : product.cost_price_cents, units, product.pack_size)
        });
        if (expiryDate) db.run('UPDATE products SET expiry_date = ? WHERE id = ?;', [expiryDate, id]);
        if (costPriceCents !== null) db.run('UPDATE products SET cost_price_cents = ? WHERE id = ?;', [costPriceCents, id]);
        recordAudit(db, actor, 'products.receive_stock', { id, title: product.title, units, expiryDate, costPriceCents });
      });
      return get(id);
    },

    /** Write off all remaining stock (e.g. expired medicine). */
    discardStock(actor, input) {
      const data = v.object(input);
      const id = v.id(data.id, 'Product');
      const reason = v.string(data.reason, 'Reason', { max: 200 }) || 'Expired stock discarded';
      const product = get(id);
      if (product.stock_units <= 0) throw validationError('This product has no stock to discard');
      // Valued at cost so the loss shows in the profit report.
      db.transaction(() =>
        adjustStock(db, actor, id, -product.stock_units, reason, {
          kind: ADJUSTMENT_KINDS.WRITE_OFF,
          valueCents: changeValueCents(product.cost_price_cents, -product.stock_units, product.pack_size)
        })
      );
      return get(id);
    },

    stockHistory(input) {
      const id = v.id(v.object(input).id, 'Product');
      return db.all('SELECT * FROM stock_adjustments WHERE product_id = ? ORDER BY id DESC LIMIT 200;', [id]);
    }
  };
}

module.exports = { createProductsService, adjustStock, withDerivedStock, ADJUSTMENT_KINDS };
