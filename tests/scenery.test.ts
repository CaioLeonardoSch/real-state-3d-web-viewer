import { describe, expect, it } from 'vitest';
import type { Feature, LineString, Point, Polygon } from 'geojson';
import {
  LAMP_SPACING_M,
  clearings,
  cutCanopy,
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
  it('tipo de luz por rua (avenida: LED branco neutro e mais forte) e intensidade de cada poste', () => {
    const main = lampPositions([road('primary', { surface: 'asphalt' })], [], everywhere, LAT);
    expect(main.length).toBeGreaterThan(0);
    for (const l of main) {
      expect(l.t).toBe('n');
      expect(l.k).toBeGreaterThanOrEqual(1);
      expect(l.k).toBeLessThanOrEqual(1.5);
    }
    const side = lampPositions([road('residential', { surface: 'asphalt' })], [], everywhere, LAT);
    expect(new Set(side.map((l) => l.t)).size).toBe(1); // o mesmo tipo ao longo da rua
    expect(['w', 's']).toContain(side[0].t);
    for (const l of side) {
      expect(l.k).toBeGreaterThanOrEqual(0.8);
      expect(l.k).toBeLessThanOrEqual(1.2);
    }
    // a luz e a luminária levam o tipo; o branco quente (padrão do estilo do mapa) fica de fora
    const { shapes, light } = lampShapes(main[0], LAT);
    expect(light.properties).toEqual({ t: 'n', k: main[0].k });
    expect(shapes[2].properties.t).toBe('n');
    expect(lampShapes({ x: -48.85, y: LAT, angle: 0, t: 'w', k: 1 }, LAT).light.properties).toEqual({ k: 1 });
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

describe('clareiras: casas e ruas fora da mata', () => {
  const x0 = -48.85;
  /** Ponto a `east` m para leste e `north` m para o norte de (x0, LAT). */
  const at = (east: number, north: number): [number, number] => [x0 + f.dx(east), LAT + f.dy(north)];
  const house = { type: 'Feature' as const, properties: {}, geometry: square(...at(100, 50), 10) };
  const wood = { type: 'Feature' as const, properties: { kind: 'wood', osmId: 'way/9' }, geometry: square(...at(0, 20), 200) };
  const lane = (highway: string): Feature<LineString, { highway: string; osmId: string }> => ({
    type: 'Feature',
    properties: { highway, osmId: 'way/2' },
    geometry: { type: 'LineString', coordinates: [at(50, 0), at(50, 300)] },
  });
  it('dentro da casa, a menos de 6 m dela ou sobre a rua fica bloqueado; longe, não', () => {
    const clear = clearings([house], [road('residential')], { lat0: LAT });
    expect(clear.blocked(at(105, 55))).toBe(true);
    expect(clear.blocked(at(105, 64))).toBe(true);
    expect(clear.blocked(at(105, 70))).toBe(false);
    expect(clear.blocked(at(50, 2))).toBe(true); // meia pista de rua residencial (2,8 m) + 0,8 m
    expect(clear.blocked(at(50, 5))).toBe(false);
  });
  it('árvores ilustrativas ficam fora das clareiras', () => {
    const clear = clearings([house], [lane('residential')], { lat0: LAT });
    const trees = sampleTrees([wood], [], everywhere, { lat0: LAT, blocked: clear.blocked });
    expect(trees.length).toBeGreaterThan(50);
    expect(trees.some((t) => clear.blocked([t.x, t.y]))).toBe(false);
    expect(sampleTrees([wood], [], everywhere, { lat0: LAT, blocked: () => true })).toEqual([]);
  });
  it('a copa da mata abre em volta da casa e ao longo da rua que a atravessa; trilha não corta', () => {
    const { features, cut, failed } = cutCanopy([wood], clearings([house], [lane('residential')], { lat0: LAT }));
    expect([cut, failed]).toEqual([1, 0]);
    const inWood = polygonTester(features[0].geometry);
    expect(inWood(at(105, 55))).toBe(false);
    expect(inWood(at(105, 63))).toBe(false);
    expect(inWood(at(50, 100))).toBe(false);
    expect(inWood(at(56, 100))).toBe(true);
    expect(inWood(at(150, 150))).toBe(true);
    const path = cutCanopy([wood], clearings([], [lane('footway')], { lat0: LAT }));
    expect(path.cut).toBe(0);
    expect(path.features[0]).toBe(wood);
  });
});
