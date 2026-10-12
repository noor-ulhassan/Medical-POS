/**
 * MediDesk POS - Renderer Application Logic
 * Streamlined Checkout Modal Integration & Product-Centric Architecture
 * Executive Admin Dashboard & Keyboard-Controlled POS Discount
 */

// Global Application State
let currentUser = { id: 1, name: 'Syed Brothers', role: 'Admin' };
let enteredPin = '';
let settings = {};
let productsList = [];
let categoriesList = [];
let suppliersList = [];
let customersList = [];
let cart = [];
let cartPrescriptionPath = '';
let parkedOrders = [];
let quoteItems = [];
let activeRxSaleId = null;
let activePreviewSaleId = null;

// Currency Formatting Helpers (Integer Cents <-> Rs Display)
function formatCurrency(cents) {
  if (isNaN(cents)) cents = 0;
  return `Rs ${(cents / 100).toFixed(2)}`;
}

function parseCurrencyToCents(amount) {
  const val = parseFloat(amount);
  if (isNaN(val)) return 0;
  return Math.round(val * 100);
}

// Auto Barcode Generator (12-Digit EAN Format)
function generateUniqueBarcode() {
  const prefix = '890';
  const randomDigits = Math.floor(100000000 + Math.random() * 900000000).toString();
  return prefix + randomDigits;
}

