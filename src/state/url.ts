import { AMENITIES, LISTING_STATUSES, LISTING_TYPES, type Amenity, type ListingStatus, type ListingType } from '../data/types';
import { EMPTY_CRITERIA, RELAXABLE_FIELDS, type FilterCriteria } from './filters';
import { DEFAULT_SORT, SORT_KEYS, type SortKey } from './sort';

/** What the address bar stores: applied filters and the open listing. */
export interface UrlState {
  criteria: FilterCriteria;
  listingId: string | null;
  sort: SortKey;
  /** Open development ("espelho de vendas") and its selected unit. */
  developmentId?: string | null;
  unitId?: string | null;
}

/** Ids the URL may refer to; anything else is dropped. */
export interface KnownIds {
  agencyIds: Set<string>;
  listingIds: Set<string>;
  /** Development id → its unit ids. */
  developments?: Map<string, Set<string>>;
}

const SORT_SLUGS: Record<SortKey, string> = {
  'price-asc': 'menor-preco',
  'price-desc': 'maior-preco',
  'area-desc': 'maior-area',
  'ppm2-asc': 'menor-preco-m2',
  relevance: 'destaques',
  recent: 'recentes',
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

const STATUS_SLUGS: Record<ListingStatus, string> = {
  ready: 'pronto',
  under_construction: 'em-construcao',
};
const SLUG_TO_STATUS = new Map(LISTING_STATUSES.map((s) => [STATUS_SLUGS[s], s]));

const AMENITY_SLUGS: Record<Amenity, string> = {
  pool: 'piscina',
  barbecue: 'churrasqueira',
  balcony: 'sacada',
  elevator: 'elevador',
  gym: 'academia',
  pets: 'pets',
  furnished: 'mobiliado',
  financing: 'financiamento',
  exchange: 'permuta',
};
const SLUG_TO_AMENITY = new Map(AMENITIES.map((a) => [AMENITY_SLUGS[a], a]));

/** Numeric criteria and their query-string names. */
const NUMBER_PARAMS = [
  ['priceMin', 'precoMin'],
  ['priceMax', 'precoMax'],
  ['bedroomsMin', 'quartos'],
  ['bathroomsMin', 'banheiros'],
  ['parkingMin', 'vagas'],
  ['areaMin', 'area'],
  ['areaMax', 'areaMax'],
  ['pricePerM2Max', 'm2Max'],
] as const;
/** Counts are whole numbers. */
const INTEGER_FIELDS = new Set(['bedroomsMin', 'bathroomsMin', 'parkingMin']);

/** "a,b,b,x" → known values, without duplicates. */
function parseList<T>(raw: string | null, map: Map<string, T>): T[] {
  const out = (raw ?? '')
    .split(',')
    .map((s) => map.get(s.trim().toLowerCase()))
    .filter((v): v is T => v !== undefined);
  return [...new Set(out)];
}

export function stateToSearch(state: UrlState): string {
  const p = new URLSearchParams();
  const c = state.criteria;
  if (c.transaction === 'rent') p.set('negocio', 'alugar');
  if (state.listingId) p.set('imovel', state.listingId);
  if (state.developmentId) {
    p.set('empreendimento', state.developmentId);
    if (state.unitId) p.set('unidade', state.unitId.slice(state.developmentId.length + 1));
  }
  if (c.types.length) p.set('tipo', c.types.map((t) => TYPE_SLUGS[t]).join(','));
  for (const [field, param] of NUMBER_PARAMS) if (c[field] !== null) p.set(param, String(c[field]));
  if (c.statuses.length) p.set('situacao', c.statuses.map((s) => STATUS_SLUGS[s]).join(','));
  if (c.features.length) p.set('comodidades', c.features.map((f) => AMENITY_SLUGS[f]).join(','));
  if (c.agency !== null) p.set('imob', c.agency);
  if (c.reducedOnly) p.set('reduzido', '1');
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
export function searchToState(search: string, known: KnownIds): UrlState {
  const p = new URLSearchParams(search);
  const agency = p.get('imob');
  const listingId = p.get('imovel');
  const criteria: FilterCriteria = {
    ...EMPTY_CRITERIA,
    transaction: p.get('negocio') === 'alugar' ? 'rent' : null,
    types: parseList(p.get('tipo'), SLUG_TO_TYPE),
    statuses: parseList(p.get('situacao'), SLUG_TO_STATUS),
    features: parseList(p.get('comodidades'), SLUG_TO_AMENITY),
    agency: agency && known.agencyIds.has(agency) ? agency : null,
    reducedOnly: p.get('reduzido') === '1' ? true : null,
  };
  for (const [field, param] of NUMBER_PARAMS) {
    const n = nonNegative(p.get(param));
    criteria[field] = n !== null && INTEGER_FIELDS.has(field) ? Math.floor(n) : n;
  }
  const dev = p.get('empreendimento');
  const units = dev ? known.developments?.get(dev) : undefined;
  // units appear in the URL by number ("1502"); ids are "<development>-<number>"
  const unitId = units && p.get('unidade') ? `${dev}-${p.get('unidade')}` : null;
  return {
    criteria,
    listingId: listingId && known.listingIds.has(listingId) ? listingId : null,
    sort: SLUG_TO_SORT.get(p.get('ordem') ?? '') ?? DEFAULT_SORT,
    developmentId: units ? dev : null,
    unitId: unitId && units!.has(unitId) ? unitId : null,
  };
}

/** Equal criteria, ignoring the order of list values. */
export function sameCriteria(a: FilterCriteria, b: FilterCriteria): boolean {
  return RELAXABLE_FIELDS.every((f) => {
    const x = a[f];
    const y = b[f];
    return Array.isArray(x) && Array.isArray(y) ? [...x].sort().join() === [...y].sort().join() : x === y;
  });
}
