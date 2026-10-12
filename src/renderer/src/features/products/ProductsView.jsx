import { useMemo, useState } from 'react';
import { Plus, Pencil, History, Trash2, Search, PackageOpen } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { useConfirm } from '../../ui/Confirm.jsx';
import { useDocuments, StockHistory } from '../../print/Documents.jsx';
import { Button, IconButton } from '../../ui/Button.jsx';
import { Page, PageHeader, Segmented, SearchInput, ExpiryPill, Pill, RxPill, EmptyState } from '../../ui/display.jsx';
import { Table, Th, Td, Tr, RowActions, Pagination, paginate } from '../../ui/Table.jsx';
import { money, isLowStock, isOutOfStock } from '../../lib/format.js';
import { ProductDialog } from './ProductDialog.jsx';

const PAGE_SIZE = 25;

export function ProductsView() {
  const { products, can, productById, loadProducts, refreshAlerts } = useApp();
  const { toast, guard } = useToast();
  const confirm = useConfirm();
  const { showDocument } = useDocuments();
  const [search, setSearch] = useState('');
  const [stock, setStock] = useState('ALL');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // null | 'new' | product
  const manage = can('products.manage');

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
      message: 'Products with past sales are archived instead, so reports and voids keep working.',
      confirmText: 'Remove product',
      danger: true
    });
    if (!ok) return;
    const { mode } = await call('products.remove', { id });
    toast(mode === 'archived' ? `${product.title} archived` : `${product.title} removed`);
    await loadProducts();
    refreshAlerts();
  });

  const history = guard(async (product) => showDocument(`Stock history: ${product.title}`, <StockHistory product={product} entries={await call('products.stockHistory', { id: product.id })} />));

  return (
    <Page id="inventoryView">
      <PageHeader
        title="Products"
        description="Prices, stock and expiry for everything you sell."
        actions={
          manage && (
            <Button variant="primary" icon={Plus} id="btnOpenAddProduct" onClick={() => setEditing('new')}>
              Add product
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
          placeholder="Search by name, generic name or barcode"
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

      <div className="overflow-hidden rounded-panel border border-foil bg-surface">
        {view.rows.length === 0 ? (
          <EmptyState icon={PackageOpen} title={products.length ? 'No products match' : 'No products yet'}>
            {products.length ? 'Try a different search or filter.' : 'Add your first product to start selling.'}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Medicine</Th>
                <Th>Category</Th>
                <Th>Expiry</Th>
                <Th num>In stock</Th>
                <Th num>Unit price</Th>
                <Th num>Pack price</Th>
                <Th />
              </tr>
            </thead>
            <tbody id="inventoryTableBody">
              {view.rows.map((p) => {
                const out = isOutOfStock(p);
                const low = !out && isLowStock(p);
                return (
                  <Tr key={p.id} tone={out ? 'danger' : low ? 'warn' : undefined}>
                    <Td className="min-w-[260px]">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink">{p.title}</span>
                        {p.is_prescription_required ? <RxPill /> : null}
                      </div>
                      <div className="mt-0.5 flex gap-3 whitespace-nowrap text-sm text-ink-3">
                        {p.generic_name && <span className="truncate">{p.generic_name}</span>}
                        <span className="num">{p.barcode}</span>
                      </div>
                    </Td>
                    <Td muted className="max-w-[160px]">{p.category_name || '—'}</Td>
                    <Td>
                      <ExpiryPill date={p.expiry_date} compact />
                    </Td>
                    <Td num>
                      {out ? (
                        <Pill tone="red">Out of stock</Pill>
                      ) : (
                        <div className="leading-tight">
                          <div className={low ? 'font-semibold text-amber-ink' : 'font-semibold'}>
                            {p.stock_packs} × {p.pack_size}
                          </div>
                          <div className="text-xs text-ink-3">{p.stock_singles ? `+${p.stock_singles} loose` : low ? 'Low stock' : `${p.stock_units} units`}</div>
                        </div>
                      )}
                    </Td>
                    <Td num>{money(p.single_price_cents)}</Td>
                    <Td num>{money(p.sale_price_cents)}</Td>
                    <Td className="w-[120px]">
                      <RowActions>
                        {manage && <IconButton icon={Pencil} label={`Edit ${p.title}`} size="sm" data-edit={p.id} onClick={() => setEditing(p)} />}
                        <IconButton icon={History} label="Stock history" size="sm" data-history={p.id} onClick={() => history(p)} />
                        {manage && <IconButton icon={Trash2} label={`Remove ${p.title}`} size="sm" tone="danger" data-remove={p.id} onClick={() => remove(p.id)} />}
                      </RowActions>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={view.page} pageSize={PAGE_SIZE} total={filtered.length} noun="products" onChange={setPage} />
      </div>

      <ProductDialog product={editing} onClose={() => setEditing(null)} />
    </Page>
  );
}
