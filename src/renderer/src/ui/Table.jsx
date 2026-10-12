import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from './cx.js';
import { IconButton } from './Button.jsx';

/*
 * Data table primitives. Numeric columns use `num` (right-aligned,
 * tabular figures); the header stays visible while the body scrolls.
 */
export function Table({ className, children, maxHeight }) {
  return (
    <div className={cx('overflow-auto', className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-separate border-spacing-0 text-base">{children}</table>
    </div>
  );
}

export function Th({ num, className, children }) {
  return (
    <th
      scope="col"
      className={cx(
        'sticky top-0 z-[1] whitespace-nowrap border-b border-foil bg-sunken px-4 py-2.5 text-left text-xs font-semibold text-ink-2',
        num && 'text-right',
        className
      )}
    >
      {children}
    </th>
  );
}

export function Td({ num, muted, className, children, ...props }) {
  return (
    <td
      className={cx('border-b border-foil px-4 py-3 align-middle', num && 'num whitespace-nowrap text-right', muted && 'text-ink-2', className)}
      {...props}
    >
      {children}
    </td>
  );
}

export function Tr({ tone, className, children, ...props }) {
  return (
    <tr
      className={cx(
        'transition-colors hover:bg-sunken/70 [&:last-child>td]:border-b-0',
        tone === 'danger' && 'bg-red-soft/40',
        tone === 'warn' && 'bg-amber-soft/40',
        tone === 'muted' && 'text-ink-3',
        className
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export function EmptyRow({ colSpan, children }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-base text-ink-3">
        {children}
      </td>
    </tr>
  );
}

/** Row actions: kept quiet until the row is hovered or focused. */
export function RowActions({ children }) {
  return <div className="flex items-center justify-end gap-0.5">{children}</div>;
}

export function Pagination({ page, pageSize, total, noun, onChange }) {
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between border-t border-foil px-4 py-2.5 text-sm text-ink-2">
      <span className="num">
        {total === 0 ? `No ${noun}` : `${first}–${last} of ${total} ${noun}`}
      </span>
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronLeft} label="Previous page" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)} />
        <span className="num min-w-[72px] text-center font-semibold text-ink">
          {page} / {maxPage}
        </span>
        <IconButton icon={ChevronRight} label="Next page" size="sm" disabled={page >= maxPage} onClick={() => onChange(page + 1)} />
      </div>
    </div>
  );
}

export function paginate(items, page, pageSize) {
  const maxPage = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(page, 1), maxPage);
  return { page: current, rows: items.slice((current - 1) * pageSize, current * pageSize) };
}
