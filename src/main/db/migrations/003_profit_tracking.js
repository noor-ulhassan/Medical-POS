'use strict';

function columnNames(db, table) {
  return db.all(`PRAGMA table_info(${table});`).map((c) => c.name);
}

/*
 * Profit needs the cost of what was sold *at the time it was sold*; cost
 * prices change with every delivery. From this version each sale line keeps
 * its cost. Lines sold before it (or with no cost price set) keep NULL, which
 * the reports treat as "unknown" and disclose - nothing is back-filled with
 * today's cost, because that would be a guess presented as a fact.
 */
module.exports = {
  version: 3,
  name: 'v3: cost of goods on sale lines, expenses, stock write-off values',
  up(db) {
    if (!columnNames(db, 'sale_items').includes('cost_cents')) {
      db.exec('ALTER TABLE sale_items ADD COLUMN cost_cents INTEGER;');
    }
    const adjustmentColumns = columnNames(db, 'stock_adjustments');
    if (!adjustmentColumns.includes('kind')) db.exec('ALTER TABLE stock_adjustments ADD COLUMN kind TEXT;');
    if (!adjustmentColumns.includes('value_cents')) db.exec('ALTER TABLE stock_adjustments ADD COLUMN value_cents INTEGER;');

    db.exec(`
      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_date TEXT NOT NULL,
        category TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        note TEXT NOT NULL DEFAULT '',
        paid_from_drawer INTEGER NOT NULL DEFAULT 0,
        user_id INTEGER,
        user_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_by TEXT NOT NULL DEFAULT '',
        delete_reason TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
      CREATE INDEX IF NOT EXISTS idx_stock_adjustments_kind ON stock_adjustments(kind, created_at);
    `);
  }
};
