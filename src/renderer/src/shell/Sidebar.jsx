import { Lock, CircleHelp, TriangleAlert, Settings } from 'lucide-react';
import { useApp, VIEWS } from '../state/AppState.jsx';
import { cx } from '../ui/cx.js';
import { SECTIONS } from './sections.js';

const BADGE_TITLES = {
  lowStock: (n) => `${n} medicines are running low`,
  expiring: (n) => `${n} medicines expire within 6 months (or have expired)`
};

const permissionOf = (viewId) => VIEWS.find((v) => v.id === viewId).permission;

/** The screens of each section this user may open. */
export function useSections() {
  const { can } = useApp();
  return SECTIONS.map((s) => ({ ...s, views: s.views.filter((v) => can(permissionOf(v.id))) })).filter((s) => s.views.length > 0);
}

/** A rail button. With a tone its icon wears that colour; without one it stays plain (Help, Lock). */
function RailButton({ icon: Icon, label, active, dot, tone, className, ...props }) {
  return (
    <button
      type="button"
      data-tone={tone}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'group relative flex w-[76px] shrink-0 flex-col items-center gap-1 rounded-panel py-2 text-sm font-semibold transition-colors [@media(max-height:620px)]:py-1',
        active ? 'bg-accent text-accent-on shadow-pop' : 'text-rail-ink-2 hover:bg-rail-ink/10 hover:text-rail-ink',
        className
      )}
      {...props}
    >
      <span className="relative">
        <Icon className={cx('size-6', !active && tone && 'text-accent-glow')} aria-hidden="true" strokeWidth={active ? 2.25 : 2} />
        {dot && <span className="absolute -right-1.5 -top-1 size-2.5 rounded-full bg-amber ring-2 ring-rail" aria-hidden="true" />}
      </span>
      {label}
    </button>
  );
}

export function Sidebar({ onLock, onHelp, onMe }) {
  const { user, view, go, can, alerts, saveProblem } = useApp();
  const sections = useSections().filter((s) => s.id !== 'settings');
  const needsAttention = alerts.lowStock > 0 || alerts.expiring > 0;

  return (
    <aside id="appSidebar" className="flex h-full w-[92px] shrink-0 flex-col items-center bg-rail py-3">
      <img src="./icon.png" alt="" className="mb-2 size-10 shrink-0 rounded-panel object-cover [@media(max-height:620px)]:hidden" />
      <nav className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-none" aria-label="Main">
        {sections.map((s) => {
          const active = s.views.some((v) => v.id === view);
          return (
            <RailButton
              key={s.id}
              icon={s.icon}
              label={s.label}
              tone={s.tone}
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
            tone={6}
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
          className="flex w-[76px] flex-col items-center gap-1 rounded-panel py-2 text-sm font-semibold text-rail-ink-2 hover:bg-rail-ink/10 hover:text-rail-ink [@media(max-height:620px)]:py-1"
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-rail-ink text-sm font-bold text-rail" id="userAvatar">
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
    <div role="tablist" aria-label={section.label} data-tone={section.tone} className="flex shrink-0 items-center gap-1.5 border-b border-foil bg-surface px-6 py-2.5">
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
              active ? 'bg-accent text-accent-on' : 'text-ink-2 hover:bg-accent-soft hover:text-accent-ink'
            )}
          >
            <v.icon className="size-[18px]" aria-hidden="true" />
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
