import { useEffect, useRef, useState } from 'react';
import { Banknote, CreditCard, Smartphone, NotebookPen, Check, CircleAlert } from 'lucide-react';
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

const METHODS = [
  { value: 'CASH', label: 'Cash', icon: Banknote },
  { value: 'CARD', label: 'Card', icon: CreditCard },
  { value: 'MOBILE WALLET', label: 'Mobile wallet', icon: Smartphone },
  { value: 'CREDIT', label: 'Khata', icon: NotebookPen }
];

const QUICK_CASH = [500, 1000, 5000];

export function PaymentDialog() {
  const { customerById, loadProducts, loadCustomers, refreshAlerts } = useApp();
  const cart = useCart();
  const { toast, guard } = useToast();
  const confirm = useConfirm();
  const { showReceipt } = useDocuments();
  const [method, setMethod] = useState('CASH');
  const [paid, setPaid] = useState('');
  const [busy, setBusy] = useState(false);
  const paidRef = useRef(null);
  const total = cart.totals.totalCents;
  const customer = customerById(cart.customerId);
  const open = cart.paymentOpen;

  // Each time the dialog opens, default to the exact amount (selected, ready to overtype).
  useEffect(() => {
    if (!open) return undefined;
    setPaid(centsToInput(total));
    const t = setTimeout(() => paidRef.current?.select(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const paidCents = toCents(paid);
  const change = method === 'CASH' && !Number.isNaN(paidCents) && paidCents >= total ? paidCents - total : 0;
  const short = method === 'CASH' && !Number.isNaN(paidCents) && paidCents > 0 && paidCents < total ? total - paidCents : 0;
  const walkInCredit = method === 'CREDIT' && cart.customerId === WALK_IN_ID;

  const submit = guard(async () => {
    if (busy || cart.itemCount === 0) return;
    if (method === 'CREDIT' && cart.customerId === WALK_IN_ID) {
      toast('Walk-in customers cannot buy on khata. Choose a registered customer first.', 'error');
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
    setBusy(true);
    try {
      const sale = await call('sales.checkout', {
        lines: cart.lines.map(({ productId, unitType, quantity }) => ({ productId, unitType, quantity })),
        customerId: cart.customerId,
        paymentMethod: method,
        paidCents: method === 'CASH' && !Number.isNaN(paidCents) ? paidCents : null,
        discount: cart.discount,
        prescriptionPath: cart.prescriptionPath
      });
      cart.setPaymentOpen(false);
      cart.clear();
      showReceipt(sale);
      await Promise.all([loadProducts(), loadCustomers()]);
      refreshAlerts();
    } finally {
      setBusy(false);
    }
  });

  cart.confirmPaymentRef.current = submit;

  const balanceAfter = customer ? customer.current_debt_cents + total : 0;

  return (
    <Modal open={open} onClose={() => cart.setPaymentOpen(false)} title="Take payment" id="modalCheckoutPayment" size="md">
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
                    className={cx(
                      'flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-panel border text-sm font-semibold transition-colors',
                      on ? 'border-teal bg-teal-soft text-teal-ink ring-1 ring-teal' : 'border-foil-strong text-ink-2 hover:border-ink-3 hover:text-ink'
                    )}
                  >
                    <input type="radio" name="paymentMethod" value={m.value} checked={on} onChange={() => setMethod(m.value)} className="sr-only" />
                    <Icon className="size-5" aria-hidden="true" />
                    {m.label}
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
              <div className="flex gap-2">
                <button type="button" data-cash="exact" onClick={() => setPaid(centsToInput(total))} className="h-8 rounded-full border border-foil-strong px-3.5 text-sm font-semibold text-ink-2 hover:border-teal hover:text-teal-ink">
                  Exact amount
                </button>
                {QUICK_CASH.map((n) => (
                  <button
                    key={n}
                    type="button"
                    data-cash={n}
                    onClick={() => setPaid(n.toFixed(2))}
                    className="num h-8 rounded-full border border-foil-strong px-3.5 text-sm font-semibold text-ink-2 hover:border-teal hover:text-teal-ink"
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
                <div className="rounded-panel bg-sunken px-4 py-3 text-sm text-ink-2">
                  <span className="num">{money(total)}</span> will be added to {customer.name}'s khata. Balance after this sale:{' '}
                  <strong className={cx('num', balanceAfter > customer.credit_limit_cents ? 'text-red-ink' : 'text-ink')}>{money(balanceAfter)}</strong> of{' '}
                  <span className="num">{money(customer.credit_limit_cents)}</span> limit.
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
          <Button type="submit" variant="primary" size="lg" icon={Check} id="btnConfirmCheckout" disabled={busy}>
            Complete sale
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
