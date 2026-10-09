import type { Amenity, Listing, ListingStatus, ListingType } from '../data/types';

export interface FilterCriteria {
  /** Empty = all types. */
  types: ListingType[];
  priceMin: number | null;
  priceMax: number | null;
  bedroomsMin: number | null;
  bathroomsMin: number | null;
  parkingMin: number | null;
  areaMin: number | null;
  areaMax: number | null;
  /** Upper bound of price ÷ area (R$/m²). */
  pricePerM2Max: number | null;
  /** Empty = any status. */
  statuses: ListingStatus[];
  /** Every listed amenity is required. */
  features: Amenity[];
  /** null = any agency. */
  agency: string | null;
  /** true = only listings whose price was reduced. */
  reducedOnly: true | null;
}

export const EMPTY_CRITERIA: FilterCriteria = Object.freeze({
  types: [],
  priceMin: null,
  priceMax: null,
  bedroomsMin: null,
  bathroomsMin: null,
  parkingMin: null,
  areaMin: null,
  areaMax: null,
  pricePerM2Max: null,
  statuses: [],
  features: [],
  agency: null,
  reducedOnly: null,
}) as FilterCriteria;

/** Criteria shown under "Mais filtros" (the form counts how many of them are active). */
export const ADVANCED_FIELDS = [
  'bathroomsMin',
  'parkingMin',
  'areaMax',
  'pricePerM2Max',
  'statuses',
  'features',
  'agency',
  'reducedOnly',
] as const satisfies readonly RelaxableField[];

export const pricePerM2 = (l: Listing) => l.price / l.areaM2;

export function matchesCriteria(l: Listing, c: FilterCriteria): boolean {
  if (c.types.length > 0 && !c.types.includes(l.type)) return false;
  if (c.priceMin !== null && l.price < c.priceMin) return false;
  if (c.priceMax !== null && l.price > c.priceMax) return false;
  if (c.bedroomsMin !== null && l.bedrooms < c.bedroomsMin) return false;
  if (c.bathroomsMin !== null && l.bathrooms < c.bathroomsMin) return false;
  if (c.parkingMin !== null && l.parkingSpots < c.parkingMin) return false;
  if (c.areaMin !== null && l.areaM2 < c.areaMin) return false;
  if (c.areaMax !== null && l.areaM2 > c.areaMax) return false;
  if (c.pricePerM2Max !== null && pricePerM2(l) > c.pricePerM2Max) return false;
  if (c.statuses.length > 0 && !c.statuses.includes(l.status)) return false;
  if (c.features.some((f) => !l.features.includes(f))) return false;
  if (c.agency !== null && l.agency !== c.agency) return false;
  if (c.reducedOnly && !(l.previousPrice && l.previousPrice > l.price)) return false;
  return true;
}

export function filterListings(listings: readonly Listing[], c: FilterCriteria): Listing[] {
  return listings.filter((l) => matchesCriteria(l, c));
}

export function isEmptyCriteria(c: FilterCriteria): boolean {
  return RELAXABLE_FIELDS.every((f) => !isActive(c, f));
}

/** Number of active criteria among `fields`. */
export function countActive(c: FilterCriteria, fields: readonly RelaxableField[]): number {
  return fields.filter((f) => isActive(c, f)).length;
}

/**
 * Holds the "pending" criteria (what the form shows) separately from the "applied" criteria
 * (what the map shows). Only `apply()` copies pending → applied and notifies listeners.
 */
export class FilterStore {
  private pending: FilterCriteria = cloneCriteria(EMPTY_CRITERIA);
  private applied: FilterCriteria = cloneCriteria(EMPTY_CRITERIA);
  private listeners = new Set<(applied: FilterCriteria) => void>();

  getPending(): FilterCriteria {
    return cloneCriteria(this.pending);
  }
  getApplied(): FilterCriteria {
    return cloneCriteria(this.applied);
  }
  /** Updates the pending criteria only. Does NOT notify listeners. */
  setPending(patch: Partial<FilterCriteria>): void {
    this.pending = cloneCriteria({ ...this.pending, ...patch });
  }
  apply(): FilterCriteria {
    this.applied = cloneCriteria(this.pending);
    this.listeners.forEach((fn) => fn(this.getApplied()));
    return this.getApplied();
  }
  /** Resets pending and applied criteria (explicit user action: "Limpar"). */
  clear(): void {
    this.pending = cloneCriteria(EMPTY_CRITERIA);
    this.apply();
  }
  onApply(fn: (applied: FilterCriteria) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export function cloneCriteria(c: FilterCriteria): FilterCriteria {
  return { ...c, types: [...c.types], statuses: [...c.statuses], features: [...c.features] };
}

export type RelaxableField = keyof FilterCriteria;
export const RELAXABLE_FIELDS: readonly RelaxableField[] = Object.keys(EMPTY_CRITERIA) as RelaxableField[];
const LIST_FIELDS = new Set<RelaxableField>(['types', 'statuses', 'features']);

export interface RelaxSuggestion {
  field: RelaxableField;
  /** How many listings would match without this criterion. */
  count: number;
  /** Closest available value among those listings, e.g. the cheapest price when priceMax is too low. */
  closest: number | null;
}

const isActive = (c: FilterCriteria, f: RelaxableField) =>
  LIST_FIELDS.has(f) ? (c[f] as unknown[]).length > 0 : c[f] !== null;

export function withoutCriterion(c: FilterCriteria, f: RelaxableField): FilterCriteria {
  return cloneCriteria({ ...c, [f]: LIST_FIELDS.has(f) ? [] : null });
}

/** Closest value among `found` for a numeric criterion (the one that would almost have matched). */
function closestValue(field: RelaxableField, found: Listing[]): number | null {
  const min = (pick: (l: Listing) => number) => Math.min(...found.map(pick));
  const max = (pick: (l: Listing) => number) => Math.max(...found.map(pick));
  switch (field) {
    case 'priceMax':
      return min((l) => l.price);
    case 'priceMin':
      return max((l) => l.price);
    case 'areaMin':
      return max((l) => l.areaM2);
    case 'areaMax':
      return min((l) => l.areaM2);
    case 'pricePerM2Max':
      return Math.round(min(pricePerM2));
    case 'bedroomsMin':
      return max((l) => l.bedrooms);
    case 'bathroomsMin':
      return max((l) => l.bathrooms);
    case 'parkingMin':
      return max((l) => l.parkingSpots);
    default:
      return null;
  }
}

/**
 * For an empty search: which single criterion, if removed, brings results back — most results first.
 * Only criteria that actually help are returned.
 */
export function suggestRelaxations(listings: readonly Listing[], c: FilterCriteria): RelaxSuggestion[] {
  const out: RelaxSuggestion[] = [];
  for (const field of RELAXABLE_FIELDS) {
    if (!isActive(c, field)) continue;
    const found = filterListings(listings, withoutCriterion(c, field));
    if (found.length === 0) continue;
    out.push({ field, count: found.length, closest: closestValue(field, found) });
  }
  return out.sort((a, b) => b.count - a.count);
}
