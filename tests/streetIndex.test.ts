import { describe, expect, it } from 'vitest';
import type { Feature, LineString, MultiLineString, MultiPolygon, Position } from 'geojson';
import {
  displayName,
  isAddressRoad,
  lineLengthM,
  lineMiddle,
  mergeLines,
  placeLocator,
  roadMergeKey,
  splitByPlace,
  streetIndex,
  streetIndexJson,
  streetParts,
  type AreaFeature,
  type StreetIndex,
} from '../scripts/lib/streets.mjs';
import { frame } from '../scripts/lib/scenery.mjs';
import ruasJson from '../public/data/ruas.json';
import meta from '../public/data/meta.json';

const LAT = -26.3;
const f = frame(LAT);
/** A point `east`/`north` metres from a reference corner in Joinville. */
const at = (east: number, north: number): [number, number] => [-48.85 + f.dx(east), LAT + f.dy(north)];

type RoadProps = { highway: string; s?: string; name?: string };
const road = (props: RoadProps, ...pts: [number, number][]): Feature<LineString, RoadProps> => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'LineString', coordinates: pts },
});
const named = (name: string, highway = 'residential', s = 'a'): RoadProps => ({ name, highway, s });
/** Rectangle area (metres from the reference corner). */
const area = (name: string, kind: string, w: number, s: number, e: number, n: number): AreaFeature => ({
  type: 'Feature',
  properties: { name, kind },
  geometry: { type: 'MultiPolygon', coordinates: [[[at(w, s), at(e, s), at(e, n), at(w, n), at(w, s)]]] } as MultiPolygon,
});

describe('nome da rua para o mapa e a busca', () => {
  it('troca aspas e travessões tipográficos por ASCII, junta espaços e apara', () => {
    expect(displayName('Rua Ronco d’Água')).toBe("Rua Ronco d'Água");
    expect(displayName('Rua ‘Bem‘ d´Oeste `x`')).toBe("Rua 'Bem' d'Oeste 'x'");
    expect(displayName('Praça “do Povo”')).toBe('Praça "do Povo"');
    expect(displayName('Servidão A – B — C')).toBe('Servidão A - B - C');
    expect(displayName('  Rua \u00a0 das   Flores\t')).toBe('Rua das Flores');
    expect(displayName('Rua Glo\u0301ria')).toBe('Rua Glória'); // NFD → NFC
    expect(displayName(undefined)).toBe('');
  });

  it('só usa a faixa Latin-1 da fonte do mapa (letras de fora perdem o acento)', () => {
    expect(displayName('Rua Gőz Šimek')).toBe('Rua Goz Simek');
    expect(displayName('Rua Döhler Müller')).toBe('Rua Döhler Müller'); // dentro da faixa: fica como está
    for (const n of ['Rua Ronco d’Água', 'Rua Gőz', 'Servidão A – B']) expect(displayName(displayName(n))).toBe(displayName(n));
  });

  it('ruas de endereço: sem trilhas, escadas, ciclovias nem plataformas', () => {
    for (const h of ['residential', 'primary', 'service', 'living_street', 'pedestrian', 'motorway_link', 'track']) expect(isAddressRoad(h)).toBe(true);
    for (const h of ['footway', 'path', 'steps', 'cycleway', 'bridleway', 'corridor', 'platform', 'bus_stop', 'elevator', 'proposed', 'construction', ''])
      expect(isAddressRoad(h)).toBe(false);
  });
});

