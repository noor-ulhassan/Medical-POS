import { useState } from 'react';
import { call } from '../../lib/api.js';
import { useCart } from '../../state/Cart.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { useConfirm } from '../../ui/Confirm.jsx';
import { Modal, ModalBody } from '../../ui/Modal.jsx';
import { Button } from '../../ui/Button.jsx';
import { money, dateTime, plural } from '../../lib/format.js';
import { Catalog } from './Catalog.jsx';
import { Cart } from './Cart.jsx';

export function PosView() {
  const cart = useCart();
  const { toast, guard } = useToast();
  const confirm = useConfirm();
  const [held, setHeld] = useState(null);

  const openCheckout = () => {
    if (cart.itemCount === 0) {
      toast('Add at least one item before charging', 'error');
      return;
    }
    cart.setPaymentOpen(true);
  };

  const hold = guard(async () => {
    if (cart.itemCount === 0) {
      toast('There is nothing to hold yet', 'error');
      return;
    }
    const { tabKey } = await call('parked.park', {
      lines: cart.saleLines,
      customerId: cart.customerId,
      totalCents: cart.totals.totalCents,
      discount: cart.discount,
      prescriptionPath: cart.prescriptionPath
    });
    cart.clear();
    toast(`Sale put on hold (${tabKey}). Open "Held sales" to finish it later.`);
  });

  const showHeld = guard(async () => {
    const list = await call('parked.list');
    if (list.length === 0) {
      toast('No sales are on hold', 'warning');
      return;
    }
    setHeld(list);
  });

  const resume = guard(async (id) => {
    if (cart.itemCount > 0 && !(await confirm({ title: 'Replace the current sale?', message: 'The items in the current sale will be removed.', confirmText: 'Replace' }))) return;
    const parked = await call('parked.resume', { id });
    setHeld(null);
    cart.clear();
    cart.restoreDiscount(parked.discount);
    const { skipped } = cart.load(parked.lines, parked.customerId);
    if (parked.prescriptionPath) cart.setPrescriptionPath(parked.prescriptionPath);
    if (skipped) toast(`${skipped} item(s) could not be restored (removed or out of stock)`, 'warning');
  });

  return (
    <div className="flex h-full min-w-0" id="posView">
      <Catalog />
      <Cart onCheckout={openCheckout} onHold={hold} onShowHeld={showHeld} />

      <Modal open={Boolean(held)} onClose={() => setHeld(null)} title="Held sales" description="Pick up where you left off." id="modalParkedTabs" size="sm">
        <ModalBody className="gap-2">
          <div id="parkedList" className="flex flex-col gap-2">
            {held?.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-panel border border-foil px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">
                    {p.customer_name || 'Walk-in Customer'} <span className="font-normal text-ink-3">· {plural(p.item_count || 0, 'item')}</span>
                  </div>
                  <div className="num text-sm text-ink-3">
                    {money(p.total_cents)}, held {dateTime(p.created_at)}
                    {p.cashier_name ? ` by ${p.cashier_name}` : ''}
                  </div>
                </div>
                <Button size="sm" variant="primary" data-resume={p.id} onClick={() => resume(p.id)}>
                  Resume
                </Button>
              </div>
            ))}
          </div>
        </ModalBody>
      </Modal>
    </div>
  );
}
