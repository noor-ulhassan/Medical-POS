/**
 * Preferences that belong to this computer (screen and printer), not to the
 * shop's data: text size, how receipts print and when the till locks itself
 * after it is left unused. Kept in the browser
 * profile; every access is guarded so the app works if storage is blocked.
 */

export const TEXT_SIZES = [
  { value: 'normal', label: 'Normal', factor: 1 },
  { value: 'large', label: 'Large', factor: 1.15 },
  { value: 'larger', label: 'Larger', factor: 1.3 }
];

/** Minutes without use before the till locks itself (0 = never). */
export const AUTO_LOCK_CHOICES = [
  { value: 0, label: 'Never' },
  { value: 2, label: 'After 2 minutes' },
  { value: 5, label: 'After 5 minutes' },
  { value: 10, label: 'After 10 minutes' },
  { value: 30, label: 'After 30 minutes' }
];

const DEFAULTS = { textSize: 'normal', autoPrintReceipt: false, silentPrint: false, autoLockMinutes: 10 };
const KEY = 'noorpos_computer_prefs';

export function readPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const prefs = { ...DEFAULTS, ...saved };
    if (!TEXT_SIZES.some((t) => t.value === prefs.textSize)) prefs.textSize = DEFAULTS.textSize;
    prefs.autoPrintReceipt = prefs.autoPrintReceipt === true;
    prefs.silentPrint = prefs.silentPrint === true;
    if (!AUTO_LOCK_CHOICES.some((c) => c.value === prefs.autoLockMinutes)) prefs.autoLockMinutes = DEFAULTS.autoLockMinutes;
    return prefs;
  } catch (_) {
    return { ...DEFAULTS };
  }
}

export function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (_) {
    /* the setting still applies until the app is closed */
  }
  return next;
}

export const zoomFactor = (textSize) => (TEXT_SIZES.find((t) => t.value === textSize) || TEXT_SIZES[0]).factor;
