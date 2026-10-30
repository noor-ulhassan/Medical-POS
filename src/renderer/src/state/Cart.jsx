import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useApp } from './AppState.jsx';
import { useToast } from '../ui/Toast.jsx';
import { computeTotals, lineUnits, toCents, unitPriceCents, expiryStatus, shortDate, discountWithinLimit } from '../lib/format.js';

/**
 * The sale being built at the counter. Lives above the screens so it
 * survives navigation (e.g. "Sell again" from sales history) and locking.
 * Lines reference products by id; prices always come from current product data.
 */
export const WALK_IN_ID = 1;

const CartContext = createContext(null);

const noPriceMessage = (product, unitType) => {
  const by = unitType === 'PACK' ? 'pack' : 'unit';
  return `${product.title} has no price per ${by}, so it cannot be sold by the ${by}. Set the price under Stock, Medicines.`;
};

export function CartProvider({ children }) {
  const { settings, productById, can } = useApp();
  const { toast } = useToast();
  const [lines, setLines] = useState([]);
  const [customerId, setCustomerId] = useState(WALK_IN_ID);
  const [discountType, setDiscountType] = useState('FLAT');
  const [discountInput, setDiscountInput] = useState('0');
  const [prescriptionPath, setPrescriptionPath] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  // The discount box is shown on demand (Discount button or F3) so the till stays uncluttered.
  const [discountOpen, setDiscountOpen] = useState(false);
  const confirmPaymentRef = useRef(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const discount = useMemo(() => {
    if (discountType === 'PERCENT') return { type: 'PERCENT', value: Math.min(Math.max(Number(discountInput) || 0, 0), 100) };
    const cents = toCents(discountInput);
    return { type: 'FLAT', value: Number.isNaN(cents) || cents < 0 ? 0 : cents };
  }, [discountType, discountInput]);

  // Lines whose product disappeared (archived elsewhere) are dropped from view.
  const priced = useMemo(
    () =>
      lines
        .map((line) => {
          const product = productById(line.productId);
          return product ? { ...line, product, priceCents: unitPriceCents(product, line.unitType) } : null;
        })
        .filter(Boolean),
    [lines, productById]
  );

  const totals = useMemo(
    () => computeTotals({ lines: priced, discount, taxRatePercent: settings.tax_rate_percent, posFeeCents: settings.pos_fee_cents }),
    [priced, discount, settings.tax_rate_percent, settings.pos_fee_cents]
  );

  // Same rule as the main process: above this share of the bill a manager must complete the sale.
  const discountLimitPercent = settings.cashier_max_discount_percent;
  const discountNeedsManager = !can('sales.discountAnyAmount') && !discountWithinLimit(totals.discountCents, totals.subtotalCents, discountLimitPercent);

  const unitsInCart = (list, productId, override) =>
    list.reduce((sum, line, i) => {
      if (line.productId !== productId) return sum;
      const product = productById(productId);
      const unitType = override && override.index === i ? override.unitType : line.unitType;
      return sum + lineUnits(unitType, line.quantity, product ? product.pack_size : 1);
    }, 0);

  const fits = (product, units) => product.allow_negative_stock || units <= product.stock_units;

  /** Add to the cart, returning false (with a message) when stock is short. */
  const add = useCallback(
    (product, unitType = 'SINGLE', quantity = 1, { quiet = false } = {}) => {
      // Same rule as the main process: expired medicine is never sold.
      if (expiryStatus(product.expiry_date).level === 'expired') {
        if (!quiet) {
          toast(`${product.title} expired on ${shortDate(product.expiry_date)} and cannot be sold. Take it off the shelf.`, 'error');
        }
        return false;
      }
      // Nor is anything without a price (it would be given away).
      if (!(unitPriceCents(product, unitType) > 0)) {
        if (!quiet) toast(noPriceMessage(product, unitType), 'error');
        return false;
      }
      const current = linesRef.current;
      const needed = unitsInCart(current, product.id) + lineUnits(unitType, quantity, product.pack_size);
      if (!fits(product, needed)) {
        if (!quiet) toast(`Not enough stock for ${product.title}. ${Math.max(product.stock_units, 0)} units available.`, 'error');
        return false;
      }
      const next = [...current];
      const existing = next.findIndex((l) => l.productId === product.id && l.unitType === unitType);
      if (existing > -1) next[existing] = { ...next[existing], quantity: next[existing].quantity + quantity };
      else next.push({ productId: product.id, unitType, quantity });
      linesRef.current = next;
      setLines(next);
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productById, toast]
  );

  const changeQuantity = (index, delta) => {
    const line = lines[index];
    if (!line) return;
    const product = productById(line.productId);
    if (delta > 0 && product && !fits(product, unitsInCart(lines, product.id) + lineUnits(line.unitType, delta, product.pack_size))) {
      toast(`Not enough stock for ${product.title}`, 'error');
      return;
    }
    const next = lines.map((l, i) => (i === index ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0);
    setLines(next);
  };

  /** Set a line's quantity to a typed number. Returns false (with a message) when it is not allowed. */
  const setQuantity = (index, quantity) => {
    const line = lines[index];
    if (!line || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000) return false;
    if (quantity === line.quantity) return true;
    const product = productById(line.productId);
    const others = unitsInCart(lines, line.productId) - lineUnits(line.unitType, line.quantity, product ? product.pack_size : 1);
    if (product && !fits(product, others + lineUnits(line.unitType, quantity, product.pack_size))) {
      toast(`Not enough stock for ${product.title}. ${Math.max(product.stock_units, 0)} units available.`, 'error');
      return false;
    }
    setLines(lines.map((l, i) => (i === index ? { ...l, quantity } : l)));
    return true;
  };

  const setUnitType = (index, unitType) => {
    const line = lines[index];
    if (!line || line.unitType === unitType) return;
    const product = productById(line.productId);
    if (product && !(unitPriceCents(product, unitType) > 0)) {
      toast(noPriceMessage(product, unitType), 'error');
      return;
    }
    if (product && !fits(product, unitsInCart(lines, product.id, { index, unitType }))) {
      toast(`Not enough stock to sell ${product.title} by the ${unitType === 'PACK' ? 'pack' : 'unit'}`, 'error');
      return;
    }
    const duplicate = lines.findIndex((l, i) => i !== index && l.productId === line.productId && l.unitType === unitType);
    if (duplicate > -1) {
      setLines(lines.map((l, i) => (i === duplicate ? { ...l, quantity: l.quantity + line.quantity } : l)).filter((_, i) => i !== index));
    } else {
      setLines(lines.map((l, i) => (i === index ? { ...l, unitType } : l)));
    }
  };

  const remove = (index) => setLines(lines.filter((_, i) => i !== index));

  const clear = useCallback(() => {
    linesRef.current = [];
    setLines([]);
    setPrescriptionPath('');
    setDiscountInput('0');
    setDiscountType('FLAT');
    setDiscountOpen(false);
    setCustomerId(WALK_IN_ID);
  }, []);

  /** Replace the cart lines (resume a held sale / sell an old invoice again). */
  const load = useCallback(
    (newLines, newCustomerId) => {
      linesRef.current = [];
      setLines([]);
      let skipped = 0;
      for (const line of newLines) {
        const product = productById(line.productId);
        if (!product || !add(product, line.unitType, line.quantity, { quiet: true })) skipped++;
      }
      if (newCustomerId) setCustomerId(Number(newCustomerId));
      return { added: newLines.length - skipped, skipped };
    },
    [add, productById]
  );

  const restoreDiscount = useCallback((d) => {
    if (!d) return;
    setDiscountType(d.type);
    setDiscountInput(d.type === 'FLAT' ? ((d.value || 0) / 100).toFixed(2) : String(d.value));
  }, []);

  const value = {
    lines,
    priced,
    /** The lines to send to the main process: only those still shown (a product removed elsewhere drops out). */
    saleLines: priced.map(({ productId, unitType, quantity }) => ({ productId, unitType, quantity })),
    totals,
    discountLimitPercent,
    discountNeedsManager,
    customerId,
    setCustomerId,
    discount,
    discountType,
    setDiscountType,
    discountInput,
    setDiscountInput,
    discountOpen,
    setDiscountOpen,
    prescriptionPath,
    setPrescriptionPath,
    paymentOpen,
    setPaymentOpen,
    confirmPaymentRef,
    add,
    changeQuantity,
    setQuantity,
    setUnitType,
    remove,
    clear,
    load,
    restoreDiscount,
    itemCount: priced.length
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  return useContext(CartContext);
}
