'use strict';

const { hashPin } = require('../lib/pin');
const { nowIso, localDateString, addDays } = require('../lib/dates');
const { toEan13 } = require('../lib/barcode');

const WALK_IN_CUSTOMER_ID = 1;
const INITIAL_ADMIN_PIN = '1234';

/**
 * Rows the application cannot run without. Safe to call on every start:
 * it only inserts what is missing and never overwrites user data.
 */
function ensureEssentialRows(db) {
  db.transaction(() => {
    db.run(`INSERT OR IGNORE INTO settings (id, store_name, receipt_disclaimer)
            VALUES (1, 'My Pharmacy', 'Thank you for your visit. Please keep this receipt for your records.');`);
    db.run(
      `INSERT OR IGNORE INTO customers (id, name, phone, address, credit_limit_cents, current_debt_cents)
       VALUES (?, 'Walk-in Customer', '', '', 0, 0);`,
      [WALK_IN_CUSTOMER_ID]
    );
    const userCount = db.value('SELECT COUNT(*) FROM users;');
    if (userCount === 0) {
      // First run only. The PIN must be changed at first login.
      db.run(
        `INSERT INTO users (name, role, pin_hash, must_change_pin, is_active, created_at)
         VALUES ('Administrator', 'Admin', ?, 1, 1, ?);`,
        [hashPin(INITIAL_ADMIN_PIN), nowIso()]
      );
    }
  });
}

/** Optional sample catalogue for demos and development (NOORPOS_DEMO_DATA=1). */
function seedDemoData(db) {
  if (db.value('SELECT COUNT(*) FROM products;') > 0) return false;
  const expiry = (days) => localDateString(addDays(new Date(), days));
  db.transaction(() => {
    const categories = ['Antibiotics', 'Analgesics & Antipyretics', 'Cardiovascular', 'Gastrointestinal', 'Vitamins & Supplements'];
    const catIds = categories.map((name) => db.run('INSERT INTO categories (name) VALUES (?);', [name]).lastInsertRowid);
    const supplierIds = ['Sample Pharma Distributors', 'Example Medical Agencies'].map(
      (name) => db.run('INSERT INTO suppliers (name) VALUES (?);', [name]).lastInsertRowid
    );
    const products = [
      [toEan13('200000000001'), 'Amoxicillin 500mg Capsule', 'Amoxicillin', catIds[0], supplierIds[0], 10, expiry(400), 250, 18000, 24000, 2400, 1],
      [toEan13('200000000002'), 'Paracetamol 500mg Tablet', 'Paracetamol', catIds[1], supplierIds[0], 20, expiry(90), 1000, 3000, 4500, 225, 0],
      [toEan13('200000000003'), 'Omeprazole 20mg Capsule', 'Omeprazole', catIds[3], supplierIds[1], 14, expiry(25), 252, 30000, 38000, 2714, 0],
      [toEan13('200000000004'), 'Atorvastatin 10mg Tablet', 'Atorvastatin', catIds[2], supplierIds[1], 10, expiry(700), 20, 21000, 28000, 2800, 1],
      [toEan13('200000000005'), 'Multivitamin + Zinc Tablet', 'Multivitamins', catIds[4], supplierIds[1], 30, expiry(-10), 0, 25000, 32000, 1067, 0]
    ];
    for (const p of products) {
      db.run(
        `INSERT INTO products (barcode, title, generic_name, category_id, supplier_id, pack_size, expiry_date,
           stock_units, cost_price_cents, sale_price_cents, single_price_cents, is_prescription_required, min_stock_level)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 5);`,
        p
      );
    }
    db.run(
      `INSERT INTO customers (name, phone, address, credit_limit_cents, current_debt_cents)
       VALUES ('Sample Credit Customer', '', '', 1000000, 0);`
    );
  });
  return true;
}

module.exports = { ensureEssentialRows, seedDemoData, WALK_IN_CUSTOMER_ID, INITIAL_ADMIN_PIN };
