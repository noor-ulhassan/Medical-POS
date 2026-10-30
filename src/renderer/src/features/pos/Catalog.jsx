import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, SearchX, Plus, PackagePlus } from 'lucide-react';
import { useApp } from '../../state/AppState.jsx';
import { useCart } from '../../state/Cart.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { isAnyModalOpen } from '../../ui/Modal.jsx';
import { RxPill, EmptyState, IconTile } from '../../ui/display.jsx';
import { medicineIcon, categoryTone, stockLevel, STOCK_DOT } from '../../lib/look.js';
import { money, isLowStock, isOutOfStock, expiryStatus, shortDate } from '../../lib/format.js';
import { cx } from '../../ui/cx.js';

const LIMIT = 200;

/** Stock in plain words, coloured only when someone should notice. */
function stockWords(p) {
  if (expiryStatus(p.expiry_date).level === 'expired') return { text: `Expired ${shortDate(p.expiry_date)}`, tone: 'text-red-ink font-semibold' };
  if (isOutOfStock(p)) return { text: 'Sold out', tone: 'text-red-ink font-semibold' };
  const amount =
    p.pack_size > 1
      ? `${p.stock_packs} ${p.stock_packs === 1 ? 'pack' : 'packs'}${p.stock_singles ? ` + ${p.stock_singles} loose` : ''}`
      : String(p.stock_units);
  return isLowStock(p) ? { text: `Only ${amount} left`, tone: 'text-amber-ink font-semibold' } : { text: `${amount} in stock`, tone: '' };
}

