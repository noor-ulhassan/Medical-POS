# Architecture

```
┌──── Renderer: React 18 + Tailwind 3, bundled by Vite (sandboxed, no Node) ─────┐
│ main.jsx        providers: Toast → AppState → Confirm → Documents → Cart → App  │
│ App.jsx         session flow, theme, global shortcuts, current screen          │
│ features/<area> one folder per screen (pos, products, khata, sales, settings…) │
│ state/          AppState (session, cached data, navigation), Cart (the sale)   │
│ ui/             Button, Field, Modal stack, Toast, Confirm, Table, pills, tabs │
│ print/          receipt + A4 documents (ledger, PO, quotation, stock history)  │
│ lib/api.js      call('method', payload) → preload → main                       │
└──────────────────────────────┬─────────────────────────────────────────────────┘
                               │ window.noorpos.call('sales.checkout', {...})
┌──────────────────────────────▼──── preload.js ────────────────────────────────┐
│ exposes ONE function (call) + a warning listener. No SQL, no fs.              │
└──────────────────────────────┬────────────────────────────────────────────────┘
                               │ ipcMain.handle('rpc')  (caller must be app://noorpos)
┌──────────────────────────────▼──────── Main process ──────────────────────────┐
│ ipc/dispatcher.js  session check → PIN-change check → permission check        │
│ ipc/routes.js      method name → service call (the complete API surface)      │
│ services/*.js      business rules, validation, transactions, audit log        │
│ db/Database.js     sql.js wrapper: transactions, atomic persistence           │
│ db/migrations/     versioned schema changes (PRAGMA user_version)             │
│ app-context.js     composition root: startup, recovery, restore, reset        │
│ protocol.js        serves build/renderer/ at app://noorpos/                  │
└───────────────────────────────────────────────────────────────────────────────┘
src/shared/   pricing.js (money, units, totals) + permissions.js (role matrix),
              required by the main process and bundled into the UI, so the
              on-screen preview and the authoritative calculation never disagree.
```

## Rules the code relies on

1. **The renderer is untrusted.** It cannot run SQL. Every operation is a named route that validates its input (`lib/validate.js`) and is checked against the role matrix in `shared/permissions.js` by the dispatcher, using the user re-read from the database on every call. Hiding buttons in the UI (`data-requires`) is only a convenience.
2. **Prices and totals are computed in the main process.** The cart sends product ids, unit types and quantities. Prices come from the database.
3. **Stock and balances change relatively** (`stock_units = stock_units - ?`), inside one transaction per business operation (sale, void, payment). Never read a value, compute in JS, and write back an absolute value.
4. **Every write goes through `db.transaction()`**, which commits and then writes the whole database to disk atomically (temp file + fsync + rename). `db.run()` outside a transaction is only for migrations and tests.
5. **Never destroy data implicitly.** A damaged or incompatible database file is renamed, never overwritten. Migrations copy data into the new table before dropping the old one, and run after a file backup. Restore and reset take a backup first.
6. **Markup is only ever built with JSX**, which React escapes. ESLint forbids `dangerouslySetInnerHTML`, `innerHTML`, `alert`, `confirm` and `prompt` in the renderer.
7. **Timestamps are UTC ISO strings. Business days are local days.** Day boundaries are computed in `lib/dates.js` and passed to SQL as ranges.

## Data model notes

- `products.stock_units` is the only stock figure (base units, e.g. tablets). Packs and loose units are derived (`splitUnits`). "Low stock" means whole packs ≤ `min_stock_level`.
- `sale_items.base_units` records exactly how many units a line consumed, so a void restores the right amount even if the pack size changed later.
- Products with sales history are archived (`is_active = 0`) instead of deleted.
- `customers.current_debt_cents` always equals the latest `customer_ledger.balance_after_cents`. Both are only changed by `postLedgerEntry()`. A negative balance is an advance.
- Customer id 1 is the walk-in customer (cash only). Invoice numbers come from `settings.next_invoice_no`.
- `stock_adjustments.kind` says what a stock change was: `OPENING`, `RECEIVED`, `CORRECTION` (a counting or typing mistake), `WRITE_OFF` (expired stock discarded) or `LOSS` (damaged or lost). Only `WRITE_OFF` and `LOSS` are losses in profit and loss, valued at cost (`value_cents`).
- `customer_ledger.payment_method` records how a khata payment was received; only `CASH` (or `NULL`, from before v4) counts towards the cash expected in the drawer.
- A cashier's bill discount is limited to `settings.cashier_max_discount_percent` (permission `sales.discountAnyAmount` lifts it); every discount is written to the audit log.
- The wrong-PIN lockout lives in `settings.login_failed_attempts` / `login_locked_until_ms` / `login_last_failure_ms`, so a restart does not reset it. Login is PIN-only (PINs are unique) and every member of staff can log in, so a correct login does not reset the count either; it fades after an hour without a wrong PIN. For the same reason changing one's own PIN is limited to a few tries per user per day (each try reveals whether a PIN is free), and "this PIN is already used" counts as a wrong guess.
- `settings.backup_copy_dir` is the optional second location (USB drive, cloud folder) that `AppContext.copyBackupsAway()` copies backups and prescription photos to, asynchronously, after each backup and every hour.

