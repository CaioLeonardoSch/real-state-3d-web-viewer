import { describe, expect, it } from 'vitest';
import { ROOF_BYTES, decodeRoofTile, encodeRoofTiles } from '../scripts/lib/roof-tiles.mjs';
import { tileXY } from '../scripts/lib/tree-tiles.mjs';

describe('blocos de telhados (18 bytes por telhado)', () => {
  const roofs = [
    { lng: -48.8457, lat: -26.3035, angle: 2.5, kind: 'hip' as const, v: 1, length: 12.7, width: 8.7, rise: 2, base: 6, id: 2_801_234_567 },
    { lng: -48.8457, lat: -26.3035, angle: 0.3, kind: 'tank' as const, v: 3, length: 8, width: 6, rise: 3.2, base: 45.3, id: 16 },
    { lng: -48.9, lat: -26.25, angle: 0, kind: 'gable' as const, v: 0, length: 10.3, width: 7.1, rise: 1.7, base: 3, id: 14 },
  ];

  it('cada telhado no bloco do seu meio, e de volta com giro, tipo, tom, medidas, altura e prédio', () => {
    const tiles = encodeRoofTiles(roofs);
    const [fx, fy] = tileXY(roofs[0].lng, roofs[0].lat);
    const home = tiles.find((t) => t.x === Math.floor(fx) && t.y === Math.floor(fy))!;
    expect(home.data.length).toBe(home.count * ROOF_BYTES);
    const d = decodeRoofTile(home.data);
    const i = Array.from(d.id).indexOf(2_801_234_567);
    expect(Math.abs(home.x + d.fx[i] - fx) * 1100).toBeLessThan(0.02);
    expect(d.angle[i]).toBeCloseTo(2.5, 3);
    expect({ kind: d.kind[i], v: d.v[i], rise: d.rise[i], base: d.base[i] }).toEqual({ kind: 1, v: 1, rise: expect.closeTo(2, 2), base: expect.closeTo(6, 2) });
    expect(d.length[i]).toBeCloseTo(12.7, 2);
    expect(d.width[i]).toBeCloseTo(8.7, 2);
    expect(tiles.flatMap((t) => Array.from(decodeRoofTile(t.data).kind)).sort()).toEqual([0, 1, 2]);
  });

  it('os mesmos telhados dão os mesmos bytes, em qualquer ordem; id fora de 32 bits não passa', () => {
    expect(encodeRoofTiles([...roofs].reverse()).map((t) => Array.from(t.data))).toEqual(encodeRoofTiles(roofs).map((t) => Array.from(t.data)));
    expect(() => encodeRoofTiles([{ ...roofs[0], id: 2 ** 32 }])).toThrow();
  });
});
