import {
  ShoppingCart,
  ReceiptText,
  FileText,
  Package,
  CalendarClock,
  ClipboardList,
  Truck,
  NotebookPen,
  ChartColumn,
  Settings,
  Lock,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Database,
  TriangleAlert,
  CircleHelp,
  TrendingUp,
  Wallet
} from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { TEXT_SIZES } from '../lib/prefs.js';
import { cx } from '../ui/cx.js';

const GROUPS = [
  {
    label: 'Counter',
    items: [
      { id: 'posView', label: 'Sell', icon: ShoppingCart, permission: 'pos.sell', kbd: 'F1' },
      { id: 'salesView', label: 'Past sales', icon: ReceiptText, permission: 'sales.view' },
      { id: 'quotationView', label: 'Price quotation', icon: FileText, permission: 'quotes.create' }
    ]
  },
  {
    label: 'Stock',
    items: [
      { id: 'inventoryView', label: 'Medicines & stock', icon: Package, permission: 'products.view', badge: 'lowStock' },
      { id: 'expiryView', label: 'Expiring soon', icon: CalendarClock, permission: 'products.view', badge: 'expiring' },
      { id: 'ordersView', label: 'Order from supplier', icon: ClipboardList, permission: 'restock.view' },
      { id: 'suppliersView', label: 'Suppliers', icon: Truck, permission: 'catalog.manage' }
    ]
  },
  {
    label: 'Customers',
    items: [{ id: 'khataView', label: 'Khata (credit)', icon: NotebookPen, permission: 'customers.view' }]
  },
  {
    label: 'Store',
    items: [
      { id: 'dashboardView', label: "Today's report", icon: ChartColumn, permission: 'reports.view' },
      { id: 'profitView', label: 'Profit & loss', icon: TrendingUp, permission: 'reports.view' },
      { id: 'expensesView', label: 'Expenses', icon: Wallet, permission: 'expenses.manage' },
      { id: 'settingsView', label: 'Settings', icon: Settings, permission: 'settings.manage' }
    ]
  }
];

const BADGE_TITLES = {
  lowStock: (n) => `${n} medicines are running low`,
  expiring: (n) => `${n} medicines expire within 6 months (or have expired)`
};

