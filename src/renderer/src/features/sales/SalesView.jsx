import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Printer, RotateCcw, Ban, Eye, Camera, RefreshCw, ReceiptText, Info, Undo2 } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { useCart } from '../../state/Cart.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { useConfirm } from '../../ui/Confirm.jsx';
import { useDocuments } from '../../print/Documents.jsx';
import { Modal, ModalBody, ModalFooter } from '../../ui/Modal.jsx';
import { Button, IconButton } from '../../ui/Button.jsx';
import { Field, Textarea, Checkbox } from '../../ui/Field.jsx';
import { Page, PageHeader, SearchInput, Pill, EmptyState } from '../../ui/display.jsx';
import { Table, Th, Td, Tr, RowActions, Pagination } from '../../ui/Table.jsx';
import { money, dateTime, readFileAsBase64, PRESCRIPTION_FILE_TYPES } from '../../lib/format.js';

const PAGE_SIZE = 25;
const METHOD_LABELS = { CASH: 'Cash', CARD: 'Card', 'MOBILE WALLET': 'Mobile wallet', CREDIT: 'Khata' };

function VoidDialog({ sale, onClose, onVoided }) {
  const { toast, guard } = useToast();
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [sale]);

  const submit = guard(async (e) => {
    e.preventDefault();
    const voided = await call('sales.void', { id: sale.id, reason });
    onClose();
    toast(`Sale ${voided.invoice_no} cancelled. Items are back in stock.`);
    await onVoided();
  });

  // Tell the person at the counter exactly what happens to the money.
  const refund = !sale
    ? ''
    : sale.payment_method === 'CREDIT'
      ? `${money(sale.total_cents)} will be taken off ${sale.customer_name}'s khata.`
      : sale.payment_method === 'CASH'
        ? `Give ${money(sale.total_cents)} cash back to the customer.`
        : `Refund ${money(sale.total_cents)} to the customer (${METHOD_LABELS[sale.payment_method] || sale.payment_method}).`;

  return (
    <Modal
      open={Boolean(sale)}
      onClose={onClose}
      title={`Cancel sale ${sale?.invoice_no || ''}`}
      description="Use this when the whole sale was a mistake or everything comes back. For some of the items, use Return instead."
      id="modalVoidSale"
      size="sm"
    >
      <form id="voidForm" onSubmit={submit} className="contents">
        <ModalBody>
          {sale && (
            <div className="rounded-panel bg-amber-soft px-4 py-3 text-base font-semibold text-amber-ink">{refund}</div>
          )}
          <div className="flex gap-3 rounded-panel bg-sunken px-4 py-3 text-sm text-ink-2">
            <Info className="size-5 shrink-0 text-ink-3" aria-hidden="true" />
            <span>All the items go back into stock and the sale is marked as cancelled, with your name. This cannot be undone.</span>
          </div>
          <Field label="Why is this sale being cancelled?">
            <Textarea name="reason" rows={3} maxLength={250} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer returned the items" />
          </Field>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>Don't cancel</Button>
          <Button type="submit" variant="danger">
            Cancel this sale
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** What happens to the money when items come back, in the words of the counter. */
function refundText(sale, cents) {
  if (sale.payment_method === 'CREDIT') return `${money(cents)} will be taken off ${sale.customer_name}'s khata.`;
  if (sale.payment_method === 'CASH') return `Give ${money(cents)} cash back to the customer.`;
  return `Refund ${money(cents)} to the customer (${METHOD_LABELS[sale.payment_method] || sale.payment_method}).`;
}

/** A customer brings back some of what they bought: choose how many of each line. */
function ReturnDialog({ saleId, onClose, onReturned }) {
  const { toast, guard } = useToast();
  const { showReceipt } = useDocuments();
  const [sale, setSale] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [quote, setQuote] = useState(null);

  useEffect(() => {
    setSale(null);
    setQuantities({});
    setReason('');
    setRestock(true);
    setQuote(null);
    if (saleId) guard(async () => setSale(await call('sales.get', { id: saleId })))();
  }, [saleId, guard]);

  const lines = sale
    ? sale.items.map((i) => ({ saleItemId: i.id, quantity: Math.max(0, Math.trunc(Number(quantities[i.id]) || 0)) })).filter((l) => l.quantity > 0)
    : [];
  const linesKey = JSON.stringify(lines);

  // The refund is worked out by the main process, exactly as it will be recorded.
  useEffect(() => {
    if (!sale || lines.length === 0) {
      setQuote(null);
      return undefined;
    }
    const t = setTimeout(() => {
      call('sales.returnQuote', { id: sale.id, lines })
        .then(setQuote)
        .catch((err) => setQuote({ error: err.message }));
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale, linesKey]);

  const submit = guard(async (e) => {
    e.preventDefault();
    if (lines.length === 0) throw new Error('Type how many of each item came back');
    const { sale: updated, returned } = await call('sales.returnItems', { id: sale.id, lines, reason, restock });
    onClose();
    toast(`Return ${returned.return_no} saved. ${refundText(updated, returned.refund_cents)}`);
    showReceipt(updated);
    await onReturned();
  });

  return (
    <Modal
      open={Boolean(saleId)}
      onClose={onClose}
      title={`Return items from ${sale?.invoice_no || ''}`}
      description="When a customer brings back some of what they bought."
      id="modalReturnItems"
      size="lg"
    >
      <form id="returnForm" onSubmit={submit} className="contents">
        <ModalBody>
          {sale && (
            <div className="overflow-hidden rounded-panel border border-foil">
              <Table>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th num>Sold</Th>
                    <Th num>Returned before</Th>
                    <Th num>Coming back now</Th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map((i) => {
                    const left = i.quantity - i.returned_quantity;
                    return (
                      <Tr key={i.id} tone={left === 0 ? 'muted' : undefined}>
                        <Td>
                          <div className="font-semibold text-ink">{i.product_title}</div>
                          <div className="num text-sm text-ink-3">
                            {i.unit_type === 'PACK' ? 'Pack' : 'Unit'} at {money(i.price_cents)}
                          </div>
                        </Td>
                        <Td num>{i.quantity}</Td>
                        <Td num muted>{i.returned_quantity || '—'}</Td>
                        <Td num className="w-[190px]">
                          {left > 0 ? (
                            <div className="flex items-center justify-end gap-2">
                              <input
                                type="number"
                                min={0}
                                max={left}
                                step={1}
                                inputMode="numeric"
                                aria-label={`How many ${i.product_title} came back`}
                                data-return-qty={i.id}
                                value={quantities[i.id] ?? ''}
                                placeholder="0"
                                onChange={(e) => setQuantities((q) => ({ ...q, [i.id]: e.target.value }))}
                                className="control num !w-[76px] text-right"
                              />
                              <Button size="sm" variant="ghost" onClick={() => setQuantities((q) => ({ ...q, [i.id]: String(left) }))}>
                                All {left}
                              </Button>
                            </div>
                          ) : (
                            <span className="text-sm text-ink-3">All returned</span>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
          {quote && !quote.error && (
            <div id="returnRefund" className="rounded-panel bg-amber-soft px-4 py-3 text-base font-semibold text-amber-ink">
              {refundText(sale, quote.refundCents)}
              <div className="mt-0.5 text-sm font-normal">Their share of what they paid for these items, including discount, tax and fee.</div>
            </div>
          )}
          {quote && quote.error && <div className="rounded-panel bg-red-soft px-4 py-3 text-sm font-semibold text-red-ink">{quote.error}</div>}
          <div>
            <Checkbox name="restock" checked={restock} onChange={(e) => setRestock(e.target.checked)} label="Put the medicine back on the shelf (it can be sold again)" />
            <p className="ml-7 mt-1 text-sm text-ink-3">
              {restock ? 'The items go back into stock.' : 'Opened, damaged or not kept cold: it is recorded as damaged stock, a loss at what it cost.'}
            </p>
          </div>
          <Field label="Why is it being returned?">
            <Textarea name="reason" rows={2} maxLength={250} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Doctor changed the prescription" />
          </Field>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>Close</Button>
          <Button type="submit" variant="primary" disabled={!quote || Boolean(quote.error)}>
            Save the return
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

export function SalesView() {
  const { can, go, loadProducts, loadCustomers, refreshAlerts } = useApp();
  const cart = useCart();
  const { toast, guard } = useToast();
  const confirm = useConfirm();
  const { showReceipt } = useDocuments();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [returning, setReturning] = useState(null); // sale id
  const [rx, setRx] = useState(null);
  const fileRef = useRef(null);
  const rxTarget = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    () =>
      guard(async () => {
        const res = await call('sales.list', { page, pageSize: PAGE_SIZE, search: query });
        if (res.rows.length === 0 && page > 1) setPage(Math.max(1, Math.ceil(res.total / PAGE_SIZE)));
        else setResult(res);
      })(),
    [guard, page, query]
  );
  useEffect(() => {
    load();
  }, [load]);

  const reprint = guard(async (id) => showReceipt(await call('sales.get', { id })));

  const sellAgain = guard(async (id) => {
    if (
      cart.itemCount > 0 &&
      !(await confirm({
        title: 'Replace the current sale?',
        message: `There are ${cart.itemCount} item(s) in the sale you are ringing up now. They will be removed and replaced with this invoice's items.`,
        confirmText: 'Replace'
      }))
    ) {
      return;
    }
    const sale = await call('sales.get', { id });
    const { added, skipped } = cart.load(
      sale.items.map((i) => ({ productId: i.product_id, unitType: i.unit_type, quantity: i.quantity })),
      sale.customer_id
    );
    go('posView');
    if (added) toast(`${added} item(s) from ${sale.invoice_no} added to the sale`);
    if (skipped) toast(`${skipped} item(s) skipped (removed or not enough stock)`, 'warning');
  });

  const viewRx = guard(async (id) => setRx(await call('sales.getPrescription', { id })));

  const attachRx = guard(async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !rxTarget.current) return;
    await call('sales.attachPrescription', { id: rxTarget.current, fileName: file.name, base64Data: await readFileAsBase64(file) });
    rxTarget.current = null;
    toast('Prescription attached');
    await load();
  });

  const afterVoid = async () => {
    await Promise.all([load(), loadProducts(), loadCustomers()]);
    refreshAlerts();
  };

  const rows = result?.rows || [];
  return (
    <Page id="salesView">
      <PageHeader title="Sales history" description="Every sale made on this computer. Reprint a receipt, attach a prescription, take back returned items, or cancel a sale made by mistake." actions={<Button icon={RefreshCw} onClick={load}>Refresh</Button>} />
      <SearchInput id="salesSearchInput" icon={Search} value={search} onChange={setSearch} placeholder="Search by invoice number or customer" className="w-[360px]" />
      <input ref={fileRef} type="file" accept={PRESCRIPTION_FILE_TYPES} className="hidden" id="invoiceRxFileInput" onChange={attachRx} />
      <div className="overflow-hidden rounded-panel border border-foil bg-surface">
        {result && rows.length === 0 ? (
          <EmptyState icon={ReceiptText} title={query ? 'No sales match' : 'No sales yet'}>
            {query ? 'Check the invoice number or customer name.' : 'Completed sales appear here.'}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Customer</Th>
                <Th>Paid by</Th>
                <Th num>Total</Th>
                <Th>Status</Th>
                <Th>Prescription</Th>
                <Th />
              </tr>
            </thead>
            <tbody id="salesTableBody">
              {rows.map((s) => {
                const voided = s.status === 'VOIDED';
                const returned = s.returned_cents > 0;
                const allReturned = returned && s.returned_cents >= s.total_cents;
                return (
                  <Tr key={s.id} tone={voided ? 'muted' : undefined}>
                    <Td>
                      <div className="num font-semibold text-ink">{s.invoice_no}</div>
                      <div className="num text-sm text-ink-3">
                        {dateTime(s.created_at)}, {s.cashier_name}
                      </div>
                    </Td>
                    <Td>{s.customer_name}</Td>
                    <Td muted>{METHOD_LABELS[s.payment_method] || s.payment_method}</Td>
                    <Td num className={voided ? 'line-through' : 'font-semibold text-ink'}>
                      {money(s.total_cents)}
                    </Td>
                    <Td>
                      {voided ? (
                        <Pill tone="red">Cancelled</Pill>
                      ) : returned ? (
                        <span title={`${money(s.returned_cents)} given back`}>
                          <Pill tone="amber">{allReturned ? 'Returned' : 'Partly returned'}</Pill>
                        </span>
                      ) : (
                        <Pill tone="teal">Completed</Pill>
                      )}
                    </Td>
                    <Td>
                      {s.prescription_path ? (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" icon={Eye} data-rx-view={s.id} onClick={() => viewRx(s.id)}>
                            View
                          </Button>
                          <IconButton icon={Camera} label="Replace prescription" size="sm" data-rx-attach={s.id} onClick={() => { rxTarget.current = s.id; fileRef.current?.click(); }} />
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" icon={Camera} data-rx-attach={s.id} onClick={() => { rxTarget.current = s.id; fileRef.current?.click(); }}>
                          Attach
                        </Button>
                      )}
                    </Td>
                    <Td className="w-[360px]">
                      <RowActions>
                        <Button size="sm" variant="ghost" icon={Printer} data-reprint={s.id} onClick={() => reprint(s.id)}>
                          Receipt
                        </Button>
                        {can('pos.sell') && <IconButton icon={RotateCcw} label="Sell these items again" size="sm" data-reorder={s.id} onClick={() => sellAgain(s.id)} />}
                        {!voided && !allReturned && can('sales.void') && (
                          <Button size="sm" variant="ghost" icon={Undo2} data-return={s.id} onClick={() => setReturning(s.id)}>
                            Return
                          </Button>
                        )}
                        {!voided && !returned && can('sales.void') && (
                          <Button size="sm" variant="danger-ghost" icon={Ban} data-void={s.id} onClick={() => setVoiding(s)}>
                            Cancel sale
                          </Button>
                        )}
                      </RowActions>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={result?.total || 0} noun="invoices" onChange={setPage} />
      </div>

      <VoidDialog sale={voiding} onClose={() => setVoiding(null)} onVoided={afterVoid} />
      <ReturnDialog saleId={returning} onClose={() => setReturning(null)} onReturned={afterVoid} />
      <Modal open={Boolean(rx)} onClose={() => setRx(null)} title={`Prescription for ${rx?.invoiceNo || ''}`} id="modalPrescriptionViewer" size="lg">
        <ModalBody className="items-center bg-sunken">
          {rx && <img id="prescriptionImageElement" src={rx.dataUrl} alt={`Prescription for ${rx.invoiceNo}`} className="max-h-[60vh] max-w-full rounded-panel border border-foil" />}
        </ModalBody>
      </Modal>
    </Page>
  );
}
