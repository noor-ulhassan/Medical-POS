/*
 * End-to-end UI scenario run inside the real Electron window by
 * `npm run smoke` (see runSmokeTest in src/main/index.js). It drives the UI
 * the way a user would - clicks, typing and keys only - and resolves to
 * { ok, steps, failures }.
 */
(async () => {
  const steps = [];
  const failures = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel) => document.querySelector(sel);
  const exists = (id) => Boolean(document.getElementById(id));
  const text = (sel) => ($(sel) ? $(sel).textContent : '');

  async function waitFor(label, predicate, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (predicate()) return true;
      await sleep(50);
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }

  async function step(name, fn) {
    try {
      await fn();
      steps.push(name);
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
    }
  }

  /** Type into a React-controlled field (uses the native setter so React sees the change). */
  function type(el, value) {
    if (!el) throw new Error('field not found');
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  }
  const field = (form, name) => $(`#${form} [name="${name}"]`);
  const key = (target, k, extra = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  /** Open a screen: its section in the side bar, then its tab when the section has several screens. */
  const nav = (view) => {
    const item = [...document.querySelectorAll('.nav-item[data-views]')].find((el) => el.dataset.views.split(' ').includes(view));
    item.click();
    if (item.dataset.target === view) return Promise.resolve();
    return (async () => {
      await waitFor(`${view} tab`, () => $(`[data-tab="${view}"]`));
      $(`[data-tab="${view}"]`).click();
    })();
  };
  const button = (scope, label) => [...document.querySelectorAll(`${scope} button`)].find((b) => b.textContent.trim().startsWith(label));

  async function typePin(pin) {
    for (const digit of pin) $(`.pin-key[data-key="${digit}"]`).click();
    await sleep(30);
    $('#btnPinSubmit').click();
  }

  await step('lock screen shown with first-run hint', async () => {
    await waitFor('lock screen', () => exists('modalPinAuth'));
    await waitFor('first run hint', () => exists('pinFirstRunHint'));
  });

  await step('wrong PIN is rejected', async () => {
    await typePin('9999');
    await waitFor('pin error', () => text('#pinError').length > 0);
  });

  await step('default admin PIN forces a PIN change', async () => {
    await typePin('1234');
    await waitFor('change pin dialog', () => exists('modalChangePin'));
    if ($('#modalChangePin button[aria-label="Close"]')) throw new Error('forced PIN change can be dismissed');
    type(field('changePinForm', 'currentPin'), '1234');
    type(field('changePinForm', 'newPin'), '7391');
    type(field('changePinForm', 'confirmPin'), '7391');
    $('#changePinForm').requestSubmit();
    await waitFor('sell screen after pin change', () => !exists('modalChangePin') && exists('posView'));
  });

  await step('product list shows sample products', async () => {
    await waitFor('product rows', () => document.querySelectorAll('#productGrid [data-product-id]').length >= 4);
  });

  await step('add items, switch unit type, totals update', async () => {
    const row = [...document.querySelectorAll('#productGrid [data-product-id]')].find((c) => !c.classList.contains('is-out'));
    row.click();
    row.click();
    await waitFor('cart line', () => document.querySelectorAll('#cartItemsList .cart-item').length === 1);
    button('#cartItemsList .cart-item', 'Pack').click();
    await waitFor('pack line', () => text('#cartItemsList').includes('per pack'));
    button(`#productGrid [data-product-id="${row.dataset.productId}"]`, 'Unit').click();
    await waitFor('two lines', () => document.querySelectorAll('#cartItemsList .cart-item').length === 2);
    if (text('#summaryTotal') === 'Rs 0.00') throw new Error('total did not update');
  });

  await step('barcode scan via Enter adds a product', async () => {
    const before = document.querySelectorAll('#cartItemsList .cart-item').length;
    const input = $('#posSearchInput');
    type(input, 'Paracetamol 500mg Tablet');
    key(input, 'Enter');
    await waitFor('scanned line', () => document.querySelectorAll('#cartItemsList .cart-item').length === before + 1);
    await waitFor('search cleared', () => input.value === '');
  });

  await step('arrow keys + Shift+Enter add a pack from the list', async () => {
    const before = text('#cartItemsList');
    const input = $('#posSearchInput');
    type(input, 'Omeprazole');
    key(input, 'ArrowDown'); // immediately, like a fast typist
    await waitFor('row highlighted', () => $('#productGrid [aria-selected="true"]'));
    key(input, 'Enter', { shiftKey: true });
    await waitFor('omeprazole pack', () => text('#cartItemsList') !== before && text('#cartItemsList').includes('Omeprazole'));
    type(input, '');
  });

  await step('a scan right after an arrow-key pick adds the scanned medicine, not the picked one', async () => {
    const input = $('#posSearchInput');
    const qty = (title) => {
      const line = [...document.querySelectorAll('#cartItemsList .cart-item')].find((li) => li.textContent.includes(title) && li.textContent.includes('per unit'));
      return line ? Number(line.querySelector('[data-cart-qty]').value) : 0;
    };
    type(input, 'Atorvastatin');
    await sleep(150);
    key(input, 'ArrowDown');
    await waitFor('row highlighted', () => $('#productGrid [aria-selected="true"]'));
    key(input, 'Enter');
    await waitFor('picked unit', () => qty('Atorvastatin') === 1);
    if (input.selectionStart !== 0 || input.selectionEnd !== input.value.length) throw new Error('search text is not selected for the next scan');
    // A scanner replaces the selected text and presses Enter well within the search debounce.
    const paracetamol = qty('Paracetamol');
    type(input, '2000000000022');
    key(input, 'Enter');
    await waitFor('scanned paracetamol', () => qty('Paracetamol') === paracetamol + 1);
    if (qty('Atorvastatin') !== 1) throw new Error(`the picked medicine was added again (x${qty('Atorvastatin')})`);
  });

  await step('quantity can be typed in the sale', async () => {
    const qty = $('#cartItemsList [data-cart-qty]');
    const before = text('#summaryTotal');
    qty.focus();
    type(qty, '3');
    qty.blur();
    await waitFor('quantity applied', () => $('#cartItemsList [data-cart-qty]').value === '3' && text('#summaryTotal') !== before);
  });

  await step('checkout prints a receipt with a sequential invoice', async () => {
    $('#btnOpenCheckoutModal').click();
    await waitFor('payment dialog', () => exists('modalCheckoutPayment'));
    $('#checkoutPaymentForm').requestSubmit();
    // Prescription-only items in the sample data trigger a confirmation.
    await waitFor('rx confirmation or receipt', () => exists('modalConfirm') || exists('modalReceiptPreview'));
    if (exists('modalConfirm')) $('#confirmYes').click();
    await waitFor('receipt', () => exists('modalReceiptPreview'));
    if (!text('#receiptContainer').includes('INV-000001')) throw new Error('invoice number missing from receipt');
    if (!text('#receiptContainer').includes('Noor ul Hassan')) throw new Error('software credit missing from receipt');
    $('#modalReceiptPreview button[aria-label="Close"]').click();
    await waitFor('cart emptied', () => text('#cartItemCountBadge') === '0');
  });

  await step('khata sale to walk-in is blocked', async () => {
    $('#productGrid [data-product-id]:not(.is-out)').click();
    await waitFor('item in cart', () => text('#cartItemCountBadge') === '1');
    $('#btnOpenCheckoutModal').click();
    await waitFor('payment dialog', () => exists('modalCheckoutPayment'));
    $('input[name="paymentMethod"][value="CREDIT"]').click();
    $('#checkoutPaymentForm').requestSubmit();
    await waitFor('error toast', () => [...document.querySelectorAll('[data-toast="error"]')].some((t) => t.textContent.includes('Walk-in')));
    $('#modalCheckoutPayment button[aria-label="Close"]').click();
    $('#btnClearCart').click();
    await waitFor('confirm', () => exists('modalConfirm'));
    $('#confirmYes').click();
    await waitFor('cart cleared', () => text('#cartItemCountBadge') === '0');
  });

  await step('payment method starts at cash for every sale (never carried over)', async () => {
    $('#productGrid [data-product-id]:not(.is-out)').click();
    await waitFor('item in cart', () => text('#cartItemCountBadge') === '1');
    $('#btnOpenCheckoutModal').click();
    await waitFor('payment dialog', () => exists('modalCheckoutPayment'));
    if (!$('input[name="paymentMethod"][value="CASH"]').checked) throw new Error('payment method carried over from the previous sale');
    $('#modalCheckoutPayment button[aria-label="Close"]').click();
    $('#btnClearCart').click();
    await waitFor('confirm', () => exists('modalConfirm'));
    await waitFor('safe answer focused', () => document.activeElement && document.activeElement.textContent.trim() === 'Cancel');
    $('#confirmYes').click();
    await waitFor('cart cleared', () => text('#cartItemCountBadge') === '0');
  });

  await step('dates are day/month/year', async () => {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    if (!locale.startsWith('en-GB')) throw new Error(`locale is ${locale}`);
  });

  await step('text size button makes everything bigger and back', async () => {
    const before = window.devicePixelRatio;
    $('#btnUserMenu').click();
    await waitFor('me window', () => exists('modalMe'));
    $('#textSizeBtn').click();
    await waitFor('zoomed in', () => window.devicePixelRatio > before);
    $('#textSizeBtn').click();
    $('#textSizeBtn').click();
    await waitFor('back to normal', () => Math.abs(window.devicePixelRatio - before) < 0.01);
    $('#modalMe button[aria-label="Close"]').click();
    await waitFor('me window closed', () => !exists('modalMe'));
  });

  const views = ['dashboardView', 'profitView', 'expensesView', 'inventoryView', 'suppliersView', 'khataView', 'ordersView', 'expiryView', 'quotationView', 'salesView', 'settingsView', 'posView'];
  for (const view of views) {
    await step(`navigate to ${view}`, async () => {
      nav(view);
      await waitFor(view, () => exists(view));
      await sleep(200);
    });
  }

  await step("dashboard shows today's sale", async () => {
    nav('dashboardView');
    await waitFor('kpi', () => text('#dashTodayInvoices').startsWith('1 '));
  });

  await step('void the sale from sales history', async () => {
    nav('salesView');
    await waitFor('sales row', () => $('#salesTableBody [data-void]'));
    $('#salesTableBody [data-void]').click();
    await waitFor('void dialog', () => exists('modalVoidSale'));
    type(field('voidForm', 'reason'), 'Smoke test');
    $('#voidForm').requestSubmit();
    await waitFor('voided badge', () => text('#salesTableBody').includes('Cancelled'));
  });

  await step('return one item from a sale', async () => {
    nav('posView');
    await waitFor('products', () => $('#productGrid [data-product-id]:not(.is-out)'));
    const row = $('#productGrid [data-product-id]:not(.is-out)');
    row.click();
    row.click();
    row.click();
    await waitFor('3 in the sale', () => $('#cartItemsList [data-cart-qty]') && $('#cartItemsList [data-cart-qty]').value === '3');
    $('#btnOpenCheckoutModal').click();
    await waitFor('payment dialog', () => exists('modalCheckoutPayment'));
    $('#checkoutPaymentForm').requestSubmit();
    await waitFor('rx confirmation or receipt', () => exists('modalConfirm') || exists('modalReceiptPreview'));
    if (exists('modalConfirm')) $('#confirmYes').click();
    await waitFor('receipt', () => exists('modalReceiptPreview'));
    $('#modalReceiptPreview button[aria-label="Close"]').click();
    nav('salesView');
    await waitFor('return button', () => $('#salesTableBody [data-return]'));
    $('#salesTableBody [data-return]').click();
    await waitFor('return dialog', () => exists('modalReturnItems') && $('[data-return-qty]'));
    type($('[data-return-qty]'), '1');
    await waitFor('refund shown', () => text('#returnRefund').includes('cash back'));
    type(field('returnForm', 'reason'), 'Smoke return');
    $('#returnForm').requestSubmit();
    await waitFor('receipt with the return', () => exists('modalReceiptPreview') && text('#receiptReturns').includes('-R1'));
    $('#modalReceiptPreview button[aria-label="Close"]').click();
    await waitFor('partly returned', () => text('#salesTableBody').includes('Partly returned'));
  });

  await step('add a product', async () => {
    nav('inventoryView');
    await waitFor('products', () => $('#btnOpenAddProduct'));
    $('#btnOpenAddProduct').click();
    await waitFor('product dialog', () => exists('modalAddProduct'));
    await waitFor('barcode generated', () => field('addProductForm', 'barcode').value.length === 13);
    type(field('addProductForm', 'title'), 'Smoke Test Syrup');
    type(field('addProductForm', 'packSize'), '1');
    type(field('addProductForm', 'stockPacks'), '12');
    type(field('addProductForm', 'salePrice'), '150');
    await waitFor('unit price filled', () => field('addProductForm', 'singlePrice').value === '150.00');
    $('#addProductForm').requestSubmit();
    await waitFor('row added', () => text('#inventoryTableBody').includes('Smoke Test Syrup'));
  });

  await step('add a khata customer', async () => {
    nav('khataView');
    await waitFor('khata', () => $('#btnOpenAddCustomer'));
    $('#btnOpenAddCustomer').click();
    await waitFor('customer dialog', () => exists('modalCustomer'));
    type(field('customerForm', 'name'), 'Smoke Customer');
    type(field('customerForm', 'openingBalance'), '250'); // owed in the old khata book
    $('#customerForm').requestSubmit();
    await waitFor('customer row', () => text('#customerTableBody').includes('Smoke Customer'));
    await waitFor('opening balance owed', () => text('#customerTableBody').includes('Rs 250.00'));
  });

  await step('app opens in light mode', async () => {
    if (document.documentElement.dataset.theme !== 'light') throw new Error(`theme is ${document.documentElement.dataset.theme}`);
  });

  await step('record an expense, then see it in Profit & loss', async () => {
    nav('expensesView');
    await waitFor('expense form', () => exists('expenseForm'));
    type(field('expenseForm', 'category'), 'RENT');
    type(field('expenseForm', 'amount'), '1234.50');
    type(field('expenseForm', 'note'), 'Smoke rent');
    $('#expenseForm').requestSubmit();
    await waitFor('expense listed', () => text('#expensesTableBody').includes('Smoke rent'));
    if (!text('#expensesMonthTotal').includes('1,234.50')) throw new Error(`month total is ${text('#expensesMonthTotal')}`);
    nav('profitView');
    await waitFor('profit statement', () => exists('profitStatement'));
    await waitFor('expense in the statement', () => text('#profitStatement').includes('1,234.50'));
    await waitFor('net profit shown', () => text('#profitNetProfit').includes('Rs'));
  });

  await step('settings tabs: staff, backups and activity log', async () => {
    nav('settingsView');
    await waitFor('store form', () => exists('settingsForm'));
    button('[role="tablist"]', 'Staff').click();
    await waitFor('users', () => text('#usersTableBody').includes('Administrator'));
    button('[role="tablist"]', 'Backup').click();
    await waitFor('backups', () => text('#backupsTableBody').includes('noorpos_auto_'));
    button('[role="tablist"]', 'Activity').click();
    await waitFor('audit', () => text('#auditTableBody').includes('sales.void'));
  });

  await step('user input is escaped, never rendered as HTML', async () => {
    nav('khataView');
    await waitFor('khata', () => $('#btnOpenAddCustomer'));
    $('#btnOpenAddCustomer').click();
    await waitFor('customer dialog', () => exists('modalCustomer'));
    type(field('customerForm', 'name'), '<img src=x id=xss-probe>');
    $('#customerForm').requestSubmit();
    await waitFor('customer row', () => text('#customerTableBody').includes('<img src=x id=xss-probe>'));
    if (document.getElementById('xss-probe')) throw new Error('markup was injected');
  });

  await step('theme switches between light and dark', async () => {
    const before = document.documentElement.dataset.theme;
    $('#btnUserMenu').click();
    await waitFor('me window', () => exists('modalMe'));
    $('#themeToggleBtn').click();
    await waitFor('theme changed', () => document.documentElement.dataset.theme !== before);
    $('#themeToggleBtn').click();
    await waitFor('theme restored', () => document.documentElement.dataset.theme === before);
    $('#modalMe button[aria-label="Close"]').click();
    await waitFor('me window closed', () => !exists('modalMe'));
  });

  await step('F12 locks the terminal', async () => {
    key(document, 'F12');
    await waitFor('locked', () => exists('modalPinAuth'));
    if (exists('posView')) throw new Error('store data still visible behind the lock screen');
  });

  return { ok: failures.length === 0, steps, failures };
})();
