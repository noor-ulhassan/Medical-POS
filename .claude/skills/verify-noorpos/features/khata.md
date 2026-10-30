# Khata

Customers who buy on credit have a limit, a running balance and a printable statement. Staff add customers (with what they already owed in the old book), sell to them on khata, and record payments with how they were paid.

## Sub-features

- `khata-add` adds a customer with a credit limit and an optional opening balance ("Already owes").
- `khata-sale` a khata sale raises the balance, refused over the limit.
- `khata-payment` records a payment (cash, card, mobile wallet, bank transfer); only cash counts in the drawer.
- `khata-statement` prints the A4 statement.

## How to get to it (user POV)

- Menu Khata. Add customer at the top right; Take payment on rows that owe. Tapping a customer opens their window: Take a payment, See and print statement, Change details or limit.
- At the till: the Customer box above the sale (`F4`), then Khata in the payment window.

## Driving it with drive.mjs

Preconditions: baseline state.

- **Add.** `$v.nav('khataView'); $v.click('#btnOpenAddCustomer')`; type `#customerForm [name="name"]` and `[name="openingBalance"]` = `250`; submit `#customerForm`. `#customerTableBody` shows the name and `Rs 250.00`.
- **Pay.** `$v.click('#customerTableBody [data-pay]')`; type `#paymentForm [name="amount"]`, choose `[name="paymentMethod"]` (`CASH`, `CARD`, `MOBILE WALLET`, `BANK`), submit. The balance drops.
- **Second view.** Open the customer (`#customerTableBody [data-open-customer]`), then `#modalCustomerDetail [data-ledger]` opens the A4 statement with an Opening balance line and the payment.
- **Proof.** `shot khata-list`, `shot khata-statement`.

## Gotchas

- "Already owes" is offered only for a customer with no khata entries yet.
- Take payment appears only when the customer owes something.
- The walk-in customer is cash only: its row does not open.
