import { describe, expect, it } from 'vitest';
import { collapse, findDuplicates, sameProperty } from '../src/data/dedup';
import type { Listing } from '../src/data/types';

const L = (id: string, agency: string, extra: Partial<Listing> = {}): Listing => ({
  id,
  agency,
  type: 'apartment',
  title: 't',
  price: 500_000,
  areaM2: 80,
  bedrooms: 2,
  bathrooms: 1,
  parkingSpots: 1,
  status: 'ready',
  features: [],
  approximateLocation: false,
  description: 'd',
  buildingOsmId: 'way/1',
  ...extra,
});

describe('duplicate listings (item 50)', () => {
  it('same building and unit from two agencies is certain; another unit is not', () => {
    const a = L('a', 'x', { unitFloor: 7, unitPosition: 1 });
    expect(sameProperty(a, L('b', 'y', { unitFloor: 7, unitPosition: 1, price: 650_000 }))).toBe('certain');
    expect(sameProperty(a, L('c', 'y', { unitFloor: 7, unitPosition: 2 }))).toBeNull();
    // the same agency's two listings are its own business
    expect(sameProperty(a, L('d', 'x', { unitFloor: 7, unitPosition: 1 }))).toBeNull();
    expect(sameProperty(L('h1', 'x', { type: 'house' }), L('h2', 'y', { type: 'house', price: 900_000 }))).toBe('certain');
  });

  it('unit missing: probable only with the same features and close area and price', () => {
    const a = L('a', 'x');
    expect(sameProperty(a, L('b', 'y', { areaM2: 82, price: 540_000 }))).toBe('probable');
    expect(sameProperty(a, L('c', 'y', { bedrooms: 3 }))).toBeNull();
    expect(sameProperty(a, L('d', 'y', { areaM2: 95 }))).toBeNull();
    expect(sameProperty(a, L('e', 'y', { price: 700_000 }))).toBeNull();
    expect(sameProperty(a, L('f', 'y', { transaction: 'rent', rentPrice: 3000 }))).toBeNull();
    expect(sameProperty(a, L('g', 'y', { buildingOsmId: 'way/2' }))).toBeNull();
  });

  it('one pin per property: the most complete listing first, exclusive above all', () => {
    const photos = [{ src: 'p.jpg' }, { src: 'q.jpg' }];
    const list = [L('a', 'x', { unitFloor: 3, unitPosition: 2 }), L('b', 'y', { unitFloor: 3, unitPosition: 2, photos }), L('c', 'z')];
    const d = findDuplicates(list);
    const g = d.groupOf.get('a')!;
    expect(g.primary).toBe('b');
    expect(g.members).toEqual(['b', 'a', 'c']);
    expect(g.certain).toBe(false);
    expect([...d.hidden].sort()).toEqual(['a', 'c']);
    // a search that matches only a hidden listing still shows the property, once
    expect(collapse([list[0], list[2]], list, d).map((l) => l.id)).toEqual(['b']);

    const excl = findDuplicates([...list.slice(0, 2), L('e', 'z', { unitFloor: 3, unitPosition: 2, exclusive: true })]);
    expect(excl.groupOf.get('a')).toMatchObject({ primary: 'e', exclusive: true, certain: true });
  });

  it('a probable link never joins two different known units', () => {
    const list = [L('a', 'x', { unitFloor: 7, unitPosition: 1 }), L('b', 'y'), L('c', 'z', { unitFloor: 7, unitPosition: 2 })];
    const d = findDuplicates(list);
    expect(d.groupOf.get('a')?.members.includes('c')).not.toBe(true);
    expect(d.hidden.size).toBe(1);
    // drafts and listings without a building are left alone
    expect(findDuplicates([L('a', 'x', { draft: true }), L('b', 'y')]).hidden.size).toBe(0);
    expect(findDuplicates([L('a', 'x', { buildingOsmId: undefined }), L('b', 'y', { buildingOsmId: undefined })]).hidden.size).toBe(0);
  });
});
