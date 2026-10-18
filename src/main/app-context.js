'use strict';

const fs = require('fs');
const path = require('path');
const { Database, DatabaseCorruptError } = require('./db/Database');
const { migrate, pendingMigrations, LegacySchemaError, NewerSchemaError } = require('./db/migrations');
const { ensureEssentialRows, seedDemoData } = require('./db/seed');
const { ensureDir, timestampForFile, atomicWriteFileSync, isInside } = require('./lib/fsutil');
const { validationError } = require('./lib/errors');
const { nowIso } = require('./lib/dates');
const { createAuthService } = require('./services/auth');
const { createSettingsService } = require('./services/settings');
const { createCatalogService } = require('./services/catalog');
const { createProductsService } = require('./services/products');
const { createCustomersService } = require('./services/customers');
const { createSalesService } = require('./services/sales');
const { createParkedService } = require('./services/parked');
const { createReportsService } = require('./services/reports');
const { createFilesService } = require('./services/files');
const { createBackupService } = require('./services/backup');
const { createAuditService, recordAudit } = require('./services/audit');
const { createExpensesService } = require('./services/expenses');

class QuitRequested extends Error {
  constructor() {
    super('User chose to quit');
    this.name = 'QuitRequested';
  }
}

const DB_FILE_NAME = 'noor_pharmacy_pos.db';

/** Set (or with '' clear) the backup copy folder; the previous outcome no longer applies. Inside a transaction. */
function setCopyFolder(db, dir) {
  db.run("UPDATE settings SET backup_copy_dir = ?, backup_copy_last_at = NULL, backup_copy_last_error = '' WHERE id = 1;", [dir]);
}

function storagePaths(dataDir) {
  return {
    dataDir,
    dbPath: path.join(dataDir, DB_FILE_NAME),
    backupsDir: path.join(dataDir, 'Backups'),
    prescriptionsDir: path.join(dataDir, 'Prescriptions')
  };
}

/**
 * Composition root: owns the database connection and the services built on
 * it, plus the operations that replace the database (restore, factory reset).
 *
 * `decide(kind, info)` is asked how to recover from a damaged or incompatible
 * database file; it resolves to 'restoreBackup' | 'startFresh' | 'quit'.
 */
class AppContext {
  constructor({ dataDir, decide = async () => 'quit', onPersistError, demoData = false }) {
    this.paths = storagePaths(dataDir);
    this.decide = decide;
    this.onPersistError = onPersistError;
    this.demoData = demoData;
    this.db = null;
    this.services = null;
    this.session = { user: null };
    this.files = createFilesService(this.paths);
    this.backup = createBackupService({
      getDb: () => this.db,
      backupsDir: this.paths.backupsDir,
      prescriptionsDir: this.paths.prescriptionsDir
    });
    this.copying = null;
  }

  async start() {
    const { dataDir, backupsDir, prescriptionsDir, dbPath } = this.paths;
    [dataDir, backupsDir, prescriptionsDir].forEach(ensureDir);
    if (fs.existsSync(`${dbPath}.tmp`)) fs.unlinkSync(`${dbPath}.tmp`); // leftover from an interrupted save

    let opened;
    try {
      opened = await this.openFile();
    } catch (err) {
      if (!(err instanceof DatabaseCorruptError)) throw err;
      await this.recover('corrupt', err);
      opened = await this.openFile();
    }

    try {
      this.prepare(opened);
    } catch (err) {
      if (err instanceof NewerSchemaError) {
        this.db.sqlDb.close();
        this.db = null;
        await this.decide('newer', { error: err });
        throw new QuitRequested();
      }
      if (!(err instanceof LegacySchemaError)) throw err;
      this.db.sqlDb.close();
      this.db = null;
      await this.recover('legacy', err);
      this.prepare(await this.openFile());
    }

    this.backup.autoDaily();
    this.copyBackupsAway(); // in the background; the outcome is shown in Settings and on Today's report
    return this;
  }

  /**
   * Copy the backups and prescription photos to the folder chosen in Settings
   * (USB drive, cloud folder), if there is one, and record how it went.
   * Resolves to null (no folder), { ok: true, ... } or { ok: false, error }.
   */
  copyBackupsAway() {
    if (this.copying) return this.copying;
    const run = async () => {
      const db = this.db;
      const settings = db && db.get('SELECT backup_copy_dir, backup_copy_last_at, backup_copy_last_error FROM settings WHERE id = 1;');
      if (!settings || !settings.backup_copy_dir) return null;
      const dir = settings.backup_copy_dir;
      let outcome;
      try {
        outcome = { ok: true, dir, ...(await this.backup.copyTo(dir)) };
      } catch (err) {
        const reason = ['ENOENT', 'ENODEV', 'EBUSY'].includes(err.code) ? 'the folder cannot be reached; is the USB drive plugged in?' : err.message;
        outcome = { ok: false, dir, error: `Could not copy backups to ${dir}: ${reason}` };
      }
      // A restore or reset may have replaced the database meanwhile; its own settings then apply.
      if (this.db === db) {
        const changed = outcome.ok
          ? outcome.backups > 0 || outcome.prescriptions > 0 || settings.backup_copy_last_error || !settings.backup_copy_last_at
          : outcome.error !== settings.backup_copy_last_error;
        if (changed) {
          db.transaction(() =>
            outcome.ok
              ? db.run("UPDATE settings SET backup_copy_last_at = ?, backup_copy_last_error = '' WHERE id = 1;", [nowIso()])
              : db.run('UPDATE settings SET backup_copy_last_error = ? WHERE id = 1;', [outcome.error])
          );
        }
      }
      return outcome;
    };
    this.copying = run().finally(() => {
      this.copying = null;
    });
    return this.copying;
  }

