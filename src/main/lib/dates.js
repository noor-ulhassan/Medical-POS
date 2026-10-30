'use strict';

/*
 * Timestamps are stored as UTC ISO-8601 strings. Business days ("today",
 * the 7-day trend) are the pharmacy's *local* calendar days, so all day
 * boundaries are computed here in local time and passed to SQL as UTC ranges.
 */

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. */
function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Local midnight at the start of a YYYY-MM-DD calendar date. */
function parseLocalDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** UTC ISO range [start, end) covering local days `fromYmd` to `toYmd`, both included. */
function localDatesRange(fromYmd, toYmd) {
  return { start: parseLocalDate(fromYmd).toISOString(), end: addDays(parseLocalDate(toYmd), 1).toISOString() };
}

/** UTC ISO range [start, end) covering the local day containing `date`. */
function localDayRange(date = new Date()) {
  const start = startOfLocalDay(date);
  return { start: start.toISOString(), end: addDays(start, 1).toISOString() };
}

/** Whole days from today (local) until a YYYY-MM-DD date; negative when in the past. */
function daysUntil(dateString, today = new Date()) {
  if (!dateString) return null;
  const [y, m, d] = dateString.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - base) / 86400000);
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { localDateString, startOfLocalDay, addDays, parseLocalDate, localDatesRange, localDayRange, daysUntil, nowIso };
