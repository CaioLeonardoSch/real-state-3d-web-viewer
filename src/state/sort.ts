import { HIGHLIGHTS, priceIn, type Listing } from '../data/types';
import { formatBRL, formatBRLCompact } from '../utils/format';

export const SORT_KEYS = ['price-asc', 'price-desc', 'area-desc', 'ppm2-asc', 'relevance', 'recent'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const DEFAULT_SORT: SortKey = 'price-asc';

export const SORT_LABELS: Record<SortKey, string> = {
  'price-asc': 'Menor preço',
  'price-desc': 'Maior preço',
  'area-desc': 'Maior área',
  'ppm2-asc': 'Menor preço/m²',
  relevance: 'Destaques primeiro',
  recent: 'Mais recentes',
};

const highlightRank = (l: Listing) => HIGHLIGHTS.indexOf(l.highlight ?? 'standard');
const lastUpdate = (l: Listing) => l.updatedAt ?? l.publishedAt ?? '';

/** Stable sort (ties keep the original order); returns a new array. `rent`: compare monthly rents. */
export function sortListings(list: readonly Listing[], key: SortKey, rent = false): Listing[] {
  const p = (l: Listing) => priceIn(l, rent) ?? l.price;
  const cmp: Record<SortKey, (a: Listing, b: Listing) => number> = {
    'price-asc': (a, b) => p(a) - p(b),
    'price-desc': (a, b) => p(b) - p(a),
    'area-desc': (a, b) => b.areaM2 - a.areaM2,
    'ppm2-asc': (a, b) => p(a) / a.areaM2 - p(b) / b.areaM2,
    // paid highlights first (super, then featured), most recently updated within each
    relevance: (a, b) => highlightRank(b) - highlightRank(a) || lastUpdate(b).localeCompare(lastUpdate(a)),
    recent: (a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
  };
  return [...list].sort(cmp[key]);
}

/** "R$ 505 mil – R$ 1,8 mi" (or a single value); null for an empty list. */
export function priceRangeLabel(list: readonly Listing[], rent = false): string | null {
  if (list.length === 0) return null;
  const prices = list.map((l) => priceIn(l, rent) ?? l.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const f = rent ? formatBRL : formatBRLCompact;
  const label = min === max ? f(min) : `${f(min)} – ${f(max)}`;
  return rent ? `${label}/mês` : label;
}
