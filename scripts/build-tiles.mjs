#!/usr/bin/env node
// Turns the region GeoJSON (.cache/region/, from scripts/extract-region.py) into the files the app loads:
//   public/data/<region>.pmtiles   vector tiles: buildings, roads (with pavement class), water, green, bairros, and
//                                  up close (z15) low-poly trees, street lamps and their lights (scripts/lib/scenery.mjs)
//   public/data/bairros-areas.geojson  simplified neighbourhood polygons (the "bairro" filter cuts the map to them)
//   public/data/boundary.geojson   outline of the region (small; the app tests points against it)
//   public/data/bairros.geojson    neighbourhood outlines and names (labels)
//   public/data/meta.json          centre, bounds, counts
// The browser only downloads the tiles in view (HTTP range requests on the single .pmtiles file).
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import turfCentroid from '@turf/centroid';
import turfPointOnFeature from '@turf/point-on-feature';
import turfArea from '@turf/area';
import { computeRenderHeight, loadCadastreFloors } from './lib/height.mjs';
import { isResidentialBuilding } from './lib/residential.mjs';
import { writePmtiles } from './lib/pmtiles-writer.mjs';
import { frame, lampPositions, lampShapes, sampleTrees, simplifyGeometry, surfaceClass, treeShapes, urbanMask } from './lib/scenery.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '.cache', 'region');
const OUT = path.join(ROOT, 'public', 'data');

/**
 * Zoom range of each layer. From afar (z10–z13, whole region on screen) buildings are drawn flat, so those
 * tiles keep only the larger footprints, without attributes: the texture of the city at a fraction of the size.
 */
const OVERVIEW_MIN_AREA_M2 = { 10: 1500, 11: 600, 12: 250, 13: 120 };
const LAYERS = {
  buildings: { minzoom: 10, maxzoom: 15 },
  roads: { minzoom: 10, maxzoom: 15 },
  water: { minzoom: 10, maxzoom: 15 },
  green: { minzoom: 10, maxzoom: 15 },
  bairros: { minzoom: 10, maxzoom: 15 },
  // canopy mass of woods (woods shrunk by 6 m, scripts/extract-region.py), shown in 3D from zoom 14
  canopy: { minzoom: 14, maxzoom: 15 },
  // scenery: only in the closest tiles (the map shows them from zoom ~15.5, overzooming z15)
  trees: { minzoom: 15, maxzoom: 15 },
  lamps: { minzoom: 15, maxzoom: 15 },
  lights: { minzoom: 15, maxzoom: 15 },
};
const MIN_ZOOM = 10;
const MAX_ZOOM = 15;

const read = async (f) => JSON.parse(await readFile(path.join(SRC, f), 'utf8'));
const meta = await read('meta.json');
const [buildings, roads, water, green, bairros, boundary] = await Promise.all(
  ['buildings', 'roads', 'water', 'green', 'bairros', 'boundary'].map((n) => read(`${n}.geojson`)),
);
const EMPTY = { type: 'FeatureCollection', features: [] };
// trees and lamps mapped in OSM (older extractions do not have these files)
const [osmTrees, osmLamps, canopy] = await Promise.all(['trees', 'lamps', 'canopy'].map((n) => read(`${n}.geojson`).catch(() => EMPTY)));
for (const f of canopy.features) f.properties = {};

// ---- scenery (before trimming the road properties: lamps need surface and lighting tags)
const lat0 = meta.center?.[1] ?? -26.3;
// where the city is: cells with buildings, grown ~200 m
const mask = urbanMask(buildings.features.map((f) => (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0][0] : f.geometry.coordinates[0][0][0])), 100, 2, lat0);
const treeList = sampleTrees(green.features, osmTrees.features, mask, { lat0 });
const trees = { type: 'FeatureCollection', features: treeList.flatMap((t) => treeShapes(t, lat0)) };
const lampList = lampPositions(roads.features, osmLamps.features, mask, lat0);
const lampParts = lampList.map((l) => lampShapes(l, lat0));
const lamps = { type: 'FeatureCollection', features: lampParts.flatMap((l) => l.shapes) };
const lights = { type: 'FeatureCollection', features: lampParts.map((l) => l.light) };
// kilometres of street for cars by pavement class (meta.json; the monthly report compares them)
const CAR_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'track']);
const { kx, ky } = frame(lat0);
const lengthM = (g) =>
  (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []).reduce(
    (m, line) => line.reduce((acc, c, i) => (i ? acc + Math.hypot((c[0] - line[i - 1][0]) * kx, (c[1] - line[i - 1][1]) * ky) : acc), m),
    0,
  );
