import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ClipboardList, ChartColumn, TriangleAlert } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { Button } from '../../ui/Button.jsx';
import { Page, PageHeader, Panel, EmptyState } from '../../ui/display.jsx';
import { Table, Th, Td, Tr, EmptyRow } from '../../ui/Table.jsx';
import { money, plural } from '../../lib/format.js';
import { cx } from '../../ui/cx.js';

const METHOD_LABELS = { CASH: 'Cash', CARD: 'Card', 'MOBILE WALLET': 'Mobile wallet', CREDIT: 'Khata' };
/** A few typos a day are normal; this many suggests someone is guessing. */
const WRONG_PIN_WARNING = 10;

function Stat({ label, value, note, id, noteId, tone }) {
  return (
    <div className="min-w-0 bg-surface px-6 py-5">
      <div className="text-sm font-semibold text-ink-2">{label}</div>
      <div id={id} className={cx('num mt-1.5 break-words text-2xl font-bold tracking-[-0.02em]', tone === 'danger' ? 'text-red-ink' : 'text-ink')}>
        {value}
      </div>
      <div id={noteId} className="mt-1 text-sm text-ink-3">
        {note}
      </div>
    </div>
  );
}


/** End-of-day cash check in plain words: what came in today and what should be in the drawer. */
function TodayCash({ today }) {
  if (!today) return null;
  const by = (m) => today.byMethod.find((x) => x.payment_method === m) || { count: 0, total_cents: 0 };
  const rows = [
    { label: 'Cash sales', method: 'CASH' },
    { label: 'Card', method: 'CARD' },
    { label: 'Mobile wallet', method: 'MOBILE WALLET' },
    { label: 'On khata (not paid yet)', method: 'CREDIT' }
  ];
  return (
    <Panel title="Today's money">
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <dl id="dashTodayByMethod" className="divide-y divide-foil text-base">
          {rows.map((r) => {
            const m = by(r.method);
            return (
              <div key={r.method} className="flex items-baseline justify-between py-2">
                <dt className="text-ink-2">
                  {r.label} <span className="text-sm text-ink-3">({plural(m.count, 'sale')})</span>
                </dt>
                <dd className="num font-semibold text-ink">{money(m.total_cents)}</dd>
              </div>
            );
          })}
          <div className="flex items-baseline justify-between py-2">
            <dt className="text-ink-2">
              Khata payments received
              {today.khataPaymentsCents !== today.khataCashPaymentsCents && (
                <span className="text-sm text-ink-3"> ({money(today.khataCashPaymentsCents)} in cash)</span>
              )}
            </dt>
            <dd className="num font-semibold text-ink">{money(today.khataPaymentsCents)}</dd>
          </div>
          {today.discountCount > 0 && (
            <div className="flex items-baseline justify-between py-2">
              <dt className="text-ink-2">
                Discounts given <span className="text-sm text-ink-3">({plural(today.discountCount, 'sale')}, see the activity log)</span>
              </dt>
              <dd id="dashTodayDiscounts" className="num font-semibold text-ink">{money(today.discountCents)}</dd>
            </div>
          )}
          {today.drawerExpensesCents > 0 && (
            <div className="flex items-baseline justify-between py-2">
              <dt className="text-ink-2">Expenses paid from the drawer</dt>
              <dd className="num font-semibold text-ink">{money(today.drawerExpensesCents)}</dd>
            </div>
          )}
          {today.returnCount > 0 && (
            <div className="flex items-baseline justify-between py-2">
              <dt className="text-ink-2">
                Items returned today <span className="text-sm text-ink-3">({plural(today.returnCount, 'return')}, {money(today.cashReturnsCents)} in cash)</span>
              </dt>
              <dd id="dashTodayReturns" className="num font-semibold text-red-ink">{money(today.returnsCents)}</dd>
            </div>
          )}
          {today.voidCount > 0 && (
            <div className="flex items-baseline justify-between py-2">
              <dt className="text-ink-2">Cancelled sales today ({today.voidCount})</dt>
              <dd className="num font-semibold text-red-ink">{money(today.voidTotalCents)}</dd>
            </div>
          )}
        </dl>
        <div className="flex flex-col justify-center rounded-panel bg-teal-soft px-6 py-5 text-teal-ink">
          <div className="text-base font-semibold">Cash that should be in the drawer</div>
          <div id="dashExpectedCash" className="num mt-1 text-3xl font-bold tracking-[-0.02em]">
            {money(today.expectedCashCents)}
          </div>
          <p className="mt-2 text-sm">
            Cash sales {money(today.cashSalesCents)} + khata payments in cash {money(today.khataCashPaymentsCents)}
            {today.cashRefundsCents > 0 ? ` − cash given back ${money(today.cashRefundsCents)}` : ''}
            {today.cashReturnsCents > 0 ? ` − cash given back for returns ${money(today.cashReturnsCents)}` : ''}
            {today.drawerExpensesCents > 0 ? ` − expenses paid from the drawer ${money(today.drawerExpensesCents)}` : ''}. Add the cash you started the day with, then count
            the drawer.
          </p>
        </div>
      </div>
    </Panel>
  );
}

