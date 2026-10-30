import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import permissions from '@shared/permissions.js';
import { call } from '../lib/api.js';

/**
 * Session, navigation and the read-mostly data cached from the main
 * process. The main process is the source of truth; loaders are called
 * again after every write.
 */
const AppStateContext = createContext(null);

/** Screens in sidebar order, with the permission each one needs. */
export const VIEWS = [
  { id: 'posView', permission: 'pos.sell' },
  { id: 'salesView', permission: 'sales.view' },
  { id: 'quotationView', permission: 'quotes.create' },
  { id: 'inventoryView', permission: 'products.view' },
  { id: 'expiryView', permission: 'products.view' },
  { id: 'ordersView', permission: 'restock.view' },
  { id: 'suppliersView', permission: 'catalog.manage' },
  { id: 'khataView', permission: 'customers.view' },
  { id: 'dashboardView', permission: 'reports.view' },
  { id: 'profitView', permission: 'reports.view' },
  { id: 'expensesView', permission: 'expenses.manage' },
  { id: 'settingsView', permission: 'settings.manage' }
];

export function AppStateProvider({ children }) {
  const [user, setUser] = useState(null);
  const [appInfo, setAppInfo] = useState({});
  const [settings, setSettings] = useState({});
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [alerts, setAlerts] = useState({ lowStock: 0, expiring: 0 });
  const [view, setView] = useState('posView');
  const [saveProblem, setSaveProblem] = useState(null);
  const userRef = useRef(null);
  userRef.current = user;

  const can = useCallback((permission) => Boolean(user) && permissions.can(user.role, permission), [user]);

  const loadAppInfo = useCallback(async () => setAppInfo(await call('app.info')), []);
  const loadSettings = useCallback(async () => setSettings(await call('settings.get')), []);
  const loadProducts = useCallback(async () => setProducts(await call('products.list')), []);
  const loadCatalog = useCallback(async () => {
    const [cats, sups] = await Promise.all([call('catalog.categories'), call('catalog.suppliers')]);
    setCategories(cats);
    setSuppliers(sups);
  }, []);
  const loadCustomers = useCallback(async () => {
    const u = userRef.current;
    if (u && permissions.can(u.role, 'customers.view')) setCustomers(await call('customers.list'));
  }, []);
  const refreshAlerts = useCallback(async () => {
    const u = userRef.current;
    if (!u || !permissions.can(u.role, 'products.view')) return;
    try {
      setAlerts(await call('reports.alerts'));
    } catch (err) {
      console.error('Could not refresh alert badges', err);
    }
  }, []);

  /** Everything the current user is allowed to see. */
  const loadAll = useCallback(async () => {
    await Promise.all([loadSettings(), loadProducts(), loadCatalog(), loadCustomers()]);
    await refreshAlerts();
  }, [loadSettings, loadProducts, loadCatalog, loadCustomers, refreshAlerts]);

  /** Navigate, falling back to the first screen this user may open. */
  const go = useCallback((id) => {
    const u = userRef.current;
    if (!u) return;
    const allowed = (v) => permissions.can(u.role, v.permission);
    const target = VIEWS.find((v) => v.id === id && allowed(v)) || VIEWS.find(allowed);
    if (target) setView(target.id);
  }, []);

  const value = useMemo(
    () => ({
      user,
      setUser,
      appInfo,
      settings,
      products,
      categories,
      suppliers,
      customers,
      alerts,
      view,
      saveProblem,
      setSaveProblem,
      can,
      go,
      loadAppInfo,
      loadSettings,
      loadProducts,
      loadCatalog,
      loadCustomers,
      refreshAlerts,
      loadAll,
      productById: (id) => products.find((p) => p.id === Number(id)),
      customerById: (id) => customers.find((c) => c.id === Number(id))
    }),
    [user, appInfo, settings, products, categories, suppliers, customers, alerts, view, saveProblem, can, go, loadAppInfo, loadSettings, loadProducts, loadCatalog, loadCustomers, refreshAlerts, loadAll]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useApp() {
  return useContext(AppStateContext);
}
