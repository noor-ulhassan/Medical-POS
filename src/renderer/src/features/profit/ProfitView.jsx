import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Wallet, TriangleAlert, TrendingUp, ChevronDown, ChevronUp, ShoppingCart } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, BarChart, Bar, LabelList } from 'recharts';
import expensesShared from '@shared/expenses.js';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { Button } from '../../ui/Button.jsx';
import { Input } from '../../ui/Field.jsx';
import { Page, PageHeader, Panel, Segmented, Pill, EmptyState, IconTile } from '../../ui/display.jsx';
import { Table, Th, Td, Tr, EmptyRow } from '../../ui/Table.jsx';
import { money, compactMoney, percentText, plural } from '../../lib/format.js';
import { cx } from '../../ui/cx.js';

const { expenseCategoryLabel } = expensesShared;

// ------------------------------------------------------------------ periods

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Preset periods in the shop's local calendar. Every range ends today at the latest. */
function presetRange(preset) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = ymd(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: ymd(new Date(y, m, now.getDate() - 6)), to: today };
    case 'lastMonth':
      return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case 'last3Months':
      return { from: ymd(new Date(y, m - 2, 1)), to: today };
    case 'thisYear':
      return { from: ymd(new Date(y, 0, 1)), to: today };
    case 'thisMonth':
    default:
      return { from: ymd(new Date(y, m, 1)), to: today };
  }
}

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'last3Months', label: 'Last 3 months' },
  { value: 'thisYear', label: 'This year' },
  { value: 'custom', label: 'Choose dates' }
];

