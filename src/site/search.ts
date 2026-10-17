// Search of a client's site: the map's criteria (src/state/filters.ts, neighbourhoods included) plus reference code
// and suites, with page and view. Kept in the address bar so any search can be shared or bookmarked.
import { AMENITY_LABELS, STATUS_LABELS, TYPE_LABELS, TYPE_PLURALS, type Listing } from '../data/types';
import { hasStreetType } from '../data/streets';
import { EMPTY_CRITERIA, cloneCriteria, filterListings, normalizeName, type FilterCriteria } from '../state/filters';
import { DEFAULT_SORT, sortListings, type SortKey } from '../state/sort';
import { searchToState, stateToSearch } from '../state/url';
import { formatArea, formatBRLCompact } from '../utils/format';
import type { SearchView } from './config';

export interface SiteSearch {
  criteria: FilterCriteria;
  /** Reference code (or part of it), case-insensitive. */
  code: string | null;
  suitesMin: number | null;
  sort: SortKey;
  /** 1-based. */
  page: number;
  view: SearchView;
}

export const emptySearch = (sort: SortKey = DEFAULT_SORT, view: SearchView = 'grade'): SiteSearch => ({
  criteria: cloneCriteria(EMPTY_CRITERIA),
  code: null,
  suitesMin: null,
  sort,
  page: 1,
  view,
});

export const bairroOf = (l: Listing) => l.address?.bairro ?? null;

export function matchesSite(l: Listing, s: SiteSearch): boolean {
  if (s.code && !normalizeName(l.referenceCode ?? l.id).includes(normalizeName(s.code))) return false;
  if (s.suitesMin !== null && (l.suites ?? 0) < s.suitesMin) return false;
  return true;
}

/** Matching listings, sorted (all pages). */
export function runSearch(listings: readonly Listing[], s: SiteSearch): Listing[] {
  const found = filterListings(listings, s.criteria).filter((l) => matchesSite(l, s));
  return sortListings(found, s.sort, s.criteria.transaction === 'rent');
}

export function pageOf<T>(list: readonly T[], page: number, perPage: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const p = Math.min(Math.max(1, page), pages);
  return { items: list.slice((p - 1) * perPage, p * perPage), page: p, pages };
}

// ------------------------------------------------------------------ URL

/** Query string of a search (without the page route), e.g. "negocio=alugar&bairro=Glória&pagina=2". */
export function searchToQuery(s: SiteSearch, defaults: { sort: SortKey; view: SearchView }): URLSearchParams {
  const p = new URLSearchParams(stateToSearch({ criteria: s.criteria, listingId: null, sort: s.sort }));
  // the map's default order is "menor preço"; the site has its own default
  p.delete('ordem');
  const ordem = new URLSearchParams(stateToSearch({ criteria: EMPTY_CRITERIA, listingId: null, sort: s.sort })).get('ordem');
  if (s.sort !== defaults.sort) p.set('ordem', ordem ?? 'menor-preco');
  if (s.code) p.set('codigo', s.code);
  if (s.suitesMin !== null) p.set('suites', String(s.suitesMin));
  if (s.page > 1) p.set('pagina', String(s.page));
  if (s.view !== defaults.view) p.set('vista', s.view);
  return p;
}

/** The search in an address. Neighbourhoods not in `knownBairros` (when given) are dropped. */
export function queryToSearch(query: string, defaults: { sort: SortKey; view: SearchView }, agencyIds: Set<string>, knownBairros?: readonly string[]): SiteSearch {
  const p = new URLSearchParams(query);
  const state = searchToState(query, { agencyIds, listingIds: new Set(), bairros: knownBairros });
  const n = (v: string | null) => {
    const x = Number(v);
    return v !== null && v !== '' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : null;
  };
  const view = p.get('vista');
  return {
    criteria: state.criteria,
    code: p.get('codigo')?.trim().slice(0, 30) || null,
    suitesMin: n(p.get('suites')),
    sort: p.has('ordem') ? state.sort : defaults.sort,
    page: Math.max(1, n(p.get('pagina')) ?? 1),
    view: view === 'grade' || view === 'lista' || view === 'mapa' ? view : defaults.view,
  };
}

// ------------------------------------------------------------------ chips and facets

export interface Chip {
  label: string;
  /** The search without this criterion. */
  without: SiteSearch;
}

