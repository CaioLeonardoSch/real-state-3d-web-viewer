import { describe, expect, it, vi } from 'vitest';
import { priceReduction, type Listing } from '../src/data/types';
import {
  ADVANCED_FIELDS,
  EMPTY_CRITERIA,
  FilterStore,
  countActive,
  filterListings,
  isEmptyCriteria,
  suggestRelaxations,
} from '../src/state/filters';

const base: Omit<Listing, 'id' | 'type' | 'price' | 'bedrooms' | 'areaM2' | 'agency'> = {
  title: 't',
  bathrooms: 1,
  parkingSpots: 1,
  status: 'ready',
  features: [],
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

describe('advanced criteria', () => {
  const rich: Listing[] = [
    { ...L('p', 'apartment', 800_000, 3, 100, 'A'), bathrooms: 2, parkingSpots: 2, features: ['pool', 'gym'] },
    { ...L('q', 'house', 900_000, 3, 150, 'B'), bathrooms: 3, parkingSpots: 1, status: 'under_construction', features: ['pool'] },
    { ...L('r', 'semi_detached', 500_000, 2, 90, 'A'), features: [] },
  ];
  it('bathrooms and parking minimums', () => {
    expect(ids(filterListings(rich, { ...EMPTY_CRITERIA, bathroomsMin: 2, parkingMin: 2 }))).toEqual(['p']);
  });
  it('maximum area and price per m²', () => {
    expect(ids(filterListings(rich, { ...EMPTY_CRITERIA, areaMax: 100 }))).toEqual(['p', 'r']);
    // 8.000, 6.000 and 5.556 R$/m²
    expect(ids(filterListings(rich, { ...EMPTY_CRITERIA, pricePerM2Max: 6_000 }))).toEqual(['q', 'r']);
  });
  it('status and amenities (all selected amenities are required)', () => {
    expect(ids(filterListings(rich, { ...EMPTY_CRITERIA, statuses: ['under_construction'] }))).toEqual(['q']);
    expect(ids(filterListings(rich, { ...EMPTY_CRITERIA, features: ['pool'] }))).toEqual(['p', 'q']);
    expect(ids(filterListings(rich, { ...EMPTY_CRITERIA, features: ['pool', 'gym'] }))).toEqual(['p']);
  });
  it('isEmptyCriteria and countActive see the new fields', () => {
    expect(isEmptyCriteria({ ...EMPTY_CRITERIA, features: ['pets'] })).toBe(false);
    expect(countActive({ ...EMPTY_CRITERIA, statuses: ['ready'], parkingMin: 1, priceMax: 1 }, ADVANCED_FIELDS)).toBe(2);
  });
  it('suggests removing an amenity or the price per m² limit', () => {
    const c = { ...EMPTY_CRITERIA, features: ['gym' as const], pricePerM2Max: 7_000 };
    expect(suggestRelaxations(rich, c)).toEqual([
      { field: 'pricePerM2Max', count: 1, closest: 8_000 },
      { field: 'features', count: 2, closest: null },
    ].sort((a, b) => b.count - a.count));
  });
});

describe('reduced prices', () => {
  const ls: Listing[] = [
    { ...L('x', 'house', 900_000, 3, 150, 'A'), previousPrice: 1_000_000, priceReducedAt: '2026-09-10' },
    { ...L('y', 'house', 800_000, 3, 150, 'A') },
  ];
  it('"Preço reduzido" keeps only listings with a previous, higher price', () => {
    expect(ids(filterListings(ls, { ...EMPTY_CRITERIA, reducedOnly: true }))).toEqual(['x']);
    expect(countActive({ ...EMPTY_CRITERIA, reducedOnly: true }, ADVANCED_FIELDS)).toBe(1);
  });
  it('priceReduction gives the old price, the cut in % and the date', () => {
    expect(priceReduction(ls[0])).toEqual({ previous: 1_000_000, percent: 10, since: '2026-09-10' });
    expect(priceReduction(ls[1])).toBeNull();
    expect(priceReduction({ ...ls[1], previousPrice: 700_000 })).toBeNull(); // not a reduction
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

describe('suggestRelaxations', () => {
  // fixture: a apt 600k 2q 70m² A · b apt 900k 3q 110m² B · c house 1.2M 4q 220m² A · d semi 550k 3q 120m² B · e land 400k 0q 360m² A
  it('returns nothing when no criterion is active', () => {
    expect(suggestRelaxations(data, EMPTY_CRITERIA)).toEqual([]);
  });
  it('points to the blocking criterion with the closest available value', () => {
    // no land at or under 300k; dropping the type finds nothing either, dropping priceMax finds the 400k lot
    const c = { ...EMPTY_CRITERIA, types: ['land' as const], priceMax: 300_000 };
    expect(suggestRelaxations(data, c)).toEqual([{ field: 'priceMax', count: 1, closest: 400_000 }]);
  });
  it('orders by number of recovered listings', () => {
    // 4+ bedrooms up to 700k: without the bedroom filter a, d, e (max 3 bedrooms); without the price filter c (1.2M)
    const c = { ...EMPTY_CRITERIA, bedroomsMin: 4, priceMax: 700_000 };
    expect(suggestRelaxations(data, c)).toEqual([
      { field: 'bedroomsMin', count: 3, closest: 3 },
      { field: 'priceMax', count: 1, closest: 1_200_000 },
    ]);
  });
  it('omits criteria whose removal does not help', () => {
    const c = { ...EMPTY_CRITERIA, types: ['land' as const], agency: 'B', priceMax: 1 };
    expect(suggestRelaxations(data, c)).toEqual([]);
  });
});
