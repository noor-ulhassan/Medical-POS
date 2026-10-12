'use strict';

const { hashPin } = require('../../lib/pin');
const { nowIso } = require('../../lib/dates');

/** PINs that v1.1 seeded and published in its README. */
const PUBLISHED_DEFAULT_PINS = new Set(['1234', '5678', '0000']);

function columnNames(db, table) {
  return db.all(`PRAGMA table_info(${table});`).map((c) => c.name);
}

function migrateSettings(db) {
  const old = db.get('SELECT * FROM settings WHERE id = 1;');
  const salesCount = db.value('SELECT COUNT(*) FROM sales;') || 0;
  db.exec(`
    CREATE TABLE settings_v2 (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      store_name TEXT NOT NULL DEFAULT 'My Pharmacy',
      store_address TEXT NOT NULL DEFAULT '',
      store_phone TEXT NOT NULL DEFAULT '',
      ntn_fbr_id TEXT NOT NULL DEFAULT '',
      tax_rate_percent REAL NOT NULL DEFAULT 0 CHECK (tax_rate_percent >= 0 AND tax_rate_percent <= 100),
      pos_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (pos_fee_cents >= 0),
      invoice_prefix TEXT NOT NULL DEFAULT 'INV-',
      next_invoice_no INTEGER NOT NULL DEFAULT 1 CHECK (next_invoice_no >= 1),
      receipt_disclaimer TEXT NOT NULL DEFAULT ''
    );
  `);
  if (old) {
    db.run(
      `INSERT INTO settings_v2 (id, store_name, store_address, store_phone, ntn_fbr_id, tax_rate_percent,
         pos_fee_cents, invoice_prefix, next_invoice_no, receipt_disclaimer)
       VALUES (1, ?, ?, ?, ?, ?, 100, 'INV-', ?, ?);`,
      [
        old.store_name || 'My Pharmacy',
        old.store_address || '',
        old.store_phone || '',
        old.ntn_fbr_id || '',
        Math.min(Math.max(Number(old.tax_rate_percent) || 0, 0), 100),
        salesCount + 1,
        old.receipt_disclaimer || ''
      ]
    );
  }
  db.exec('DROP TABLE settings; ALTER TABLE settings_v2 RENAME TO settings;');
}