const chip = (on, toned) =>
  cx(
    'flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-base font-semibold transition-colors',
    on
      ? toned
        ? 'border-accent bg-accent text-accent-on'
        : 'border-ink bg-ink text-surface'
      : 'border-foil-strong bg-surface text-ink-2 hover:border-ink-3 hover:text-ink'
  );

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

  // A barcode scanner types like a keyboard. If the cashier last clicked a
  // button or the list, the scan would be lost, so stray typing on this
  // screen is sent to the search box (Chromium delivers the key to the newly
  // focused field).
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1 || e.key === ' ') return;
      const el = document.activeElement;
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return;
      if (isAnyModalOpen()) return;
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  /**
   * After an item is added, the search text stays (so the list stays filtered)
   * but is selected: the next scan or typed name replaces it instead of being
   * added to the end of it.
   */
  const readyForNextScan = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  /** Add from a click, then put the cursor back in the search box ready for the next scan. */
  const addByClick = (product, unitType) => {
    cart.add(product, unitType);
    readyForNextScan();
  };

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
    // The highlighted row only counts for the text it was chosen from. Typing
    // (or a scan) clears it at once in onChange; this guards the same rule.
    if (active >= 0 && shown[active] && search.trim().toLowerCase() === query) {
      cart.add(shown[active], e.shiftKey ? 'PACK' : 'SINGLE');
      readyForNextScan();
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
      toast(`No medicine matches "${search.trim()}". Check the spelling or add it under Stock, Medicines.`, 'error');
    } else {
      toast(`${candidates.length} medicines match. Click the right one, or use the arrow keys and press Enter.`, 'info');
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
      <div className="px-5 pt-4">
        <label className="flex h-14 min-w-0 items-center gap-3 rounded-panel border border-foil-strong bg-surface px-5 shadow-sm transition-colors focus-within:border-teal focus-within:ring-2 focus-within:ring-teal/25">
          <Search className="size-6 shrink-0 text-ink-3" aria-hidden="true" />
          <input
            ref={inputRef}
            id="posSearchInput"
            type="text"
            value={search}
            onChange={(e) => {
              // A scanner types a whole barcode and Enter within a few milliseconds,
              // well before the search debounce; a stale highlight would add the
              // previously chosen medicine instead of the scanned one.
              setSearch(e.target.value);
              setActive(-1);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search medicine or scan barcode"
            autoComplete="off"
            spellCheck="false"
            role="combobox"
            aria-expanded="true"
            aria-controls="productGrid"
            aria-activedescendant={active >= 0 ? `product-${shown[active]?.id}` : undefined}
            className="h-full min-w-0 flex-1 bg-transparent text-lg text-ink outline-none placeholder:text-ink-3"
          />
        </label>
      </div>

      {(categories.length > 0 || suppliers.length > 0) && (
        <div className="flex shrink-0 items-center gap-2 px-5 pt-3">
          <div
            className="scrollbar-none flex min-w-0 flex-1 gap-2 overflow-x-auto"
            role="group"
            aria-label="Category"
            id="posCategoryChips"
            // Categories that do not fit stay reachable with an ordinary mouse wheel.
            onWheel={(e) => {
              if (e.deltaY && !e.deltaX) e.currentTarget.scrollLeft += e.deltaY;
            }}
          >
            {[{ id: 'ALL', name: 'All' }, ...categories].map((c) => {
              const value = String(c.id);
              const tone = c.id === 'ALL' ? undefined : categoryTone(c.id);
              return (
                <button
                  key={value}
                  type="button"
                  data-tone={tone}
                  aria-pressed={category === value}
                  onClick={() => {
                    setCategory(value);
                    setActive(-1);
                  }}
                  className={chip(category === value, Boolean(tone))}
                >
                  {tone && <span className={cx('size-2.5 rounded-full', category === value ? 'bg-accent-on' : 'bg-accent')} aria-hidden="true" />}
                  {c.name}
                </button>
              );
            })}
          </div>
          {suppliers.length > 0 && (
            <select
              id="posSupplierFilter"
              value={supplier}
              onChange={(e) => {
                setSupplier(e.target.value);
                setActive(-1);
              }}
              aria-label="Supplier"
              className={cx(chip(supplier !== 'ALL'), 'control !h-10 !w-auto max-w-[200px] !rounded-full !pr-9')}
            >
              <option value="ALL">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="mx-5 mb-4 mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-foil bg-surface shadow-card">
        <div ref={listRef} id="productGrid" role="listbox" aria-label="Products" className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 ? (
            <EmptyState icon={SearchX} title={products.length ? 'No medicine matches' : 'No medicines yet'}>
              {products.length ? 'Check the spelling, try the generic name, or tap All.' : 'Add medicines under Stock, then they appear here for sale.'}
            </EmptyState>
          ) : (
            shown.map((p, index) => {
              const out = isOutOfStock(p);
              const stock = stockWords(p);
              const level = stockLevel(p);
              const urgent = expiryStatus(p.expiry_date).level === 'urgent';
              return (
                <div
                  key={p.id}
                  id={`product-${p.id}`}
                  data-index={index}
                  data-product-id={p.id}
                  role="option"
                  aria-selected={index === active}
                  onClick={(e) => {
                    if (!e.target.closest('button')) addByClick(p, 'SINGLE');
                  }}
                  className={cx(
                    'product-card flex cursor-pointer items-center gap-4 border-b border-foil px-5 py-3 transition-colors last:border-b-0',
                    index === active ? 'bg-teal-soft' : 'hover:bg-sunken/70',
                    out && 'is-out'
                  )}
                >
                  <IconTile icon={medicineIcon(p.title)} tone={categoryTone(p.category_id)} className={cx(level !== 'ok' && level !== 'low' && 'opacity-50 grayscale')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cx('truncate text-md font-bold', out ? 'text-ink-2' : 'text-ink')} title={p.title}>
                        {p.title}
                      </span>
                      {p.is_prescription_required ? <RxPill /> : null}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-sm text-ink-2">
                      <span className={cx('size-2 shrink-0 rounded-full', STOCK_DOT[level])} aria-hidden="true" />
                      <span className="truncate">
                        <span className={stock.tone}>{stock.text}</span>
                        {urgent && <span className="font-semibold text-red-ink"> · expires {shortDate(p.expiry_date)}</span>}
                        {p.generic_name && ` · ${p.generic_name}`}
                      </span>
                    </div>
                  </div>
                  <div className="num shrink-0 text-right">
                    <div className={cx('text-lg font-bold leading-tight', out ? 'text-ink-2' : 'text-ink')}>{money(p.single_price_cents)}</div>
                    {p.pack_size > 1 && (
                      <div className="text-sm text-ink-3">
                        {money(p.sale_price_cents)} a pack of {p.pack_size}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {p.pack_size > 1 && (
                      <button
                        type="button"
                        onClick={() => addByClick(p, 'PACK')}
                        className={cx(
                          'flex h-11 items-center gap-1.5 rounded-control border px-3.5 text-base font-semibold',
                          out ? 'border-foil bg-sunken text-ink-3' : 'border-foil-strong bg-surface text-ink hover:border-teal hover:text-teal-ink'
                        )}
                        title={`Add one pack of ${p.pack_size} (${money(p.sale_price_cents)})`}
                      >
                        <PackagePlus className="size-[18px]" aria-hidden="true" />
                        Pack
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => addByClick(p, 'SINGLE')}
                      className={cx(
                        'flex h-11 items-center gap-1.5 rounded-control pl-3.5 pr-4 text-base font-bold',
                        out ? 'bg-sunken text-ink-3' : 'bg-teal text-teal-on hover:bg-teal-hover'
                      )}
                      title={p.pack_size > 1 ? `Add one unit (${money(p.single_price_cents)})` : `Add one (${money(p.single_price_cents)})`}
                    >
                      <Plus className="size-[18px]" strokeWidth={2.5} aria-hidden="true" />
                      Add
                    </button>
                  </div>
                </div>
              );
            })
          )}
          {matches.length > LIMIT && (
            <p className="num px-5 py-3 text-center text-sm text-ink-3">
              Showing {LIMIT} of {matches.length} medicines. Type more of the name to find the rest.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
