'use strict';

const { nowIso } = require('../lib/dates');

/** Append a row to the audit log. Call inside the caller's transaction. */
function recordAudit(db, actor, action, details = {}) {
  db.run('INSERT INTO audit_log (user_id, user_name, action, details, created_at) VALUES (?, ?, ?, ?, ?);', [
    actor ? actor.id : null,
    actor ? actor.name : '',
    action,
    typeof details === 'string' ? details : JSON.stringify(details),
    nowIso()
  ]);
}

function createAuditService(db) {
  return {
    list({ limit = 200 } = {}) {
      return db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?;', [Math.min(Math.max(limit, 1), 1000)]);
    }
  };
}

module.exports = { recordAudit, createAuditService };
