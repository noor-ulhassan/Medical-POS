'use strict';

/*
 * Returns of part of a sale. Cancelling (voiding) a sale is all or nothing;
 * a customer often brings back only some of what they bought.
 *
 * sale_returns: one return of items from one sale, with the money given back
 *   (refund_cents: the customer's share of what they paid, tax, fee and bill
 *   discount included) and the part of it that was sales (net_cents, after
 *   the bill discount, before tax and fee), so profit and loss can take it off.
 * sale_return_items: which lines, how many, and their cost at the time of the
 *   sale (NULL when that line's cost was unknown).
 */
module.exports = {
  version: 5,
  name: 'v5: returns of part of a sale',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sale_returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL REFERENCES sales(id),
        return_no TEXT NOT NULL UNIQUE,
        refund_cents INTEGER NOT NULL CHECK (refund_cents >= 0),
        net_cents INTEGER NOT NULL CHECK (net_cents >= 0),
        refund_method TEXT NOT NULL,
        restocked INTEGER NOT NULL DEFAULT 1,
        reason TEXT NOT NULL,
        user_id INTEGER,
        user_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sale_return_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_id INTEGER NOT NULL REFERENCES sale_returns(id),
        sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
        product_id INTEGER NOT NULL,
        product_title TEXT NOT NULL,
        unit_type TEXT NOT NULL CHECK (unit_type IN ('PACK', 'SINGLE')),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        base_units INTEGER NOT NULL,
        price_cents INTEGER NOT NULL,
        cost_cents INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_sale_returns_sale ON sale_returns(sale_id);
      CREATE INDEX IF NOT EXISTS idx_sale_returns_created_at ON sale_returns(created_at);
      CREATE INDEX IF NOT EXISTS idx_sale_return_items_return ON sale_return_items(return_id);
      CREATE INDEX IF NOT EXISTS idx_sale_return_items_item ON sale_return_items(sale_item_id);
    `);
  }
};
