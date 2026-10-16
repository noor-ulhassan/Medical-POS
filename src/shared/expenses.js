/**
 * Expense categories, shared by the main process (validation) and the
 * renderer (forms, reports). Exposed to the renderer as window.NoorPosExpenses.
 *
 * Payments to suppliers for medicines are deliberately NOT a category: the
 * cost of medicines sold is already subtracted from profit automatically, so
 * recording stock purchases here would count them twice.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NoorPosExpenses = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EXPENSE_CATEGORIES = Object.freeze([
    { id: 'RENT', label: 'Shop rent' },
    { id: 'SALARIES', label: 'Salaries and wages' },
    { id: 'ELECTRICITY', label: 'Electricity' },
    { id: 'GAS_WATER', label: 'Gas and water' },
    { id: 'PHONE_INTERNET', label: 'Phone and internet' },
    { id: 'TRANSPORT', label: 'Transport and delivery' },
    { id: 'REPAIRS', label: 'Repairs and maintenance' },
    { id: 'SUPPLIES', label: 'Shop supplies' },
    { id: 'BANK_CHARGES', label: 'Bank and card charges' },
    { id: 'LICENCES_FEES', label: 'Licences, fees and taxes' },
    { id: 'MARKETING', label: 'Advertising' },
    { id: 'REFRESHMENTS', label: 'Tea and refreshments' },
    { id: 'OTHER', label: 'Other' }
  ]);

  const EXPENSE_CATEGORY_IDS = Object.freeze(EXPENSE_CATEGORIES.map((c) => c.id));

  function expenseCategoryLabel(id) {
    const found = EXPENSE_CATEGORIES.find((c) => c.id === id);
    return found ? found.label : id;
  }

  return { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_IDS, expenseCategoryLabel };
});