// Floating Non-Blocking Toast Notification System
function showToast(message, type = 'success') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast-notification ${type === 'error' ? 'error' : ''}`;
  const icon = type === 'error' ? '❌' : '✅';
  toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// Global Unhandled Error & Promise Rejection Boundaries
window.addEventListener('error', (event) => {
  console.error('Unhandled Global Error:', event.error || event.message);
  if (typeof showToast === 'function') {
    showToast(`System Notice: ${event.message || 'An unexpected error occurred.'}`, 'error');
  }
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled Promise Rejection:', event.reason);
  if (typeof showToast === 'function') {
    const reasonMsg = event.reason && event.reason.message ? event.reason.message : String(event.reason);
    showToast(`Promise Rejection: ${reasonMsg}`, 'error');
  }
});

// Override blocking window.alert with non-blocking toast to preserve window focus & textfield editability
window.alert = function(msg) {
  const isErr = String(msg).toLowerCase().includes('error') || String(msg).toLowerCase().includes('failed') || String(msg).toLowerCase().includes('mismatch') || String(msg).toLowerCase().includes('invalid');
  showToast(msg, isErr ? 'error' : 'success');
  restoreActiveFocus();
};

// Client-Side Pagination State
let invCurrentPage = 1;
const INV_PAGE_SIZE = 25;
let salesCurrentPage = 1;
const SALES_PAGE_SIZE = 25;
let khataCurrentPage = 1;
const KHATA_PAGE_SIZE = 25;

// DOM Loaded Initialization
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupPinAuth();
  setupThemeToggle();
  setupUniversalModalHandlers();
  await loadSettings();
  await loadMasterData();
  setupPosEvents();
  setupInventoryEvents();
  setupKhataEvents();
  setupRestockEvents();
  setupQuotationEvents();
  setupSalesEvents();
  setupSettingsEvents();
  setupDashboardEvents();
  setupSupplierCategoryEvents();
  setupPaginationListeners();
  setupKeyboardShortcuts();
});

/* ==========================================================================
   UNIVERSAL MODAL CLOSE DELEGATION & FOCUS RESTORATION HELPER
   ========================================================================== */
function restoreActiveFocus(targetInput) {
  try {
    window.focus();
  } catch(e) {}
  setTimeout(() => {
    try {
      window.focus();
      if (targetInput && typeof targetInput.focus === 'function') {
        targetInput.focus();
      } else {
        const activeModal = document.querySelector('.modal-overlay.active');
        if (activeModal) {
          const firstInput = activeModal.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled])');
          if (firstInput) firstInput.focus();
        } else {
          const activeView = document.querySelector('.view-section.active');
          if (activeView) {
            const firstInput = activeView.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled])');
            if (firstInput) firstInput.focus();
          }
        }
      }
    } catch(err) {}
  }, 100);
}

function setupUniversalModalHandlers() {
  document.addEventListener('click', (e) => {
    // Check if clicked element is a cross button, close button, or modal backdrop
    const closeBtn = e.target.closest('.modal-close, .closeReceiptModal, .closeA4Modal');
    if (closeBtn) {
      const modal = closeBtn.closest('.modal-overlay');
      if (modal) {
        modal.classList.remove('active');
        restoreActiveFocus();
      }
    }
  });
}

/* ==========================================================================
   THEME & NAVIGATION
   ========================================================================== */
function setupThemeToggle() {
  const btn = document.getElementById('themeToggleBtn');
  btn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    document.getElementById('themeIcon').textContent = newTheme === 'dark' ? '🌙' : '☀️';
    document.getElementById('themeLabel').textContent = newTheme === 'dark' ? 'Dark Mode' : 'Light Mode';
  });
}

function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetId = item.getAttribute('data-target');
      switchView(targetId, item);
    });
  });

  // Sidebar Collapse Minimizer
  const sidebar = document.getElementById('appSidebar');
  const btnToggle = document.getElementById('btnToggleSidebar');
  const toggleIcon = document.getElementById('sidebarToggleIcon');

  if (btnToggle && sidebar) {
    const isCollapsed = localStorage.getItem('medidesk_sidebar_collapsed') === 'true';
    if (isCollapsed) {
      sidebar.classList.add('collapsed');
      if (toggleIcon) toggleIcon.textContent = '▶';
    }

    btnToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      const nowCollapsed = sidebar.classList.contains('collapsed');
      localStorage.setItem('medidesk_sidebar_collapsed', nowCollapsed ? 'true' : 'false');
      if (toggleIcon) toggleIcon.textContent = nowCollapsed ? '▶' : '◀';
    });
  }
}

function switchView(viewId, activeNavItem) {
  document.querySelectorAll('.view-section').forEach(view => view.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));

  const targetView = document.getElementById(viewId);
  if (targetView) targetView.classList.add('active');

  if (activeNavItem) {
    activeNavItem.classList.add('active');
  } else {
    const matchedNav = document.querySelector(`.nav-item[data-target="${viewId}"]`);
    if (matchedNav) matchedNav.classList.add('active');
  }

  // Reload data for specific view & auto-activate primary textfield
  if (viewId === 'posView') {
    renderProductGrid();
    restoreActiveFocus(document.getElementById('posSearchInput'));
  } else if (viewId === 'dashboardView') {
    renderDashboard();
    restoreActiveFocus();
  } else if (viewId === 'inventoryView') {
    renderInventoryTable();
    restoreActiveFocus();
  } else if (viewId === 'suppliersView') {
    renderSuppliersPage();
    renderCategoriesPage();
    restoreActiveFocus(document.getElementById('pageSupNameInput'));
  } else if (viewId === 'khataView') {
    renderCustomerTable();
    restoreActiveFocus();
  } else if (viewId === 'ordersView') {
    renderRestockTable();
    restoreActiveFocus();
  } else if (viewId === 'expiryView') {
    renderExpiryCenter();
    restoreActiveFocus();
  } else if (viewId === 'salesView') {
    renderSalesTable();
    restoreActiveFocus();
  } else if (viewId === 'settingsView') {
    restoreActiveFocus(document.getElementById('settingStoreName'));
  } else {
    restoreActiveFocus();
  }
}

/* ==========================================================================
   MODULE A: PIN AUTHENTICATION
   ========================================================================== */
function setupPinAuth() {
  const pinKeys = document.querySelectorAll('.pin-key');
  const modal = document.getElementById('modalPinAuth');
  const lockBtn = document.getElementById('lockPinBtn');

  lockBtn.addEventListener('click', () => {
    enteredPin = '';
    updatePinDots();
    modal.classList.add('active');
  });

  pinKeys.forEach(key => {
    key.addEventListener('click', async () => {
      const val = key.getAttribute('data-key');
      if (val === 'CLEAR') {
        enteredPin = '';
      } else if (val === 'BACK') {
        enteredPin = enteredPin.slice(0, -1);
      } else if (enteredPin.length < 4) {
        enteredPin += val;
      }
      updatePinDots();

      if (enteredPin.length === 4) {
        await verifyPin(enteredPin);
      }
    });
  });

  // Physical External Keyboard & Numpad PIN Entry
  document.addEventListener('keydown', async (e) => {
    if (!modal.classList.contains('active')) return;

    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      if (enteredPin.length < 4) {
        enteredPin += e.key;
        updatePinDots();
        if (enteredPin.length === 4) {
          await verifyPin(enteredPin);
        }
      }
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      enteredPin = enteredPin.slice(0, -1);
      updatePinDots();
    } else if (e.key === 'Delete' || e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      enteredPin = '';
      updatePinDots();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (enteredPin.length === 4) {
        await verifyPin(enteredPin);
      }
    }
  });
}

function updatePinDots() {
  const dots = document.querySelectorAll('.pin-dot');
  dots.forEach((dot, index) => {
    if (index < enteredPin.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  });
}

async function verifyPin(pin) {
  const res = await window.api.get("SELECT * FROM users WHERE pin = ? AND is_active = 1;", [String(pin)]);
  if (res.success && res.data) {
    currentUser = res.data;
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userRole').textContent = currentUser.role;
    document.getElementById('userAvatar').textContent = currentUser.name.charAt(0).toUpperCase();
    document.getElementById('modalPinAuth').classList.remove('active');
    enteredPin = '';
    updatePinDots();
    restoreActiveFocus();
  } else {
    alert('Invalid Security PIN! Please try again.');
    enteredPin = '';
    updatePinDots();
  }
}

/* ==========================================================================
   DATA LOADING & MASTER SETUP
   ========================================================================== */
async function loadSettings() {
  try {
    await window.api.run("UPDATE settings SET store_name = 'Hashmi Medical Store', store_address = 'Muhammdia Colony St 9 Sargodha' WHERE id = 1 AND (store_name = 'MediDesk Pharmacy' OR store_name = 'MediDesk Pharmacy & Wellness' OR store_address LIKE '%Healthcare Boulevard%' OR store_address LIKE '%Medical Center Plaza%');");
  } catch(e) {}

  const res = await window.api.get("SELECT * FROM settings WHERE id = 1;");
  if (res.success && res.data) {
    settings = res.data;
    document.getElementById('displayStoreName').textContent = settings.store_name || 'Hashmi Medical Store';
    document.getElementById('displayStoreSub').textContent = settings.store_address || 'Muhammdia Colony St 9 Sargodha';

    // Form settings inputs
    document.getElementById('settingStoreName').value = settings.store_name;
    document.getElementById('settingStorePhone').value = settings.store_phone;
    document.getElementById('settingStoreAddress').value = settings.store_address;
    document.getElementById('settingNtnFbr').value = settings.ntn_fbr_id;
    document.getElementById('settingDisclaimer').value = settings.receipt_disclaimer;
  }
}

async function loadMasterData() {
  // Sync admin user name in SQLite DB to 'Syed Brothers'
  await window.api.run("UPDATE users SET name = 'Syed Brothers' WHERE id = 1 AND name != 'Syed Brothers';");

  // Categories
  const catRes = await window.api.query("SELECT * FROM categories ORDER BY name ASC;");
  if (catRes.success) {
    categoriesList = catRes.data;
    populateCategoryDropdowns();
  }

  // Suppliers
  const supRes = await window.api.query("SELECT * FROM suppliers ORDER BY name ASC;");
  if (supRes.success) {
    suppliersList = supRes.data;
    populateSupplierDropdowns();
  }

  // Customers
  const custRes = await window.api.query("SELECT * FROM customers ORDER BY name ASC;");
  if (custRes.success) {
    customersList = custRes.data;
    populateCustomerDropdowns();
  }

  // Reload product master dataset
  await reloadProducts();
  renderProductGrid();
  updateExpiryBadge();
  updateLowStockBadge();
  renderSuppliersPage();
  renderCategoriesPage();
}

async function reloadProducts() {
  const sql = `
    SELECT p.*, c.name as category_name, s.name as supplier_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    ORDER BY p.title ASC;
  `;
  const res = await window.api.query(sql);
  if (res.success) {
    productsList = res.data;
  }
}

function populateCategoryDropdowns() {
  const posFilter = document.getElementById('posCategoryFilter');
  const modalProdCat = document.getElementById('prodCategory');

  posFilter.innerHTML = '<option value="ALL">All Categories</option>';
  modalProdCat.innerHTML = '<option value="">-- Select Category --</option>';

  categoriesList.forEach(c => {
    posFilter.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    modalProdCat.innerHTML += `<option value="${c.id}">${c.name}</option>`;
  });
}

function populateSupplierDropdowns() {
  const modalSup = document.getElementById('prodSupplier');
  const orderSup = document.getElementById('supplierOrderSelect');
  const posSupFilter = document.getElementById('posSupplierFilter');

  modalSup.innerHTML = '<option value="">-- Select Supplier --</option>';
  orderSup.innerHTML = '<option value="">-- Select Supplier --</option>';
  if (posSupFilter) posSupFilter.innerHTML = '<option value="ALL">All Suppliers</option>';

  suppliersList.forEach(s => {
    modalSup.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    orderSup.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    if (posSupFilter) posSupFilter.innerHTML += `<option value="${s.id}">${s.name}</option>`;
  });
}

function populateCustomerDropdowns() {
  const cartCust = document.getElementById('cartCustomerSelect');
  cartCust.innerHTML = '';

  customersList.forEach(cust => {
    const isWalkIn = cust.id === 1;
    const debtStr = isWalkIn ? '' : ` (Debt: ${formatCurrency(cust.current_debt_cents)})`;
    cartCust.innerHTML += `<option value="${cust.id}">${cust.name}${debtStr}</option>`;
  });

  // Always default to Walk-in Customer (ID 1)
  cartCust.value = '1';
  updateCartCustomerStatus();
}

/* ==========================================================================
   MODULE A2: EXECUTIVE ADMIN DASHBOARD VIEW
   ========================================================================== */
function setupDashboardEvents() {
  document.getElementById('btnRefreshDashboard').addEventListener('click', renderDashboard);
}

async function renderDashboard() {
  // Refresh master data from SQLite DB first
  await loadMasterData();
  // 1. Total Sales & Revenue KPIs
  const totalSalesRes = await window.api.get("SELECT COUNT(*) as count, SUM(total_cents) as total FROM sales WHERE status = 'COMPLETED';");
  const totalInvoices = totalSalesRes.data ? totalSalesRes.data.count : 0;
  const totalRevenue = totalSalesRes.data && totalSalesRes.data.total ? totalSalesRes.data.total : 0;

  document.getElementById('dashTotalSales').textContent = formatCurrency(totalRevenue);
  document.getElementById('dashTotalInvoices').textContent = `${totalInvoices} Completed Invoices`;

  // 2. Today's Sales KPI
  const todayStr = new Date().toISOString().split('T')[0];
  const todaySalesRes = await window.api.get("SELECT COUNT(*) as count, SUM(total_cents) as total FROM sales WHERE status = 'COMPLETED' AND date(created_at) = date('now');");
  const todayInvoices = todaySalesRes.data ? todaySalesRes.data.count : 0;
  const todayRevenue = todaySalesRes.data && todaySalesRes.data.total ? todaySalesRes.data.total : 0;

  document.getElementById('dashTodaySales').textContent = formatCurrency(todayRevenue);
  document.getElementById('dashTodayInvoices').textContent = `${todayInvoices} Sales Today`;

  // 3. Customer Outstanding Debt
  const debtRes = await window.api.get("SELECT SUM(current_debt_cents) as total_debt FROM customers;");
  const totalDebt = debtRes.data && debtRes.data.total_debt ? debtRes.data.total_debt : 0;
  document.getElementById('dashCustomerDebt').textContent = formatCurrency(totalDebt);

  // 4. Stock & Expiry Risks
  const riskRes = await window.api.get("SELECT COUNT(*) as count FROM products WHERE quantity_packs <= min_stock_level OR expiry_date <= date('now', '+180 days');");
  const riskCount = riskRes.data ? riskRes.data.count : 0;
  document.getElementById('dashRiskAlerts').textContent = riskCount;

  // 5. Render Chart 1: Daily Revenue Trend Chart (Past 7 Days Bar Chart)
  const trendRes = await window.api.query(`
    SELECT date(created_at) as day_date, SUM(total_cents) as daily_total
    FROM sales
    WHERE status = 'COMPLETED'
    GROUP BY date(created_at)
    ORDER BY day_date DESC
    LIMIT 7;
  `);

  const chartTrendContainer = document.getElementById('chartSalesTrendContainer');
  chartTrendContainer.innerHTML = '';

  const trendData = (trendRes.success ? trendRes.data : []).reverse();
  if (trendData.length === 0) {
    chartTrendContainer.innerHTML = `<div style="text-align:center; width:100%; color:var(--text-muted);">No sales data recorded yet.</div>`;
  } else {
    const maxVal = Math.max(...trendData.map(d => d.daily_total), 1);
    trendData.forEach(d => {
      const heightPercent = Math.max(10, Math.round((d.daily_total / maxVal) * 100));
      const col = document.createElement('div');
      col.style.cssText = 'flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; height:100%; justify-content:flex-end;';
      col.innerHTML = `
        <div style="font-size:0.7rem; font-weight:bold; color:var(--accent);">${formatCurrency(d.daily_total)}</div>
        <div style="width:70%; height:${heightPercent}%; background:linear-gradient(to top, var(--primary), var(--accent)); border-radius:4px 4px 0 0; transition:height 0.3s ease;"></div>
        <div style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase;">${d.day_date ? d.day_date.slice(5) : ''}</div>
      `;
      chartTrendContainer.appendChild(col);
    });
  }

  // 6. Render Chart 2: Payment Method Revenue Distribution
  const pmRes = await window.api.query(`
    SELECT payment_method, SUM(total_cents) as pm_total
    FROM sales
    WHERE status = 'COMPLETED'
    GROUP BY payment_method;
  `);

  const pmContainer = document.getElementById('chartPaymentDistribution');
  pmContainer.innerHTML = '';

  const pmData = pmRes.success ? pmRes.data : [];
  const grandTotalPM = pmData.reduce((acc, curr) => acc + curr.pm_total, 0) || 1;

  if (pmData.length === 0) {
    pmContainer.innerHTML = `<div style="text-align:center; color:var(--text-muted);">No payment distribution available.</div>`;
  } else {
    pmData.forEach(pm => {
      const pct = Math.round((pm.pm_total / grandTotalPM) * 100);
      pmContainer.innerHTML += `
        <div>
          <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:600; margin-bottom:2px;">
            <span>${pm.payment_method}</span>
            <span>${formatCurrency(pm.pm_total)} (${pct}%)</span>
          </div>
          <div style="width:100%; height:8px; background:var(--input-bg); border-radius:4px; overflow:hidden;">
            <div style="width:${pct}%; height:100%; background:var(--accent); border-radius:4px;"></div>
          </div>
        </div>
      `;
    });
  }

  // 7. Bestselling / Most Demanding Products Leaderboard
  const topProdRes = await window.api.query(`
    SELECT product_title, unit_type, SUM(quantity) as total_qty, SUM(total_cents) as total_rev
    FROM sale_items
    GROUP BY product_title, unit_type
    ORDER BY total_qty DESC
    LIMIT 5;
  `);

  const topBody = document.getElementById('dashTopDemandingBody');
  topBody.innerHTML = '';

  if (topProdRes.success && topProdRes.data.length > 0) {
    topProdRes.data.forEach((p, idx) => {
      topBody.innerHTML += `
        <tr>
          <td><span class="badge badge-warning">#${idx + 1}</span></td>
          <td><strong>${escapeHtml(p.product_title)}</strong> (${p.unit_type})</td>
          <td style="font-weight:bold; color:var(--accent);">${p.total_qty} units</td>
          <td>${formatCurrency(p.total_rev)}</td>
        </tr>
      `;
    });
  } else {
    topBody.innerHTML = `<tr><td colspan="4" style="text-align:center;">No product sales recorded yet.</td></tr>`;
  }

  // 8. Supply Restock Schedule Table
  const supplyRes = await window.api.query(`
    SELECT s.name as supplier_name, COUNT(p.id) as low_count
    FROM products p
    JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.quantity_packs <= p.min_stock_level
    GROUP BY s.id;
  `);

  const supBody = document.getElementById('dashSupplyScheduleBody');
  supBody.innerHTML = '';

  if (supplyRes.success && supplyRes.data.length > 0) {
    supplyRes.data.forEach(s => {
      supBody.innerHTML += `
        <tr>
          <td><strong>${escapeHtml(s.supplier_name)}</strong></td>
          <td><span class="badge badge-danger">${s.low_count} Low Stock Medicines</span></td>
          <td>
            <button class="btn btn-primary" style="padding:2px 6px; font-size:0.75rem;" onclick="switchView('ordersView')">📋 Build PO</button>
          </td>
        </tr>
      `;
    });
  } else {
    supBody.innerHTML = `<tr><td colspan="3" style="text-align:center;">All supplier stocks are healthy!</td></tr>`;
  }
}

/* ==========================================================================
   MODULE B: POS TERMINAL VIEW
   ========================================================================== */
function setupPosEvents() {
  const searchInput = document.getElementById('posSearchInput');
  const categoryFilter = document.getElementById('posCategoryFilter');
  const supplierFilter = document.getElementById('posSupplierFilter');

  let searchDebounceTimer = null;
  searchInput.addEventListener('input', () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      renderProductGrid();
    }, 80);
  });
  categoryFilter.addEventListener('change', renderProductGrid);
  if (supplierFilter) supplierFilter.addEventListener('change', renderProductGrid);

  // External Keyboard & Barcode Scanner Enter Key on Search Input
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = searchInput.value.trim().toLowerCase();
      if (!val) return;

      const exactMatch = productsList.find(p => p.barcode.toLowerCase() === val || p.title.toLowerCase() === val);
      if (exactMatch) {
        addProductToCart(exactMatch);
        searchInput.value = '';
        renderProductGrid();
      } else {
        const filtered = productsList.filter(p => p.title.toLowerCase().includes(val) || (p.generic_name && p.generic_name.toLowerCase().includes(val)) || p.barcode.toLowerCase().includes(val));
        if (filtered.length === 1) {
          addProductToCart(filtered[0]);
          searchInput.value = '';
          renderProductGrid();
        }
      }
    }
  });

  // Cart actions
  document.getElementById('cartCustomerSelect').addEventListener('change', updateCartCustomerStatus);
  document.getElementById('cartDiscountInput').addEventListener('input', updateCartTotals);
  document.getElementById('cartDiscountType').addEventListener('change', updateCartTotals);

  // Keyboard Navigation for Discount Input
  document.getElementById('cartDiscountInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      updateCartTotals();
      document.getElementById('cartDiscountType').focus();
    }
  });

  document.getElementById('cartDiscountType').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      updateCartTotals();
      document.getElementById('btnOpenCheckoutModal').focus();
    }
  });

  // Checkout Modal triggers
  document.getElementById('btnOpenCheckoutModal').addEventListener('click', openCheckoutModal);
  document.getElementById('cancelCheckoutModal').addEventListener('click', () => {
    document.getElementById('modalCheckoutPayment').classList.remove('active');
  });

  document.getElementById('cartPaidInput').addEventListener('input', updateCheckoutModalCalculations);
  document.getElementById('cartPaymentMethod').addEventListener('change', () => {
    const pm = document.getElementById('cartPaymentMethod').value;
    const tenderGroup = document.getElementById('tenderCashGroup');
    const changeRow = document.getElementById('changeReturnRow');

    if (pm === 'CREDIT') {
      tenderGroup.style.opacity = '0.3';
      tenderGroup.style.pointerEvents = 'none';
      changeRow.style.opacity = '0.3';
    } else {
      tenderGroup.style.opacity = '1';
      tenderGroup.style.pointerEvents = 'auto';
      changeRow.style.opacity = '1';
    }
    updateCheckoutModalCalculations();
  });

  // Exact Cash Button
  document.getElementById('btnCashExact').addEventListener('click', () => {
    const totals = calculateCurrentTotals();
    const totalRs = (totals.totalCents / 100).toFixed(2);
    document.getElementById('cartPaidInput').value = totalRs;
    updateCheckoutModalCalculations();
  });

  document.getElementById('btnClearCart').addEventListener('click', () => {
    cart = [];
    cartPrescriptionPath = '';
    document.getElementById('prescriptionStatusTag').textContent = '';
    document.getElementById('cartPaidInput').value = '';
    document.getElementById('cartDiscountInput').value = '0';
    document.getElementById('cartDiscountType').value = 'FLAT';
    document.getElementById('cartCustomerSelect').value = '1';
    updateCartCustomerStatus();
    renderCart();
  });

  // Prescription image upload picker
  document.getElementById('btnAttachPrescription').addEventListener('click', () => {
    document.getElementById('prescriptionFileInput').click();
  });

  document.getElementById('prescriptionFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result.split(',')[1];
        const res = await window.api.savePrescription({ fileName: file.name, base64Data });
        if (res.success) {
          cartPrescriptionPath = res.filePath;
          document.getElementById('prescriptionStatusTag').textContent = `✓ Attached (${res.relativePath})`;
        } else {
          alert('Failed to attach prescription: ' + res.error);
        }
      };
      reader.readAsDataURL(file);
    }
  });

  // Hold / Park Cart
  document.getElementById('btnParkOrder').addEventListener('click', parkActiveCart);
  document.getElementById('btnViewParked').addEventListener('click', showParkedTabsModal);

  // Submit Checkout Form
  document.getElementById('checkoutPaymentForm').addEventListener('submit', (e) => {
    e.preventDefault();
    processCheckout();
  });

  // Receipt Modal Print Trigger
  document.getElementById('btnPrintReceiptNow').addEventListener('click', async () => {
    await window.api.print();
  });
}

window.setQuickCash = function(amount) {
  document.getElementById('cartPaidInput').value = amount.toFixed(2);
  updateCheckoutModalCalculations();
};

function openCheckoutModal() {
  if (cart.length === 0) {
    alert('Cart is empty! Add products before proceeding to checkout.');
    return;
  }

  const totals = calculateCurrentTotals();
  document.getElementById('modalPayableTotalDisplay').textContent = formatCurrency(totals.totalCents);
  
  // Default paid input to exact total
  document.getElementById('cartPaidInput').value = (totals.totalCents / 100).toFixed(2);
  updateCheckoutModalCalculations();

  document.getElementById('modalCheckoutPayment').classList.add('active');
  setTimeout(() => {
    document.getElementById('cartPaidInput').focus();
    document.getElementById('cartPaidInput').select();
  }, 150);
}

function updateCheckoutModalCalculations() {
  const totals = calculateCurrentTotals();
  const paidVal = parseFloat(document.getElementById('cartPaidInput').value) || 0;
  const paidCents = Math.round(paidVal * 100);
  const changeCents = paidCents > totals.totalCents ? paidCents - totals.totalCents : 0;

  document.getElementById('summaryChange').textContent = formatCurrency(changeCents);
}

function calculateCurrentTotals() {
  let subtotalCents = 0;
  cart.forEach(item => {
    subtotalCents += item.quantity * item.priceCents;
  });

  const discountVal = parseFloat(document.getElementById('cartDiscountInput').value) || 0;
  const discountType = document.getElementById('cartDiscountType').value;
  let discountCents = discountType === 'FLAT' ? Math.round(discountVal * 100) : Math.round((subtotalCents * discountVal) / 100);
  if (discountCents > subtotalCents) discountCents = subtotalCents;

  const afterDiscountCents = subtotalCents - discountCents;

  // Fixed flat Rs 1.00 (100 cents) FBR tax per receipt when cart has items
  const taxCents = cart.length > 0 ? 100 : 0;
  const totalCents = afterDiscountCents + taxCents;

  return { subtotalCents, discountCents, taxCents, totalCents };
}

function renderProductGrid() {
  const grid = document.getElementById('productGrid');
  const searchText = document.getElementById('posSearchInput').value.toLowerCase().trim();
  const selectedCat = document.getElementById('posCategoryFilter').value;
  const selectedSup = document.getElementById('posSupplierFilter') ? document.getElementById('posSupplierFilter').value : 'ALL';

  grid.innerHTML = '';

  const filtered = productsList.filter(p => {
    const matchesSearch = p.title.toLowerCase().includes(searchText) ||
                          (p.generic_name && p.generic_name.toLowerCase().includes(searchText)) ||
                          (p.supplier_name && p.supplier_name.toLowerCase().includes(searchText)) ||
                          p.barcode.toLowerCase().includes(searchText);
    const matchesCat = selectedCat === 'ALL' || (p.category_id && p.category_id.toString() === selectedCat);
    const matchesSup = selectedSup === 'ALL' || (p.supplier_id && p.supplier_id.toString() === selectedSup);
    return matchesSearch && matchesCat && matchesSup;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; color:var(--text-muted); padding:40px;">No matching pharmacy products found.</div>`;
    return;
  }

  const today = new Date();

  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'product-card';

    const packPrice = p.sale_price_cents ? formatCurrency(p.sale_price_cents) : 'N/A';
    const singlePrice = p.single_price_cents ? formatCurrency(p.single_price_cents) : 'N/A';
    
    let expiryStr = 'No Expiry Set';
    let is6MonthWarning = false;
    let isExpired = false;

    if (p.expiry_date) {
      const expDate = new Date(p.expiry_date);
      const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        isExpired = true;
        expiryStr = `Expired (${p.expiry_date})`;
      } else if (diffDays <= 180) {
        is6MonthWarning = true;
        expiryStr = `⚠️ 6-Mo Warning (${p.expiry_date})`;
      } else {
        expiryStr = `Exp: ${p.expiry_date}`;
      }
    }

    const totalPacks = p.quantity_packs || 0;
    const totalSingles = p.quantity_singles || 0;
    const isLowStock = totalPacks <= (p.min_stock_level || 5);
    const isOutOfStock = totalPacks <= 0;

    let badgeClass = 'product-batch-tag';
    if (isExpired) badgeClass = 'badge badge-danger';
    else if (is6MonthWarning) badgeClass = 'badge badge-warning';

    if (isOutOfStock) {
      card.style.border = '2px solid var(--danger)';
      card.style.background = 'hsla(354, 85%, 54%, 0.12)';
    } else if (isLowStock) {
      card.style.border = '2px solid var(--warning)';
      card.style.background = 'hsla(38, 92%, 50%, 0.12)';
    }

    card.innerHTML = `
      <div>
        <div class="product-title" style="display:flex; justify-content:space-between; align-items:flex-start;">
          <span>${escapeHtml(p.title)}</span>
          ${isOutOfStock ? '<span class="badge badge-danger" style="font-size:0.65rem;">OUT OF STOCK</span>' : 
            (isLowStock ? `<span class="badge badge-warning" style="font-size:0.65rem; color:black; font-weight:800;">⚠️ LOW STOCK</span>` : '')}
        </div>
        <div class="product-generic">${escapeHtml(p.generic_name || '')}</div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="${badgeClass}">${expiryStr}</span>
        ${p.is_prescription_required ? '<span style="font-size:0.65rem; background:var(--warning); color:black; padding:1px 4px; border-radius:3px; font-weight:700;">Rx Req</span>' : ''}
      </div>
      <div class="product-card-bottom">
        <div>
          <div class="product-price">${singlePrice} <span style="font-size:0.7rem; font-weight:normal;">/unit</span></div>
          <div style="font-size:0.75rem; color:var(--text-muted);">Pack: ${packPrice}</div>
        </div>
        <div class="product-stock" style="${isLowStock ? 'color:var(--warning); font-weight:bold;' : ''}">${totalPacks} pks (${totalSingles} loose)</div>
      </div>
    `;

    card.addEventListener('click', () => addProductToCart(p));
    grid.appendChild(card);
  });
}

