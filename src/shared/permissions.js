/**
 * Role -> permission matrix. Enforced in the main process for every IPC call;
 * the renderer uses the same table only to hide controls the user cannot use.
 * Exposed to the renderer as window.MediDeskPermissions.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MediDeskPermissions = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROLES = Object.freeze(['Admin', 'Manager', 'Cashier']);

  const ALL = ROLES;
  const MANAGERS = ['Admin', 'Manager'];
  const ADMIN = ['Admin'];

  const PERMISSIONS = Object.freeze({
    'pos.sell': ALL,
    'sales.view': ALL,
    'sales.attachRx': ALL,
    'sales.void': MANAGERS,
    'products.view': ALL,
    'products.manage': MANAGERS,
    'stock.adjust': MANAGERS,
    'catalog.manage': MANAGERS,
    'customers.view': ALL,
    'customers.manage': MANAGERS,
    'customers.payment': MANAGERS,
    'reports.view': MANAGERS,
    'restock.view': MANAGERS,
    'quotes.create': ALL,
    'settings.manage': ADMIN,
    'users.manage': ADMIN,
    'backup.manage': ADMIN,
    'system.reset': ADMIN
  });

  function can(role, permission) {
    const allowed = PERMISSIONS[permission];
    if (!allowed) throw new Error(`Unknown permission: ${permission}`);
    return allowed.includes(role);
  }

  function permissionsFor(role) {
    return Object.keys(PERMISSIONS).filter((p) => PERMISSIONS[p].includes(role));
  }

  return { ROLES, PERMISSIONS, can, permissionsFor };
});
