import { forwardRef } from 'react';
import { cx } from './cx.js';

const VARIANTS = {
  primary: 'bg-teal text-teal-on hover:bg-teal-hover border border-transparent shadow-sm',
  secondary: 'bg-surface text-ink border border-foil-strong hover:bg-sunken hover:border-ink-3',
  ghost: 'text-ink-2 border border-transparent hover:bg-sunken hover:text-ink',
  danger: 'bg-red text-red-on hover:bg-red-hover border border-transparent shadow-sm',
  'danger-ghost': 'text-red-ink border border-transparent hover:bg-red-soft'
};

const SIZES = {
  sm: 'h-9 px-3 text-sm gap-1.5 [&_svg]:size-4',
  md: 'h-11 px-4 text-base gap-2 [&_svg]:size-5',
  lg: 'h-12 px-5 text-md gap-2 [&_svg]:size-5'
};

export const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, block, className, type = 'button', children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-control font-semibold transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className
      )}
      {...props}
    >
      {Icon && <Icon aria-hidden="true" strokeWidth={2} />}
      {children}
    </button>
  );
});

/** Icon-only button. `label` is required: it becomes the tooltip and the accessible name. */
export const IconButton = forwardRef(function IconButton(
  { icon: Icon, label, size = 'md', tone = 'default', className, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      title={label}
      aria-label={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-control transition-colors disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'size-9 [&_svg]:size-[18px]' : 'size-11 [&_svg]:size-5',
        tone === 'danger' ? 'text-ink-3 hover:bg-red-soft hover:text-red-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink',
        className
      )}
      {...props}
    >
      <Icon aria-hidden="true" strokeWidth={2} />
    </button>
  );
});

/** Full-width labelled action, for the list of things you can do in a detail window. */
export function ActionButton({ icon: Icon, tone = 'default', children, ...props }) {
  return (
    <button
      type="button"
      className={cx(
        'flex h-12 w-full items-center gap-3 rounded-control px-4 text-left text-base font-semibold transition-colors',
        tone === 'primary' && 'bg-teal text-teal-on hover:bg-teal-hover',
        tone === 'danger' && 'text-red-ink ring-1 ring-red/30 hover:bg-red-soft',
        tone === 'default' && 'bg-sunken text-ink hover:bg-foil'
      )}
      {...props}
    >
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      {children}
    </button>
  );
}
