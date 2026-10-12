'use strict';

const MIGRATIONS = [require('./001_baseline'), require('./002_v2_hardening')];
const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Database created by a pre-1.1 build (batch-based schema) that cannot be upgraded in place. */
class LegacySchemaError extends Error {
  constructor() {
    super('This database was created by an old, incompatible version of this app (batch-based inventory).');
    this.name = 'LegacySchemaError';
  }
}

/** Database written by a newer version of this app. */
class NewerSchemaError extends Error {
  constructor(version) {
    super(`This database was created by a newer version of Noor Pharmacy POS (schema ${version}). Please update the app.`);
    this.name = 'NewerSchemaError';
    this.version = version;
  }
}

function schemaVersion(db) {
  return Number(db.value('PRAGMA user_version;')) || 0;
}

function assertSupported(db) {
  const version = schemaVersion(db);
  if (version > LATEST_VERSION) throw new NewerSchemaError(version);
  if (version === 0) {
    const hasProducts = db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'products';");
    if (hasProducts) {
      const cols = db.all('PRAGMA table_info(products);').map((c) => c.name);
      if (!['title', 'expiry_date', 'quantity_packs'].every((c) => cols.includes(c))) {
        throw new LegacySchemaError();
      }
    }
  }
  return version;
}

function pendingMigrations(db) {
  const version = assertSupported(db);
  return MIGRATIONS.filter((m) => m.version > version);
}

/**
 * Apply all pending migrations in one transaction. Nothing is dropped
 * without first being copied into its replacement table.
 */
function migrate(db) {
  const from = schemaVersion(db);
  const pending = pendingMigrations(db);
  if (pending.length === 0) return { from, to: from, applied: [] };

  // Table rebuilds require foreign keys off; integrity is re-checked before commit.
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.transaction(() => {
      for (const migration of pending) {
        migration.up(db);
        db.exec(`PRAGMA user_version = ${migration.version};`);
      }
      const violations = db.all('PRAGMA foreign_key_check;');
      if (violations.length > 0) {
        throw new Error(`Migration produced ${violations.length} foreign key violation(s): ${JSON.stringify(violations.slice(0, 5))}`);
      }
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
  return { from, to: LATEST_VERSION, applied: pending.map((m) => m.name) };
}

module.exports = {
  migrate,
  pendingMigrations,
  schemaVersion,
  assertSupported,
  LATEST_VERSION,
  LegacySchemaError,
  NewerSchemaError
};
