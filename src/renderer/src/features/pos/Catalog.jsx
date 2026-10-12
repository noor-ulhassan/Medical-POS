import { useEffect, useMemo, useRef, useState } from 'react';
import { ScanBarcode, SearchX, Plus } from 'lucide-react';
import { useApp } from '../../state/AppState.jsx';
import { useCart } from '../../state/Cart.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { Select } from '../../ui/Field.jsx';
import { ExpiryPill, Pill, RxPill, EmptyState } from '../../ui/display.jsx';
import { money, isLowStock, isOutOfStock } from '../../lib/format.js';
import { cx } from '../../ui/cx.js';

const LIMIT = 200;
// Columns follow the list's own width (container query), not the window: the cart and sidebar take varying space.
const COLS = 'grid grid-cols-[minmax(0,1fr)_92px_104px_136px] @[860px]:grid-cols-[minmax(0,1fr)_112px_96px_88px_96px_136px] items-center gap-x-3 @[860px]:gap-x-4';

function StockCell({ product }) {
  const out = isOutOfStock(product);
  const low = !out && isLowStock(product);
  return (
    <div className="num text-right leading-tight">
      {out ? (
        <Pill tone="red">Out of stock</Pill>
      ) : (
        <>
          <div className={cx('font-semibold', low ? 'text-amber-ink' : 'text-ink')}>
            {product.stock_packs} {product.stock_packs === 1 ? 'pack' : 'packs'}
          </div>
          <div className="text-xs text-ink-3">{product.stock_singles ? `+${product.stock_singles} loose` : low ? 'Low stock' : ' '}</div>
        </>
      )}
    </div>
  );
}

