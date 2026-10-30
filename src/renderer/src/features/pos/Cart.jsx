import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Trash2, X, Minus, Plus, ScanBarcode, Percent, FileImage, Pause, CircleCheck } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { useCart, WALK_IN_ID } from '../../state/Cart.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { useConfirm } from '../../ui/Confirm.jsx';
import { Button, IconButton } from '../../ui/Button.jsx';
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
      className="num h-10 w-14 bg-transparent text-center text-lg font-bold text-ink outline-none focus:bg-teal-soft"
    />
  );
}

/** For a khata customer: what they owe and how much more they can buy on khata. */
function CreditStatus({ customer }) {
  if (!customer || customer.id === WALK_IN_ID) return null;
  const available = customer.credit_limit_cents - customer.current_debt_cents;
  return (
    <p id="customerCreditAlert" className="num mt-1.5 px-1 text-sm text-ink-2">
      Owes <strong className="text-ink">{money(customer.current_debt_cents)}</strong>. Can buy{' '}
      <strong className={available < 0 ? 'text-red-ink' : 'text-teal-ink'}>{money(Math.max(available, 0))}</strong> more on khata.
    </p>
  );
}

function ActionButton({ icon: Icon, active, warn, className, children, ...props }) {
  return (
    <button
      type="button"
      className={cx(
        'flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-control px-3 text-sm font-semibold transition-colors',
        active ? 'bg-teal-soft text-teal-ink ring-1 ring-teal/40' : warn ? 'bg-amber-soft text-amber-ink ring-1 ring-amber/40' : 'bg-sunken text-ink hover:bg-foil',
        className
      )}
      {...props}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden="true" />
      <span className="truncate">{children}</span>
    </button>
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
  const showDiscount = cart.discountOpen || totals.discountCents > 0 || cart.discountNeedsManager;
  const needsRx = cart.priced.some((l) => l.product.is_prescription_required);
  const showBreakdown = totals.discountCents > 0 || totals.taxCents > 0;

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

  const toggleDiscount = () => {
    if (totals.discountCents > 0 || !cart.discountOpen) {
      cart.setDiscountOpen(true);
      setTimeout(() => document.getElementById('cartDiscountInput')?.select(), 30);
    } else {
      cart.setDiscountOpen(false);
    }
  };

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-foil bg-surface 2xl:w-[420px]" aria-label="Current sale">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
          Sale
          <span id="cartItemCountBadge" className="num rounded-full bg-sunken px-2.5 text-sm font-bold leading-6 text-ink-2">
            {cart.itemCount}
          </span>
        </h2>
        <div className="ml-auto flex items-center">
          <Button size="sm" variant="ghost" icon={FolderOpen} id="btnViewParked" onClick={onShowHeld}>
            Held
          </Button>
          <Button size="sm" variant="ghost" icon={Trash2} id="btnClearCart" onClick={clear} className="hover:!bg-red-soft hover:!text-red-ink">
            Clear
          </Button>
        </div>
      </div>

      <div className="shrink-0 px-4 pb-3 pt-2">
        <select
          id="cartCustomerSelect"
          aria-label="Customer"
          value={String(cart.customerId)}
          onChange={(e) => cart.setCustomerId(Number(e.target.value))}
          className="control !h-12 !rounded-full !pl-5 text-md font-semibold"
        >
          {customers.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.id === WALK_IN_ID ? 'Walk-in customer' : `${c.name} (khata, owes ${money(c.current_debt_cents)})`}
            </option>
          ))}
        </select>
        <CreditStatus customer={customerById(cart.customerId)} />
      </div>

      <div id="cartItemsList" className="min-h-0 flex-1 overflow-y-auto border-t border-foil">
        {empty ? (
          <EmptyState icon={ScanBarcode} title="Nothing in the sale yet" className="h-full">
            Scan the box, or tap Add next to a medicine.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-foil">
            {cart.priced.map((line, index) => (
              <li key={`${line.productId}-${line.unitType}`} className="cart-item px-4 py-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-md font-bold leading-snug text-ink" title={line.product.title}>
                      {line.product.title}
                    </div>
                    <div className="num text-sm text-ink-3">
                      {money(line.priceCents)} per {line.unitType === 'PACK' ? `pack of ${line.product.pack_size}` : 'unit'}
                    </div>
                  </div>
                  <div className="num pt-0.5 text-md font-bold text-ink">{money(line.priceCents * line.quantity)}</div>
                  <IconButton icon={X} label={`Remove ${line.product.title}`} size="sm" tone="danger" data-cart-action="remove" onClick={() => cart.remove(index)} className="-mr-2 -mt-1" />
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex items-center rounded-full border border-foil-strong">
                    <button type="button" data-cart-action="dec" aria-label="One less" onClick={() => cart.changeQuantity(index, -1)} className="flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-sunken hover:text-ink">
                      <Minus className="size-4" aria-hidden="true" />
                    </button>
                    <QuantityInput line={line} index={index} onCommit={cart.setQuantity} />
                    <button type="button" data-cart-action="inc" aria-label="One more" onClick={() => cart.changeQuantity(index, 1)} className="flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-sunken hover:text-ink">
                      <Plus className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  {line.product.pack_size > 1 && (
                    <Segmented
                      size="sm"
                      label="Sell by"
                      value={line.unitType}
                      onChange={(unit) => cart.setUnitType(index, unit)}
                      options={[
                        { value: 'SINGLE', label: 'Unit' },
                        { value: 'PACK', label: 'Pack' }
                      ]}
                      className="ml-auto"
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 space-y-2.5 border-t border-foil px-4 py-3">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2">
          <ActionButton icon={Percent} id="btnDiscount" active={totals.discountCents > 0} aria-expanded={showDiscount} onClick={toggleDiscount}>
            Discount
          </ActionButton>
          <input ref={fileRef} type="file" accept={PRESCRIPTION_FILE_TYPES} className="hidden" id="prescriptionFileInput" onChange={attach} />
          <ActionButton
            icon={cart.prescriptionPath ? CircleCheck : FileImage}
            id="btnAttachPrescription"
            active={Boolean(cart.prescriptionPath)}
            warn={needsRx && !cart.prescriptionPath}
            title={cart.prescriptionPath ? 'Prescription photo added. Tap to replace it.' : 'Add a photo of the prescription'}
            onClick={() => fileRef.current?.click()}
          >
            <span id="prescriptionStatusTag">{cart.prescriptionPath ? 'Rx added' : 'Prescription'}</span>
          </ActionButton>
          <ActionButton icon={Pause} id="btnParkOrder" title="Keep this sale for later and start a new one" onClick={onHold}>
            Hold
          </ActionButton>
        </div>

        {showDiscount && (
          <div className="flex items-center gap-2">
            <label htmlFor="cartDiscountInput" className="shrink-0 text-base font-semibold text-ink-2">
              Discount
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
                className="control num min-w-0 !rounded-r-none text-right"
              />
              <select
                id="cartDiscountType"
                aria-label="Discount in rupees or percent"
                value={cart.discountType}
                onChange={(e) => cart.setDiscountType(e.target.value)}
                className="control -ml-px !w-[70px] shrink-0 !rounded-l-none"
              >
                <option value="FLAT">Rs</option>
                <option value="PERCENT">%</option>
              </select>
            </div>
          </div>
        )}
        {cart.discountNeedsManager && (
          <p id="discountLimitNote" className="rounded-control bg-red-soft px-3 py-2 text-sm font-semibold text-red-ink">
            A cashier can give up to {cart.discountLimitPercent}% discount. Lower it, or let a manager complete this sale.
          </p>
        )}

        {showBreakdown && (
          <dl className="space-y-0.5 text-base">
            <div className="flex justify-between text-ink-2">
              <dt>Subtotal</dt>
              <dd className="num text-ink" id="summarySubtotal">
                {money(totals.subtotalCents)}
              </dd>
            </div>
            {totals.discountCents > 0 && (
              <div className="flex justify-between text-ink-2">
                <dt>Discount</dt>
                <dd className="num text-teal-ink">-{money(totals.discountCents)}</dd>
              </div>
            )}
            {totals.taxCents > 0 && (
              <div className="flex justify-between text-ink-2">
                <dt>Tax and fee</dt>
                <dd className="num text-ink" id="summaryTax">
                  {money(totals.taxCents)}
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <button
        type="button"
        id="btnOpenCheckoutModal"
        onClick={onCheckout}
        disabled={empty}
        className={cx(
          'mx-4 mb-4 flex h-[68px] shrink-0 items-center justify-between rounded-panel px-5 text-left shadow-sm transition-colors focus-visible:outline-offset-2',
          empty ? 'cursor-not-allowed bg-sunken text-ink-3 shadow-none' : 'bg-teal text-teal-on hover:bg-teal-hover'
        )}
      >
        <span className="text-xl font-bold">Charge</span>
        <span className="num text-2xl font-bold tracking-[-0.01em]" id="summaryTotal">
          {money(totals.totalCents)}
        </span>
      </button>
    </aside>
  );
}
