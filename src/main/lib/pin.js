'use strict';

const crypto = require('crypto');
const { validationError } = require('./errors');

/*
 * PINs are short, so hashing cannot stop an offline brute force of a stolen
 * database file. What it does do is keep PINs out of backups, logs and the UI,
 * and avoid one user reading another's PIN. Cost is kept low on purpose so
 * login stays fast on old 32-bit machines (login checks every active user).
 */
const SCRYPT_PARAMS = { N: 4096, r: 8, p: 1 };
const KEY_LENGTH = 32;

const WEAK_PINS = new Set(['1234', '5678', '0000', '1111', '4321', '123456', '000000', '654321']);
const PIN_PATTERN = /^\d{4,6}$/;

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, KEY_LENGTH, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPin(pin, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(String(pin), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p)
  });
  return crypto.timingSafeEqual(expected, actual);
}

function isWeakPin(pin) {
  return WEAK_PINS.has(pin) || /^(\d)\1+$/.test(pin);
}

/** Throws unless the PIN is 4-6 digits and not trivially guessable. */
function assertAcceptablePin(pin) {
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
    throw validationError('PIN must be 4 to 6 digits');
  }
  if (isWeakPin(pin)) {
    throw validationError('This PIN is too easy to guess. Choose a different one.');
  }
  return pin;
}

module.exports = { hashPin, verifyPin, isWeakPin, assertAcceptablePin, PIN_PATTERN };
