'use strict';

const crypto = require('crypto');
const v = require('../lib/validate');
const { notFound } = require('../lib/errors');
const { nowIso } = require('../lib/dates');
const { UNIT_TYPES } = require('../../shared/pricing');
const { WALK_IN_CUSTOMER_ID } = require('../db/seed');

/** v1.1 stored whole product snapshots in cart_json; v2 stores only references. */
function normalizeStoredCart(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (_) {
    return { lines: [], discount: null };
  }
  const rawLines = Array.isArray(parsed) ? parsed : parsed.lines || [];
  const lines = rawLines
    .map((l) => ({
      productId: l.productId || (l.product && l.product.id),
      unitType: UNIT_TYPES.includes(l.unitType) ? l.unitType : 'SINGLE',
      quantity: Number(l.quantity) || 0
    }))
    .filter((l) => l.productId && l.quantity > 0);
  return { lines, discount: Array.isArray(parsed) ? null : parsed.discount || null };
}

function createParkedService(db) {
  return {
    /** Held carts with who they belong to and how many lines they have, so staff can tell them apart. */
    list() {
      return db
        .all(
          `SELECT po.id, po.tab_key, po.cashier_id, po.customer_id, po.total_cents, po.created_at, po.cart_json,
             c.name AS customer_name, u.name AS cashier_name
           FROM parked_orders po
           LEFT JOIN customers c ON c.id = po.customer_id
           LEFT JOIN users u ON u.id = po.cashier_id
           ORDER BY po.id DESC;`
        )
        .map(({ cart_json: cartJson, ...row }) => ({ ...row, item_count: normalizeStoredCart(cartJson).lines.length }));
    },

    park(actor, input) {
      const data = v.object(input);
      const lines = v.array(data.lines, 'Cart', { min: 1, max: 500 }).map((raw) => {
        const l = v.object(raw, 'Cart line');
        return {
          productId: v.id(l.productId, 'Product'),
          unitType: v.oneOf(l.unitType, 'Unit type', UNIT_TYPES),
          quantity: v.integer(l.quantity, 'Quantity', { min: 1, max: 100000 })
        };
      });
      const customerId = v.id(data.customerId || WALK_IN_CUSTOMER_ID, 'Customer');
      const totalCents = v.cents(data.totalCents || 0, 'Total');
      const tabKey = `TAB-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      db.transaction(() => {
        db.run(
          'INSERT INTO parked_orders (tab_key, cashier_id, customer_id, cart_json, total_cents, created_at) VALUES (?, ?, ?, ?, ?, ?);',
          [tabKey, actor.id, customerId, JSON.stringify({ lines, discount: data.discount || null }), totalCents, nowIso()]
        );
      });
      return { tabKey };
    },

    /** Remove the parked order and hand its cart back to the till. */
    resume(input) {
      const id = v.id(v.object(input).id, 'Parked order');
      return db.transaction(() => {
        const row = db.get('SELECT * FROM parked_orders WHERE id = ?;', [id]);
        if (!row) throw notFound('Parked order not found (it may already have been resumed)');
        db.run('DELETE FROM parked_orders WHERE id = ?;', [id]);
        return { customerId: row.customer_id, ...normalizeStoredCart(row.cart_json) };
      });
    }
  };
}

module.exports = { createParkedService, normalizeStoredCart };
