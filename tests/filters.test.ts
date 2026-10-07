import { describe, expect, it, vi } from 'vitest';
import type { Listing } from '../src/data/types';
import { EMPTY_CRITERIA, FilterStore, filterListings } from '../src/state/filters';

const base: Omit<Listing, 'id' | 'type' | 'price' | 'bedrooms' | 'areaM2' | 'agency'> = {
  title: 't',
  bathrooms: 1,
  parkingSpots: 1,
  status: 'ready',
  approximateLocation: false,
  fictional: true,
  description: 'd',
};
const L = (id: string, type: Listing['type'], price: number, bedrooms: number, areaM2: number, agency: string): Listing => ({
  ...base,
  id,
  type,
  price,
  bedrooms,
  areaM2,
  agency,
});
const data: Listing[] = [
  L('a', 'apartment', 600_000, 2, 70, 'A'),
  L('b', 'apartment', 900_000, 3, 110, 'B'),
  L('c', 'house', 1_200_000, 4, 220, 'A'),
  L('d', 'semi_detached', 550_000, 3, 120, 'B'),
  L('e', 'land', 400_000, 0, 360, 'A'),
];
const ids = (ls: Listing[]) => ls.map((l) => l.id);

describe('filterListings', () => {
  it('empty criteria returns everything', () => {
    expect(ids(filterListings(data, EMPTY_CRITERIA))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('filters by types (multi)', () => {
    expect(ids(filterListings(data, { ...EMPTY_CRITERIA, types: ['house', 'land'] }))).toEqual(['c', 'e']);
  });
  it('filters by price range (inclusive)', () => {
    expect(ids(filterListings(data, { ...EMPTY_CRITERIA, priceMin: 550_000, priceMax: 900_000 }))).toEqual(['a', 'b', 'd']);
  });
  it('filters by bedrooms, area and agency combined', () => {
    expect(ids(filterListings(data, { ...EMPTY_CRITERIA, bedroomsMin: 3, areaMin: 115, agency: 'B' }))).toEqual(['d']);
  });
});

describe('FilterStore', () => {
  it('pending changes do not affect applied criteria nor notify', () => {
    const s = new FilterStore();
    const fn = vi.fn();
    s.onApply(fn);
    s.setPending({ types: ['house'], priceMax: 1 });
    expect(s.getApplied()).toEqual(EMPTY_CRITERIA);
    expect(fn).not.toHaveBeenCalled();
    s.apply();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s.getApplied().types).toEqual(['house']);
  });
  it('clear resets both pending and applied', () => {
    const s = new FilterStore();
    s.setPending({ bedroomsMin: 3 });
    s.apply();
    s.clear();
    expect(s.getPending()).toEqual(EMPTY_CRITERIA);
    expect(s.getApplied()).toEqual(EMPTY_CRITERIA);
  });
  it('mutating returned objects does not leak into the store', () => {
    const s = new FilterStore();
    s.getPending().types.push('land');
    expect(s.getPending().types).toEqual([]);
  });
});
