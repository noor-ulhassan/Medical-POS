import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Pencil, FileText, HandCoins, Users } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { WALK_IN_ID } from '../../state/Cart.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { useDocuments, LedgerStatement } from '../../print/Documents.jsx';
import { Modal, ModalBody, ModalFooter } from '../../ui/Modal.jsx';
import { Button, IconButton } from '../../ui/Button.jsx';
import { Field, Input, Select } from '../../ui/Field.jsx';
import { Page, PageHeader, SearchInput, Pill, EmptyState } from '../../ui/display.jsx';
import { Table, Th, Td, Tr, RowActions, Pagination, paginate } from '../../ui/Table.jsx';
import { money, toCents, centsToInput } from '../../lib/format.js';

const PAGE_SIZE = 25;

function CustomerDialog({ customer, onClose }) {
  const { loadCustomers } = useApp();
  const { toast, guard } = useToast();
  const [v, setV] = useState({ name: '', phone: '', address: '', creditLimit: '5000.00' });
  const isNew = customer === 'new';

  useEffect(() => {
    if (!customer) return;
    setV(
      isNew
        ? { name: '', phone: '', address: '', creditLimit: '5000.00' }
        : { name: customer.name, phone: customer.phone || '', address: customer.address || '', creditLimit: centsToInput(customer.credit_limit_cents) }
    );
  }, [customer, isNew]);

  const set = (name) => (e) => setV((cur) => ({ ...cur, [name]: e.target.value }));
  const submit = guard(async (e) => {
    e.preventDefault();
    const limit = toCents(v.creditLimit);
    if (Number.isNaN(limit) || limit < 0) throw new Error('Credit limit is not a valid amount');
    const saved = await call('customers.save', { id: isNew ? null : customer.id, name: v.name, phone: v.phone, address: v.address, creditLimitCents: limit });
    onClose();
    toast(`${saved.name} saved`);
    await loadCustomers();
  });

  return (
    <Modal open={Boolean(customer)} onClose={onClose} title={isNew ? 'Add customer' : 'Edit customer'} id="modalCustomer" size="sm">
      <form id="customerForm" onSubmit={submit} className="contents">
        <ModalBody>
          <Field label="Full name">
            <Input name="name" value={v.name} onChange={set('name')} required maxLength={120} />
          </Field>
          <Field label="Phone">
            <Input name="phone" value={v.phone} onChange={set('phone')} maxLength={60} />
          </Field>
          <Field label="Address">
            <Input name="address" value={v.address} onChange={set('address')} maxLength={250} />
          </Field>
          <Field label="Credit limit (Rs)" help="Khata sales are refused once the balance would go over this.">
            <Input numeric type="number" name="creditLimit" value={v.creditLimit} onChange={set('creditLimit')} min={0} step="0.01" required />
          </Field>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            {isNew ? 'Add customer' : 'Save changes'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** Only cash goes into the drawer, so Today's report needs to know how the customer paid. */
const KHATA_PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'MOBILE WALLET', label: 'Mobile wallet' },
  { value: 'BANK', label: 'Bank transfer' }
];

function PaymentDialog({ customer, onClose }) {
  const { loadCustomers } = useApp();
  const { toast, guard } = useToast();
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState('CASH');

  useEffect(() => {
    setAmount('');
    setNotes('');
    setMethod('CASH');
  }, [customer]);

  const submit = guard(async (e) => {
    e.preventDefault();
    const cents = toCents(amount);
    if (Number.isNaN(cents) || cents <= 0) throw new Error('Enter the amount received');
    const { customer: updated, balanceCents } = await call('customers.recordPayment', { customerId: customer.id, amountCents: cents, notes, paymentMethod: method });
    onClose();
    toast(`${money(cents)} received from ${updated.name}. Still owes ${money(balanceCents)}.`);
    await loadCustomers();
  });

  return (
    <Modal open={Boolean(customer)} onClose={onClose} title="Receive payment" id="modalRecordPayment" size="sm">
      <form id="paymentForm" onSubmit={submit} className="contents">
        <ModalBody>
          {customer && (
            <div className="flex items-center justify-between rounded-panel bg-sunken px-4 py-3">
              <div>
                <div className="text-sm text-ink-3">Customer</div>
                <div className="font-semibold text-ink">{customer.name}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-ink-3">Owes</div>
                <div className="num text-lg font-bold text-red-ink">{money(customer.current_debt_cents)}</div>
              </div>
            </div>
          )}
          <Field label="Amount received (Rs)">
            <Input numeric type="number" name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} step="0.01" min="0.01" required className="!h-12 !text-xl font-bold" />
          </Field>
          <Field label="Paid by" help="Only cash is counted in the cash that should be in the drawer.">
            <Select name="paymentMethod" value={method} onChange={(e) => setMethod(e.target.value)}>
              {KHATA_PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note">
            <Input name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={250} placeholder="e.g. Paid in cash at the counter" />
          </Field>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            Record payment
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

export function KhataView() {
  const { customers, can } = useApp();
  const { guard } = useToast();
  const { showDocument } = useDocuments();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [paying, setPaying] = useState(null);
  const canManage = can('customers.manage');
  const canPay = can('customers.payment');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? customers.filter((c) => `${c.name} ${c.phone}`.toLowerCase().includes(q)) : customers;
  }, [customers, search]);
  const view = paginate(filtered, page, PAGE_SIZE);

  const ledger = guard(async (c) => {
    const data = await call('customers.ledger', { customerId: c.id });
    showDocument(`Statement: ${c.name}`, <LedgerStatement {...data} />);
  });

  return (
    <Page id="khataView">
      <PageHeader
        title="Khata accounts"
        description="Customers who buy on credit, their limits and what they owe."
        actions={
          canManage && (
            <Button variant="primary" icon={Plus} id="btnOpenAddCustomer" onClick={() => setEditing('new')}>
              Add customer
            </Button>
          )
        }
      />
      <SearchInput
        icon={Search}
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Search by name or phone"
        className="w-[360px]"
      />
      <div className="overflow-hidden rounded-panel border border-foil bg-surface">
        {view.rows.length === 0 ? (
          <EmptyState icon={Users} title="No customers found">
            Add customers who buy on credit to keep track of what they owe.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Phone</Th>
                <Th num>Credit limit</Th>
                <Th num>Owes</Th>
                <Th num>Available</Th>
                <Th />
              </tr>
            </thead>
            <tbody id="customerTableBody">
              {view.rows.map((c) => {
                const walkIn = c.id === WALK_IN_ID;
                const available = c.credit_limit_cents - c.current_debt_cents;
                const over = c.current_debt_cents > c.credit_limit_cents;
                return (
                  <Tr key={c.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink">{c.name}</span>
                        {walkIn && <Pill>Cash only</Pill>}
                        {over && <Pill tone="red">Over limit</Pill>}
                      </div>
                      {c.address && <div className="mt-0.5 text-sm text-ink-3">{c.address}</div>}
                    </Td>
                    <Td muted className="num">{c.phone || '—'}</Td>
                    <Td num muted>{walkIn ? '—' : money(c.credit_limit_cents)}</Td>
                    <Td num className={c.current_debt_cents > 0 ? 'font-bold text-red-ink' : 'text-ink-2'}>
                      {c.current_debt_cents < 0 ? `${money(-c.current_debt_cents)} in advance` : money(c.current_debt_cents)}
                    </Td>
                    <Td num muted>{walkIn ? '—' : money(available)}</Td>
                    <Td className="w-[220px]">
                      {!walkIn && (
                        <RowActions>
                          {canPay && c.current_debt_cents > 0 && (
                            <Button size="sm" variant="secondary" icon={HandCoins} data-pay={c.id} onClick={() => setPaying(c)}>
                              Receive
                            </Button>
                          )}
                          <IconButton icon={FileText} label={`Statement for ${c.name}`} size="sm" data-ledger={c.id} onClick={() => ledger(c)} />
                          {canManage && <IconButton icon={Pencil} label={`Edit ${c.name}`} size="sm" data-edit={c.id} onClick={() => setEditing(c)} />}
                        </RowActions>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={view.page} pageSize={PAGE_SIZE} total={filtered.length} noun="customers" onChange={setPage} />
      </div>
      <CustomerDialog customer={editing} onClose={() => setEditing(null)} />
      <PaymentDialog customer={paying} onClose={() => setPaying(null)} />
    </Page>
  );
}
