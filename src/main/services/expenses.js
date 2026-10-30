'use strict';

const v = require('../lib/validate');
const { notFound, validationError } = require('../lib/errors');
const { nowIso, localDateString } = require('../lib/dates');
const { EXPENSE_CATEGORY_IDS } = require('../../shared/expenses');
const { recordAudit } = require('./audit');

/**
 * Shop running costs (rent, salaries, bills...). Entries are never erased:
 * deleting marks them deleted with who/when/why, so the books stay auditable.
 */
function createExpensesService(db) {
  function get(id) {
    const row = db.get('SELECT * FROM expenses WHERE id = ?;', [id]);
    if (!row) throw notFound('Expense not found');
    return row;
  }

  return {
    list(input) {
      const data = v.object(input);
      const from = v.date(data.from, 'From date');
      const to = v.date(data.to, 'To date');
      if (to < from) throw validationError('The end date is before the start date');
      return db.all(
        'SELECT * FROM expenses WHERE deleted_at IS NULL AND expense_date >= ? AND expense_date <= ? ORDER BY expense_date DESC, id DESC;',
        [from, to]
      );
    },

    create(actor, input) {
      const data = v.object(input);
      const expenseDate = v.date(data.expenseDate, 'Date');
      if (expenseDate > localDateString()) throw validationError('The expense date cannot be in the future');
      const category = v.oneOf(data.category, 'Category', EXPENSE_CATEGORY_IDS);
      const amountCents = v.cents(data.amountCents, 'Amount', { min: 1, max: 1e11 });
      const note = v.string(data.note, 'Note', { max: 250 });
      const paidFromDrawer = v.boolean(data.paidFromDrawer) ? 1 : 0;

      const id = db.transaction(() => {
        const res = db.run(
          `INSERT INTO expenses (expense_date, category, amount_cents, note, paid_from_drawer, user_id, user_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          [expenseDate, category, amountCents, note, paidFromDrawer, actor.id, actor.name, nowIso()]
        );
        recordAudit(db, actor, 'expenses.create', { id: res.lastInsertRowid, expenseDate, category, amountCents, paidFromDrawer });
        return res.lastInsertRowid;
      });
      return get(id);
    },

    remove(actor, input) {
      const data = v.object(input);
      const id = v.id(data.id, 'Expense');
      const reason = v.string(data.reason, 'Reason', { max: 250 });
      db.transaction(() => {
        const row = get(id);
        if (row.deleted_at) throw validationError('This expense was already deleted');
        db.run('UPDATE expenses SET deleted_at = ?, deleted_by = ?, delete_reason = ? WHERE id = ?;', [nowIso(), actor.name, reason, id]);
        recordAudit(db, actor, 'expenses.delete', { id, expenseDate: row.expense_date, category: row.category, amountCents: row.amount_cents, reason });
      });
      return get(id);
    }
  };
}

module.exports = { createExpensesService };
