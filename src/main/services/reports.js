'use strict';

const { localDateString, localDayRange, startOfLocalDay, addDays, daysUntil } = require('../lib/dates');

const EXPIRY_WARNING_DAYS = 180;
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

      const alerts = this.alertCounts();
      return {
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