describe('trechos da mesma rua unidos (espaço para o nome)', () => {
  const p = [at(0, 0), at(100, 0), at(200, 0), at(300, 0), at(100, 100)];

  it('une trechos que continuam um ao outro, invertendo os que estão ao contrário', () => {
    const a = road(named('Rua A'), p[0], p[1]);
    const b = road(named('Rua A'), p[2], p[1]); // drawn the other way
    const out = mergeLines([a, b], roadMergeKey);
    expect(out).toHaveLength(1);
    expect(out[0].geometry).toEqual({ type: 'LineString', coordinates: [p[0], p[1], p[2]] });
    expect(out[0].properties).toEqual(named('Rua A'));
  });

  it('acha a ponta da cadeia fora de ordem e a põe no lugar do primeiro trecho', () => {
    const u = road({ highway: 'service', s: '' }, p[0], p[4]);
    const c = road(named('Rua A'), p[3], p[2]);
    const a = road(named('Rua A'), p[0], p[1]);
    const b = road(named('Rua A'), p[1], p[2]);
    const out = mergeLines([u, c, a, b], roadMergeKey);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(u);
    expect(out[1].geometry.coordinates).toEqual([p[3], p[2], p[1], p[0]]);
  });

  it('não une em bifurcações, entre classes ou pavimentos diferentes, sem nome ou com pontas quase iguais', () => {
    const fork = [road(named('Rua A'), p[0], p[1]), road(named('Rua A'), p[1], p[2]), road(named('Rua A'), p[1], p[4])];
    const classes = [road(named('Rua A', 'residential'), p[0], p[1]), road(named('Rua A', 'tertiary'), p[1], p[2])];
    const paving = [road(named('Rua A', 'residential', 'a'), p[0], p[1]), road(named('Rua A', 'residential', 'c'), p[1], p[2])];
    const unnamed = [road({ highway: 'residential', s: 'a' }, p[0], p[1]), road({ highway: 'residential', s: 'a' }, p[1], p[2])];
    const near = [road(named('Rua A'), p[0], p[1]), road(named('Rua A'), [p[1][0] + 1e-7, p[1][1]], p[2])];
    for (const list of [fork, classes, paving, unnamed, near]) {
      const out = mergeLines(list, roadMergeKey);
      expect(out).toHaveLength(list.length);
      out.forEach((g, i) => expect(g).toBe(list[i]));
    }
  });

  it('um anel de trechos vira uma linha fechada; um trecho já fechado não se une', () => {
    const ring = mergeLines([road(named('Rua A'), p[0], p[1]), road(named('Rua A'), p[1], p[4]), road(named('Rua A'), p[4], p[0])], roadMergeKey);
    expect(ring).toHaveLength(1);
    expect(ring[0].geometry.coordinates).toEqual([p[0], p[1], p[4], p[0]]);
    const loop = road(named('Rua A'), p[0], p[1], p[4], p[0]);
    const tail = road(named('Rua A'), p[0], p[3]);
    const out = mergeLines([loop, tail], roadMergeKey);
    expect(out[0]).toBe(loop);
    expect(out[1]).toBe(tail);
  });

  it('multilinhas: partes unidas viram linhas válidas; sem união, a feição fica igual', () => {
    const multi: Feature<LineString | MultiLineString, RoadProps> = {
      type: 'Feature',
      properties: named('Rua A'),
      geometry: { type: 'MultiLineString', coordinates: [[p[0], p[1]], [p[3], p[4]]] },
    };
    const out = mergeLines([multi, road(named('Rua A'), p[1], p[2])], roadMergeKey);
    expect(out.map((g) => g.geometry)).toEqual([
      { type: 'LineString', coordinates: [p[0], p[1], p[2]] },
      { type: 'LineString', coordinates: [p[3], p[4]] },
    ]);
    const alone = mergeLines([multi, road(named('Rua B'), p[1], p[2])], roadMergeKey);
    expect(alone[0]).toBe(multi);
  });

  it('meio da linha pelo comprimento, sobre a linha', () => {
    const g: LineString = { type: 'LineString', coordinates: [at(0, 0), at(100, 0), at(100, 100)] };
    expect(lineLengthM(g, LAT)).toBeCloseTo(200, 6);
    const [x, y] = lineMiddle(g, LAT)!;
    expect(x).toBeCloseTo(at(100, 0)[0], 9);
    expect(y).toBeCloseTo(at(100, 0)[1], 9);
  });
});

