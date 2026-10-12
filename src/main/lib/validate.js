'use strict';

const { validationError } = require('./errors');

/**
 * Small, dependency-free input validators for IPC payloads.
 * Every function either returns the cleaned value or throws a VALIDATION AppError.
 */

function object(value, label = 'payload') {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw validationError(`${label} must be an object`);
  return value;
}

function string(value, label, { required = false, max = 500, trim = true } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' && typeof value !== 'number') throw validationError(`${label} must be text`);
  let text = String(value);
  if (trim) text = text.trim();
  if (required && text === '') throw validationError(`${label} is required`);
  if (text.length > max) throw validationError(`${label} must be at most ${max} characters`);
  return text;
}

function integer(value, label, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, required = true } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw validationError(`${label} must be a whole number`);
  if (n < min) throw validationError(`${label} must be at least ${min}`);
  if (n > max) throw validationError(`${label} must be at most ${max}`);
  return n;
}

function id(value, label = 'id', { required = true } = {}) {
  return integer(value, label, { min: 1, required });
}

function cents(value, label, { min = 0, max = 1e12 } = {}) {
  return integer(value, label, { min, max });
}

function number(value, label, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw validationError(`${label} must be a number`);
  if (n < min || n > max) throw validationError(`${label} must be between ${min} and ${max}`);
  return n;
}

function oneOf(value, label, allowed) {
  if (!allowed.includes(value)) throw validationError(`${label} must be one of: ${allowed.join(', ')}`);
  return value;
}

function boolean(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** YYYY-MM-DD calendar date. */
function date(value, label, { required = true } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  const text = string(value, label, { required: true, max: 10 });
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw validationError(`${label} must be a date (YYYY-MM-DD)`);
  const d = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  if (d.getUTCFullYear() !== +match[1] || d.getUTCMonth() !== +match[2] - 1 || d.getUTCDate() !== +match[3]) {
    throw validationError(`${label} is not a valid calendar date`);
  }
  return text;
}

function array(value, label, { min = 0, max = 1000 } = {}) {
  if (!Array.isArray(value)) throw validationError(`${label} must be a list`);
  if (value.length < min) throw validationError(`${label} must contain at least ${min} item(s)`);
  if (value.length > max) throw validationError(`${label} must contain at most ${max} items`);
  return value;
}

module.exports = { object, string, integer, id, cents, number, oneOf, boolean, date, array };
