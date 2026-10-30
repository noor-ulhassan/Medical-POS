# Medicines and stock

Managers add medicines with pack size, prices, expiry and stock, receive deliveries (adding packs to what is there), correct stock with a reason, and write off expired stock. Low and expiring stock show as counts in the menu.

## Sub-features

- `stock-add` adds a medicine; a store barcode is generated.
- `stock-receive` adds received packs; a later expiry date asks whether older packs are gone.
- `stock-correct` lowering stock by hand asks why (mistake, damaged, lost).
- `stock-writeoff` Expiring soon writes off expired stock.
- `stock-history` per-medicine stock history.

## How to get to it (user POV)

- Menu Medicines & stock: Add product at the top; per row Receive, history, edit (pencil), remove.
- Menu Expiring soon: Write off per medicine.

## Driving it with drive.mjs

Preconditions: baseline state.

- **Add.** `$v.nav('inventoryView'); $v.click('#btnOpenAddProduct')`; wait for `#addProductForm [name="barcode"]` to hold 13 digits; type `title`, `packSize`, `stockPacks`, `salePrice`; submit. `#inventoryTableBody` lists it.
- **Receive.** `$v.click('[data-receive]')`; type `#receiveStockForm [name="packs"]` = `2`; submit. A toast says what was added and the new stock.
- **Correct down.** `$v.click('[data-edit]')`; lower `stockPacks` by one; `[name="stockChangeReason"]` appears and is required; pick `DAMAGED`; submit.
- **Second view.** The history icon on the row lists Stock received and Damaged or broken.
- **Proof.** `shot stock-list`, `shot stock-history`.

## Gotchas

- New products get no expiry date by default; enter one or the medicine has none.
- Changing pack size in the edit dialog reinterprets the pack count, and the dialog shows the resulting stock change.