const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};
const dayLabel = (s) => parse(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const longDay = (s) => parse(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Axis label and exact tooltip label for a bucket; partial months say which days they cover. */
function bucketLabels(key, granularity, from, to) {
  if (granularity === 'day') {
    return {
      short: dayLabel(key),
      row: parse(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
      full: parse(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    };
  }
  const [y, m] = key.split('-').map(Number);
  const first = ymd(new Date(y, m - 1, 1));
  const last = ymd(new Date(y, m, 0));
  const start = from > first ? from : first;
  const end = to < last ? to : last;
  const monthName = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const full = start === first && end === last ? monthName : `${monthName} (${dayLabel(start)} to ${dayLabel(end)} only)`;
  return { short: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), row: full, full };
}

// ------------------------------------------------------------------ pieces

const SERIES = [
  { key: 'netSalesCents', label: 'Net sales', color: 'var(--chart-1)', mark: 'area' },
  { key: 'grossProfitCents', label: 'Gross profit', color: 'var(--chart-2)', mark: 'line' },
  { key: 'netProfitCents', label: 'Net profit', color: 'var(--chart-3)', mark: 'line' }
];

function LegendKey({ color, mark }) {
  return mark === 'area' ? (
    <span className="inline-block h-2.5 w-3.5 rounded-[3px]" style={{ background: color, opacity: 0.85 }} aria-hidden="true" />
  ) : (
    <span className="inline-block h-[2px] w-4 rounded" style={{ background: color }} aria-hidden="true" />
  );
}

/** A money figure is never cut off: if it does not fit it wraps instead of being truncated. */
function Tile({ label, value, note, id, icon, tone }) {
  return (
    <div className="flex min-w-0 flex-col bg-surface px-6 py-5">
      <div className="flex items-center gap-2.5 text-sm font-semibold text-ink-2">
        <IconTile icon={icon} tone={tone} size="sm" />
        {label}
      </div>
      <div id={id} className="mt-1.5 break-words text-2xl font-bold tracking-[-0.02em] text-ink">
        {value}
      </div>
      {note && <div className="mt-1 text-sm text-ink-3">{note}</div>}
    </div>
  );
}

/** The one number the screen leads with, with the sum that produces it spelled out. */
function NetProfitHero({ s }) {
  const loss = s.netProfitCents < 0;
  const marginNote =
    s.netMarginPct === null
      ? 'No sales with a known cost in this period'
      : loss
        ? `The loss equals ${percentText(Math.abs(s.netMarginPct))} of sales`
        : `${percentText(s.netMarginPct)} of sales kept as profit`;
  const part = (label, cents, sign) => (
    <div className="flex items-baseline gap-2">
      <span className="w-3 text-ink-3">{sign}</span>
      <span className="text-ink-2">{label}</span>
      <span className="num ml-auto font-semibold text-ink">{money(cents)}</span>
    </div>
  );
  return (
    <div className="col-span-full flex flex-wrap items-center justify-between gap-x-10 gap-y-4 bg-surface px-6 py-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-base font-semibold text-ink-2">
          Net profit
          {loss && <Pill tone="red">Loss</Pill>}
        </div>
        <div id="profitNetProfit" className="mt-1 break-words text-3xl font-bold tracking-[-0.02em] text-ink">
          {money(s.netProfitCents)}
        </div>
        <div className="mt-1 text-sm text-ink-3">{marginNote}</div>
      </div>
      <div className="w-full max-w-[420px] space-y-1 text-base" aria-label="How net profit is worked out">
        {part('Gross profit', s.grossProfitCents, '')}
        {part('Expenses', s.expensesCents, '−')}
        {part('Stock written off (expired, damaged, lost)', s.writeOffCents, '−')}
        <div className="flex items-baseline gap-2 border-t border-foil pt-1 font-bold">
          <span className="w-3 text-ink-3">=</span>
          <span className="text-ink">Net profit</span>
          <span className="num ml-auto text-ink">{money(s.netProfitCents)}</span>
        </div>
      </div>
    </div>
  );
}

function Notice({ children }) {
  return (
    <div className="flex gap-3 rounded-panel border border-amber/30 bg-amber-soft px-4 py-3 text-base text-amber-ink" role="status">
      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function TrendTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div className="min-w-[220px] rounded-panel border border-foil bg-surface shadow-card px-3.5 py-3 text-sm shadow-pop">
      <div className="mb-2 font-semibold text-ink-2">{row.fullLabel}</div>
      {SERIES.map((s) => (
        <div key={s.key} className="flex items-center gap-2 py-0.5">
          <LegendKey color={s.color} mark="line" />
          <span className="num font-bold text-ink">{money(row[s.key])}</span>
          <span className="text-ink-3">{s.label}</span>
        </div>
      ))}
      <div className="mt-1.5 border-t border-foil pt-1.5 text-ink-3">
        <span className="num font-semibold text-ink-2">{money(row.expensesCents)}</span> expenses
        {row.writeOffCents ? (
          <>
            , <span className="num font-semibold text-ink-2">{money(row.writeOffCents)}</span> written off
          </>
        ) : null}
        <br />
        {plural(row.salesCount, 'sale')}
      </div>
    </div>
  );
}

function TrendChart({ data, hasNegative }) {
  return (
    <div className="h-[340px] w-full" role="img" aria-label="Net sales, gross profit and net profit over the period. The exact numbers are in the table below.">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="rgb(var(--foil))" />
          <XAxis dataKey="shortLabel" tick={{ fill: 'rgb(var(--ink-3))', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'rgb(var(--foil-strong))' }} minTickGap={16} />
          <YAxis tickFormatter={compactMoney} tick={{ fill: 'rgb(var(--ink-3))', fontSize: 12 }} tickLine={false} axisLine={false} width={72} />
          {hasNegative && <ReferenceLine y={0} stroke="rgb(var(--foil-strong))" />}
          <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'rgb(var(--ink-3))', strokeWidth: 1 }} />
          {/* Straight segments: values exist only on each day, nothing is invented in between. */}
          <Area type="linear" dataKey="netSalesCents" name="Net sales" stroke="var(--chart-1)" strokeWidth={2} fill="var(--chart-1)" fillOpacity={0.1} isAnimationActive={false} activeDot={{ r: 4, stroke: 'rgb(var(--surface))', strokeWidth: 2 }} dot={false} />
          <Line type="linear" dataKey="grossProfitCents" name="Gross profit" stroke="var(--chart-2)" strokeWidth={2} isAnimationActive={false} activeDot={{ r: 4, stroke: 'rgb(var(--surface))', strokeWidth: 2 }} dot={data.length <= 12 ? { r: 3, strokeWidth: 0, fill: 'var(--chart-2)' } : false} />
          <Line type="linear" dataKey="netProfitCents" name="Net profit" stroke="var(--chart-3)" strokeWidth={2} isAnimationActive={false} activeDot={{ r: 4, stroke: 'rgb(var(--surface))', strokeWidth: 2 }} dot={data.length <= 12 ? { r: 3, strokeWidth: 0, fill: 'var(--chart-3)' } : false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ExpenseTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-panel border border-foil bg-surface shadow-card px-3.5 py-2.5 text-sm shadow-pop">
      <div className="num font-bold text-ink">{money(row.amountCents)}</div>
      <div className="text-ink-3">
        {row.label}, {plural(row.count, 'entry', 'entries')}
      </div>
    </div>
  );
}

/** The exact amount on one line just past the end of its bar (never wrapped or squeezed into the bar). */
function BarEndLabel({ x, y, width, height, value }) {
  return (
    <text x={x + width + 8} y={y + height / 2} dominantBaseline="central" fill="rgb(var(--ink))" fontSize={13} fontWeight={600} className="num">
      {money(value)}
    </text>
  );
}

function ExpensesChart({ rows }) {
  const data = rows.map((r) => ({ ...r, label: expenseCategoryLabel(r.category) }));
  const max = Math.max(...data.map((d) => d.amountCents), 1);
  return (
    <div style={{ height: data.length * 40 + 8 }} role="img" aria-label="Expenses by type. The exact amounts are listed next to each bar.">
      <ResponsiveContainer width="100%" height="100%">
        {/* Bars fill the plot; the right margin is where the exact amounts are printed. */}
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 120, bottom: 0, left: 0 }} barCategoryGap={10}>
          <XAxis type="number" hide domain={[0, max]} />
          <YAxis type="category" dataKey="label" width={180} tick={{ fill: 'rgb(var(--ink-2))', fontSize: 13 }} tickLine={false} axisLine={false} />
          <Tooltip content={<ExpenseTooltip />} cursor={{ fill: 'rgb(var(--sunken))' }} />
          <Bar dataKey="amountCents" fill="var(--chart-4)" barSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            <LabelList dataKey="amountCents" content={BarEndLabel} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked rows with an inline bar for the profit; every value is printed, the bar only helps the eye. */
function ProfitRanking({ rows, nameHeader, showUnits }) {
  const max = Math.max(...rows.map((r) => r.profitCents), 1);
  return (
    <Table>
      <thead>
        <tr>
          <Th>{nameHeader}</Th>
          {showUnits && <Th num>Units sold</Th>}
          <Th num>Sales</Th>
          <Th num>Cost</Th>
          <Th num>Profit</Th>
          <Th num>Margin</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.productId || r.name}>
            <Td className="min-w-[180px]">
              <div className="font-semibold text-ink">{r.title || r.name}</div>
              <div className="mt-1 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                <div className="h-full rounded-full" style={{ width: `${Math.max(0, (r.profitCents / max) * 100)}%`, background: 'var(--chart-2)' }} />
              </div>
            </Td>
            {showUnits && <Td num muted>{r.units}</Td>}
            <Td num>{money(r.revenueCents)}</Td>
            <Td num muted>{money(r.costCents)}</Td>
            <Td num className={cx('font-semibold', r.profitCents < 0 ? 'text-red-ink' : 'text-ink')}>{money(r.profitCents)}</Td>
            <Td num muted>{percentText(r.marginPct)}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Gross profit per category as labelled bars. Every amount is printed; the bar is only a guide for the eye. */
function CategoryProfit({ rows }) {
  const max = Math.max(...rows.map((r) => r.profitCents), 1);
  return (
    <ul className="flex flex-col gap-4" id="profitByCategory">
      {rows.map((r) => (
        <li key={r.name}>
          <div className="flex items-baseline justify-between gap-3 text-base">
            <span className="min-w-0 truncate font-semibold text-ink" title={r.name}>
              {r.name}
            </span>
            <span className={cx('num whitespace-nowrap font-semibold', r.profitCents < 0 ? 'text-red-ink' : 'text-ink')}>
              {money(r.profitCents)} <span className="font-normal text-ink-3">{percentText(r.marginPct)}</span>
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, (r.profitCents / max) * 100)}%`, background: 'var(--chart-2)' }} />
          </div>
          <div className="num mt-1 text-xs text-ink-3">
            Sales {money(r.revenueCents)}, cost {money(r.costCents)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatementRow({ label, value, sign, strong, note, id }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-4 py-2', strong && 'border-t border-foil font-bold text-ink')}>
      <span className={cx(strong ? 'text-ink' : 'text-ink-2')}>
        {sign && <span className="inline-block w-4 text-ink-3">{sign}</span>}
        {label}
        {note && <span className="ml-1.5 text-sm font-normal text-ink-3">{note}</span>}
      </span>
      <span id={id} className={cx('num whitespace-nowrap', strong ? 'text-ink' : 'text-ink-2')}>
        {money(value)}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ screen

export function ProfitView() {
  const { can, go } = useApp();
  const { guard } = useToast();
  const [preset, setPreset] = useState('thisMonth');
  const [custom, setCustom] = useState(() => presetRange('thisMonth'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);

  const range = preset === 'custom' ? custom : presetRange(preset);

  const load = useCallback(
    () =>
      guard(async () => {
        if (!range.from || !range.to || range.to < range.from) return;
        setLoading(true);
        try {
          setData(await call('reports.profit', range));
        } finally {
          setLoading(false);
        }
      })(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guard, range.from, range.to]
  );
  useEffect(() => {
    load();
  }, [load]);

  const chart = useMemo(() => {
    if (!data) return [];
    return data.series.map((b) => {
      const labels = bucketLabels(b.key, data.granularity, data.from, data.to);
      return { ...b, shortLabel: labels.short, rowLabel: labels.row, fullLabel: labels.full };
    });
  }, [data]);

  const s = data?.summary;
  const hasNegative = chart.some((b) => b.netProfitCents < 0 || b.grossProfitCents < 0);
  const unit = data?.granularity === 'month' ? 'month' : 'day';

  return (
    <Page id="profitView">
      <PageHeader
        title="Profit & loss"
        description="What the shop earned after paying for the medicines it sold and its running costs."
        actions={
          <>
            {can('expenses.manage') && (
              <Button icon={Wallet} onClick={() => go('expensesView')}>
                Record an expense
              </Button>
            )}
            <Button icon={RefreshCw} onClick={load}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Period" value={preset} onChange={setPreset} options={PRESETS} />
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="!w-[160px]" />
            <span className="text-ink-3">to</span>
            <Input type="date" aria-label="To" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="!w-[160px]" />
          </div>
        )}
        {data && (
          <span className="text-base text-ink-2" id="profitPeriodLabel">
            {data.from === data.to ? longDay(data.from) : `${longDay(data.from)} to ${longDay(data.to)}`}
          </span>
        )}
      </div>

      {!data ? (
        <div className="h-40" />
      ) : (
        <div className={cx('flex flex-col gap-5 transition-opacity', loading && 'opacity-60')}>
          {s.uncostedSalesCount > 0 && (
            <Notice>
              <strong>{plural(s.uncostedSalesCount, 'sale')}</strong> worth <strong className="num">{money(s.uncostedNetSalesCents)}</strong> are not counted in the
              profit below, because some medicines in them had no cost price when they were sold (or they were sold before this version of the software).
              {data.productsMissingCost > 0 && (
                <>
                  {' '}
                  {plural(data.productsMissingCost, 'medicine')} still {data.productsMissingCost === 1 ? 'has' : 'have'} no cost price. Add it under Stock, Medicines so future sales are counted.
                </>
              )}
              {can('products.manage') && data.productsMissingCost > 0 && (
                <div className="mt-2">
                  <Button size="sm" onClick={() => go('inventoryView')}>
                    Open Medicines
                  </Button>
                </div>
              )}
            </Notice>
          )}
          {s.uncostedSalesCount === 0 && data.productsMissingCost > 0 && (
            <Notice>
              {plural(data.productsMissingCost, 'medicine')} {data.productsMissingCost === 1 ? 'has' : 'have'} no cost price yet. Sales of{' '}
              {data.productsMissingCost === 1 ? 'it' : 'them'} will be left out of profit until you add one under Stock, Medicines.
            </Notice>
          )}
          {s.writeOffUnknownCount > 0 && (
            <Notice>
              {plural(s.writeOffUnknownCount, 'stock write-off')} in this period {s.writeOffUnknownCount === 1 ? 'has' : 'have'} no value (the medicine had no cost price), so{' '}
              {s.writeOffUnknownCount === 1 ? 'it is' : 'they are'} not subtracted below.
            </Notice>
          )}

          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-panel border border-foil bg-foil md:grid-cols-3">
            <NetProfitHero s={s} />
            <Tile id="profitNetSales" icon={ShoppingCart} tone={2} label="Net sales" value={money(s.netSalesCents)} note={`${plural(s.salesCount, 'sale')}, average ${money(s.averageSaleCents)}`} />
            <Tile
              id="profitGrossProfit"
              icon={TrendingUp}
              tone={1}
              label="Gross profit"
              value={money(s.grossProfitCents)}
              note={`${percentText(s.grossMarginPct)} margin, ${percentText(s.markupPct)} markup on cost`}
            />
            <Tile
              id="profitExpenses"
              icon={Wallet}
              tone={5}
              label="Expenses"
              value={money(s.expensesCents)}
              note={s.writeOffCents > 0 ? `+ ${money(s.writeOffCents)} stock written off` : plural(s.expenseCount, 'entry', 'entries')}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
            <Panel
              title="Sales and profit over time"
              actions={
                <div className="flex flex-wrap items-center gap-4 text-sm text-ink-2" aria-label="Legend">
                  {SERIES.map((x) => (
                    <span key={x.key} className="flex items-center gap-1.5">
                      <LegendKey color={x.color} mark={x.mark} />
                      {x.label}
                    </span>
                  ))}
                </div>
              }
            >
              {chart.length < 2 ? (
                <EmptyState icon={TrendingUp} title="Choose a longer period to see the trend" className="h-[340px]">
                  One {unit} has no trend; its numbers are in the tiles above and the statement alongside.
                </EmptyState>
              ) : (
                <TrendChart data={chart} hasNegative={hasNegative} />
              )}
            </Panel>

            <Panel title="Profit and loss statement">
              <div className="text-base" id="profitStatement">
                <StatementRow label="Sales before discounts" value={s.grossSalesCents} />
                <StatementRow sign="−" label="Discounts given" value={s.discountCents} />
                {s.returnsCount > 0 && <StatementRow sign="−" label="Returned by customers" note={`(${s.returnsCount})`} value={s.returnsNetCents} />}
                <StatementRow strong label="Net sales" value={s.netSalesCents} id="stmtNetSales" />
                {s.uncostedSalesCount > 0 && (
                  <>
                    <StatementRow sign="−" label="Left out: sales with unknown cost" note={`(${s.uncostedSalesCount})`} value={s.uncostedNetSalesCents} />
                    <StatementRow strong label="Net sales used for profit" value={s.costedNetSalesCents} />
                  </>
                )}
                <StatementRow sign="−" label="Cost of medicines sold" value={s.cogsCents} />
                <StatementRow strong label="Gross profit" note={percentText(s.grossMarginPct)} value={s.grossProfitCents} />
                <StatementRow sign="−" label="Expenses" value={s.expensesCents} />
                <StatementRow sign="−" label="Stock written off: expired, damaged or lost" note="(at cost)" value={s.writeOffCents} />
                <StatementRow strong label="Net profit" note={percentText(s.netMarginPct)} value={s.netProfitCents} id="stmtNetProfit" />
                <div className="mt-3 rounded-control bg-sunken px-3 py-2.5 text-sm text-ink-2">
                  Customers paid <strong className="num text-ink">{money(s.collectedCents)}</strong> in total. That includes{' '}
                  <strong className="num text-ink">{money(s.taxAndFeesCents)}</strong> of sales tax and receipt fees, which belong to the government and are not counted as sales.
                </div>
              </div>
            </Panel>
          </div>

          <Button id="btnProfitMore" icon={more ? ChevronUp : ChevronDown} aria-expanded={more} onClick={() => setMore((v) => !v)} className="self-start">
            {more ? 'Show less' : 'Show more: expenses by type, best medicines, day by day'}
          </Button>

          {more && (
            <>
              <div className="grid gap-5 xl:grid-cols-2">
                <Panel title="Expenses by type">
                  {data.expensesByCategory.length === 0 ? (
                    <EmptyState icon={Wallet} title="No expenses recorded for this period" className="py-6">
                      Record rent, salaries and bills under Expenses to see your true profit.
                    </EmptyState>
                  ) : (
                    <ExpensesChart rows={data.expensesByCategory} />
                  )}
                </Panel>
                <Panel title="Gross profit by category">
                  {data.byCategory.length === 0 ? (
                    <div className="text-base text-ink-3">No sales with a known cost in this period.</div>
                  ) : (
                    <>
                      <CategoryProfit rows={data.byCategory} />
                      <p className="mt-4 text-sm text-ink-3">Before discounts on the whole bill, so these add up to a little more than gross profit.</p>
                    </>
                  )}
                </Panel>
              </div>

              <Panel title="Most profitable medicines" flush>
                {data.topProducts.length === 0 ? (
                  <div className="p-5 text-base text-ink-3">No sales with a known cost in this period.</div>
                ) : (
                  <>
                    <ProfitRanking rows={data.topProducts} nameHeader="Medicine" showUnits />
                    <p className="border-t border-foil px-5 py-2.5 text-sm text-ink-3">
                      Per medicine, before discounts on the whole bill. Units are single tablets, capsules or bottles; a pack counts as all of its units.
                    </p>
                  </>
                )}
              </Panel>

              <Panel title={`Numbers for each ${unit}`} flush>
                <Table maxHeight={420}>
                  <thead>
                    <tr>
                      <Th>{unit === 'month' ? 'Month' : 'Day'}</Th>
                      <Th num>Net sales</Th>
                      {s.uncostedSalesCount > 0 && <Th num>Used for profit</Th>}
                      <Th num>Cost of medicines</Th>
                      <Th num>Gross profit</Th>
                      <Th num>Expenses</Th>
                      <Th num>Written off</Th>
                      <Th num>Net profit</Th>
                    </tr>
                  </thead>
                  <tbody id="profitTableBody">
                    {chart.length === 0 && <EmptyRow colSpan={8}>Nothing in this period.</EmptyRow>}
                    {chart.map((b) => (
                      <Tr key={b.key}>
                        <Td className="whitespace-nowrap">
                          {b.rowLabel}
                          <div className="text-xs text-ink-3">{plural(b.salesCount, 'sale')}</div>
                        </Td>
                        <Td num>{money(b.netSalesCents)}</Td>
                        {s.uncostedSalesCount > 0 && <Td num muted>{money(b.costedNetSalesCents)}</Td>}
                        <Td num muted>{money(b.cogsCents)}</Td>
                        <Td num>{money(b.grossProfitCents)}</Td>
                        <Td num muted>{money(b.expensesCents)}</Td>
                        <Td num muted>{money(b.writeOffCents)}</Td>
                        <Td num className={cx('font-semibold', b.netProfitCents < 0 ? 'text-red-ink' : 'text-ink')}>{money(b.netProfitCents)}</Td>
                      </Tr>
                    ))}
                    {chart.length > 1 && (
                      <Tr className="[&>td]:border-t-2 [&>td]:border-foil-strong [&>td]:font-bold">
                        <Td>
                          Total
                          <div className="text-xs font-normal text-ink-3">{plural(s.salesCount, 'sale')}</div>
                        </Td>
                        <Td num>{money(s.netSalesCents)}</Td>
                        {s.uncostedSalesCount > 0 && <Td num>{money(s.costedNetSalesCents)}</Td>}
                        <Td num>{money(s.cogsCents)}</Td>
                        <Td num>{money(s.grossProfitCents)}</Td>
                        <Td num>{money(s.expensesCents)}</Td>
                        <Td num>{money(s.writeOffCents)}</Td>
                        <Td num>{money(s.netProfitCents)}</Td>
                      </Tr>
                    )}
                  </tbody>
                </Table>
              </Panel>
            </>
          )}
        </div>
      )}
    </Page>
  );
}
