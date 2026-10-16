'use strict';

const v = require('../lib/validate');
const { AppError, ErrorCodes, notFound, conflict, validationError } = require('../lib/errors');
const { nowIso, localDateString } = require('../lib/dates');
const { UNIT_TYPES, DISCOUNT_TYPES, lineUnits, unitPriceCents, costOfUnitsCents, computeTotals } = require('../../shared/pricing');
const { WALK_IN_CUSTOMER_ID } = require('../db/seed');
const { postLedgerEntry } = require('./customers');
const { recordAudit } = require('./audit');

const PAYMENT_METHODS = Object.freeze(['CASH', 'CARD', 'MOBILE WALLET', 'CREDIT']);

/** Validate and merge cart lines: same product + unit type are combined. */
function parseLines(rawLines) {
  const merged = new Map();
  for (const raw of v.array(rawLines, 'Cart', { min: 1, max: 500 })) {
    const line = v.object(raw, 'Cart line');
    const productId = v.id(line.productId, 'Product');
    const unitType = v.oneOf(line.unitType, 'Unit type', UNIT_TYPES);
    const quantity = v.integer(line.quantity, 'Quantity', { min: 1, max: 100000 });
    const key = `${productId}:${unitType}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += quantity;
    else merged.set(key, { productId, unitType, quantity });
  }
  return [...merged.values()];
}

function parseDiscount(raw) {
  if (!raw) return { type: 'FLAT', value: 0 };
  const d = v.object(raw, 'Discount');
  const type = v.oneOf(d.type || 'FLAT', 'Discount type', DISCOUNT_TYPES);
  const value = type === 'PERCENT' ? v.number(d.value || 0, 'Discount %', { min: 0, max: 100 }) : v.cents(d.value || 0, 'Discount');
  return { type, value };
}

function createSalesService(db, { files }) {
  function getSale(id) {
    const sale = db.get('SELECT * FROM sales WHERE id = ?;', [id]);
    if (!sale) throw notFound('Invoice not found');
    sale.items = db.all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id;', [id]);
    sale.void = db.get('SELECT * FROM void_sales WHERE sale_id = ? ORDER BY id DESC LIMIT 1;', [id]);
    return sale;
  }

  function nextInvoiceNumber(settings) {
    let n = settings.next_invoice_no;
    let invoiceNo;
    do {
      invoiceNo = `${settings.invoice_prefix}${String(n).padStart(6, '0')}`;
      n += 1;
    } while (db.get('SELECT 1 FROM sales WHERE invoice_no = ?;', [invoiceNo]));
    db.run('UPDATE settings SET next_invoice_no = ? WHERE id = 1;', [n]);
    return invoiceNo;
  }

  /**
   * Price the cart from current database prices and check stock.
   * Returns priced lines; throws INSUFFICIENT_STOCK when needed.
   */
  function priceLines(lines) {
    const unitsByProduct = new Map();
    const today = localDateString();
    const priced = lines.map((line) => {
      const product = db.get('SELECT * FROM products WHERE id = ? AND is_active = 1;', [line.productId]);
      if (!product) throw notFound('A product in the cart no longer exists. Refresh and try again.');
      // Expired medicine must never be sold. Medicine expiring today can still be sold today.
      if (product.expiry_date && product.expiry_date < today) {
        throw new AppError(
          ErrorCodes.EXPIRED,
          `"${product.title}" expired on ${product.expiry_date} and cannot be sold. ` +
            'If you have newer stock, update its expiry date under Medicines & stock.'
        );
      }
      const units = lineUnits(line.unitType, line.quantity, product.pack_size);
      unitsByProduct.set(product.id, (unitsByProduct.get(product.id) || 0) + units);
      // Cost is captured now, at the price paid for this stock, so later cost changes never rewrite past profit.
      const costCents = costOfUnitsCents(product.cost_price_cents, units, product.pack_size);
      return { ...line, product, units, priceCents: unitPriceCents(product, line.unitType), costCents };
    });

    for (const [productId, units] of unitsByProduct) {
      const { product } = priced.find((l) => l.productId === productId);
      if (!product.allow_negative_stock && product.stock_units < units) {
        throw new AppError(
          ErrorCodes.INSUFFICIENT_STOCK,
          `Not enough stock for "${product.title}": ${units} unit(s) needed, ${Math.max(product.stock_units, 0)} available.`
        );
      }
    }
    return priced;
  }

  return {
    getSale,
    PAYMENT_METHODS,

    /** Totals preview using authoritative prices (no side effects). */
    quote(input) {
      const data = v.object(input);
      const settings = db.get('SELECT * FROM settings WHERE id = 1;');
      const priced = priceLines(parseLines(data.lines));
      return computeTotals({
        lines: priced,
        discount: parseDiscount(data.discount),
        taxRatePercent: settings.tax_rate_percent,
        posFeeCents: settings.pos_fee_cents
      });
    },

    checkout(actor, input) {
      const data = v.object(input);
      const lines = parseLines(data.lines);
      const customerId = v.id(data.customerId || WALK_IN_CUSTOMER_ID, 'Customer');
      const paymentMethod = v.oneOf(data.paymentMethod, 'Payment method', PAYMENT_METHODS);
      const discount = parseDiscount(data.discount);
      const prescriptionPath = files.normalizeStoredPrescription(data.prescriptionPath);
      const tenderedCents = data.paidCents === undefined || data.paidCents === null ? null : v.cents(data.paidCents, 'Amount paid');

      const saleId = db.transaction(() => {
        const settings = db.get('SELECT * FROM settings WHERE id = 1;');
        const customer = db.get('SELECT * FROM customers WHERE id = ?;', [customerId]);
        if (!customer) throw notFound('Customer not found');
        if (paymentMethod === 'CREDIT' && customer.id === WALK_IN_CUSTOMER_ID) {
          throw validationError('Walk-in customers cannot buy on credit. Choose a registered customer.');
        }

        const priced = priceLines(lines);
        const totals = computeTotals({
          lines: priced,
          discount,
          taxRatePercent: settings.tax_rate_percent,
          posFeeCents: settings.pos_fee_cents
        });

        let paidCents = 0;
        let changeCents = 0;
        if (paymentMethod === 'CREDIT') {
          const newDebt = customer.current_debt_cents + totals.totalCents;
          if (newDebt > customer.credit_limit_cents) {
            throw new AppError(
              ErrorCodes.CREDIT_LIMIT,
              `Credit limit exceeded for ${customer.name}: limit ${(customer.credit_limit_cents / 100).toFixed(2)}, ` +
                `balance after this sale would be ${(newDebt / 100).toFixed(2)}.`
            );
          }
        } else if (paymentMethod === 'CASH') {
          paidCents = tenderedCents === null || tenderedCents === 0 ? totals.totalCents : tenderedCents;
          if (paidCents < totals.totalCents) {
            throw validationError(`Cash received is less than the total (short by ${((totals.totalCents - paidCents) / 100).toFixed(2)})`);
          }
          changeCents = paidCents - totals.totalCents;
        } else {
          // Card / wallet are charged the exact amount.
          paidCents = totals.totalCents;
        }

        const invoiceNo = nextInvoiceNumber(settings);
        const createdAt = nowIso();
        const sale = db.run(
          `INSERT INTO sales (invoice_no, cashier_id, cashier_name, customer_id, customer_name, subtotal_cents, tax_cents,
             discount_cents, total_cents, paid_cents, change_cents, payment_method, prescription_path, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?);`,
          [
            invoiceNo, actor.id, actor.name, customer.id, customer.name, totals.subtotalCents, totals.taxCents,
            totals.discountCents, totals.totalCents, paidCents, changeCents, paymentMethod, prescriptionPath, createdAt
          ]
        );
        const id = sale.lastInsertRowid;

        for (const line of priced) {
          db.run(
            `INSERT INTO sale_items (sale_id, product_id, product_title, unit_type, quantity, price_cents, total_cents, base_units, cost_cents)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              id, line.productId, line.product.title, line.unitType, line.quantity, line.priceCents, line.priceCents * line.quantity,
              line.units, line.costCents
            ]
          );
          // Relative update: concurrent changes and multiple lines of the same product all count.
          db.run('UPDATE products SET stock_units = stock_units - ? WHERE id = ?;', [line.units, line.productId]);
        }

        if (paymentMethod === 'CREDIT') {
          postLedgerEntry(db, {
            customerId: customer.id,
            saleId: id,
            type: 'SALE_CREDIT',
            deltaCents: totals.totalCents,
            notes: `Invoice ${invoiceNo} credit purchase`
          });
        }
        return id;
      });

      return getSale(saleId);
    },

    list(input) {
      const data = v.object(input);
      const pageSize = v.integer(data.pageSize || 25, 'Page size', { min: 1, max: 200 });
      const page = v.integer(data.page || 1, 'Page', { min: 1 });
      const search = v.string(data.search, 'Search', { max: 100 });
      const where = search ? 'WHERE invoice_no LIKE ? OR customer_name LIKE ?' : '';
      const params = search ? [`%${search}%`, `%${search}%`] : [];
      const total = db.value(`SELECT COUNT(*) FROM sales ${where};`, params);
      const rows = db.all(`SELECT * FROM sales ${where} ORDER BY id DESC LIMIT ? OFFSET ?;`, [...params, pageSize, (page - 1) * pageSize]);
      return { rows, total, page, pageSize };
    },

    get(input) {
      return getSale(v.id(v.object(input).id, 'Invoice'));
    },

    void(actor, input) {
      const data = v.object(input);
      const saleId = v.id(data.id, 'Invoice');
      const reason = v.string(data.reason, 'Reason', { required: true, max: 250 });

      db.transaction(() => {
        const sale = db.get('SELECT * FROM sales WHERE id = ?;', [saleId]);
        if (!sale) throw notFound('Invoice not found');
        if (sale.status !== 'COMPLETED') throw conflict(`Invoice ${sale.invoice_no} is already voided`);

        const items = db.all('SELECT * FROM sale_items WHERE sale_id = ?;', [saleId]);
        for (const item of items) {
          const product = db.get('SELECT pack_size FROM products WHERE id = ?;', [item.product_id]);
          if (!product) continue; // deleted products cannot be restocked
          const units = item.base_units != null ? item.base_units : lineUnits(item.unit_type, item.quantity, product.pack_size);
          db.run('UPDATE products SET stock_units = stock_units + ? WHERE id = ?;', [units, item.product_id]);
        }

        if (sale.payment_method === 'CREDIT') {
          postLedgerEntry(db, {
            customerId: sale.customer_id,
            saleId,
            type: 'ADJUSTMENT',
            deltaCents: -sale.total_cents,
            notes: `Void of invoice ${sale.invoice_no}: ${reason}`
          });
        }

        db.run("UPDATE sales SET status = 'VOIDED' WHERE id = ?;", [saleId]);
        db.run('INSERT INTO void_sales (sale_id, user_id, user_name, reason, voided_at) VALUES (?, ?, ?, ?, ?);', [
          saleId, actor.id, actor.name, reason, nowIso()
        ]);
        recordAudit(db, actor, 'sales.void', { saleId, invoiceNo: sale.invoice_no, reason });
      });
      return getSale(saleId);
    },

    attachPrescription(actor, input) {
      const data = v.object(input);
      const saleId = v.id(data.id, 'Invoice');
      getSale(saleId);
      const { relativePath } = files.savePrescription(data);
      db.transaction(() => {
        db.run('UPDATE sales SET prescription_path = ? WHERE id = ?;', [relativePath, saleId]);
        recordAudit(db, actor, 'sales.attach_prescription', { saleId });
      });
      return getSale(saleId);
    },

    getPrescription(input) {
      const sale = getSale(v.id(v.object(input).id, 'Invoice'));
      if (!sale.prescription_path) throw notFound('No prescription is attached to this invoice');
      return { invoiceNo: sale.invoice_no, dataUrl: files.readPrescriptionAsDataUrl(sale.prescription_path) };
    }
  };
}

module.exports = { createSalesService, PAYMENT_METHODS };
