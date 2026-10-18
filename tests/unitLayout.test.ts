import { describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import { floorBand, unitNumber, unitStrip, validLayout } from '../src/map/unitLayout';
import { validateListingsFile } from '../src/data/types';
import listingsFile from '../public/data/listings.json';

// a 40 m × 10 m rectangle in Joinville, long side west–east
const kx = 111_320 * Math.cos((-26.3 * Math.PI) / 180);
const ky = 110_540;
const rect: Polygon = {
  type: 'Polygon',
  coordinates: [[[-48.85, -26.3], [-48.85 + 40 / kx, -26.3], [-48.85 + 40 / kx, -26.3 + 10 / ky], [-48.85, -26.3 + 10 / ky], [-48.85, -26.3]]],
};
const xs = (p: Polygon) => p.coordinates[0].map((c) => (c[0] + 48.85) * kx);

describe('unit layout', () => {
  it('splits the footprint in equal strips along the long side', () => {
    const strips = [1, 2, 3, 4].map((i) => unitStrip(rect, i, 4) as Polygon);
    strips.forEach((s, i) => {
      expect(s.type).toBe('Polygon');
      // each strip is 10 m wide, plus the small pad around it
      expect(Math.min(...xs(s))).toBeCloseTo(i * 10, -0.2);
      expect(Math.max(...xs(s))).toBeCloseTo((i + 1) * 10, -0.2);
      const r = s.coordinates[0];
      expect(r[0]).toEqual(r[r.length - 1]);
    });
  });

  it('refuses positions outside the floor', () => {
    expect(unitStrip(rect, 0, 4)).toBeNull();
    expect(unitStrip(rect, 5, 4)).toBeNull();
    expect(unitStrip(rect, 1, 0)).toBeNull();
  });

  it('numbers units and finds their floor', () => {
    expect(unitNumber(7, 2)).toBe('702');
    expect(unitNumber(12, 10)).toBe('1210');
    expect(floorBand(1, 3)).toEqual({ base: 0, top: 2.7 });
    expect(floorBand(4, 3)).toEqual({ base: 9, top: 11.7 });
    expect(floorBand(0, 3).base).toBe(0);
  });

  it('validates layouts', () => {
    expect(validLayout({ floors: 10, unitsPerFloor: 4 })).toBe(true);
    expect(validLayout({ floors: 0, unitsPerFloor: 4 })).toBe(false);
    expect(validLayout({ floors: 10, unitsPerFloor: 13 })).toBe(false);
    expect(validLayout({ floors: 2.5, unitsPerFloor: 2 })).toBe(false);
    expect(validLayout(null)).toBe(false);
  });

  it('a listing position needs the units per floor', () => {
    const file = listingsFile as { listings: object[] };
    const ok = structuredClone(file);
    Object.assign(ok.listings[0], { unitPosition: 2, unitsPerFloor: 4 });
    expect(() => validateListingsFile(ok)).not.toThrow();
    const bad = structuredClone(file);
    Object.assign(bad.listings[0], { unitPosition: 5, unitsPerFloor: 4 });
    expect(() => validateListingsFile(bad)).toThrow(/unitPosition needs unitsPerFloor/);
    const alone = structuredClone(file);
    Object.assign(alone.listings[0], { unitPosition: 1 });
    expect(() => validateListingsFile(alone)).toThrow(/unitPosition/);
  });
});
