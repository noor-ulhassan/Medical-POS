# Returns and cancelling

A manager can take back some of the items from a past sale (refund in cash, refund on card or wallet, or credit to the khata) with the items going back on the shelf or recorded as damaged, or cancel a whole sale made by mistake. A sale with returns can no longer be cancelled whole.

## Sub-features

- `return-some` returns part of a line or several lines and shows the money to give back before saving.
- `return-all` the "All" button fills what is left; a fully returned sale shows "Returned".
- `return-no-restock` unticked "Put the medicine back on the shelf" records damaged stock.
- `return-receipt` the receipt reopens with a Returned section and "Paid after returns".
- `cancel-sale` cancels a whole sale with a reason; stock and khata are restored.

## How to get to it (user POV)

- Menu Sales (Past sales tab). Tap the sale: its window shows the receipt and "Customer returns items" or "Cancel the whole sale".

## Driving it with drive.mjs

Preconditions: baseline state with one completed cash sale of 3 units (make it with the Sell recipe).

- **Open the return.** `$v.nav('salesView'); $v.click('#salesTableBody [data-open-sale]')`; wait for `#modalSaleDetail`; `$v.click('#modalSaleDetail [data-return]')`. `#modalReturnItems` lists the sale's lines with `[data-return-qty]` inputs.
- **Choose a quantity.** `$v.type('[data-return-qty]', '1')`. `#returnRefund` says "Give Rs ... cash back".
- **Save.** `$v.type('#returnForm [name="reason"]', 'Changed mind'); $('#returnForm').requestSubmit()`. The receipt opens with `#receiptReturns` containing `-R1`.
- **Second view.** Close the receipt: the row shows "Partly returned"; Today's report (`dashboardView`) shows `#dashTodayReturns`.
- **Cancel a sale.** Open another sale (`[data-open-sale]`), then `$v.click('#modalSaleDetail [data-void]')`, type a reason in `#voidForm [name="reason"]`, submit. The row shows Cancelled.
- **Proof.** `shot return-dialog` with the quantity typed, `shot return-receipt`.

## Gotchas

- Return and Cancel sale need the Manager or Admin role.
- "Cancel the whole sale" is hidden once anything was returned from that sale; the server refuses it too.
- The sale window closes before the return or cancel dialog opens: wait for `#modalSaleDetail` to be gone.
- The refund preview comes from the main process after a short delay; wait for `#returnRefund` before saving.
