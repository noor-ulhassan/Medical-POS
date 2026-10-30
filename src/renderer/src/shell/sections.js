import {
  ShoppingCart,
  ReceiptText,
  FileText,
  Package,
  Pill,
  CalendarClock,
  Truck,
  Building2,
  NotebookPen,
  ChartColumn,
  Sun,
  TrendingUp,
  Wallet,
  Settings
} from 'lucide-react';

/*
 * Five sections instead of a long menu, like the POS apps people already know.
 * A section with several screens shows them as tabs at the top (SectionTabs).
 * Screens keep their ids (posView, salesView...), so `go(id)` works as before.
 * Each section wears one tone (index.css), so staff can tell at a glance where they are.
 */
export const SECTIONS = [
  { id: 'sell', label: 'Sell', icon: ShoppingCart, tone: 1, views: [{ id: 'posView', label: 'Sell', icon: ShoppingCart }] },
  {
    id: 'sales',
    label: 'Sales',
    icon: ReceiptText,
    tone: 2,
    views: [
      { id: 'salesView', label: 'Past sales', icon: ReceiptText },
      { id: 'quotationView', label: 'Price quote', icon: FileText }
    ]
  },
  {
    id: 'stock',
    label: 'Stock',
    icon: Package,
    tone: 3,
    views: [
      { id: 'inventoryView', label: 'Medicines', icon: Pill, badge: 'lowStock' },
      { id: 'expiryView', label: 'Expiring', icon: CalendarClock, badge: 'expiring' },
      { id: 'ordersView', label: 'Reorder', icon: Truck },
      { id: 'suppliersView', label: 'Suppliers', icon: Building2 }
    ]
  },
  { id: 'khata', label: 'Khata', icon: NotebookPen, tone: 4, views: [{ id: 'khataView', label: 'Khata', icon: NotebookPen }] },
  {
    id: 'reports',
    label: 'Reports',
    icon: ChartColumn,
    tone: 5,
    views: [
      { id: 'dashboardView', label: 'Today', icon: Sun },
      { id: 'profitView', label: 'Profit & loss', icon: TrendingUp },
      { id: 'expensesView', label: 'Expenses', icon: Wallet }
    ]
  },
  { id: 'settings', label: 'Settings', icon: Settings, tone: 6, views: [{ id: 'settingsView', label: 'Settings', icon: Settings }] }
];

/** The section a screen belongs to. */
export const sectionOfView = (viewId) => SECTIONS.find((s) => s.views.some((v) => v.id === viewId)) || SECTIONS[0];

/** A screen's label and icon. */
export const viewMeta = (viewId) => sectionOfView(viewId).views.find((v) => v.id === viewId) || SECTIONS[0].views[0];