/**
 * Add Product to Cart - DEFAULTS TO SINGLE TABLET / UNIT
 */
function addProductToCart(product) {
  const packSize = Math.max(1, product.pack_size || 1);
  const totalAvailableUnits = ((product.quantity_packs || 0) * packSize) + (product.quantity_singles || 0);

  // Calculate total units of this product already in cart
  let currentCartUnits = 0;
  cart.forEach(item => {
    if (item.product.id === product.id) {
      currentCartUnits += item.unitType === 'PACK' ? (item.quantity * packSize) : item.quantity;
    }
  });

  // Default to SINGLE tablet unit (1 unit)
  const requestedUnits = 1;

  if (currentCartUnits + requestedUnits > totalAvailableUnits && !product.allow_negative_stock) {
    alert(`Out of Stock! Product "${product.title}" has ${totalAvailableUnits} total units in stock (${product.quantity_packs} packs, ${product.quantity_singles} loose).`);
    return;
  }

  // Find existing SINGLE unit item in cart
  const cartIndex = cart.findIndex(ci => ci.product.id === product.id && ci.unitType === 'SINGLE');

  if (cartIndex > -1) {
    cart[cartIndex].quantity += 1;
  } else {
    cart.push({
      product: product,
      unitType: 'SINGLE',
      quantity: 1,
      priceCents: product.single_price_cents
    });
  }

  renderCart();
}

function renderCart() {
  const container = document.getElementById('cartItemsList');
  const countBadge = document.getElementById('cartItemCountBadge');
  container.innerHTML = '';

  countBadge.textContent = `${cart.length} Items`;

  if (cart.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-muted); margin-top:40px;">Cart is empty.<br>Scan barcode or click a product to add single unit by default.</div>`;
    updateCartTotals();
    return;
  }

  cart.forEach((item, index) => {
    const isPack = item.unitType === 'PACK';
    const unitPriceCents = isPack ? item.product.sale_price_cents : item.product.single_price_cents;
    item.priceCents = unitPriceCents;
    const lineTotalCents = item.quantity * unitPriceCents;

    const cartItemEl = document.createElement('div');
    cartItemEl.className = 'cart-item';
    cartItemEl.innerHTML = `
      <div class="cart-item-header">
        <span>${escapeHtml(item.product.title)}</span>
        <button style="background:none; border:none; color:var(--danger); cursor:pointer; font-weight:bold;" onclick="removeCartItem(${index})">✕</button>
      </div>
      <div class="cart-item-meta">
        <span>Code: ${escapeHtml(item.product.barcode)}</span>
        <span>Exp: ${item.product.expiry_date}</span>
        <button class="unit-toggle-btn" onclick="toggleCartUnitType(${index})">
          ${isPack ? '📦 FULL PACK' : '💊 SINGLE UNIT'} (Switch)
        </button>
      </div>
      <div class="cart-item-controls">
        <div class="qty-controls">
          <button class="qty-btn" onclick="updateCartQty(${index}, -1)">-</button>
          <span class="qty-val">${item.quantity}</span>
          <button class="qty-btn" onclick="updateCartQty(${index}, 1)">+</button>
        </div>
        <div class="item-total-price">${formatCurrency(lineTotalCents)}</div>
      </div>
    `;
    container.appendChild(cartItemEl);
  });

  updateCartTotals();
}

window.toggleCartUnitType = function(index) {
  if (cart[index]) {
    const item = cart[index];
    const newUnitType = item.unitType === 'PACK' ? 'SINGLE' : 'PACK';
    const product = item.product;
    const packSize = Math.max(1, product.pack_size || 1);
    const totalAvailableUnits = ((product.quantity_packs || 0) * packSize) + (product.quantity_singles || 0);

    let currentCartUnits = 0;
    cart.forEach((ci, i) => {
      if (ci.product.id === product.id) {
        const uType = i === index ? newUnitType : ci.unitType;
        const itemUnits = uType === 'PACK' ? (ci.quantity * packSize) : ci.quantity;
        currentCartUnits += itemUnits;
      }
    });

    if (currentCartUnits > totalAvailableUnits && !product.allow_negative_stock) {
      alert(`Cannot switch unit type! Product "${product.title}" has ${totalAvailableUnits} total units in stock.`);
      return;
    }

    item.unitType = newUnitType;
    renderCart();
  }
};

window.updateCartQty = function(index, delta) {
  if (cart[index]) {
    if (delta > 0) {
      const item = cart[index];
      const product = item.product;
      const packSize = Math.max(1, product.pack_size || 1);
      const totalAvailableUnits = ((product.quantity_packs || 0) * packSize) + (product.quantity_singles || 0);

      let currentCartUnits = 0;
      cart.forEach(ci => {
        if (ci.product.id === product.id) {
          const itemUnits = ci.unitType === 'PACK' ? (ci.quantity * packSize) : ci.quantity;
          currentCartUnits += itemUnits;
        }
      });

      const additionalUnits = item.unitType === 'PACK' ? packSize : 1;

      if (currentCartUnits + additionalUnits > totalAvailableUnits && !product.allow_negative_stock) {
        alert(`Insufficient Stock! Product "${product.title}" has ${totalAvailableUnits} total units available in stock.`);
        return;
      }
    }

    cart[index].quantity += delta;
    if (cart[index].quantity <= 0) {
      cart.splice(index, 1);
    }
    renderCart();
  }
};

window.removeCartItem = function(index) {
  if (cart[index]) {
    cart.splice(index, 1);
    renderCart();
  }
};

function updateCartCustomerStatus() {
  const custId = parseInt(document.getElementById('cartCustomerSelect').value);
  const alertBox = document.getElementById('customerCreditAlert');
  const cust = customersList.find(c => c.id === custId);

  if (cust) {
    if (cust.id === 1) {
      alertBox.style.display = 'block';
      alertBox.style.color = 'var(--warning)';
      alertBox.textContent = 'ℹ️ Walk-in Customer: Cash / Card / Mobile Wallet payments only. Store Credit (Khata) strictly prohibited.';
    } else {
      const availCredit = cust.credit_limit_cents - cust.current_debt_cents;
      alertBox.style.display = 'block';
      alertBox.style.color = availCredit < 0 ? 'var(--danger)' : 'var(--accent)';
      alertBox.textContent = `Credit Limit: ${formatCurrency(cust.credit_limit_cents)} | Current Debt: ${formatCurrency(cust.current_debt_cents)} | Available: ${formatCurrency(availCredit)}`;
    }
  }
}

function updateCartTotals() {
  const { subtotalCents, discountCents, taxCents, totalCents } = calculateCurrentTotals();

  document.getElementById('summarySubtotal').textContent = formatCurrency(subtotalCents);
  document.getElementById('summaryTax').textContent = cart.length > 0 ? 'Rs 1.00' : 'Rs 0.00';
  document.getElementById('summaryTotal').textContent = formatCurrency(totalCents);
}

// Order Hold / Park System
async function parkActiveCart() {
  if (cart.length === 0) {
    alert('Cart is empty. Nothing to hold/park.');
    return;
  }

  const tabKey = `TAB-${Date.now().toString().slice(-6)}`;
  const custId = parseInt(document.getElementById('cartCustomerSelect').value);
  let totalCents = 0;
  cart.forEach(i => totalCents += i.quantity * i.priceCents);

  const sql = `
    INSERT INTO parked_orders (tab_key, cashier_id, customer_id, cart_json, total_cents, created_at)
    VALUES (?, ?, ?, ?, ?, ?);
  `;
  const params = [tabKey, currentUser.id, custId, JSON.stringify(cart), totalCents, new Date().toISOString()];
  const res = await window.api.run(sql, params);

  if (res.success) {
    alert(`Order Parked Successfully under reference: ${tabKey}`);
    cart = [];
    renderCart();
  } else {
    alert('Error parking order: ' + res.error);
  }
}

