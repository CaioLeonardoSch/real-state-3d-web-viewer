import { AMENITIES, LISTING_STATUSES, LISTING_TYPES, type Amenity, type ListingStatus, type ListingType } from '../data/types.ts';
import { AREA_MAX_POINTS, EMPTY_CRITERIA, RELAXABLE_FIELDS, normalizeName, type FilterCriteria } from './filters.ts';
import { DEFAULT_SORT, SORT_KEYS, type SortKey } from './sort.ts';
import { SERVICE_KINDS, type ServiceKind } from '../data/services.ts';

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
  /** Known neighbourhood names (the URL may spell them without accents); absent = any name. */
  bairros?: readonly string[];
}

const SERVICE_SLUGS: Record<ServiceKind, string> = {
  school: 'escola',
  health: 'saude',
  pharmacy: 'farmacia',
  market: 'mercado',
  bakery: 'padaria',
  park: 'parque',
};
const SLUG_TO_SERVICE = new Map(SERVICE_KINDS.map((k) => [SERVICE_SLUGS[k], k] as const));

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
  penthouse: 'cobertura',
  studio: 'kitnet',
  farm: 'chacara',
  office: 'sala-comercial',
  store: 'loja',
  warehouse: 'galpao',
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
  for (const b of c.bairros) p.append('bairro', b);
  if (c.street) p.set('rua', c.street);
  for (const [field, param] of NUMBER_PARAMS) if (c[field] !== null) p.set(param, String(c[field]));
  if (c.statuses.length) p.set('situacao', c.statuses.map((s) => STATUS_SLUGS[s]).join(','));
  if (c.features.length) p.set('comodidades', c.features.map((f) => AMENITY_SLUGS[f]).join(','));
  if (c.agency !== null) p.set('imob', c.agency);
  if (c.reducedOnly) p.set('reduzido', '1');
  if (c.near.length) p.set('perto', c.near.map((k) => SERVICE_SLUGS[k]).join(','));
  if (c.area.length >= 3) p.set('area', formatArea(c.area));
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
    bairros: parseBairros(p.getAll('bairro'), known.bairros),
    street: parseStreet(p.get('rua')),
    statuses: parseList(p.get('situacao'), SLUG_TO_STATUS),
    features: parseList(p.get('comodidades'), SLUG_TO_AMENITY),
    agency: agency && known.agencyIds.has(agency) ? agency : null,
    reducedOnly: p.get('reduzido') === '1' ? true : null,
    near: parseList(p.get('perto'), SLUG_TO_SERVICE),
    area: parseArea(p.get('area')),
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

/** Neighbourhoods from the URL: known names (with their accents) when a list is given, at most 20, no repeats. */
function parseBairros(raw: string[], known?: readonly string[]): string[] {
  const byKey = known ? new Map(known.map((b) => [normalizeName(b), b])) : null;
  const out = raw
    .map((b) => b.trim().slice(0, 60))
    .filter(Boolean)
    .map((b) => (byKey ? byKey.get(normalizeName(b)) : b))
    .filter((b): b is string => !!b);
  return [...new Set(out)].slice(0, 20);
}

/**
 * Street from the URL: any text (it is compared with the listings' streets, and the street list is not loaded at
 * start-up), whitespace collapsed, at most 120 characters.
 */
function parseStreet(raw: string | null): string | null {
  return raw?.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 120).trim() || null;
}

/** A drawn area in the URL: "lon,lat;lon,lat;…", 5 decimals (about 1 m). */
export function formatArea(ring: readonly [number, number][]): string {
  const r = (v: number) => String(Math.round(v * 1e5) / 1e5);
  return ring.map(([x, y]) => `${r(x)},${r(y)}`).join(';');
}

/** A drawn area from the URL: 3 to AREA_MAX_POINTS valid corners, or none at all. */
export function parseArea(raw: string | null): [number, number][] {
  const pts = (raw ?? '')
    .split(';')
    .filter((s) => s.trim())
    .map((s) => s.split(',').map((v) => (v.trim() === '' ? NaN : Number(v))));
  const ok = pts.length >= 3 && pts.length <= AREA_MAX_POINTS && pts.every((p) => p.length === 2 && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
  return ok ? pts.map(([x, y]) => [x, y]) : [];
}

/** Equal criteria, ignoring the order of list values. */
export function sameCriteria(a: FilterCriteria, b: FilterCriteria): boolean {
  return RELAXABLE_FIELDS.every((f) => {
    const x = a[f];
    const y = b[f];
    return Array.isArray(x) && Array.isArray(y) ? [...x].sort().join() === [...y].sort().join() : x === y;
  });
}
