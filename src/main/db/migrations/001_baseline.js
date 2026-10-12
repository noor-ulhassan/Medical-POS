'use strict';

/*
 * Baseline: the table structure shipped in Noor Pharmacy POS v1.1.0 (store-specific
 * column defaults replaced with neutral ones). Existing v1.1 databases already
 * contain these tables (CREATE ... IF NOT EXISTS is a no-op); fresh databases
 * are created through the same path so there is only one schema history.
 */
const V1_1_SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  store_name TEXT NOT NULL DEFAULT 'My Pharmacy',
  store_address TEXT NOT NULL DEFAULT '',
  store_phone TEXT NOT NULL DEFAULT '',
  ntn_fbr_id TEXT NOT NULL DEFAULT '',
  tax_rate_percent REAL NOT NULL DEFAULT 0.0,
  receipt_disclaimer TEXT NOT NULL DEFAULT '',
  logo_path TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('Admin', 'Manager', 'Cashier')),
  pin TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_person TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  generic_name TEXT DEFAULT '',
  category_id INTEGER,
  supplier_id INTEGER,
  pack_size INTEGER NOT NULL DEFAULT 10,
  expiry_date TEXT NOT NULL DEFAULT '2027-12-31',
  quantity_packs INTEGER NOT NULL DEFAULT 0,
  quantity_singles INTEGER NOT NULL DEFAULT 0,
  cost_price_cents INTEGER NOT NULL DEFAULT 0,
  sale_price_cents INTEGER NOT NULL DEFAULT 0,
  single_price_cents INTEGER NOT NULL DEFAULT 0,
  allow_negative_stock INTEGER NOT NULL DEFAULT 0,
  is_prescription_required INTEGER NOT NULL DEFAULT 0,
  min_stock_level INTEGER NOT NULL DEFAULT 5,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  credit_limit_cents INTEGER NOT NULL DEFAULT 500000,
  current_debt_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customer_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  sale_id INTEGER NULL,
  type TEXT NOT NULL CHECK(type IN ('SALE_CREDIT', 'PAYMENT_RECEIVED', 'OPENING_BALANCE', 'ADJUSTMENT')),
  debit_cents INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  balance_after_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  cashier_id INTEGER NOT NULL,
  cashier_name TEXT NOT NULL,
  customer_id INTEGER NOT NULL DEFAULT 1,
  customer_name TEXT NOT NULL DEFAULT 'Walk-in Customer',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 100,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  change_cents INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'CASH',
  prescription_path TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_title TEXT NOT NULL,
  unit_type TEXT NOT NULL CHECK(unit_type IN ('PACK', 'SINGLE')),
  quantity INTEGER NOT NULL DEFAULT 1,
  price_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS parked_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tab_key TEXT NOT NULL UNIQUE,
  cashier_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL DEFAULT 1,
  cart_json TEXT NOT NULL,
  total_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  change_qty_packs INTEGER NOT NULL DEFAULT 0,
  change_qty_singles INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_no TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT DEFAULT '',
  items_json TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS void_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  user_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  voided_at TEXT NOT NULL,
  FOREIGN KEY (sale_id) REFERENCES sales(id)
);
`;

module.exports = {
  version: 1,
  name: 'baseline (v1.1 schema)',
  V1_1_SCHEMA,
  up(db) {
    db.exec(V1_1_SCHEMA);
  }
};
