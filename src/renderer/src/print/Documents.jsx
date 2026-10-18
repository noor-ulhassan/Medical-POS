import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { call } from '../lib/api.js';
import { money, dateTime, shortDate } from '../lib/format.js';
import { useApp } from '../state/AppState.jsx';
import { useToast } from '../ui/Toast.jsx';
import { readPrefs } from '../lib/prefs.js';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal.jsx';
import { Button } from '../ui/Button.jsx';

/*
 * Printable output. Paper is always white with black text, whatever the
 * screen theme; @media print (index.css) prints only `.printable-area`.
 */
const DocumentsContext = createContext(null);

export const SOFTWARE_CREDIT = 'Software by Noor ul Hassan (noorulhassan01.dev@gmail.com)';

const PAYMENT_LABELS = { CASH: 'Cash', CARD: 'Card', 'MOBILE WALLET': 'Mobile wallet', CREDIT: 'Khata (credit)' };

export function DocumentsProvider({ children }) {
  const { guard, toast } = useToast();
  const { user } = useApp();
  const [receipt, setReceipt] = useState(null);
  const [doc, setDoc] = useState(null);
  const [printWhenShown, setPrintWhenShown] = useState(null); // sale id to print as soon as its receipt is on screen

  // Nothing from the store stays on screen once the till is locked (F12 or after a while without use).
  useEffect(() => {
    if (user) return;
    setReceipt(null);
    setDoc(null);
    setPrintWhenShown(null);
  }, [user]);

  /** `autoPrint`: print straight away (the "print after every sale" setting on this computer). */
  const showReceipt = useCallback((sale, { autoPrint = false } = {}) => {
    setReceipt(sale);
    setPrintWhenShown(autoPrint ? sale.id : null);
  }, []);
  const showDocument = useCallback((title, content) => setDoc({ title, content }), []);

  // A print that fails (no printer, printer offline) must not go unnoticed at the counter.
  const print = guard(async () => {
    const res = await call('app.print', { silent: readPrefs().silentPrint });
    if (res && res.printed === false && res.reason && !/cancel/i.test(res.reason)) {
      toast(`Nothing was printed (${res.reason}). Check that the printer is on and connected, then press Print again.`, 'error', { sticky: true });
    }
  });

  useEffect(() => {
    if (!receipt || printWhenShown !== receipt.id) return undefined;
    // Let the receipt render first: printing prints what is on screen.
    const t = setTimeout(() => {
      setPrintWhenShown(null);
      print();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt, printWhenShown]);

  return (
    <DocumentsContext.Provider value={{ showReceipt, showDocument }}>
      {children}
      <Modal open={Boolean(receipt)} onClose={() => setReceipt(null)} title="Receipt" id="modalReceiptPreview" size="receipt">
        <ModalBody className="items-center bg-sunken">{receipt && <Receipt sale={receipt} />}</ModalBody>
        <ModalFooter>
          <Button onClick={() => setReceipt(null)}>Done</Button>
          <Button variant="primary" icon={Printer} onClick={print} data-autofocus>
            Print receipt
          </Button>
        </ModalFooter>
      </Modal>
      <Modal open={Boolean(doc)} onClose={() => setDoc(null)} title={doc?.title} id="modalA4Preview" size="xl">
        <ModalBody className="bg-sunken">
          <div className="printable-area mx-auto w-full max-w-[794px] bg-white p-10 text-[13px] leading-normal text-black shadow-sm ring-1 ring-black/5">
            {doc?.content}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button onClick={() => setDoc(null)}>Close</Button>
          <Button variant="primary" icon={Printer} onClick={print}>
            Print or save as PDF
          </Button>
        </ModalFooter>
      </Modal>
    </DocumentsContext.Provider>
  );
}

export function useDocuments() {
  return useContext(DocumentsContext);
}

// ------------------------------------------------------------------ receipt

function Row({ label, value, strong }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'text-[14px] font-bold' : ''}`}>
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

const Rule = () => <div className="my-2 border-t border-dashed border-black/60" />;

/** 80mm thermal receipt for a sale returned by sales.checkout / sales.get. */
export function Receipt({ sale }) {
  const { settings: s } = useApp();
  return (
    <div id="receiptContainer" className="printable-area w-[302px] bg-white px-4 py-5 text-[12px] leading-snug text-black shadow-sm ring-1 ring-black/5">
      <div className="text-center">
        <div className="text-[16px] font-bold">{s.store_name}</div>
        {s.store_address && <div>{s.store_address}</div>}
        {s.store_phone && <div>Tel: {s.store_phone}</div>}
        {s.ntn_fbr_id && <div>{s.ntn_fbr_id}</div>}
      </div>
      <Rule />
      <div className="space-y-px">
        <div>
          Invoice <strong>{sale.invoice_no}</strong>
        </div>
        <div>{dateTime(sale.created_at)}</div>
        <div>Cashier: {sale.cashier_name}</div>
        <div>Customer: {sale.customer_name}</div>
        <div>
          Paid by: <strong>{PAYMENT_LABELS[sale.payment_method] || sale.payment_method}</strong>
        </div>
        {sale.prescription_path && <div>Prescription on file</div>}
        {sale.status === 'VOIDED' && <div className="pt-1 text-center font-bold">*** CANCELLED / VOID ***</div>}
      </div>
      <Rule />
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left">
            <th className="pb-1 font-semibold">Item</th>
            <th className="pb-1 text-center font-semibold">Qty</th>
            <th className="pb-1 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((i) => (
            <tr key={i.id} className="align-top">
              <td className="py-0.5 pr-2">
                {i.product_title}
                <div className="text-[11px]">
                  {i.unit_type === 'PACK' ? 'Pack' : 'Unit'} @ {money(i.price_cents)}
                </div>
              </td>
              <td className="num py-0.5 text-center">{i.quantity}</td>
              <td className="num whitespace-nowrap py-0.5 text-right">{money(i.total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Rule />
      <Row label="Subtotal" value={money(sale.subtotal_cents)} />
      {sale.discount_cents > 0 && <Row label="Discount" value={`-${money(sale.discount_cents)}`} />}
      <Row label="Tax and fees" value={money(sale.tax_cents)} />
      <Rule />
      <Row label="Total" value={money(sale.total_cents)} strong />
      {sale.payment_method === 'CASH' && (
        <>
          <Row label="Cash received" value={money(sale.paid_cents)} />
          <Row label="Change" value={money(sale.change_cents)} />
        </>
      )}
      {sale.payment_method === 'CREDIT' && sale.khata_balance_after_cents !== null && sale.khata_balance_after_cents !== undefined && (
        <Row label="Khata balance after this sale" value={money(sale.khata_balance_after_cents)} />
      )}
      <Rule />
      <div className="text-center text-[11px]">
        {s.receipt_disclaimer && <p>{s.receipt_disclaimer}</p>}
        <p className="mt-1.5 font-semibold">{SOFTWARE_CREDIT}</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ A4 documents

function DocHeader({ title, lines }) {
  const { settings: s } = useApp();
  return (
    <div className="mb-6 flex items-start justify-between gap-6 border-b-2 border-black pb-4">
      <div>
        <div className="text-[20px] font-bold">{s.store_name}</div>
        <div>{s.store_address}</div>
        {s.store_phone && <div>Tel: {s.store_phone}</div>}
      </div>
      <div className="text-right">
        <div className="text-[16px] font-bold">{title}</div>
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}

function DocTable({ head, children }) {
  return (
    <table className="w-full border-collapse text-[12px]">
      <thead>
        <tr>
          {head.map(([label, align], i) => (
            <th key={i} className={`border-b border-black px-2 py-2 font-bold ${align === 'r' ? 'text-right' : align === 'c' ? 'text-center' : 'text-left'}`}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="[&_td]:border-b [&_td]:border-black/15 [&_td]:px-2 [&_td]:py-2">{children}</tbody>
    </table>
  );
}

const Box = ({ children }) => <div className="mb-5 flex justify-between gap-6 rounded border border-black/20 p-3">{children}</div>;

export function LedgerStatement({ customer, entries }) {
  return (
    <>
      <DocHeader title="Customer account statement" lines={[`Date: ${new Date().toLocaleDateString()}`]} />
      <Box>
        <div>
          <div><strong>Customer:</strong> {customer.name}</div>
          <div><strong>Phone:</strong> {customer.phone || 'Not given'}</div>
        </div>
        <div className="text-right">
          <div><strong>Credit limit:</strong> {money(customer.credit_limit_cents)}</div>
          <div><strong>Balance owed:</strong> {money(customer.current_debt_cents)}</div>
        </div>
      </Box>
      <DocTable head={[['Date'], ['Entry'], ['Reference'], ['Charged', 'r'], ['Paid', 'r'], ['Balance', 'r']]}>
        {entries.length ? (
          entries.map((l) => (
            <tr key={l.id}>
              <td>{dateTime(l.created_at)}</td>
              <td>{{ SALE_CREDIT: 'Sale on credit', PAYMENT_RECEIVED: 'Payment', OPENING_BALANCE: 'Opening balance', ADJUSTMENT: 'Adjustment' }[l.type] || l.type}</td>
              <td>{l.notes}</td>
              <td className="num text-right">{l.debit_cents ? money(l.debit_cents) : ''}</td>
              <td className="num text-right">{l.credit_cents ? money(l.credit_cents) : ''}</td>
              <td className="num text-right font-bold">{money(l.balance_after_cents)}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={6} className="text-center">No entries yet.</td>
          </tr>
        )}
      </DocTable>
    </>
  );
}

export function PurchaseOrder({ supplier, items, reference }) {
  const total = items.reduce((sum, i) => sum + (i.product.cost_price_cents || 0) * i.packs, 0);
  return (
    <>
      <DocHeader title="Purchase order" lines={[`Reference: ${reference}`, `Date: ${new Date().toLocaleDateString()}`]} />
      <Box>
        <div>
          <div><strong>To:</strong> {supplier ? supplier.name : 'Several suppliers'}</div>
          {supplier && (
            <div>
              <strong>Contact:</strong> {supplier.contact_person || 'Not given'}, {supplier.phone || 'no phone'}
            </div>
          )}
        </div>
      </Box>
      <DocTable head={[['Medicine'], ['Generic'], ['Units per pack', 'c'], ['Packs', 'c'], ['Cost per pack', 'r'], ['Line total', 'r']]}>
        {items.map((i) => (
          <tr key={i.product.id}>
            <td>{i.product.title}</td>
            <td>{i.product.generic_name}</td>
            <td className="num text-center">{i.product.pack_size}</td>
            <td className="num text-center font-bold">{i.packs}</td>
            <td className="num text-right">{i.product.cost_price_cents ? money(i.product.cost_price_cents) : 'Not set'}</td>
            <td className="num text-right font-bold">{i.product.cost_price_cents ? money(i.product.cost_price_cents * i.packs) : ''}</td>
          </tr>
        ))}
      </DocTable>
      <div className="num mt-4 text-right text-[15px] font-bold">Estimated total {money(total)}</div>
      <div className="mt-16 flex justify-between text-[12px]">
        <div><div className="w-56 border-t border-black pt-1">Pharmacist signature</div></div>
        <div><div className="w-56 border-t border-black pt-1 text-right">Supplier stamp and signature</div></div>
      </div>
    </>
  );
}

export function Quotation({ customerName, customerPhone, rows, validUntil, reference, totals }) {
  return (
    <>
      <DocHeader title="Price quotation" lines={[`Reference: ${reference}`, `Valid until: ${shortDate(validUntil)}`]} />
      <Box>
        <div>
          <div><strong>Prepared for:</strong> {customerName}</div>
          <div><strong>Phone:</strong> {customerPhone || 'Not given'}</div>
        </div>
      </Box>
      <DocTable head={[['Medicine'], ['Sold as', 'c'], ['Quantity', 'c'], ['Price each', 'r'], ['Total', 'r']]}>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.title}</td>
            <td className="text-center">{r.unitType === 'PACK' ? 'Pack' : 'Unit'}</td>
            <td className="num text-center">{r.quantity}</td>
            <td className="num text-right">{money(r.priceCents)}</td>
            <td className="num text-right font-bold">{money(r.priceCents * r.quantity)}</td>
          </tr>
        ))}
      </DocTable>
      <div className="num mt-4 ml-auto w-72 space-y-1 text-right text-[13px]">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{money(totals.subtotalCents)}</span>
        </div>
        {totals.taxCents > 0 && (
          <div className="flex justify-between">
            <span>Tax and fees</span>
            <span>{money(totals.taxCents)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-black pt-1 text-[15px] font-bold">
          <span>Total</span>
          <span>{money(totals.totalCents)}</span>
        </div>
      </div>
    </>
  );
}

export function StockHistory({ product, entries }) {
  return (
    <>
      <DocHeader title="Stock adjustments" lines={[product.title, `Barcode ${product.barcode}`]} />
      <DocTable head={[['Date'], ['By'], ['Reason'], ['Change (units)', 'r'], ['Stock after', 'r']]}>
        {entries.length ? (
          entries.map((e) => (
            <tr key={e.id}>
              <td>{dateTime(e.created_at)}</td>
              <td>{e.user_name}</td>
              <td>{e.reason}</td>
              <td className="num text-right">{e.change_units > 0 ? `+${e.change_units}` : e.change_units}</td>
              <td className="num text-right">{e.stock_after_units}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={5} className="text-center">No manual adjustments yet. Sales are listed in Sales history.</td>
          </tr>
        )}
      </DocTable>
    </>
  );
}
