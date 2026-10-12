'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const v = require('../lib/validate');
const { validationError, notFound } = require('../lib/errors');
const { ensureDir, isInside } = require('../lib/fsutil');

const MAX_PRESCRIPTION_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
};

/**
 * Prescription images live under <dataDir>/Prescriptions and are stored in
 * the database as paths relative to dataDir, so the data folder can be moved.
 */
function createFilesService({ dataDir, prescriptionsDir }) {
  return {
    savePrescription(input) {
      const data = v.object(input);
      const fileName = v.string(data.fileName, 'File name', { required: true, max: 255 });
      const ext = path.extname(fileName).toLowerCase();
      if (!IMAGE_TYPES[ext]) throw validationError('Prescription must be an image (JPG, PNG, WEBP, GIF or BMP)');
      if (typeof data.base64Data !== 'string' || data.base64Data.length === 0) throw validationError('File is empty');
      const buffer = Buffer.from(data.base64Data, 'base64');
      if (buffer.length === 0) throw validationError('File is empty');
      if (buffer.length > MAX_PRESCRIPTION_BYTES) throw validationError('Prescription image must be smaller than 10 MB');

      ensureDir(prescriptionsDir);
      const name = `rx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
      fs.writeFileSync(path.join(prescriptionsDir, name), buffer);
      return { relativePath: path.posix.join('Prescriptions', name) };
    },

    /** Resolve a stored path (relative, or absolute from v1.1) and refuse anything outside the data folder. */
    resolvePrescriptionPath(stored) {
      if (!stored) return null;
      const absolute = path.isAbsolute(stored) ? stored : path.join(dataDir, stored);
      if (!isInside(prescriptionsDir, absolute)) return null;
      return absolute;
    },

    /** Validate a path coming back from the renderer (e.g. at checkout). */
    normalizeStoredPrescription(stored) {
      if (!stored) return '';
      const absolute = this.resolvePrescriptionPath(String(stored));
      if (!absolute || !fs.existsSync(absolute)) throw validationError('Attached prescription file was not found');
      return path.relative(dataDir, absolute).split(path.sep).join('/');
    },

    readPrescriptionAsDataUrl(stored) {
      const absolute = this.resolvePrescriptionPath(stored);
      if (!absolute || !fs.existsSync(absolute)) throw notFound('Prescription image file is missing');
      const mime = IMAGE_TYPES[path.extname(absolute).toLowerCase()] || 'application/octet-stream';
      return `data:${mime};base64,${fs.readFileSync(absolute).toString('base64')}`;
    }
  };
}

module.exports = { createFilesService, MAX_PRESCRIPTION_BYTES };
