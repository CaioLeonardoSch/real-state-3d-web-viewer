#!/usr/bin/env node
// Address index of the "Anunciar imóvel" form (locate by street and number, without clicking the map), from the city
// cadastre (scripts/download-cadastre.mjs): every lot with a street number, at a point inside its outline.
// Writes public/data/enderecos.json:
//   { v: 1, origin: [w, s], bairros: string[], streets: [name, [number, x, y, bairro, builtM2][]][] }
// x, y: the point in 1e-5 degrees from `origin` (about 1 m); builtM2: the lot's built area (0 = vacant). Names as the
// cadastre writes them ("QUINZE DE NOVEMBRO", without "Rua"); the browser normalizes what is typed the same way
// (src/data/addresses.ts). A region without a cadastre gets an empty index (the form then asks for the map).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import turfPointOnFeature from '@turf/point-on-feature';
import { CADASTRE_SOURCES, REGION } from './lib/region.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data', 'enderecos.json');
if (!CADASTRE_SOURCES.includes(REGION.cadastre?.source)) {
  await writeFile(OUT, JSON.stringify({ v: 1, origin: [0, 0], bairros: [], streets: [] }));
  console.log(`Região "${REGION.name}" sem cadastro: índice de endereços vazio.`);
  process.exit(0);
}
const read = async (f) => JSON.parse(await readFile(path.join(ROOT, '.cache', 'cadastre', f), 'utf8'));
const [lots, attrs] = await Promise.all([read('lotes.geojson'), read('atributos.json')]);
const shape = new Map(lots.features.map((f) => [f.properties.objectid, f]));

const bbox = REGION.bbox ?? JSON.parse(await readFile(path.join(ROOT, '.cache', 'cadastre', 'meta.json'), 'utf8')).bbox;
const origin = [bbox[0], bbox[1]];
const bairros = [];
const bairroIdx = new Map();
const streets = new Map();
let kept = 0;
let noShape = 0;
for (const a of attrs) {
  const name = (a.logradouro ?? '').trim().replace(/\s+/g, ' ');
  if (!name || !(a.numero > 0)) continue;
  const f = shape.get(a.objectid);
  if (!f) {
    noShape++;
    continue;
  }
  const [lng, lat] = turfPointOnFeature(f).geometry.coordinates;
  const b = (a.bairro ?? '').trim();
  if (!bairroIdx.has(b)) bairroIdx.set(b, bairros.push(b) - 1);
  if (!streets.has(name)) streets.set(name, []);
  streets.get(name).push([a.numero, Math.round((lng - origin[0]) * 1e5), Math.round((lat - origin[1]) * 1e5), bairroIdx.get(b), Math.round(a.areaConstruida ?? 0)]);
  kept++;
}
const list = [...streets].sort((x, y) => x[0].localeCompare(y[0])).map(([n, rows]) => [n, rows.sort((x, y) => x[0] - y[0])]);
const json = `{"v":1,"origin":${JSON.stringify(origin)},"bairros":${JSON.stringify(bairros)},\n"streets":[\n${list.map((s) => JSON.stringify(s)).join(',\n')}\n]}\n`;
await writeFile(OUT, json);
console.log(`enderecos.json: ${kept} lotes com número em ${list.length} ruas (${noShape} sem contorno), ${(json.length / 1024 / 1024).toFixed(1)} MB`);
