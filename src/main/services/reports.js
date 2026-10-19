'use strict';

const v = require('../lib/validate');
const { validationError } = require('../lib/errors');
const { localDateString, localDayRange, localDatesRange, startOfLocalDay, addDays, daysUntil } = require('../lib/dates');

const EXPIRY_WARNING_DAYS = 180;
/** Periods up to this many days are charted per day; longer ones per month. */
const DAILY_BUCKET_MAX_DAYS = 62;
const MAX_REPORT_DAYS = 3700;

/** Next calendar date as YYYY-MM-DD (pure calendar arithmetic, no time zones involved). */
function nextYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function daysInclusive(fromYmd, toYmd) {
  const toUtc = (ymd) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(toYmd) - toUtc(fromYmd)) / 86400000) + 1;
}

/** n / d as a percentage, or null when there is nothing to divide by. */
const percent = (n, d) => (d > 0 ? (n / d) * 100 : null);
/** floor(stock_units / pack_size) <= min_stock_level, without integer-division pitfalls. */
const LOW_STOCK_SQL = 'stock_units < (min_stock_level + 1) * pack_size';

function createReportsService(db, { now = () => new Date() } = {}) {
  function expiryCutoff() {
    return localDateString(addDays(now(), EXPIRY_WARNING_DAYS));
  }

  return {
    alertCounts() {
      return {
        lowStock: db.value(`SELECT COUNT(*) FROM products WHERE is_active = 1 AND ${LOW_STOCK_SQL};`),
        expiring: db.value(
          'SELECT COUNT(*) FROM products WHERE is_active = 1 AND stock_units > 0 AND expiry_date IS NOT NULL AND expiry_date <= ?;',
          [expiryCutoff()]
        )
      };
    },

    dashboard() {
      const today = localDayRange(now());
      const all = db.get("SELECT COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS total FROM sales WHERE status = 'COMPLETED';");
      const todays = db.get(
        "SELECT COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS total FROM sales WHERE status = 'COMPLETED' AND created_at >= ? AND created_at < ?;",
        [today.start, today.end]
      );

      // 7-day trend grouped by *local* calendar day, including days with no sales.
      const trendStart = addDays(startOfLocalDay(now()), -6);
      const recent = db.all("SELECT created_at, total_cents FROM sales WHERE status = 'COMPLETED' AND created_at >= ?;", [
        trendStart.toISOString()
      ]);
      const trend = [];
      for (let i = 0; i < 7; i++) trend.push({ day: localDateString(addDays(trendStart, i)), totalCents: 0 });
      for (const sale of recent) {
        const bucket = trend.find((t) => t.day === localDateString(new Date(sale.created_at)));
        if (bucket) bucket.totalCents += sale.total_cents;
      }

      // End-of-day picture: what each payment method brought in today and the
      // cash that should be in the drawer. Sales made today and voided today
      // are excluded by status; cash sales from earlier days that were voided
      // today were refunded from today's drawer, so they are subtracted.
      const todayByMethod = db.all(
        `SELECT payment_method, COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS total_cents
         FROM sales WHERE status = 'COMPLETED' AND created_at >= ? AND created_at < ?
         GROUP BY payment_method;`,
        [today.start, today.end]
      );
      const todayKhataPaymentsCents = db.value(
        "SELECT COALESCE(SUM(credit_cents), 0) FROM customer_ledger WHERE type = 'PAYMENT_RECEIVED' AND created_at >= ? AND created_at < ?;",
        [today.start, today.end]
      );
      // Only khata payments taken in cash are in the drawer (payments from before methods were recorded count as cash).
      const todayKhataCashPaymentsCents = db.value(
        `SELECT COALESCE(SUM(credit_cents), 0) FROM customer_ledger
         WHERE type = 'PAYMENT_RECEIVED' AND (payment_method IS NULL OR payment_method = 'CASH') AND created_at >= ? AND created_at < ?;`,
        [today.start, today.end]
      );
      // Items brought back today (from any day's sale). Cash returns were paid out of the drawer.
      const todayReturns = db.get(
        `SELECT COUNT(*) AS count, COALESCE(SUM(refund_cents), 0) AS total_cents,
           COALESCE(SUM(CASE WHEN refund_method = 'CASH' THEN refund_cents ELSE 0 END), 0) AS cash_cents
         FROM sale_returns WHERE created_at >= ? AND created_at < ?;`,
        [today.start, today.end]
      );
      const todayDiscounts = db.get(
        `SELECT COUNT(*) AS count, COALESCE(SUM(discount_cents), 0) AS total_cents
         FROM sales WHERE status = 'COMPLETED' AND discount_cents > 0 AND created_at >= ? AND created_at < ?;`,
        [today.start, today.end]
      );
      const todayVoids = db.get(
        `SELECT COUNT(*) AS count, COALESCE(SUM(s.total_cents), 0) AS total_cents
         FROM void_sales v JOIN sales s ON s.id = v.sale_id
         WHERE v.voided_at >= ? AND v.voided_at < ?;`,
        [today.start, today.end]
      );
      const todayCashRefundsCents = db.value(
        `SELECT COALESCE(SUM(s.total_cents), 0)
         FROM void_sales v JOIN sales s ON s.id = v.sale_id
         WHERE s.payment_method = 'CASH' AND v.voided_at >= ? AND v.voided_at < ? AND s.created_at < ?;`,
        [today.start, today.end, today.start]
      );
      const cashSales = todayByMethod.find((m) => m.payment_method === 'CASH');
      const todayCashSalesCents = cashSales ? cashSales.total_cents : 0;
      // Expenses paid out of the drawer today (rent, tea...) left the drawer too.
      const todayDrawerExpensesCents = db.value(
        'SELECT COALESCE(SUM(amount_cents), 0) FROM expenses WHERE deleted_at IS NULL AND paid_from_drawer = 1 AND expense_date = ?;',
        [localDateString(now())]
      );

      const alerts = this.alertCounts();
      const copy = db.get('SELECT backup_copy_dir, backup_copy_last_at, backup_copy_last_error FROM settings WHERE id = 1;');
      // Many wrong PINs in a day means someone may be trying to guess one.
      const wrongPinsToday = db.value(
        `SELECT COUNT(*) FROM audit_log
         WHERE action IN ('auth.login_failed', 'auth.pin_taken', 'auth.pin_change_failed') AND created_at >= ? AND created_at < ?;`,
        [today.start, today.end]
      );
      return {
        today: {
          byMethod: todayByMethod,
          cashSalesCents: todayCashSalesCents,
          khataPaymentsCents: todayKhataPaymentsCents,
          khataCashPaymentsCents: todayKhataCashPaymentsCents,
          cashRefundsCents: todayCashRefundsCents,
          drawerExpensesCents: todayDrawerExpensesCents,
          returnCount: todayReturns.count,
          returnsCents: todayReturns.total_cents,
          cashReturnsCents: todayReturns.cash_cents,
          expectedCashCents:
            todayCashSalesCents + todayKhataCashPaymentsCents - todayCashRefundsCents - todayReturns.cash_cents - todayDrawerExpensesCents,
          voidCount: todayVoids.count,
          voidTotalCents: todayVoids.total_cents,
          discountCount: todayDiscounts.count,
          discountCents: todayDiscounts.total_cents
        },
        // So the owner sees on the daily screen when backups exist only on this computer.
        backupCopy: {
          dir: copy.backup_copy_dir,
          lastAt: copy.backup_copy_last_at,
          lastError: copy.backup_copy_last_error,
          daysSinceCopy: copy.backup_copy_last_at ? Math.floor((now() - new Date(copy.backup_copy_last_at)) / 86400000) : null
        },
        wrongPinsToday,
        totalRevenueCents: all.total,
        totalInvoices: all.count,
        todayRevenueCents: todays.total,
        todayInvoices: todays.count,
        outstandingDebtCents: db.value('SELECT COALESCE(SUM(current_debt_cents), 0) FROM customers WHERE current_debt_cents > 0;'),
        riskCount: db.value(
          `SELECT COUNT(*) FROM products WHERE is_active = 1 AND (${LOW_STOCK_SQL}
             OR (stock_units > 0 AND expiry_date IS NOT NULL AND expiry_date <= ?));`,
          [expiryCutoff()]
        ),
        alerts,
        trend,
        paymentBreakdown: db.all(
          "SELECT payment_method, SUM(total_cents) AS total_cents FROM sales WHERE status = 'COMPLETED' GROUP BY payment_method ORDER BY total_cents DESC;"
        ),
        topProducts: db.all(
          `SELECT si.product_title, si.unit_type, SUM(si.quantity) AS total_qty, SUM(si.total_cents) AS total_cents
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
           WHERE s.status = 'COMPLETED'
           GROUP BY si.product_id, si.unit_type ORDER BY total_qty DESC LIMIT 5;`
        ),
        supplierRestock: db.all(
          `SELECT s.id AS supplier_id, s.name AS supplier_name, COUNT(p.id) AS low_count
           FROM products p JOIN suppliers s ON s.id = p.supplier_id
           WHERE p.is_active = 1 AND ${LOW_STOCK_SQL.replace(/(stock_units|min_stock_level|pack_size)/g, 'p.$1')}
           GROUP BY s.id ORDER BY low_count DESC;`
        )
      };
    },

    /**
     * Profit and loss for local calendar days `from`..`to` (both included).
     *
     * Definitions (all amounts in cents, all exact integers):
     *   net sales     = subtotal - bill discount; tax and the per-receipt fee are
     *                   collected for the government, so they are not income
     *   cost of goods = the cost recorded on each sale line when it was sold
     *   gross profit  = net sales - cost of goods, over sales whose every line has
     *                   a known cost; any other sale is left out and disclosed
     *   net profit    = gross profit - expenses - stock written off (expired,
     *                   damaged or lost; at cost)
     * Cancelled (voided) sales and deleted expenses are excluded. The chart
     * series are built from the same rows as the totals, so they always add up.
     */
    profit(input) {
      const data = v.object(input);
      const from = v.date(data.from, 'From date');
      const to = v.date(data.to, 'To date');
      if (to < from) throw validationError('The end date is before the start date');
      const spanDays = daysInclusive(from, to);
      if (spanDays > MAX_REPORT_DAYS) throw validationError('Choose a period of at most 10 years');
      const { start, end } = localDatesRange(from, to);
      const granularity = spanDays <= DAILY_BUCKET_MAX_DAYS ? 'day' : 'month';
      const keyOf = (ymd) => (granularity === 'day' ? ymd : ymd.slice(0, 7));

      const buckets = new Map();
      for (let day = from; day <= to; day = nextYmd(day)) {
        const key = keyOf(day);
        if (!buckets.has(key)) {
          buckets.set(key, { key, salesCount: 0, netSalesCents: 0, costedNetSalesCents: 0, cogsCents: 0, expensesCents: 0, writeOffCents: 0 });
        }
      }
      const bucketFor = (ymd) => {
        const bucket = buckets.get(keyOf(ymd));
        if (!bucket) throw new Error(`Report period does not contain ${ymd}`);
        return bucket;
      };

      const t = {
        salesCount: 0,
        grossSalesCents: 0,
        discountCents: 0,
        netSalesCents: 0,
        taxAndFeesCents: 0,
        collectedCents: 0,
        costedSalesCount: 0,
        costedNetSalesCents: 0,
        uncostedSalesCount: 0,
        uncostedNetSalesCents: 0,
        cogsCents: 0,
        expensesCents: 0,
        expenseCount: 0,
        writeOffCents: 0,
        writeOffCount: 0,
        writeOffUnknownCount: 0,
        returnsCount: 0,
        returnsNetCents: 0
      };

      const sales = db.all(
        `SELECT s.id, s.created_at, s.subtotal_cents, s.discount_cents, s.tax_cents, s.total_cents,
           COUNT(si.id) AS line_count,
           COALESCE(SUM(CASE WHEN si.id IS NOT NULL AND si.cost_cents IS NULL THEN 1 ELSE 0 END), 0) AS unknown_lines,
           COALESCE(SUM(si.cost_cents), 0) AS cost_cents
         FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id
         WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ?
         GROUP BY s.id;`,
        [start, end]
      );
      for (const sale of sales) {
        const net = sale.subtotal_cents - sale.discount_cents;
        const bucket = bucketFor(localDateString(new Date(sale.created_at)));
        t.salesCount += 1;
        t.grossSalesCents += sale.subtotal_cents;
        t.discountCents += sale.discount_cents;
        t.netSalesCents += net;
        t.taxAndFeesCents += sale.tax_cents;
        t.collectedCents += sale.total_cents;
        bucket.salesCount += 1;
        bucket.netSalesCents += net;
        if (sale.line_count > 0 && sale.unknown_lines === 0) {
          t.costedSalesCount += 1;
          t.costedNetSalesCents += net;
          t.cogsCents += sale.cost_cents;
          bucket.costedNetSalesCents += net;
          bucket.cogsCents += sale.cost_cents;
        } else {
          t.uncostedSalesCount += 1;
          t.uncostedNetSalesCents += net;
        }
      }

      // Returns count on the day the customer brought the items back (a sale can
      // no longer be cancelled once something was returned from it). They take
      // their part of net sales and, when the sale's cost is known, of the cost
      // of goods off the same side of the sum the sale itself is on.
      const returns = db.all(
        `SELECT r.id, r.created_at, r.net_cents, r.refund_cents,
           (SELECT SUM(sri.cost_cents) FROM sale_return_items sri WHERE sri.return_id = r.id) AS cost_cents,
           (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = r.sale_id AND si.cost_cents IS NULL) AS unknown_lines
         FROM sale_returns r JOIN sales s ON s.id = r.sale_id
         WHERE s.status = 'COMPLETED' AND r.created_at >= ? AND r.created_at < ?;`,
        [start, end]
      );
      for (const r of returns) {
        const bucket = bucketFor(localDateString(new Date(r.created_at)));
        t.returnsCount += 1;
        t.returnsNetCents += r.net_cents;
        t.netSalesCents -= r.net_cents;
        t.taxAndFeesCents -= r.refund_cents - r.net_cents;
        t.collectedCents -= r.refund_cents;
        bucket.netSalesCents -= r.net_cents;
        if (r.unknown_lines === 0) {
          t.costedNetSalesCents -= r.net_cents;
          t.cogsCents -= r.cost_cents || 0;
          bucket.costedNetSalesCents -= r.net_cents;
          bucket.cogsCents -= r.cost_cents || 0;
        } else {
          t.uncostedNetSalesCents -= r.net_cents;
        }
      }

      const expenseRows = db.all(
        `SELECT expense_date, category, SUM(amount_cents) AS amount_cents, COUNT(*) AS count
         FROM expenses WHERE deleted_at IS NULL AND expense_date >= ? AND expense_date <= ?
         GROUP BY expense_date, category;`,
        [from, to]
      );
      const byCategory = new Map();
      for (const row of expenseRows) {
        bucketFor(row.expense_date).expensesCents += row.amount_cents;
        t.expensesCents += row.amount_cents;
        t.expenseCount += row.count;
        const c = byCategory.get(row.category) || { category: row.category, amountCents: 0, count: 0 };
        c.amountCents += row.amount_cents;
        c.count += row.count;
        byCategory.set(row.category, c);
      }

      // Expired stock written off, and stock recorded as damaged or lost when correcting a count.
      const writeOffs = db.all(
        "SELECT created_at, value_cents FROM stock_adjustments WHERE kind IN ('WRITE_OFF', 'LOSS') AND created_at >= ? AND created_at < ?;",
        [start, end]
      );
      for (const w of writeOffs) {
        t.writeOffCount += 1;
        if (w.value_cents === null) {
          t.writeOffUnknownCount += 1;
          continue;
        }
        const loss = -w.value_cents;
        t.writeOffCents += loss;
        bucketFor(localDateString(new Date(w.created_at))).writeOffCents += loss;
      }
      // Write-offs recorded before values were kept: counted as unknown so the gap is visible.
      const legacyWriteOffs = db.value(
        `SELECT COUNT(*) FROM stock_adjustments
         WHERE kind IS NULL AND change_units < 0 AND reason LIKE '%discarded%' AND created_at >= ? AND created_at < ?;`,
        [start, end]
      );
      t.writeOffCount += legacyWriteOffs;
      t.writeOffUnknownCount += legacyWriteOffs;

      const grossProfitCents = t.costedNetSalesCents - t.cogsCents;
      const netProfitCents = grossProfitCents - t.expensesCents - t.writeOffCents;

      const lineFilter = "s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ? AND si.cost_cents IS NOT NULL";
      const productRows = db.all(
        `SELECT si.product_id, COALESCE(p.title, MAX(si.product_title)) AS title,
           SUM(si.base_units) AS units, SUM(si.total_cents) AS revenue_cents, SUM(si.cost_cents) AS cost_cents
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN products p ON p.id = si.product_id
         WHERE ${lineFilter}
         GROUP BY si.product_id;`,
        [start, end]
      );
      const categoryRows = db.all(
        `SELECT c.id AS category_id, COALESCE(c.name, 'No category') AS name, SUM(si.total_cents) AS revenue_cents, SUM(si.cost_cents) AS cost_cents
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN products p ON p.id = si.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE ${lineFilter}
         GROUP BY c.id;`,
        [start, end]
      );
      // Items returned in the period come off their medicine and category (when those sold in the
      // period too; these lists rank what sold, the totals above include every return).
      const returnFilter = "s.status = 'COMPLETED' AND r.created_at >= ? AND r.created_at < ? AND sri.cost_cents IS NOT NULL";
      const returnedBy = (groupKey, joins) =>
        new Map(
          db
            .all(
              `SELECT ${groupKey} AS k, SUM(sri.base_units) AS units, SUM(sri.price_cents * sri.quantity) AS revenue_cents, SUM(sri.cost_cents) AS cost_cents
               FROM sale_return_items sri
               JOIN sale_returns r ON r.id = sri.return_id
               JOIN sales s ON s.id = r.sale_id
               ${joins}
               WHERE ${returnFilter}
               GROUP BY ${groupKey};`,
              [start, end]
            )
            .map((row) => [row.k, row])
        );
      const lessReturns = (row, returned) =>
        returned
          ? {
              ...row,
              units: row.units === undefined ? undefined : row.units - returned.units,
              revenue_cents: row.revenue_cents - returned.revenue_cents,
              cost_cents: row.cost_cents - returned.cost_cents
            }
          : row;
      const productReturns = returnedBy('sri.product_id', '');
      const categoryReturns = returnedBy('c.id', 'LEFT JOIN products p ON p.id = sri.product_id LEFT JOIN categories c ON c.id = p.category_id');
      const productNet = productRows.map((r) => lessReturns(r, productReturns.get(r.product_id)));
      const categoryNet = categoryRows.map((r) => lessReturns(r, categoryReturns.get(r.category_id)));

      const withProfit = (r) => ({
        revenueCents: r.revenue_cents,
        costCents: r.cost_cents,
        profitCents: r.revenue_cents - r.cost_cents,
        marginPct: percent(r.revenue_cents - r.cost_cents, r.revenue_cents)
      });
      const byProfit = (a, b) => b.profitCents - a.profitCents;

      return {
        from,
        to,
        granularity,
        summary: {
          ...t,
          grossProfitCents,
          grossMarginPct: percent(grossProfitCents, t.costedNetSalesCents),
          markupPct: percent(grossProfitCents, t.cogsCents),
          netProfitCents,
          netMarginPct: percent(netProfitCents, t.costedNetSalesCents),
          averageSaleCents: t.salesCount ? Math.round(t.netSalesCents / t.salesCount) : 0
        },
        series: [...buckets.values()].map((b) => {
          const gross = b.costedNetSalesCents - b.cogsCents;
          return { ...b, grossProfitCents: gross, netProfitCents: gross - b.expensesCents - b.writeOffCents };
        }),
        expensesByCategory: [...byCategory.values()].sort((a, b) => b.amountCents - a.amountCents),
        topProducts: productNet
          .map((r) => ({ productId: r.product_id, title: r.title, units: r.units, ...withProfit(r) }))
          .sort(byProfit)
          .slice(0, 10),
        byCategory: categoryNet.map((r) => ({ name: r.name, ...withProfit(r) })).sort(byProfit),
        productsMissingCost: db.value('SELECT COUNT(*) FROM products WHERE is_active = 1 AND cost_price_cents <= 0;')
      };
    },

    /** Products with stock that are expired or expire within the warning window. */
    expiry() {
      const today = now();
      const rows = db
        .all(
          `SELECT id, title, barcode, expiry_date, stock_units, pack_size FROM products
           WHERE is_active = 1 AND stock_units > 0 AND expiry_date IS NOT NULL AND expiry_date <= ?
           ORDER BY expiry_date;`,
          [expiryCutoff()]
        )
        .map((p) => ({ ...p, days_left: daysUntil(p.expiry_date, today) }));
      const counts = { expired: 0, within30: 0, within90: 0, within180: 0 };
      for (const p of rows) {
        if (p.days_left < 0) counts.expired++;
        else if (p.days_left <= 30) counts.within30++;
        else if (p.days_left <= 90) counts.within90++;
        else counts.within180++;
      }
      return { rows, counts, warningDays: EXPIRY_WARNING_DAYS };
    }
  };
}

module.exports = { createReportsService, LOW_STOCK_SQL, EXPIRY_WARNING_DAYS };