/** Backups that exist only on this computer are lost with it; say so where the owner looks every day. */
function BackupCopyWarning({ copy }) {
  const { can, go } = useApp();
  if (!copy) return null;
  let message = null;
  if (!copy.dir) message = 'Backups are only on this computer. If its disk fails or it is stolen, all sales, stock and khata records are lost.';
  else if (copy.lastError) message = copy.lastError;
  else if (copy.daysSinceCopy === null || copy.daysSinceCopy >= 2) {
    message = `Backups have not been copied to ${copy.dir} ${copy.daysSinceCopy === null ? 'yet' : `for ${plural(copy.daysSinceCopy, 'day')}`}. Is the USB drive plugged in?`;
  }
  if (!message) return null;
  return (
    <div id="dashBackupWarning" className="flex flex-wrap items-center justify-between gap-3 rounded-panel bg-amber-soft px-5 py-3.5 text-base text-amber-ink">
      <span className="flex items-center gap-3">
        <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
        {message}
      </span>
      {can('backup.manage') ? (
        <Button size="sm" onClick={() => go('settingsView')}>
          Open Settings
        </Button>
      ) : (
        <span className="text-sm">Ask the owner to set this up in Settings, Backup and restore.</span>
      )}
    </div>
  );
}

export function DashboardView() {
  const { go, can } = useApp();
  const { guard } = useToast();
  const [data, setData] = useState(null);

  const load = useCallback(() => guard(async () => setData(await call('reports.dashboard')))(), [guard]);
  useEffect(() => {
    load();
  }, [load]);

  const d = data;
  const max = d ? Math.max(...d.trend.map((t) => t.totalCents), 1) : 1;
  const grand = d ? d.paymentBreakdown.reduce((s, p) => s + p.total_cents, 0) || 1 : 1;

  return (
    <Page id="dashboardView">
      <PageHeader
        title="Today's report"
        description="How the shop is doing today, what customers owe, and what needs your attention."
        actions={
          <Button icon={RefreshCw} id="btnRefreshDashboard" onClick={load}>
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-foil bg-foil xl:grid-cols-4">
        <Stat label="Today's sales" id="dashTodaySales" noteId="dashTodayInvoices" value={money(d?.todayRevenueCents)} note={d ? (d.todayInvoices ? plural(d.todayInvoices, 'sale') + ' today' : 'No sales yet today') : ' '} />
        <Stat label="All-time sales" id="dashTotalSales" noteId="dashTotalInvoices" value={money(d?.totalRevenueCents)} note={d ? plural(d.totalInvoices, 'sale') : ' '} />
        <Stat label="Owed on khata" id="dashCustomerDebt" value={money(d?.outstandingDebtCents)} note="Outstanding customer balances" />
        <Stat label="Medicines needing attention" id="dashRiskAlerts" value={d ? d.riskCount : 0} note="Running low or expiring in 6 months" tone={d?.riskCount ? 'danger' : undefined} />
      </div>

      <BackupCopyWarning copy={d?.backupCopy} />

      {d && d.wrongPinsToday >= WRONG_PIN_WARNING && (
        <div id="dashWrongPins" className="flex items-center gap-3 rounded-panel bg-red-soft px-5 py-3.5 text-base text-red-ink">
          <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
          <span>
            {plural(d.wrongPinsToday, 'wrong PIN')} were entered today. Someone may be trying to guess a PIN: the owner can see when in Settings, Activity log, and
            give staff new PINs.
          </span>
        </div>
      )}

      <TodayCash today={d?.today} />

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Panel title="Last 7 days">
          <div id="chartSalesTrendContainer" className="flex h-[220px] items-end gap-3">
            {d?.trend.map((t, i) => {
              const today = i === d.trend.length - 1;
              const height = t.totalCents ? Math.max(4, Math.round((t.totalCents / max) * 100)) : 0;
              const [y, m, day] = t.day.split('-').map(Number);
              const label = new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: 'short' });
              return (
                <div key={t.day} className="flex h-full flex-1 flex-col items-center justify-end gap-2" title={`${t.day}: ${money(t.totalCents)}`}>
                  <span className="num text-xs font-semibold text-ink-2">{t.totalCents ? money(t.totalCents).replace('Rs ', '') : ''}</span>
                  <div className="flex h-full w-full items-end justify-center border-b border-foil-strong">
                    <div className={cx('w-full max-w-[56px] rounded-t transition-[height]', today ? 'bg-teal' : 'bg-teal/45')} style={{ height: `${height}%` }} />
                  </div>
                  <span className={cx('text-xs', today ? 'font-bold text-ink' : 'text-ink-3')}>{today ? 'Today' : label}</span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="How customers paid (all time)">
          <div id="chartPaymentDistribution" className="flex h-[220px] flex-col justify-center gap-4">
            {d && d.paymentBreakdown.length === 0 && <EmptyState icon={ChartColumn} title="No sales yet" className="py-4" />}
            {d?.paymentBreakdown.map((p) => {
              const pct = Math.round((p.total_cents / grand) * 100);
              return (
                <div key={p.payment_method}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="font-semibold text-ink">{METHOD_LABELS[p.payment_method] || p.payment_method}</span>
                    <span className="num text-ink-2">
                      {money(p.total_cents)} <span className="text-ink-3">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full bg-teal" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Best sellers" flush>
          <Table>
            <thead>
              <tr>
                <Th>Medicine</Th>
                <Th num>Sold</Th>
                <Th num>Revenue</Th>
              </tr>
            </thead>
            <tbody id="dashTopDemandingBody">
              {d && d.topProducts.length === 0 && <EmptyRow colSpan={3}>No sales yet.</EmptyRow>}
              {d?.topProducts.map((p) => (
                <Tr key={`${p.product_title}-${p.unit_type}`}>
                  <Td className="font-semibold">{p.product_title}</Td>
                  <Td num>
                    {p.total_qty} <span className="text-ink-3">{p.unit_type === 'PACK' ? 'packs' : 'units'}</span>
                  </Td>
                  <Td num>{money(p.total_cents)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <Panel title="Suppliers to reorder from" flush>
          <Table>
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th num>Low stock items</Th>
                <Th />
              </tr>
            </thead>
            <tbody id="dashSupplyScheduleBody">
              {d && d.supplierRestock.length === 0 && <EmptyRow colSpan={3}>Every supplier's stock is above its minimum.</EmptyRow>}
              {d?.supplierRestock.map((s) => (
                <Tr key={s.supplier_id}>
                  <Td className="font-semibold">{s.supplier_name}</Td>
                  <Td num className="text-amber-ink">
                    {s.low_count}
                  </Td>
                  <Td className="text-right">
                    {can('restock.view') && (
                      <Button size="sm" icon={ClipboardList} onClick={() => go('ordersView')}>
                        Reorder
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>
    </Page>
  );
}
