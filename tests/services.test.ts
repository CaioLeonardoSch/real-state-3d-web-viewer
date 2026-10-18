import { describe, expect, it } from 'vitest';
import published from '../public/data/servicos.json';
import { ServiceIndex, distanceM, formatDistance, listingPoint, nearbyDistances, type ServicesFile } from '../src/data/services';
import { EMPTY_CRITERIA, filterListings } from '../src/state/filters';
import type { Listing } from '../src/data/types';

const P: [number, number] = [-48.85, -26.3];
// ≈ 1 m in longitude / latitude at this latitude
const DX = 1 / (111_320 * Math.cos((26.3 * Math.PI) / 180));
const DY = 1 / 110_540;
const file: ServicesFile = {
  kinds: ['school', 'health', 'pharmacy', 'market', 'bakery', 'park'],
  items: [
    [0, P[0] + 300 * DX, P[1], 'Escola A'],
    [0, P[0] + 900 * DX, P[1], 'Escola B'],
    [3, P[0], P[1] + 1500 * DY],
    [5, P[0] - 2500 * DX, P[1]],
  ],
};
const listing = (over: Partial<Listing>): Listing =>
  ({ id: 'x', type: 'house', price: 1, bedrooms: 1, bathrooms: 1, parkingSpots: 0, areaM2: 50, agency: 'A', title: 't',
    status: 'ready', features: [], approximateLocation: false, fictional: true, description: '', ...over }) as Listing;
const square = (c: [number, number], m: number): Listing['footprint'] => ({
  type: 'Polygon',
  coordinates: [[
    [c[0] - m * DX, c[1] - m * DY], [c[0] + m * DX, c[1] - m * DY], [c[0] + m * DX, c[1] + m * DY],
    [c[0] - m * DX, c[1] + m * DY], [c[0] - m * DX, c[1] - m * DY],
  ]],
});

describe('services nearby', () => {
  const index = new ServiceIndex(file);
  it('measures straight-line distances in metres', () => {
    expect(distanceM(P, [P[0] + 300 * DX, P[1]])).toBeCloseTo(300, 0);
    expect(distanceM(P, [P[0], P[1] + 1500 * DY])).toBeCloseTo(1500, 0);
  });
  it('finds the closest of each kind within the radius, across grid cells', () => {
    const near = index.nearest(P, 2000);
    expect(near.school?.name).toBe('Escola A');
    expect(near.school?.distanceM).toBeCloseTo(300, 0);
    expect(near.market?.distanceM).toBeCloseTo(1500, 0);
    expect(near.park).toBeUndefined(); // 2,5 km
    expect(near.bakery).toBeUndefined();
    expect(Object.keys(index.nearest(P, 200))).toEqual([]);
  });
  it('measures a listing from its building, or from the circle when the address is hidden', () => {
    const exact = listing({ footprint: square(P, 10) });
    expect(listingPoint(exact)![0]).toBeCloseTo(P[0], 6);
    const hidden = listing({ approximateLocation: true, approxCenter: [P[0] + 900 * DX, P[1]], footprint: square(P, 10) });
    expect(nearbyDistances(index, hidden)).toEqual({ school: 0 });
    expect(listingPoint(listing({}))).toBeNull();
    expect(nearbyDistances(index, listing({}))).toEqual({});
  });
  it('the "perto de" filter keeps listings within 500 m of every kind asked', () => {
    const a = listing({ id: 'a', footprint: square(P, 10) });
    const b = listing({ id: 'b', footprint: square([P[0], P[1] + 1500 * DY], 10) });
    for (const l of [a, b]) l.nearby = nearbyDistances(index, l);
    expect(filterListings([a, b], { ...EMPTY_CRITERIA, near: ['school'] }).map((l) => l.id)).toEqual(['a']);
    expect(filterListings([a, b], { ...EMPTY_CRITERIA, near: ['market'] }).map((l) => l.id)).toEqual(['b']);
    expect(filterListings([a, b], { ...EMPTY_CRITERIA, near: ['school', 'market'] })).toEqual([]);
    // services not loaded yet: nothing matches rather than everything
    expect(filterListings([listing({ id: 'c' })], { ...EMPTY_CRITERIA, near: ['school'] })).toEqual([]);
  });
  it('formats distances', () => {
    expect(formatDistance(4)).toBe('10 m');
    expect(formatDistance(347)).toBe('350 m');
    expect(formatDistance(1234)).toBe('1,2 km');
  });
  it('the published servicos.json is well formed', () => {
    const real = published as unknown as ServicesFile;
    expect(real.items.length).toBeGreaterThan(100);
    for (const [k, lon, lat] of real.items) {
      expect(real.kinds[k]).toBeDefined();
      expect(lon).toBeGreaterThan(-49.3);
      expect(lon).toBeLessThan(-48.6);
      expect(lat).toBeGreaterThan(-26.6);
      expect(lat).toBeLessThan(-26.0);
    }
  });
});
