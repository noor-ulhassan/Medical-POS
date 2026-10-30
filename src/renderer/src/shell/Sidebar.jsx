import { ShoppingCart, ReceiptText, Package, NotebookPen, ChartColumn, Settings, Lock, CircleHelp, TriangleAlert } from 'lucide-react';
import { useApp, VIEWS } from '../state/AppState.jsx';
import { cx } from '../ui/cx.js';

/*
 * Five sections instead of a long menu, like the POS apps people already know.
 * A section with several screens shows them as tabs at the top (SectionTabs).
 * Screens keep their ids (posView, salesView...), so `go(id)` works as before.
 */
export const SECTIONS = [
  { id: 'sell', label: 'Sell', icon: ShoppingCart, views: [{ id: 'posView', label: 'Sell' }] },
  {
    id: 'sales',
    label: 'Sales',
    icon: ReceiptText,
    views: [
      { id: 'salesView', label: 'Past sales' },
      { id: 'quotationView', label: 'Price quote' }
    ]
  },
  {
    id: 'stock',
    label: 'Stock',
    icon: Package,
    views: [
      { id: 'inventoryView', label: 'Medicines', badge: 'lowStock' },
      { id: 'expiryView', label: 'Expiring', badge: 'expiring' },
      { id: 'ordersView', label: 'Reorder' },
      { id: 'suppliersView', label: 'Suppliers' }
    ]
  },
  { id: 'khata', label: 'Khata', icon: NotebookPen, views: [{ id: 'khataView', label: 'Khata' }] },
  {
    id: 'reports',
    label: 'Reports',
    icon: ChartColumn,
    views: [
      { id: 'dashboardView', label: 'Today' },
      { id: 'profitView', label: 'Profit & loss' },
      { id: 'expensesView', label: 'Expenses' }
    ]
  }
];

const BADGE_TITLES = {
  lowStock: (n) => `${n} medicines are running low`,
  expiring: (n) => `${n} medicines expire within 6 months (or have expired)`
};

const permissionOf = (viewId) => VIEWS.find((v) => v.id === viewId).permission;

/** The screens of each section this user may open. */
function useSections() {
  const { can } = useApp();
  return SECTIONS.map((s) => ({ ...s, views: s.views.filter((v) => can(permissionOf(v.id))) })).filter((s) => s.views.length > 0);
}

function RailButton({ icon: Icon, label, active, dot, className, ...props }) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex w-[76px] shrink-0 flex-col items-center gap-1 rounded-panel py-2 text-sm font-semibold transition-colors [@media(max-height:620px)]:py-1',
        active ? 'bg-teal-soft text-teal-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink',
        className
      )}
      {...props}
    >
      <span className="relative">
        <Icon className="size-6" aria-hidden="true" strokeWidth={active ? 2.25 : 2} />
        {dot && <span className="absolute -right-1.5 -top-1 size-2.5 rounded-full bg-amber ring-2 ring-surface" aria-hidden="true" />}
      </span>
      {label}
    </button>
  );
}

export function Sidebar({ onLock, onHelp, onMe }) {
  const { user, view, go, can, alerts, saveProblem } = useApp();
  const sections = useSections();
  const needsAttention = alerts.lowStock > 0 || alerts.expiring > 0;

  return (
    <aside id="appSidebar" className="flex h-full w-[92px] shrink-0 flex-col items-center border-r border-foil bg-surface py-3">
      <img src="./icon.png" alt="" className="mb-2 size-10 shrink-0 rounded-panel object-cover [@media(max-height:620px)]:hidden" />
      <nav className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-none" aria-label="Main">
        {sections.map((s) => {
          const active = s.views.some((v) => v.id === view);
          return (
            <RailButton
              key={s.id}
              icon={s.icon}
              label={s.label}
              active={active}
              dot={s.id === 'stock' && needsAttention}
              title={s.id === 'stock' && needsAttention ? 'Some medicines are running low or expiring' : undefined}
              className="nav-item"
              data-target={s.views[0].id}
              data-views={s.views.map((v) => v.id).join(' ')}
              onClick={() => go(s.views[0].id)}
            />
          );
        })}
      </nav>
      <div className="flex shrink-0 flex-col items-center gap-1 pt-2">
        {saveProblem && (
          <span id="saveStatus" role="status" title={saveProblem} className="mb-1 flex w-[76px] flex-col items-center gap-1 rounded-panel bg-red-soft py-2 text-xs font-bold text-red-ink">
            <TriangleAlert className="size-5" aria-hidden="true" />
            Not saved
          </span>
        )}
        <RailButton icon={CircleHelp} label="Help" id="btnHelp" title="How do I…?" onClick={onHelp} />
        {can('settings.manage') && (
          <RailButton
            icon={Settings}
            label="Settings"
            active={view === 'settingsView'}
            className="nav-item"
            data-target="settingsView"
            data-views="settingsView"
            onClick={() => go('settingsView')}
          />
        )}
        <button
          type="button"
          id="btnUserMenu"
          onClick={onMe}
          title={`${user?.name} (${user?.role}): PIN, text size, dark mode`}
          className="flex w-[76px] flex-col items-center gap-1 rounded-panel py-2 text-sm font-semibold text-ink-2 hover:bg-sunken hover:text-ink [@media(max-height:620px)]:py-1"
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-teal text-sm font-bold text-teal-on" id="userAvatar">
            {user ? user.name.charAt(0).toUpperCase() : '?'}
          </span>
          <span className="max-w-full truncate px-1 text-xs" id="userName">
            {user?.name.split(' ')[0]}
          </span>
        </button>
        <RailButton icon={Lock} label="Lock" id="lockPinBtn" title="Lock the till (F12)" onClick={onLock} />
      </div>
    </aside>
  );
}

/** Tabs for the screens of the current section; nothing for a one-screen section. */
export function SectionTabs() {
  const { view, go, alerts } = useApp();
  const section = useSections().find((s) => s.views.some((v) => v.id === view));
  if (!section || section.views.length < 2) return null;
  return (
    <div role="tablist" aria-label={section.label} className="flex shrink-0 items-center gap-1.5 border-b border-foil bg-surface px-6 py-2.5">
      {section.views.map((v) => {
        const active = v.id === view;
        const count = v.badge ? alerts[v.badge] : 0;
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-tab={v.id}
            onClick={() => go(v.id)}
            className={cx(
              'flex h-10 items-center gap-2 rounded-full px-4 text-base font-semibold transition-colors',
              active ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-sunken hover:text-ink'
            )}
          >
            {v.label}
            {count > 0 && (
              <span
                id={v.badge === 'lowStock' ? 'lowStockCountBadge' : 'expiryCountBadge'}
                title={BADGE_TITLES[v.badge](count)}
                className={cx(
                  'num rounded-full px-1.5 text-xs font-bold leading-5',
                  v.badge === 'expiring' ? 'bg-red-soft text-red-ink' : 'bg-amber-soft text-amber-ink'
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
}
