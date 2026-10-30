'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Database } = require('../db/Database');
const { assertSupported } = require('../db/migrations');
const { ensureDir, timestampForFile } = require('../lib/fsutil');
const { localDateString } = require('../lib/dates');
const { validationError } = require('../lib/errors');

const REQUIRED_TABLES = ['settings', 'users', 'products', 'sales', 'sale_items', 'customers'];
const AUTO_BACKUPS_TO_KEEP = 14;
/** Folder created inside the copy location chosen by the owner (USB drive, cloud folder). */
const COPY_FOLDER_NAME = 'Noor Pharmacy POS backups';

function createBackupService({ getDb, backupsDir, prescriptionsDir }) {
  function writeBackup(label, buffer) {
    ensureDir(backupsDir);
    const fileName = `noorpos_${label}_${timestampForFile()}.db`;
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

  /** Throws unless the file is a healthy Noor Pharmacy POS database this version can open. Returns its bytes. */
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
      if (missing.length) throw validationError(`The selected file is not a Noor Pharmacy POS backup (missing: ${missing.join(', ')})`);
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
      const autos = list().filter((b) => b.fileName.startsWith('noorpos_auto_'));
      let created = null;
      if (!autos.some((b) => b.modifiedAt && localDateString(new Date(b.modifiedAt)) === today)) {
        created = writeBackup('auto', getDb().export());
      }
      list()
        .filter((b) => b.fileName.startsWith('noorpos_auto_'))
        .slice(AUTO_BACKUPS_TO_KEEP)
        .forEach((b) => fs.unlinkSync(b.filePath));
      return created;
    },

    /**
     * Copy every backup, and the prescription photos (which are not inside the
     * .db files), into <rootDir>/Noor Pharmacy POS backups, so the shop's data
     * survives this computer's disk failing or being stolen. Only what is
     * missing there is copied; daily automatic backups are rotated like here.
     * Asynchronous so a slow USB drive does not freeze the till.
     */
    async copyTo(rootDir) {
      const target = path.join(rootDir, COPY_FOLDER_NAME);
      const targetPrescriptions = path.join(target, 'Prescriptions');
      await fsp.mkdir(targetPrescriptions, { recursive: true });
      // Leftovers of a copy that was interrupted (drive pulled out).
      for (const name of await fsp.readdir(target)) {
        if (name.endsWith('.partial')) await fsp.rm(path.join(target, name), { force: true });
      }

      const present = new Set(await fsp.readdir(target));
      let backups = 0;
      for (const b of list()) {
        if (present.has(b.fileName)) continue;
        const partial = path.join(target, `${b.fileName}.partial`);
        await fsp.copyFile(b.filePath, partial);
        await fsp.rename(partial, path.join(target, b.fileName));
        backups++;
      }
      // File names carry the time (noorpos_auto_<ISO time>.db), so newest sort last.
      const autos = (await fsp.readdir(target)).filter((f) => f.startsWith('noorpos_auto_') && f.toLowerCase().endsWith('.db')).sort();
      for (const old of autos.slice(0, Math.max(autos.length - AUTO_BACKUPS_TO_KEEP, 0))) {
        await fsp.rm(path.join(target, old), { force: true });
      }

      let prescriptions = 0;
      if (prescriptionsDir && fs.existsSync(prescriptionsDir)) {
        const have = new Set(await fsp.readdir(targetPrescriptions));
        for (const name of await fsp.readdir(prescriptionsDir)) {
          if (have.has(name)) continue;
          const source = path.join(prescriptionsDir, name);
          if (!(await fsp.stat(source)).isFile()) continue;
          const partial = path.join(targetPrescriptions, `${name}.partial`);
          await fsp.copyFile(source, partial);
          await fsp.rename(partial, path.join(targetPrescriptions, name));
          prescriptions++;
        }
      }
      return { target, backups, prescriptions };
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

module.exports = { createBackupService, AUTO_BACKUPS_TO_KEEP, COPY_FOLDER_NAME };
