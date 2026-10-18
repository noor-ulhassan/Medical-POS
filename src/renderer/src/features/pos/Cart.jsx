import { useEffect, useRef, useState } from 'react';
import { Pause, FolderOpen, Trash2, X, Minus, Plus, Camera, CircleCheck, ScanBarcode } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { useCart, WALK_IN_ID } from '../../state/Cart.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { useConfirm } from '../../ui/Confirm.jsx';
import { IconButton } from '../../ui/Button.jsx';
import { Select } from '../../ui/Field.jsx';
import { Segmented, EmptyState } from '../../ui/display.jsx';
import { money, readFileAsBase64, PRESCRIPTION_FILE_TYPES } from '../../lib/format.js';
import { cx } from '../../ui/cx.js';

/**
 * The quantity can be typed (30 tablets without 29 clicks). The typed value is
 * applied on Enter or when leaving the box; anything invalid goes back to the
 * current quantity.
 */
function QuantityInput({ line, index, onCommit }) {
  const [text, setText] = useState(String(line.quantity));
  useEffect(() => setText(String(line.quantity)), [line.quantity]);
  const commit = () => {
    const n = /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
    if (!onCommit(index, n)) setText(String(line.quantity));
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={`Quantity of ${line.product.title}`}
      data-cart-qty
      value={text}
      onChange={(e) => setText(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
          document.getElementById('posSearchInput')?.focus();
        } else if (e.key === 'Escape') {
          setText(String(line.quantity));
          e.currentTarget.blur();
        }
      }}
      className="num h-7 w-11 border-x border-foil-strong bg-surface text-center text-base font-bold text-ink outline-none focus:bg-teal-soft"
    />
  );
}

function CreditStatus({ customer }) {
  if (!customer) return null;
  if (customer.id === WALK_IN_ID) {
    return (
      <p id="customerCreditAlert" className="text-xs text-ink-3">
        Pays by cash, card or mobile wallet.
      </p>
    );
  }
  const available = customer.credit_limit_cents - customer.current_debt_cents;
  return (
    <dl id="customerCreditAlert" className="grid grid-cols-3 gap-2 text-xs">
      <div>
        <dt className="text-ink-3">Limit</dt>
        <dd className="num font-semibold text-ink">{money(customer.credit_limit_cents)}</dd>
      </div>
      <div>
        <dt className="text-ink-3">Owes</dt>
        <dd className="num font-semibold text-ink">{money(customer.current_debt_cents)}</dd>
      </div>
      <div>
        <dt className="text-ink-3">Available</dt>
        <dd className={cx('num font-semibold', available < 0 ? 'text-red-ink' : 'text-teal-ink')}>{money(available)}</dd>
      </div>
    </dl>
  );
}

