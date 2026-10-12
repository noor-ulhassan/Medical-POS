# Changelog

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
