import type { Listing, ListingType } from '../data/types';

export interface FilterCriteria {
  /** Empty = all types. */
  types: ListingType[];
  priceMin: number | null;
  priceMax: number | null;
  bedroomsMin: number | null;
  areaMin: number | null;
  /** null = any agency. */
  agency: string | null;
}

export const EMPTY_CRITERIA: FilterCriteria = Object.freeze({
  types: [],
  priceMin: null,
  priceMax: null,
  bedroomsMin: null,
  areaMin: null,
  agency: null,
}) as FilterCriteria;

export function matchesCriteria(l: Listing, c: FilterCriteria): boolean {
  if (c.types.length > 0 && !c.types.includes(l.type)) return false;
  if (c.priceMin !== null && l.price < c.priceMin) return false;
  if (c.priceMax !== null && l.price > c.priceMax) return false;
  if (c.bedroomsMin !== null && l.bedrooms < c.bedroomsMin) return false;
  if (c.areaMin !== null && l.areaM2 < c.areaMin) return false;
  if (c.agency !== null && l.agency !== c.agency) return false;
  return true;
}

export function filterListings(listings: readonly Listing[], c: FilterCriteria): Listing[] {
  return listings.filter((l) => matchesCriteria(l, c));
}

export function isEmptyCriteria(c: FilterCriteria): boolean {
  return (
    c.types.length === 0 &&
    c.priceMin === null &&
    c.priceMax === null &&
    c.bedroomsMin === null &&
    c.areaMin === null &&
    c.agency === null
  );
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

function cloneCriteria(c: FilterCriteria): FilterCriteria {
  return { ...c, types: [...c.types] };
}

export type RelaxableField = 'types' | 'priceMin' | 'priceMax' | 'bedroomsMin' | 'areaMin' | 'agency';

export interface RelaxSuggestion {
  field: RelaxableField;
  /** How many listings would match without this criterion. */
  count: number;
  /** Closest available value among those listings, e.g. the cheapest price when priceMax is too low. */
  closest: number | null;
}

const isActive = (c: FilterCriteria, f: RelaxableField) => (f === 'types' ? c.types.length > 0 : c[f] !== null);

export function withoutCriterion(c: FilterCriteria, f: RelaxableField): FilterCriteria {
  return { ...c, types: [...c.types], ...(f === 'types' ? { types: [] } : { [f]: null }) };
}

/**
 * For an empty search: which single criterion, if removed, brings results back — most results first.
 * Only criteria that actually help are returned.
 */
export function suggestRelaxations(listings: readonly Listing[], c: FilterCriteria): RelaxSuggestion[] {
  const fields: RelaxableField[] = ['types', 'priceMin', 'priceMax', 'bedroomsMin', 'areaMin', 'agency'];
  const out: RelaxSuggestion[] = [];
  for (const field of fields) {
    if (!isActive(c, field)) continue;
    const found = filterListings(listings, withoutCriterion(c, field));
    if (found.length === 0) continue;
    const values = (pick: (l: Listing) => number) => found.map(pick);
    const closest =
      field === 'priceMax'
        ? Math.min(...values((l) => l.price))
        : field === 'priceMin'
          ? Math.max(...values((l) => l.price))
          : field === 'areaMin'
            ? Math.max(...values((l) => l.areaM2))
            : field === 'bedroomsMin'
              ? Math.max(...values((l) => l.bedrooms))
              : null;
    out.push({ field, count: found.length, closest });
  }
  return out.sort((a, b) => b.count - a.count);
}
