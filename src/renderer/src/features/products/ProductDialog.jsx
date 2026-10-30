import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { Modal, ModalBody, ModalFooter } from '../../ui/Modal.jsx';
import { Button, IconButton } from '../../ui/Button.jsx';
import { Field, Input, Select, Checkbox, Fieldset } from '../../ui/Field.jsx';
import { toCents, centsToInput, money, plural } from '../../lib/format.js';
import { CatalogQuickDialog } from '../catalog/Catalog.jsx';

function initialValues(product) {
  if (!product || product === 'new') {
    return {
      id: '',
      originalStockUnits: 0,
      barcode: '',
      title: '',
      genericName: '',
      categoryId: '',
      supplierId: '',
      packSize: '10',
      // Never pre-fill: a made-up date would hide the real expiry printed on the pack.
      expiryDate: '',
      minStockLevel: '5',
      stockPacks: '0',
      stockSingles: '0',
      costPrice: '0.00',
      salePrice: '',
      singlePrice: '',
      allowNegativeStock: false,
      prescriptionRequired: false,
      stockChangeReason: ''
    };
  }
  return {
    id: product.id,
    originalStockUnits: product.stock_units,
    barcode: product.barcode,
    title: product.title,
    genericName: product.generic_name,
    categoryId: product.category_id ? String(product.category_id) : '',
    supplierId: product.supplier_id ? String(product.supplier_id) : '',
    packSize: String(product.pack_size),
    expiryDate: product.expiry_date || '',
    minStockLevel: String(product.min_stock_level),
    stockPacks: String(product.stock_packs),
    stockSingles: String(product.stock_singles),
    costPrice: centsToInput(product.cost_price_cents),
    salePrice: centsToInput(product.sale_price_cents),
    singlePrice: centsToInput(product.single_price_cents),
    allowNegativeStock: product.allow_negative_stock === 1,
    prescriptionRequired: product.is_prescription_required === 1,
    stockChangeReason: ''
  };
}

/** Why there is less stock than before: only damage and loss cost the shop money (they show in Profit & loss). */
const STOCK_DECREASE_REASONS = [
  { value: 'MISTAKE', label: 'The old number was a counting or typing mistake' },
  { value: 'DAMAGED', label: 'Damaged or broken (counted as a loss)' },
  { value: 'LOST', label: 'Lost or missing (counted as a loss)' }
];

function cents(value, label) {
  const c = toCents(value);
  if (Number.isNaN(c) || c < 0) throw new Error(`${label} is not a valid amount`);
  return c;
}

