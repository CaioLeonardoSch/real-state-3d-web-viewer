import { LISTING_TYPES, type ListingType } from '../data/types';
import { EMPTY_CRITERIA, type FilterCriteria } from './filters';
import { DEFAULT_SORT, SORT_KEYS, type SortKey } from './sort';

/** What the address bar stores: applied filters and the open listing. */
export interface UrlState {
  criteria: FilterCriteria;
  listingId: string | null;
  sort: SortKey;
}

const SORT_SLUGS: Record<SortKey, string> = {
  'price-asc': 'menor-preco',
  'price-desc': 'maior-preco',
  'area-desc': 'maior-area',
};
const SLUG_TO_SORT = new Map(SORT_KEYS.map((k) => [SORT_SLUGS[k], k]));

/** Readable Portuguese slugs for listing types in the URL. */
const TYPE_SLUGS: Record<ListingType, string> = {
  apartment: 'apartamento',
  house: 'casa',
  semi_detached: 'geminado',
  land: 'terreno',
};
const SLUG_TO_TYPE = new Map(LISTING_TYPES.map((t) => [TYPE_SLUGS[t], t]));

export function stateToSearch(state: UrlState): string {
  const p = new URLSearchParams();
  const c = state.criteria;
  if (state.listingId) p.set('imovel', state.listingId);
  if (c.types.length) p.set('tipo', c.types.map((t) => TYPE_SLUGS[t]).join(','));
  if (c.priceMin !== null) p.set('precoMin', String(c.priceMin));
  if (c.priceMax !== null) p.set('precoMax', String(c.priceMax));
  if (c.bedroomsMin !== null) p.set('quartos', String(c.bedroomsMin));
  if (c.areaMin !== null) p.set('area', String(c.areaMin));
  if (c.agency !== null) p.set('imob', c.agency);
  if (state.sort !== DEFAULT_SORT) p.set('ordem', SORT_SLUGS[state.sort]);
  const s = p.toString();
  return s ? `?${s}` : '';
}

const nonNegative = (v: string | null): number | null => {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Parses the query string defensively: unknown types, agencies or listing ids and invalid
 * numbers are ignored rather than breaking the page.
 */
export function searchToState(search: string, known: { agencyIds: Set<string>; listingIds: Set<string> }): UrlState {
  const p = new URLSearchParams(search);
  const types = (p.get('tipo') ?? '')
    .split(',')
    .map((s) => SLUG_TO_TYPE.get(s.trim().toLowerCase()))
    .filter((t): t is ListingType => t !== undefined);
  const bedrooms = nonNegative(p.get('quartos'));
  const agency = p.get('imob');
  const listingId = p.get('imovel');
  return {
    criteria: {
      ...EMPTY_CRITERIA,
      types: [...new Set(types)],
      priceMin: nonNegative(p.get('precoMin')),
      priceMax: nonNegative(p.get('precoMax')),
      bedroomsMin: bedrooms === null ? null : Math.floor(bedrooms),
      areaMin: nonNegative(p.get('area')),
      agency: agency && known.agencyIds.has(agency) ? agency : null,
    },
    listingId: listingId && known.listingIds.has(listingId) ? listingId : null,
    sort: SLUG_TO_SORT.get(p.get('ordem') ?? '') ?? DEFAULT_SORT,
  };
}

export function sameCriteria(a: FilterCriteria, b: FilterCriteria): boolean {
  return (
    [...a.types].sort().join() === [...b.types].sort().join() &&
    a.priceMin === b.priceMin &&
    a.priceMax === b.priceMax &&
    a.bedroomsMin === b.bedroomsMin &&
    a.areaMin === b.areaMin &&
    a.agency === b.agency
  );
}
