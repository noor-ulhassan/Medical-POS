'use strict';

const v = require('../lib/validate');
const { validationError } = require('../lib/errors');

/**
 * Every operation the renderer may perform. There is deliberately no way to
 * send SQL from the UI.
 *
 * Route options:
 *   public            - callable while locked (no session)
 *   permission        - required permission (see shared/permissions.js)
 *   allowPinChange    - callable while the user must still change their PIN
 *
 * Handlers receive (payload, { user, ctx }).
 */
function createRoutes(ctx, platform) {
  const s = () => ctx.services;

  return {
    // --- session -------------------------------------------------------
    'auth.login': {
      public: true,
      handler: (p) => {
        const user = s().auth.login(p);
        ctx.session.user = user;
        return user;
      }
    },
    'auth.logout': {
      public: true,
      handler: () => {
        ctx.session.user = null;
        return true;
      }
    },
    'auth.session': { public: true, handler: () => ctx.session.user },
    'auth.changeOwnPin': {
      allowPinChange: true,
      handler: (p, { user }) => {
        const updated = s().auth.changeOwnPin(user, p);
        ctx.session.user = updated;
        return updated;
      }
    },

    // --- app / settings ------------------------------------------------
    'app.info': { public: true, handler: () => ({ ...platform.appInfo(), firstRun: s().auth.isFirstRun() }) },
    'settings.get': { public: true, handler: () => s().settings.get() },
    'settings.update': { permission: 'settings.manage', handler: (p, { user }) => s().settings.update(user, p) },
    'app.print': { handler: () => platform.print() },

    // --- users ---------------------------------------------------------
    'users.list': { permission: 'users.manage', handler: () => s().auth.listUsers() },
    'users.create': { permission: 'users.manage', handler: (p, { user }) => s().auth.createUser(user, p) },
    'users.update': { permission: 'users.manage', handler: (p, { user }) => s().auth.updateUser(user, p) },
    'users.resetPin': { permission: 'users.manage', handler: (p, { user }) => s().auth.resetUserPin(user, p) },
    'audit.list': { permission: 'users.manage', handler: (p) => s().audit.list(v.object(p)) },

    // --- catalog -------------------------------------------------------
    'catalog.categories': { permission: 'products.view', handler: () => s().catalog.listCategories() },
    'catalog.suppliers': { permission: 'products.view', handler: () => s().catalog.listSuppliers() },
    'catalog.saveCategory': { permission: 'catalog.manage', handler: (p, { user }) => s().catalog.saveCategory(user, p) },
    'catalog.saveSupplier': { permission: 'catalog.manage', handler: (p, { user }) => s().catalog.saveSupplier(user, p) },

    // --- products ------------------------------------------------------
    'products.list': { permission: 'products.view', handler: () => s().products.list() },
    'products.save': { permission: 'products.manage', handler: (p, { user }) => s().products.save(user, p) },
    'products.remove': { permission: 'products.manage', handler: (p, { user }) => s().products.remove(user, p) },
    'products.generateBarcode': { permission: 'products.manage', handler: () => s().products.generateBarcode() },
    'products.discardStock': { permission: 'stock.adjust', handler: (p, { user }) => s().products.discardStock(user, p) },
    'products.stockHistory': { permission: 'products.view', handler: (p) => s().products.stockHistory(p) },

    // --- customers -----------------------------------------------------
    'customers.list': { permission: 'customers.view', handler: () => s().customers.list() },
    'customers.save': { permission: 'customers.manage', handler: (p, { user }) => s().customers.save(user, p) },
    'customers.recordPayment': { permission: 'customers.payment', handler: (p, { user }) => s().customers.recordPayment(user, p) },
    'customers.ledger': { permission: 'customers.view', handler: (p) => s().customers.ledger(p) },

    // --- sales ---------------------------------------------------------
    'sales.quote': { permission: 'pos.sell', handler: (p) => s().sales.quote(p) },
    'sales.checkout': { permission: 'pos.sell', handler: (p, { user }) => s().sales.checkout(user, p) },
    'sales.list': { permission: 'sales.view', handler: (p) => s().sales.list(p) },
    'sales.get': { permission: 'sales.view', handler: (p) => s().sales.get(p) },
    'sales.void': { permission: 'sales.void', handler: (p, { user }) => s().sales.void(user, p) },
    'sales.attachPrescription': { permission: 'sales.attachRx', handler: (p, { user }) => s().sales.attachPrescription(user, p) },
    'sales.getPrescription': { permission: 'sales.view', handler: (p) => s().sales.getPrescription(p) },
    'files.savePrescription': { permission: 'pos.sell', handler: (p) => s().files.savePrescription(p) },

    // --- parked carts --------------------------------------------------
    'parked.list': { permission: 'pos.sell', handler: () => s().parked.list() },
    'parked.park': { permission: 'pos.sell', handler: (p, { user }) => s().parked.park(user, p) },
    'parked.resume': { permission: 'pos.sell', handler: (p) => s().parked.resume(p) },

    // --- reports -------------------------------------------------------
    'reports.dashboard': { permission: 'reports.view', handler: () => s().reports.dashboard() },
    'reports.alerts': { permission: 'products.view', handler: () => s().reports.alertCounts() },
    'reports.expiry': { permission: 'products.view', handler: () => s().reports.expiry() },

    // --- system --------------------------------------------------------
    'system.backup': {
      permission: 'backup.manage',
      handler: () => {
        const { filePath } = ctx.backup.create('manual');
        return { filePath };
      }
    },
    'system.listBackups': { permission: 'backup.manage', handler: () => ctx.backup.list() },
    'system.restore': {
      permission: 'backup.manage',
      handler: async (p, { user }) => {
        const filePath = await platform.pickBackupFile(ctx.paths.backupsDir);
        if (!filePath) return { cancelled: true };
        return ctx.restoreFrom(user, filePath);
      }
    },
    'system.factoryReset': {
      permission: 'system.reset',
      handler: (p, { user }) => {
        if (v.object(p).confirm !== 'RESET') throw validationError('Type RESET to confirm');
        return ctx.factoryReset(user);
      }
    },
    'system.openDataFolder': { permission: 'backup.manage', handler: () => platform.openFolder(ctx.paths.dataDir) }
  };
}

module.exports = { createRoutes };
