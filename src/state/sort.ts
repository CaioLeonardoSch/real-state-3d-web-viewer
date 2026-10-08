import type { Listing } from '../data/types';
import { formatBRLCompact } from '../utils/format';

export const SORT_KEYS = ['price-asc', 'price-desc', 'area-desc', 'ppm2-asc'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const DEFAULT_SORT: SortKey = 'price-asc';

export const SORT_LABELS: Record<SortKey, string> = {
  'price-asc': 'Menor preço',
  'price-desc': 'Maior preço',
  'area-desc': 'Maior área',
  'ppm2-asc': 'Menor preço/m²',
};

/** Stable sort (ties keep the original order); returns a new array. */
export function sortListings(list: readonly Listing[], key: SortKey): Listing[] {
  const cmp: Record<SortKey, (a: Listing, b: Listing) => number> = {
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
    'area-desc': (a, b) => b.areaM2 - a.areaM2,
    'ppm2-asc': (a, b) => a.price / a.areaM2 - b.price / b.areaM2,
  };
  return [...list].sort(cmp[key]);
}

/** "R$ 505 mil – R$ 1,8 mi" (or a single value); null for an empty list. */
export function priceRangeLabel(list: readonly Listing[]): string | null {
  if (list.length === 0) return null;
  const prices = list.map((l) => l.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatBRLCompact(min) : `${formatBRLCompact(min)} – ${formatBRLCompact(max)}`;
}
