'use strict';

const crypto = require('crypto');
const v = require('../lib/validate');
const { AppError, ErrorCodes, validationError, notFound, conflict } = require('../lib/errors');
const { hashPin, verifyPin, assertAcceptablePin, isWeakPin, PIN_PATTERN } = require('../lib/pin');
const { nowIso } = require('../lib/dates');
const { ROLES, permissionsFor } = require('../../shared/permissions');
const { recordAudit } = require('./audit');

const MAX_FAILED_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 30 * 1000;
const MAX_LOCKOUT_MS = 5 * 60 * 1000;
/** Wrong PINs are forgotten only after an hour without one (logging in does not reset them). */
const FAILURE_WINDOW_MS = 60 * 60 * 1000;
/** Tries at changing one's own PIN (any outcome) allowed per user in 24 hours. */
const MAX_PIN_CHANGES_PER_DAY = 5;
const PIN_CHANGE_ACTIONS = ['auth.pin_changed', 'auth.pin_taken', 'auth.pin_change_failed'];

function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    isActive: row.is_active === 1,
    mustChangePin: row.must_change_pin === 1,
    permissions: permissionsFor(row.role)
  };
}

function createAuthService(db, { now = () => Date.now() } = {}) {
  /*
   * Wrong-PIN lockout. Login is PIN-only, so PINs are unique and every member
   * of staff can log in: if a correct login reset the count, a cashier could
   * guess a few PINs, log in as themselves, and guess again for ever. So the
   * count only fades after an hour without a wrong PIN, and it is kept in the
   * settings row so that restarting the app does not reset it either. Wrong
   * guesses made through "change my PIN" count too ("this PIN is already used"
   * reveals another user's PIN just like a login does).
   */
  function lockoutRow() {
    return (
      db.get(
        'SELECT login_failed_attempts AS attempts, login_locked_until_ms AS until, login_last_failure_ms AS last FROM settings WHERE id = 1;'
      ) || { attempts: 0, until: 0, last: 0 }
    );
  }

  function saveLockout(attempts, until, last) {
    db.run('UPDATE settings SET login_failed_attempts = ?, login_locked_until_ms = ?, login_last_failure_ms = ? WHERE id = 1;', [
      attempts,
      until,
      last
    ]);
  }

  /** Throws LOCKED_OUT while the keypad is locked. */
  function assertNotLockedOut() {
    const { attempts, until, last } = lockoutRow();
    let remaining = until - now();
    if (remaining > MAX_LOCKOUT_MS) {
      // The PC clock was moved back: never lock for longer than the maximum.
      remaining = MAX_LOCKOUT_MS;
      db.transaction(() => saveLockout(attempts, now() + MAX_LOCKOUT_MS, last));
    }
    if (remaining > 0) {
      throw new AppError(ErrorCodes.LOCKED_OUT, `Too many wrong PINs. Try again in ${Math.ceil(remaining / 1000)} seconds.`);
    }
  }

  /** Count a wrong guess (inside the caller's transaction) and start or extend the lockout. */
  function registerFailure() {
    const previous = lockoutRow();
    const attempts = now() - previous.last > FAILURE_WINDOW_MS ? 1 : previous.attempts + 1;
    let until = 0;
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const factor = 2 ** Math.min(attempts - MAX_FAILED_ATTEMPTS, 10);
      until = now() + Math.min(BASE_LOCKOUT_MS * factor, MAX_LOCKOUT_MS);
    }
    saveLockout(attempts, until, now());
    return attempts;
  }

  /** Only for the recovery started on the computer itself (--reset-admin-pin). */
  function clearFailures() {
    saveLockout(0, 0, 0);
  }

  function activeUsers() {
    return db.all('SELECT * FROM users WHERE is_active = 1 ORDER BY id;');
  }

  function findActiveUserByPin(pin, { excludeUserId } = {}) {
    return activeUsers().find((u) => u.id !== excludeUserId && verifyPin(pin, u.pin_hash)) || null;
  }

  /** Login is PIN-only, so PINs must be unique among active users. */
  function assertPinAvailable(pin, excludeUserId) {
    if (findActiveUserByPin(pin, { excludeUserId })) {
      throw conflict('This PIN is already used by another user. Choose a different one.');
    }
  }

  function getUserRow(id) {
    const row = db.get('SELECT * FROM users WHERE id = ?;', [id]);
    if (!row) throw notFound('User not found');
    return row;
  }

  function activeAdminCount(excludeUserId) {
    return db.value("SELECT COUNT(*) FROM users WHERE role = 'Admin' AND is_active = 1 AND id != ?;", [excludeUserId || 0]);
  }

  return {
    /** True until the seeded Administrator has chosen their own PIN (drives the lock-screen hint). */
    isFirstRun() {
      const users = db.all('SELECT must_change_pin FROM users;');
      return users.length === 1 && users[0].must_change_pin === 1;
    },

    login(input) {
      const { pin } = v.object(input);
      assertNotLockedOut();
      const user = typeof pin === 'string' && PIN_PATTERN.test(pin) ? findActiveUserByPin(pin) : null;
      if (!user) {
        db.transaction(() => recordAudit(db, null, 'auth.login_failed', { attempts: registerFailure() }));
        throw new AppError(ErrorCodes.UNAUTHENTICATED, 'Invalid PIN');
      }
      db.transaction(() => recordAudit(db, user, 'auth.login'));
      return toPublicUser(user);
    },

    /** Re-read the user so role/active changes take effect on the next call. */
    refreshUser(userId) {
      const row = db.get('SELECT * FROM users WHERE id = ? AND is_active = 1;', [userId]);
      return row ? toPublicUser(row) : null;
    },

    changeOwnPin(actor, input) {
      const { currentPin, newPin } = v.object(input);
      assertNotLockedOut();
      // Each try, whatever its outcome, says whether a PIN is free or someone else's,
      // so a user gets a few tries a day (a real change needs one or two).
      const since = new Date(now() - 24 * 60 * 60 * 1000).toISOString();
      const triesToday = db.value(
        `SELECT COUNT(*) FROM audit_log WHERE user_id = ? AND created_at >= ? AND action IN (${PIN_CHANGE_ACTIONS.map(() => '?').join(', ')});`,
        [actor.id, since, ...PIN_CHANGE_ACTIONS]
      );
      if (triesToday >= MAX_PIN_CHANGES_PER_DAY) {
        throw new AppError(
          ErrorCodes.LOCKED_OUT,
          'Your PIN has been changed, or tried, too many times today. Ask the owner to give you a new PIN in Settings, under Staff and PINs.'
        );
      }
      const row = getUserRow(actor.id);
      if (!verifyPin(String(currentPin || ''), row.pin_hash)) {
        db.transaction(() => recordAudit(db, actor, 'auth.pin_change_failed', { reason: 'wrong current PIN', attempts: registerFailure() }));
        throw validationError('Current PIN is incorrect');
      }
      assertAcceptablePin(newPin);
      if (findActiveUserByPin(newPin, { excludeUserId: actor.id })) {
        // Counted and logged like a wrong PIN at the keypad (see registerFailure).
        db.transaction(() => recordAudit(db, actor, 'auth.pin_taken', { attempts: registerFailure() }));
        throw conflict('This PIN is already used by another user. Choose a different one.');
      }
      db.transaction(() => {
        db.run('UPDATE users SET pin_hash = ?, must_change_pin = 0 WHERE id = ?;', [hashPin(newPin), actor.id]);
        recordAudit(db, actor, 'auth.pin_changed');
      });
      return toPublicUser(getUserRow(actor.id));
    },

    listUsers() {
      return db.all('SELECT * FROM users ORDER BY is_active DESC, role, name;').map(toPublicUser);
    },

    createUser(actor, input) {
      const data = v.object(input);
      const name = v.string(data.name, 'Name', { required: true, max: 80 });
      const role = v.oneOf(data.role, 'Role', ROLES);
      const pin = assertAcceptablePin(data.pin);
      assertPinAvailable(pin);
      const id = db.transaction(() => {
        const res = db.run(
          'INSERT INTO users (name, role, pin_hash, must_change_pin, is_active, created_at) VALUES (?, ?, ?, 1, 1, ?);',
          [name, role, hashPin(pin), nowIso()]
        );
        recordAudit(db, actor, 'users.create', { userId: res.lastInsertRowid, name, role });
        return res.lastInsertRowid;
      });
      return toPublicUser(getUserRow(id));
    },

    updateUser(actor, input) {
      const data = v.object(input);
      const id = v.id(data.id, 'User');
      const row = getUserRow(id);
      const name = v.string(data.name, 'Name', { required: true, max: 80 });
      const role = v.oneOf(data.role, 'Role', ROLES);
      const isActive = v.boolean(data.isActive);

      if (id === actor.id && (!isActive || role !== row.role)) {
        throw validationError('You cannot deactivate yourself or change your own role');
      }
      const losesAdmin = row.role === 'Admin' && row.is_active === 1 && (role !== 'Admin' || !isActive);
      if (losesAdmin && activeAdminCount(id) === 0) {
        throw validationError('At least one active Admin is required');
      }
      // A deactivated user's PIN may since have been given to someone else, so
      // reactivation always comes with a fresh PIN (salted hashes can't be compared).
      const reactivating = isActive && row.is_active === 0;
      let newPinHash = null;
      if (reactivating) {
        if (!data.pin) throw validationError('Set a new PIN to reactivate this user');
        assertPinAvailable(assertAcceptablePin(data.pin), id);
        newPinHash = hashPin(data.pin);
      }
      db.transaction(() => {
        db.run('UPDATE users SET name = ?, role = ?, is_active = ? WHERE id = ?;', [name, role, isActive ? 1 : 0, id]);
        if (newPinHash) db.run('UPDATE users SET pin_hash = ?, must_change_pin = 1 WHERE id = ?;', [newPinHash, id]);
        recordAudit(db, actor, 'users.update', { userId: id, name, role, isActive });
      });
      return toPublicUser(getUserRow(id));
    },

    /**
     * Last-resort recovery when no admin can log in: give the first admin a
     * random temporary PIN that must be changed at login. Only reachable by
     * starting the app with --reset-admin-pin on the computer itself, which
     * already implies access to the data folder.
     */
    recoverAdminPin() {
      const admin = db.get("SELECT * FROM users WHERE role = 'Admin' ORDER BY is_active DESC, id LIMIT 1;");
      if (!admin) throw notFound('No admin account exists');
      let pin;
      do {
        pin = String(crypto.randomInt(100000, 1000000));
      } while (isWeakPin(pin) || findActiveUserByPin(pin, { excludeUserId: admin.id }));
      db.transaction(() => {
        db.run('UPDATE users SET pin_hash = ?, must_change_pin = 1, is_active = 1 WHERE id = ?;', [hashPin(pin), admin.id]);
        clearFailures();
        recordAudit(db, { id: null, name: 'PIN recovery' }, 'users.reset_pin', { userId: admin.id, via: 'recovery' });
      });
      return { user: toPublicUser(getUserRow(admin.id)), pin };
    },

    resetUserPin(actor, input) {
      const data = v.object(input);
      const id = v.id(data.id, 'User');
      getUserRow(id);
      const pin = assertAcceptablePin(data.pin);
      assertPinAvailable(pin, id);
      db.transaction(() => {
        db.run('UPDATE users SET pin_hash = ?, must_change_pin = 1 WHERE id = ?;', [hashPin(pin), id]);
        recordAudit(db, actor, 'users.reset_pin', { userId: id });
      });
      return toPublicUser(getUserRow(id));
    }
  };
}

module.exports = { createAuthService, toPublicUser, MAX_FAILED_ATTEMPTS, MAX_PIN_CHANGES_PER_DAY };
