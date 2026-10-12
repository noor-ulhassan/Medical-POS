'use strict';

const v = require('../lib/validate');
const { notFound, conflict } = require('../lib/errors');
const { recordAudit } = require('./audit');

function createCatalogService(db) {
  function requireRow(table, id, label) {
    const row = db.get(`SELECT * FROM ${table} WHERE id = ?;`, [id]);
    if (!row) throw notFound(`${label} not found`);
    return row;
  }

  return {
    listCategories() {
      return db.all('SELECT * FROM categories ORDER BY name COLLATE NOCASE;');
    },

    listSuppliers() {
      return db.all('SELECT * FROM suppliers ORDER BY name COLLATE NOCASE;');
    },

    saveCategory(actor, input) {
      const data = v.object(input);
      const id = v.id(data.id, 'Category', { required: false });
      const name = v.string(data.name, 'Category name', { required: true, max: 80 });
      const description = v.string(data.description, 'Description', { max: 250 });

      const duplicate = db.get('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id != ?;', [name, id || 0]);
      if (duplicate) throw conflict(`A category named "${name}" already exists`);

      return db.transaction(() => {
        if (id) {
          requireRow('categories', id, 'Category');
          db.run('UPDATE categories SET name = ?, description = ? WHERE id = ?;', [name, description, id]);
          recordAudit(db, actor, 'categories.update', { id, name });
          return requireRow('categories', id, 'Category');
        }
        const res = db.run('INSERT INTO categories (name, description) VALUES (?, ?);', [name, description]);
        recordAudit(db, actor, 'categories.create', { id: res.lastInsertRowid, name });
        return requireRow('categories', res.lastInsertRowid, 'Category');
      });
    },

    saveSupplier(actor, input) {
      const data = v.object(input);
      const id = v.id(data.id, 'Supplier', { required: false });
      const fields = [
        v.string(data.name, 'Supplier name', { required: true, max: 120 }),
        v.string(data.contactPerson, 'Contact person', { max: 120 }),
        v.string(data.phone, 'Phone', { max: 60 }),
        v.string(data.email, 'Email', { max: 120 }),
        v.string(data.address, 'Address', { max: 250 })
      ];

      return db.transaction(() => {
        if (id) {
          requireRow('suppliers', id, 'Supplier');
          db.run('UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ? WHERE id = ?;', [...fields, id]);
          recordAudit(db, actor, 'suppliers.update', { id, name: fields[0] });
          return requireRow('suppliers', id, 'Supplier');
        }
        const res = db.run('INSERT INTO suppliers (name, contact_person, phone, email, address) VALUES (?, ?, ?, ?, ?);', fields);
        recordAudit(db, actor, 'suppliers.create', { id: res.lastInsertRowid, name: fields[0] });
        return requireRow('suppliers', res.lastInsertRowid, 'Supplier');
      });
    }
  };
}

module.exports = { createCatalogService };
