'use strict';

const v = require('../lib/validate');
const { notFound, validationError } = require('../lib/errors');
const { nowIso } = require('../lib/dates');
const { WALK_IN_CUSTOMER_ID } = require('../db/seed');
const { recordAudit } = require('./audit');

/** How a khata payment can be received. Only CASH goes into the drawer. */
const KHATA_PAYMENT_METHODS = Object.freeze({ CASH: 'cash', CARD: 'card', 'MOBILE WALLET': 'mobile wallet', BANK: 'bank transfer' });

/**
 * Change a customer's balance by `deltaCents` (positive = more debt) and
 * append the matching ledger entry. Must be called inside a transaction.
 */
function postLedgerEntry(db, { customerId, saleId = null, type, deltaCents, notes, paymentMethod = null }) {
  db.run('UPDATE customers SET current_debt_cents = current_debt_cents + ? WHERE id = ?;', [deltaCents, customerId]);
  const balance = db.value('SELECT current_debt_cents FROM customers WHERE id = ?;', [customerId]);
  db.run(
    `INSERT INTO customer_ledger (customer_id, sale_id, type, debit_cents, credit_cents, balance_after_cents, notes, created_at, payment_method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [customerId, saleId, type, Math.max(deltaCents, 0), Math.max(-deltaCents, 0), balance, notes || '', nowIso(), paymentMethod]
  );
  return balance;
}

function createCustomersService(db) {
  function get(id) {
    const row = db.get('SELECT * FROM customers WHERE id = ?;', [id]);
    if (!row) throw notFound('Customer not found');
    return row;
  }

  return {
    get,

    list() {
      // Walk-in customer first, then alphabetical.
      return db.all('SELECT * FROM customers ORDER BY (id = ?) DESC, name COLLATE NOCASE;', [WALK_IN_CUSTOMER_ID]);
    },

    save(actor, input) {
      const data = v.object(input);
      const id = v.id(data.id, 'Customer', { required: false });
      if (id === WALK_IN_CUSTOMER_ID) throw validationError('The walk-in customer cannot be edited');
      const name = v.string(data.name, 'Customer name', { required: true, max: 120 });
      const phone = v.string(data.phone, 'Phone', { max: 60 });
      const address = v.string(data.address, 'Address', { max: 250 });
      const creditLimitCents = v.cents(data.creditLimitCents, 'Credit limit');

      const customerId = db.transaction(() => {
        if (id) {
          get(id);
          db.run('UPDATE customers SET name = ?, phone = ?, address = ?, credit_limit_cents = ? WHERE id = ?;', [
            name, phone, address, creditLimitCents, id
          ]);
          recordAudit(db, actor, 'customers.update', { id, name, creditLimitCents });
          return id;
        }
        const res = db.run(
          'INSERT INTO customers (name, phone, address, credit_limit_cents, current_debt_cents) VALUES (?, ?, ?, ?, 0);',
          [name, phone, address, creditLimitCents]
        );
        recordAudit(db, actor, 'customers.create', { id: res.lastInsertRowid, name, creditLimitCents });
        return res.lastInsertRowid;
      });
      return get(customerId);
    },

    recordPayment(actor, input) {
      const data = v.object(input);
      const customerId = v.id(data.customerId, 'Customer');
      const amountCents = v.cents(data.amountCents, 'Payment amount', { min: 1 });
      const notes = v.string(data.notes, 'Notes', { max: 250 }) || 'Payment received at counter';
      const paymentMethod = v.oneOf(data.paymentMethod || 'CASH', 'Paid by', Object.keys(KHATA_PAYMENT_METHODS));
      if (customerId === WALK_IN_CUSTOMER_ID) throw validationError('The walk-in customer has no credit account');

      return db.transaction(() => {
        const customer = get(customerId);
        if (amountCents > customer.current_debt_cents) {
          throw validationError(
            `Payment is more than the outstanding balance (${(customer.current_debt_cents / 100).toFixed(2)})`
          );
        }
        const balance = postLedgerEntry(db, {
          customerId,
          type: 'PAYMENT_RECEIVED',
          deltaCents: -amountCents,
          paymentMethod,
          notes: `${notes} (${KHATA_PAYMENT_METHODS[paymentMethod]}, received by ${actor.name})`
        });
        return { customer: get(customerId), balanceCents: balance };
      });
    },

    ledger(input) {
      const customerId = v.id(v.object(input).customerId, 'Customer');
      return {
        customer: get(customerId),
        entries: db.all('SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY created_at, id;', [customerId])
      };
    }
  };
}

module.exports = { createCustomersService, postLedgerEntry, KHATA_PAYMENT_METHODS };
