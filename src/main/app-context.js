'use strict';

const fs = require('fs');
const path = require('path');
const { Database, DatabaseCorruptError } = require('./db/Database');
const { migrate, pendingMigrations, LegacySchemaError, NewerSchemaError } = require('./db/migrations');
const { ensureEssentialRows, seedDemoData } = require('./db/seed');
const { ensureDir, timestampForFile, atomicWriteFileSync } = require('./lib/fsutil');
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
    this.backup = createBackupService({ getDb: () => this.db, backupsDir: this.paths.backupsDir });
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
    return this;
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
      parked: createParkedService(db),
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
    atomicWriteFileSync(this.paths.dbPath, buffer);
    this.prepare(await this.openFile());
    this.db.transaction(() => recordAudit(this.db, actor, 'system.restore', { from: path.basename(filePath), safetyBackup: safety.fileName }));
    this.session.user = null;
    return { safetyBackup: safety.filePath };
  }

  /** Start over with an empty database. The current data is backed up first. */
  async factoryReset(actor) {
    const safety = this.backup.create('pre-reset'); // throws (aborting the reset) if it cannot be written
    this.db.close();
    this.db = null;
    fs.unlinkSync(this.paths.dbPath);
    this.prepare(await this.openFile());
    this.db.transaction(() => recordAudit(this.db, actor, 'system.factory_reset', { safetyBackup: safety.fileName }));
    this.session.user = null;
    return { safetyBackup: safety.filePath };
  }

  shutdown() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = { AppContext, QuitRequested, storagePaths, DB_FILE_NAME };
