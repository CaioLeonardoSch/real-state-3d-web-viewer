import { describe, expect, it } from 'vitest';
import type { Feature, LineString, Point, Polygon } from 'geojson';
import {
  LAMP_SPACING_M,
  frame,
  lampPositions,
  lampShapes,
  polygonTester,
  sampleTrees,
  simplifyRing,
  surfaceClass,
  treeShapes,
  urbanMask,
} from '../scripts/lib/scenery.mjs';

const LAT = -26.3;
const f = frame(LAT);
const everywhere = { has: () => true, size: 1, cellW: 1, cellH: 1 };
/** A square of `side` metres with its south-west corner at (x, y). */
const square = (x: number, y: number, side: number): Polygon => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + f.dx(side), y], [x + f.dx(side), y + f.dy(side)], [x, y + f.dy(side)], [x, y]]],
});
const road = (highway: string, extra: Record<string, string> = {}, lengthM = 200): Feature<LineString, { highway: string; osmId: string }> => ({
  type: 'Feature',
  properties: { highway, osmId: 'way/1', ...extra },
  geometry: { type: 'LineString', coordinates: [[-48.85, LAT], [-48.85 + f.dx(lengthM), LAT]] },
});

describe('pavimento das ruas (tag surface do OSM)', () => {
  it('asfalto, calçamento, outros pavimentos, chão e desconhecido', () => {
    expect(surfaceClass('residential', 'asphalt')).toBe('a');
    expect(surfaceClass('residential', 'paving_stones')).toBe('c');
    expect(surfaceClass('residential', 'sett')).toBe('c');
    expect(surfaceClass('service', 'concrete')).toBe('p');
    expect(surfaceClass('residential', 'unpaved')).toBe('u');
    expect(surfaceClass('residential', 'compacted')).toBe('u');
    expect(surfaceClass('track', undefined)).toBe('u'); // convenção do OSM: track sem surface é de chão
    expect(surfaceClass('residential', undefined)).toBe('');
  });
});

describe('postes ilustrativos', () => {
  it('um a cada ~38 m em rua pavimentada, do lado direito, fora da pista', () => {
    const lamps = lampPositions([road('residential', { surface: 'asphalt' })], [], everywhere, LAT);
    expect(lamps.length).toBeGreaterThanOrEqual(Math.floor(200 / LAMP_SPACING_M) - 1);
    expect(lamps.length).toBeLessThanOrEqual(Math.ceil(200 / LAMP_SPACING_M));
    for (const l of lamps) {
      // a rua vai para leste: o lado direito é o sul, a ~3,5 m do eixo
      const off = (LAT - l.y) * f.ky;
      expect(off).toBeGreaterThan(3);
      expect(off).toBeLessThan(4);
      expect(Math.sin(l.angle)).toBeGreaterThan(0.99); // o braço aponta para a rua (norte)
    }
    const xs = lamps.map((l) => l.x * f.kx).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(LAMP_SPACING_M, 0);
  });
  it('sem postes em estrada de chão, com lit=no, em rodovia ou fora da cidade; os do OSM entram', () => {
    expect(lampPositions([road('residential', { surface: 'dirt' })], [], everywhere, LAT)).toEqual([]);
    expect(lampPositions([road('residential', { lit: 'no' })], [], everywhere, LAT)).toEqual([]);
    expect(lampPositions([road('motorway')], [], everywhere, LAT)).toEqual([]);
    const nowhere = { ...everywhere, has: () => false };
    expect(lampPositions([road('residential')], [], nowhere, LAT)).toEqual([]);
    const mapped: Feature<Point> = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-48.8, LAT] } };
    expect(lampPositions([], [mapped], nowhere, LAT)).toMatchObject([{ x: -48.8, y: LAT, mapped: true }]);
  });
  it('poste, braço e luminária no alto; a luz cai no chão sob a luminária', () => {
    const { shapes, light } = lampShapes({ x: -48.85, y: LAT, angle: Math.PI / 2 }, LAT);
    expect(shapes.map((s) => s.properties.p)).toEqual(['pole', 'arm', 'lum']);
    for (const s of shapes) expect(s.properties.b).toBeLessThan(s.properties.h);
    expect((light.geometry.coordinates[1] - LAT) * f.ky).toBeCloseTo(1.5, 1);
  });
});