const surfaceKm = {};

// ---- properties kept in the tiles (small: only what the style and the app read)
// heights: OSM tags, else floors estimated from the city cadastre (scripts/estimate-heights.mjs), else 6 m
const cadastreFloors = await loadCadastreFloors(ROOT);
const heightCounts = { height: 0, levels: 0, cadastre: 0, default: 0 };
for (const f of buildings.features) {
  const { renderHeight, source } = computeRenderHeight(f.properties, cadastreFloors.get(f.properties.osmId));
  heightCounts[source]++;
  f.properties = { osmId: f.properties.osmId, height: renderHeight, residential: isResidentialBuilding(f.properties) };
}
for (const f of roads.features) {
  const sc = surfaceClass(f.properties.highway, f.properties.surface);
  if (CAR_ROADS.has(f.properties.highway.replace(/_link$/, ''))) surfaceKm[sc || '?'] = (surfaceKm[sc || '?'] ?? 0) + lengthM(f.geometry) / 1000;
  // s: pavement class ('a' asphalt, 'c' paving stones, 'p' other paved, 'u' unpaved, '' unknown)
  f.properties = { highway: f.properties.highway, s: sc };
}
for (const f of water.features) f.properties = { waterway: f.properties.waterway ?? 'area', k: f.properties.water ?? '' };
for (const f of green.features) f.properties = { k: f.properties.kind ?? 'park' };
// outlines in the tiles: neighbourhoods only (cities and districts are labels, their outline is the region's)
bairros.features = bairros.features.filter((f) => (f.properties.kind ?? 'bairro') === 'bairro');

const vt = (fc, maxZoom) => geojsonvt(fc, { maxZoom, indexMaxZoom: 5, indexMaxPoints: 100000, tolerance: 2, extent: 4096, buffer: 96 });
const indexes = Object.fromEntries(
  Object.entries({ buildings, roads, water, green, bairros, canopy, trees, lamps, lights }).map(([name, fc]) => [name, vt(fc, LAYERS[name].maxzoom)]),
);
const areas = new Map(buildings.features.map((f) => [f, turfArea(f)]));
const overviewBuildings = Object.fromEntries(
  Object.entries(OVERVIEW_MIN_AREA_M2).map(([z, minArea]) => [
    z,
    vt(
      {
        type: 'FeatureCollection',
        features: buildings.features.filter((f) => areas.get(f) >= minArea).map((f) => ({ ...f, properties: {} })),
      },
      Number(z),
    ),
  ]),
);

// ---- tiles
const [w, s, e, n] = meta.boundaryBbox;
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const tiles = [];
const perZoom = {};
for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
  for (let x = lon2x(w, z); x <= lon2x(e, z); x++) {
    for (let y = lat2y(n, z); y <= lat2y(s, z); y++) {
      const layers = {};
      for (const [name, idx] of Object.entries(indexes)) {
        if (z < LAYERS[name].minzoom || z > LAYERS[name].maxzoom) continue;
        const t = (name === 'buildings' && overviewBuildings[z] ? overviewBuildings[z] : idx).getTile(z, x, y);
        if (t && t.features.length) layers[name] = t;
      }
      if (!Object.keys(layers).length) continue;
      const data = gzipSync(Buffer.from(vtpbf.fromGeojsonVt(layers, { version: 2 })));
      tiles.push({ z, x, y, data });
      (perZoom[z] ??= { tiles: 0, bytes: 0, max: 0 }).tiles++;
      perZoom[z].bytes += data.length;
      perZoom[z].max = Math.max(perZoom[z].max, data.length);
    }
  }
}

