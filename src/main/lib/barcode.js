'use strict';

const crypto = require('crypto');

/** EAN-13 check digit for a 12-digit body. */
function ean13CheckDigit(body) {
  if (!/^\d{12}$/.test(body)) throw new Error('EAN-13 body must be 12 digits');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

function toEan13(body) {
  return body + ean13CheckDigit(body);
}

function isValidEan13(code) {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === code[12];
}

/**
 * Generate an EAN-13 in the GS1 "restricted circulation" range (prefix 2),
 * which is reserved for in-store use and never collides with manufacturer
 * barcodes. `exists(code)` lets the caller reject codes already in use.
 */
function generateInternalBarcode(exists = () => false) {
  for (let attempt = 0; attempt < 50; attempt++) {
    let body = '2';
    const bytes = crypto.randomBytes(11);
    for (let i = 0; i < 11; i++) body += String(bytes[i] % 10);
    const code = toEan13(body);
    if (!exists(code)) return code;
  }
  throw new Error('Could not generate a unique barcode');
}

module.exports = { ean13CheckDigit, toEan13, isValidEan13, generateInternalBarcode };
