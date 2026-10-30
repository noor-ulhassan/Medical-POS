import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './Button.jsx';
import { cx } from './cx.js';
import { IconTile } from './display.jsx';

/*
 * Dialog stack: Escape closes only the topmost dialog (unless it is locked),
 * focus stays inside the topmost dialog, and focus returns to where it was
 * when the dialog closes.
 */
const stack = [];

function topEntry() {
  return stack[stack.length - 1];
}

if (typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (e) => {
      const top = topEntry();
      if (!top) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!top.locked.current) top.onClose.current();
      } else if (e.key === 'Tab') {
        trapFocus(e, top.panel.current);
      }
    },
    true
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(e, panel) {
  if (!panel) return;
  const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (!panel.contains(document.activeElement)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function isAnyModalOpen() {
  return stack.length > 0;
}

const SIZES = { sm: 'max-w-[440px]', md: 'max-w-[540px]', lg: 'max-w-[720px]', xl: 'max-w-[900px]', receipt: 'max-w-[420px]' };

/**
 * <Modal open onClose title id size locked initialFocus>
 *   ...<ModalBody/> <ModalFooter/>
 */
export function Modal({ open, onClose, title, description, icon, tone, id, size = 'md', locked = false, initialFocus, role = 'dialog', children }) {
  const panel = useRef(null);
  const onCloseRef = useRef(onClose);
  const lockedRef = useRef(locked);
  onCloseRef.current = onClose;
  lockedRef.current = locked;

  useEffect(() => {
    if (!open) return undefined;
    const entry = { panel, onClose: onCloseRef, locked: lockedRef };
    const previous = document.activeElement;
    stack.push(entry);

    const focusTimer = setTimeout(() => {
      const target =
        (initialFocus && initialFocus.current) ||
        panel.current?.querySelector('input:not([type="hidden"]):not([readonly]):not([disabled]), select:not([disabled]), textarea:not([disabled])') ||
        panel.current?.querySelector('[data-autofocus]') ||
        panel.current;
      if (target) target.focus();
    }, 30);

    return () => {
      clearTimeout(focusTimer);
      const index = stack.indexOf(entry);
      if (index > -1) stack.splice(index, 1);
      if (previous && document.contains(previous) && typeof previous.focus === 'function') previous.focus();
    };
    // initialFocus is read once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const titleId = id ? `${id}-title` : undefined;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--shadow)/0.45)] p-6 animate-fade-in" data-modal-overlay>
      <div
        ref={panel}
        id={id}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx('flex max-h-full w-full flex-col overflow-hidden rounded-dialog bg-surface shadow-dialog outline-none animate-dialog-in', SIZES[size])}
      >
        <header className="flex items-start justify-between gap-4 border-b border-foil px-6 pb-4 pt-5">
          <div className="flex min-w-0 items-center gap-3">
            {icon && <IconTile icon={icon} tone={tone} />}
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-bold text-ink">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-ink-2">{description}</p>}
            </div>
          </div>
          {!locked && <IconButton icon={X} label="Close" size="sm" onClick={onClose} className="-mr-2 -mt-1" />}
        </header>
        {children}
      </div>
    </div>,
    document.body
  );
}

export function ModalBody({ className, children }) {
  return <div className={cx('flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5', className)}>{children}</div>;
}

export function ModalFooter({ className, children }) {
  return <footer className={cx('flex items-center justify-end gap-2 border-t border-foil bg-sunken/60 px-6 py-3.5', className)}>{children}</footer>;
}
