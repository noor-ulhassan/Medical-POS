# Sell

Staff find a medicine by scanning its barcode or typing its name, add units or packs to the current sale, optionally choose a khata customer and a discount, then take payment (cash, card, mobile wallet or khata) and get a receipt. Stock goes down and the sale appears in Past sales.

## Sub-features

- `sell-search` finds medicines by name, generic name or barcode; Enter adds the only or exact match.
- `sell-scan-after-pick` a scan straight after an arrow-key pick adds the scanned medicine.
- `sell-cart` changes unit/pack, quantity (typed or +/-), removes lines, clears the sale.
- `sell-cash` takes cash, shows change, refuses short cash.
- `sell-khata` sells on khata to a registered customer within their limit; walk-in customers cannot.
- `sell-hold` holds a sale and resumes it later.
- `sell-receipt` shows the receipt with the invoice number after every sale.

## How to get to it (user POV)

- The Sell screen opens after unlocking, or the menu item Sell, or `F1`.
- Type in the search box (it takes focus when typing anywhere on the screen); `Enter` adds a unit, `Shift+Enter` a pack.
- The big Charge button at the bottom of the sale, or `F2`; `F2` again completes the sale.

## Driving it with drive.mjs

Preconditions: baseline state, Sell screen open, empty sale.

- **Add by barcode.** `$v.type('#posSearchInput', '2000000000022'); $v.key('#posSearchInput', 'Enter')`. One line, Paracetamol, appears in `#cartItemsList .cart-item` and the search box empties.
- **Add a pack by click.** `$v.button('Pack', '[data-product-id]:not(.is-out)').click()` on the first in-stock row. A line "per pack of 10" appears.
- **Type a quantity.** Focus the box first, then type, then leave it: `const q = $v.$('#cartItemsList [data-cart-qty]'); q.focus(); $v.type(q, '3'); q.blur();`. The line total and `#summaryTotal` change (Paracetamol: Rs 2.25 x 3 = Rs 6.75 with no tax or fee).
- **Charge in cash.** `$v.click('#btnOpenCheckoutModal')`; `#modalCheckoutPayment` opens with Cash selected and the exact amount in `#cartPaidInput`. `$('#checkoutPaymentForm').requestSubmit()`; confirm `#confirmYes` if the Rx question appears. `#modalReceiptPreview` shows `INV-000001`.
- **Second view.** Close the receipt, `$v.nav('salesView')`: `#salesTableBody` lists INV-000001 as Completed; `$v.nav('inventoryView')` shows the stock reduced.
- **Proof.** `shot sell-cart` before charging, `shot sell-receipt` with the receipt open.

## Gotchas

- Multivitamin + Zinc is expired and out of stock: adding it is refused with a toast. Use it to prove the refusal, not as a sale item.
- Amoxicillin and Atorvastatin need a prescription, so checkout asks first.
- A khata sale to the walk-in customer is refused before submitting (toast mentions Walk-in).
- The payment method resets to Cash on every opening of the payment window.
- A typed quantity applies when the box loses focus. Blurring a box that never had focus does nothing, so the old quantity is silently kept and the sale goes through with it.
