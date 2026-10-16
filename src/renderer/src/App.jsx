import { useCallback, useEffect, useState } from 'react';
import { call, onSessionProblem } from './lib/api.js';
import { useApp } from './state/AppState.jsx';
import { useCart } from './state/Cart.jsx';
import { useToast } from './ui/Toast.jsx';
import { isAnyModalOpen } from './ui/Modal.jsx';
import { Sidebar } from './shell/Sidebar.jsx';
import { HelpDialog } from './shell/HelpDialog.jsx';
import { StartupScreen } from './shell/StartupScreen.jsx';
import { LockScreen } from './features/auth/LockScreen.jsx';
import { ChangePinDialog } from './features/auth/ChangePinDialog.jsx';
import { PosView } from './features/pos/PosView.jsx';
import { PaymentDialog } from './features/pos/PaymentDialog.jsx';
import { DashboardView } from './features/dashboard/DashboardView.jsx';
import { ProductsView } from './features/products/ProductsView.jsx';
import { SuppliersView } from './features/catalog/Catalog.jsx';
import { KhataView } from './features/khata/KhataView.jsx';
import { RestockView } from './features/stock/RestockView.jsx';
import { ExpiryView } from './features/stock/ExpiryView.jsx';
import { QuotationView } from './features/quotes/QuotationView.jsx';
import { SalesView } from './features/sales/SalesView.jsx';
import { SettingsView } from './features/settings/SettingsView.jsx';

const SCREENS = {
  posView: PosView,
  dashboardView: DashboardView,
  inventoryView: ProductsView,
  suppliersView: SuppliersView,
  khataView: KhataView,
  ordersView: RestockView,
  expiryView: ExpiryView,
  quotationView: QuotationView,
  salesView: SalesView,
  settingsView: SettingsView
};

function readPreference(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function writePreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    /* preferences are optional */
  }
}

function initialTheme() {
  const saved = readPreference('noorpos_theme', null);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Enter in a form field moves to the next field; on the last field the form submits as usual. */
function moveToNextField(e) {
  const field = e.target;
  if (!(field instanceof HTMLInputElement) || !field.form) return;
  if (['submit', 'button', 'file', 'checkbox', 'radio'].includes(field.type)) return;
  const fields = [...field.form.elements].filter(
    (el) =>
      (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) &&
      el.type !== 'hidden' && el.type !== 'radio' && !el.disabled && !el.readOnly && el.offsetParent !== null
  );
  const index = fields.indexOf(field);
  if (index > -1 && index < fields.length - 1) {
    e.preventDefault();
    fields[index + 1].focus();
  }
}

export function App() {
  const app = useApp();
  const cart = useCart();
  const { toast, guard } = useToast();
  const { user, setUser, view, go, loadAll, loadAppInfo, loadSettings, setSaveProblem } = app;
  const [booted, setBooted] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const [collapsed, setCollapsed] = useState(() => readPreference('noorpos_sidebar_collapsed', String(window.innerWidth < 1280)) === 'true');
  const [pinDialog, setPinDialog] = useState(null); // null | { forced }
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.title = app.settings.store_name ? `${app.settings.store_name} POS` : 'Noor Pharmacy POS';
  }, [app.settings.store_name]);

  const lock = useCallback(() => {
    setUser(null);
    setPinDialog(null);
    cart.setPaymentOpen(false);
    guard(() => call('auth.logout'))();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setUser, guard]);

  const unlocked = useCallback(
    async (u) => {
      setUser(u);
      await loadAll();
      go('posView');
    },
    [setUser, loadAll, go]
  );

  /** Called by the lock screen (and on boot) with the session user. */
  const acceptSession = useCallback(
    async (u) => {
      if (u.mustChangePin) {
        setUser(u);
        setPinDialog({ forced: true });
        return;
      }
      await unlocked(u);
    },
    [setUser, unlocked]
  );

  // Boot: app info, store name for the lock screen, and an existing session (e.g. after a reload).
  useEffect(() => {
    guard(async () => {
      await Promise.all([loadAppInfo(), loadSettings()]);
      const existing = await call('auth.session');
      if (existing) await acceptSession(existing);
    })().finally(() => {
      setBooted(true);
      document.body.dataset.ready = 'true';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      onSessionProblem((code) => {
        if (code === 'PIN_CHANGE_REQUIRED') setPinDialog({ forced: true });
        else setUser(null);
      }),
    [setUser]
  );

  useEffect(() => {
    if (!window.noorpos.onWarning) return undefined;
    return window.noorpos.onWarning(({ message }) => {
      setSaveProblem(message);
      toast(message, 'error', { sticky: true });
    });
  }, [setSaveProblem, toast]);

  // Keyboard-first operation for barcode scanners and fast cashiers.
  const ready = Boolean(user) && !user.mustChangePin;
  useEffect(() => {
    if (!ready) return undefined;
    const focusLater = (id) => setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.focus();
        if (el.select) el.select();
      }
    }, 60);
    const onKey = (e) => {
      switch (e.key) {
        case 'F1':
          e.preventDefault();
          go('posView');
          focusLater('posSearchInput');
          return;
        case 'F2':
          e.preventDefault();
          if (cart.paymentOpen) cart.confirmPaymentRef.current?.();
          else if (!isAnyModalOpen()) {
            go('posView');
            if (cart.itemCount === 0) toast('Add at least one item before charging', 'error');
            else cart.setPaymentOpen(true);
          }
          return;
        case 'F3':
          e.preventDefault();
          if (isAnyModalOpen()) return;
          go('posView');
          focusLater('cartDiscountInput');
          return;
        case 'F4':
          e.preventDefault();
          if (isAnyModalOpen()) return;
          go('posView');
          focusLater('cartCustomerSelect');
          return;
        case 'F12':
          e.preventDefault();
          lock();
          return;
        case 'Enter':
          moveToNextField(e);
          return;
        default:
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ready, go, cart, toast, lock]);

  if (!booted) return <StartupScreen />;

  const Screen = SCREENS[view] || PosView;

  return (
    <>
      {ready ? (
        <div className="flex h-full">
          <Sidebar
            collapsed={collapsed}
            onToggleCollapsed={() => {
              setCollapsed((c) => {
                writePreference('noorpos_sidebar_collapsed', String(!c));
                return !c;
              });
            }}
            theme={theme}
            onToggleTheme={() => {
              const next = theme === 'dark' ? 'light' : 'dark';
              setTheme(next);
              writePreference('noorpos_theme', next);
            }}
            onLock={lock}
            onChangePin={() => setPinDialog({ forced: false })}
            onHelp={() => setHelpOpen(true)}
          />
          <main className="min-w-0 flex-1 overflow-hidden">
            <Screen key={view} />
          </main>
          <PaymentDialog />
          <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
        </div>
      ) : (
        !user && <LockScreen onSession={acceptSession} />
      )}
      {user && user.mustChangePin && <div className="start-backdrop h-full" />}
      <ChangePinDialog
        open={Boolean(pinDialog) && Boolean(user)}
        forced={Boolean(pinDialog?.forced)}
        onClose={() => setPinDialog(null)}
        onLock={lock}
        onChanged={async (u, forced) => {
          setPinDialog(null);
          if (forced) await unlocked(u);
          else setUser(u);
        }}
      />
    </>
  );
}