  /** Use `dir` (picked by an admin) for backup copies, then copy straight away. */
  async setBackupCopyFolder(actor, dir) {
    const { dataDir } = this.paths;
    const chosen = path.resolve(dir);
    if (chosen === path.resolve(dataDir) || isInside(dataDir, chosen)) {
      throw validationError("Choose a folder outside the app's own data folder, for example on a USB drive or in a OneDrive or Google Drive folder.");
    }
    this.db.transaction(() => {
      setCopyFolder(this.db, chosen);
      recordAudit(this.db, actor, 'system.backup_copy_folder', { dir: chosen });
    });
    if (this.copying) await this.copying.catch(() => null);
    return this.copyBackupsAway();
  }

  stopBackupCopies(actor) {
    this.db.transaction(() => {
      setCopyFolder(this.db, '');
      recordAudit(this.db, actor, 'system.backup_copy_stopped');
    });
  }

  openFile() {
    return Database.open(this.paths.dbPath, { onPersistError: this.onPersistError });
  }

  /** Migrate (after backing up the old file), add essential rows, build services. */
  prepare({ db, created }) {
    this.db = db;
    const pending = pendingMigrations(db);
    if (pending.length > 0 && !created && fs.existsSync(this.paths.dbPath)) {
      this.backup.copyFile(this.paths.dbPath, `pre-migration-v${pending[pending.length - 1].version}`);
    }
    migrate(db);
    ensureEssentialRows(db);
    if (this.demoData) seedDemoData(db);
    this.buildServices();
  }

  buildServices() {
    const db = this.db;
    const files = this.files;
    this.services = {
      auth: createAuthService(db),
      settings: createSettingsService(db),
      catalog: createCatalogService(db),
      products: createProductsService(db),
      customers: createCustomersService(db),
      sales: createSalesService(db, { files }),
      parked: createParkedService(db, { files }),
      reports: createReportsService(db),
      expenses: createExpensesService(db),
      audit: createAuditService(db),
      files,
      backup: this.backup
    };
  }

  /** Move the current database file aside (never deleted) so a new one can take its place. */
  moveAside(reason) {
    const { dbPath } = this.paths;
    if (!fs.existsSync(dbPath)) return null;
    const target = path.join(path.dirname(dbPath), `noor_pharmacy_pos.${reason}-${timestampForFile()}.db`);
    fs.renameSync(dbPath, target);
    return target;
  }

  async recover(kind, error) {
    const latestBackup = await this.backup.latestValid();
    const choice = await this.decide(kind, { error, latestBackup });
    if (choice === 'restoreBackup' && latestBackup) {
      this.moveAside(kind);
      fs.copyFileSync(latestBackup.filePath, this.paths.dbPath);
      return;
    }
    if (choice === 'startFresh') {
      this.moveAside(kind);
      return;
    }
    throw new QuitRequested();
  }

  /** Replace the live database with a validated backup file. */
  async restoreFrom(actor, filePath) {
    const buffer = await this.backup.validateFile(filePath);
    const safety = this.backup.create('pre-restore');
    this.db.close();
    this.db = null;
    try {
      atomicWriteFileSync(this.paths.dbPath, buffer);
      this.prepare(await this.openFile());
    } catch (err) {
      await this.reopenAfterFailure(safety.filePath);
      throw err;
    }
    this.db.transaction(() => recordAudit(this.db, actor, 'system.restore', { from: path.basename(filePath), safetyBackup: safety.fileName }));
    this.session.user = null;
    return { safetyBackup: safety.filePath };
  }

  /** Start over with an empty database. The current data is backed up first. */
  async factoryReset(actor) {
    const safety = this.backup.create('pre-reset'); // throws (aborting the reset) if it cannot be written
    this.db.close();
    this.db = null;
    try {
      fs.unlinkSync(this.paths.dbPath);
      this.prepare(await this.openFile());
    } catch (err) {
      await this.reopenAfterFailure(safety.filePath);
      throw err;
    }
    this.db.transaction(() => recordAudit(this.db, actor, 'system.factory_reset', { safetyBackup: safety.fileName }));
    this.session.user = null;
    return { safetyBackup: safety.filePath };
  }

  /**
   * A restore or reset failed after the live database was closed (file locked
   * by antivirus, disk full...). Open whatever is on disk again, or else the
   * safety backup just taken, so the till keeps working instead of every
   * operation failing until the app is restarted.
   */
  async reopenAfterFailure(safetyBackupPath) {
    if (this.db) {
      try {
        this.db.sqlDb.close();
      } catch (_) {
        /* already closed */
      }
      this.db = null;
    }
    try {
      this.prepare(await this.openFile());
    } catch (_) {
      atomicWriteFileSync(this.paths.dbPath, fs.readFileSync(safetyBackupPath));
      this.prepare(await this.openFile());
    }
  }

  shutdown() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = { AppContext, QuitRequested, storagePaths, DB_FILE_NAME };