function migrateUsers(db) {
  const oldUsers = db.all('SELECT * FROM users ORDER BY id;');
  db.exec(`
    CREATE TABLE users_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('Admin', 'Manager', 'Cashier')),
      pin_hash TEXT NOT NULL,
      must_change_pin INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);
  const createdAt = nowIso();
  for (const u of oldUsers) {
    const pin = String(u.pin);
    db.run(
      'INSERT INTO users_v2 (id, name, role, pin_hash, must_change_pin, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?);',
      [u.id, u.name, u.role, hashPin(pin), PUBLISHED_DEFAULT_PINS.has(pin) ? 1 : 0, u.is_active ? 1 : 0, createdAt]
    );
  }
  db.exec('DROP TABLE users; ALTER TABLE users_v2 RENAME TO users;');
}

function migrateProducts(db) {
  // Orphaned references would fail the foreign key check below.
  db.exec(`
    UPDATE products SET category_id = NULL WHERE category_id IS NOT NULL AND category_id NOT IN (SELECT id FROM categories);
    UPDATE products SET supplier_id = NULL WHERE supplier_id IS NOT NULL AND supplier_id NOT IN (SELECT id FROM suppliers);
  `);
  db.exec(`
    CREATE TABLE products_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      generic_name TEXT NOT NULL DEFAULT '',
      category_id INTEGER REFERENCES categories(id),
      supplier_id INTEGER REFERENCES suppliers(id),
      pack_size INTEGER NOT NULL DEFAULT 1 CHECK (pack_size >= 1),
      expiry_date TEXT,
      stock_units INTEGER NOT NULL DEFAULT 0,
      cost_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_price_cents >= 0),
      sale_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (sale_price_cents >= 0),
      single_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (single_price_cents >= 0),
      allow_negative_stock INTEGER NOT NULL DEFAULT 0,
      is_prescription_required INTEGER NOT NULL DEFAULT 0,
      min_stock_level INTEGER NOT NULL DEFAULT 0 CHECK (min_stock_level >= 0),
      is_active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO products_v2 (id, barcode, title, generic_name, category_id, supplier_id, pack_size, expiry_date,
      stock_units, cost_price_cents, sale_price_cents, single_price_cents, allow_negative_stock,
      is_prescription_required, min_stock_level, is_active)
    SELECT id, barcode, title, COALESCE(generic_name, ''), category_id, supplier_id,
      MAX(COALESCE(pack_size, 1), 1),
      NULLIF(expiry_date, ''),
      COALESCE(quantity_packs, 0) * MAX(COALESCE(pack_size, 1), 1) + COALESCE(quantity_singles, 0),
      MAX(COALESCE(cost_price_cents, 0), 0), MAX(COALESCE(sale_price_cents, 0), 0), MAX(COALESCE(single_price_cents, 0), 0),
      COALESCE(allow_negative_stock, 0), COALESCE(is_prescription_required, 0), MAX(COALESCE(min_stock_level, 0), 0), 1
    FROM products;
    DROP TABLE products;
    ALTER TABLE products_v2 RENAME TO products;
  `);
}

function migrateStockAdjustments(db) {
  db.exec(`
    CREATE TABLE stock_adjustments_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      change_units INTEGER NOT NULL,
      stock_after_units INTEGER NOT NULL,
      reason TEXT NOT NULL,
      user_id INTEGER,
      user_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    INSERT INTO stock_adjustments_v2 (id, product_id, change_units, stock_after_units, reason, user_id, created_at)
    SELECT sa.id, sa.product_id,
      sa.change_qty_packs * COALESCE(p.pack_size, 1) + sa.change_qty_singles,
      COALESCE(p.stock_units, 0), sa.reason, sa.user_id, sa.created_at
    FROM stock_adjustments sa JOIN products p ON p.id = sa.product_id;
    DROP TABLE stock_adjustments;
    ALTER TABLE stock_adjustments_v2 RENAME TO stock_adjustments;
  `);
}

function migrateSaleItems(db) {
  if (!columnNames(db, 'sale_items').includes('base_units')) {
    db.exec('ALTER TABLE sale_items ADD COLUMN base_units INTEGER;');
  }
  // Best effort for historical rows: uses the product's current pack size.
  db.exec(`
    UPDATE sale_items SET base_units = quantity * CASE
      WHEN unit_type = 'PACK' THEN COALESCE((SELECT pack_size FROM products p WHERE p.id = sale_items.product_id), 1)
      ELSE 1 END
    WHERE base_units IS NULL;
  `);
}

module.exports = {
  version: 2,
  name: 'v2: hashed PINs, unit-based stock, sequential invoices, audit log',
  PUBLISHED_DEFAULT_PINS,
  up(db) {
    migrateSettings(db);
    migrateUsers(db);
    migrateProducts(db);
    migrateStockAdjustments(db);
    migrateSaleItems(db);

    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_name TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      DROP INDEX IF EXISTS idx_products_barcode;
      DROP INDEX IF EXISTS idx_sales_invoice;
      CREATE INDEX IF NOT EXISTS idx_products_title ON products(title);
      CREATE INDEX IF NOT EXISTS idx_products_generic ON products(generic_name);
      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
      CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
      CREATE INDEX IF NOT EXISTS idx_products_expiry ON products(expiry_date);
      CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
      CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
      CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
      CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
      CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer ON customer_ledger(customer_id);
      CREATE INDEX IF NOT EXISTS idx_stock_adjustments_product ON stock_adjustments(product_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
    `);
  }
};