## User interface

- **Design tokens** live in `src/renderer/src/index.css` as CSS variables (light and dark) and are mapped to Tailwind colours in `tailwind.config.js` (`paper`, `surface`, `sunken`, `foil`, `ink`, `teal`, `amber`, `red`). Components never hard-code colours, so the dark theme is one `data-theme` switch. Teal marks primary actions; amber marks prescription-only items and warnings; red marks expired or out-of-stock items and destructive actions.
- **Type** is Atkinson Hyperlegible Next (bundled, SIL OFL), chosen because its characters are hard to confuse (1/l/7, 0/O), which matters for doses and prices. Numbers use tabular figures (the `num` class) so columns line up.
- **Density** is tuned for the most common counter setup, a 1920×1080 screen at 150% scaling (1280×698 CSS pixels): the sidebar, product list and cart fit without scrolling. The product list adapts to its own width with container queries.
- **Dialogs** (`ui/Modal.jsx`) form a stack: `Esc` closes only the top one, focus is trapped inside it and restored afterwards. A locked dialog (forced PIN change) cannot be dismissed.
- **The lock screen replaces the whole app** instead of covering it, so no store data is visible while locked.
- Electron 22 ships **Chromium 108**, so Tailwind 3.4 is used (Tailwind 4 needs Chromium 111+ for `color-mix()` and `oklch`), and Vite builds with `target: 'chrome108'`.

## Why sql.js (and not better-sqlite3)

The app must run on 32-bit Windows 7, which pins Electron to 22 (the last version that supports Windows 7). sql.js is pure WASM, so there are no native modules to rebuild per architecture. The trade-off is that the whole database lives in memory and is rewritten on each save. That is fine for a single pharmacy (a few MB, a few writes per minute). If a store's database grows past roughly 50 MB, or Windows 7 support is dropped, move to `better-sqlite3` with WAL mode. Only `db/Database.js` needs to change.

Measured growth is about 0.5 KB per sale (roughly 35 MB a year at 200 sales a day), and saving one sale took about 10 ms at 0.6 MB, 40 ms at 10 MB and 140 ms at 36 MB on a fast PC, so a busy shop reaches that point in one to two years.

Never call sql.js `exec()` for anything that runs often: it leaks WASM memory on every call that returns rows, and after about 330,000 calls in one session the engine fails ("memory access out of bounds"). `Database.run()` reads `last_insert_rowid()` through a prepared statement for this reason; `exec()` is only for schema scripts and migrations.

## Electron hardening

- `contextIsolation`, `sandbox`, no `nodeIntegration`. The UI is served from a custom `app://noorpos/` protocol that only exposes `src/renderer` and `src/shared`.
- Strict CSP (`script-src 'self'`, no inline scripts or event handlers). No remote content, navigation and new windows are blocked, and there is no application menu or devtools in production.
- Single-instance lock (two instances would overwrite each other's database writes).
- Data lives in `%LOCALAPPDATA%\NoorPharmacyPOS`, not Documents: Windows "Controlled folder access" blocks unknown apps from writing to Documents, and OneDrive often syncs it. `src/main/legacy-data.js` adopts data left in Documents by earlier releases on first start.
- `--reset-admin-pin` (or `npm run reset-pin`) issues a one-time admin PIN after a backup, for when no admin can log in. It is documented for the installer in the README, not on the lock screen.
- Chromium 108 cannot be updated (Windows 7), so images are only decoded when their first bytes are JPEG, PNG, GIF or BMP; WebP (CVE-2023-4863) is never accepted (`services/files.js`).
- The till locks itself after a while without use (Settings, This computer); receipts and dialogs close when it locks.
- Hardware acceleration is off by default for old GPU drivers. Set `NOORPOS_GPU=1` to enable it.

## Environment variables (development / support)

| Variable | Effect |
| --- | --- |
| `NOORPOS_DATA_DIR` | Use another data folder instead of `%LOCALAPPDATA%\NoorPharmacyPOS` |
| `NOORPOS_USER_DATA_DIR` | Chromium profile folder (keeps dev runs separate) |
| `NOORPOS_DEMO_DATA=1` | Add sample products to an empty database |
| `NOORPOS_DEV=1` | Devtools and menu |
| `NOORPOS_SMOKE=1` / `NOORPOS_SMOKE_SCENARIO` | Used by `npm run smoke` |
| `NOORPOS_GPU=1` | Enable hardware acceleration |