export function Sidebar({ collapsed, onToggleCollapsed, theme, onToggleTheme, onLock, onChangePin, onHelp, textSize, onCycleTextSize }) {
  const sizeIndex = Math.max(TEXT_SIZES.findIndex((t) => t.value === textSize), 0);
  const nextSize = TEXT_SIZES[(sizeIndex + 1) % TEXT_SIZES.length];
  const { user, settings, view, go, can, alerts, saveProblem } = useApp();

  return (
    <aside
      id="appSidebar"
      className={cx('flex h-full shrink-0 flex-col border-r border-foil bg-surface transition-[width] duration-150', collapsed ? 'w-[68px]' : 'w-[236px]')}
    >
      <div className={cx('flex h-14 shrink-0 items-center gap-3 border-b border-foil', collapsed ? 'justify-center px-0' : 'px-4')}>
        <img src="./icon.png" alt="" className="size-8 shrink-0 rounded-lg object-cover" />
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-md font-bold leading-tight text-ink" id="displayStoreName">
              {settings.store_name || 'Noor Pharmacy POS'}
            </div>
            <div className="truncate text-xs text-ink-3" id="displayStoreSub">
              {settings.store_address || 'Pharmacy point of sale'}
            </div>
          </div>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-2" aria-label="Main">
        {GROUPS.map((group) => {
          const items = group.items.filter((i) => can(i.permission));
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="mb-1.5">
              {!collapsed ? (
                <div className="px-2.5 pb-0.5 pt-2 text-xs font-semibold text-ink-3">{group.label}</div>
              ) : (
                <div className="mx-3 my-2 border-t border-foil" />
              )}
              {items.map((item) => {
                const active = view === item.id;
                const count = item.badge ? alerts[item.badge] : 0;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-target={item.id}
                    onClick={() => go(item.id)}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'nav-item relative flex h-9 w-full items-center gap-3 rounded-control text-base font-semibold transition-colors',
                      collapsed ? 'justify-center' : 'px-2.5',
                      active ? 'bg-teal-soft text-teal-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink'
                    )}
                  >
                    {active && <span className="absolute -left-3 top-1.5 h-5 w-[3px] rounded-r bg-teal" aria-hidden="true" />}
                    <Icon className={cx('size-[18px] shrink-0', active ? 'text-teal' : '')} aria-hidden="true" />
                    {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
                    {!collapsed && item.kbd && !count && <kbd>{item.kbd}</kbd>}
                    {count > 0 && (
                      <span
                        id={item.badge === 'lowStock' ? 'lowStockCountBadge' : 'expiryCountBadge'}
                        title={BADGE_TITLES[item.badge](count)}
                        className={cx(
                          'num rounded-full px-1.5 text-xs font-bold leading-[18px]',
                          item.badge === 'expiring' ? 'bg-red-soft text-red-ink' : 'bg-amber-soft text-amber-ink',
                          collapsed && 'absolute right-1 top-0.5 min-w-[18px] text-center text-[10px]'
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-foil p-2.5">
        <button
          type="button"
          id="btnHelp"
          onClick={onHelp}
          title="How do I…?"
          className={cx(
            'mb-1.5 flex h-9 w-full items-center gap-3 rounded-control bg-amber-soft text-base font-semibold text-amber-ink hover:brightness-95',
            collapsed ? 'justify-center' : 'px-2.5'
          )}
        >
          <CircleHelp className="size-[18px] shrink-0" aria-hidden="true" />
          {!collapsed && <span className="flex-1 text-left">Help: how do I…?</span>}
        </button>
        <button
          type="button"
          id="btnUserMenu"
          onClick={onChangePin}
          title="Change my PIN"
          className={cx('flex w-full items-center gap-2.5 rounded-control p-1 text-left hover:bg-sunken', collapsed && 'justify-center')}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-teal text-sm font-bold text-teal-on" id="userAvatar">
            {user ? user.name.charAt(0).toUpperCase() : '?'}
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold text-ink" id="userName">
                {user?.name}
              </span>
              <span className="block truncate text-xs text-ink-3" id="userRole">
                {user?.role}
              </span>
            </span>
          )}
        </button>

        <div className={cx('mt-1.5 flex items-center gap-1', collapsed && 'flex-col')}>
          <button
            type="button"
            id="lockPinBtn"
            onClick={onLock}
            title="Lock (F12)"
            className={cx(
              'flex h-8 items-center justify-center gap-2 rounded-control border border-foil-strong text-sm font-semibold text-ink hover:bg-sunken',
              collapsed ? 'w-9' : 'flex-1'
            )}
          >
            <Lock className="size-4" aria-hidden="true" />
            {!collapsed && (
              <>
                Lock <kbd>F12</kbd>
              </>
            )}
          </button>
          <span
            id="saveStatus"
            role="status"
            title={saveProblem || 'Every change is saved on this computer as soon as you make it'}
            aria-label={saveProblem ? 'Not saved to disk' : 'Saved on this computer'}
            className={cx('flex size-8 shrink-0 items-center justify-center rounded-control', saveProblem ? 'bg-red-soft text-red-ink' : 'text-ink-3')}
          >
            {saveProblem ? <TriangleAlert className="size-4" aria-hidden="true" /> : <Database className="size-4" aria-hidden="true" />}
          </span>
          <button
            type="button"
            id="textSizeBtn"
            onClick={onCycleTextSize}
            title={`Text size: ${TEXT_SIZES[sizeIndex].label}. Click for ${nextSize.label.toLowerCase()} (or Ctrl + and Ctrl -)`}
            aria-label={`Text size ${TEXT_SIZES[sizeIndex].label}. Change to ${nextSize.label}`}
            className="flex h-8 min-w-8 items-center justify-center rounded-control px-1 text-ink-2 hover:bg-sunken hover:text-ink"
          >
            <span className="font-bold leading-none" style={{ fontSize: 12 + sizeIndex * 2 }} aria-hidden="true">
              Aa
            </span>
          </button>
          <button
            type="button"
            id="themeToggleBtn"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="flex size-8 items-center justify-center rounded-control text-ink-2 hover:bg-sunken hover:text-ink"
          >
            {theme === 'dark' ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
          </button>
          <button
            type="button"
            id="btnToggleSidebar"
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            className="flex size-8 items-center justify-center rounded-control text-ink-2 hover:bg-sunken hover:text-ink"
          >
            {collapsed ? <PanelLeftOpen className="size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
