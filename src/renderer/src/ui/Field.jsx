import { forwardRef, useId, cloneElement, isValidElement, Children } from 'react';
import { cx } from './cx.js';

/**
 * Label + control + help text. The single child control receives the
 * generated id so the label is always correctly associated.
 */
export function Field({ label, help, hint, className, children }) {
  const id = useId();
  const child = Children.only(children);
  // Wrapper elements (e.g. an input + button group) keep their own markup.
  const isControl = isValidElement(child) && typeof child.type !== 'string';
  const controlId = isControl ? child.props.id || id : undefined;
  const control = isControl ? cloneElement(child, { id: controlId, 'aria-describedby': help ? `${id}-help` : undefined }) : child;
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={controlId} className="flex items-center gap-1.5 text-sm font-semibold text-ink-2">
          {label}
          {hint}
        </label>
      )}
      {control}
      {help && (
        <p id={`${id}-help`} className="text-xs text-ink-3">
          {help}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, numeric, ...props }, ref) {
  return <input ref={ref} className={cx('control', numeric && 'num text-right', className)} {...props} />;
});

export const Select = forwardRef(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cx('control', className)} {...props}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cx('control resize-none', className)} {...props} />;
});

export function Checkbox({ label, className, ...props }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2.5 text-base text-ink', className)}>
      <input type="checkbox" className="size-4 cursor-pointer rounded accent-[rgb(var(--teal))]" {...props} />
      <span>{label}</span>
    </label>
  );
}

/** Group of fields with a quiet heading, used to break long forms into parts. */
export function Fieldset({ legend, className, children }) {
  return (
    <fieldset className={cx('min-w-0 border-t border-foil pt-4 first:border-t-0 first:pt-0', className)}>
      <legend className="mb-3 text-sm font-bold text-ink">{legend}</legend>
      {children}
    </fieldset>
  );
}
