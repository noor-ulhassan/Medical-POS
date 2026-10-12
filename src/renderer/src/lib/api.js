/**
 * Client for the main-process API (preload exposes window.noorpos.call).
 * Returns data or throws ApiError; session problems are broadcast so the
 * lock screen can react.
 */

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

const sessionListeners = new Set();

/** listener(code) is called on UNAUTHENTICATED or PIN_CHANGE_REQUIRED. Returns an unsubscribe function. */
export function onSessionProblem(listener) {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export async function call(method, payload) {
  const res = await window.noorpos.call(method, payload);
  if (res && res.ok) return res.data;
  const error = (res && res.error) || { code: 'INTERNAL', message: 'No response from the application' };
  if ((error.code === 'UNAUTHENTICATED' && method !== 'auth.login') || error.code === 'PIN_CHANGE_REQUIRED') {
    sessionListeners.forEach((listener) => listener(error.code));
  }
  throw new ApiError(error.code, error.message);
}

export const isSessionError = (err) => err && (err.code === 'UNAUTHENTICATED' || err.code === 'PIN_CHANGE_REQUIRED');
