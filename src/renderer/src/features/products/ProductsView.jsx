import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, History, Trash2, Search, PackageOpen, PackagePlus } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { useConfirm } from '../../ui/Confirm.jsx';
import { useDocuments, StockHistory } from '../../print/Documents.jsx';
import { Button, ActionButton } from '../../ui/Button.jsx';
import { Modal, ModalBody, ModalFooter } from '../../ui/Modal.jsx';
import { Field, Input } from '../../ui/Field.jsx';
import { Page, PageHeader, Segmented, SearchInput, ExpiryPill, Pill, RxPill, EmptyState, Fact, IconTile, Meter } from '../../ui/display.jsx';
import { medicineIcon, categoryTone, stockFill } from '../../lib/look.js';
import { Table, Th, Td, Tr, Pagination, paginate } from '../../ui/Table.jsx';
import { money, isLowStock, isOutOfStock, splitUnits, toCents, centsToInput, shortDate } from '../../lib/format.js';
import { cx } from '../../ui/cx.js';
import { ProductDialog } from './ProductDialog.jsx';

const PAGE_SIZE = 25;

const stockText = (units, packSize) => {
  const { packs, singles } = splitUnits(units, packSize);
  return `${packs} ${packs === 1 ? 'pack' : 'packs'}${singles ? ` + ${singles} loose` : ''}`;
};

