import pricing from '@shared/pricing.js';

export const { formatCents, toCents, splitUnits, computeTotals, lineUnits, unitPriceCents, discountWithinLimit } = pricing;

export const money = (cents) => formatCents(cents, 'Rs');

/** Cents as an input value, e.g. 1250 -> "12.50". */
export const centsToInput = (cents) => ((cents || 0) / 100).toFixed(2);

export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '';

export const shortDate = (ymd) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return ymd(d);
}

/** Days from today to a YYYY-MM-DD date (local calendar), or null. */
export function daysUntil(dateString) {
  if (!dateString) return null;
  const [y, m, d] = dateString.split('-').map(Number);
  const now = new Date();
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}

/** level: 'none' | 'ok' | 'soon' (<= 180 days) | 'urgent' (<= 30 days) | 'expired' */
export function expiryStatus(dateString) {
  const days = daysUntil(dateString);
  if (days === null) return { level: 'none', days };
  if (days < 0) return { level: 'expired', days };
  if (days <= 30) return { level: 'urgent', days };
  if (days <= 180) return { level: 'soon', days };
  return { level: 'ok', days };
}

/** Matches reports.js LOW_STOCK_SQL: whole packs at or below the minimum. */
export const isLowStock = (p) => p.stock_units < (p.min_stock_level + 1) * p.pack_size;
export const isOutOfStock = (p) => p.stock_units <= 0;

export function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Image types accepted for prescription photos (the main process checks the file contents too). */
export const PRESCRIPTION_FILE_TYPES = '.jpg,.jpeg,.png,.gif,.bmp';

export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function timeReference(prefix) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Short rupee amount for chart axes only (exact amounts are always shown in tooltips and tables): Rs 950, Rs 12.5K, Rs 1.2M. */
export function compactMoney(cents) {
  const rupees = (cents || 0) / 100;
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}Rs ${+(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}Rs ${+(abs / 1e3).toFixed(1)}K`;
  return `${sign}Rs ${+abs.toFixed(0)}`;
}

/** A percentage with one decimal, or a dash when it cannot be worked out. */
export const percentText = (value) => (value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`);
