'use strict';

const v = require('../lib/validate');
const { AppError, ErrorCodes, notFound, conflict, validationError } = require('../lib/errors');
const { nowIso, localDateString } = require('../lib/dates');
const {
  UNIT_TYPES,
  DISCOUNT_TYPES,
  lineUnits,
  unitPriceCents,
  costOfUnitsCents,
  computeTotals,
  discountWithinLimit,
  returnShares,
  returnedCostCents,
  formatCents
} = require('../../shared/pricing');
const { can } = require('../../shared/permissions');
const { WALK_IN_CUSTOMER_ID } = require('../db/seed');
const { postLedgerEntry } = require('./customers');
const { adjustStock, ADJUSTMENT_KINDS } = require('./products');
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
    // For khata sales: what the customer owed right after this sale (printed on the receipt).
    const entry =
      sale.payment_method === 'CREDIT'
        ? db.get("SELECT balance_after_cents FROM customer_ledger WHERE sale_id = ? AND type = 'SALE_CREDIT' ORDER BY id LIMIT 1;", [id])
        : null;
    sale.khata_balance_after_cents = entry ? entry.balance_after_cents : null;
    // Items brought back later (see returnItems), shown on the receipt and in the return dialog.
    sale.returns = db.all('SELECT * FROM sale_returns WHERE sale_id = ? ORDER BY id;', [id]);
    const returnedItems = sale.returns.length
      ? db.all(
          `SELECT sri.* FROM sale_return_items sri JOIN sale_returns r ON r.id = sri.return_id WHERE r.sale_id = ? ORDER BY sri.id;`,
          [id]
        )
      : [];
    for (const r of sale.returns) r.items = returnedItems.filter((i) => i.return_id === r.id);
    for (const item of sale.items) {
      item.returned_quantity = returnedItems.filter((i) => i.sale_item_id === item.id).reduce((sum, i) => sum + i.quantity, 0);
    }
    sale.returned_cents = sale.returns.reduce((sum, r) => sum + r.refund_cents, 0);
    return sale;
  }

  /**
   * Work out a return of some lines of a completed sale: what each returned
   * line puts back in stock and cost, and the money for the customer. Throws
   * when more is returned than is left on the invoice. No side effects.
   */
  function planReturn(sale, rawLines) {
    if (sale.status !== 'COMPLETED') throw conflict(`Invoice ${sale.invoice_no} was cancelled, so nothing can be returned from it`);
    const requested = new Map();
    for (const raw of v.array(rawLines, 'Items to return', { min: 1, max: 500 })) {
      const line = v.object(raw, 'Item to return');
      const saleItemId = v.id(line.saleItemId, 'Item');
      const quantity = v.integer(line.quantity, 'Quantity', { min: 1, max: 100000 });
      requested.set(saleItemId, (requested.get(saleItemId) || 0) + quantity);
    }
    const items = db.all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id;', [sale.id]);
    const earlier = db.all(
      `SELECT sri.sale_item_id, sri.quantity, sri.price_cents FROM sale_return_items sri
       JOIN sale_returns r ON r.id = sri.return_id WHERE r.sale_id = ?;`,
      [sale.id]
    );
    const returnedBefore = (itemId) => earlier.filter((e) => e.sale_item_id === itemId).reduce((sum, e) => sum + e.quantity, 0);
    const before = db.get('SELECT COALESCE(SUM(refund_cents), 0) AS refund, COALESCE(SUM(net_cents), 0) AS net FROM sale_returns WHERE sale_id = ?;', [sale.id]);

    const lines = [...requested].map(([saleItemId, quantity]) => {
      const item = items.find((i) => i.id === saleItemId);
      if (!item) throw validationError('That item is not on this invoice');
      const already = returnedBefore(item.id);
      const left = item.quantity - already;
      if (quantity > left) {
        throw validationError(
          left > 0 ? `Only ${left} of "${item.product_title}" can still be returned from this invoice` : `All of "${item.product_title}" was already returned`
        );
      }
      // base_units is exact for every sale line (recorded at checkout, or filled in by the v2 upgrade).
      const unitsEach = item.base_units != null ? Math.round(item.base_units / item.quantity) : 1;
      return {
        item,
        quantity,
        units: unitsEach * quantity,
        grossCents: item.price_cents * quantity,
        costCents: returnedCostCents(item.cost_cents, item.quantity, already, quantity)
      };
    });
    const { refundCents, netCents } = returnShares(
      { subtotalCents: sale.subtotal_cents, discountCents: sale.discount_cents, totalCents: sale.total_cents },
      { grossCents: earlier.reduce((sum, e) => sum + e.price_cents * e.quantity, 0), refundCents: before.refund, netCents: before.net },
      lines.reduce((sum, l) => sum + l.grossCents, 0)
    );
    return { lines, refundCents, netCents };
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
      // A price left at 0 would give the medicine away.
      const priceCents = unitPriceCents(product, line.unitType);
      if (!(priceCents > 0)) {
        const by = line.unitType === 'PACK' ? 'pack' : 'unit';
        throw new AppError(
          ErrorCodes.NO_PRICE,
          `"${product.title}" has no price per ${by}, so it cannot be sold by the ${by}. Set the price under Medicines & stock.`
        );
      }
      const units = lineUnits(line.unitType, line.quantity, product.pack_size);
      unitsByProduct.set(product.id, (unitsByProduct.get(product.id) || 0) + units);
      // Cost is captured now, at the price paid for this stock, so later cost changes never rewrite past profit.
      const costCents = costOfUnitsCents(product.cost_price_cents, units, product.pack_size);
      return { ...line, product, units, priceCents, costCents };
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

        const discountLimit = settings.cashier_max_discount_percent;
        if (!can(actor.role, 'sales.discountAnyAmount') && !discountWithinLimit(totals.discountCents, totals.subtotalCents, discountLimit)) {
          throw new AppError(
            ErrorCodes.DISCOUNT_LIMIT,
            `A discount of ${formatCents(totals.discountCents)} on this bill needs a manager (a cashier can give up to ${discountLimit}%). ` +
              'Lower the discount, or press F12 and let a manager log in: the sale stays in the cart.'
          );
        }

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
        // Discounts are money given away, so the owner can see who gave which.
        if (totals.discountCents > 0) {
          recordAudit(db, actor, 'sales.discount', {
            saleId: id,
            invoiceNo,
            discountCents: totals.discountCents,
            subtotalCents: totals.subtotalCents,
            percent: Math.round((totals.discountCents / totals.subtotalCents) * 1000) / 10
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
      // % and _ typed in the box are searched for literally.
      const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const where = search ? "WHERE invoice_no LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\'" : '';
      const params = search ? [pattern, pattern] : [];
      const total = db.value(`SELECT COUNT(*) FROM sales ${where};`, params);
      const rows = db.all(
        `SELECT sales.*, (SELECT COALESCE(SUM(r.refund_cents), 0) FROM sale_returns r WHERE r.sale_id = sales.id) AS returned_cents
         FROM sales ${where} ORDER BY id DESC LIMIT ? OFFSET ?;`,
        [...params, pageSize, (page - 1) * pageSize]
      );
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
        // Cancelling restores the whole sale; after a return only the rest may come back.
        if (db.value('SELECT COUNT(*) FROM sale_returns WHERE sale_id = ?;', [saleId]) > 0) {
          throw conflict(`Some items of ${sale.invoice_no} were already returned. Use Return items for the rest.`);
        }

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

    /** What returning these lines would give back (no side effects), for the return dialog. */
    returnQuote(input) {
      const data = v.object(input);
      const sale = getSale(v.id(data.id, 'Invoice'));
      const { refundCents, netCents, lines } = planReturn(sale, data.lines);
      return { refundCents, netCents, units: lines.reduce((sum, l) => sum + l.units, 0) };
    },

    /**
     * A customer brings back some of what they bought. The items go back into
     * stock (or, when they cannot be sold again, are recorded as a loss), the
     * customer gets back their share of what they paid, from the drawer or off
     * their khata, and profit and loss counts it on the day of the return.
     */
    returnItems(actor, input) {
      const data = v.object(input);
      const saleId = v.id(data.id, 'Invoice');
      const reason = v.string(data.reason, 'Reason', { required: true, max: 250 });
      const restock = data.restock === undefined ? true : v.boolean(data.restock);

      const returnId = db.transaction(() => {
        const sale = db.get('SELECT * FROM sales WHERE id = ?;', [saleId]);
        if (!sale) throw notFound('Invoice not found');
        const { lines, refundCents, netCents } = planReturn(sale, data.lines);
        const count = db.value('SELECT COUNT(*) FROM sale_returns WHERE sale_id = ?;', [saleId]);
        const returnNo = `${sale.invoice_no}-R${count + 1}`;
        const res = db.run(
          `INSERT INTO sale_returns (sale_id, return_no, refund_cents, net_cents, refund_method, restocked, reason, user_id, user_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [saleId, returnNo, refundCents, netCents, sale.payment_method, restock ? 1 : 0, reason, actor.id, actor.name, nowIso()]
        );
        const id = res.lastInsertRowid;

        for (const line of lines) {
          const { item } = line;
          db.run(
            `INSERT INTO sale_return_items (return_id, sale_item_id, product_id, product_title, unit_type, quantity, base_units, price_cents, cost_cents)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [id, item.id, item.product_id, item.product_title, item.unit_type, line.quantity, line.units, item.price_cents, line.costCents]
          );
          if (!db.get('SELECT 1 FROM products WHERE id = ?;', [item.product_id])) continue; // never deleted once sold, but be safe
          adjustStock(db, actor, item.product_id, line.units, `Returned by customer (${returnNo})`, {
            kind: ADJUSTMENT_KINDS.RETURNED,
            valueCents: line.costCents
          });
          if (!restock) {
            // Not fit to sell again (opened, damaged, out of the cold chain): a loss at what it cost.
            adjustStock(db, actor, item.product_id, -line.units, `Returned, not fit to sell again (${returnNo})`, {
              kind: ADJUSTMENT_KINDS.LOSS,
              valueCents: line.costCents === null ? null : -line.costCents
            });
          }
        }

        if (sale.payment_method === 'CREDIT' && refundCents > 0) {
          postLedgerEntry(db, {
            customerId: sale.customer_id,
            saleId,
            type: 'ADJUSTMENT',
            deltaCents: -refundCents,
            notes: `Return ${returnNo} on invoice ${sale.invoice_no}: ${reason}`
          });
        }
        recordAudit(db, actor, 'sales.return', {
          saleId,
          invoiceNo: sale.invoice_no,
          returnNo,
          refundCents,
          items: lines.map((l) => `${l.quantity} x ${l.item.product_title}`).join(', '),
          restocked: restock,
          reason
        });
        return id;
      });
      return { sale: getSale(saleId), returned: db.get('SELECT * FROM sale_returns WHERE id = ?;', [returnId]) };
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
