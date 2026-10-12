import { useCallback, useEffect, useState } from 'react';
import { Trash2, CalendarCheck } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { useConfirm } from '../../ui/Confirm.jsx';
import { Button } from '../../ui/Button.jsx';
import { Page, PageHeader, Pill, EmptyState } from '../../ui/display.jsx';
import { Table, Th, Td, Tr } from '../../ui/Table.jsx';
import { splitUnits, shortDate } from '../../lib/format.js';
import { cx } from '../../ui/cx.js';

function Status({ days }) {
  if (days < 0) return <Pill tone="red">Expired {Math.abs(days)} {Math.abs(days) === 1 ? 'day' : 'days'} ago</Pill>;
  if (days === 0) return <Pill tone="red">Expires today</Pill>;
  return <Pill tone={days <= 30 ? 'red' : days <= 90 ? 'amber' : 'neutral'}>{days} days left</Pill>;
}

function Count({ id, label, note, value, tone }) {
  return (
    <div className="bg-surface px-6 py-5">
      <div className="text-sm font-semibold text-ink-2">{label}</div>
      <div id={id} className={cx('num mt-1.5 text-2xl font-bold', value > 0 && tone === 'red' ? 'text-red-ink' : value > 0 && tone === 'amber' ? 'text-amber-ink' : 'text-ink')}>
        {value}
      </div>
      <div className="mt-1 text-sm text-ink-3">{note}</div>
    </div>
  );
}

export function ExpiryView() {
  const { can, loadProducts, refreshAlerts } = useApp();
  const { toast, guard } = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const load = useCallback(() => guard(async () => setData(await call('reports.expiry')))(), [guard]);
  useEffect(() => {
    load();
  }, [load]);

  const discard = guard(async (p) => {
    const ok = await confirm({
      title: `Write off ${p.title}?`,
      message: 'All remaining stock of this product will be removed. This is recorded in its stock history.',
      confirmText: 'Write off stock',
      danger: true
    });
    if (!ok) return;
    await call('products.discardStock', { id: p.id, reason: 'Expired / near-expiry stock discarded' });
    toast(`${p.title} written off`);
    await loadProducts();
    await load();
    refreshAlerts();
  });

  const c = data?.counts || { expired: 0, within30: 0, within90: 0, within180: 0 };
  return (
    <Page id="expiryView">
      <PageHeader title="Expiry" description="Stock that has expired or expires within the next 6 months." />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-foil bg-foil xl:grid-cols-4">
        <Count id="statExpired" label="Expired" note="Take off the shelf" value={c.expired} tone="red" />
        <Count id="statExp30" label="Within 30 days" note="Sell first or return" value={c.within30} tone="red" />
        <Count id="statExp90" label="Within 90 days" note="Plan to sell" value={c.within90} tone="amber" />
        <Count id="statExp180" label="Within 6 months" note="Keep an eye on" value={c.within180} />
      </div>
      <div className="overflow-hidden rounded-panel border border-foil bg-surface">
        {data && data.rows.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="Nothing is close to expiry">
            No stock expires within the next 6 months.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Medicine</Th>
                <Th>Expiry date</Th>
                <Th>Status</Th>
                <Th num>In stock</Th>
                <Th />
              </tr>
            </thead>
            <tbody id="expiryTableBody">
              {data?.rows.map((p) => {
                const { packs, singles } = splitUnits(p.stock_units, p.pack_size);
                return (
                  <Tr key={p.id} tone={p.days_left < 0 ? 'danger' : undefined}>
                    <Td>
                      <div className="font-semibold text-ink">{p.title}</div>
                      <div className="num text-sm text-ink-3">{p.barcode}</div>
                    </Td>
                    <Td className="num">{shortDate(p.expiry_date)}</Td>
                    <Td>
                      <Status days={p.days_left} />
                    </Td>
                    <Td num>
                      {packs} {packs === 1 ? 'pack' : 'packs'}
                      {singles ? <span className="text-ink-3"> +{singles}</span> : null}
                    </Td>
                    <Td className="w-[160px] text-right">
                      {can('stock.adjust') && (
                        <Button size="sm" variant="danger-ghost" icon={Trash2} data-discard={p.id} onClick={() => discard(p)}>
                          Write off
                        </Button>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </Page>
  );
}
