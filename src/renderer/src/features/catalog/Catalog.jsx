import { useState } from 'react';
import { Plus, Truck, Tag } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { Button } from '../../ui/Button.jsx';
import { Field, Input } from '../../ui/Field.jsx';
import { Modal, ModalBody, ModalFooter } from '../../ui/Modal.jsx';
import { Page, PageHeader, Panel, EmptyState } from '../../ui/display.jsx';
import { Table, Th, Td, Tr } from '../../ui/Table.jsx';
import { cx } from '../../ui/cx.js';

const EMPTY_SUPPLIER = { id: '', name: '', contactPerson: '', phone: '', email: '', address: '' };
const EMPTY_CATEGORY = { id: '', name: '' };

/** Shared save logic: after a change, categories/suppliers and product rows (which show their names) reload. */
function useSave(method, label, reset) {
  const { loadCatalog, loadProducts } = useApp();
  const { toast, guard } = useToast();
  return guard(async (values) => {
    const saved = await call(method, { ...values, id: values.id ? Number(values.id) : null });
    toast(`${label} "${saved.name}" saved`);
    reset();
    await loadCatalog();
    await loadProducts();
  });
}

export function useSupplierForm({ id, compact = false, onDone }) {
  const [values, setValues] = useState(EMPTY_SUPPLIER);
  const save = useSave('catalog.saveSupplier', 'Supplier', () => {
    setValues(EMPTY_SUPPLIER);
    onDone?.();
  });
  const set = (name) => (e) => setValues((v) => ({ ...v, [name]: e.target.value }));
  const editing = Boolean(values.id);
  return {
    startNew: () => setValues(EMPTY_SUPPLIER),
    editing,
    startEdit: (s) => setValues({ id: s.id, name: s.name, contactPerson: s.contact_person || '', phone: s.phone || '', email: s.email || '', address: s.address || '' }),
    editingId: values.id,
    form: (
      <form
        id={id}
        onSubmit={(e) => {
          e.preventDefault();
          save(values);
        }}
        className="flex flex-col gap-3"
      >
        <div className={cx('grid gap-3', compact ? 'grid-cols-2' : 'grid-cols-2')}>
          <Field label="Company name">
            <Input name="name" value={values.name} onChange={set('name')} required maxLength={120} placeholder="e.g. Getz Pharma" />
          </Field>
          <Field label="Contact person">
            <Input name="contactPerson" value={values.contactPerson} onChange={set('contactPerson')} maxLength={120} />
          </Field>
          <Field label="Phone">
            <Input name="phone" value={values.phone} onChange={set('phone')} maxLength={60} />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" value={values.email} onChange={set('email')} maxLength={120} />
          </Field>
          <Field label="Address" className="col-span-2">
            <Input name="address" value={values.address} onChange={set('address')} maxLength={250} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          {(editing || onDone) && (
            <Button
              onClick={() => {
                setValues(EMPTY_SUPPLIER);
                onDone?.();
              }}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" variant="primary">
            {editing ? 'Save supplier' : 'Add supplier'}
          </Button>
        </div>
      </form>
    )
  };
}

export function useCategoryForm({ id }) {
  const [values, setValues] = useState(EMPTY_CATEGORY);
  const save = useSave('catalog.saveCategory', 'Category', () => setValues(EMPTY_CATEGORY));
  const editing = Boolean(values.id);
  return {
    startEdit: (c) => setValues({ id: c.id, name: c.name }),
    editingId: values.id,
    form: (
      <form
        id={id}
        onSubmit={(e) => {
          e.preventDefault();
          save(values);
        }}
        className="flex items-end gap-2"
      >
        <Field label={editing ? 'Rename category' : 'New category'} className="flex-1">
          <Input name="name" value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} required maxLength={80} placeholder="e.g. Antibiotics" />
        </Field>
        {editing && <Button onClick={() => setValues(EMPTY_CATEGORY)}>Cancel</Button>}
        <Button type="submit" variant="primary">
          {editing ? 'Save' : 'Add'}
        </Button>
      </form>
    )
  };
}

function SupplierTable({ supplier, maxHeight, showAddress = true, onEdit = supplier.startEdit }) {
  const { suppliers } = useApp();
  if (suppliers.length === 0) return <EmptyState icon={Truck} title="No suppliers yet" className="py-8">Add the companies and distributors you buy from.</EmptyState>;
  return (
    <Table maxHeight={maxHeight}>
      <thead>
        <tr>
          <Th>Supplier</Th>
          <Th>Contact</Th>
          <Th>Phone</Th>
          {showAddress && <Th>Address</Th>}
          <Th />
        </tr>
      </thead>
      <tbody id={showAddress ? 'pageSuppliersTableBody' : 'suppliersListModalBody'}>
        {suppliers.map((s) => (
          <Tr key={s.id} className={cx(String(supplier.editingId) === String(s.id) && '!bg-teal-soft')}>
            <Td className="font-semibold">{s.name}</Td>
            <Td muted>{s.contact_person || '—'}</Td>
            <Td muted className="num">{s.phone || '—'}</Td>
            {showAddress && <Td muted>{s.address || '—'}</Td>}
            <Td className="w-[1%] text-right">
              <Button size="sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => onEdit(s)}>
                Edit
              </Button>
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

function CategoryTable({ category, maxHeight, bodyId }) {
  const { categories } = useApp();
  if (categories.length === 0) return <EmptyState icon={Tag} title="No categories yet" className="py-8">Group medicines, for example Antibiotics or Vitamins.</EmptyState>;
  return (
    <Table maxHeight={maxHeight}>
      <thead>
        <tr>
          <Th>Category</Th>
          <Th />
        </tr>
      </thead>
      <tbody id={bodyId}>
        {categories.map((c) => (
          <Tr key={c.id} className={cx(String(category.editingId) === String(c.id) && '!bg-teal-soft')}>
            <Td className="font-semibold">{c.name}</Td>
            <Td className="w-[1%] text-right">
              <Button size="sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => category.startEdit(c)}>
                Edit
              </Button>
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

export function SuppliersView() {
  const [supplierOpen, setSupplierOpen] = useState(false);
  const supplier = useSupplierForm({ id: 'pageSupplierForm', onDone: () => setSupplierOpen(false) });
  const category = useCategoryForm({ id: 'pageCategoryForm' });
  return (
    <Page id="suppliersView">
      <PageHeader
        title="Suppliers and categories"
        description="Who you buy from, and the groups your medicines are sorted into."
        actions={
          <Button
            variant="primary"
            icon={Plus}
            id="btnAddSupplier"
            onClick={() => {
              supplier.startNew();
              setSupplierOpen(true);
            }}
          >
            Add supplier
          </Button>
        }
      />
      <div className="grid items-start gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="Suppliers" flush>
          <SupplierTable
            supplier={supplier}
            maxHeight={560}
            onEdit={(s) => {
              supplier.startEdit(s);
              setSupplierOpen(true);
            }}
          />
        </Panel>
        <Panel title="Categories" flush>
          <div className="border-b border-foil p-5">{category.form}</div>
          <CategoryTable category={category} maxHeight={460} bodyId="pageCategoriesTableBody" />
        </Panel>
      </div>
      <Modal
        open={supplierOpen}
        onClose={() => {
          supplier.startNew();
          setSupplierOpen(false);
        }}
        title={supplier.editing ? 'Change supplier' : 'Add supplier'}
        id="modalSupplier"
        size="md"
      >
        <ModalBody>{supplier.form}</ModalBody>
      </Modal>
    </Page>
  );
}

/** Quick add/edit opened from the product form, stacked above it. */
export function CatalogQuickDialog({ open, onClose }) {
  const supplier = useSupplierForm({ id: 'addSupplierForm', compact: true });
  const category = useCategoryForm({ id: 'addCategoryForm' });
  return (
    <Modal open={open} onClose={onClose} title="Suppliers and categories" description="Anything you add here can be picked for the medicine straight away." id="modalManageSuppliers" size="lg">
      <ModalBody className="gap-5">
        <section className="flex flex-col gap-3">
          {category.form}
          <div className="overflow-hidden rounded-panel border border-foil">
            <CategoryTable category={category} maxHeight={150} bodyId="categoriesListModalBody" />
          </div>
        </section>
        <section className="flex flex-col gap-3 border-t border-foil pt-5">
          {supplier.form}
          <div className="overflow-hidden rounded-panel border border-foil">
            <SupplierTable supplier={supplier} maxHeight={170} showAddress={false} />
          </div>
        </section>
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose}>Done</Button>
      </ModalFooter>
    </Modal>
  );
}
