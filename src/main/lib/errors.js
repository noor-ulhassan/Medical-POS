'use strict';

/**
 * An error whose message is safe to show to the user. Anything else that
 * escapes a service is treated as an internal error and logged instead.
 */
class AppError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const ErrorCodes = Object.freeze({
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  PIN_CHANGE_REQUIRED: 'PIN_CHANGE_REQUIRED',
  LOCKED_OUT: 'LOCKED_OUT',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  CREDIT_LIMIT: 'CREDIT_LIMIT',
  INTERNAL: 'INTERNAL'
});

const validationError = (message, details) => new AppError(ErrorCodes.VALIDATION, message, details);
const notFound = (message) => new AppError(ErrorCodes.NOT_FOUND, message);
const conflict = (message) => new AppError(ErrorCodes.CONFLICT, message);

module.exports = { AppError, ErrorCodes, validationError, notFound, conflict };
