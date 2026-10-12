'use strict';

const fs = require('fs');
const path = require('path');
const { atomicWriteFileSync } = require('../lib/fsutil');

let sqlJsPromise = null;

/** Load the sql.js WASM engine once per process. */
function loadSqlJs() {
  if (!sqlJsPromise) {
    const initSqlJs = require('sql.js');
    const wasmDir = path.dirname(require.resolve('sql.js/dist/sql-wasm.wasm'));
    sqlJsPromise = initSqlJs({ locateFile: (file) => path.join(wasmDir, file) });
  }
  return sqlJsPromise;
}

class DatabaseCorruptError extends Error {
  constructor(filePath, cause) {
    super(`The database file is damaged or is not a Noor Pharmacy POS database: ${filePath}`);
    this.name = 'DatabaseCorruptError';
    this.filePath = filePath;
    this.cause = cause;
  }
}

function normalizeParams(params) {
  return (params || []).map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

/**
 * Thin wrapper around an in-memory sql.js database that is mirrored to disk.
 *
 * Rules:
 *  - every write goes through transaction(); it commits and then persists the
 *    whole database atomically before returning;
 *  - a damaged file is never silently replaced (see open()).
 */
class Database {
  constructor(SQL, sqlDb, filePath, { onPersistError } = {}) {
    this.SQL = SQL;
    this.sqlDb = sqlDb;
    this.filePath = filePath;
    this.onPersistError = onPersistError || ((err) => console.error('[db] persist failed:', err));
    this.inTransaction = false;
    this.dirty = false;
    this.applyConnectionPragmas();
  }

  /**
   * Open the database file, or create an empty in-memory database when the
   * file does not exist. Throws DatabaseCorruptError (and leaves the file
   * untouched) when the file cannot be read as a healthy SQLite database.
   */
  static async open(filePath, options = {}) {
    const SQL = await loadSqlJs();
    if (!filePath || !fs.existsSync(filePath)) {
      return { db: new Database(SQL, new SQL.Database(), filePath, options), created: true };
    }
    const sqlDb = Database.openValidated(SQL, fs.readFileSync(filePath), filePath);
    return { db: new Database(SQL, sqlDb, filePath, options), created: false };
  }

  /** In-memory database that never touches disk (tests, restore validation). */
  static async inMemory(buffer) {
    const SQL = await loadSqlJs();
    const sqlDb = buffer ? Database.openValidated(SQL, buffer, '<buffer>') : new SQL.Database();
    return new Database(SQL, sqlDb, null);
  }

  static openValidated(SQL, buffer, label) {
    let sqlDb;
    try {
      sqlDb = new SQL.Database(buffer);
      const result = sqlDb.exec('PRAGMA quick_check;');
      const status = result[0] && result[0].values[0] && result[0].values[0][0];
      if (status !== 'ok') throw new Error(`integrity check reported: ${status}`);
      return sqlDb;
    } catch (err) {
      if (sqlDb) {
        try {
          sqlDb.close();
        } catch (_) {
          /* ignore */
        }
      }
      throw new DatabaseCorruptError(label, err);
    }
  }

  applyConnectionPragmas() {
    // sql.js resets connection pragmas on export(), so this runs after every save.
    this.sqlDb.run('PRAGMA foreign_keys = ON;');
  }

  all(sql, params) {
    const stmt = this.sqlDb.prepare(sql);
    try {
      stmt.bind(normalizeParams(params));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(sql, params) {
    const rows = this.all(sql, params);
    return rows.length ? rows[0] : null;
  }

  /** Single value of the first column of the first row. */
  value(sql, params) {
    const row = this.get(sql, params);
    return row ? row[Object.keys(row)[0]] : null;
  }

  run(sql, params) {
    this.sqlDb.run(sql, normalizeParams(params));
    const changes = this.sqlDb.getRowsModified();
    const lastInsertRowid = this.sqlDb.exec('SELECT last_insert_rowid();')[0].values[0][0];
    return { changes, lastInsertRowid };
  }

  /** Execute a script of several statements (schema/migrations only). */
  exec(sql) {
    this.sqlDb.exec(sql);
  }

  /**
   * Run fn inside BEGIN/COMMIT. Nested calls join the outer transaction.
   * On success the database is persisted to disk before returning.
   */
  transaction(fn) {
    if (this.inTransaction) return fn();
    this.sqlDb.run('BEGIN IMMEDIATE;');
    this.inTransaction = true;
    let result;
    try {
      result = fn();
      this.sqlDb.run('COMMIT;');
    } catch (err) {
      try {
        this.sqlDb.run('ROLLBACK;');
      } catch (_) {
        /* the failed statement may already have rolled back */
      }
      throw err;
    } finally {
      this.inTransaction = false;
    }
    this.dirty = true;
    this.persist();
    return result;
  }

  export() {
    const data = this.sqlDb.export();
    this.applyConnectionPragmas();
    return Buffer.from(data);
  }

  /** Write the database to disk atomically. Returns false (and reports) on failure. */
  persist() {
    if (!this.filePath) {
      this.dirty = false;
      return true;
    }
    try {
      atomicWriteFileSync(this.filePath, this.export());
      this.dirty = false;
      return true;
    } catch (err) {
      // The committed data is still in memory; the next successful persist
      // (or the one on quit) will write it.
      this.onPersistError(err);
      return false;
    }
  }

  close() {
    if (this.dirty) this.persist();
    this.sqlDb.close();
  }
}

module.exports = { Database, DatabaseCorruptError, loadSqlJs };
