'use strict';

const fs = require('fs');
const path = require('path');
const { Database } = require('../db/Database');
const { assertSupported } = require('../db/migrations');
const { ensureDir, timestampForFile } = require('../lib/fsutil');
const { localDateString } = require('../lib/dates');
const { validationError } = require('../lib/errors');

const REQUIRED_TABLES = ['settings', 'users', 'products', 'sales', 'sale_items', 'customers'];
const AUTO_BACKUPS_TO_KEEP = 14;

function createBackupService({ getDb, backupsDir }) {
  function writeBackup(label, buffer) {
    ensureDir(backupsDir);
    const fileName = `medidesk_${label}_${timestampForFile()}.db`;
    const filePath = path.join(backupsDir, fileName);
    fs.writeFileSync(filePath, buffer);
    return { fileName, filePath };
  }

  function list() {
    if (!fs.existsSync(backupsDir)) return [];
    return fs
      .readdirSync(backupsDir)
      .filter((f) => f.toLowerCase().endsWith('.db'))
      .map((fileName) => {
        const filePath = path.join(backupsDir, fileName);
        const stat = fs.statSync(filePath);
        return { fileName, filePath, size: stat.size, modifiedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  /** Throws unless the file is a healthy MediDesk database this version can open. Returns its bytes. */
  async function validateFile(filePath) {
    let buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch (err) {
      throw validationError(`Cannot read backup file: ${err.message}`);
    }
    let db;
    try {
      db = await Database.inMemory(buffer);
    } catch (_) {
      throw validationError('The selected file is damaged or is not a SQLite database');
    }
    try {
      assertSupported(db);
      const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table';").map((t) => t.name);
      const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
      if (missing.length) throw validationError(`The selected file is not a MediDesk backup (missing: ${missing.join(', ')})`);
    } catch (err) {
      if (err.code) throw err;
      throw validationError(err.message);
    } finally {
      db.close();
    }
    return buffer;
  }

  return {
    list,
    validateFile,

    /** Snapshot of the live in-memory database. */
    create(label = 'manual') {
      return writeBackup(label, getDb().export());
    },

    /** Copy of the database file as it is on disk (used before migrations). */
    copyFile(dbPath, label) {
      return writeBackup(label, fs.readFileSync(dbPath));
    },

    /** One automatic backup per local day; keeps the most recent AUTO_BACKUPS_TO_KEEP. */
    autoDaily() {
      ensureDir(backupsDir);
      const today = localDateString();
      const autos = list().filter((b) => b.fileName.startsWith('medidesk_auto_'));
      let created = null;
      if (!autos.some((b) => b.modifiedAt && localDateString(new Date(b.modifiedAt)) === today)) {
        created = writeBackup('auto', getDb().export());
      }
      list()
        .filter((b) => b.fileName.startsWith('medidesk_auto_'))
        .slice(AUTO_BACKUPS_TO_KEEP)
        .forEach((b) => fs.unlinkSync(b.filePath));
      return created;
    },

    async latestValid() {
      for (const backup of list()) {
        try {
          await validateFile(backup.filePath);
          return backup;
        } catch (_) {
          /* try the next one */
        }
      }
      return null;
    }
  };
}

module.exports = { createBackupService, AUTO_BACKUPS_TO_KEEP };