export function Cart({ onCheckout, onHold, onShowHeld }) {
  const { customers, customerById } = useApp();
  const cart = useCart();
  const { guard } = useToast();
  const confirm = useConfirm();
  const fileRef = useRef(null);
  const { totals } = cart;
  const empty = cart.itemCount === 0;

  const clear = guard(async () => {
    if (!empty && !(await confirm({ title: 'Clear this sale?', message: 'All items will be removed from the sale.', confirmText: 'Clear sale', danger: true }))) return;
    cart.clear();
  });

  const attach = guard(async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const res = await call('files.savePrescription', { fileName: file.name, base64Data: await readFileAsBase64(file) });
    cart.setPrescriptionPath(res.relativePath);
  });

  return (
    <aside className="flex h-full w-[344px] shrink-0 flex-col border-l border-foil bg-surface 2xl:w-[400px]" aria-label="Current sale">
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-foil pl-4 pr-2">
        <h2 className="flex items-center gap-2 text-md font-bold text-ink">
          Current sale
          <span id="cartItemCountBadge" className="num rounded-full bg-sunken px-2 text-xs font-bold leading-5 text-ink-2">
            {cart.itemCount}
          </span>
        </h2>
        <div className="flex">
          <IconButton icon={Pause} label="Hold this sale" id="btnParkOrder" onClick={onHold} />
          <IconButton icon={FolderOpen} label="Held sales" id="btnViewParked" onClick={onShowHeld} />
          <IconButton icon={Trash2} label="Clear sale" id="btnClearCart" tone="danger" onClick={clear} />
        </div>
      </div>

      <div className="space-y-1.5 border-b border-foil px-4 py-3">
        <label htmlFor="cartCustomerSelect" className="flex items-center gap-1.5 text-sm font-semibold text-ink-2">
          Customer <kbd>F4</kbd>
        </label>
        <Select id="cartCustomerSelect" value={String(cart.customerId)} onChange={(e) => cart.setCustomerId(Number(e.target.value))}>
          {customers.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.id === WALK_IN_ID ? `${c.name} (cash only)` : `${c.name}, owes ${money(c.current_debt_cents)}`}
            </option>
          ))}
        </Select>
        <CreditStatus customer={customerById(cart.customerId)} />
      </div>

      <div id="cartItemsList" className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <EmptyState icon={ScanBarcode} title="No items yet" className="h-full">
            Scan a barcode or pick a medicine from the list to start a sale.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-foil">
            {cart.priced.map((line, index) => (
              <li key={`${line.productId}-${line.unitType}`} className="cart-item px-4 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-ink" title={line.product.title}>
                      {line.product.title}
                    </div>
                    <div className="num text-xs text-ink-3">
                      {money(line.priceCents)} per {line.unitType === 'PACK' ? `pack of ${line.product.pack_size}` : 'unit'}
                    </div>
                  </div>
                  <IconButton icon={X} label={`Remove ${line.product.title}`} size="sm" tone="danger" data-cart-action="remove" onClick={() => cart.remove(index)} className="-mr-1.5 -mt-1" />
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <Segmented
                    size="xs"
                    label="Sell by"
                    value={line.unitType}
                    onChange={(unit) => cart.setUnitType(index, unit)}
                    options={[
                      { value: 'SINGLE', label: 'Unit' },
                      { value: 'PACK', label: 'Pack' }
                    ]}
                  />
                  <div className="flex items-center rounded-control border border-foil-strong">
                    <button type="button" data-cart-action="dec" aria-label="One less" onClick={() => cart.changeQuantity(index, -1)} className="flex size-7 items-center justify-center text-ink-2 hover:bg-sunken hover:text-ink">
                      <Minus className="size-3.5" aria-hidden="true" />
                    </button>
                    <QuantityInput line={line} index={index} onCommit={cart.setQuantity} />
                    <button type="button" data-cart-action="inc" aria-label="One more" onClick={() => cart.changeQuantity(index, 1)} className="flex size-7 items-center justify-center text-ink-2 hover:bg-sunken hover:text-ink">
                      <Plus className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="num ml-auto text-md font-bold text-ink">{money(line.priceCents * line.quantity)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-foil px-4 py-3">
        <label htmlFor="cartDiscountInput" className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-ink-2">
          Discount <kbd>F3</kbd>
        </label>
        <div className="flex min-w-0 flex-1">
          <input
            id="cartDiscountInput"
            type="number"
            min="0"
            step="0.01"
            value={cart.discountInput}
            onChange={(e) => cart.setDiscountInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('btnOpenCheckoutModal')?.focus();
              }
            }}
            className="control num min-w-0 !rounded-r-none !px-2.5 text-right"
          />
          <select
            id="cartDiscountType"
            aria-label="Discount type"
            value={cart.discountType}
            onChange={(e) => cart.setDiscountType(e.target.value)}
            className="control -ml-px !w-[58px] shrink-0 !rounded-l-none !pl-2.5"
          >
            <option value="FLAT">Rs</option>
            <option value="PERCENT">%</option>
          </select>
        </div>
        <input ref={fileRef} type="file" accept={PRESCRIPTION_FILE_TYPES} className="hidden" id="prescriptionFileInput" onChange={attach} />
        <button
          type="button"
          id="btnAttachPrescription"
          onClick={() => fileRef.current?.click()}
          title={cart.prescriptionPath ? 'Prescription attached. Click to replace it.' : 'Attach a photo of the prescription'}
          className={cx(
            'flex h-9 shrink-0 items-center gap-1.5 rounded-control border px-2.5 text-sm font-semibold transition-colors',
            cart.prescriptionPath ? 'border-teal bg-teal-soft text-teal-ink' : 'border-foil-strong text-ink-2 hover:border-ink-3 hover:text-ink'
          )}
        >
          {cart.prescriptionPath ? <CircleCheck className="size-4" aria-hidden="true" /> : <Camera className="size-4" aria-hidden="true" />}
          <span id="prescriptionStatusTag">{cart.prescriptionPath ? 'Rx attached' : 'Rx'}</span>
        </button>
      </div>
      {cart.discountNeedsManager && (
        <p id="discountLimitNote" className="border-t border-foil bg-red-soft px-4 py-2 text-sm font-semibold text-red-ink">
          A cashier can give up to {cart.discountLimitPercent}% discount. Lower it, or let a manager complete this sale.
        </p>
      )}

      <dl className="space-y-0.5 border-t border-foil px-4 py-2.5 text-base">
        <div className="flex justify-between text-ink-2">
          <dt>Subtotal</dt>
          <dd className="num text-ink" id="summarySubtotal">{money(totals.subtotalCents)}</dd>
        </div>
        {totals.discountCents > 0 && (
          <div className="flex justify-between text-ink-2">
            <dt>Discount</dt>
            <dd className="num text-teal-ink">-{money(totals.discountCents)}</dd>
          </div>
        )}
        <div className="flex justify-between text-ink-2">
          <dt>Tax and fees</dt>
          <dd className="num text-ink" id="summaryTax">{money(totals.taxCents)}</dd>
        </div>
      </dl>

      <button
        type="button"
        id="btnOpenCheckoutModal"
        onClick={onCheckout}
        disabled={empty}
        className={cx(
          'group flex h-[68px] shrink-0 items-center justify-between px-4 text-left transition-colors focus-visible:outline-offset-[-4px]',
          empty ? 'cursor-not-allowed bg-sunken text-ink-3' : 'bg-teal text-teal-on hover:bg-teal-hover'
        )}
      >
        <span className="flex flex-col">
          <span className="text-md font-bold">Charge</span>
          <span className={cx('text-xs', empty ? 'text-ink-3' : 'text-teal-on/80')}>
            Press <kbd className={empty ? '' : '!border-teal-on/30 !bg-teal-on/15 !text-teal-on'}>F2</kbd>
          </span>
        </span>
        <span className="num text-2xl font-bold tracking-[-0.01em]" id="summaryTotal">
          {money(totals.totalCents)}
        </span>
      </button>
    </aside>
  );
}
