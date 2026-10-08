import { describe, expect, it } from 'vitest';
import turfBooleanIntersects from '@turf/boolean-intersects';
import { allUnits, countByStatus, facingInfo, validateDevelopmentsFile } from '../src/data/developments';
import raw from '../public/data/developments.json';

const file = validateDevelopmentsFile(raw);
const byId = new Map(file.developments.map((d) => [d.id, d]));

describe('facingInfo (southern hemisphere)', () => {
  it('maps bearings to directions and sun', () => {
    expect(facingInfo(0)).toEqual({ direction: 'Norte', sun: 'sol durante boa parte do dia' });
    expect(facingInfo(90).sun).toBe('sol da manhã');
    expect(facingInfo(268).sun).toBe('sol da tarde');
    expect(facingInfo(-180).direction).toBe('Sul');
    expect(facingInfo(359).direction).toBe('Norte');
  });
});

describe('developments.json', () => {
  it('matches the unit counts published by the developer', () => {
    expect(allUnits(byId.get('landhaus')!)).toHaveLength(59);
    expect(allUnits(byId.get('aman')!)).toHaveLength(67);
    expect(allUnits(byId.get('hausgarten')!)).toHaveLength(70);
    expect(byId.get('aman')!.levels).toHaveLength(20);
  });
  it('unit ids are unique and numbered floor + final', () => {
    const units = file.developments.flatMap(allUnits);
    expect(new Set(units.map((u) => u.id)).size).toBe(units.length);
    const cora = byId.get('cora')!;
    expect(cora.levels.find((l) => l.level === 15)!.units.map((u) => u.number)).toEqual(['1501', '1502', '1503', '1504', '1505', '1506']);
  });
  it('levels stack without overlap and units of a floor do not overlap', () => {
    for (const d of file.developments) {
      d.levels.forEach((l, i) => i && expect(l.base).toBeGreaterThanOrEqual(d.levels[i - 1].top - 1e-6));
      for (const l of d.levels) {
        const shapes = [...new Set(l.units.map((u) => u.shape))].map((i) => d.shapes[i].polygon);
        for (let a = 0; a < shapes.length; a++)
          for (let b = a + 1; b < shapes.length; b++) expect(turfBooleanIntersects(shapes[a], shapes[b])).toBe(false);
      }
    }
  });
  it('towers do not overlap each other', () => {
    const ds = file.developments;
    for (let a = 0; a < ds.length; a++)
      for (let b = a + 1; b < ds.length; b++) expect(turfBooleanIntersects(ds[a].footprint, ds[b].footprint)).toBe(false);
  });
  it('counts by status add up', () => {
    for (const d of file.developments) {
      const c = countByStatus(d);
      expect(c.available + c.reserved + c.sold).toBe(allUnits(d).length);
    }
  });
});
