# Changelog

## Unreleased (branch ui/simplify-pos)

A simpler interface that anyone at the counter can use. Only the screens changed: every feature, permission and stored record works as before.

- **Five sections instead of twelve menu items.** A narrow side bar with Sell, Sales, Stock, Khata and Reports, each with a large icon and a one-word label. Sections with more than one screen show tabs at the top (Sales: Past sales, Price quote. Stock: Medicines, Expiring, Reorder, Suppliers. Reports: Today, Profit & loss, Expenses). Help, Settings, your name and Lock sit at the bottom; your name opens PIN change, text size and dark screen.
- **Bigger, clearer text.** Body text is 16px and nothing is smaller than 13px; buttons and inputs are taller and easier to hit.
- **Sell.** A big search box, category chips and one row per medicine in plain words ("24 packs in stock", "expires 24 Nov 2026") with Add and Pack buttons. The sale shows the customer at the top, a quantity stepper on each line, and Discount, Prescription and Hold as labelled buttons above Charge.
- **Lists open one window per item.** Tap a past sale, a medicine or a khata customer to see its details next to big labelled actions (for a sale: print, sell again, prescription photo, customer returns items, cancel the whole sale; for a medicine: receive a delivery, change, stock history, remove; for a customer: take a payment, statement, change). Rows no longer carry strips of small icon buttons; the most common action (Receive, Take payment) stays on the row.
- **Plain words.** "Write off" is now "Throw away", "Restock" is "Reorder", "Receive" on khata is "Take payment", and screen titles match their tabs. Profit & loss shows the summary, chart and statement, with the detail panels behind Show more.
- **Help** steps name the new screens and buttons, with new steps for prescription medicines and holding a sale.
- While a dialog is open, messages appear at the top so they no longer cover the dialog's buttons.
- Fixed: after the first PIN change, the lock screen kept saying the administrator PIN is 1234 until the app was restarted.

## Unreleased (branch ux/non-technical-owner)

Fixes that protect money and stock, and a simpler interface for an owner who is not used to computers.

### Returns and opening khata balances
- New: Return items (Past sales, managers). A customer can bring back some of what they bought: choose how many of each line. The screen says how much to give back (their share of what they paid for those items, including the bill discount, tax and fee) or how much comes off their khata. The items go back into stock, or, when they cannot be sold again, are recorded as damaged stock (a loss at cost). Returning a whole sale in several goes adds up exactly to the bill. The receipt can be printed again with the returns on it, and the sale shows as "Partly returned" or "Returned".
- Returns count on the day they happen: Profit & loss takes them off net sales and the cost of medicines sold, and Today's report shows them and takes cash returns off the cash expected in the drawer. A sale with returns can no longer be cancelled whole (return the rest instead).
- New: "Already owes" when adding a khata customer (or for one with no entries yet), for what they owed in the old khata book. It becomes the opening entry of their khata; it is not a sale.
- Database upgraded to version 5 (a backup of the file is made first).

