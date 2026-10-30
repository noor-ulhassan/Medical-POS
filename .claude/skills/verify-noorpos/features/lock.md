# Lock and PIN

The till opens locked. Staff unlock with their own 4 to 6 digit PIN (the PIN identifies them); new staff and a fresh install must choose their own PIN first. F12 locks, and the till locks itself after a while without use, keeping the sale in progress. Wrong PINs lock the keypad for a while.

## Sub-features

- `lock-first-run` a fresh install shows the 1234 hint and forces a PIN change.
- `lock-unlock` the right PIN opens the Sell screen; a wrong one shakes and explains.
- `lock-f12` F12 (or the Lock button) returns to the keypad, and no store data stays on screen.
- `lock-auto` the till locks after the chosen idle time (Settings, This computer).
- `lock-lockout` five wrong PINs lock the keypad, also after a restart.

## How to get to it (user POV)

- The keypad on start-up; the Lock button at the bottom of the menu; F12.

## Driving it with drive.mjs

Preconditions: a fresh `launch`.

- **First run.** `#pinFirstRunHint` is shown. `$v.login()` enters 1234, changes the PIN to 7391 and reaches `#posView`.
- **Lock.** `$v.key(document, 'F12')`. `#modalPinAuth` exists and `#posView` does not.
- **Wrong PIN.** `$v.typePin('9999')`. `#pinError` has text.
- **Auto-lock.** Set the idle time by writing `localStorage.noorpos_computer_prefs` with `autoLockMinutes: 2`, wait about 130 s with no input; `#modalPinAuth` appears and the cart is kept after unlocking.
- **Proof.** `shot lock-keypad`, `shot lock-error`.

## Gotchas

- Logging in does not reset the wrong-PIN count (it fades after an hour), so repeated failed recipes can lock the keypad; relaunch for a clean state.
- Unlocking returns to Sell after loading; wait about a second before navigating (`$v.login` does).
