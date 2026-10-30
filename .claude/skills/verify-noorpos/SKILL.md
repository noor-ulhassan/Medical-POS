---
name: verify-noorpos
description: Drive the real Noor Pharmacy POS desktop app (Electron + React) the way shop staff do, with throwaway data, and capture screenshots and DOM state as proof. Use to prove a UI or behavior change works, to screenshot screens, or when checking a feature end to end beyond the unit tests and `npm run smoke`.
---

# Verify Noor Pharmacy POS

The app is a Windows desktop POS: an Electron main process serving a React UI from `app://noorpos/index.html`. Users touch only that window (PIN keypad, sell screen, dialogs). This skill launches one isolated instance with remote debugging and drives it over the Chrome DevTools Protocol with `scripts/drive.mjs`.

Two other proofs exist and stay the first line: `npm test` (main-process services, 80+ tests) and `npm run smoke` (one long scripted run in the real window, exits 0/1). Use this skill for anything they don't cover, above all how a screen looks.

## Launch

```bash
node .claude/skills/verify-noorpos/scripts/drive.mjs launch            # builds the UI first (vite), then starts the app
node .claude/skills/verify-noorpos/scripts/drive.mjs launch --no-build # reuse build/renderer when src/renderer is unchanged
```

- Data lives in a new folder under `<os temp>/noorpos-verify/<run>/data` (never the shop's `%LOCALAPPDATA%\NoorPharmacyPOS`). Sample products are seeded (`NOORPOS_DEMO_DATA=1`); `--empty` starts with none.
- Ready means `document.body.dataset.ready === "true"` in the window, which the app sets after its first load. `launch` waits for it (90 s max) and prints the run's pid, port and folders.
- The window is fixed to 1280x698 CSS pixels (a 1920x1080 screen at 150%, the common counter setup). `--size 1366x720` picks another size.
- A fresh install is locked. The admin PIN is `1234` and must be changed at first login; `$v.login()` does both (new PIN `7391`).
- One instance at a time. `launch` refuses while one runs. The window opens on the desktop; it does not touch the user's own running app (separate profile, separate single-instance lock).

## Doctor

```bash
node .claude/skills/verify-noorpos/scripts/drive.mjs doctor
```

Healthy means: process alive, page `app://noorpos/index.html` ready, and `app.info.dataDir` equals this run's data folder (`ownsDataDir: true`). Run it before the first drive and after anything surprising. Unhealthy: `stop`, then `launch` again; never drive an unhealthy instance.

## Drive

```bash
node .claude/skills/verify-noorpos/scripts/drive.mjs eval -e "await \$v.login(); return \$v.exists('posView');"
node .claude/skills/verify-noorpos/scripts/drive.mjs eval path/to/journey.js   # file body runs inside an async function; `return` a JSON value
```

`eval` runs in the app window after `scripts/page-helpers.js`, which defines `window.$v`:

| Helper | Does |
| --- | --- |
| `$v.login(pin = '1234', newPin = '7391')` | PIN keypad, forced PIN change on first start, waits for the Sell screen |
| `$v.nav(viewId)` | clicks the menu item `.nav-item[data-target=viewId]` and waits for `#viewId` |
| `$v.type(elOrSelector, value)` | sets a React field like typing (input, textarea, select) |
| `$v.key(target, 'Enter', { shiftKey })` | keydown on an element or `document` (F1-F4, F12, Enter, Escape) |
| `$v.click(sel)`, `$v.button('Label', scope)` | click; find a button by its visible text |
| `$v.waitFor(label, () => cond, ms)` | poll until true, throw with the label |
| `$v.text(sel)`, `$v.exists(id)`, `$v.$`, `$v.$$` | read the DOM |
| `$v.overflowing()` | elements wider than the window (a layout bug at this size) |
| `$v.closeDialogs()` | click every open dialog's close button |

Views (`viewId`): `posView` Sell, `salesView` Past sales, `quotationView`, `inventoryView` Medicines & stock, `expiryView`, `ordersView` Order from supplier, `suppliersView`, `khataView`, `dashboardView` Today's report, `profitView`, `expensesView`, `settingsView`.

Stable handles to prefer (the smoke test uses them too): element ids (`#posSearchInput`, `#btnOpenCheckoutModal`, `#checkoutPaymentForm`, `#modalReceiptPreview`, `#cartItemsList`, `#salesTableBody`...), `data-*` attributes (`data-product-id`, `data-cart-qty`, `data-void`, `data-return`, `data-pay`, `data-edit`, `data-receive`), form field `name`s, and `aria-label`s. Recipes per feature are in [features/](features/README.md).

## Evidence

```bash
node .claude/skills/verify-noorpos/scripts/drive.mjs shot sell-after-sale   # prints the PNG path
```

- Screenshots go to `<os temp>/noorpos-verify/<run>/evidence/<name>.png`, outside the repository. Open them with the Read tool to look at them.
- Prove the user path, not internals: click and type through the UI, then capture the action's result and a second view of it (a sale on the receipt and in Past sales; stock on the product list).
- For layout work, also return `$v.overflowing()` and check it is empty.
- Never put screenshots in the repository.

## Cleanup

```bash
node .claude/skills/verify-noorpos/scripts/drive.mjs stop      # kills the run's own process tree, deletes its data and profile, keeps evidence
node .claude/skills/verify-noorpos/scripts/drive.mjs discard   # deletes every run folder, evidence included
```

`stop` kills only the pid this run started. Evidence survives `stop` so it can be reviewed. This project's owner does not keep screenshots: when the task is finished and the evidence has been looked at, run `discard`, and say so in the report.

## Helpers

- `scripts/drive.mjs`: launch, doctor, eval, shot, stop, discard (usage at the top of the file). Needs Node 22+ (global `WebSocket` and `fetch`) and `npm install` done in the repo.
- `scripts/page-helpers.js`: the in-window `$v` helpers above, loaded before every `eval`.
- `features/`: the feature map. Keep it honest with `/maintain-verification-skill` when screens change.
