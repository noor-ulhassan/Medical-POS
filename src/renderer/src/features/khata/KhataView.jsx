import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Pencil, FileText, HandCoins, Users } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { WALK_IN_ID } from '../../state/Cart.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { useDocuments, LedgerStatement } from '../../print/Documents.jsx';
import { Modal, ModalBody, ModalFooter } from '../../ui/Modal.jsx';
import { Button, ActionButton } from '../../ui/Button.jsx';
import { Field, Input, Select } from '../../ui/Field.jsx';
import { Page, PageHeader, SearchInput, Pill, EmptyState, Fact } from '../../ui/display.jsx';
import { Table, Th, Td, Tr, Pagination, paginate } from '../../ui/Table.jsx';
import { money, toCents, centsToInput } from '../../lib/format.js';
import { cx } from '../../ui/cx.js';

const PAGE_SIZE = 25;

function CustomerDialog({ customer, onClose }) {
  const { loadCustomers } = useApp();
  const { toast, guard } = useToast();
  const [v, setV] = useState({ name: '', phone: '', address: '', creditLimit: '5000.00', openingBalance: '' });
  const isNew = customer === 'new';
  // What they already owed in the old khata book; only before their first entry here.
  const canSetOpening = isNew || (customer && !customer.has_ledger);

  useEffect(() => {
    if (!customer) return;
    setV(
      isNew
        ? { name: '', phone: '', address: '', creditLimit: '5000.00', openingBalance: '' }
        : {
            name: customer.name,
            phone: customer.phone || '',
            address: customer.address || '',
            creditLimit: centsToInput(customer.credit_limit_cents),
            openingBalance: ''
          }
    );
  }, [customer, isNew]);

  const set = (name) => (e) => setV((cur) => ({ ...cur, [name]: e.target.value }));
  const submit = guard(async (e) => {
    e.preventDefault();
    const limit = toCents(v.creditLimit);
    if (Number.isNaN(limit) || limit < 0) throw new Error('Credit limit is not a valid amount');
    const opening = v.openingBalance.trim() === '' ? 0 : toCents(v.openingBalance);
    if (Number.isNaN(opening) || opening < 0) throw new Error('"Already owes" is not a valid amount');
    const saved = await call('customers.save', {
      id: isNew ? null : customer.id,
      name: v.name,
      phone: v.phone,
      address: v.address,
      creditLimitCents: limit,
      openingBalanceCents: canSetOpening && opening > 0 ? opening : undefined
    });
    onClose();
    toast(`${saved.name} saved`);
    await loadCustomers();
  });

  return (
    <Modal open={Boolean(customer)} onClose={onClose} title={isNew ? 'Add customer' : 'Change customer'} id="modalCustomer" size="sm">
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
          {canSetOpening && (
            <Field label="Already owes (Rs)" help="From your old khata book, if they owed you money before using this software. Leave empty if nothing. This can only be entered once.">
              <Input numeric type="number" name="openingBalance" value={v.openingBalance} onChange={set('openingBalance')} min={0} step="0.01" placeholder="0.00" />
            </Field>
          )}
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
    <Modal open={Boolean(customer)} onClose={onClose} title="Take a payment" id="modalRecordPayment" size="sm">
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

const owesText = (c) => (c.current_debt_cents < 0 ? `${money(-c.current_debt_cents)} paid in advance` : money(c.current_debt_cents));

/** One khata customer: what they owe next to everything that can be done with the account. */
function CustomerDetail({ customer, onClose, onPay, onStatement, onEdit }) {
  const { can } = useApp();
  const c = customer;
  return (
    <Modal open={Boolean(c)} onClose={onClose} title={c ? c.name : ''} description={c?.phone || undefined} id="modalCustomerDetail" size="lg">
      {c && (
        <ModalBody className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start gap-5 bg-sunken">
          <dl className="grid grid-cols-2 gap-4 rounded-panel border border-foil bg-surface p-5">
            <Fact label="Owes">
              <span className={cx('num text-lg', c.current_debt_cents > 0 && 'text-red-ink')}>{owesText(c)}</span>
            </Fact>
            <Fact label="Can still buy">
              <span className="num">{money(Math.max(c.credit_limit_cents - c.current_debt_cents, 0))}</span>
              {c.current_debt_cents > c.credit_limit_cents && <span className="block text-sm font-normal text-red-ink">Over the limit</span>}
            </Fact>
            <Fact label="Credit limit">
              <span className="num">{money(c.credit_limit_cents)}</span>
            </Fact>
            <Fact label="Phone">
              <span className="num">{c.phone || 'None'}</span>
            </Fact>
            {c.address && (
              <Fact label="Address" className="col-span-2">
                {c.address}
              </Fact>
            )}
          </dl>
          <div className="flex flex-col gap-2.5">
            {can('customers.payment') && c.current_debt_cents > 0 && (
              <ActionButton icon={HandCoins} tone="primary" data-pay={c.id} onClick={() => onPay(c)}>
                Take a payment
              </ActionButton>
            )}
            <ActionButton icon={FileText} data-ledger={c.id} onClick={() => onStatement(c)}>
              See and print statement
            </ActionButton>
            {can('customers.manage') && (
              <ActionButton icon={Pencil} data-edit={c.id} onClick={() => onEdit(c)}>
                Change details or limit
              </ActionButton>
            )}
          </div>
        </ModalBody>
      )}
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
  const [openId, setOpenId] = useState(null);
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
        title="Khata"
        description="Customers who buy now and pay later. Tap a customer to see their statement or change their limit."
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
        placeholder="Search name or phone"
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
                <Th num>Owes</Th>
                <Th num>Can still buy</Th>
                {canPay && <Th />}
              </tr>
            </thead>
            <tbody id="customerTableBody">
              {view.rows.map((c) => {
                const walkIn = c.id === WALK_IN_ID;
                const over = c.current_debt_cents > c.credit_limit_cents;
                return (
                  <Tr key={c.id} data-open-customer={walkIn ? undefined : c.id} onOpen={walkIn ? undefined : () => setOpenId(c.id)}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink">{c.name}</span>
                        {walkIn && <Pill>Cash only</Pill>}
                        {over && <Pill tone="red">Over limit</Pill>}
                      </div>
                      {(c.phone || c.address) && <div className="num mt-0.5 text-sm text-ink-3">{[c.phone, c.address].filter(Boolean).join(' · ')}</div>}
                    </Td>
                    <Td num className={c.current_debt_cents > 0 ? 'font-bold text-red-ink' : 'text-ink-2'}>
                      {owesText(c)}
                    </Td>
                    <Td num>
                      {walkIn ? null : (
                        <>
                          <div className="font-semibold text-ink">{money(Math.max(c.credit_limit_cents - c.current_debt_cents, 0))}</div>
                          <div className="text-sm text-ink-3">limit {money(c.credit_limit_cents)}</div>
                        </>
                      )}
                    </Td>
                    {canPay && (
                      <Td className="w-[1%] text-right">
                        {!walkIn && c.current_debt_cents > 0 && (
                          <Button
                            size="sm"
                            icon={HandCoins}
                            data-pay={c.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPaying(c);
                            }}
                          >
                            Take payment
                          </Button>
                        )}
                      </Td>
                    )}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={view.page} pageSize={PAGE_SIZE} total={filtered.length} noun="customers" onChange={setPage} />
      </div>
      <CustomerDetail
        customer={openId ? customers.find((c) => c.id === openId) : null}
        onClose={() => setOpenId(null)}
        onPay={(c) => {
          setOpenId(null);
          setPaying(c);
        }}
        onStatement={(c) => {
          setOpenId(null);
          ledger(c);
        }}
        onEdit={(c) => {
          setOpenId(null);
          setEditing(c);
        }}
      />
      <CustomerDialog customer={editing} onClose={() => setEditing(null)} />
      <PaymentDialog customer={paying} onClose={() => setPaying(null)} />
    </Page>
  );
}
