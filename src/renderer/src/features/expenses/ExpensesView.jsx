import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Info, Wallet, TrendingUp } from 'lucide-react';
import expensesShared from '@shared/expenses.js';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { useConfirm } from '../../ui/Confirm.jsx';
import { Button, IconButton } from '../../ui/Button.jsx';
import { Field, Input, Select, Checkbox } from '../../ui/Field.jsx';
import { Page, PageHeader, Panel, Pill, EmptyState, IconTile } from '../../ui/display.jsx';
import { Table, Th, Td, Tr } from '../../ui/Table.jsx';
import { money, toCents, shortDate, plural } from '../../lib/format.js';
import { expenseLook } from '../../lib/look.js';

const { EXPENSE_CATEGORIES, expenseCategoryLabel } = expensesShared;

const CATEGORY_HELP = {
  SUPPLIES: 'Bags, stationery, cleaning things.',
  LICENCES_FEES: 'Drug licence, trade licence, government fees.',
  BANK_CHARGES: 'Card machine charges, bank fees.',
  OTHER: 'Write what it was for in the note.'
};

const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

const blankForm = () => ({ expenseDate: todayYmd(), category: '', amount: '', paidFromDrawer: false, note: '' });

export function ExpensesView() {
  const { can, go } = useApp();
  const { toast, guard } = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState(blankForm);
  const [month, setMonth] = useState(() => todayYmd().slice(0, 7));
  const [rows, setRows] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => guard(async () => setRows(await call('expenses.list', monthRange(month))))(), [guard, month]);
  useEffect(() => {
    load();
  }, [load]);

  const set = (name) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const submit = guard(async (e) => {
    e.preventDefault();
    if (saving) return;
    const amountCents = toCents(form.amount);
    if (Number.isNaN(amountCents) || amountCents <= 0) throw new Error('Enter the amount that was paid');
    if (!form.category) throw new Error('Choose what the money was spent on');
    setSaving(true);
    try {
      const saved = await call('expenses.create', { ...form, amountCents });
      toast(`${money(saved.amount_cents)} for ${expenseCategoryLabel(saved.category).toLowerCase()} saved`);
      setForm({ ...blankForm(), expenseDate: form.expenseDate });
      if (saved.expense_date.slice(0, 7) !== month) setMonth(saved.expense_date.slice(0, 7));
      else await load();
    } finally {
      setSaving(false);
    }
  });

  const remove = guard(async (row) => {
    const ok = await confirm({
      title: 'Delete this expense?',
      message: `${money(row.amount_cents)} for ${expenseCategoryLabel(row.category).toLowerCase()} on ${shortDate(row.expense_date)} will be removed from the reports. It stays in the activity log.`,
      confirmText: 'Delete expense',
      danger: true
    });
    if (!ok) return;
    await call('expenses.remove', { id: row.id, reason: 'Deleted on the Expenses screen' });
    toast('Expense deleted');
    await load();
  });

  const totals = useMemo(() => {
    const list = rows || [];
    const byCategory = new Map();
    for (const r of list) byCategory.set(r.category, (byCategory.get(r.category) || 0) + r.amount_cents);
    return {
      total: list.reduce((n, r) => n + r.amount_cents, 0),
      fromDrawer: list.filter((r) => r.paid_from_drawer).reduce((n, r) => n + r.amount_cents, 0),
      byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1])
    };
  }, [rows]);

  const monthName = (() => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  })();

  return (
    <Page id="expensesView">
      <PageHeader
        title="Expenses"
        description="Money the shop spends to keep running: rent, salaries, bills and so on."
        actions={
          can('reports.view') && (
            <Button icon={TrendingUp} onClick={() => go('profitView')}>
              See profit
            </Button>
          )
        }
      />

      <div className="flex gap-3 rounded-panel bg-sunken px-4 py-3 text-base text-ink-2">
        <Info className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden="true" />
        <span>
          Do not enter payments to suppliers for medicines here. The cost of every medicine sold is already subtracted automatically, so entering it again would count it twice.
        </span>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[380px_1fr]">
        <Panel title="Record an expense">
          <form id="expenseForm" onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Date">
              <Input type="date" name="expenseDate" value={form.expenseDate} max={todayYmd()} onChange={set('expenseDate')} required />
            </Field>
            <Field label="What was it for?" help={CATEGORY_HELP[form.category]}>
              <Select name="category" value={form.category} onChange={set('category')} required>
                <option value="">Choose one</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount paid (Rs)">
              <Input numeric type="number" name="amount" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} required className="!h-12 !text-xl font-bold" />
            </Field>
            <Checkbox name="paidFromDrawer" checked={form.paidFromDrawer} onChange={set('paidFromDrawer')} label="Paid with cash from the shop's drawer" />
            <p className="-mt-2 text-xs text-ink-3">Tick this if the money came out of today's till, so the end-of-day cash count stays right.</p>
            <Field label="Note">
              <Input name="note" value={form.note} onChange={set('note')} maxLength={250} placeholder="e.g. October rent" />
            </Field>
            <Button type="submit" variant="primary" icon={Plus} disabled={saving}>
              Save expense
            </Button>
          </form>
        </Panel>

        <Panel
          title={`Expenses in ${monthName}`}
          flush
          actions={
            <label className="flex items-center gap-2 text-sm font-semibold text-ink-2">
              Month
              <Input type="month" value={month} max={todayYmd().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="!h-8 !w-[170px]" aria-label="Month" />
            </label>
          }
        >
          {rows && rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-foil px-5 py-3">
              <div>
                <div className="text-sm text-ink-3">Total</div>
                <div id="expensesMonthTotal" className="text-xl font-bold text-ink">
                  {money(totals.total)}
                </div>
              </div>
              {totals.fromDrawer > 0 && (
                <div>
                  <div className="text-sm text-ink-3">Paid from the drawer</div>
                  <div className="text-md font-semibold text-ink">{money(totals.fromDrawer)}</div>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {totals.byCategory.map(([category, cents]) => (
                  <Pill key={category}>
                    {expenseCategoryLabel(category)} <span className="num">{money(cents)}</span>
                  </Pill>
                ))}
              </div>
            </div>
          )}
          {rows && rows.length === 0 ? (
            <EmptyState icon={Wallet} title={`No expenses recorded for ${monthName}`}>
              Use the form to record rent, salaries, bills and other running costs.
            </EmptyState>
          ) : (
            <Table maxHeight={560}>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>For</Th>
                  <Th>Note</Th>
                  <Th num>Amount</Th>
                  <Th>Paid from</Th>
                  <Th />
                </tr>
              </thead>
              <tbody id="expensesTableBody">
                {(rows || []).map((r) => (
                  <Tr key={r.id}>
                    <Td className="num whitespace-nowrap">{shortDate(r.expense_date)}</Td>
                    <Td className="min-w-[150px] font-semibold text-ink">
                      <span className="flex items-center gap-2.5">
                        <IconTile icon={expenseLook(r.category).icon} tone={expenseLook(r.category).tone} size="sm" />
                        {expenseCategoryLabel(r.category)}
                      </span>
                    </Td>
                    <Td muted className="min-w-[180px] max-w-[320px] break-words">
                      {r.note || '—'}
                      <div className="text-xs text-ink-3">by {r.user_name}</div>
                    </Td>
                    <Td num className="whitespace-nowrap font-semibold text-ink">{money(r.amount_cents)}</Td>
                    <Td muted className="whitespace-nowrap">{r.paid_from_drawer ? 'Cash drawer' : 'Other'}</Td>
                    <Td className="w-12 text-right">
                      <IconButton icon={Trash2} label="Delete this expense" size="sm" tone="danger" data-expense-delete={r.id} onClick={() => remove(r)} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {rows && rows.length > 0 && <p className="border-t border-foil px-5 py-2.5 text-sm text-ink-3">{plural(rows.length, 'entry', 'entries')}</p>}
        </Panel>
      </div>
    </Page>
  );
}
