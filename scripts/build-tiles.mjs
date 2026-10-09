#!/usr/bin/env node
// Turns the region GeoJSON (.cache/region/, from scripts/extract-region.py) into the files the app loads:
//   public/data/<region>.pmtiles   vector tiles: buildings, roads, water, green, bairros
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
};
const MIN_ZOOM = 10;
const MAX_ZOOM = 15;

const read = async (f) => JSON.parse(await readFile(path.join(SRC, f), 'utf8'));
const meta = await read('meta.json');
const [buildings, roads, water, green, bairros, boundary] = await Promise.all(
  ['buildings', 'roads', 'water', 'green', 'bairros', 'boundary'].map((n) => read(`${n}.geojson`)),
);

// ---- properties kept in the tiles (small: only what the style and the app read)
// heights: OSM tags, else floors estimated from the city cadastre (scripts/estimate-heights.mjs), else 6 m
const cadastreFloors = await loadCadastreFloors(ROOT);
const heightCounts = { height: 0, levels: 0, cadastre: 0, default: 0 };
for (const f of buildings.features) {
  const { renderHeight, source } = computeRenderHeight(f.properties, cadastreFloors.get(f.properties.osmId));
  heightCounts[source]++;
  f.properties = { osmId: f.properties.osmId, height: renderHeight, residential: isResidentialBuilding(f.properties) };
}
for (const f of roads.features) f.properties = { highway: f.properties.highway };
for (const f of water.features) f.properties = { waterway: f.properties.waterway ?? 'area' };
for (const f of green.features) f.properties = {};
// outlines in the tiles: neighbourhoods only (cities and districts are labels, their outline is the region's)
bairros.features = bairros.features.filter((f) => (f.properties.kind ?? 'bairro') === 'bairro');

const vt = (fc, maxZoom) => geojsonvt(fc, { maxZoom, indexMaxZoom: 5, indexMaxPoints: 100000, tolerance: 2, extent: 4096, buffer: 96 });
const indexes = Object.fromEntries(
  Object.entries({ buildings, roads, water, green, bairros }).map(([name, fc]) => [name, vt(fc, LAYERS[name].maxzoom)]),
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
  },
  heightSources: heightCounts.cadastre
    ? ['OpenStreetMap', 'Cadastro imobiliário da Prefeitura de Joinville (SIMGeo): área construída por lote']
    : ['OpenStreetMap'],
};
await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(outMeta, null, 2) + '\n');

const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
console.log(`${file}: ${tiles.length} tiles, ${kb((await stat(path.join(OUT, file))).size)}`);
for (const [z, v] of Object.entries(perZoom)) console.log(`  z${z}: ${v.tiles} tiles, ${kb(v.bytes)} (maior ${kb(v.max)})`);
console.log(`Alturas: ${JSON.stringify(heightCounts)}`);