export function Catalog() {
  const { products, categories, suppliers } = useApp();
  const cart = useCart();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('ALL');
  const [supplier, setSupplier] = useState('ALL');
  const [active, setActive] = useState(-1);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const debounce = useRef(null);

  // Debounce typing so scanning/typing stays smooth with large catalogues.
  useEffect(() => {
    debounce.current = setTimeout(() => {
      setQuery(search.trim().toLowerCase());
      setActive(-1);
    }, 80);
    return () => clearTimeout(debounce.current);
  }, [search]);

  /** Apply a pending search right away (keyboard navigation must act on what was typed). Returns true if it changed. */
  function flushSearch() {
    const q = search.trim().toLowerCase();
    clearTimeout(debounce.current);
    if (q === query) return false;
    setQuery(q);
    return true;
  }

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const matches = useMemo(
    () =>
      products.filter((p) => {
        const text = `${p.title} ${p.generic_name} ${p.supplier_name || ''} ${p.barcode}`.toLowerCase();
        return (
          (!query || text.includes(query)) &&
          (category === 'ALL' || String(p.category_id) === category) &&
          (supplier === 'ALL' || String(p.supplier_id) === supplier)
        );
      }),
    [products, query, category, supplier]
  );
  const shown = matches.slice(0, LIMIT);


  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    listRef.current.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  /** Enter in the search box: exact barcode/name match, or the only match, goes into the cart. */
  function handleEnter(e) {
    if (active >= 0 && shown[active]) {
      cart.add(shown[active], e.shiftKey ? 'PACK' : 'SINGLE');
      return;
    }
    const value = search.trim().toLowerCase();
    if (!value) return;
    const exact = products.find((p) => p.barcode.toLowerCase() === value || p.title.toLowerCase() === value);
    const candidates = exact ? [exact] : products.filter((p) => `${p.title} ${p.generic_name} ${p.barcode}`.toLowerCase().includes(value));
    if (candidates.length === 1) {
      cart.add(candidates[0], e.shiftKey ? 'PACK' : 'SINGLE');
      setSearch('');
      setQuery('');
    } else if (candidates.length === 0) {
      toast(`No product matches "${search.trim()}"`, 'error');
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEnter(e);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flushSearch()) setActive(0);
      else setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flushSearch()) setActive(-1);
      else setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Escape' && search) {
      e.preventDefault();
      setSearch('');
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex gap-3 px-6 pt-4">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-panel border border-foil-strong bg-surface px-4 transition-colors focus-within:border-teal focus-within:ring-2 focus-within:ring-teal/25">
          <ScanBarcode className="size-5 shrink-0 text-ink-3" aria-hidden="true" />
          <input
            ref={inputRef}
            id="posSearchInput"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Scan a barcode or type a medicine name"
            autoComplete="off"
            spellCheck="false"
            role="combobox"
            aria-expanded="true"
            aria-controls="productGrid"
            aria-activedescendant={active >= 0 ? `product-${shown[active]?.id}` : undefined}
            className="h-full min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-ink-3"
          />
          <kbd>F1</kbd>
        </label>
        <Select id="posSupplierFilter" value={supplier} onChange={(e) => {
            setSupplier(e.target.value);
            setActive(-1);
          }} className="!h-11 !w-[184px] shrink-0" aria-label="Supplier">
          <option value="ALL">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="scrollbar-none flex gap-2 overflow-x-auto px-6 pt-3" role="group" aria-label="Category" id="posCategoryChips">
        {[{ id: 'ALL', name: 'All medicines' }, ...categories].map((c) => {
          const value = String(c.id);
          const on = category === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setCategory(value);
                setActive(-1);
              }}
              className={cx(
                'h-8 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition-colors',
                on ? 'border-teal bg-teal text-teal-on' : 'border-foil-strong bg-surface text-ink-2 hover:border-ink-3 hover:text-ink'
              )}
            >
              {c.name}
            </button>
          );
        })}
      </div>

      <div className="@container mx-6 mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-foil bg-surface">
        <div className={cx(COLS, 'border-b border-foil bg-sunken px-4 py-2 text-xs font-semibold text-ink-2')} aria-hidden="true">
          <span>Medicine</span>
          <span className="hidden @[860px]:block">Expiry</span>
          <span className="text-right">In stock</span>
          <span className="text-right">Unit price</span>
          <span className="hidden text-right @[860px]:block">Pack price</span>
          <span />
        </div>
        <div ref={listRef} id="productGrid" role="listbox" aria-label="Products" className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 ? (
            <EmptyState icon={SearchX} title={products.length ? 'No medicine matches' : 'No products yet'}>
              {products.length ? 'Check the spelling, try the generic name, or clear the filters.' : 'Add products under Stock, then they appear here for sale.'}
            </EmptyState>
          ) : (
            shown.map((p, index) => {
              const out = isOutOfStock(p);
              return (
                <div
                  key={p.id}
                  id={`product-${p.id}`}
                  data-index={index}
                  data-product-id={p.id}
                  role="option"
                  aria-selected={index === active}
                  onClick={(e) => {
                    if (!e.target.closest('button')) cart.add(p, 'SINGLE');
                  }}
                  className={cx(
                    COLS,
                    'product-card group cursor-pointer border-b border-foil px-4 py-2 transition-colors last:border-b-0',
                    index === active ? 'bg-teal-soft' : 'hover:bg-sunken/70',
                    out && 'is-out'
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cx('truncate text-base font-semibold', out ? 'text-ink-2' : 'text-ink')} title={p.title}>{p.title}</span>
                      {p.is_prescription_required ? <RxPill /> : null}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-sm text-ink-3">
                      <span className="truncate">{p.generic_name || p.barcode}</span>
                      <span className="@[860px]:hidden">
                        <ExpiryPill date={p.expiry_date} compact />
                      </span>
                    </div>
                  </div>
                  <div className="hidden @[860px]:block">
                    <ExpiryPill date={p.expiry_date} />
                  </div>
                  <StockCell product={p} />
                  <div className="num text-right">
                    <div className="font-semibold text-ink">{money(p.single_price_cents)}</div>
                    <div className="whitespace-nowrap text-xs text-ink-3 @[860px]:hidden">Pack {money(p.sale_price_cents)}</div>
                  </div>
                  <div className="num hidden text-right font-semibold text-ink @[860px]:block">{money(p.sale_price_cents)}</div>
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => cart.add(p, 'SINGLE')}
                      className="inline-flex h-8 items-center gap-1 rounded-control border border-foil-strong bg-surface px-2.5 text-sm font-semibold text-ink hover:border-teal hover:text-teal-ink"
                      title={`Add one unit (${money(p.single_price_cents)})`}
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                      Unit
                    </button>
                    <button
                      type="button"
                      onClick={() => cart.add(p, 'PACK')}
                      className="inline-flex h-8 items-center gap-1 rounded-control border border-foil-strong bg-surface px-2.5 text-sm font-semibold text-ink hover:border-teal hover:text-teal-ink"
                      title={`Add one pack of ${p.pack_size} (${money(p.sale_price_cents)})`}
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                      Pack
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex items-center gap-5 px-6 py-2.5 text-xs text-ink-3">
        <span className="flex items-center gap-1">
          <kbd>↑</kbd>
          <kbd>↓</kbd> choose
        </span>
        <span className="flex items-center gap-1">
          <kbd>Enter</kbd> add a unit
        </span>
        <span className="flex items-center gap-1">
          <kbd>Shift</kbd>+<kbd>Enter</kbd> add a pack
        </span>
        <span className="num ml-auto">
          {matches.length > LIMIT ? `Showing ${LIMIT} of ${matches.length}. Type to narrow down.` : `${matches.length} ${matches.length === 1 ? 'medicine' : 'medicines'}`}
        </span>
      </div>
    </div>
  );
}