describe('árvores', () => {
  const park = (kind: string) => ({ type: 'Feature' as const, properties: { kind, osmId: 'way/9' }, geometry: square(-48.85, LAT, 200) });
  it('parques ganham árvores dentro da área; gramado não; o resultado é sempre o mesmo', () => {
    const inside = polygonTester(square(-48.85, LAT, 200));
    const a = sampleTrees([park('park')], [], everywhere, { lat0: LAT });
    expect(a.length).toBeGreaterThan(100);
    expect(a.every((t) => inside([t.x, t.y]))).toBe(true);
    expect(sampleTrees([park('park')], [], everywhere, { lat0: LAT })).toEqual(a);
    expect(sampleTrees([park('grass')], [], everywhere, { lat0: LAT })).toEqual([]);
  });
  it('mata: árvores na borda (para dentro) e copas que despontam no meio', () => {
    const t = sampleTrees([park('wood')], [], everywhere, { lat0: LAT });
    expect(t.some((x) => x.kind === 'edge')).toBe(true);
    expect(t.some((x) => x.kind === 'canopy')).toBe(true);
    const inside = polygonTester(square(-48.85, LAT, 200));
    expect(t.every((x) => inside([x.x, x.y]))).toBe(true);
  });
  it('árvores e fileiras mapeadas no OSM entram, fora da máscara urbana também', () => {
    const nowhere = { ...everywhere, has: () => false };
    const row: Feature<LineString> = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-48.85, LAT], [-48.85 + f.dx(40), LAT]] } };
    expect(sampleTrees([park('park')], [row], nowhere, { lat0: LAT })).toHaveLength(5);
  });
  it('formas low poly: tronco + copa + topo; borda e mata com uma copa; arbusto baixo', () => {
    const broad = treeShapes({ x: -48.85, y: LAT, kind: 'broad', scale: 1 }, LAT);
    expect(broad.map((s) => s.properties.p)).toEqual(['trunk', 'crown', 'top']);
    expect(broad[1].geometry.coordinates[0]).toHaveLength(7); // hexágono fechado
    expect(treeShapes({ x: -48.85, y: LAT, kind: 'edge', scale: 1 }, LAT)).toHaveLength(1);
    const bush = treeShapes({ x: -48.85, y: LAT, kind: 'bush', scale: 1 }, LAT)[0].properties;
    expect(bush.h).toBeLessThan(3);
  });
});

describe('geometria', () => {
  it('teste de ponto em polígono com buraco', () => {
    const outer = square(0, 0, 100).coordinates[0];
    const hole = square(f.dx(40), f.dy(40), 20).coordinates[0].slice().reverse();
    const inside = polygonTester({ type: 'Polygon', coordinates: [outer, hole] });
    expect(inside([f.dx(10), f.dy(10)])).toBe(true);
    expect(inside([f.dx(50), f.dy(50)])).toBe(false);
    expect(inside([f.dx(150), f.dy(50)])).toBe(false);
  });
  it('simplificação mantém o anel fechado e os cantos', () => {
    const ring: [number, number][] = [[0, 0], [5, 0.001], [10, 0], [10, 10], [0, 10], [0, 0]];
    expect(simplifyRing(ring, 0.01)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  });
  it('máscara urbana: células com prédios, ampliadas', () => {
    const m = urbanMask([[-48.85, LAT]], 100, 1, LAT);
    expect(m.has([-48.85, LAT])).toBe(true);
    expect(m.has([-48.85 + f.dx(150), LAT])).toBe(true);
    expect(m.has([-48.85 + f.dx(600), LAT])).toBe(false);
  });
});