/** A delivery arrived: add packs to what is already there, so nobody has to work out the new total. */
function ReceiveStockDialog({ product, onClose }) {
  const { loadProducts, refreshAlerts } = useApp();
  const { toast, guard } = useToast();
  const confirm = useConfirm();
  const [v, setV] = useState({ packs: '', singles: '', expiryDate: '', costPrice: '' });

  useEffect(() => {
    if (!product) return;
    setV({ packs: '', singles: '', expiryDate: product.expiry_date || '', costPrice: centsToInput(product.cost_price_cents) });
  }, [product]);

  const set = (name) => (e) => setV((cur) => ({ ...cur, [name]: e.target.value }));
  const packs = Math.max(0, Math.trunc(Number(v.packs) || 0));
  const singles = Math.max(0, Math.trunc(Number(v.singles) || 0));
  const added = product ? packs * product.pack_size + singles : 0;

  const submit = guard(async (e) => {
    e.preventDefault();
    if (added <= 0) throw new Error('Enter how many packs arrived');
    const cost = v.costPrice === '' ? null : toCents(v.costPrice);
    if (cost !== null && (Number.isNaN(cost) || cost < 0)) throw new Error('Cost per pack is not a valid amount');
    // One expiry date is kept per medicine. Moving it later while older packs
    // remain would let those packs be sold after they expire.
    if (v.expiryDate && product.expiry_date && product.stock_units > 0 && v.expiryDate > product.expiry_date) {
      const olderGone = await confirm({
        title: 'Are older packs still on the shelf?',
        message:
          `${stockText(product.stock_units, product.pack_size)} already in stock expire on ${shortDate(product.expiry_date)}. ` +
          `This medicine has one expiry date, so if any of those packs are still there, keep the earlier date; ` +
          `otherwise they could be sold after they expire.\n\nUse ${shortDate(v.expiryDate)} only if all the older packs are gone.`,
        confirmText: `Older packs are gone: use ${shortDate(v.expiryDate)}`
      });
      if (!olderGone) {
        setV((cur) => ({ ...cur, expiryDate: product.expiry_date }));
        toast(`Kept the earlier expiry date ${shortDate(product.expiry_date)}. Press Add to stock to save.`, 'info');
        return;
      }
    }
    const saved = await call('products.receiveStock', {
      id: product.id,
      packs,
      singles,
      expiryDate: v.expiryDate || null,
      costPriceCents: cost
    });
    onClose();
    toast(`${saved.title}: ${stockText(added, saved.pack_size)} added. Now in stock: ${stockText(saved.stock_units, saved.pack_size)}.`);
    await loadProducts();
    refreshAlerts();
  });

  return (
    <Modal open={Boolean(product)} onClose={onClose} title="Receive stock" description={product ? product.title : ''} id="modalReceiveStock" size="sm">
      <form id="receiveStockForm" onSubmit={submit} className="contents">
        {product && (
          <ModalBody>
            <div className="flex items-center justify-between rounded-panel bg-sunken px-4 py-3">
              <div>
                <div className="text-sm text-ink-3">In stock now</div>
                <div className="num font-semibold text-ink">{stockText(product.stock_units, product.pack_size)}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-ink-3">After this delivery</div>
                <div className="num text-lg font-bold text-teal-ink">{stockText(product.stock_units + added, product.pack_size)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Packs received" help={`${product.pack_size} units in each pack.`}>
                <Input numeric type="number" name="packs" min={0} step={1} value={v.packs} onChange={set('packs')} className="!h-12 !text-xl font-bold" data-autofocus />
              </Field>
              <Field label="Extra loose units" help="Usually 0.">
                <Input numeric type="number" name="singles" min={0} step={1} value={v.singles} onChange={set('singles')} />
              </Field>
            </div>
            <Field label="Expiry date on the shelf" help="Change it to the new date only if no older packs with an earlier date are left.">
              <Input type="date" name="expiryDate" value={v.expiryDate} onChange={set('expiryDate')} />
            </Field>
            <Field label="Cost per pack (Rs)" help="What the supplier charged for one pack this time.">
              <Input numeric type="number" name="costPrice" min={0} step="0.01" value={v.costPrice} onChange={set('costPrice')} />
            </Field>
          </ModalBody>
        )}
        <ModalFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon={PackagePlus} disabled={added <= 0}>
            Add to stock
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** One medicine: what the shop knows about it next to everything that can be done with it. */
function MedicineDetail({ product, onClose, onReceive, onEdit, onHistory, onRemove }) {
  const { can } = useApp();
  const out = product && isOutOfStock(product);
  const low = product && !out && isLowStock(product);
  return (
    <Modal
      open={Boolean(product)}
      onClose={onClose}
      icon={product ? medicineIcon(product.title) : undefined}
      tone={product ? categoryTone(product.category_id) : undefined}
      title={product ? product.title : ''} description={product?.generic_name || undefined} id="modalMedicine" size="lg">
      {product && (
        <ModalBody className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start gap-5 bg-sunken">
          <dl className="grid grid-cols-2 gap-4 rounded-panel border border-foil bg-surface shadow-card p-5">
            <Fact label="In stock">
              {out ? <Pill tone="red">Out of stock</Pill> : <span className={cx('num', low && 'text-amber-ink')}>{stockText(product.stock_units, product.pack_size)}</span>}
              {low && <span className="block text-sm font-normal text-amber-ink">Running low</span>}
            </Fact>
            <Fact label="Expires">
              <ExpiryPill date={product.expiry_date} />
            </Fact>
            <Fact label="Price of one">
              <span className="num">{money(product.single_price_cents)}</span>
            </Fact>
            <Fact label={`Price of a pack of ${product.pack_size}`}>
              <span className="num">{money(product.sale_price_cents)}</span>
            </Fact>
            <Fact label="Category">{product.category_name || 'None'}</Fact>
            <Fact label="Supplier">{product.supplier_name || 'None'}</Fact>
            <Fact label="Prescription">{product.is_prescription_required ? 'Needed' : 'Not needed'}</Fact>
            <Fact label="Barcode">
              <span className="num whitespace-nowrap text-base">{product.barcode}</span>
            </Fact>
          </dl>
          <div className="flex flex-col gap-2.5">
            {can('stock.adjust') && (
              <ActionButton icon={PackagePlus} tone="primary" data-receive={product.id} onClick={() => onReceive(product)}>
                Receive a delivery
              </ActionButton>
            )}
            {can('products.manage') && (
              <ActionButton icon={Pencil} data-edit={product.id} onClick={() => onEdit(product)}>
                Change details, stock or prices
              </ActionButton>
            )}
            <ActionButton icon={History} data-history={product.id} onClick={() => onHistory(product)}>
              See stock history
            </ActionButton>
            {can('products.manage') && (
              <ActionButton icon={Trash2} tone="danger" data-remove={product.id} onClick={() => onRemove(product.id)}>
                Remove this medicine
              </ActionButton>
            )}
          </div>
        </ModalBody>
      )}
    </Modal>
  );
}

export function ProductsView() {
  const { products, can, productById, loadProducts, refreshAlerts } = useApp();
  const { toast, guard } = useToast();
  const confirm = useConfirm();
  const { showDocument } = useDocuments();
  const [search, setSearch] = useState('');
  const [stock, setStock] = useState('ALL');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // null | 'new' | product
  const [receiving, setReceiving] = useState(null);
  const [openId, setOpenId] = useState(null);
  const manage = can('products.manage');
  const canReceive = can('stock.adjust');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (q && !`${p.title} ${p.generic_name} ${p.barcode}`.toLowerCase().includes(q)) return false;
      if (stock === 'LOW') return isLowStock(p);
      if (stock === 'OUT') return isOutOfStock(p);
      return true;
    });
  }, [products, search, stock]);
  const view = paginate(filtered, page, PAGE_SIZE);

  const remove = guard(async (id) => {
    const product = productById(id);
    const ok = await confirm({
      title: `Remove ${product.title}?`,
      message: 'It leaves the medicine list and the till. A medicine that was sold before is kept out of sight instead of deleted, so past sales, returns and reports stay correct.',
      confirmText: 'Remove medicine',
      danger: true
    });
    if (!ok) return;
    const { mode } = await call('products.remove', { id });
    toast(mode === 'archived' ? `${product.title} removed from the list (kept for past sales)` : `${product.title} removed`);
    await loadProducts();
    refreshAlerts();
  });

  const history = guard(async (product) => showDocument(`Stock history: ${product.title}`, <StockHistory product={product} entries={await call('products.stockHistory', { id: product.id })} />));

  return (
    <Page id="inventoryView">
      <PageHeader
        title="Medicines"
        description={canReceive ? 'Tap a medicine to change it or see its history. When a delivery comes, press Receive.' : 'Tap a medicine to see its details and stock history.'}
        actions={
          manage && (
            <Button variant="primary" icon={Plus} id="btnOpenAddProduct" onClick={() => setEditing('new')}>
              Add medicine
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          id="inventorySearchInput"
          icon={Search}
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search name, generic name or barcode"
          className="w-[360px]"
        />
        <Segmented
          label="Stock filter"
          value={stock}
          onChange={(v) => {
            setStock(v);
            setPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'LOW', label: 'Low stock' },
            { value: 'OUT', label: 'Out of stock' }
          ]}
        />
      </div>

      <div className="overflow-hidden rounded-panel border border-foil bg-surface shadow-card">
        {view.rows.length === 0 ? (
          <EmptyState icon={PackageOpen} title={products.length ? 'No products match' : 'No products yet'}>
            {products.length ? 'Try a different search or filter.' : 'Add your first product to start selling.'}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Medicine</Th>
                <Th>In stock</Th>
                <Th>Expires</Th>
                <Th num>Price</Th>
                {canReceive && <Th />}
              </tr>
            </thead>
            <tbody id="inventoryTableBody">
              {view.rows.map((p) => {
                const out = isOutOfStock(p);
                const low = !out && isLowStock(p);
                return (
                  <Tr key={p.id} tone={out ? 'danger' : low ? 'warn' : undefined} data-open-product={p.id} onOpen={() => setOpenId(p.id)}>
                    <Td className="min-w-[260px]">
                      <div className="flex items-center gap-3">
                        <IconTile icon={medicineIcon(p.title)} tone={categoryTone(p.category_id)} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-ink">{p.title}</span>
                            {p.is_prescription_required ? <RxPill /> : null}
                          </div>
                          {(p.generic_name || p.category_name) && (
                            <div className="mt-0.5 truncate text-sm text-ink-3">{[p.generic_name, p.category_name].filter(Boolean).join(' · ')}</div>
                          )}
                        </div>
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {out ? (
                        <Pill tone="red">Out of stock</Pill>
                      ) : (
                        <>
                          <div className={cx('num font-semibold', low && 'text-amber-ink')}>{stockText(p.stock_units, p.pack_size)}</div>
                          <Meter value={stockFill(p)} tone={low ? 'amber' : 'teal'} label="How full the shelf is" className="mt-1.5 w-28" />
                          {low && <div className="mt-1 text-sm text-amber-ink">Running low</div>}
                        </>
                      )}
                    </Td>
                    <Td>
                      <ExpiryPill date={p.expiry_date} compact />
                    </Td>
                    <Td num>
                      <div className="font-semibold text-ink">{money(p.single_price_cents)}</div>
                      {p.pack_size > 1 && <div className="text-sm text-ink-3">{money(p.sale_price_cents)} a pack</div>}
                    </Td>
                    {canReceive && (
                      <Td className="w-[1%] text-right">
                        <Button
                          size="sm"
                          icon={PackagePlus}
                          data-receive={p.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setReceiving(p);
                          }}
                        >
                          Receive
                        </Button>
                      </Td>
                    )}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={view.page} pageSize={PAGE_SIZE} total={filtered.length} noun="medicines" onChange={setPage} />
      </div>

      <MedicineDetail
        product={openId ? productById(openId) : null}
        onClose={() => setOpenId(null)}
        onReceive={(p) => {
          setOpenId(null);
          setReceiving(p);
        }}
        onEdit={(p) => {
          setOpenId(null);
          setEditing(p);
        }}
        onHistory={(p) => {
          setOpenId(null);
          history(p);
        }}
        onRemove={(id) => {
          setOpenId(null);
          remove(id);
        }}
      />
      <ProductDialog product={editing} onClose={() => setEditing(null)} />
      <ReceiveStockDialog product={receiving} onClose={() => setReceiving(null)} />
    </Page>
  );
}
