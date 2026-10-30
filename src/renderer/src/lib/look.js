import { Tablets, Pill, FlaskRound, Syringe, Droplets, Wind, SprayCan, Pipette, Bandage, PillBottle } from 'lucide-react';
import { isLowStock, isOutOfStock, expiryStatus } from './format.js';

/*
 * How a medicine looks in lists, so staff recognise it before reading it: an icon for its
 * form (read from the words in its name) in the tone of its category.
 */
const FORMS = [
  { pattern: /\b(tabs?|tablets?)\b/i, icon: Tablets },
  { pattern: /\b(caps?|capsules?)\b/i, icon: Pill },
  { pattern: /\b(syp|syrup|susp|suspension|elixir|solution|liquid|mixture)\b/i, icon: FlaskRound },
  { pattern: /\b(inj|injection|vial|ampoule|amp)\b/i, icon: Syringe },
  { pattern: /\b(drops?|eye|ear|nasal)\b/i, icon: Droplets },
  { pattern: /\b(inhaler|puffer|rotacaps?|nebuli[sz]er)\b/i, icon: Wind },
  { pattern: /\bspray\b/i, icon: SprayCan },
  { pattern: /\b(cream|ointment|oint|gel|lotion)\b/i, icon: Pipette },
  { pattern: /\b(bandage|plaster|gauze|dressing)\b/i, icon: Bandage }
];

export const medicineIcon = (title) => (FORMS.find((f) => f.pattern.test(title || '')) || { icon: PillBottle }).icon;

/** Tone 1-6 for a category; null (plain grey) when the medicine has none. */
export const categoryTone = (categoryId) => (categoryId ? ((Number(categoryId) - 1) % 6) + 1 : null);

/** Stock health as one word, for a coloured dot or meter. */
export function stockLevel(product) {
  if (expiryStatus(product.expiry_date).level === 'expired') return 'expired';
  if (isOutOfStock(product)) return 'out';
  return isLowStock(product) ? 'low' : 'ok';
}

export const STOCK_DOT = { ok: 'bg-teal', low: 'bg-amber', out: 'bg-red', expired: 'bg-red' };
