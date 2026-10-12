'use strict';

const fs = require('fs');
const { loadSqlJs } = require('../../src/main/db/Database');
const { V1_1_SCHEMA } = require('../../src/main/db/migrations/001_baseline');

/**
 * Build a database file exactly as version 1.1.0 of the app would have left it:
 * original schema, original seed rows (plaintext PINs, pack/single stock),
 * plus a recorded sale and a parked cart in the old JSON format.
 */
async function writeV11Database(filePath) {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  db.exec(V1_1_SCHEMA);
  db.exec(`
    INSERT INTO settings (id, store_name, store_address, store_phone, ntn_fbr_id, tax_rate_percent, receipt_disclaimer)
    VALUES (1, 'Al-Shifa Pharmacy', 'Main Bazaar, Lahore', '+92 300 0000000', 'NTN: 0000000-0', 0.0, 'Thank you!');
    INSERT INTO users (id, name, role, pin) VALUES (1, 'Store Owner', 'Admin', '1234');
    INSERT INTO users (id, name, role, pin) VALUES (2, 'Senior Pharmacist', 'Manager', '5678');
    INSERT INTO users (id, name, role, pin) VALUES (3, 'Night Cashier', 'Cashier', '2468');
    INSERT INTO customers (id, name, phone, address, credit_limit_cents, current_debt_cents) VALUES (1, 'Walk-in Customer', 'N/A', 'Cash Counter', 0, 0);
    INSERT INTO customers (id, name, phone, address, credit_limit_cents, current_debt_cents) VALUES (2, 'Dr. Ayesha Khan', '+92 321 0000000', 'Model Town', 1000000, 125000);
    INSERT INTO categories (id, name, description) VALUES (1, 'Antibiotics', '');
    INSERT INTO suppliers (id, name) VALUES (1, 'Sample Distributors');
    INSERT INTO products (id, barcode, title, generic_name, category_id, supplier_id, pack_size, expiry_date, quantity_packs, quantity_singles, cost_price_cents, sale_price_cents, single_price_cents, allow_negative_stock, is_prescription_required, min_stock_level)
      VALUES (1, '890123456001', 'Augmentin 625mg', 'Co-Amoxiclav', 1, 1, 10, '2026-11-15', 25, 5, 0, 24000, 2400, 0, 1, 5);
    INSERT INTO products (id, barcode, title, generic_name, category_id, supplier_id, pack_size, expiry_date, quantity_packs, quantity_singles, cost_price_cents, sale_price_cents, single_price_cents, allow_negative_stock, is_prescription_required, min_stock_level)
      VALUES (2, '890123456002', 'Panadol Extra', NULL, 99, NULL, 20, '2026-12-01', 50, 10, 0, 4500, 225, 0, 0, 15);
    INSERT INTO customer_ledger (id, customer_id, sale_id, type, debit_cents, credit_cents, balance_after_cents, notes, created_at)
      VALUES (1, 2, NULL, 'OPENING_BALANCE', 125000, 0, 125000, 'Opening', '2026-07-01 10:00:00');
    INSERT INTO sales (id, invoice_no, cashier_id, cashier_name, customer_id, customer_name, subtotal_cents, tax_cents, discount_cents, total_cents, paid_cents, change_cents, payment_method, prescription_path, status, created_at)
      VALUES (1, 'INV-12345678', 1, 'Store Owner', 1, 'Walk-in Customer', 4800, 100, 0, 4900, 5000, 100, 'CASH', '', 'COMPLETED', '2026-07-02T08:00:00.000Z');
    INSERT INTO sale_items (sale_id, product_id, product_title, unit_type, quantity, price_cents, total_cents)
      VALUES (1, 1, 'Augmentin 625mg', 'SINGLE', 2, 2400, 4800);
    INSERT INTO parked_orders (tab_key, cashier_id, customer_id, cart_json, total_cents, created_at)
      VALUES ('TAB-123456', 1, 1, '[{"product":{"id":1,"title":"Augmentin 625mg"},"unitType":"PACK","quantity":1,"priceCents":24000}]', 24000, '2026-07-02T09:00:00.000Z');
  `);
  fs.writeFileSync(filePath, Buffer.from(db.export()));
  db.close();
}

module.exports = { writeV11Database };
