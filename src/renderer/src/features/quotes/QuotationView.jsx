import { useRef, useState } from 'react';
import { Plus, Printer, X } from 'lucide-react';
import { useApp } from '../../state/AppState.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { useDocuments, Quotation } from '../../print/Documents.jsx';
import { Button, IconButton } from '../../ui/Button.jsx';
import { Field, Input } from '../../ui/Field.jsx';
import { Page, PageHeader } from '../../ui/display.jsx';
import { Table, Th, Td, Tr } from '../../ui/Table.jsx';
import { money, toCents, centsToInput, unitPriceCents, addDaysIso, timeReference, computeTotals } from '../../lib/format.js';

const newRow = (key) => ({ key, productId: '', unitType: 'SINGLE', quantity: '1', price: '' });

export function QuotationView() {
  const { products, productById, settings } = useApp();
  const { toast } = useToast();
  const { showDocument } = useDocuments();
  const keyRef = useRef(1);
  const [rows, setRows] = useState(() => [newRow(0)]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [validDays, setValidDays] = useState('15');

  const update = (key, patch) =>
    setRows((list) =>
      list.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // Picking a product or unit fills in the current selling price.
        if ('productId' in patch || 'unitType' in patch) {
          const product = productById(next.productId);
          if (product) next.price = centsToInput(unitPriceCents(product, next.unitType));
        }
        return next;
      })
    );

  const lineCents = (r) => {
    const price = toCents(r.price);
    return (Number.isNaN(price) ? 0 : price) * Math.max(0, Math.trunc(Number(r.quantity) || 0));
  };
  // Same calculation as the till (tax rate and per-receipt fee), so the quote matches what the customer will pay.
  const quoted = rows.filter((r) => productById(r.productId) && lineCents(r) > 0);
  const totals = computeTotals({
    lines: quoted.map((r) => ({ priceCents: lineCents(r), quantity: 1 })),
    taxRatePercent: settings.tax_rate_percent,
    posFeeCents: settings.pos_fee_cents
  });

  const print = () => {
    const lines = rows
      .map((r) => ({ product: productById(r.productId), unitType: r.unitType, quantity: Math.max(0, Math.trunc(Number(r.quantity) || 0)), priceCents: toCents(r.price) || 0 }))
      .filter((r) => r.product && r.quantity > 0)
      .map((r) => ({ title: r.product.title, unitType: r.unitType, quantity: r.quantity, priceCents: r.priceCents }));
    if (lines.length === 0) {
      toast('Add at least one medicine to the quotation', 'error');
      return;
    }
    const days = Math.min(Math.max(Math.trunc(Number(validDays) || 15), 1), 365);
    const name = customerName.trim() || 'Valued customer';
    showDocument(
      `Quotation: ${name}`,
      <Quotation customerName={name} customerPhone={customerPhone.trim()} rows={lines} validUntil={addDaysIso(days)} reference={timeReference('QT')} totals={computeTotals({ lines, taxRatePercent: settings.tax_rate_percent, posFeeCents: settings.pos_fee_cents })} />
    );
  };

  return (
    <Page id="quotationView">
      <PageHeader
        title="Price quote"
        description="Write down prices for a clinic or a customer and print them. Nothing is sold or taken from stock."
        actions={
          <Button variant="primary" icon={Printer} id="btnPrintQuote" onClick={print}>
            See and print quote
          </Button>
        }
      />
      <div className="grid grid-cols-[2fr_1.2fr_1fr] gap-4 rounded-panel border border-foil bg-surface p-5">
        <Field label="Prepared for">
          <Input id="quoteCustomerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. City General Clinic" />
        </Field>
        <Field label="Phone">
          <Input id="quoteCustomerPhone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
        </Field>
        <Field label="Valid for (days)">
          <Input id="quoteValidDays" numeric type="number" min={1} max={365} value={validDays} onChange={(e) => setValidDays(e.target.value)} />
        </Field>
      </div>
      <div className="overflow-hidden rounded-panel border border-foil bg-surface">
        <Table>
          <thead>
            <tr>
              <Th>Medicine</Th>
              <Th>Sold as</Th>
              <Th num>Quantity</Th>
              <Th num>Price each (Rs)</Th>
              <Th num>Total</Th>
              <Th />
            </tr>
          </thead>
          <tbody id="quoteItemsBody">
            {rows.map((r) => (
              <Tr key={r.key}>
                <Td className="min-w-[220px]">
                  <select className="control" aria-label="Medicine" value={r.productId} onChange={(e) => update(r.key, { productId: e.target.value })}>
                    <option value="">Choose a medicine</option>
                    {products.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </Td>
                <Td className="w-[140px]">
                  <select className="control min-w-[88px]" aria-label="Sold as" value={r.unitType} onChange={(e) => update(r.key, { unitType: e.target.value })}>
                    <option value="SINGLE">Unit</option>
                    <option value="PACK">Pack</option>
                  </select>
                </Td>
                <Td className="w-[120px]">
                  <input type="number" min="1" aria-label="Quantity" className="control num min-w-[64px] text-right" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />
                </Td>
                <Td className="w-[160px]">
                  <input type="number" min="0" step="0.01" aria-label="Price each" placeholder="0.00" className="control num min-w-[88px] text-right" value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} />
                </Td>
                <Td num className="w-[140px] font-semibold">
                  {money(lineCents(r))}
                </Td>
                <Td className="w-12 text-right">
                  <IconButton icon={X} label="Remove line" size="sm" tone="danger" onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <div className="flex items-center justify-between border-t border-foil px-4 py-3">
          <Button icon={Plus} id="btnAddQuoteRow" onClick={() => setRows((list) => [...list, newRow(keyRef.current++)])}>
            Add line
          </Button>
          <div className="text-base text-ink-2">
            {totals.taxCents > 0 && (
              <span className="num mr-4 text-ink-3">
                {money(totals.subtotalCents)} + tax and fees {money(totals.taxCents)}
              </span>
            )}
            Total <strong id="quoteGrandTotal" className="num ml-2 text-lg text-ink">{money(totals.totalCents)}</strong>
          </div>
        </div>
      </div>
    </Page>
  );
}
