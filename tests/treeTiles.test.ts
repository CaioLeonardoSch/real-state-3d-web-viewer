import { describe, expect, it } from 'vitest';
import { TREE_BYTES, decodeTreeTile, encodeTreeTiles, tileXY } from '../scripts/lib/tree-tiles.mjs';

describe('blocos de árvores (8 bytes por árvore)', () => {
  const trees = [
    { lng: -48.8457, lat: -26.3035, kind: 'broad' as const, v: 2, h: 7.3, r: 2.4, rot: 1 },
    { lng: -48.8452, lat: -26.3031, kind: 'bush' as const, v: 0, h: 1.9, r: 1.3, rot: 5 },
    { lng: -48.9, lat: -26.25, kind: 'canopy' as const, v: 1, h: 12.4, r: 5.1, rot: 0.2 },
  ];

  it('cada árvore no bloco z15 em que está, e de volta com posição, tipo, tom, altura, copa e giro', () => {
    const tiles = encodeTreeTiles(trees);
    expect(tiles.map((t) => t.count).reduce((a, b) => a + b)).toBe(3);
    const [fx, fy] = tileXY(trees[0].lng, trees[0].lat);
    const home = tiles.find((t) => t.x === Math.floor(fx) && t.y === Math.floor(fy))!;
    expect(home.data.length).toBe(home.count * TREE_BYTES);
    const d = decodeTreeTile(home.data);
    const i = Array.from(d.kind).indexOf(0);
    // posição: menos de 2 cm dentro do bloco (~1,1 km)
    expect(Math.abs(home.x + d.fx[i] - fx) * 1100).toBeLessThan(0.02);
    expect(Math.abs(home.y + d.fy[i] - fy) * 1100).toBeLessThan(0.02);
    expect({ v: d.v[i], h: d.h[i], r: d.r[i] }).toEqual({ v: 2, h: expect.closeTo(7.3, 2), r: expect.closeTo(2.4, 2) });
    expect(d.rot[i]).toBeCloseTo(1, 1);
    expect(tiles.flatMap((t) => Array.from(decodeTreeTile(t.data).kind)).sort()).toEqual([0, 2, 3]);
  });

  it('as mesmas árvores dão os mesmos bytes, em qualquer ordem', () => {
    const a = encodeTreeTiles(trees);
    const b = encodeTreeTiles([...trees].reverse());
    expect(b.map((t) => Array.from(t.data))).toEqual(a.map((t) => Array.from(t.data)));
  });
});
