import { useEffect, useRef, useState } from 'react';
import { Banknote, Check, CircleAlert } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { useCart, WALK_IN_ID } from '../../state/Cart.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { useConfirm } from '../../ui/Confirm.jsx';
import { useDocuments } from '../../print/Documents.jsx';
import { Modal, ModalBody, ModalFooter } from '../../ui/Modal.jsx';
import { Button } from '../../ui/Button.jsx';
import { money, toCents, centsToInput } from '../../lib/format.js';
import { cx } from '../../ui/cx.js';
import { readPrefs } from '../../lib/prefs.js';
import { PAYMENT_METHODS as METHODS } from '../../lib/look.js';



const NOTES = [10, 20, 50, 100, 500, 1000, 5000];

/** Amounts a customer is likely to hand over: the next few notes/round sums at or above the total (in rupees). */
function quickCashAmounts(totalCents) {
  const total = Math.ceil(totalCents / 100);
  const options = new Set();
  for (const step of [10, 50, 100, 500, 1000, 5000]) {
    const rounded = Math.ceil(total / step) * step;
    if (rounded > total) options.add(rounded);
  }
  for (const note of NOTES) if (note > total) options.add(note);
  return [...options].sort((a, b) => a - b).slice(0, 4);
}

export function PaymentDialog() {
  const { customerById, loadProducts, loadCustomers, refreshAlerts } = useApp();
  const cart = useCart();
  const { toast, guard } = useToast();
  const confirm = useConfirm();
  const { showReceipt } = useDocuments();
  const [method, setMethod] = useState('CASH');
  const [paid, setPaid] = useState('');
  const [busy, setBusy] = useState(false);
  // State updates are asynchronous, so a ref is what actually stops a double
  // Enter / held-down F2 from charging the same sale twice.
  const inFlight = useRef(false);
  const paidRef = useRef(null);
  const total = cart.totals.totalCents;
  const customer = customerById(cart.customerId);
  const open = cart.paymentOpen;

  // Each time the dialog opens: cash, exact amount (selected, ready to overtype).
  // The method must not carry over from the previous sale, or a cash sale
  // straight after a card sale would be recorded as card.
  useEffect(() => {
    if (!open) return undefined;
    setMethod('CASH');
    setPaid(centsToInput(total));
    const t = setTimeout(() => paidRef.current?.select(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const paidCents = toCents(paid);
  const change = method === 'CASH' && !Number.isNaN(paidCents) && paidCents >= total ? paidCents - total : 0;
  const short = method === 'CASH' && !Number.isNaN(paidCents) && paidCents > 0 && paidCents < total ? total - paidCents : 0;
  const walkInCredit = method === 'CREDIT' && cart.customerId === WALK_IN_ID;
  const overLimit = method === 'CREDIT' && !walkInCredit && customer && customer.current_debt_cents + total > customer.credit_limit_cents;

  const submit = guard(async () => {
    if (inFlight.current || busy || cart.itemCount === 0) return;
    if (method === 'CREDIT' && cart.customerId === WALK_IN_ID) {
      toast('Walk-in customers cannot buy on khata. Choose a registered customer first.', 'error');
      return;
    }
    if (short) {
      toast(`Cash received is ${money(short)} less than the amount due.`, 'error');
      paidRef.current?.select();
      return;
    }
    if (overLimit) {
      toast(`This sale would take ${customer.name} over their khata limit of ${money(customer.credit_limit_cents)}.`, 'error');
      return;
    }
    if (cart.discountNeedsManager) {
      toast(`A cashier can give up to ${cart.discountLimitPercent}% discount. Lower it, or press F12 and let a manager log in: the sale stays in the cart.`, 'error');
      return;
    }
    const needsRx = cart.priced.filter((l) => l.product.is_prescription_required);
    if (needsRx.length && !cart.prescriptionPath) {
      const proceed = await confirm({
        title: 'Prescription medicines',
        message: `These items need a prescription:\n${needsRx.map((l) => `• ${l.product.title}`).join('\n')}\n\nNo prescription image is attached. Continue anyway?`,
        confirmText: 'Continue sale'
      });
      if (!proceed) return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const sale = await call('sales.checkout', {
        lines: cart.saleLines,
        customerId: cart.customerId,
        paymentMethod: method,
        paidCents: method === 'CASH' && !Number.isNaN(paidCents) ? paidCents : null,
        discount: cart.discount,
        prescriptionPath: cart.prescriptionPath
      });
      cart.setPaymentOpen(false);
      cart.clear();
      showReceipt(sale, { autoPrint: readPrefs().autoPrintReceipt });
      await Promise.all([loadProducts(), loadCustomers()]);
      refreshAlerts();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  });

  cart.confirmPaymentRef.current = submit;

  const balanceAfter = customer ? customer.current_debt_cents + total : 0;

  return (
    <Modal open={open} onClose={() => cart.setPaymentOpen(false)} title="Take payment" icon={Banknote} id="modalCheckoutPayment" size="md">
      <form
        id="checkoutPaymentForm"
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ModalBody className="gap-5">
          <div className="flex items-baseline justify-between rounded-panel bg-sunken px-5 py-4">
            <span className="text-base font-semibold text-ink-2">Amount due</span>
            <span id="modalPayableTotalDisplay" className="num text-3xl font-bold tracking-[-0.02em] text-ink">
              {money(total)}
            </span>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink-2">Paid by</legend>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" id="paymentMethods">
              {METHODS.map((m) => {
                const Icon = m.icon;
                const on = method === m.value;
                return (
                  <label
                    key={m.value}
                    data-tone={m.tone}
                    className={cx(
                      'relative flex h-[84px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-panel border-2 text-sm font-semibold transition-colors focus-within:ring-2 focus-within:ring-accent/40',
                      on ? 'border-accent bg-accent-soft text-accent-ink' : 'border-foil text-ink-2 hover:border-accent/50 hover:bg-accent-soft/50'
                    )}
                  >
                    <input type="radio" name="paymentMethod" value={m.value} checked={on} onChange={() => setMethod(m.value)} className="sr-only" />
                    <span className={cx('flex size-9 items-center justify-center rounded-full', on ? 'bg-accent text-accent-on' : 'bg-accent-soft text-accent-ink')}>
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    {m.label}
                    {on && <Check className="absolute right-2 top-2 size-4 text-accent" strokeWidth={3} aria-hidden="true" />}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {method === 'CASH' && (
            <div id="tenderCashGroup" className="flex flex-col gap-2">
              <label htmlFor="cartPaidInput" className="text-sm font-semibold text-ink-2">
                Cash received
              </label>
              <input
                ref={paidRef}
                id="cartPaidInput"
                type="number"
                min="0"
                step="0.01"
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
                className="control num !h-12 text-right !text-xl font-bold"
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" data-cash="exact" onClick={() => setPaid(centsToInput(total))} className="h-9 rounded-full border border-foil-strong px-3.5 text-sm font-semibold text-ink-2 hover:border-teal hover:text-teal-ink">
                  Exact amount
                </button>
                {quickCashAmounts(total).map((n) => (
                  <button
                    key={n}
                    type="button"
                    data-cash={n}
                    onClick={() => setPaid(n.toFixed(2))}
                    className="num h-9 rounded-full border border-foil-strong px-3.5 text-sm font-semibold text-ink-2 hover:border-teal hover:text-teal-ink"
                  >
                    Rs {n.toLocaleString()}
                  </button>
                ))}
              </div>
              <div id="changeReturnRow" className={cx('mt-1 flex items-baseline justify-between rounded-panel px-5 py-3', short ? 'bg-red-soft' : 'bg-teal-soft')}>
                <span className={cx('text-base font-semibold', short ? 'text-red-ink' : 'text-teal-ink')}>{short ? 'Short by' : 'Change to give back'}</span>
                <span id="summaryChange" className={cx('num text-xl font-bold', short ? 'text-red-ink' : 'text-teal-ink')}>
                  {money(short || change)}
                </span>
              </div>
            </div>
          )}

          {method === 'CREDIT' &&
            (walkInCredit ? (
              <div className="flex gap-3 rounded-panel bg-red-soft px-4 py-3 text-sm text-red-ink">
                <CircleAlert className="size-5 shrink-0" aria-hidden="true" />
                <span>Walk-in customers cannot buy on khata. Close this and choose a registered customer.</span>
              </div>
            ) : (
              customer && (
                <div className={cx('rounded-panel px-4 py-3 text-sm', overLimit ? 'bg-red-soft text-red-ink' : 'bg-sunken text-ink-2')}>
                  <span className="num">{money(total)}</span> will be added to {customer.name}'s khata. Balance after this sale:{' '}
                  <strong className={cx('num', overLimit ? 'text-red-ink' : 'text-ink')}>{money(balanceAfter)}</strong> of{' '}
                  <span className="num">{money(customer.credit_limit_cents)}</span> limit.
                  {overLimit && <div className="mt-1 font-semibold">This is over the limit. Take part of it in cash, or raise the limit in Khata.</div>}
                </div>
              )
            ))}

          {(method === 'CARD' || method === 'MOBILE WALLET') && (
            <p className="rounded-panel bg-sunken px-4 py-3 text-sm text-ink-2">
              Charge <strong className="num text-ink">{money(total)}</strong> on the {method === 'CARD' ? 'card machine' : 'customer’s wallet app'}, then complete the sale.
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button onClick={() => cart.setPaymentOpen(false)}>Cancel</Button>
          <Button type="submit" variant="primary" size="lg" icon={Check} id="btnConfirmCheckout" disabled={busy || Boolean(short)}>
            {busy ? 'Saving…' : 'Complete sale'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
