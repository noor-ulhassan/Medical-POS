import { useMemo, useState } from 'react';
import { Printer, ClipboardCheck } from 'lucide-react';
import { useApp } from '../../state/AppState.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { useDocuments, PurchaseOrder } from '../../print/Documents.jsx';
import { Button } from '../../ui/Button.jsx';
import { Select } from '../../ui/Field.jsx';
import { Page, PageHeader, Segmented, EmptyState, IconTile } from '../../ui/display.jsx';
import { medicineIcon, categoryTone } from '../../lib/look.js';
import { Table, Th, Td, Tr } from '../../ui/Table.jsx';
import { money, isLowStock, isOutOfStock, timeReference } from '../../lib/format.js';

/** Enough to reach twice the minimum level, at least one pack. */
const suggestedPacks = (p) => Math.max(1, p.min_stock_level * 2 - Math.max(p.stock_packs, 0));

export function RestockView() {
  const { products, suppliers } = useApp();
  const { toast } = useToast();
  const { showDocument } = useDocuments();
  const [filter, setFilter] = useState('LOW');
  const [supplierId, setSupplierId] = useState('');
  const [quantities, setQuantities] = useState({});

  const rows = useMemo(
    () =>
      products.filter((p) => {
        if (supplierId && String(p.supplier_id) !== supplierId) return false;
        if (filter === 'LOW') return isLowStock(p);
        if (filter === 'OUT') return isOutOfStock(p);
        return true;
      }),
    [products, filter, supplierId]
  );

  const packsFor = (p) => (quantities[p.id] !== undefined ? quantities[p.id] : String(suggestedPacks(p)));

  const createOrder = () => {
    const items = rows.map((p) => ({ product: p, packs: Math.max(0, Math.trunc(Number(packsFor(p)) || 0)) })).filter((i) => i.packs > 0);
    if (items.length === 0) {
      toast('Enter an order quantity for at least one product', 'error');
      return;
    }
    const supplier = suppliers.find((s) => String(s.id) === supplierId) || null;
    showDocument(`Purchase order${supplier ? `: ${supplier.name}` : ''}`, <PurchaseOrder supplier={supplier} items={items} reference={timeReference('PO')} />);
  };

  const total = rows.reduce((sum, p) => sum + (p.cost_price_cents || 0) * (Math.trunc(Number(packsFor(p))) || 0), 0);

  return (
    <Page id="ordersView">
      <PageHeader
        title="Reorder"
        description="Medicines running low. Check how many packs to order, then print the order for your supplier."
        actions={
          <Button variant="primary" icon={Printer} id="btnGeneratePO" onClick={createOrder}>
            Print order
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Select id="supplierOrderSelect" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="!w-[260px]" aria-label="Supplier">
          <option value="">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
            </option>
          ))}
        </Select>
        <Segmented
          label="Which products"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'LOW', label: 'Low stock' },
            { value: 'OUT', label: 'Out of stock' },
            { value: 'ALL', label: 'All medicines' }
          ]}
        />
        {rows.length > 0 && (
          <span className="num ml-auto text-base text-ink-2">
            Estimated cost <strong className="text-ink">{money(total)}</strong>
          </span>
        )}
      </div>
      <div className="overflow-hidden rounded-panel border border-foil bg-surface shadow-card">
        {rows.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="Nothing to reorder">
            Every medicine here has more than its minimum stock.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Medicine</Th>
                <Th num>Packs left</Th>
                <Th num>Packs to order</Th>
                <Th num>Cost</Th>
              </tr>
            </thead>
            <tbody id="restockTableBody">
              {rows.map((p) => {
                const packs = Math.trunc(Number(packsFor(p))) || 0;
                return (
                  <Tr key={p.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <IconTile icon={medicineIcon(p.title)} tone={categoryTone(p.category_id)} />
                        <div className="min-w-0">
                          <div className="font-semibold text-ink">{p.title}</div>
                          <div className="text-sm text-ink-3">{[`pack of ${p.pack_size}`, p.supplier_name].filter(Boolean).join(' · ')}</div>
                        </div>
                      </div>
                    </Td>
                    <Td num>
                      <div className={isOutOfStock(p) ? 'font-bold text-red-ink' : isLowStock(p) ? 'font-semibold text-amber-ink' : 'font-semibold'}>{p.stock_packs}</div>
                      <div className="text-sm text-ink-3">minimum {p.min_stock_level}</div>
                    </Td>
                    <Td num className="w-[160px]">
                      <input
                        type="number"
                        min="0"
                        aria-label={`Packs of ${p.title} to order`}
                        className="control po-qty-input num ml-auto !w-24 text-right"
                        value={packsFor(p)}
                        onChange={(e) => setQuantities((q) => ({ ...q, [p.id]: e.target.value }))}
                      />
                    </Td>
                    <Td num>{p.cost_price_cents ? money(p.cost_price_cents * packs) : <span className="text-ink-3">No cost price</span>}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </Page>
  );
}