const file = `${meta.region}.pmtiles`;
const archive = writePmtiles(tiles, {
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
  bounds: meta.boundaryBbox,
  center: meta.center,
  centerZoom: 13,
  metadata: {
    name: meta.regionName,
    attribution: '© OpenStreetMap contributors (ODbL)',
    description: `Extrato ${meta.source} (${meta.osmTimestamp})`,
    vector_layers: Object.entries(LAYERS).map(([id, z]) => ({ id, ...z, fields: {} })),
  },
});
await writeFile(path.join(OUT, file), archive);

// ---- small files read directly by the app
// simplified outline (≈ 10 m) when available: the full municipal coastline is much larger
const simple = await read('boundary-simple.geojson').catch(() => boundary);
await writeFile(path.join(OUT, 'boundary.geojson'), JSON.stringify(simple));
const labels = {
  type: 'FeatureCollection',
  features: (await read('bairros.geojson')).features.map((f) => ({
    type: 'Feature',
    properties: { name: f.properties.name, kind: f.properties.kind ?? 'bairro' },
    // label point inside the polygon (a centroid can fall outside a concave neighbourhood)
    geometry: turfPointOnFeature(f).geometry,
  })),
};
await writeFile(path.join(OUT, 'bairros.geojson'), JSON.stringify(labels));
// neighbourhood areas for the "bairro" filter, simplified to ≈ 3 m, each with its area grown by 100 m
// (scripts/extract-region.py): the map shows the grown area and masks the rest
const grown = new Map((await read('bairros-buffer.geojson').catch(() => EMPTY)).features.map((f) => [f.properties.name, f.geometry]));
const areas3m = {
  type: 'FeatureCollection',
  features: (await read('bairros.geojson')).features
    .filter((f) => (f.properties.kind ?? 'bairro') === 'bairro')
    .map((f) => ({
      type: 'Feature',
      properties: { name: f.properties.name, ...(grown.has(f.properties.name) ? { grown: roundGeometry(grown.get(f.properties.name)) } : {}) },
      geometry: roundGeometry(simplifyGeometry(f.geometry, 0.00003)),
    })),
};
await writeFile(path.join(OUT, 'bairros-areas.geojson'), JSON.stringify(areas3m));
const outMeta = {
  ...meta,
  tiles: file,
  tileZooms: LAYERS,
  center: meta.center ?? turfCentroid(boundary).geometry.coordinates,
  counts: {
    ...meta.counts,
    heightFromTag: heightCounts.height,
    heightFromLevels: heightCounts.levels,
    heightFromCadastre: heightCounts.cadastre,
    heightDefault: heightCounts.default,
    trees: treeList.length,
    treesFromOsm: treeList.filter((t) => t.mapped).length,
    lamps: lampList.length,
    lampsFromOsm: lampList.filter((l) => l.mapped).length,
    // 'a' asphalt, 'c' paving stones, 'p' other paved, 'u' unpaved, '?' not mapped
    roadKmBySurface: Object.fromEntries(Object.entries(surfaceKm).map(([k, v]) => [k, Math.round(v * 10) / 10])),
  },
  heightSources: heightCounts.cadastre
    ? ['OpenStreetMap', 'Cadastro imobiliário da Prefeitura de Joinville (SIMGeo): área construída por lote']
    : ['OpenStreetMap'],
};
await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(outMeta, null, 2) + '\n');

const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
console.log(`Cenário: ${treeList.length} árvores (${outMeta.counts.treesFromOsm} do OSM), ${lampList.length} postes (${outMeta.counts.lampsFromOsm} do OSM), máscara urbana ${mask.size} células de 100 m`);
console.log(`${file}: ${tiles.length} tiles, ${kb((await stat(path.join(OUT, file))).size)}`);
for (const [z, v] of Object.entries(perZoom)) console.log(`  z${z}: ${v.tiles} tiles, ${kb(v.bytes)} (maior ${kb(v.max)})`);
console.log(`Alturas: ${JSON.stringify(heightCounts)}`);

/** Coordinates rounded to 6 decimals (≈ 0.1 m): smaller file, same shape. */
function roundGeometry(g) {
  const r = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6] : c.map(r));
  return { type: g.type, coordinates: r(g.coordinates) };
}
