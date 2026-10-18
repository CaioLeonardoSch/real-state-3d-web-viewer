import { describe, expect, it } from 'vitest';
import { allUnits, validateDevelopmentsFile, type Development } from '../src/data/developments';
import { isLit, windowQuads } from '../src/map/heroWindows';
import raw from '../public/data/developments.json';

const devs = validateDevelopmentsFile(structuredClone(raw)).developments;
const lh = devs.find((d) => d.id === 'landhaus')!;

/** Two 6 m × 4 m units side by side (they share the wall at x = 6 m). */
function twoUnits(): Development {
  const m = (x: number, y: number) => [x / 100_000, y / 110_540];
  const box = (x0: number, x1: number) => ({ type: 'Polygon' as const, coordinates: [[m(x0, 0), m(x1, 0), m(x1, 4), m(x0, 4), m(x0, 0)]] });
  const unit = (id: string, shape: number) => ({ id, number: id, final: shape + 1, plan: 'A', areaM2: 24, bedrooms: 1, suites: 0, parkingSpots: 0, shape, cells: 1, price: 1, status: 'available' as const });
  return {
    ...lh,
    center: [0, 0],
    shapes: [{ polygon: box(0, 6), facing: 180 }, { polygon: box(6, 12), facing: 180 }],
    levels: [{ level: 1, use: 'residential', base: 0, top: 3, units: [unit('101', 0), unit('102', 1)] }],
    progress: undefined,
  };
}

describe('janelas do prédio aberto (item 48)', () => {
  it('põe janelas só nas paredes de fachada, uma a cada 3 m, entre o peitoril e a verga', () => {
    // the origin is lng/lat 0 (cos 0 = 1, so 1 m east = 1/111 320°)
    const quads = windowQuads(twoUnits(), [0, 0]);
    // each unit: 2 long walls of 6 m (2 windows each) + 1 outer side of 4 m (1 window); the shared wall has none
    expect(quads.filter((q) => q.unitId === '101')).toHaveLength(5);
    expect(quads.filter((q) => q.unitId === '102')).toHaveLength(5);
    for (const q of quads) {
      expect(q.corners[0][2]).toBeCloseTo(0.9);
      expect(q.corners[2][2]).toBeCloseTo(2.45);
      // never on the shared wall (x ≈ 6 m, scaled by the longitude factor)
      const xs = q.corners.map((c) => c[0] / (111_320 / 100_000));
      expect(xs.every((x) => Math.abs(x - 6) < 0.2)).toBe(false);
    }
    // the glass is just outside the wall: the south wall's windows sit at y < 0
    const south = quads.filter((q) => q.corners.every((c) => c[1] < 1));
    expect(south.length).toBe(4);
    expect(south.every((q) => q.corners.every((c) => c[1] < 0 && c[1] > -0.2))).toBe(true);
  });

  it('pula unidades translúcidas e andares ainda não construídos', () => {
    expect(windowQuads(twoUnits(), [0, 0], { skip: (u) => u.id === '102' }).every((q) => q.unitId === '101')).toBe(true);
    expect(windowQuads(twoUnits(), [0, 0], { builtTop: 2 })).toEqual([]);
  });

  it('o espelho de demonstração ganha janelas em todas as unidades', () => {
    const quads = windowQuads(lh, lh.center);
    const withWindows = new Set(quads.map((q) => q.unitId));
    expect(withWindows.size).toBe(allUnits(lh).length);
  });

  it('acende à noite as unidades ocupadas e a escolhida', () => {
    const [u] = twoUnits().levels[0].units;
    expect(isLit(u, null)).toBe(false);
    expect(isLit(u, '101')).toBe(true);
    expect(isLit({ ...u, status: 'sold' }, null)).toBe(true);
    expect(isLit({ ...u, status: 'reserved' }, null)).toBe(true);
  });
});
