# Changelog

## Unreleased (branch ux/non-technical-owner)

Fixes that protect money and stock, and a simpler interface for an owner who is not used to computers.

### Money and stock correctness
- Fixed: the payment method stayed selected from the previous sale, so a cash sale straight after a card sale could be recorded as card (cash drawer would not match). Every checkout now starts at Cash.
- Fixed: pressing Enter twice quickly, or holding F2, could submit the same sale twice. Checkout is now locked while a sale is being saved.
- Fixed: expired medicine could be sold. It is now refused at the till and in the main process, with a message saying what to do.
- Fixed: "Sell these items again" silently replaced a sale being rung up. It now asks first.
- Fixed: the daily automatic backup only ran when the app was started, so a shop that never closes the app got no backups. It is now checked every hour.
- New: Receive stock. When a delivery arrives you enter only the packs received; they are added to the current stock (previously you had to type the new total, which was easy to get wrong). Optionally updates the shelf expiry date and cost price. Recorded in stock history and the activity log.
- New products no longer get a made-up expiry date one year ahead; the date printed on the pack must be entered.
- Editing a product's stock now shows exactly how the stock will change before saving.
- Cash checkout: cannot complete when the cash received is short; quick-cash buttons now suggest amounts above the total; khata sales over the limit are explained before submitting.

### Easier for the owner
- Start-up and PIN screens use the shop photo as their background (also behind the first-start "choose your PIN" step).
- PINs: any 4 to 6 digits are accepted, including simple ones such as 1234 or 0000, and the current PIN may be kept when asked to change it. PINs must still differ between staff, because the PIN identifies who is logging in.
- Today's report: money taken today by cash, card, wallet and khata, khata payments received, cancelled sales, and the cash that should be in the drawer.
- Help: a "How do I…?" window with step-by-step guides for everyday tasks, shown according to the user's role.
- Plain words: Past sales, Medicines & stock, Expiring soon, Order from supplier, Khata (credit), Today's report; "Void" is now "Cancel sale" and the dialog says exactly how much money to give back.
- Barcode scans are no longer lost after clicking with the mouse: typing on the Sell screen goes to the search box.
- Held sales show the customer, number of items and who held them instead of a code.
- Receipts show "Khata (credit)" / "Mobile wallet" instead of internal codes.
- Closing the window asks for confirmation (an unfinished sale would be lost).
- Larger menu buttons; the lock screen's "Forgot your PIN?" no longer asks the owner to use the command line.

## 2.0.0

A rewrite of the internals focused on data safety, correctness and security. Existing 1.x databases are upgraded automatically (a backup of the original file is made first).

### Data safety
- Every change is written to disk immediately using crash-safe writes (temp file, fsync, rename). Previously writes were delayed and written in place, so a power cut could corrupt the database.
- A damaged database is no longer silently replaced with an empty one. The app offers to restore the latest valid backup or start fresh, and keeps the damaged file.
- Schema upgrades no longer drop tables. Migrations are versioned and run after a backup.
- Automatic daily backups (last 14 kept), plus backups before every restore, factory reset and upgrade. Restore validates the chosen file first.
- Only one instance of the app can run at a time.

### Correctness
- Fixed: selling the same product as both a pack and single units in one sale deducted only one of the two lines from stock.
- Fixed: stock and khata balances were computed from data cached in the UI and written back as absolute values, so they could lose updates. Changes are now relative and transactional.
- Fixed: voiding a sale was several separate writes, could restore stock twice, and restored the wrong amount if the pack size changed later.
- Fixed: khata payments larger than the balance were recorded in full but the balance was clamped at zero, so the ledger disagreed.
- Fixed: "today" and the 7-day trend used UTC days, so late-night/early-morning sales landed on the wrong day.
- Fixed: the dashboard's best sellers included voided sales.
- Fixed: editing a product while sales were happening overwrote the stock sold in the meantime.
- Fixed: sales history pagination was hard-coded to 4 pages.
- Fixed: products with loose units but no full packs showed as "out of stock".
- Fixed: the admin user's name was reset to a hard-coded value on every start, and some store names were overwritten with a hard-coded store.
- Invoice numbers are sequential and configurable (`INV-000001`). Previously they were derived from the clock and could collide.
- Tax rate and per-receipt POS fee are settings (the fee was hard-coded to Rs 1).
- Products with sales history are archived instead of deleted.
- Generated barcodes are valid EAN-13 codes in the in-store range (prefix 2).
- Purchase orders use the cost price (new field) instead of the sale price.

### Security
- The UI can no longer run arbitrary SQL. All operations are named, validated and permission-checked in the main process.
- Admin / Manager / Cashier roles are now actually enforced. Previously every user could do everything, and the app started as Admin before any PIN was entered.
- PINs are hashed (scrypt), must be changed from published defaults, can be changed by the user, and are managed by admins. Wrong PINs trigger a lockout.
- Audit log for logins, voids, price changes, user/settings changes, restores and resets.
- Electron hardening: sandboxed renderer, custom protocol, strict CSP, no remote fonts, navigation and new windows blocked, no devtools/menu in production.
- All user-entered text is HTML-escaped by default.
- Removed `pos_api_server.js`, an unauthenticated HTTP server with CORS `*` and a hard-coded user path, left over from another project.

### Interface
- Rebuilt in React 18 and Tailwind CSS 3 (bundled by Vite, still fully offline). Same features and the same main-process API; only the presentation changed.
- New visual design with light and dark themes (follows Windows by default), Atkinson Hyperlegible type for unambiguous numbers, aligned figures for prices, and proper line icons instead of emoji.
- Sell screen: a search-first medicine list that adapts to the window width, `+ Unit` / `+ Pack` on every row, `↑`/`↓` with `Enter` / `Shift+Enter` keyboard selection, and a cart that ends in one large Charge button showing the amount due.
- Payment dialog with a large amount due, payment-method tiles, quick cash amounts, live change or shortfall, and the khata balance after the sale.
- Full-screen lock screen (no store data visible while locked), tabbed settings, consistent dialogs (Esc, focus trap), toasts that never cover the Charge button, and empty states that say what to do next.
- Tuned for 1920×1080 screens at 150% scaling (1280×698), the most common counter setup.
- Amounts are shown with thousands separators (Rs 10,000.00).

### Maintainability
- `app.js` (3,000 lines) replaced by a React app with one folder per screen and shared UI primitives. Business rules moved to main-process services.
- Unit and integration tests (`npm test`), ESLint (`npm run lint`), and an end-to-end smoke test that drives the real app (`npm run smoke`).
- CI runs lint, tests and the smoke test on every push and pull request. Releases are built only from tags and only after the checks pass.
- Architecture, contributing guide and changelog added.

## 1.1.0
- Initial public version.
