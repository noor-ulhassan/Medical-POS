# Noor Pharmacy POS

Offline desktop point-of-sale and inventory software for small retail pharmacies, built with Electron, React, Tailwind CSS and SQLite (sql.js). Runs on Windows 7–11, 32- and 64-bit.

Maintained by **Noor ul Hassan** (noorulhassan01.dev@gmail.com).

## Features

| Area | What it does |
| --- | --- |
| **POS terminal** | Barcode/keyboard-driven checkout, sell by pack or single unit, flat or % discount, cash/card/wallet/credit, held (parked) carts, 80mm receipts and reprints |
| **Inventory** | Products with pack size, expiry, cost/sale prices, low-stock levels, audited stock corrections, auto-generated in-store EAN-13 barcodes |
| **Profit & expenses** | Profit and loss by day or month with charts: net sales, cost of medicines sold (recorded at the time of each sale), gross and net profit, margins, expenses by type, write-offs, most profitable medicines and categories |
| **Customer khata** | Credit accounts with limits, payments, running ledger and printable A4 statements |
| **Expiry center** | Stock expiring within 30/90/180 days, write-off of expired stock |
| **Restock** | Low/out-of-stock lists per supplier and printable purchase orders |
| **Sales log** | Search, reprint, re-order into cart, void (restores stock and khata), prescription images |
| **Users** | PIN login, Admin / Manager / Cashier roles enforced by the app, forced PIN change, lockout after wrong PINs, audit log |
| **Data safety** | Every change is saved immediately with crash-safe writes, daily automatic backups (14 kept), backups before every restore/reset/upgrade, damaged files are never overwritten |

## Install

Download the installer from this repository's **Releases** page and run it.

**First start:** unlock with the Administrator PIN **1234**. You will be asked to choose a new PIN straight away, then add your staff under **Settings & Users**.

### Roles

| Role | Can do |
| --- | --- |
| Cashier | Sell, hold carts, reprint receipts, attach prescriptions, view stock and customers, make quotations |
| Manager | Everything a cashier can, plus inventory, suppliers, khata accounts and payments, voids, write-offs, dashboard, restock |
| Admin | Everything, plus store settings, users, backup/restore and factory reset |

### Where data lives

Everything is stored in `%LOCALAPPDATA%\NoorPharmacyPOS\` (open it from **Settings → Backup and restore → Open data folder**):

```
noor_pharmacy_pos.db     the database
Backups\            automatic and manual backups (.db)
Prescriptions\      attached prescription images
```

Copy the `Backups` folder to a USB drive or cloud folder regularly. To restore, use **Settings → Restore From Backup**.

### Why not the Documents folder?

Windows "Controlled folder access" (ransomware protection) blocks apps from saving in Documents, and on many PCs Documents is synced by OneDrive, which can lock or duplicate a database file while the shop is selling. The local app-data folder has neither problem. Backups are still worth copying to a USB drive or cloud folder every week.

### Forgot the admin PIN?

Any admin can reset another user's PIN under **Settings → Staff and PINs**. If no admin can log in, close the app and start it once with `--reset-admin-pin`:

```
"%LOCALAPPDATA%\Programs\noor-pharmacy-pos\Noor Pharmacy POS.exe" --reset-admin-pin
```

(from source: `npm run reset-pin`). A backup is made, a temporary PIN for the first admin is shown once, and it must be changed at login.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `F1` | Sell screen search box (scan a barcode, then `Enter`) |
| `↑` / `↓` in the search box | Choose a medicine from the list; `Enter` adds a unit, `Shift`+`Enter` adds a pack |
| `F2` | Open checkout (press again to confirm the sale) |
| `F3` | Discount field |
| `F4` | Customer selector |
| `F12` | Lock the terminal |
| `Esc` | Close the current dialog |
| `Enter` in a form | Next field (submits on the last one) |

## Upgrading from 1.x

The first start of 2.0 moves the previous release's data from the Documents folder into `%LOCALAPPDATA%\NoorPharmacyPOS` (if Windows does not allow the move it is copied instead, leaving the original untouched) and upgrades the database in place. The original database file is copied to `Backups\noorpos_pre-migration-v*_*.db` first (every later upgrade makes the same kind of copy).

- PINs are now stored hashed. Users who still had a published default PIN (`1234`, `5678`, `0000`) must choose a new one at their next login.
- Stock is now tracked in units (tablets); packs and loose units are calculated from it.
- Invoice numbers are sequential (`INV-000123`), continuing from your number of past sales.
- The flat Rs 1 per-receipt fee is kept for existing databases and is now a setting (**POS Fee per Receipt**), next to a configurable sales-tax rate.
- Demo customers and products created by 1.x are **not** removed automatically, because they may have been used. Delete or edit them yourself if they are not real.

## Development

Requires Node.js 22 (see `.nvmrc`).

```bash
npm install
npm run dev      # builds the UI, rebuilds it on save, opens the app with devtools
                 # and sample products (data in ./.devdata; Ctrl+R reloads the window)
npm test         # unit/integration tests (services against real database files)
npm run lint
npm run smoke    # builds the UI, boots the real app and drives it end to end, exits 0/1
npm run build    # Windows installers (ia32 + x64) in dist/
```

The interface is a React 18 app styled with Tailwind CSS 3 and bundled by Vite into `build/renderer/`. Electron 22 (needed for Windows 7) ships Chromium 108, which is why Tailwind 3 is used rather than 4.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code is organised and why
- [CONTRIBUTING.md](CONTRIBUTING.md): conventions and how to add a feature
- [CHANGELOG.md](CHANGELOG.md): release history

Pushing a tag `vX.Y.Z` builds the installers and publishes a GitHub release after lint, tests and the smoke test pass.

## License

MIT — see [LICENSE](LICENSE).
