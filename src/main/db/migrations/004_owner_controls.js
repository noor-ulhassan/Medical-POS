'use strict';

function columnNames(db, table) {
  return db.all(`PRAGMA table_info(${table});`).map((c) => c.name);
}

function addColumns(db, table, definitions) {
  const existing = columnNames(db, table);
  for (const [name, definition] of definitions) {
    if (!existing.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition};`);
  }
}

/*
 * Owner controls:
 *  - how much discount a cashier may give on a bill (more needs a manager);
 *  - the wrong-PIN lockout is kept in the database, so restarting the app
 *    does not reset it;
 *  - a second folder (USB drive, cloud folder) that backups and prescription
 *    images are copied to, with the result of the last copy;
 *  - how a khata payment was received, so only cash counts towards the
 *    cash expected in the drawer. Older payments keep NULL (they were all
 *    treated as cash before).
 */
module.exports = {
  version: 4,
  name: 'v4: cashier discount limit, lasting PIN lockout, backup copy folder, khata payment method',
  up(db) {
    addColumns(db, 'settings', [
      ['cashier_max_discount_percent', 'REAL NOT NULL DEFAULT 10 CHECK (cashier_max_discount_percent >= 0 AND cashier_max_discount_percent <= 100)'],
      ['login_failed_attempts', 'INTEGER NOT NULL DEFAULT 0'],
      ['login_locked_until_ms', 'INTEGER NOT NULL DEFAULT 0'],
      ['login_last_failure_ms', 'INTEGER NOT NULL DEFAULT 0'],
      ['backup_copy_dir', "TEXT NOT NULL DEFAULT ''"],
      ['backup_copy_last_at', 'TEXT'],
      ['backup_copy_last_error', "TEXT NOT NULL DEFAULT ''"]
    ]);
    addColumns(db, 'customer_ledger', [['payment_method', 'TEXT']]);
  }
};