describe('bairro e cidade de cada trecho de rua', () => {
  // two towns, one above the other, each with a "Centro"; a district without bairros; rural land
  const areas = [
    area('Joinville', 'cidade', 0, 0, 2000, 2000),
    area('Araquari', 'cidade', 0, -2000, 2000, 0),
    area('Centro', 'bairro', 100, 1100, 900, 1900),
    area('Glória', 'bairro', 1000, 1100, 1900, 1900),
    area('Pirabeiraba', 'distrito', 100, 100, 900, 900),
    area('Centro', 'bairro', 100, -1900, 900, -1100),
  ];
  const locate = placeLocator({ type: 'FeatureCollection', features: areas });
  /** Distance in metres from a point to a line (lng/lat). */
  const distM = (p: Position, line: Position[]) => {
    const m = (c: Position) => [(c[0] - at(0, 0)[0]) / f.dx(1), (c[1] - at(0, 0)[1]) / f.dy(1)];
    const [px, py] = m(p);
    let best = Infinity;
    for (let i = 1; i < line.length; i++) {
      const [[ax, ay], [bx, by]] = [m(line[i - 1]), m(line[i])];
      const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * (bx - ax) - px, ay + t * (by - ay) - py));
    }
    return best;
  };

  it('bairro com a cidade dele; distrito fora dos bairros; só a cidade fora dos dois; null fora da região', () => {
    expect(locate(at(500, 1500))).toEqual(['Centro', 'Joinville']);
    expect(locate(at(500, -1500))).toEqual(['Centro', 'Araquari']);
    expect(locate(at(1500, 1500))).toEqual(['Glória', 'Joinville']);
    expect(locate(at(500, 500))).toEqual(['Pirabeiraba', 'Joinville']);
    expect(locate(at(1500, 500))).toEqual(['', 'Joinville']);
    expect(locate(at(1500, -500))).toEqual(['', 'Araquari']);
    expect(locate(at(5000, 5000))).toBeNull();
  });

  it('a linha é cortada nas divisas de bairro e cidade, com o ponto da divisa a menos de meio metro', () => {
    const stretches = splitByPlace([at(200, 1500), at(1800, 1500)], locate, { lat0: LAT });
    expect(stretches.map((s) => s.place)).toEqual([
      ['Centro', 'Joinville'],
      ['', 'Joinville'],
      ['Glória', 'Joinville'],
    ]);
    const east = (c: Position) => (c[0] - at(0, 0)[0]) / f.dx(1);
    expect(east(stretches[0].line[0])).toBeCloseTo(200, 6);
    expect(Math.abs(east(stretches[0].line.at(-1)!) - 900)).toBeLessThan(0.5);
    expect(stretches[1].line[0]).toEqual(stretches[0].line.at(-1));
    expect(Math.abs(east(stretches[1].line.at(-1)!) - 1000)).toBeLessThan(0.5);
    expect(east(stretches[2].line.at(-1)!)).toBeCloseTo(1800, 6);
    // across the two cities; the stretch outside the region is left out
    const across = splitByPlace([at(1500, -500), at(1500, 500), at(1500, 2500)], locate, { lat0: LAT });
    expect(across.map((s) => s.place)).toEqual([
      ['', 'Araquari'],
      ['', 'Joinville'],
      ['Glória', 'Joinville'],
      ['', 'Joinville'],
    ]);
    expect(lineLengthM({ type: 'LineString', coordinates: across[0].line }, LAT)).toBeCloseTo(500, 0);
    expect(lineLengthM({ type: 'LineString', coordinates: across[3].line }, LAT)).toBeCloseTo(100, 0);
    expect(across[1].line).toHaveLength(3); // keeps its own point at (1500, 500)
  });

  it('trechos do mesmo nome e lugar a até 300 m são uma parte, também em cadeia; mais longe, outra parte', () => {
    const pieces = [
      road(named('Rua X'), at(100, 1000), at(200, 1000)),
      road(named('Rua X'), at(450, 1000), at(550, 1000)), // 250 m from the first
      road(named('Rua X'), at(800, 1000), at(900, 1000)), // 250 m from the second, 600 m from the first
      road(named('Rua X'), at(1300, 1000), at(1400, 1000)), // 400 m away: another part
      road(named('Rua X', 'footway'), at(1000, 1000), at(1200, 1000)), // a path: not an address, does not bridge the gap
      road({ highway: 'residential' }, at(100, 1050), at(200, 1050)),
    ];
    const parts = streetParts(pieces, locate, { lat0: LAT });
    expect(parts.map((p) => [p.name, ...p.place, p.runs.length, Math.round(p.lengthM)])).toEqual([
      ['Rua X', '', 'Joinville', 3, 300],
      ['Rua X', '', 'Joinville', 1, 100],
    ]);
    // pieces that continue each other are one run, even of different classes; long crossing pieces are one part
    const joined = streetParts(
      [road(named('Rua Y'), at(1100, 300), at(1500, 300)), road(named('Rua Y', 'tertiary'), at(1500, 300), at(1500, 800))],
      locate,
      { lat0: LAT },
    );
    expect(joined.map((p) => [p.runs.length, p.runs[0].length])).toEqual([[1, 3]]);
    const cross = [road(named('Rua Z'), at(1500, 100), at(1500, 900)), road(named('Rua Z'), at(1100, 500), at(1900, 500))];
    expect(streetParts(cross, locate, { lat0: LAT })).toHaveLength(1);
  });

  const roads = [
    road(named('Rua das Flores'), at(200, 1500), at(600, 1500)),
    road(named('Rua das Flores'), at(200, -1500), at(600, -1500)),
    road(named('Rua Azul'), at(1200, 1300), at(1400, 1300)),
    road(named('Rua Azul'), at(1200, 300), at(1400, 300)), // 1 km south: another Rua Azul, rural Joinville
    road(named('Rua Ávila'), at(1200, 1500), at(1500, 1500)),
    road(named('Trilha do Morro', 'path'), at(1200, 1700), at(1500, 1700)),
    road(named('Rua Fora'), at(5000, 5000), at(5100, 5000)),
  ];
  const index = streetIndex(roads, areas, { lat0: LAT });
  const rows = index.streets.map(([name, place]) => [name, ...index.places[place]]);
  const entries = (idx: StreetIndex, name: string) =>
    idx.streets.filter((r) => r[0] === name).map(([, p, w, s, e, n, x, y]) => ({ place: idx.places[p], box: [w, s, e, n], point: [x, y] }));

  it('uma entrada por nome e lugar, em ordem alfabética do português; sem trilhas nem ruas fora da região', () => {
    expect(index.v).toBe(1);
    expect(rows).toEqual([
      ['Rua Ávila', 'Glória', 'Joinville'],
      ['Rua Azul', 'Glória', 'Joinville'],
      ['Rua Azul', '', 'Joinville'],
      ['Rua das Flores', 'Centro', 'Araquari'],
      ['Rua das Flores', 'Centro', 'Joinville'],
    ]);
    // each place once, as [bairro, city]
    expect(new Set(index.places.map((p) => p.join('|'))).size).toBe(index.places.length);
  });

  it('caixa com a rua inteira e um ponto sobre ela, com 5 casas decimais', () => {
    const [, , w, s, e, n, x, y] = index.streets[0];
    for (const v of [w, s, e, n, x, y]) expect(Math.round(v * 1e5) / 1e5).toBe(v);
    const [x0, y0] = at(1200, 1500);
    const [x1] = at(1500, 1500);
    expect(w).toBeLessThanOrEqual(x0);
    expect(e).toBeGreaterThanOrEqual(x1);
    expect(s).toBeLessThanOrEqual(y0);
    expect(n).toBeGreaterThanOrEqual(y0);
    expect(x).toBeCloseTo(at(1350, 1500)[0], 5);
    expect(y).toBeCloseTo(y0, 5);
  });

  it('rua que atravessa bairros: uma entrada em cada um, com a caixa e o ponto do trecho dentro dele', () => {
    const line = [at(200, 1500), at(1800, 1500)];
    const idx = streetIndex([road(named('Rua Longa'), ...line)], areas, { lat0: LAT });
    const list = entries(idx, 'Rua Longa');
    expect(list.map((r) => r.place)).toEqual([
      ['Centro', 'Joinville'],
      ['Glória', 'Joinville'],
      ['', 'Joinville'],
    ]);
    const [centro, gloria, rural] = list;
    // boxes of the stretch inside the place (rounded outwards: within 2 m of the border)
    expect(centro.box[0]).toBeLessThanOrEqual(at(200, 0)[0]);
    expect(centro.box[2]).toBeGreaterThanOrEqual(at(900, 0)[0] - f.dx(0.5));
    expect(centro.box[2]).toBeLessThan(at(902, 0)[0]);
    expect(gloria.box[0]).toBeGreaterThan(at(998, 0)[0]);
    expect(gloria.box[2]).toBeGreaterThanOrEqual(at(1800, 0)[0]);
    // the point: on the line, in the middle of the stretch, inside the place
    expect(centro.point[0]).toBeCloseTo(at(550, 0)[0], 4);
    expect(gloria.point[0]).toBeCloseTo(at(1400, 0)[0], 4);
    expect(rural.point[0]).toBeCloseTo(at(950, 0)[0], 4);
    for (const r of list) {
      expect(locate(r.point)).toEqual(r.place);
      expect(distM(r.point, line)).toBeLessThan(1.5);
    }
  });

  it('pontas na divisa: menos de 80 m junto da mesma rua em outro lugar não são entrada; rua curta inteira num lugar fica', () => {
    const idx = streetIndex(
      [
        road(named('Rua Curva'), at(500, 1500), at(500, 1040)), // 400 m in Centro, then 40 m in rural Joinville
        road(named('Beco'), at(1200, 1200), at(1240, 1200)), // 40 m, wholly in Glória
        road(named('Rua Distante'), at(1500, 500), at(1540, 500)), // 40 m in rural Joinville…
        road(named('Rua Distante'), at(1200, 1800), at(1800, 1800)), // …and 600 m in Glória, 1.3 km away
      ],
      areas,
      { lat0: LAT },
    );
    expect(entries(idx, 'Rua Curva').map((r) => r.place)).toEqual([['Centro', 'Joinville']]);
    // the box of the entry is that of the part in Centro only: the tail is not in it
    expect(entries(idx, 'Rua Curva')[0].box[1]).toBeGreaterThan(at(0, 1098)[1]);
    expect(entries(idx, 'Beco').map((r) => r.place)).toEqual([['Glória', 'Joinville']]);
    expect(entries(idx, 'Rua Distante').map((r) => r.place)).toEqual([
      ['Glória', 'Joinville'],
      ['', 'Joinville'],
    ]);
    // a tail of 80 m or more is an entry
    const long = streetIndex([road(named('Rua Curva'), at(500, 1500), at(500, 1000))], areas, { lat0: LAT });
    expect(entries(long, 'Rua Curva').map((r) => r.place)).toEqual([
      ['Centro', 'Joinville'],
      ['', 'Joinville'],
    ]);
  });

  it('partes do mesmo nome e lugar longe uma da outra: uma entrada, caixa com as duas, ponto na mais longa', () => {
    const idx = streetIndex(
      [
        road(named('Rua Dupla'), at(150, 1200), at(250, 1200)),
        road(named('Rua Dupla'), at(600, 1800), at(850, 1800)), // 690 m from the other part, same bairro
        road(named('Rua Dupla', 'tertiary'), at(850, 1800), at(850, 1700)), // continues it: one run of 350 m
      ],
      areas,
      { lat0: LAT },
    );
    const list = entries(idx, 'Rua Dupla');
    expect(list).toHaveLength(1);
    expect(list[0].place).toEqual(['Centro', 'Joinville']);
    const [w, s, e, n] = list[0].box;
    expect([w <= at(150, 0)[0], s <= at(0, 1200)[1], e >= at(850, 0)[0], n >= at(0, 1800)[1]]).toEqual([true, true, true, true]);
    // middle of the 350 m run: 175 m along it, at (775, 1800)
    expect(list[0].point[0]).toBeCloseTo(at(775, 0)[0], 4);
    expect(list[0].point[1]).toBeCloseTo(at(0, 1800)[1], 4);
  });

  it('rua rente à divisa: o ponto arredondado continua dentro do lugar e sobre a rua', () => {
    // a bairro whose northern border is 0.3 m north of -26.29; the street runs 0.1 m south of it, then turns south.
    // Rounded to 5 decimals, its middle (-26.290004 → -26.29) would be just outside the bairro.
    const poly = (w: number, s: number, e: number, n: number): MultiPolygon => ({
      type: 'MultiPolygon',
      coordinates: [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]],
    });
    const edge: AreaFeature[] = [
      { type: 'Feature', properties: { name: 'Joinville', kind: 'cidade' }, geometry: poly(-48.9, -26.35, -48.8, -26.25) },
      { type: 'Feature', properties: { name: 'Borda', kind: 'bairro' }, geometry: poly(-48.86, -26.3, -48.83, -26.290003) },
    ];
    const line: Position[] = [
      [-48.85, -26.290004],
      [-48.84, -26.290004],
      [-48.8395, -26.2905],
    ];
    const idx = streetIndex([road(named('Rua da Divisa'), ...(line as [number, number][]))], edge, { lat0: LAT });
    const list = entries(idx, 'Rua da Divisa');
    expect(list.map((r) => r.place)).toEqual([['Borda', 'Joinville']]);
    expect(placeLocator(edge)(list[0].point)).toEqual(['Borda', 'Joinville']);
    expect(distM(list[0].point, line)).toBeLessThan(1.5);
  });

  it('JSON com uma linha por rua, que volta igual', () => {
    const json = streetIndexJson(index);
    expect(JSON.parse(json)).toEqual(index);
    expect(json.split('\n').length).toBeGreaterThan(index.streets.length + index.places.length);
  });
});