const reset = (s: SiteSearch, patch: Partial<SiteSearch> = {}, criteria: Partial<FilterCriteria> = {}): SiteSearch => ({
  ...s,
  ...patch,
  criteria: { ...cloneCriteria(s.criteria), ...criteria },
  page: 1,
});

/** One removable chip per active criterion ("Apartamento ✕", "Até R$ 800 mil ✕"). */
export function chipsOf(s: SiteSearch): Chip[] {
  const c = s.criteria;
  const rent = c.transaction === 'rent';
  const money = (v: number) => (rent ? `R$ ${v.toLocaleString('pt-BR')}` : formatBRLCompact(v));
  const out: Chip[] = [];
  for (const t of c.types) out.push({ label: TYPE_LABELS[t], without: reset(s, {}, { types: c.types.filter((x) => x !== t) }) });
  for (const b of c.bairros) out.push({ label: b, without: reset(s, {}, { bairros: c.bairros.filter((x) => x !== b) }) });
  // "Rua XV de Novembro" reads as a street on its own; a name without its type gets one
  if (c.street) out.push({ label: hasStreetType(c.street) ? c.street : `Rua: ${c.street}`, without: reset(s, {}, { street: null }) });
  if (c.priceMin !== null) out.push({ label: `A partir de ${money(c.priceMin)}`, without: reset(s, {}, { priceMin: null }) });
  if (c.priceMax !== null) out.push({ label: `Até ${money(c.priceMax)}`, without: reset(s, {}, { priceMax: null }) });
  if (c.areaMin !== null) out.push({ label: `A partir de ${formatArea(c.areaMin)}`, without: reset(s, {}, { areaMin: null }) });
  if (c.areaMax !== null) out.push({ label: `Até ${formatArea(c.areaMax)}`, without: reset(s, {}, { areaMax: null }) });
  if (c.bedroomsMin !== null) out.push({ label: `${c.bedroomsMin}+ quartos`, without: reset(s, {}, { bedroomsMin: null }) });
  if (s.suitesMin !== null) out.push({ label: `${s.suitesMin}+ suítes`, without: reset(s, { suitesMin: null }) });
  if (c.bathroomsMin !== null) out.push({ label: `${c.bathroomsMin}+ banheiros`, without: reset(s, {}, { bathroomsMin: null }) });
  if (c.parkingMin !== null) out.push({ label: `${c.parkingMin}+ vagas`, without: reset(s, {}, { parkingMin: null }) });
  for (const st of c.statuses) out.push({ label: st === 'under_construction' ? 'Lançamentos' : STATUS_LABELS[st], without: reset(s, {}, { statuses: c.statuses.filter((x) => x !== st) }) });
  for (const f of c.features) out.push({ label: AMENITY_LABELS[f], without: reset(s, {}, { features: c.features.filter((x) => x !== f) }) });
  if (c.reducedOnly) out.push({ label: 'Baixou o preço', without: reset(s, {}, { reducedOnly: null }) });
  if (s.code) out.push({ label: `Código ${s.code}`, without: reset(s, { code: null }) });
  return out;
}

/** Neighbourhoods with listings in the current deal mode, most listings first. */
export function bairroCounts(listings: readonly Listing[], rent: boolean): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const l of filterListings(listings, { ...EMPTY_CRITERIA, transaction: rent ? 'rent' : null })) {
    const b = bairroOf(l);
    if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
}

/** Title of a results page: "34 apartamentos à venda em Glória". */
export function resultsTitle(count: number, s: SiteSearch): string {
  const rent = s.criteria.transaction === 'rent';
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const kind =
    s.criteria.types.length === 1
      ? plural(count, ...TYPE_PLURALS[s.criteria.types[0]])
      : plural(count, 'imóvel', 'imóveis');
  const launch = s.criteria.statuses.length === 1 && s.criteria.statuses[0] === 'under_construction' ? ' em lançamento' : '';
  const place = s.criteria.bairros.length === 1 ? ` em ${s.criteria.bairros[0]}` : '';
  const deal = rent ? ' para alugar' : ' à venda';
  if (count === 0) return `Nenhum imóvel encontrado${place}`;
  return `${count.toLocaleString('pt-BR')} ${kind}${launch}${deal}${place}`;
}