/** product: null (closed) | 'new' | product row */
export function ProductDialog({ product, onClose }) {
  const { categories, suppliers, can, loadProducts, refreshAlerts } = useApp();
  const { toast, guard } = useToast();
  const [v, setV] = useState(() => initialValues(product));
  const [catalogOpen, setCatalogOpen] = useState(false);
  const open = Boolean(product);
  const isNew = product === 'new';

  useEffect(() => {
    if (!open) return;
    setV(initialValues(product));
    if (isNew) guard(async () => {
      const barcode = await call('products.generateBarcode');
      setV((cur) => ({ ...cur, barcode }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product]);

  const set = (name) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setV((cur) => {
      const next = { ...cur, [name]: value };
      // Unit price follows the pack price unless the user overrides it afterwards.
      if (name === 'salePrice' || name === 'packSize') {
        const pack = toCents(next.salePrice);
        const size = Number(next.packSize);
        if (!Number.isNaN(pack) && size >= 1) next.singlePrice = centsToInput(Math.round(pack / size));
      }
      return next;
    });
  };

  const generate = guard(async () => {
    const barcode = await call('products.generateBarcode');
    setV((cur) => ({ ...cur, barcode }));
  });

  const submit = guard(async (e) => {
    e.preventDefault();
    const packSize = Number(v.packSize);
    const saved = await call('products.save', {
      id: v.id ? Number(v.id) : null,
      originalStockUnits: Number(v.originalStockUnits) || 0,
      barcode: v.barcode,
      title: v.title,
      genericName: v.genericName,
      categoryId: v.categoryId ? Number(v.categoryId) : null,
      supplierId: v.supplierId ? Number(v.supplierId) : null,
      packSize,
      expiryDate: v.expiryDate || null,
      minStockLevel: Number(v.minStockLevel),
      stockUnits: Number(v.stockPacks) * packSize + Number(v.stockSingles),
      costPriceCents: cents(v.costPrice, 'Cost price'),
      salePriceCents: cents(v.salePrice, 'Sale price'),
      singlePriceCents: cents(v.singlePrice, 'Unit price'),
      allowNegativeStock: v.allowNegativeStock,
      prescriptionRequired: v.prescriptionRequired,
      stockChangeReason: v.stockChangeReason || undefined
    });
    onClose();
    toast(`${saved.title} saved`);
    await loadProducts();
    refreshAlerts();
  });

  const totalUnits = Number(v.stockPacks || 0) * Number(v.packSize || 0) + Number(v.stockSingles || 0);
  const stockGoesDown = !isNew && Number.isFinite(totalUnits) && totalUnits < Number(v.originalStockUnits);
  const margin = toCents(v.salePrice) - toCents(v.costPrice);
  const addCatalog = can('catalog.manage') && <IconButton icon={Plus} label="Add a category or supplier" data-action="manage-catalog" onClick={() => setCatalogOpen(true)} className="border border-foil-strong" />;

  return (
    <>
      <Modal open={open} onClose={onClose} title={isNew ? 'Add medicine' : 'Change medicine'} id="modalAddProduct" size="lg">
        <form id="addProductForm" onSubmit={submit} className="contents">
          <ModalBody className="gap-6">
            <Fieldset legend="Medicine">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Name and strength" className="col-span-2">
                  <Input name="title" value={v.title} onChange={set('title')} required maxLength={200} placeholder="e.g. Augmentin 625mg Tablet" />
                </Field>
                <Field label="Generic name" help="Optional. Helps when a customer asks by salt name.">
                  <Input name="genericName" value={v.genericName} onChange={set('genericName')} maxLength={200} />
                </Field>
                <Field label="Barcode" help="Scan the box, or create a store barcode.">
                  <div className="flex gap-2">
                    <Input name="barcode" value={v.barcode} onChange={set('barcode')} required maxLength={64} className="num" />
                    <Button id="btnAutoGenerateBarcode" onClick={generate}>
                      Generate
                    </Button>
                  </div>
                </Field>
                <Field label="Category">
                  <div className="flex gap-2">
                    <Select name="categoryId" id="prodCategory" value={v.categoryId} onChange={set('categoryId')}>
                      <option value="">No category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    {addCatalog}
                  </div>
                </Field>
                <Field label="Supplier">
                  <div className="flex gap-2">
                    <Select name="supplierId" id="prodSupplier" value={v.supplierId} onChange={set('supplierId')}>
                      <option value="">No supplier</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={String(s.id)}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                    {addCatalog}
                  </div>
                </Field>
                <Field label="Expiry date" help="As printed on the pack. Leave empty only if it never expires.">
                  <Input type="date" name="expiryDate" value={v.expiryDate} onChange={set('expiryDate')} />
                </Field>
                <div className="flex flex-col justify-end gap-2.5 pb-1">
                  <Checkbox name="prescriptionRequired" checked={v.prescriptionRequired} onChange={set('prescriptionRequired')} label="Prescription required" />
                  <Checkbox name="allowNegativeStock" checked={v.allowNegativeStock} onChange={set('allowNegativeStock')} label="Allow selling when out of stock" />
                </div>
              </div>
            </Fieldset>

            <Fieldset legend="Packing and stock">
              <div className="grid grid-cols-4 gap-4">
                <Field label="Units per pack">
                  <Input numeric type="number" name="packSize" value={v.packSize} onChange={set('packSize')} min={1} max={10000} required />
                </Field>
                <Field label="Full packs">
                  <Input numeric type="number" name="stockPacks" value={v.stockPacks} onChange={set('stockPacks')} required />
                </Field>
                <Field label="Loose units">
                  <Input numeric type="number" name="stockSingles" value={v.stockSingles} onChange={set('stockSingles')} min={0} required />
                </Field>
                <Field label="Warn below (packs)">
                  <Input numeric type="number" name="minStockLevel" value={v.minStockLevel} onChange={set('minStockLevel')} min={0} required />
                </Field>
              </div>
              <p className="num mt-2 text-sm text-ink-3">{Number.isFinite(totalUnits) ? `${totalUnits} units in stock in total.` : ''}</p>
              {!isNew && Number.isFinite(totalUnits) && totalUnits !== Number(v.originalStockUnits) && (
                <p className="num mt-1 rounded-control bg-amber-soft px-3 py-2 text-sm font-semibold text-amber-ink">
                  Stock will change by {totalUnits > Number(v.originalStockUnits) ? '+' : ''}
                  {plural(totalUnits - Number(v.originalStockUnits), 'unit')} (from {v.originalStockUnits} to {totalUnits}). To add a new delivery, use Receive stock instead.
                </p>
              )}
              {stockGoesDown && (
                <Field label="Why is there less stock?" className="mt-3">
                  <Select name="stockChangeReason" value={v.stockChangeReason} onChange={set('stockChangeReason')} required>
                    <option value="">Choose a reason…</option>
                    {STOCK_DECREASE_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </Fieldset>

            <Fieldset legend="Prices">
              <div className="grid grid-cols-3 gap-4">
                <Field label="Cost per pack (Rs)" help="What you pay the supplier.">
                  <Input numeric type="number" name="costPrice" value={v.costPrice} onChange={set('costPrice')} step="0.01" min={0} required />
                </Field>
                <Field label="Sale price per pack (Rs)" help={!Number.isNaN(margin) && v.salePrice ? `Margin ${money(margin)} per pack.` : undefined}>
                  <Input numeric type="number" name="salePrice" value={v.salePrice} onChange={set('salePrice')} step="0.01" min={0} required />
                </Field>
                <Field label="Sale price per unit (Rs)" help="Worked out from the pack price. You can change it.">
                  <Input numeric type="number" name="singlePrice" value={v.singlePrice} onChange={set('singlePrice')} step="0.01" min={0} required />
                </Field>
              </div>
            </Fieldset>
          </ModalBody>
          <ModalFooter>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary">
              {isNew ? 'Add medicine' : 'Save changes'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
      <CatalogQuickDialog open={catalogOpen} onClose={() => setCatalogOpen(false)} />
    </>
  );
}
