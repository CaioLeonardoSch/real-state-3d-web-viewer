#!/usr/bin/env node
// Estimates the number of floors of each OSM building from the city cadastre (built area per lot),
// for buildings without `height` / `building:levels` in OSM. Reads .cache/region/buildings.geojson and
// .cache/cadastre/ (scripts/download-cadastre.mjs); writes .cache/region/heights.json:
//   { "<osmId>": { "floors": n, "capped": true? } }
//
// Per lot (a building belongs to the lot that contains its interior point):
//   - built area C (cadastre) and footprint F = sum of the OSM footprints in the lot; ratio = C / F;
//   - ratio < 0.2 or > 32 → cadastre and OSM disagree (unmapped buildings, outline covering several lots…): skip;
//   - one main building (≥ 70% of F): the rest count as one floor, the main one gets the remaining area;
//     more than 4 floors on a footprint under 150 m² means the tower itself is not mapped in OSM: skip;
//   - several similar buildings (e.g. a condominium of houses): all get round(ratio) floors, at most 4;
//   - at most 32 floors (Joinville's tallest have ~30); where the lot has a granted height (OODC), height ≤ it.
// Skipped buildings keep the default height of the map (6 m).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import turfArea from '@turf/area';
import turfBbox from '@turf/bbox';
import turfBooleanPointInPolygon from '@turf/boolean-point-in-polygon';
import turfPointOnFeature from '@turf/point-on-feature';
import { METERS_PER_LEVEL, parseOsmNumber } from './lib/height.mjs';
import { floorsForLot } from './lib/cadastre-floors.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (...p) => JSON.parse(await readFile(path.join(ROOT, '.cache', ...p), 'utf8'));
const [buildings, lots, attrs, oodc] = await Promise.all([
  read('region', 'buildings.geojson'),
  read('cadastre', 'lotes.geojson'),
  read('cadastre', 'atributos.json'),
  read('cadastre', 'oodc.geojson'),
]);
const builtArea = new Map(attrs.map((a) => [a.objectid, a.areaConstruida]));

// ---- grid index of lot bounding boxes (≈ 200 m cells)
const CELL = 0.002;
const grid = new Map();
const key = (x, y) => `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;
const seen = new Set();
for (const lot of lots.features) {
  const id = lot.properties.objectid;
  if (!lot.geometry || seen.has(id)) continue; // pages may repeat a record
  seen.add(id);
  const [w, s, e, n] = turfBbox(lot);
  lot.bbox = [w, s, e, n];
  for (let x = Math.floor(w / CELL); x <= Math.floor(e / CELL); x++)
    for (let y = Math.floor(s / CELL); y <= Math.floor(n / CELL); y++) {
      const k = `${x}:${y}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(lot);
    }
}
const lotAt = ([x, y]) =>
  (grid.get(key(x, y)) ?? []).find(
    (l) => x >= l.bbox[0] && x <= l.bbox[2] && y >= l.bbox[1] && y <= l.bbox[3] && turfBooleanPointInPolygon([x, y], l),
  );

// ---- buildings without an OSM height, grouped by lot
const stats = { osmHeight: 0, noLot: 0, noBuiltArea: 0, inconsistent: 0, estimated: 0, capped: 0 };
const byLot = new Map();
for (const b of buildings.features) {
  const p = b.properties;
  if (parseOsmNumber(p.height) > 0 || parseOsmNumber(p['building:levels']) > 0) {
    stats.osmHeight++;
    continue;
  }
  const at = turfPointOnFeature(b).geometry.coordinates;
  const lot = lotAt(at);
  if (!lot) {
    stats.noLot++;
    continue;
  }
  const id = lot.properties.objectid;
  if (!byLot.has(id)) byLot.set(id, { lot, items: [] });
  byLot.get(id).items.push({ b, area: turfArea(b), at });
}

// ---- OODC: granted height per lot outline
const grants = oodc.features
  .filter((f) => f.geometry)
  .map((f) => ({ f, limit: Number(f.properties.alt_out ?? f.properties.altura) }))
  .filter((g) => g.limit > 0);
const grantAt = (pt) => grants.find((g) => turfBooleanPointInPolygon(pt, g.f))?.limit;

const out = {};
const floorsHist = {};
for (const { lot, items } of byLot.values()) {
  const C = builtArea.get(lot.properties.objectid);
  if (!(C > 0)) {
    stats.noBuiltArea += items.length;
    continue;
  }
  const floorsList = floorsForLot(C, items.map((i) => i.area));
  if (!floorsList) {
    stats.inconsistent += items.length;
    continue;
  }
  for (const [k, i] of items.entries()) {
    let floors = floorsList[k];
    const limit = grantAt(i.at);
    const capped = limit !== undefined && floors * METERS_PER_LEVEL > limit;
    if (capped) {
      floors = Math.max(1, Math.floor(limit / METERS_PER_LEVEL));
      stats.capped++;
    }
    out[i.b.properties.osmId] = capped ? { floors, capped } : { floors };
    floorsHist[floors] = (floorsHist[floors] ?? 0) + 1;
    stats.estimated++;
  }
}

await writeFile(path.join(ROOT, '.cache', 'region', 'heights.json'), JSON.stringify(out));
const total = buildings.features.length;
console.log(`Prédios: ${total}`);
console.log(`  altura do OSM: ${stats.osmHeight}`);
console.log(`  estimada pelo cadastro: ${stats.estimated} (${((100 * stats.estimated) / total).toFixed(1)}%), ${stats.capped} limitados pela outorga`);
console.log(`  sem lote: ${stats.noLot} · lote sem área construída: ${stats.noBuiltArea} · cadastro × OSM inconsistentes: ${stats.inconsistent}`);
console.log(`  pavimentos: ${Object.entries(floorsHist).map(([f, n]) => `${f}: ${n}`).join(' · ')}`);
