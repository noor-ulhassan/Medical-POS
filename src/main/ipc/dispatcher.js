'use strict';

const { AppError, ErrorCodes } = require('../lib/errors');
const { can } = require('../../shared/permissions');

/**
 * Resolves a method name to its route, enforces session / PIN-change /
 * permission rules, and converts the outcome into a serialisable envelope:
 *   { ok: true, data } | { ok: false, error: { code, message } }
 */
function createDispatcher(ctx, routes, { logger = console } = {}) {
  function authorize(route) {
    if (route.public) return ctx.session.user;

    const sessionUser = ctx.session.user;
    if (!sessionUser) throw new AppError(ErrorCodes.UNAUTHENTICATED, 'Please unlock the terminal with your PIN');

    // Re-read from the database so deactivation or role changes apply immediately.
    const user = ctx.services.auth.refreshUser(sessionUser.id);
    if (!user) {
      ctx.session.user = null;
      throw new AppError(ErrorCodes.UNAUTHENTICATED, 'Your account is no longer active');
    }
    ctx.session.user = user;

    if (user.mustChangePin && !route.allowPinChange) {
      throw new AppError(ErrorCodes.PIN_CHANGE_REQUIRED, 'You must change your PIN before continuing');
    }
    if (route.permission && !can(user.role, route.permission)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'You do not have permission to do this');
    }
    return user;
  }

  return async function dispatch(method, payload) {
    const route = Object.prototype.hasOwnProperty.call(routes, method) ? routes[method] : null;
    if (!route) return { ok: false, error: { code: ErrorCodes.NOT_FOUND, message: `Unknown operation: ${method}` } };
    try {
      const user = authorize(route);
      const data = await route.handler(payload, { user, ctx });
      return { ok: true, data: data === undefined ? null : data };
    } catch (err) {
      if (err instanceof AppError) {
        return { ok: false, error: { code: err.code, message: err.message } };
      }
      logger.error(`[ipc] ${method} failed:`, err);
      return { ok: false, error: { code: ErrorCodes.INTERNAL, message: `Unexpected error: ${err.message}` } };
    }
  };
}

module.exports = { createDispatcher };
