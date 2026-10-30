# Noor Pharmacy POS verification map

The maintained source for verifying what shop staff can do. Read this index, then use the matching feature file as the recipe.

## Baseline preconditions

- An instance started by `drive.mjs launch` in this run (sample products seeded), and `drive.mjs doctor` healthy.
- Logged in with `$v.login()` as the first admin (PIN `1234`, changed to `7391`). An admin can do everything; use another role only when a recipe says so.
- Sample products (sorted by name): Amoxicillin 500mg Capsule (Rx, pack of 10), Atorvastatin 10mg Tablet (Rx, low stock), Multivitamin + Zinc Tablet (expired, out of stock), Omeprazole 20mg Capsule, Paracetamol 500mg Tablet (barcode `2000000000022`). One khata customer: Sample Credit Customer.
- Never drive an instance this run did not start.

## Driving conventions

- Act through the UI only: clicks, typing and keys via `$v`. Never call `window.noorpos.call` to change state, except in `doctor`.
- Prefer ids, `data-*` attributes, field `name`s and `aria-label`s over text or position.
- A dialog is open when `[data-modal-overlay]` exists; `Escape` closes the top one.
- Sales with Rx medicines ask "Prescription medicines ... Continue anyway?" (`#modalConfirm`, confirm with `#confirmYes`).

## Proof

- Screenshot the action's result (`drive.mjs shot <feature>-<step>`) and check a second view of the stored result.
- For layout, `$v.overflowing()` returns `[]`.
- Report an unreachable path with the attempted step and the unmet precondition. Never report a path as verified through a different one.

## Feature entry contract

Each file has an H1, one paragraph of user-visible behavior, then four H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with drive.mjs`, `Gotchas`.

## Features

- [Sell](./sell.md): scan or search, cart, cash/card/khata payment, receipt.
- [Returns and cancelling](./returns.md): return some items from a past sale, or cancel a whole sale.
- [Khata](./khata.md): credit customers, opening balance, receiving payments.
- [Medicines and stock](./stock.md): add a medicine, receive a delivery, correct stock.
- [Lock and PIN](./lock.md): unlock, forced PIN change, F12 lock, auto-lock.
