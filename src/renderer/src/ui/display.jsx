import { cx } from './cx.js';
import { expiryStatus, shortDate } from '../lib/format.js';
import { useApp } from '../state/AppState.jsx';
import { viewMeta } from '../shell/sections.js';

const PILL_TONES = {
  neutral: 'bg-sunken text-ink-2 border-foil',
  teal: 'bg-teal-soft text-teal-ink border-transparent',
  amber: 'bg-amber-soft text-amber-ink border-transparent',
  red: 'bg-red-soft text-red-ink border-transparent'
};

export function Pill({ tone = 'neutral', className, children, ...props }) {
  return (
    <span
      className={cx('inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-sm font-semibold', PILL_TONES[tone], className)}
      {...props}
    >
      {children}
    </span>
  );
}

/** "Rx" marker for prescription-only medicines. */
export function RxPill() {
  return (
    <Pill tone="amber" title="Prescription required" className="h-5 px-1.5 text-xs">
      Rx
    </Pill>
  );
}

/** Expiry date coloured by urgency. */
export function ExpiryPill({ date, compact = false }) {
  const { level, days } = expiryStatus(date);
  if (level === 'none') return <span className="text-sm text-ink-3">No expiry</span>;
  const label = shortDate(date);
  if (level === 'ok') return <span className="num whitespace-nowrap text-sm text-ink-2">{label}</span>;
  if (level === 'expired')
    return (
      <Pill tone="red" title={`Expired ${label}`}>
        {compact ? 'Expired' : `Expired ${label}`}
      </Pill>
    );
  return (
    <Pill tone={level === 'urgent' ? 'red' : 'amber'} title={`${days} days left`} className="num">
      {label}
    </Pill>
  );
}

export function EmptyState({ icon: Icon, title, children, action, className }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      {Icon && (
        <div className="mb-1 flex size-11 items-center justify-center rounded-full bg-sunken text-ink-3">
          <Icon className="size-5" aria-hidden="true" />
        </div>
      )}
      {title && <p className="text-md font-semibold text-ink">{title}</p>}
      {children && <p className="max-w-[46ch] text-sm text-ink-2">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Scrollable page body with consistent gutters. */
export function Page({ id, children }) {
  return (
    <div id={id} className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-5 px-7 pb-10 pt-6">{children}</div>
    </div>
  );
}

/** Search box used in page toolbars. */
export function SearchInput({ id, value, onChange, placeholder, icon: Icon, className }) {
  return (
    <label className={cx('flex h-11 min-w-[300px] items-center gap-2.5 rounded-control border border-foil-strong bg-surface px-3.5 transition-colors focus-within:border-teal focus-within:ring-2 focus-within:ring-teal/25', className)}>
      {Icon && <Icon className="size-5 shrink-0 text-ink-3" aria-hidden="true" />}
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
      />
    </label>
  );
}

/** One labelled value in a detail window. */
export function Fact({ label, className, children }) {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-md font-semibold text-ink">{children}</dd>
    </div>
  );
}

/** A rounded tile holding an icon, in the tone around it, the one given, or plain grey for `tone={null}`. */
export function IconTile({ icon: Icon, tone, size = 'md', className }) {
  return (
    <span
      data-tone={tone || undefined}
      className={cx(
        'flex shrink-0 items-center justify-center',
        tone === null ? 'bg-sunken text-ink-2' : 'bg-accent-soft text-accent-ink',
        size === 'lg' ? 'size-12 rounded-panel [&>svg]:size-6' : size === 'sm' ? 'size-8 rounded-control [&>svg]:size-4' : 'size-10 rounded-control [&>svg]:size-5',
        className
      )}
      aria-hidden="true"
    >
      <Icon strokeWidth={2} />
    </span>
  );
}

/** Page title with the screen's icon in its section's tone, so every screen says where you are. */
export function PageHeader({ title, description, actions }) {
  const { view } = useApp();
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <IconTile icon={viewMeta(view).icon} size="lg" />
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-[-0.01em] text-ink">{title}</h1>
          {description && <p className="mt-0.5 text-base text-ink-2">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, actions, flush = false, tone, className, children }) {
  return (
    <section className={cx('min-w-0 rounded-panel border bg-surface shadow-card', tone === 'danger' ? 'border-red/40' : 'border-foil', className)}>
      {(title || actions) && (
        <div className={cx('flex min-h-[52px] items-center justify-between gap-3 px-5', flush ? 'border-b border-foil' : 'pt-4')}>
          {title && <h2 className="text-md font-bold text-ink">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

/** Pressed-state button group (filters, unit switch). */
export function Segmented({ options, value, onChange, size = 'md', label, className }) {
  return (
    <div role="group" aria-label={label} className={cx('inline-flex shrink-0 rounded-control border border-foil-strong bg-sunken p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'whitespace-nowrap rounded-[4px] font-semibold transition-colors',
            size === 'xs' ? 'h-8 px-2.5 text-sm' : size === 'sm' ? 'h-9 px-3 text-sm' : 'h-10 px-3.5 text-base',
            value === o.value ? 'bg-surface text-ink shadow-sm ring-1 ring-foil' : 'text-ink-2 hover:text-ink'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-foil">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            '-mb-px border-b-2 px-3.5 pb-2.5 pt-1 text-base font-semibold transition-colors',
            value === t.value ? 'border-teal text-teal-ink' : 'border-transparent text-ink-2 hover:text-ink'
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
