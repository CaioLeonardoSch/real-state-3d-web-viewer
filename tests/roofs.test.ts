import { describe, expect, it } from 'vitest';
import { EAVE_M, orientedRect, roofKind, roofParams } from '../scripts/lib/roofs.mjs';
import { frame } from '../scripts/lib/scenery.mjs';
import { osmNumericId } from '../src/data/osmId';

const LAT = -26.3;
const f = frame(LAT);
/** Ring from points in metres (east, north) around a corner in Joinville. */
const ring = (pts: [number, number][]): [number, number][] => {
  const r = pts.map(([e, n]): [number, number] => [-48.85 + f.dx(e), LAT + f.dy(n)]);
  return [...r, r[0]];
};
/** A rectangle `l` × `w` metres rotated by `deg` degrees. */
const rotated = (l: number, w: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  const p = (u: number, v: number): [number, number] => [u * Math.cos(a) - v * Math.sin(a), u * Math.sin(a) + v * Math.cos(a)];
  return ring([p(0, 0), p(l, 0), p(l, w), p(0, w)]);
};

describe('telhados low poly', () => {
  it('acha o retângulo orientado do contorno, mesmo girado', () => {
    const r = orientedRect(rotated(12, 8, 33), LAT)!;
    expect(r.length).toBeCloseTo(12, 1);
    expect(r.width).toBeCloseTo(8, 1);
    expect(r.fill).toBeCloseTo(1, 2);
    // the long side follows the rotation (a direction: either way along the line)
    const deg = (Math.atan2(r.axis[1], r.axis[0]) * 180) / Math.PI;
    expect(((deg % 180) + 180) % 180).toBeCloseTo(33, 0);
    // an L shape fills three quarters of its rectangle
    const l = orientedRect(ring([[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]]), LAT)!;
    expect(l.fill).toBeCloseTo(0.75, 2);
  });

  it('escolhe o telhado pelo formato, andares e uso; roof:shape do OSM manda', () => {
    const house = orientedRect(rotated(12, 8, 0), LAT);
    const square = orientedRect(rotated(9, 9, 0), LAT);
    const kinds = (rect: typeof house) =>
      Array.from({ length: 40 }, (_, i) => roofKind({ osmId: `way/${i}` }, { area: 90, height: 3, floors: 1, rect }));
    // elongated houses are mostly gabled, squarish ones mostly hipped (a quarter swaps, for variety)
    const gabled = kinds(house).filter((k) => k === 'gable').length;
    expect(gabled).toBeGreaterThan(25);
    expect(gabled).toBeLessThan(40);
    expect(kinds(square).filter((k) => k === 'hip').length).toBeGreaterThan(25);
    expect(roofKind({ osmId: 'way/1' }, { area: 600, height: 30, floors: 10, rect: house })).toBe('tank');
    expect(roofKind({ osmId: 'way/1' }, { area: 900, height: 6, floors: 2, rect: house })).toBe('flat');
    expect(roofKind({ osmId: 'way/1', 'roof:shape': 'hipped' }, { area: 900, height: 6, floors: 2, rect: house })).toBe('hip');
    expect(roofKind({ osmId: 'way/1', 'roof:shape': 'flat' }, { area: 90, height: 3, floors: 1, rect: house })).toBe('flat');
    // complex outlines (an L) stay flat: a pitched roof on the rectangle would overhang the yard
    const l = orientedRect(ring([[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]]), LAT);
    expect(roofKind({ osmId: 'way/1' }, { area: 75, height: 3, floors: 1, rect: l })).toBe('flat');
  });

  it('id numérico do prédio (o telhado não carrega o texto do id)', () => {
    expect(osmNumericId('way/123')).toBe(246);
    expect(osmNumericId('relation/123')).toBe(247);
    expect(osmNumericId('node/1')).toBe(-1);
  });

  it('telhado sobre o prédio: comprimento e largura com o beiral, caimento de 26°, tom e prédio', () => {
    const rect = orientedRect(rotated(12, 8, 30), LAT)!;
    const gable = roofParams('way/7', rect, 'gable', 6)!;
    expect(gable).toMatchObject({ kind: 'gable', base: 6, id: osmNumericId('way/7') });
    expect(gable.length).toBeCloseTo(12 + 2 * EAVE_M, 1);
    expect(gable.width).toBeCloseTo(8 + 2 * EAVE_M, 1);
    // 4 m de meia largura × 0,49 ≈ 2 m acima das paredes
    expect(gable.rise).toBeCloseTo(1.96, 2);
    // o lado comprido girado 30° do leste para o norte
    expect(gable.angle).toBeCloseTo(Math.PI / 6, 2);
    expect(gable.v).toBeLessThan(3);
    expect(roofParams('way/7', rect, 'hip', 6)).toMatchObject({ kind: 'hip', rise: gable.rise });
    // prédios altos: a caixa-d'água e a casa de máquinas, uma caixa no meio da laje
    const tank = roofParams('way/8', orientedRect(rotated(30, 20, 10), LAT), 'tank', 45)!;
    expect(tank).toMatchObject({ kind: 'tank', base: 45, rise: 3.2, v: 3, id: 16 });
    expect(tank.length).toBeCloseTo(8, 1);
    expect(tank.width).toBeCloseTo(6, 1);
    expect(roofParams('way/9', rect, 'flat', 6)).toBeNull();
  });
});
