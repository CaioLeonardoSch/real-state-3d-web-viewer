import { describe, expect, it } from 'vitest';
import { formatHours, sunTable, walls, type SunBuilding } from '../src/map/sunHours';

const O: [number, number] = [-48.85, -26.3];
const kx = 111_320 * Math.cos((26.3 * Math.PI) / 180);
// rectangle in metres east/north of O → [lon, lat]
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] =>
  ([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]] as [number, number][]).map(([x, y]) => [O[0] + x / kx, O[1] + y / 110_540]);
const home = rect(-10, -10, 10, 10);
const side = (t: ReturnType<typeof sunTable>, s: string) => t.find((r) => r.side === s)!;

describe('sun on each side of a building', () => {
  it('finds the four sides with outward normals, whatever the ring direction', () => {
    const pts = ([[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]] as [number, number][]);
    expect(walls(pts).map((w) => [w.side, Math.round(w.normal)])).toEqual([['N', 0], ['L', 90], ['S', 180], ['O', 270]]);
    expect(walls([...pts].reverse()).map((w) => w.side)).toEqual(['N', 'L', 'S', 'O']);
  });
  it('in Joinville the north side has sun all winter day and the south side none', () => {
    const t = sunTable(home, 0, []);
    expect(side(t, 'N').winter).toBeGreaterThan(9);
    expect(side(t, 'S').winter).toBe(0);
    // in summer the sun rises south of east: the south side gets the early morning and late afternoon
    expect(side(t, 'S').summer).toBeGreaterThan(3);
    expect(side(t, 'L').winter + side(t, 'O').winter).toBeGreaterThan(9);
  });
  it('a tower in front takes the sun from the lower floors, not from those above it', () => {
    const tower: SunBuilding = { ring: rect(-30, 20, 30, 40), height: 45 };
    const low = side(sunTable(home, 1, [tower]), 'N').winter;
    const high = side(sunTable(home, 16, [tower]), 'N').winter;
    const free = side(sunTable(home, 1, []), 'N').winter;
    expect(low).toBeLessThan(free - 3);
    expect(high).toBeCloseTo(free, 0);
  });
  it('leaves the building itself out of the obstacles', () => {
    const self: SunBuilding = { ring: home, height: 60 };
    expect(side(sunTable(home, 0, [self]), 'N').winter).toBeGreaterThan(9);
  });
  it('formats hours', () => {
    expect(formatHours(0)).toBe('sem sol direto');
    expect(formatHours(0.4)).toBe('menos de 1 h');
    expect(formatHours(4.33)).toBe('4,5 h');
    expect(formatHours(7)).toBe('7 h');
  });
});
