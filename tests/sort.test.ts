import { describe, expect, it } from 'vitest';
import type { Listing } from '../src/data/types';
import { priceRangeLabel, sortListings } from '../src/state/sort';
import { formatBRLCompact } from '../src/utils/format';

const L = (id: string, price: number, areaM2: number) => ({ id, price, areaM2 }) as Listing;
const data = [L('a', 900_000, 100), L('b', 505_000, 63), L('c', 1_795_000, 800), L('d', 505_000, 57)];

describe('sortListings', () => {
  it('sorts by price ascending, keeping ties stable', () => {
    expect(sortListings(data, 'price-asc').map((l) => l.id)).toEqual(['b', 'd', 'a', 'c']);
  });
  it('sorts by price descending and by area', () => {
    expect(sortListings(data, 'price-desc').map((l) => l.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortListings(data, 'area-desc').map((l) => l.id)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('does not mutate the input', () => {
    sortListings(data, 'price-desc');
    expect(data.map((l) => l.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('price summary', () => {
  it('formats compact BRL', () => {
    expect(formatBRLCompact(505_000)).toBe('R$ 505 mil');
    expect(formatBRLCompact(1_795_000)).toBe('R$ 1,8 mi');
    expect(formatBRLCompact(2_000_000)).toBe('R$ 2 mi');
  });
  it('builds a min–max label', () => {
    expect(priceRangeLabel(data)).toBe('R$ 505 mil – R$ 1,8 mi');
    expect(priceRangeLabel([data[0]])).toBe('R$ 900 mil');
    expect(priceRangeLabel([])).toBeNull();
  });
});