async function showParkedTabsModal() {
  const res = await window.api.query("SELECT * FROM parked_orders ORDER BY id DESC;");
  if (!res.success) return;

  parkedOrders = res.data;
  if (parkedOrders.length === 0) {
    alert('No parked orders currently on hold.');
    return;
  }

  let listHtml = parkedOrders.map(p => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--input-bg); padding:10px; border-radius:6px; margin-bottom:8px;">
      <div>
        <strong style="color:var(--primary);">${p.tab_key}</strong> - Total: ${formatCurrency(p.total_cents)}
        <div style="font-size:0.75rem; color:var(--text-muted);">Parked at: ${new Date(p.created_at).toLocaleTimeString()}</div>
      </div>
      <button class="btn btn-accent" style="padding:4px 8px; font-size:0.8rem;" onclick="resumeParkedOrder(${p.id})">Resume</button>
    </div>
  `).join('');

  const modalHtml = `
    <div class="modal-overlay active" id="modalParkedTabs">
      <div class="modal-content" style="max-width:420px;">
        <div class="modal-header">
          <h3>📂 Parked Order Tabs</h3>
          <button type="button" class="modal-close">✕</button>
        </div>
        <div>${listHtml}</div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

window.resumeParkedOrder = async function(parkedId) {
  const item = parkedOrders.find(p => p.id === parkedId);
  if (item) {
    cart = JSON.parse(item.cart_json);
    document.getElementById('cartCustomerSelect').value = item.customer_id;
    await window.api.run("DELETE FROM parked_orders WHERE id = ?;", [parkedId]);
    renderCart();
    const modal = document.getElementById('modalParkedTabs');
    if (modal) modal.remove();
  }
};

// Checkout & Invoice Generation
async function processCheckout() {
  if (cart.length === 0) {
    alert('Cart is empty! Add products before checkout.');
    return;
  }

  const custId = parseInt(document.getElementById('cartCustomerSelect').value);
  const cust = customersList.find(c => c.id === custId);
  const paymentMethod = document.getElementById('cartPaymentMethod').value;

  // Validation 1: Walk-in Customer (ID 1) strictly prohibited from Credit purchases
  if (custId === 1 && paymentMethod === 'CREDIT') {
    alert('STRICT RULE VIOLATION: Walk-in Customer (ID 1) is strictly prohibited from Credit (Khata) purchases! Please select CASH, CARD, or MOBILE WALLET.');
    return;
  }

  const { subtotalCents, discountCents, taxCents, totalCents } = calculateCurrentTotals();

  // Validation 2: Credit Limit Check
  if (paymentMethod === 'CREDIT') {
    const existingDebt = cust.current_debt_cents || 0;
    const newTotalDebt = existingDebt + totalCents;
    if (newTotalDebt > cust.credit_limit_cents) {
      alert(`CREDIT LIMIT EXCEEDED! Customer "${cust.name}" has Credit Limit of ${formatCurrency(cust.credit_limit_cents)}, existing debt of ${formatCurrency(existingDebt)}. New total debt would be ${formatCurrency(newTotalDebt)}. Transaction Blocked.`);
      return;
    }
  }

  // Validation 3 & Cash System Processing
  let paidCents = 0;
  let changeCents = 0;

  if (paymentMethod === 'CREDIT') {
    paidCents = 0;
    changeCents = 0;
  } else {
    const rawPaid = document.getElementById('cartPaidInput').value.trim();
    if (rawPaid === '' || parseFloat(rawPaid) === 0) {
      paidCents = totalCents;
      document.getElementById('cartPaidInput').value = (totalCents / 100).toFixed(2);
    } else {
      paidCents = parseCurrencyToCents(rawPaid);
    }

    if (paidCents < totalCents) {
      alert(`INSUFFICIENT CASH RECEIVED!\n\nPayable Total: ${formatCurrency(totalCents)}\nTendered Cash: ${formatCurrency(paidCents)}\nShortage: ${formatCurrency(totalCents - paidCents)}\n\nPlease enter at least ${formatCurrency(totalCents)} or click "Exact Cash".`);
      return;
    }

    changeCents = paidCents - totalCents;
  }

  const invoiceNo = `INV-${Date.now().toString().slice(-8)}`;
  const createdAt = new Date().toISOString();

  // Atomic Multi-Statement Transaction Execution
  const statements = [];
  statements.push({
    sql: `INSERT INTO sales (invoice_no, cashier_id, cashier_name, customer_id, customer_name, subtotal_cents, tax_cents, discount_cents, total_cents, paid_cents, change_cents, payment_method, prescription_path, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?);`,
    params: [invoiceNo, currentUser.id, currentUser.name, custId, cust.name, subtotalCents, taxCents, discountCents, totalCents, paidCents, changeCents, paymentMethod, cartPrescriptionPath, createdAt]
  });

  for (const item of cart) {
    const lineTotal = item.quantity * item.priceCents;
    statements.push({
      sql: `INSERT INTO sale_items (sale_id, product_id, product_title, unit_type, quantity, price_cents, total_cents)
            VALUES ((SELECT id FROM sales WHERE invoice_no = '${invoiceNo}'), ?, ?, ?, ?, ?, ?);`,
      params: [item.product.id, item.product.title, item.unitType, item.quantity, item.priceCents, lineTotal]
    });

    const packSize = Math.max(1, item.product.pack_size || 1);
    const currentPacks = item.product.quantity_packs || 0;
    const currentSingles = item.product.quantity_singles || 0;
    const currentTotalUnits = (currentPacks * packSize) + currentSingles;
    const unitsToDeduct = item.unitType === 'PACK' ? (item.quantity * packSize) : item.quantity;
    const remainingUnits = currentTotalUnits - unitsToDeduct;

    let newPacks = 0;
    let newSingles = 0;
    if (remainingUnits >= 0) {
      newPacks = Math.floor(remainingUnits / packSize);
      newSingles = remainingUnits % packSize;
    } else {
      newPacks = Math.floor(remainingUnits / packSize);
      newSingles = (remainingUnits % packSize + packSize) % packSize;
    }

    statements.push({
      sql: "UPDATE products SET quantity_packs = ?, quantity_singles = ? WHERE id = ?;",
      params: [newPacks, newSingles, item.product.id]
    });
  }

  if (paymentMethod === 'CREDIT') {
    const newDebt = cust.current_debt_cents + totalCents;
    statements.push({
      sql: "UPDATE customers SET current_debt_cents = ? WHERE id = ?;",
      params: [newDebt, custId]
    });
    statements.push({
      sql: `INSERT INTO customer_ledger (customer_id, sale_id, type, debit_cents, credit_cents, balance_after_cents, notes, created_at)
            VALUES (?, (SELECT id FROM sales WHERE invoice_no = '${invoiceNo}'), 'SALE_CREDIT', ?, 0, ?, ?, ?);`,
      params: [custId, totalCents, newDebt, `Invoice ${invoiceNo} Credit Purchase`, createdAt]
    });
  }

  const txRes = await window.api.transaction(statements);
  if (!txRes.success) {
    alert('Failed to complete sale transaction: ' + txRes.error);
    return;
  }

  // Hide Checkout Modal
  document.getElementById('modalCheckoutPayment').classList.remove('active');

  // Render 80mm Thermal Receipt Preview & Open Modal
  renderThermalReceipt({
    invoiceNo, createdAt, cashierName: currentUser.name, customerName: cust.name,
    subtotalCents, taxCents, discountCents, totalCents, paidCents, changeCents,
    paymentMethod, prescriptionPath: cartPrescriptionPath, items: [...cart]
  });

  document.getElementById('modalReceiptPreview').classList.add('active');

  // Reset Cart & Refresh Master Data
  cart = [];
  cartPrescriptionPath = '';
  document.getElementById('prescriptionStatusTag').textContent = '';
  document.getElementById('cartPaidInput').value = '';
  document.getElementById('cartDiscountInput').value = '0';
  document.getElementById('cartDiscountType').value = 'FLAT';
  document.getElementById('cartCustomerSelect').value = '1';
  updateCartCustomerStatus();
  renderCart();
  await loadMasterData();
}

function renderThermalReceipt(data) {
  const container = document.getElementById('receiptContainer');
  let itemsHtml = data.items.map(item => `
    <tr>
      <td style="width:40%;">${escapeHtml(item.product.title)} (${item.unitType})</td>
      <td style="width:22%; text-align:right;">${formatCurrency(item.priceCents)}</td>
      <td style="width:15%; text-align:center;">${item.quantity}</td>
      <td style="width:23%; text-align:right;">${formatCurrency(item.quantity * item.priceCents)}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="receipt-header">
      <div class="receipt-title">${escapeHtml(settings.store_name || 'MediDesk Pharmacy')}</div>
      <div>${escapeHtml(settings.store_address || '')}</div>
      <div>Tel: ${escapeHtml(settings.store_phone || '')}</div>
    </div>
    <div style="margin:6px 0; font-size:11px;">
      <div>Invoice: <strong>${data.invoiceNo}</strong></div>
      <div>Date: ${new Date(data.createdAt).toLocaleString()}</div>
      <div>Cashier: ${escapeHtml(data.cashierName)}</div>
      <div>Customer: ${escapeHtml(data.customerName)}</div>
      <div>Pay Method: <strong>${data.paymentMethod}</strong></div>
      ${data.prescriptionPath ? '<div style="color:green; font-weight:bold;">[Prescription Attached]</div>' : ''}
    </div>
    <div class="receipt-divider"></div>
    <table class="receipt-table">
      <thead>
        <tr>
          <th>Item</th>
          <th style="text-align:right;">Price</th>
          <th style="text-align:center;">Qty</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>
    <div class="receipt-divider"></div>
    <div style="display:flex; justify-content:space-between; font-size:11px;">
      <span>Subtotal:</span> <span>${formatCurrency(data.subtotalCents)}</span>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:11px;">
      <span>Discount:</span> <span>-${formatCurrency(data.discountCents)}</span>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:11px;">
      <span>FBR POS Fee / Tax:</span> <span>${formatCurrency(data.taxCents)}</span>
    </div>
    <div class="receipt-divider"></div>
    <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:bold;">
      <span>TOTAL PAYABLE:</span> <span>${formatCurrency(data.totalCents)}</span>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:11px; margin-top:2px;">
      <span>Paid Amount:</span> <span>${formatCurrency(data.paidCents)}</span>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:11px;">
      <span>Change Return:</span> <span>${formatCurrency(data.changeCents)}</span>
    </div>
    <div class="receipt-footer">
      <div class="receipt-divider"></div>
      <div>${escapeHtml(settings.receipt_disclaimer || '')}</div>
      <div style="margin-top:4px; font-weight:bold;">Software by Syed Bilal (contact:0330449560,email:hashmib447@gmail.com)</div>
    </div>
  `;
}

/* ==========================================================================
   MODULE D: INVENTORY & PRODUCT MANAGEMENT
   ========================================================================== */
function setupInventoryEvents() {
  const modalAddProd = document.getElementById('modalAddProduct');

  // Auto Barcode Generator Button
  document.getElementById('btnAutoGenerateBarcode').addEventListener('click', () => {
    document.getElementById('prodBarcode').value = generateUniqueBarcode();
  });

  document.getElementById('btnOpenAddProduct').addEventListener('click', () => {
    document.getElementById('modalProductTitleText').textContent = '➕ Add New Product';
    document.getElementById('editProductId').value = '';
    document.getElementById('addProductForm').reset();
    document.getElementById('prodBarcode').value = generateUniqueBarcode();

    // Default expiry date: 1 year in future
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    document.getElementById('prodExpiryDate').value = nextYear.toISOString().split('T')[0];

    modalAddProd.classList.add('active');
  });

  // Live Auto-Calculation of Single Unit Price
  function autoCalcSinglePrice() {
    const salePrice = parseFloat(document.getElementById('prodSalePrice').value) || 0;
    const packSize = parseInt(document.getElementById('prodPackSize').value) || 10;

    if (salePrice > 0 && packSize > 0) {
      const calculatedSinglePrice = (salePrice / packSize).toFixed(2);
      document.getElementById('prodSinglePrice').value = calculatedSinglePrice;
    }
  }

  document.getElementById('prodSalePrice').addEventListener('input', autoCalcSinglePrice);
  document.getElementById('prodPackSize').addEventListener('input', autoCalcSinglePrice);

  document.getElementById('addProductForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('editProductId').value;
    const barcode = document.getElementById('prodBarcode').value.trim() || generateUniqueBarcode();
    const title = document.getElementById('prodTitle').value.trim();
    const generic = document.getElementById('prodGeneric').value.trim();
    const catId = parseInt(document.getElementById('prodCategory').value);
    const supId = parseInt(document.getElementById('prodSupplier').value);
    const packSize = parseInt(document.getElementById('prodPackSize').value) || 10;
    const expiryDate = document.getElementById('prodExpiryDate').value || '2027-12-31';
    const minStock = parseInt(document.getElementById('prodMinStock').value) || 5;
    const rawPackQty = parseInt(document.getElementById('prodPackQty').value) || 0;
    const rawSingleQty = parseInt(document.getElementById('prodSingleQty').value) || 0;
    const saleCents = parseCurrencyToCents(document.getElementById('prodSalePrice').value);
    const singleCents = parseCurrencyToCents(document.getElementById('prodSinglePrice').value);
    const allowNegative = document.getElementById('prodAllowNegative').checked ? 1 : 0;
    const prescriptionReq = document.getElementById('prodPrescriptionReq').checked ? 1 : 0;

    // Auto-normalize stock units into packs and remaining loose singles
    const totalInputUnits = (rawPackQty * packSize) + rawSingleQty;
    let packQty = rawPackQty;
    let singleQty = rawSingleQty;
    if (totalInputUnits >= 0) {
      packQty = Math.floor(totalInputUnits / packSize);
      singleQty = totalInputUnits % packSize;
    }

    if (editId) {
      // Update existing product
      const sql = `
        UPDATE products SET barcode = ?, title = ?, generic_name = ?, category_id = ?, supplier_id = ?,
               pack_size = ?, expiry_date = ?, min_stock_level = ?, quantity_packs = ?, quantity_singles = ?,
               sale_price_cents = ?, single_price_cents = ?, allow_negative_stock = ?, is_prescription_required = ?
        WHERE id = ?;
      `;
      const res = await window.api.run(sql, [barcode, title, generic, catId, supId, packSize, expiryDate, minStock, packQty, singleQty, saleCents, singleCents, allowNegative, prescriptionReq, editId]);
      if (res.success) {
        alert(`Product "${title}" updated successfully!`);
        modalAddProd.classList.remove('active');
        await loadMasterData();
        renderInventoryTable();
        restoreActiveFocus();
      } else {
        alert('Error updating product: ' + res.error);
        restoreActiveFocus();
      }
    } else {
      // Insert new product
      const sql = `
        INSERT INTO products (barcode, title, generic_name, category_id, supplier_id, pack_size, expiry_date, min_stock_level, quantity_packs, quantity_singles, sale_price_cents, single_price_cents, allow_negative_stock, is_prescription_required)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `;
      const res = await window.api.run(sql, [barcode, title, generic, catId, supId, packSize, expiryDate, minStock, packQty, singleQty, saleCents, singleCents, allowNegative, prescriptionReq]);

      if (res.success) {
        alert(`Product "${title}" created successfully with Barcode: ${barcode}`);
        modalAddProd.classList.remove('active');
        document.getElementById('addProductForm').reset();
        await loadMasterData();
        renderInventoryTable();
        restoreActiveFocus();
      } else {
        alert('Error adding product: ' + res.error);
        restoreActiveFocus();
      }
    }
  });
}

async function renderInventoryTable() {
  const tbody = document.getElementById('inventoryTableBody');
  const infoEl = document.getElementById('inventoryPaginationInfo');
  const pageNumEl = document.getElementById('inventoryPageNum');
  const btnPrev = document.getElementById('btnInvPrevPage');
  const btnNext = document.getElementById('btnInvNextPage');
  tbody.innerHTML = '';

  const totalCount = productsList.length;
  if (totalCount === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;">No products found in inventory master.</td></tr>`;
    if (infoEl) infoEl.textContent = 'Showing 0-0 of 0 products';
    if (pageNumEl) pageNumEl.textContent = 'Page 1';
    if (btnPrev) btnPrev.disabled = true;
    if (btnNext) btnNext.disabled = true;
    return;
  }

  const maxPage = Math.ceil(totalCount / INV_PAGE_SIZE) || 1;
  if (invCurrentPage > maxPage) invCurrentPage = maxPage;
  if (invCurrentPage < 1) invCurrentPage = 1;

  const startIndex = (invCurrentPage - 1) * INV_PAGE_SIZE;
  const pageProducts = productsList.slice(startIndex, startIndex + INV_PAGE_SIZE);

  if (infoEl) infoEl.textContent = `Showing ${startIndex + 1}-${Math.min(startIndex + INV_PAGE_SIZE, totalCount)} of ${totalCount} products`;
  if (pageNumEl) pageNumEl.textContent = `Page ${invCurrentPage} of ${maxPage}`;
  if (btnPrev) btnPrev.disabled = invCurrentPage <= 1;
  if (btnNext) btnNext.disabled = invCurrentPage >= maxPage;

  const today = new Date();

  pageProducts.forEach(p => {
    const expDate = new Date(p.expiry_date);
    const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));
    
    let expiryBadge = `<span class="badge badge-success">${p.expiry_date}</span>`;
    if (diffDays < 0) {
      expiryBadge = `<span class="badge badge-danger">Expired (${p.expiry_date})</span>`;
    } else if (diffDays <= 180) {
      expiryBadge = `<span class="badge badge-warning">⚠️ 6-Mo Warning (${p.expiry_date})</span>`;
    }

    let stockBadgeHtml = `<strong>${p.quantity_packs}</strong>`;
    let rowStyle = '';

    if (p.quantity_packs <= 0) {
      stockBadgeHtml = `<span class="badge badge-danger">OUT OF STOCK (0)</span>`;
      rowStyle = 'background:hsla(354, 85%, 54%, 0.12);';
    } else if (p.quantity_packs <= (p.min_stock_level || 5)) {
      stockBadgeHtml = `<span class="badge badge-warning" style="color:black; font-weight:bold;">⚠️ LOW STOCK (${p.quantity_packs})</span>`;
      rowStyle = 'background:hsla(38, 92%, 50%, 0.12);';
    }

    const tr = document.createElement('tr');
    if (rowStyle) tr.setAttribute('style', rowStyle);

    tr.innerHTML = `
      <td><span class="badge badge-warning">${escapeHtml(p.barcode)}</span></td>
      <td><strong>${escapeHtml(p.title)}</strong></td>
      <td>${escapeHtml(p.generic_name || '')}</td>
      <td>${escapeHtml(p.category_name || '')}</td>
      <td>${p.pack_size}</td>
      <td>${expiryBadge}</td>
      <td>${stockBadgeHtml}</td>
      <td>${p.quantity_singles}</td>
      <td>${formatCurrency(p.sale_price_cents)}</td>
      <td>${formatCurrency(p.single_price_cents)}</td>
      <td>
        <button class="btn btn-primary" style="padding:2px 6px; font-size:0.75rem;" onclick="editProduct(${p.id})">✏️ Edit</button>
        <button class="btn btn-secondary" style="padding:2px 6px; font-size:0.75rem;" onclick="deleteProduct(${p.id})">🗑️ Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.editProduct = function(productId) {
  const p = productsList.find(item => item.id === productId);
  if (!p) return;

  document.getElementById('modalProductTitleText').textContent = '✏️ Edit Product Details';
  document.getElementById('editProductId').value = p.id;
  document.getElementById('prodBarcode').value = p.barcode;
  document.getElementById('prodTitle').value = p.title;
  document.getElementById('prodGeneric').value = p.generic_name || '';
  document.getElementById('prodCategory').value = p.category_id || '';
  document.getElementById('prodSupplier').value = p.supplier_id || '';
  document.getElementById('prodPackSize').value = p.pack_size;
  document.getElementById('prodExpiryDate').value = p.expiry_date || '';
  document.getElementById('prodMinStock').value = p.min_stock_level || 5;
  document.getElementById('prodPackQty').value = p.quantity_packs || 0;
  document.getElementById('prodSingleQty').value = p.quantity_singles || 0;
  document.getElementById('prodSalePrice').value = (p.sale_price_cents / 100).toFixed(2);
  document.getElementById('prodSinglePrice').value = (p.single_price_cents / 100).toFixed(2);
  document.getElementById('prodAllowNegative').checked = p.allow_negative_stock === 1;
  document.getElementById('prodPrescriptionReq').checked = p.is_prescription_required === 1;

  document.getElementById('modalAddProduct').classList.add('active');
};

window.deleteProduct = async function(productId) {
  if (confirm('Are you sure you want to delete this product from inventory?')) {
    await window.api.run("DELETE FROM products WHERE id = ?;", [productId]);
    await loadMasterData();
    renderInventoryTable();
  }
};

/* ==========================================================================
   SUPPLIER & CATEGORY MANAGEMENT (MODAL & DEDICATED SCREEN)
   ========================================================================== */
function setupSupplierCategoryEvents() {
  const btnOpen = document.getElementById('btnOpenManageSuppliers');
  if (btnOpen) {
    btnOpen.addEventListener('click', openSupplierCategoryModal);
  }

  // Modal Cancel Edit
  const btnCancelSup = document.getElementById('btnCancelEditSupplier');
  if (btnCancelSup) btnCancelSup.addEventListener('click', resetSupplierForm);
  const btnCancelCat = document.getElementById('btnCancelEditCategory');
  if (btnCancelCat) btnCancelCat.addEventListener('click', resetCategoryForm);

  // Page Cancel Edit
  const btnPageCancelSup = document.getElementById('btnPageCancelEditSupplier');
  if (btnPageCancelSup) btnPageCancelSup.addEventListener('click', resetPageSupplierForm);
  const btnPageCancelCat = document.getElementById('btnPageCancelEditCategory');
  if (btnPageCancelCat) btnPageCancelCat.addEventListener('click', resetPageCategoryForm);

  // Modal Supplier Form Submit
  const addSupForm = document.getElementById('addSupplierForm');
  if (addSupForm) {
    addSupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('editSupplierId').value;
      const name = document.getElementById('supNameInput').value.trim();
      const contact = document.getElementById('supContactInput').value.trim();
      const phone = document.getElementById('supPhoneInput').value.trim();
      const address = document.getElementById('supAddressInput').value.trim();
      if (!name) return;

      if (editId) {
        const res = await window.api.run(
          "UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, address = ? WHERE id = ?;",
          [name, contact, phone, address, editId]
        );
        if (res.success) {
          alert(`Supplier "${name}" updated successfully!`);
          resetSupplierForm();
          await loadMasterData();
          renderSuppliersListModal();
          restoreActiveFocus();
        }
      } else {
        const res = await window.api.run(
          "INSERT INTO suppliers (name, contact_person, phone, address) VALUES (?, ?, ?, ?);",
          [name, contact, phone, address]
        );
        if (res.success) {
          alert(`Supplier "${name}" registered successfully!`);
          resetSupplierForm();
          await loadMasterData();
          renderSuppliersListModal();
          restoreActiveFocus();
        }
      }
    });
  }

  // Page Supplier Form Submit (Dedicated Screen)
  const pageSupForm = document.getElementById('pageSupplierForm');
  if (pageSupForm) {
    pageSupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('pageEditSupplierId').value;
      const name = document.getElementById('pageSupNameInput').value.trim();
      const contact = document.getElementById('pageSupContactInput').value.trim();
      const phone = document.getElementById('pageSupPhoneInput').value.trim();
      const address = document.getElementById('pageSupAddressInput').value.trim();
      if (!name) return;

      if (editId) {
        const res = await window.api.run(
          "UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, address = ? WHERE id = ?;",
          [name, contact, phone, address, editId]
        );
        if (res.success) {
          alert(`Supplier "${name}" updated successfully!`);
          resetPageSupplierForm();
          await loadMasterData();
          restoreActiveFocus(document.getElementById('pageSupNameInput'));
        }
      } else {
        const res = await window.api.run(
          "INSERT INTO suppliers (name, contact_person, phone, address) VALUES (?, ?, ?, ?);",
          [name, contact, phone, address]
        );
        if (res.success) {
          alert(`Supplier "${name}" registered successfully!`);
          resetPageSupplierForm();
          await loadMasterData();
          restoreActiveFocus(document.getElementById('pageSupNameInput'));
        }
      }
    });
  }

  // Modal Category Form Submit
  const addCatForm = document.getElementById('addCategoryForm');
  if (addCatForm) {
    addCatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('editCategoryId').value;
      const name = document.getElementById('catNameInput').value.trim();
      if (!name) return;

      if (editId) {
        const res = await window.api.run("UPDATE categories SET name = ? WHERE id = ?;", [name, editId]);
        if (res.success) {
          alert(`Category "${name}" updated successfully!`);
          resetCategoryForm();
          await loadMasterData();
          renderCategoriesListModal();
          restoreActiveFocus();
        }
      } else {
        const res = await window.api.run("INSERT INTO categories (name, description) VALUES (?, 'Medicine Category');", [name]);
        if (res.success) {
          alert(`Category "${name}" created successfully!`);
          resetCategoryForm();
          await loadMasterData();
          renderCategoriesListModal();
          restoreActiveFocus();
        }
      }
    });
  }

  // Page Category Form Submit (Dedicated Screen)
  const pageCatForm = document.getElementById('pageCategoryForm');
  if (pageCatForm) {
    pageCatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('pageEditCategoryId').value;
      const name = document.getElementById('pageCatNameInput').value.trim();
      if (!name) return;

      if (editId) {
        const res = await window.api.run("UPDATE categories SET name = ? WHERE id = ?;", [name, editId]);
        if (res.success) {
          alert(`Category "${name}" updated successfully!`);
          resetPageCategoryForm();
          await loadMasterData();
          restoreActiveFocus(document.getElementById('pageCatNameInput'));
        }
      } else {
        const res = await window.api.run("INSERT INTO categories (name, description) VALUES (?, 'Medicine Category');", [name]);
        if (res.success) {
          alert(`Category "${name}" created successfully!`);
          resetPageCategoryForm();
          await loadMasterData();
          restoreActiveFocus(document.getElementById('pageCatNameInput'));
        }
      }
    });
  }
}

function resetSupplierForm() {
  document.getElementById('editSupplierId').value = '';
  document.getElementById('addSupplierForm').reset();
  document.getElementById('btnSaveSupplier').textContent = '💾 Save Supplier';
  document.getElementById('btnCancelEditSupplier').style.display = 'none';
}

function resetCategoryForm() {
  document.getElementById('editCategoryId').value = '';
  document.getElementById('addCategoryForm').reset();
  document.getElementById('btnSaveCategory').textContent = '➕ Save Category';
  document.getElementById('btnCancelEditCategory').style.display = 'none';
}

function resetPageSupplierForm() {
  const editId = document.getElementById('pageEditSupplierId');
  if (editId) editId.value = '';
  const form = document.getElementById('pageSupplierForm');
  if (form) form.reset();
  const btnSave = document.getElementById('btnPageSaveSupplier');
  if (btnSave) btnSave.textContent = '💾 Save Supplier';
  const btnCancel = document.getElementById('btnPageCancelEditSupplier');
  if (btnCancel) btnCancel.style.display = 'none';
}

function resetPageCategoryForm() {
  const editId = document.getElementById('pageEditCategoryId');
  if (editId) editId.value = '';
  const form = document.getElementById('pageCategoryForm');
  if (form) form.reset();
  const btnSave = document.getElementById('btnPageSaveCategory');
  if (btnSave) btnSave.textContent = '➕ Save Category';
  const btnCancel = document.getElementById('btnPageCancelEditCategory');
  if (btnCancel) btnCancel.style.display = 'none';
}

window.openSupplierCategoryModal = function() {
  resetSupplierForm();
  resetCategoryForm();
  renderSuppliersListModal();
  renderCategoriesListModal();
  document.getElementById('modalManageSuppliers').classList.add('active');
};

function renderSuppliersListModal() {
  const tbody = document.getElementById('suppliersListModalBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (suppliersList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No suppliers registered yet.</td></tr>`;
    return;
  }

  suppliersList.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${s.id}</td>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td>${escapeHtml(s.contact_person || 'N/A')}</td>
      <td>${escapeHtml(s.phone || 'N/A')}</td>
      <td>
        <button class="btn btn-primary" style="padding:2px 6px; font-size:0.75rem;" onclick="editSupplierInModal(${s.id})">✏️ Edit</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderCategoriesListModal() {
  const tbody = document.getElementById('categoriesListModalBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (categoriesList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;">No categories registered yet.</td></tr>`;
    return;
  }

  categoriesList.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${c.id}</td>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td>
        <button class="btn btn-primary" style="padding:2px 6px; font-size:0.75rem;" onclick="editCategoryInModal(${c.id})">✏️ Edit</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderSuppliersPage() {
  const tbody = document.getElementById('pageSuppliersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (suppliersList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No suppliers registered yet.</td></tr>`;
    return;
  }

  suppliersList.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${s.id}</td>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td>${escapeHtml(s.contact_person || 'N/A')}</td>
      <td>${escapeHtml(s.phone || 'N/A')}</td>
      <td>${escapeHtml(s.address || 'N/A')}</td>
      <td>
        <button class="btn btn-primary" style="padding:2px 6px; font-size:0.75rem;" onclick="editPageSupplier(${s.id})">✏️ Edit</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderCategoriesPage() {
  const tbody = document.getElementById('pageCategoriesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (categoriesList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;">No categories registered yet.</td></tr>`;
    return;
  }

  categoriesList.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${c.id}</td>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td>
        <button class="btn btn-primary" style="padding:2px 6px; font-size:0.75rem;" onclick="editPageCategory(${c.id})">✏️ Edit</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.editSupplierInModal = function(supId) {
  const sup = suppliersList.find(s => s.id === supId);
  if (sup) {
    document.getElementById('editSupplierId').value = sup.id;
    document.getElementById('supNameInput').value = sup.name;
    document.getElementById('supContactInput').value = sup.contact_person || '';
    document.getElementById('supPhoneInput').value = sup.phone || '';
    document.getElementById('supAddressInput').value = sup.address || '';
    document.getElementById('btnSaveSupplier').textContent = '✏️ Update Supplier';
    document.getElementById('btnCancelEditSupplier').style.display = 'inline-block';
    document.getElementById('supNameInput').focus();
  }
};

window.editCategoryInModal = function(catId) {
  const cat = categoriesList.find(c => c.id === catId);
  if (cat) {
    document.getElementById('editCategoryId').value = cat.id;
    document.getElementById('catNameInput').value = cat.name;
    document.getElementById('btnSaveCategory').textContent = '✏️ Update Category';
    document.getElementById('btnCancelEditCategory').style.display = 'inline-block';
    document.getElementById('catNameInput').focus();
  }
};

window.editPageSupplier = function(supId) {
  const sup = suppliersList.find(s => s.id === supId);
  if (sup) {
    document.getElementById('pageEditSupplierId').value = sup.id;
    document.getElementById('pageSupNameInput').value = sup.name;
    document.getElementById('pageSupContactInput').value = sup.contact_person || '';
    document.getElementById('pageSupPhoneInput').value = sup.phone || '';
    document.getElementById('pageSupAddressInput').value = sup.address || '';
    document.getElementById('btnPageSaveSupplier').textContent = '✏️ Update Supplier';
    document.getElementById('btnPageCancelEditSupplier').style.display = 'inline-block';
    document.getElementById('pageSupNameInput').focus();
  }
};

window.editPageCategory = function(catId) {
  const cat = categoriesList.find(c => c.id === catId);
  if (cat) {
    document.getElementById('pageEditCategoryId').value = cat.id;
    document.getElementById('pageCatNameInput').value = cat.name;
    document.getElementById('btnPageSaveCategory').textContent = '✏️ Update Category';
    document.getElementById('btnPageCancelEditCategory').style.display = 'inline-block';
    document.getElementById('pageCatNameInput').focus();
  }
};
function setupKhataEvents() {
  document.getElementById('btnOpenAddCustomer').addEventListener('click', () => {
    const name = prompt('Enter Customer Full Name:');
    if (!name) return;
    const phone = prompt('Enter Customer Phone Number:');
    const limitRs = prompt('Enter Credit Limit in Rs (Default: 5000):', '5000');
    const limitCents = parseCurrencyToCents(limitRs || '5000');

    window.api.run(
      "INSERT INTO customers (name, phone, address, credit_limit_cents, current_debt_cents) VALUES (?, ?, 'Registered', ?, 0);",
      [name, phone || '', limitCents]
    ).then(async res => {
      if (res.success) {
        alert(`Customer "${name}" created with Credit Limit ${formatCurrency(limitCents)}`);
        await loadMasterData();
        renderCustomerTable();
      }
    });
  });

  document.getElementById('paymentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const custId = parseInt(document.getElementById('payCustomerId').value);
    const cust = customersList.find(c => c.id === custId);
    const payRs = parseFloat(document.getElementById('payAmountInput').value) || 0;
    const payCents = Math.round(payRs * 100);
    const notes = document.getElementById('payNotesInput').value.trim() || 'Cash received at counter';

    if (payCents <= 0) {
      alert('Enter a valid payment amount.');
      return;
    }

    const newDebt = Math.max(0, cust.current_debt_cents - payCents);
    const createdAt = new Date().toISOString();

    await window.api.run("UPDATE customers SET current_debt_cents = ? WHERE id = ?;", [newDebt, custId]);
    await window.api.run(
      `INSERT INTO customer_ledger (customer_id, sale_id, type, debit_cents, credit_cents, balance_after_cents, notes, created_at)
       VALUES (?, NULL, 'PAYMENT_RECEIVED', 0, ?, ?, ?, ?);`,
      [custId, payCents, newDebt, notes, createdAt]
    );

    alert(`Payment of ${formatCurrency(payCents)} recorded for ${cust.name}. Remaining Debt: ${formatCurrency(newDebt)}`);
    document.getElementById('modalRecordPayment').classList.remove('active');
    await loadMasterData();
    renderCustomerTable();
  });
}

function renderCustomerTable() {
  const tbody = document.getElementById('customerTableBody');
  const infoEl = document.getElementById('khataPaginationInfo');
  const pageNumEl = document.getElementById('khataPageNum');
  const btnPrev = document.getElementById('btnKhataPrevPage');
  const btnNext = document.getElementById('btnKhataNextPage');
  tbody.innerHTML = '';

  const totalCount = customersList.length;
  if (totalCount === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;">No customer accounts registered.</td></tr>`;
    if (infoEl) infoEl.textContent = 'Showing 0-0 of 0 customers';
    if (pageNumEl) pageNumEl.textContent = 'Page 1';
    if (btnPrev) btnPrev.disabled = true;
    if (btnNext) btnNext.disabled = true;
    return;
  }

  const maxPage = Math.ceil(totalCount / KHATA_PAGE_SIZE) || 1;
  if (khataCurrentPage > maxPage) khataCurrentPage = maxPage;
  if (khataCurrentPage < 1) khataCurrentPage = 1;

  const startIndex = (khataCurrentPage - 1) * KHATA_PAGE_SIZE;
  const pageCustomers = customersList.slice(startIndex, startIndex + KHATA_PAGE_SIZE);

  if (infoEl) infoEl.textContent = `Showing ${startIndex + 1}-${Math.min(startIndex + KHATA_PAGE_SIZE, totalCount)} of ${totalCount} customers`;
  if (pageNumEl) pageNumEl.textContent = `Page ${khataCurrentPage} of ${maxPage}`;
  if (btnPrev) btnPrev.disabled = khataCurrentPage <= 1;
  if (btnNext) btnNext.disabled = khataCurrentPage >= maxPage;

  pageCustomers.forEach(c => {
    const isWalkIn = c.id === 1;
    const availCredit = c.credit_limit_cents - c.current_debt_cents;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${c.id}</td>
      <td><strong>${escapeHtml(c.name)}</strong> ${isWalkIn ? '<span class="badge badge-danger">Walk-in</span>' : ''}</td>
      <td>${escapeHtml(c.phone || 'N/A')}</td>
      <td>${escapeHtml(c.address || '')}</td>
      <td>${formatCurrency(c.credit_limit_cents)}</td>
      <td style="color:${c.current_debt_cents > 0 ? 'var(--danger)' : 'var(--accent)'}; font-weight:700;">
        ${formatCurrency(c.current_debt_cents)}
      </td>
      <td>${isWalkIn ? 'N/A' : formatCurrency(availCredit)}</td>
      <td>${c.current_debt_cents > c.credit_limit_cents ? '<span class="badge badge-danger">Over Limit</span>' : '<span class="badge badge-success">Good</span>'}</td>
      <td>
        ${!isWalkIn ? `
          <button class="btn btn-primary" style="padding:2px 6px; font-size:0.75rem;" onclick="openPaymentModal(${c.id})">💵 Record Payment</button>
          <button class="btn btn-secondary" style="padding:2px 6px; font-size:0.75rem;" onclick="generateA4LedgerStatement(${c.id})">📄 A4 Ledger PDF</button>
        ` : '<em>Prohibited</em>'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.openPaymentModal = function(custId) {
  const cust = customersList.find(c => c.id === custId);
  if (cust) {
    document.getElementById('payCustomerId').value = cust.id;
    document.getElementById('payCustomerName').value = cust.name;
    document.getElementById('payCurrentDebt').value = formatCurrency(cust.current_debt_cents);
    document.getElementById('payAmountInput').value = '';
    document.getElementById('modalRecordPayment').classList.add('active');
  }
};

window.generateA4LedgerStatement = async function(custId) {
  const cust = customersList.find(c => c.id === custId);
  if (!cust) return;

  const res = await window.api.query(
    "SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY created_at ASC;",
    [custId]
  );

  if (!res.success) return;

  let rowsHtml = res.data.map(l => `
    <tr>
      <td style="padding:8px; border-bottom:1px solid #ccc;">${new Date(l.created_at).toLocaleString()}</td>
      <td style="padding:8px; border-bottom:1px solid #ccc;"><strong>${l.type}</strong></td>
      <td style="padding:8px; border-bottom:1px solid #ccc;">${escapeHtml(l.notes || '')}</td>
      <td style="padding:8px; border-bottom:1px solid #ccc; color:red; text-align:right;">${l.debit_cents ? formatCurrency(l.debit_cents) : '-'}</td>
      <td style="padding:8px; border-bottom:1px solid #ccc; color:green; text-align:right;">${l.credit_cents ? formatCurrency(l.credit_cents) : '-'}</td>
      <td style="padding:8px; border-bottom:1px solid #ccc; text-align:right; font-weight:bold;">${formatCurrency(l.balance_after_cents)}</td>
    </tr>
  `).join('');

  const documentHtml = `
    <div style="display:flex; justify-content:space-between; border-bottom:2px solid #333; padding-bottom:10px; margin-bottom:15px;">
      <div>
        <h2 style="margin:0; font-size:20px; color:#1a365d;">${escapeHtml(settings.store_name || 'MediDesk Pharmacy')}</h2>
        <div>${escapeHtml(settings.store_address || '')} | Tel: ${escapeHtml(settings.store_phone || '')}</div>
      </div>
      <div style="text-align:right;">
        <h3 style="margin:0; color:#2b6cb0;">CUSTOMER LEDGER STATEMENT</h3>
        <div>Date: ${new Date().toLocaleDateString()}</div>
      </div>
    </div>

    <div style="background:#f7fafc; padding:12px; border-radius:6px; margin-bottom:15px; display:flex; justify-content:space-between;">
      <div>
        <div><strong>Customer Name:</strong> ${escapeHtml(cust.name)}</div>
        <div><strong>Phone:</strong> ${escapeHtml(cust.phone || 'N/A')}</div>
      </div>
      <div style="text-align:right;">
        <div><strong>Credit Limit:</strong> ${formatCurrency(cust.credit_limit_cents)}</div>
        <div><strong>Current Debt Balance:</strong> <span style="color:red; font-weight:bold;">${formatCurrency(cust.current_debt_cents)}</span></div>
      </div>
    </div>

    <table style="width:100%; border-collapse:collapse; font-size:12px;">
      <thead>
        <tr style="background:#edf2f7;">
          <th style="padding:8px; text-align:left;">Date & Time</th>
          <th style="padding:8px; text-align:left;">Type</th>
          <th style="padding:8px; text-align:left;">Reference / Notes</th>
          <th style="padding:8px; text-align:right;">Debit (Debt+)</th>
          <th style="padding:8px; text-align:right;">Credit (Paid-)</th>
          <th style="padding:8px; text-align:right;">Running Balance</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="6" style="text-align:center; padding:15px;">No ledger transactions recorded.</td></tr>'}
      </tbody>
    </table>
  `;

  document.getElementById('a4ModalTitle').textContent = `A4 Ledger Statement - ${cust.name}`;
  document.getElementById('a4DocumentContainer').innerHTML = documentHtml;
  document.getElementById('modalA4Preview').classList.add('active');

  document.getElementById('btnPrintA4Now').onclick = () => window.api.print();
};

/* ==========================================================================
   MODULE E: RESTOCK ORDER BUILDER
   ========================================================================== */
function setupRestockEvents() {
  document.querySelectorAll('input[name="stockFilter"]').forEach(r => {
    r.addEventListener('change', renderRestockTable);
  });
  document.getElementById('supplierOrderSelect').addEventListener('change', renderRestockTable);
  document.getElementById('btnGeneratePO').addEventListener('click', generateSupplierPO);
}

function renderRestockTable() {
  const filter = document.querySelector('input[name="stockFilter"]:checked').value;
  const supplierId = document.getElementById('supplierOrderSelect').value;
  const tbody = document.getElementById('restockTableBody');
  tbody.innerHTML = '';

  const filtered = productsList.filter(p => {
    const isLow = p.quantity_packs <= p.min_stock_level;
    const isOut = p.quantity_packs === 0;

    let matchesType = true;
    if (filter === 'LOW') matchesType = isLow;
    if (filter === 'OUT') matchesType = isOut;

    const matchesSup = !supplierId || p.supplier_id.toString() === supplierId;
    return matchesType && matchesSup;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">No products matching restock criteria.</td></tr>`;
    return;
  }

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    const reqPacks = Math.max(10, (p.min_stock_level * 2) - p.quantity_packs);
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.title)}</strong></td>
      <td>${escapeHtml(p.supplier_name || 'N/A')}</td>
      <td style="color:${p.quantity_packs === 0 ? 'var(--danger)' : 'var(--warning)'}; font-weight:bold;">${p.quantity_packs}</td>
      <td>${p.min_stock_level}</td>
      <td>${p.pack_size}</td>
      <td><input type="number" class="form-control po-qty-input" data-prodid="${p.id}" value="${reqPacks}" min="1" style="width:80px; padding:2px 6px;"></td>
      <td>${formatCurrency((p.sale_price_cents || 0) * reqPacks)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function generateSupplierPO() {
  const supId = document.getElementById('supplierOrderSelect').value;
  const sup = suppliersList.find(s => s.id.toString() === supId) || { name: 'General Distributor', contact_person: 'Sales Rep', phone: 'N/A' };

  const inputs = document.querySelectorAll('.po-qty-input');
  let poItems = [];

  inputs.forEach(input => {
    const prodId = parseInt(input.getAttribute('data-prodid'));
    const qty = parseInt(input.value) || 0;
    const prod = productsList.find(p => p.id === prodId);
    if (prod && qty > 0) {
      poItems.push({ prod, qty });
    }
  });

  if (poItems.length === 0) {
    alert('No restock items selected for Purchase Order.');
    return;
  }

  let itemsHtml = poItems.map(item => `
    <tr>
      <td style="padding:8px; border-bottom:1px solid #ccc;">${escapeHtml(item.prod.title)}</td>
      <td style="padding:8px; border-bottom:1px solid #ccc;">${escapeHtml(item.prod.generic_name || '')}</td>
      <td style="padding:8px; border-bottom:1px solid #ccc; text-align:center;">${item.prod.pack_size} singles</td>
      <td style="padding:8px; border-bottom:1px solid #ccc; text-align:center; font-weight:bold;">${item.qty} Packs</td>
      <td style="padding:8px; border-bottom:1px solid #ccc; text-align:right;">${formatCurrency(item.prod.sale_price_cents || 0)}</td>
      <td style="padding:8px; border-bottom:1px solid #ccc; text-align:right; font-weight:bold;">${formatCurrency((item.prod.sale_price_cents || 0) * item.qty)}</td>
    </tr>
  `).join('');

  const docHtml = `
    <div style="display:flex; justify-content:space-between; border-bottom:2px solid #333; padding-bottom:10px; margin-bottom:15px;">
      <div>
        <h2 style="margin:0; color:#1a365d;">${escapeHtml(settings.store_name || 'MediDesk Pharmacy')}</h2>
        <div>${escapeHtml(settings.store_address || '')}</div>
      </div>
      <div style="text-align:right;">
        <h3 style="margin:0; color:#2b6cb0;">SUPPLIER PURCHASE ORDER (PO)</h3>
        <div>PO Ref: <strong>PO-${Date.now().toString().slice(-6)}</strong></div>
        <div>Date: ${new Date().toLocaleDateString()}</div>
      </div>
    </div>

    <div style="background:#f7fafc; padding:12px; border-radius:6px; margin-bottom:15px;">
      <div><strong>To Supplier:</strong> ${escapeHtml(sup.name)}</div>
      <div><strong>Contact Rep:</strong> ${escapeHtml(sup.contact_person || 'N/A')} | Tel: ${escapeHtml(sup.phone || 'N/A')}</div>
    </div>

    <table style="width:100%; border-collapse:collapse; font-size:12px;">
      <thead>
        <tr style="background:#edf2f7;">
          <th style="padding:8px; text-align:left;">Product Title</th>
          <th style="padding:8px; text-align:left;">Generic</th>
          <th style="padding:8px; text-align:center;">Pack Size</th>
          <th style="padding:8px; text-align:center;">Requested Qty</th>
          <th style="padding:8px; text-align:right;">Est. Cost/Pack</th>
          <th style="padding:8px; text-align:right;">Line Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div style="margin-top:40px; display:flex; justify-content:space-between; font-size:12px;">
      <div>
        <div>___________________________</div>
        <div>Authorized Pharmacist Signature</div>
      </div>
      <div style="text-align:right;">
        <div>___________________________</div>
        <div>Supplier Receiver Stamp / Sign</div>
      </div>
    </div>
  `;

  document.getElementById('a4ModalTitle').textContent = `A4 Supplier Purchase Order - ${sup.name}`;
  document.getElementById('a4DocumentContainer').innerHTML = docHtml;
  document.getElementById('modalA4Preview').classList.add('active');

  document.getElementById('btnPrintA4Now').onclick = () => window.api.print();
}

/* ==========================================================================
   MODULE F: EXPIRY CENTER & 6-MONTH WARNING BOARD
   ========================================================================== */
async function renderExpiryCenter() {
  const tbody = document.getElementById('expiryTableBody');
  tbody.innerHTML = '';

  const res = await window.api.query(`
    SELECT * FROM products ORDER BY expiry_date ASC;
  `);

  if (!res.success) return;

  const today = new Date();
  let expiredCount = 0, exp30Count = 0, exp90Count = 0, exp180Count = 0;

  res.data.forEach(p => {
    const expDate = new Date(p.expiry_date);
    const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));

    let statusTag = '';
    if (diffDays < 0) {
      expiredCount++;
      statusTag = '<span class="badge badge-danger">EXPIRED</span>';
    } else if (diffDays <= 30) {
      exp30Count++;
      statusTag = '<span class="badge badge-danger">Expiring < 30 Days</span>';
    } else if (diffDays <= 90) {
      exp90Count++;
      statusTag = '<span class="badge badge-warning">Expiring < 90 Days (3 Mo)</span>';
    } else if (diffDays <= 180) {
      exp180Count++;
      statusTag = '<span class="badge badge-warning" style="background:hsla(38, 92%, 50%, 0.25); color:var(--warning);">⚠️ 6-Month Expiry Warning (< 180 Days)</span>';
    } else {
      return;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.title)}</strong></td>
      <td>${escapeHtml(p.barcode)}</td>
      <td>${p.expiry_date}</td>
      <td>${statusTag}</td>
      <td>${p.quantity_packs}</td>
      <td>${p.quantity_singles}</td>
      <td>
        <button class="btn btn-danger" style="padding:2px 6px; font-size:0.75rem;" onclick="discardExpiredStock(${p.id})">🗑️ Discard Stock</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('statExpired').textContent = expiredCount;
  document.getElementById('statExp30').textContent = exp30Count;
  document.getElementById('statExp90').textContent = exp90Count;
  document.getElementById('statExp180').textContent = exp180Count;
}

function updateExpiryBadge() {
  window.api.query("SELECT COUNT(*) as cnt FROM products WHERE expiry_date <= date('now', '+180 days');").then(res => {
    if (res.success && res.data[0]) {
      const cnt = res.data[0].cnt;
      const badge = document.getElementById('expiryCountBadge');
      if (cnt > 0) {
        badge.textContent = `${cnt} (6-Mo Warning)`;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
  });
}

function updateLowStockBadge() {
  window.api.query("SELECT COUNT(*) as cnt FROM products WHERE quantity_packs <= min_stock_level;").then(res => {
    if (res.success && res.data && res.data[0]) {
      const cnt = res.data[0].cnt;
      const badge = document.getElementById('lowStockCountBadge');
      if (badge) {
        if (cnt > 0) {
          badge.textContent = `${cnt} Low Stock`;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }
    }
  });
}

window.discardExpiredStock = async function(productId) {
  if (confirm('Zero out expired stock for this product?')) {
    await window.api.run("UPDATE products SET quantity_packs = 0, quantity_singles = 0 WHERE id = ?;", [productId]);
    await loadMasterData();
    renderExpiryCenter();
  }
};

/* ==========================================================================
   MODULE G: QUOTATION BUILDER
   ========================================================================== */
function setupQuotationEvents() {
  document.getElementById('btnAddQuoteRow').addEventListener('click', addQuoteRow);
  document.getElementById('btnPrintQuote').addEventListener('click', renderPrintableQuote);
  addQuoteRow();
}

function addQuoteRow() {
  const tbody = document.getElementById('quoteItemsBody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <select class="form-control quote-prod-select" style="font-weight:bold;"></select>
    </td>
    <td>
      <select class="form-control quote-unit-select">
        <option value="PACK">PACK</option>
        <option value="SINGLE" selected>SINGLE</option>
      </select>
    </td>
    <td>
      <input type="number" class="form-control quote-qty-input" value="1" min="1" style="width:70px;">
    </td>
    <td>
      <input type="number" class="form-control quote-price-input" placeholder="0.00" step="0.01" style="width:100px;">
    </td>
    <td class="quote-row-total" style="font-weight:bold;">Rs 0.00</td>
    <td>
      <button class="btn btn-secondary" style="padding:2px 6px; color:var(--danger);" onclick="this.closest('tr').remove(); calculateQuoteTotals();">✕</button>
    </td>
  `;
  tbody.appendChild(tr);

  const sel = tr.querySelector('.quote-prod-select');
  sel.innerHTML = '<option value="">-- Select Product --</option>';
  productsList.forEach(p => {
    sel.innerHTML += `<option value="${p.id}" data-packprice="${p.sale_price_cents || 0}" data-singleprice="${p.single_price_cents || 0}">${escapeHtml(p.title)}</option>`;
  });

  sel.addEventListener('change', () => {
    const opt = sel.options[sel.selectedIndex];
    const unitType = tr.querySelector('.quote-unit-select').value;
    const priceCents = unitType === 'PACK' ? parseFloat(opt.getAttribute('data-packprice')) : parseFloat(opt.getAttribute('data-singleprice'));
    tr.querySelector('.quote-price-input').value = (priceCents / 100).toFixed(2);
    calculateQuoteTotals();
  });

  tr.querySelector('.quote-unit-select').addEventListener('change', () => {
    const opt = sel.options[sel.selectedIndex];
    if (opt && opt.value) {
      const unitType = tr.querySelector('.quote-unit-select').value;
      const priceCents = unitType === 'PACK' ? parseFloat(opt.getAttribute('data-packprice')) : parseFloat(opt.getAttribute('data-singleprice'));
      tr.querySelector('.quote-price-input').value = (priceCents / 100).toFixed(2);
      calculateQuoteTotals();
    }
  });

  tr.querySelector('.quote-qty-input').addEventListener('input', calculateQuoteTotals);
  tr.querySelector('.quote-price-input').addEventListener('input', calculateQuoteTotals);
}

function calculateQuoteTotals() {
  document.querySelectorAll('#quoteItemsBody tr').forEach(tr => {
    const qty = parseInt(tr.querySelector('.quote-qty-input').value) || 0;
    const price = parseFloat(tr.querySelector('.quote-price-input').value) || 0;
    const total = qty * price;
    tr.querySelector('.quote-row-total').textContent = `Rs ${total.toFixed(2)}`;
  });
}

function renderPrintableQuote() {
  const custName = document.getElementById('quoteCustomerName').value.trim() || 'Valued Client';
  const custPhone = document.getElementById('quoteCustomerPhone').value.trim() || 'N/A';

  let grandTotal = 0;
  let rowsHtml = '';

  document.querySelectorAll('#quoteItemsBody tr').forEach(tr => {
    const sel = tr.querySelector('.quote-prod-select');
    const prodName = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
    const unitType = tr.querySelector('.quote-unit-select').value;
    const qty = parseInt(tr.querySelector('.quote-qty-input').value) || 0;
    const price = parseFloat(tr.querySelector('.quote-price-input').value) || 0;
    const lineTotal = qty * price;
    grandTotal += lineTotal;

    if (prodName && qty > 0) {
      rowsHtml += `
        <tr>
          <td style="padding:8px; border-bottom:1px solid #ccc;">${escapeHtml(prodName)}</td>
          <td style="padding:8px; border-bottom:1px solid #ccc; text-align:center;">${unitType}</td>
          <td style="padding:8px; border-bottom:1px solid #ccc; text-align:center;">${qty}</td>
          <td style="padding:8px; border-bottom:1px solid #ccc; text-align:right;">Rs ${price.toFixed(2)}</td>
          <td style="padding:8px; border-bottom:1px solid #ccc; text-align:right; font-weight:bold;">Rs ${lineTotal.toFixed(2)}</td>
        </tr>
      `;
    }
  });

  const docHtml = `
    <div style="display:flex; justify-content:space-between; border-bottom:2px solid #333; padding-bottom:10px; margin-bottom:15px;">
      <div>
        <h2 style="margin:0; color:#1a365d;">${escapeHtml(settings.store_name || 'MediDesk Pharmacy')}</h2>
        <div>${escapeHtml(settings.store_address || '')}</div>
      </div>
      <div style="text-align:right;">
        <h3 style="margin:0; color:#2b6cb0;">FORMAL PRICE QUOTATION</h3>
        <div>Quote Ref: <strong>QT-${Date.now().toString().slice(-6)}</strong></div>
        <div>Valid Until: ${new Date(Date.now() + 15*24*60*60*1000).toLocaleDateString()}</div>
      </div>
    </div>

    <div style="background:#f7fafc; padding:12px; border-radius:6px; margin-bottom:15px;">
      <div><strong>Prepared For:</strong> ${escapeHtml(custName)}</div>
      <div><strong>Contact Phone:</strong> ${escapeHtml(custPhone)}</div>
    </div>

    <table style="width:100%; border-collapse:collapse; font-size:12px;">
      <thead>
        <tr style="background:#edf2f7;">
          <th style="padding:8px; text-align:left;">Product</th>
          <th style="padding:8px; text-align:center;">Unit Type</th>
          <th style="padding:8px; text-align:center;">Quantity</th>
          <th style="padding:8px; text-align:right;">Unit Price</th>
          <th style="padding:8px; text-align:right;">Total Amount</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="5" style="text-align:center; padding:15px;">No quote items added.</td></tr>'}
      </tbody>
    </table>

    <div style="text-align:right; font-size:16px; font-weight:bold; margin-top:15px; color:#1a365d;">
      ESTIMATED GRAND TOTAL: Rs ${grandTotal.toFixed(2)}
    </div>
  `;

  document.getElementById('a4ModalTitle').textContent = `A4 Price Quotation - ${custName}`;
  document.getElementById('a4DocumentContainer').innerHTML = docHtml;
  document.getElementById('modalA4Preview').classList.add('active');

  document.getElementById('btnPrintA4Now').onclick = () => window.api.print();
}

/* ==========================================================================
   MODULE H: SALES HISTORY & VOID TRANSACTIONS (WITH PRESCRIPTION ATTACHMENT)
   ========================================================================== */
function setupSalesEvents() {
  document.getElementById('voidForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saleId = parseInt(document.getElementById('voidSaleId').value);
    const reason = document.getElementById('voidReasonInput').value.trim();

    if (!reason) {
      alert('Please enter a reason for voiding.');
      return;
    }

    await performVoidSale(saleId, reason);
    document.getElementById('modalVoidSale').classList.remove('active');
  });

  // Attach prescription to historical invoice file listener
  document.getElementById('invoiceRxFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file && activeRxSaleId) {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result.split(',')[1];
        const saveRes = await window.api.savePrescription({ fileName: file.name, base64Data });
        if (saveRes.success) {
          const dbRes = await window.api.run("UPDATE sales SET prescription_path = ? WHERE id = ?;", [saveRes.filePath, activeRxSaleId]);
          if (dbRes.success) {
            alert('Prescription image attached successfully to invoice!');
            activeRxSaleId = null;
            renderSalesTable();
          } else {
            alert('Database update failed: ' + dbRes.error);
          }
        } else {
          alert('Failed to save prescription file: ' + saveRes.error);
        }
      };
      reader.readAsDataURL(file);
    }
  });
}

function setupPaginationListeners() {
  document.getElementById('btnInvPrevPage')?.addEventListener('click', () => {
    if (invCurrentPage > 1) {
      invCurrentPage--;
      renderInventoryTable();
    }
  });
  document.getElementById('btnInvNextPage')?.addEventListener('click', () => {
    const maxPage = Math.ceil(productsList.length / INV_PAGE_SIZE) || 1;
    if (invCurrentPage < maxPage) {
      invCurrentPage++;
      renderInventoryTable();
    }
  });

  document.getElementById('btnKhataPrevPage')?.addEventListener('click', () => {
    if (khataCurrentPage > 1) {
      khataCurrentPage--;
      renderCustomerTable();
    }
  });
  document.getElementById('btnKhataNextPage')?.addEventListener('click', () => {
    const maxPage = Math.ceil(customersList.length / KHATA_PAGE_SIZE) || 1;
    if (khataCurrentPage < maxPage) {
      khataCurrentPage++;
      renderCustomerTable();
    }
  });

  document.getElementById('btnSalesPrevPage')?.addEventListener('click', () => {
    if (salesCurrentPage > 1) {
      salesCurrentPage--;
      renderSalesTable();
    }
  });
  document.getElementById('btnSalesNextPage')?.addEventListener('click', () => {
    const maxPage = Math.ceil(100 / SALES_PAGE_SIZE) || 1;
    if (salesCurrentPage < maxPage) {
      salesCurrentPage++;
      renderSalesTable();
    }
  });
}

async function renderSalesTable() {
  const tbody = document.getElementById('salesTableBody');
  const infoEl = document.getElementById('salesPaginationInfo');
  const pageNumEl = document.getElementById('salesPageNum');
  const btnPrev = document.getElementById('btnSalesPrevPage');
  const btnNext = document.getElementById('btnSalesNextPage');
  tbody.innerHTML = '';

  const res = await window.api.query("SELECT * FROM sales ORDER BY id DESC;");
  if (!res.success || !res.data || res.data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;">No sales invoices recorded yet.</td></tr>`;
    if (infoEl) infoEl.textContent = 'Showing 0-0 of 0 sales';
    if (pageNumEl) pageNumEl.textContent = 'Page 1';
    if (btnPrev) btnPrev.disabled = true;
    if (btnNext) btnNext.disabled = true;
    return;
  }

  const allSales = res.data;
  const totalCount = allSales.length;
  const maxPage = Math.ceil(totalCount / SALES_PAGE_SIZE) || 1;
  if (salesCurrentPage > maxPage) salesCurrentPage = maxPage;
  if (salesCurrentPage < 1) salesCurrentPage = 1;

  const startIndex = (salesCurrentPage - 1) * SALES_PAGE_SIZE;
  const pageSales = allSales.slice(startIndex, startIndex + SALES_PAGE_SIZE);

  if (infoEl) infoEl.textContent = `Showing ${startIndex + 1}-${Math.min(startIndex + SALES_PAGE_SIZE, totalCount)} of ${totalCount} sales`;
  if (pageNumEl) pageNumEl.textContent = `Page ${salesCurrentPage} of ${maxPage}`;
  if (btnPrev) btnPrev.disabled = salesCurrentPage <= 1;
  if (btnNext) btnNext.disabled = salesCurrentPage >= maxPage;

  pageSales.forEach(s => {
    const isVoid = s.status === 'VOIDED';
    const hasRx = s.prescription_path && s.prescription_path.trim() !== '';

    let rxCellHtml = '';
    if (hasRx) {
      rxCellHtml = `
        <div style="display:flex; gap:4px; align-items:center;">
          <span class="badge badge-success" style="font-size:0.7rem;">✓ Attached</span>
          <button class="btn btn-secondary" style="padding:2px 6px; font-size:0.75rem; color:var(--accent);" onclick="viewInvoicePrescription(${s.id})">👁️ View</button>
          <button class="btn btn-secondary" style="padding:2px 6px; font-size:0.75rem;" onclick="triggerAttachPrescription(${s.id})">🔄 Change</button>
        </div>
      `;
    } else {
      rxCellHtml = `
        <button class="btn btn-secondary" style="padding:2px 6px; font-size:0.75rem;" onclick="triggerAttachPrescription(${s.id})">📷 Attach Rx</button>
      `;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${s.invoice_no}</strong></td>
      <td>${new Date(s.created_at).toLocaleString()}</td>
      <td>${escapeHtml(s.cashier_name)}</td>
      <td>${escapeHtml(s.customer_name)}</td>
      <td>${s.payment_method}</td>
      <td><strong>${formatCurrency(s.total_cents)}</strong></td>
      <td>${isVoid ? '<span class="badge badge-danger">VOIDED</span>' : '<span class="badge badge-success">COMPLETED</span>'}</td>
      <td>${rxCellHtml}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-secondary" style="padding:2px 6px; font-size:0.75rem; margin-right:4px;" onclick="reprintSaleReceipt(${s.id})" title="Print Thermal Receipt">🖨️ Reprint</button>
        <button class="btn btn-primary" style="padding:2px 6px; font-size:0.75rem; margin-right:4px;" onclick="copySaleToCart(${s.id})" title="Load exact items into active POS cart">🛒 Re-order</button>
        ${!isVoid ? `<button class="btn btn-danger" style="padding:2px 6px; font-size:0.75rem;" onclick="openVoidModal(${s.id}, '${s.invoice_no}')">🚫 Void Sale</button>` : '<em>Voided</em>'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.reprintSaleReceipt = async function(saleId) {
  activePreviewSaleId = saleId;
  const saleRes = await window.api.get("SELECT * FROM sales WHERE id = ?;", [saleId]);
  if (!saleRes.success || !saleRes.data) {
    alert("Invoice details could not be retrieved.");
    return;
  }
  const sale = saleRes.data;

  const itemsRes = await window.api.query("SELECT * FROM sale_items WHERE sale_id = ?;", [saleId]);
  const rawItems = itemsRes.success && itemsRes.data ? itemsRes.data : [];

  const items = rawItems.map(i => ({
    product: { title: i.product_title },
    unitType: i.unit_type,
    priceCents: i.price_cents,
    quantity: i.quantity
  }));

  renderThermalReceipt({
    invoiceNo: sale.invoice_no,
    createdAt: sale.created_at,
    cashierName: sale.cashier_name,
    customerName: sale.customer_name,
    subtotalCents: sale.subtotal_cents,
    taxCents: sale.tax_cents,
    discountCents: sale.discount_cents,
    totalCents: sale.total_cents,
    paidCents: sale.paid_cents,
    changeCents: sale.change_cents,
    paymentMethod: sale.payment_method + (sale.status === 'VOIDED' ? ' [VOIDED]' : ''),
    prescriptionPath: sale.prescription_path,
    items: items
  });

  document.getElementById('modalReceiptPreview').classList.add('active');
};

window.copySaleToCart = async function(saleId) {
  if (!saleId) return;

  const saleRes = await window.api.get("SELECT * FROM sales WHERE id = ?;", [saleId]);
  if (!saleRes.success || !saleRes.data) {
    showToast("Invoice details could not be retrieved.", "error");
    return;
  }
  const sale = saleRes.data;

  const itemsRes = await window.api.query("SELECT * FROM sale_items WHERE sale_id = ?;", [saleId]);
  if (!itemsRes.success || !itemsRes.data || itemsRes.data.length === 0) {
    showToast("No items found in this invoice.", "error");
    return;
  }

  let addedCount = 0;
  let skippedCount = 0;

  for (const item of itemsRes.data) {
    const product = productsList.find(p => p.id === item.product_id);
    if (!product) {
      skippedCount++;
      continue;
    }

    const unitType = item.unit_type === 'PACK' ? 'PACK' : 'SINGLE';
    const priceCents = unitType === 'PACK' ? (product.sale_price_cents || 0) : (product.single_price_cents || 0);

    const existingIndex = cart.findIndex(ci => ci.product.id === product.id && ci.unitType === unitType);
    if (existingIndex > -1) {
      cart[existingIndex].quantity += item.quantity;
    } else {
      cart.push({
        product: product,
        unitType: unitType,
        quantity: item.quantity,
        priceCents: priceCents
      });
    }
    addedCount++;
  }

  if (sale.customer_id) {
    const custSelect = document.getElementById('cartCustomerSelect');
    if (custSelect) {
      custSelect.value = sale.customer_id;
      updateCartCustomerStatus();
    }
  }

  renderCart();
  const modal = document.getElementById('modalReceiptPreview');
  if (modal) modal.classList.remove('active');

  switchView('posView');

  if (addedCount > 0) {
    showToast(`Loaded ${addedCount} item(s) from Invoice #${sale.invoice_no} into cart!`);
  }
  if (skippedCount > 0) {
    showToast(`${skippedCount} item(s) skipped as they no longer exist in inventory.`, "error");
  }
};

window.triggerAttachPrescription = function(saleId) {
  activeRxSaleId = saleId;
  document.getElementById('invoiceRxFileInput').click();
};

window.viewInvoicePrescription = async function(saleId) {
  const res = await window.api.get("SELECT invoice_no, prescription_path FROM sales WHERE id = ?;", [saleId]);
  if (res.success && res.data && res.data.prescription_path) {
    const rxPath = res.data.prescription_path;
    const formattedUrl = rxPath.startsWith('http') || rxPath.startsWith('file://') ? rxPath : `file:///${rxPath.replace(/\\/g, '/')}`;
    
    document.getElementById('rxModalInvoiceTitle').textContent = `📷 Prescription Copy - Invoice #${res.data.invoice_no}`;
    document.getElementById('prescriptionImageElement').src = formattedUrl;
    document.getElementById('modalPrescriptionViewer').classList.add('active');
  } else {
    alert('No prescription image found for this invoice.');
  }
};

window.openVoidModal = function(saleId, invoiceNo) {
  document.getElementById('voidSaleId').value = saleId;
  document.getElementById('voidInvoiceNo').value = invoiceNo;
  document.getElementById('voidReasonInput').value = '';
  document.getElementById('modalVoidSale').classList.add('active');
};

async function performVoidSale(saleId, reason) {
  const saleRes = await window.api.get("SELECT * FROM sales WHERE id = ?;", [saleId]);
  if (!saleRes.success || !saleRes.data) return;
  const sale = saleRes.data;

  // Restore stock items back into products directly using unified pack & single tablet pool
  const itemsRes = await window.api.query("SELECT * FROM sale_items WHERE sale_id = ?;", [saleId]);
  if (itemsRes.success) {
    for (const item of itemsRes.data) {
      const prodRes = await window.api.get("SELECT pack_size, quantity_packs, quantity_singles FROM products WHERE id = ?;", [item.product_id]);
      if (prodRes.success && prodRes.data) {
        const packSize = Math.max(1, prodRes.data.pack_size || 1);
        const currentPacks = prodRes.data.quantity_packs || 0;
        const currentSingles = prodRes.data.quantity_singles || 0;

        const currentTotalUnits = (currentPacks * packSize) + currentSingles;
        const unitsToAdd = item.unit_type === 'PACK' ? (item.quantity * packSize) : item.quantity;
        const totalUnits = currentTotalUnits + unitsToAdd;

        const newPacks = Math.floor(totalUnits / packSize);
        const newSingles = totalUnits % packSize;

        await window.api.run(
          "UPDATE products SET quantity_packs = ?, quantity_singles = ? WHERE id = ?;",
          [newPacks, newSingles, item.product_id]
        );
      }
    }
  }

  // Update credit debt if purchase was on credit
  if (sale.payment_method === 'CREDIT') {
    const custRes = await window.api.get("SELECT current_debt_cents FROM customers WHERE id = ?;", [sale.customer_id]);
    if (custRes.success && custRes.data) {
      const newDebt = Math.max(0, custRes.data.current_debt_cents - sale.total_cents);
      await window.api.run("UPDATE customers SET current_debt_cents = ? WHERE id = ?;", [newDebt, sale.customer_id]);
      await window.api.run(
        `INSERT INTO customer_ledger (customer_id, sale_id, type, debit_cents, credit_cents, balance_after_cents, notes, created_at)
         VALUES (?, ?, 'ADJUSTMENT', 0, ?, ?, ?, ?);`,
        [sale.customer_id, saleId, sale.total_cents, newDebt, `VOID SALE INVOICE #${sale.invoice_no} (${reason})`, new Date().toISOString()]
      );
    }
  }

  // Mark sale as VOIDED
  await window.api.run("UPDATE sales SET status = 'VOIDED' WHERE id = ?;", [saleId]);

  // Insert audit log
  await window.api.run(
    "INSERT INTO void_sales (sale_id, user_id, user_name, reason, voided_at) VALUES (?, ?, ?, ?, ?);",
    [saleId, currentUser.id, currentUser.name, reason, new Date().toISOString()]
  );

  alert(`Invoice ${sale.invoice_no} voided successfully! Stock restored.`);
  await loadMasterData();
  renderSalesTable();
}

/* ==========================================================================
   MODULE I: SETTINGS & FACTORY RESET
   ========================================================================== */
function setupSettingsEvents() {
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('settingStoreName').value.trim();
    const phone = document.getElementById('settingStorePhone').value.trim();
    const address = document.getElementById('settingStoreAddress').value.trim();
    const ntn = document.getElementById('settingNtnFbr').value.trim();
    const disclaimer = document.getElementById('settingDisclaimer').value.trim();

    const sql = `
      UPDATE settings SET store_name = ?, store_phone = ?, store_address = ?, ntn_fbr_id = ?, receipt_disclaimer = ?
      WHERE id = 1;
    `;
    const res = await window.api.run(sql, [name, phone, address, ntn, disclaimer]);

    if (res.success) {
      alert('Pharmacy settings updated successfully!');
      await loadSettings();
    }
  });

  // DB Backup
  document.getElementById('btnBackupDb').addEventListener('click', async () => {
    const res = await window.api.backupDatabase();
    if (res.success) {
      alert(`Local Backup Created Successfully!\nSaved to: ${res.backupPath}`);
    } else {
      alert('Backup failed: ' + res.error);
    }
  });

  // DB Restore
  document.getElementById('btnRestoreDb').addEventListener('click', async () => {
    const res = await window.api.restoreDatabase();
    if (res.success) {
      alert(res.message);
      location.reload();
    }
  });

  // Factory Reset Confirmation Modal Triggers
  document.getElementById('btnOpenFactoryResetModal').addEventListener('click', () => {
    document.getElementById('resetConfirmInput').value = '';
    document.getElementById('modalFactoryResetConfirm').classList.add('active');
    setTimeout(() => {
      document.getElementById('resetConfirmInput').focus();
    }, 150);
  });

  document.getElementById('btnExecuteFactoryReset').addEventListener('click', async () => {
    const inputVal = document.getElementById('resetConfirmInput').value.trim().toUpperCase();
    if (inputVal !== 'RESET') {
      alert('Confirmation Mismatch! Please type "RESET" in capital letters to proceed.');
      return;
    }

    const res = await window.api.factoryReset();
    if (res.success) {
      alert(res.message);
      location.reload();
    } else {
      alert('Factory Reset failed: ' + res.error);
    }
  });
}

/* ==========================================================================
   UNIVERSAL EXTERNAL KEYBOARD SUPPORT & SHORTCUTS
   ========================================================================== */
function setupKeyboardShortcuts() {
  // 1. Universal Form Field Enter Key Navigation (Skip search input and textareas)

  // 2. Universal Form Field Enter Key Navigation (Skip search input and textareas)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') {
      // Skip pos search input and discount input custom enter listeners
      if (e.target.id === 'posSearchInput' || e.target.id === 'cartDiscountInput') {
        return;
      }

      const type = e.target.type;
      if (type !== 'submit' && type !== 'button' && type !== 'file') {
        const form = e.target.form;
        if (form) {
          e.preventDefault();
          const inputs = Array.from(form.querySelectorAll('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'));
          const index = inputs.indexOf(e.target);
          if (index > -1 && index < inputs.length - 1) {
            inputs[index + 1].focus();
          } else {
            // Last field -> submit form
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) {
              submitBtn.click();
            } else if (form.id === 'checkoutPaymentForm') {
              processCheckout();
            }
          }
        }
      }
    }
  });

  // 3. Global Function Keys & Navigation Shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F1' || e.key === 'F5') {
      e.preventDefault();
      switchView('posView');
      const searchInput = document.getElementById('posSearchInput');
      searchInput.focus();
    }
    if (e.key === 'F2') {
      e.preventDefault();
      const checkoutModal = document.getElementById('modalCheckoutPayment');
      if (checkoutModal.classList.contains('active')) {
        processCheckout();
      } else {
        openCheckoutModal();
      }
    }
    if (e.key === 'F3') {
      e.preventDefault();
      switchView('posView');
      const discountInput = document.getElementById('cartDiscountInput');
      discountInput.focus();
    }
    if (e.key === 'F4') {
      e.preventDefault();
      switchView('posView');
      const customerSelect = document.getElementById('cartCustomerSelect');
      customerSelect.focus();
    }
    if (e.key === 'F12') {
      e.preventDefault();
      document.getElementById('lockPinBtn').click();
    }
    if (e.key === 'Escape') {
      const activeModal = document.querySelector('.modal-overlay.active');
      if (activeModal && activeModal.id !== 'modalPinAuth') {
        activeModal.classList.remove('active');
      }
    }
  });

  // 4. Automatic Modal Focus Trapping on Modal Open
  const modalObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const target = mutation.target;
        if (target.classList.contains('modal-overlay') && target.classList.contains('active')) {
          setTimeout(() => {
            const firstInput = target.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), button:not(.modal-close)');
            if (firstInput) {
              firstInput.focus();
            }
          }, 80);
        }
      }
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modalObserver.observe(modal, { attributes: true });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}
