/**
 * Preferences that belong to this computer (screen and printer), not to the
 * shop's data: text size and how receipts print. Kept in the browser
 * profile; every access is guarded so the app works if storage is blocked.
 */

export const TEXT_SIZES = [
  { value: 'normal', label: 'Normal', factor: 1 },
  { value: 'large', label: 'Large', factor: 1.15 },
  { value: 'larger', label: 'Larger', factor: 1.3 }
];

const DEFAULTS = { textSize: 'normal', autoPrintReceipt: false, silentPrint: false };
const KEY = 'noorpos_computer_prefs';

export function readPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const prefs = { ...DEFAULTS, ...saved };
    if (!TEXT_SIZES.some((t) => t.value === prefs.textSize)) prefs.textSize = DEFAULTS.textSize;
    prefs.autoPrintReceipt = prefs.autoPrintReceipt === true;
    prefs.silentPrint = prefs.silentPrint === true;
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