### Review fixes
- Fixed: after about 40,000 sales without closing the app, every sale failed ("memory access out of bounds") until it was restarted. The database engine (sql.js) leaks memory on every `exec()` call, and one was made after every saved row; it now uses a prepared statement instead. 200,000 sales in one session were tested.
- Fixed: a barcode scanned straight after choosing a medicine with the arrow keys added the chosen medicine again instead of the scanned one. Typing or scanning now clears the highlighted row at once, and after an item is added the search text is selected, so the next scan replaces it.
- New: a cashier can discount a bill only up to a limit set by the owner (Settings, Store details; 10% unless changed). A manager or admin can give more. Every discount is in the activity log, and Today's report shows the discounts given today. Previously any cashier could give 100% off without a trace.
- Fixed: a cashier could find out other people's PINs by trying them as their own new PIN ("already used by another user"), with no limit and nothing logged. Changing one's own PIN is now limited to 5 tries a day per user, and "already used" counts as a wrong PIN and is logged. Logging in no longer resets the wrong-PIN count (a cashier could guess a few PINs, log in as themselves and guess again); it fades after an hour without a wrong PIN, and it is kept in the database, so restarting the app does not reset it either (a clock moved backwards never locks for more than 5 minutes). Today's report warns when 10 or more wrong PINs are entered in a day. The lock screen no longer tells every member of staff how to reset the admin PIN.
- New: the till locks itself after 10 minutes without use (Settings, This computer: never, 2, 5, 10 or 30 minutes). The sale in progress is kept. Receipts and other windows are closed when it locks, so no store data stays on screen.
- Fixed: prescription photos attached in version 1.x could not be opened after the upgrade (their saved path pointed to the old Documents folder).
- Prescription photos must really be JPG, PNG, GIF or BMP (the file contents are checked, not just the name). WebP is no longer accepted, because the Chromium version needed for Windows 7 has a known WebP decoder flaw.
- New: backups and prescription photos can be copied to a USB drive or a OneDrive/Google Drive folder (Settings, Backup and restore). The copy is made after every backup and retried every hour; a failure is shown in Settings, on Today's report and once a day as a message. Today's report also warns when backups are only on this computer.
- Fixed: khata payments were always counted as cash in "Cash that should be in the drawer". A payment now records how it was received (cash, card, mobile wallet, bank transfer) and only cash is counted.
- Fixed: lowering the stock of a medicine by hand was never a loss in Profit & loss, so breakage and theft were invisible. When stock goes down the app asks why: a counting or typing mistake (not a loss), or damaged or lost (counted as a loss, at cost). Every hand-made stock change, write-off and cost price change is now in the activity log.
- Fixed: a medicine whose unit or pack price was left at 0 was sold for free; it is now refused with a message saying what to set.
- Receiving stock with a later expiry date while older packs are in stock now asks whether the older packs are gone, because the medicine has one expiry date and the older packs could otherwise be sold after they expire.
- Fixed: holding a sale lost its prescription photo; it now comes back with the sale.
- Fixed: a cart line whose medicine was removed elsewhere was hidden but still sent at checkout, so the sale failed with no way to remove it.
- Fixed: a restore or factory reset that failed half-way (file locked by antivirus) left the app unable to do anything until restarted; the data in use is reopened.
- Searching past sales treats % and _ as ordinary characters. The activity log request is validated.
- Database upgraded to version 4 (a backup of the file is made first).

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

### Easier on any shop computer
- Dates are day/month/year everywhere, including date boxes (Windows in English (US) showed 10/16/2026, so an expiry typed as 05/06/2027 was saved as 6 May). Times are 12-hour.
- Text size: the Aa button at the bottom of the menu, or Ctrl + / Ctrl - / Ctrl 0, makes everything larger (Normal, Large, Larger); remembered on the computer. The menu folds to icons by itself when space is short.
- Settings, This computer: print the receipt automatically after every sale, and print straight to the default printer without the print window. A print that fails now says so instead of failing silently.
- The quantity on a cart line can be typed (30 tablets no longer takes 29 clicks), with the same stock check as the + button.
- Fixed: scrolling the mouse wheel over a focused number box (cash received, prices) changed its value.
- Fixed: a stray Enter (or a barcode scanner's Enter) on a "Clear this sale?" or "Delete?" question confirmed it; the safe answer now has focus.
- Fixed: quotations left out sales tax and the receipt fee, so the quote was lower than the bill; they now use the same calculation as the till.
- Khata receipts show the customer's balance right after the sale.

### Profit, expenses and reports
- New Profit & loss screen: net sales, cost of medicines sold, gross profit and margin, markup, expenses, expired stock written off and net profit, for today, the last 7 days, this or last month, the last 3 months, this year or any dates. Charts (Recharts) for sales and profit over time and expenses by type, gross profit by category, the most profitable medicines, a profit and loss statement whose lines always add up, and a per-day/per-month table.
- Every sale now records the cost of each line at the moment of sale, so later cost changes never rewrite past profit. Sales made before this version, or of medicines with no cost price, are never guessed: they are left out of profit and the screen says how many and how much.
- New Expenses screen: rent, salaries, bills and other running costs by category, with "paid from the cash drawer" (subtracted from the expected cash on Today's report). Deleting keeps the record, marked deleted, in the activity log. Supplier payments for medicines are deliberately not an expense category (their cost is already counted).
- Expired stock write-offs are valued at cost and shown as a loss.
- Today's report no longer cuts off large amounts.
- The app always opens in light mode; dark mode can be switched on for the session.
- Database upgraded to version 3 (a backup of the file is made first).

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
