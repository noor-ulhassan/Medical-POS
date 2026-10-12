'use strict';

const fs = require('fs');
const path = require('path');

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Crash-safe file replacement: write a temp file, fsync it, then rename it
 * over the target. A power cut leaves either the old or the new file, never
 * a half-written one. Renames are retried because Windows antivirus/indexers
 * briefly lock freshly written files.
 */
function atomicWriteFileSync(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fs.renameSync(tmpPath, filePath);
      return;
    } catch (err) {
      lastError = err;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) break;
      sleepSync(50 * (attempt + 1));
    }
  }
  throw lastError;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** True when `candidate` resolves to a location inside `parentDir`. */
function isInside(parentDir, candidate) {
  const rel = path.relative(path.resolve(parentDir), path.resolve(candidate));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

module.exports = { atomicWriteFileSync, ensureDir, isInside, timestampForFile };
