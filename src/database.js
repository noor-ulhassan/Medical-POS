/**
 * MediDesk POS Database Module
 * Simplified Product-Centric Architecture (Batches removed, Auto-Barcode enabled)
 */

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  store_name TEXT NOT NULL DEFAULT 'Hashmi Medical Store',
  store_address TEXT NOT NULL DEFAULT 'Muhammdia Colony St 9 Sargodha',
  store_phone TEXT NOT NULL DEFAULT '+92 300 1234567',
  ntn_fbr_id TEXT NOT NULL DEFAULT 'NTN: 8765432-1 / FBR: PHARM-9988',
  tax_rate_percent REAL NOT NULL DEFAULT 0.0,
  receipt_disclaimer TEXT NOT NULL DEFAULT 'Thank you for visiting Hashmi Medical Store! Medicines once sold are returnable within 7 days with original receipt.',
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

const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_title ON products(title);
CREATE INDEX IF NOT EXISTS idx_products_generic ON products(generic_name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice ON sales(invoice_no);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer ON customer_ledger(customer_id);
`;

const DEFAULT_SEED_DATA = {
  settings: `
    INSERT OR IGNORE INTO settings (id, store_name, store_address, store_phone, ntn_fbr_id, tax_rate_percent, receipt_disclaimer)
    VALUES (1, 'Hashmi Medical Store', 'Muhammdia Colony St 9 Sargodha', '+92 300 9876543', 'NTN: 9876543-2 / FBR-PHARM-2026', 0.0, 'Thank you for visiting Hashmi Medical Store! Please retain this invoice for your records.');
  `,
  users: [
    `INSERT OR IGNORE INTO users (id, name, role, pin) VALUES (1, 'Syed Brothers', 'Admin', '1234');`,
    `INSERT OR IGNORE INTO users (id, name, role, pin) VALUES (2, 'Senior Pharmacist', 'Manager', '5678');`,
    `INSERT OR IGNORE INTO users (id, name, role, pin) VALUES (3, 'Terminal Cashier', 'Cashier', '0000');`
  ],
  customers: [
    `INSERT OR IGNORE INTO customers (id, name, phone, address, credit_limit_cents, current_debt_cents) VALUES (1, 'Walk-in Customer', 'N/A', 'Cash Counter', 0, 0);`,
    `INSERT OR IGNORE INTO customers (id, name, phone, address, credit_limit_cents, current_debt_cents) VALUES (2, 'Dr. Arslan Mahmood', '+92 321 5551234', 'House 45, Street 12, F-8/2', 1000000, 125000);`,
    `INSERT OR IGNORE INTO customers (id, name, phone, address, credit_limit_cents, current_debt_cents) VALUES (3, 'Kashif Ali (Corporate)', '+92 333 4445556', 'Blue Area Medical Plaza', 1500000, 450000);`
  ],
  categories: [
    `INSERT OR IGNORE INTO categories (id, name, description) VALUES (1, 'Antibiotics', 'Broad & narrow spectrum antibacterial medications');`,
    `INSERT OR IGNORE INTO categories (id, name, description) VALUES (2, 'Analgesics & Antipyretics', 'Pain relief and fever reduction');`,
    `INSERT OR IGNORE INTO categories (id, name, description) VALUES (3, 'Cardiovascular', 'Blood pressure, cholesterol and heart care');`,
    `INSERT OR IGNORE INTO categories (id, name, description) VALUES (4, 'Gastrointestinal', 'Antacids, PPIs, anti-diarrheal');`,
    `INSERT OR IGNORE INTO categories (id, name, description) VALUES (5, 'Vitamins & Supplements', 'Daily nutritional, mineral and vitamin supplements');`
  ],
  suppliers: [
    `INSERT OR IGNORE INTO suppliers (id, name, contact_person, phone, email, address) VALUES (1, 'GSK Pharma Distributors', 'Tariq Hassan', '+92 300 1112233', 'orders@gskdist.com', 'Industrial Area Sector I-9');`,
    `INSERT OR IGNORE INTO suppliers (id, name, contact_person, phone, email, address) VALUES (2, 'Getz Pharma Agencies', 'Bilal Ahmed', '+92 321 9998877', 'sales@getzpharma.pk', 'Pharma Hub Complex');`,
    `INSERT OR IGNORE INTO suppliers (id, name, contact_person, phone, email, address) VALUES (3, 'Abbott Laboratories Supply', 'Salman Khan', '+92 333 7776655', 'supply@abbott.com.pk', 'Express Cargo Terminal');`
  ],
  products: [
    `INSERT OR IGNORE INTO products (id, barcode, title, generic_name, category_id, supplier_id, pack_size, expiry_date, quantity_packs, quantity_singles, cost_price_cents, sale_price_cents, single_price_cents, allow_negative_stock, is_prescription_required, min_stock_level) 
     VALUES (1, '890123456001', 'Augmentin 625mg', 'Co-Amoxiclav', 1, 1, 10, '2026-11-15', 25, 5, 0, 24000, 2400, 0, 1, 5);`,
    `INSERT OR IGNORE INTO products (id, barcode, title, generic_name, category_id, supplier_id, pack_size, expiry_date, quantity_packs, quantity_singles, cost_price_cents, sale_price_cents, single_price_cents, allow_negative_stock, is_prescription_required, min_stock_level) 
     VALUES (2, '890123456002', 'Panadol Extra 500mg', 'Paracetamol + Caffeine', 2, 1, 20, '2026-12-01', 50, 10, 0, 4500, 225, 0, 0, 15);`,
    `INSERT OR IGNORE INTO products (id, barcode, title, generic_name, category_id, supplier_id, pack_size, expiry_date, quantity_packs, quantity_singles, cost_price_cents, sale_price_cents, single_price_cents, allow_negative_stock, is_prescription_required, min_stock_level) 
     VALUES (3, '890123456003', 'Risek 20mg Capsule', 'Omeprazole', 4, 2, 14, '2027-04-30', 18, 2, 0, 38000, 2714, 0, 0, 8);`,
    `INSERT OR IGNORE INTO products (id, barcode, title, generic_name, category_id, supplier_id, pack_size, expiry_date, quantity_packs, quantity_singles, cost_price_cents, sale_price_cents, single_price_cents, allow_negative_stock, is_prescription_required, min_stock_level) 
     VALUES (4, '890123456004', 'Softin 10mg Tablet', 'Loratadine', 2, 2, 10, '2026-09-10', 8, 0, 0, 12000, 1200, 0, 0, 10);`,
    `INSERT OR IGNORE INTO products (id, barcode, title, generic_name, category_id, supplier_id, pack_size, expiry_date, quantity_packs, quantity_singles, cost_price_cents, sale_price_cents, single_price_cents, allow_negative_stock, is_prescription_required, min_stock_level) 
     VALUES (5, '890123456005', 'Surbex-Z Tablet', 'Multivitamins + Zinc', 5, 3, 30, '2026-01-01', 0, 0, 0, 32000, 1067, 0, 0, 12);`,
    `INSERT OR IGNORE INTO products (id, barcode, title, generic_name, category_id, supplier_id, pack_size, expiry_date, quantity_packs, quantity_singles, cost_price_cents, sale_price_cents, single_price_cents, allow_negative_stock, is_prescription_required, min_stock_level) 
     VALUES (6, '890123456006', 'Lipiget 10mg', 'Atorvastatin', 3, 2, 10, '2027-11-20', 2, 0, 0, 28000, 2800, 1, 1, 4);`
  ],
  ledger: [
    `INSERT OR IGNORE INTO customer_ledger (id, customer_id, sale_id, type, debit_cents, credit_cents, balance_after_cents, notes, created_at)
     VALUES (1, 2, NULL, 'OPENING_BALANCE', 125000, 0, 125000, 'Initial customer credit balance', '2026-07-01 10:00:00');`,
    `INSERT OR IGNORE INTO customer_ledger (id, customer_id, sale_id, type, debit_cents, credit_cents, balance_after_cents, notes, created_at)
     VALUES (2, 3, NULL, 'OPENING_BALANCE', 450000, 0, 450000, 'Initial corporate credit balance', '2026-07-01 11:30:00');`
  ]
};

module.exports = {
  SCHEMA_SQL,
  INDEX_SQL,
  DEFAULT_SEED_DATA
};