describe('public/data/ruas.json (gerado por scripts/build-tiles.mjs)', () => {
  const ruas = ruasJson as unknown as StreetIndex;
  const collator = new Intl.Collator('pt-BR');

  it('formato, nomes normalizados, ordem e lugares válidos', () => {
    expect(ruas.v).toBe(1);
    expect(ruas.streets.length).toBe(meta.counts.streets);
    expect(ruas.streets.length).toBeGreaterThan(1000);
    const [bw, bs, be, bn] = meta.boundaryBbox;
    for (let i = 0; i < ruas.streets.length; i++) {
      const [name, place, w, s, e, n, x, y] = ruas.streets[i];
      expect(displayName(name)).toBe(name);
      expect(ruas.places[place]).toBeDefined();
      expect(w <= x && x <= e && s <= y && y <= n).toBe(true);
      expect(x > bw - 0.05 && x < be + 0.05 && y > bs - 0.05 && y < bn + 0.05).toBe(true);
      if (i) expect(collator.compare(ruas.streets[i - 1][0], name)).toBeLessThanOrEqual(0);
    }
  });

  it('a mesma rua em duas cidades e bairros de mesmo nome ficam separados', () => {
    const placesOf = (name: string) => ruas.streets.filter((r) => r[0] === name).map((r) => ruas.places[r[1]].join(', '));
    expect(placesOf('Rua XV de Novembro').some((p) => p.endsWith('Joinville'))).toBe(true);
    expect(new Set(placesOf('Rua Blumenau').map((p) => p.split(', ')[1]))).toEqual(new Set(['Joinville', 'Araquari']));
    expect(ruas.places.some(([b, c]) => b === 'Centro' && c === 'Joinville')).toBe(true);
    expect(ruas.places.some(([b, c]) => b === 'Centro' && c === 'Araquari')).toBe(true);
    expect(placesOf("Rua Ronco d'Água")).not.toHaveLength(0);
  });

  it('uma entrada por nome e lugar; a rua que atravessa bairros está em cada um deles', () => {
    const keys = ruas.streets.map((r) => `${r[0]}|${r[1]}`);
    expect(new Set(keys).size).toBe(keys.length);
    const placesOf = (name: string) => ruas.streets.filter((r) => r[0] === name).map((r) => ruas.places[r[1]].join(', '));
    // the XV de Novembro goes from downtown out to Vila Nova
    expect(placesOf('Rua XV de Novembro')).toEqual(expect.arrayContaining(['Centro, Joinville', 'América, Joinville', 'Glória, Joinville', 'Vila Nova, Joinville']));
  });
});
