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
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
};

/*
 * The UI runs on Chromium 108 (Electron 22, the last version for Windows 7),
 * whose WebP decoder has a known heap overflow (CVE-2023-4863). Chromium
 * decodes an image by its contents, not its name, so the first bytes must
 * match one of these formats; WebP is not accepted at all.
 */
const SIGNATURES = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/bmp', bytes: [0x42, 0x4d] }
];

/** MIME type from the file's first bytes, or null when it is not an accepted image. */
function sniffImageType(buffer) {
  const match = SIGNATURES.find((s) => buffer.length >= s.bytes.length && s.bytes.every((b, i) => buffer[i] === b));
  return match ? match.mime : null;
}

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
      if (!IMAGE_TYPES[ext]) throw validationError('Prescription must be a photo or scan in JPG, PNG, GIF or BMP format');
      if (typeof data.base64Data !== 'string' || data.base64Data.length === 0) throw validationError('File is empty');
      const buffer = Buffer.from(data.base64Data, 'base64');
      if (buffer.length === 0) throw validationError('File is empty');
      if (buffer.length > MAX_PRESCRIPTION_BYTES) throw validationError('Prescription image must be smaller than 10 MB');
      if (!sniffImageType(buffer)) {
        throw validationError('This file is not a JPG, PNG, GIF or BMP picture (whatever its name says). Save the photo as JPG and try again.');
      }

      ensureDir(prescriptionsDir);
      const name = `rx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
      fs.writeFileSync(path.join(prescriptionsDir, name), buffer);
      return { relativePath: path.posix.join('Prescriptions', name) };
    },

    /**
     * Resolve a stored path (relative, or absolute from v1.1) and refuse anything
     * outside the Prescriptions folder. v1.1 stored full paths into its folder
     * in Documents; that folder has since been moved here, so such a path is
     * looked up by file name in the current Prescriptions folder.
     */
    resolvePrescriptionPath(stored) {
      if (!stored) return null;
      const absolute = path.isAbsolute(stored) ? stored : path.join(dataDir, stored);
      if (isInside(prescriptionsDir, absolute)) return absolute;
      if (!path.isAbsolute(stored)) return null;
      const moved = path.join(prescriptionsDir, path.win32.basename(stored));
      return isInside(prescriptionsDir, moved) && fs.existsSync(moved) ? moved : null;
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
      const buffer = fs.readFileSync(absolute);
      // Older versions accepted any file (WebP included); only the safe formats are shown on screen.
      const mime = sniffImageType(buffer);
      if (!mime) {
        throw validationError(
          `This prescription (${path.basename(absolute)}) is not in a format that can be shown safely here. Open it from the Prescriptions folder in the data folder.`
        );
      }
      return `data:${mime};base64,${buffer.toString('base64')}`;
    }
  };
}

module.exports = { createFilesService, sniffImageType, MAX_PRESCRIPTION_BYTES };
