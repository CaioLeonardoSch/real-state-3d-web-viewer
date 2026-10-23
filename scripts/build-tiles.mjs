#!/usr/bin/env node
// Turns the region GeoJSON (.cache/region/, from scripts/extract-region.py) into the files the app loads:
//   public/data/<region>.pmtiles   vector tiles: buildings, roads (with pavement class; the street name in the
//                                  close-up z15 tiles), water, green, bairros and the canopy of woods
//   public/data/<region>-detalhe.pmtiles  close-up detail (z15 only): low-poly roofs (scripts/lib/roofs.mjs), trees,
//                                  street lamps and their lights (scripts/lib/scenery.mjs). A separate file, so the
//                                  buildings draw first and the detail follows (it doubles the close-up weight)
//   public/data/bairros-areas.geojson  simplified neighbourhood polygons (the "bairro" filter cuts the map to them)
//   public/data/boundary.geojson   outline of the region (small; the app tests points against it)
//   public/data/bairros.geojson    neighbourhood outlines and names (labels)
//   public/data/ruas.json          street index of the search box: name, bairro and city, box and a point on the
//                                  street (scripts/lib/streets.mjs)
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
import { REGION } from './lib/region.mjs';
import { isResidentialBuilding } from './lib/residential.mjs';
import { writePmtiles } from './lib/pmtiles-writer.mjs';
import { clearings, cutCanopy, frame, lampPositions, lampShapes, sampleTrees, simplifyGeometry, surfaceClass, treeShapes, urbanMask } from './lib/scenery.mjs';
import { orientedRect, roofKind, roofShapes } from './lib/roofs.mjs';
import { OUTSIDE_FONT, displayName, mergeLines, roadMergeKey, streetIndex, streetIndexJson } from './lib/streets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '.cache', 'region');
const OUT = path.join(ROOT, 'public', 'data');

/**
 * Zoom range of each layer. From afar (z10–z13, whole region on screen) buildings are drawn flat, so those
 * tiles keep only the larger footprints, without attributes: the texture of the city at a fraction of the size.
 */
const OVERVIEW_MIN_AREA_M2 = { 10: 1500, 11: 600, 12: 250, 13: 120 };
/**
 * From afar the other layers also keep only what can be seen (the first view on a phone loads z10–z11 tiles):
 * minor streets, small parks and ponds and streams come in closer. Roads: zoom from which each class is in the tiles.
 */
const MAJOR_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const MINOR_ROADS = new Set(['residential', 'unclassified', 'living_street']);
const SERVICE_ROADS = new Set(['service', 'track', 'busway']);
const roadMinZoom = (highway) => {
  const h = highway.replace(/_link$/, '');
  return MAJOR_ROADS.has(h) ? 10 : MINOR_ROADS.has(h) ? 11 : SERVICE_ROADS.has(h) ? 13 : 14;
};
const GREEN_MIN_AREA_M2 = { 10: 50000, 11: 20000, 12: 5000, 13: 1000 };
const WATER_MIN_AREA_M2 = { 10: 20000, 11: 5000, 12: 1000 };
/** Layers of the close-up detail file (<region>-detalhe.pmtiles). */
const DETAIL_LAYERS = new Set(['roofs', 'trees', 'lamps', 'lights']);
/** Not streets on the ground: planned, under construction, stop platforms, indoor corridors, race tracks… */
const NOT_ROADS = new Set(['proposed', 'construction', 'platform', 'bus_stop', 'services', 'rest_area', 'raceway', 'corridor', 'elevator']);
const LAYERS = {
  buildings: { minzoom: 10, maxzoom: 15 },
  roads: { minzoom: 10, maxzoom: 15 },
  water: { minzoom: 10, maxzoom: 15 },
  green: { minzoom: 10, maxzoom: 15 },
  bairros: { minzoom: 10, maxzoom: 15 },
  // canopy mass of woods (woods shrunk by 6 m, scripts/extract-region.py), shown in 3D from zoom 14
  canopy: { minzoom: 14, maxzoom: 15 },
  // scenery: only in the closest tiles (the map shows them from zoom ~15.5, overzooming z15)
  roofs: { minzoom: 15, maxzoom: 15 },
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
roads.features = roads.features.filter((f) => !NOT_ROADS.has(f.properties.highway));
// trees and lamps mapped in OSM (older extractions do not have these files)
const [osmTrees, osmLamps, canopy] = await Promise.all(['trees', 'lamps', 'canopy'].map((n) => read(`${n}.geojson`).catch(() => EMPTY)));

// ---- scenery (before trimming the road properties: lamps need surface and lighting tags)
const lat0 = meta.center?.[1] ?? -26.3;
// where the city is: cells with buildings, grown ~200 m
const mask = urbanMask(buildings.features.map((f) => (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0][0] : f.geometry.coordinates[0][0][0])), 100, 2, lat0);
// clearings: no illustrative tree on a house or a street, and the canopy mass of woods cut back around them
const clear = clearings(buildings.features, roads.features, { lat0 });
const canopyCut = cutCanopy(canopy.features, clear);
canopy.features = canopyCut.features;
for (const f of canopy.features) f.properties = {};
const treeList = sampleTrees(green.features, osmTrees.features, mask, { lat0, blocked: clear.blocked });
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
// roofs from the outline, floors and use (before trimming the building properties)
const roofList = [];
const roofCounts = { gable: 0, hip: 0, tank: 0, flat: 0 };
const areas = new Map();
for (const f of buildings.features) {
  const { renderHeight, source } = computeRenderHeight(f.properties, cadastreFloors.get(f.properties.osmId));
  heightCounts[source]++;
  const area = turfArea(f);
  areas.set(f, area);
  const rect = orientedRect(outerRing(f.geometry), lat0);
  const kind = roofKind(f.properties, { area, height: renderHeight, floors: Math.round(renderHeight / 3), rect });
  roofCounts[kind]++;
  roofList.push(...roofShapes(f.properties.osmId, rect, kind, renderHeight, lat0));
  f.properties = { osmId: f.properties.osmId, height: renderHeight, residential: isResidentialBuilding(f.properties) };
}
const roofs = { type: 'FeatureCollection', features: roofList };
// street names (after the scenery, which seeds each lamp from its OSM way): only in the z15 tiles, where the map
// writes them (from zoom 16, overzooming z15); the overview zooms and z14 keep {highway, s} only
const namedRoads = [];
const roadsZ15 = [];
const renamed = new Set();
for (const f of roads.features) {
  const sc = surfaceClass(f.properties.highway, f.properties.surface);
  if (CAR_ROADS.has(f.properties.highway.replace(/_link$/, ''))) surfaceKm[sc || '?'] = (surfaceKm[sc || '?'] ?? 0) + lengthM(f.geometry) / 1000;
  const name = displayName(f.properties.name);
  if (name && name !== f.properties.name) renamed.add(`${f.properties.name} → ${name}`);
  // s: pavement class ('a' asphalt, 'c' paving stones, 'p' other paved, 'u' unpaved, '' unknown)
  f.properties = { highway: f.properties.highway, s: sc };
  if (!name) {
    roadsZ15.push(f);
    continue;
  }
  const named = { type: 'Feature', properties: { ...f.properties, name }, geometry: f.geometry };
  namedRoads.push(named);
  roadsZ15.push(named);
}
// pieces of one street (same name, class and pavement) joined where they meet: longer lines, room for the label
const roadLinesZ15 = mergeLines(roadsZ15, roadMergeKey);
for (const f of water.features) f.properties = { waterway: f.properties.waterway ?? 'area', k: f.properties.water ?? '' };
for (const f of green.features) f.properties = { k: f.properties.kind ?? 'park' };
// outlines in the tiles: neighbourhoods only (cities and districts are labels, their outline is the region's)
bairros.features = bairros.features.filter((f) => (f.properties.kind ?? 'bairro') === 'bairro');

const vt = (fc, maxZoom) => geojsonvt(fc, { maxZoom, indexMaxZoom: 5, indexMaxPoints: 100000, tolerance: 2, extent: 4096, buffer: 96 });
const fc = (features) => ({ type: 'FeatureCollection', features });
const indexes = Object.fromEntries(
  Object.entries({ buildings, roads: fc(roadLinesZ15), water, green, bairros, canopy, roofs, trees, lamps, lights }).map(([name, layer]) => [name, vt(layer, LAYERS[name].maxzoom)]),
);
// lighter indexes for the overview zooms (z10–z13), per layer. Built up to z14: geojson-vt does not simplify
// the tiles of an index's own maximum zoom (they keep every vertex for overzooming)
const OVERVIEW_INDEX_MAX_ZOOM = 14;
const overview = { buildings: {}, roads: {}, green: {}, water: {} };
for (const [z, minArea] of Object.entries(OVERVIEW_MIN_AREA_M2)) {
  overview.buildings[z] = vt(fc(buildings.features.filter((f) => areas.get(f) >= minArea).map((f) => ({ ...f, properties: {} }))), OVERVIEW_INDEX_MAX_ZOOM);
}
for (const z of [10, 11, 12, 13]) overview.roads[z] = vt(fc(roads.features.filter((f) => roadMinZoom(f.properties.highway) <= z)), OVERVIEW_INDEX_MAX_ZOOM);
// z14 roads without names, simplified as before: an index up to z15 (its z14 tiles are simplified, unlike its own z15)
overview.roads[14] = vt(roads, LAYERS.roads.maxzoom);
const greenArea = new Map(green.features.map((f) => [f, turfArea(f)]));
for (const [z, minArea] of Object.entries(GREEN_MIN_AREA_M2)) overview.green[z] = vt(fc(green.features.filter((f) => greenArea.get(f) >= minArea)), OVERVIEW_INDEX_MAX_ZOOM);
const waterArea = new Map(water.features.filter((f) => f.geometry.type !== 'LineString' && f.geometry.type !== 'MultiLineString').map((f) => [f, turfArea(f)]));
for (const [z, minArea] of Object.entries(WATER_MIN_AREA_M2)) {
  // lines: rivers and canals from afar, streams closer; areas: the larger ones from afar
  const keep = (f) => (waterArea.has(f) ? waterArea.get(f) >= minArea : f.properties.waterway !== 'stream');
  overview.water[z] = vt(fc(water.features.filter(keep)), OVERVIEW_INDEX_MAX_ZOOM);
}

// ---- tiles
const [w, s, e, n] = meta.boundaryBbox;
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const tiles = { base: [], detail: [] };
const perZoom = {};
for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
  for (let x = lon2x(w, z); x <= lon2x(e, z); x++) {
    for (let y = lat2y(n, z); y <= lat2y(s, z); y++) {
      const layers = { base: {}, detail: {} };
      for (const [name, idx] of Object.entries(indexes)) {
        if (z < LAYERS[name].minzoom || z > LAYERS[name].maxzoom) continue;
        const t = (overview[name]?.[z] ?? idx).getTile(z, x, y);
        if (t && t.features.length) layers[DETAIL_LAYERS.has(name) ? 'detail' : 'base'][name] = t;
      }
      for (const kind of ['base', 'detail']) {
        if (!Object.keys(layers[kind]).length) continue;
        const data = gzipSync(Buffer.from(vtpbf.fromGeojsonVt(layers[kind], { version: 2 })));
        tiles[kind].push({ z, x, y, data });
        const key = kind === 'base' ? `z${z}` : `z${z} detalhe`;
        (perZoom[key] ??= { tiles: 0, bytes: 0, max: 0 }).tiles++;
        perZoom[key].bytes += data.length;
        perZoom[key].max = Math.max(perZoom[key].max, data.length);
      }
    }
  }
}

const file = `${meta.region}.pmtiles`;
const detailFile = `${meta.region}-detalhe.pmtiles`;
for (const [kind, name] of [['base', file], ['detail', detailFile]]) {
  const layerIds = Object.keys(LAYERS).filter((id) => DETAIL_LAYERS.has(id) === (kind === 'detail'));
  const archive = writePmtiles(tiles[kind], {
    minZoom: kind === 'detail' ? 15 : MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    bounds: meta.boundaryBbox,
    center: meta.center,
    centerZoom: kind === 'detail' ? 15 : 13,
    metadata: {
      name: kind === 'detail' ? `${meta.regionName} (detalhe)` : meta.regionName,
      attribution: '© OpenStreetMap contributors (ODbL)',
      description: `Extrato ${meta.source} (${meta.osmTimestamp})`,
      vector_layers: layerIds.map((id) => ({ id, ...LAYERS[id], fields: {} })),
    },
  });
  await writeFile(path.join(OUT, name), archive);
}

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
// streets of the search box: one entry per name and place (bairro or distrito, and city), each stretch of a street
// in the place it lies in
const streets = streetIndex(namedRoads, await read('bairros.geojson'), { lat0 });
await writeFile(path.join(OUT, 'ruas.json'), streetIndexJson(streets));
// the relief (scripts/build-terrain.mjs) is built apart and rarely: keep what the published meta.json says of it
const published = await readFile(path.join(OUT, 'meta.json'), 'utf8').then(JSON.parse, () => ({}));
const terrain = published.terrainTiles ? { terrainTiles: published.terrainTiles, terrain: published.terrain } : {};
const outMeta = {
  ...meta,
  tiles: file,
  detailTiles: detailFile,
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
    roofs: roofCounts,
    // OSM ways with a name, the lines they make in the z15 tiles once joined, and the search box's streets
    namedRoads: namedRoads.length,
    namedRoadLines: roadLinesZ15.filter((f) => f.properties.name).length,
    streets: streets.streets.length,
    streetNames: new Set(streets.streets.map((r) => r[0])).size,
    // 'a' asphalt, 'c' paving stones, 'p' other paved, 'u' unpaved, '?' not mapped
    roadKmBySurface: Object.fromEntries(Object.entries(surfaceKm).map(([k, v]) => [k, Math.round(v * 10) / 10])),
  },
  heightSources: heightCounts.cadastre
    ? ['OpenStreetMap', `${REGION.cadastre.label}: área construída por lote`]
    : ['OpenStreetMap'],
  ...terrain,
};
await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(outMeta, null, 2) + '\n');

const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
console.log(`Telhados: ${JSON.stringify(roofCounts)} (${roofList.length} peças)`);
console.log(`Cenário: ${treeList.length} árvores (${outMeta.counts.treesFromOsm} do OSM), ${lampList.length} postes (${outMeta.counts.lampsFromOsm} do OSM), máscara urbana ${mask.size} células de 100 m`);
console.log(
  `Ruas: ${namedRoads.length} trechos com nome, ${outMeta.counts.namedRoadLines} linhas nos tiles z15 (vias: ${roads.features.length} → ${roadLinesZ15.length}); ` +
    `ruas.json: ${streets.streets.length} ruas, ${outMeta.counts.streetNames} nomes, ${streets.places.length} lugares, ${kb((await stat(path.join(OUT, 'ruas.json'))).size)}`,
);
if (renamed.size) console.log(`  nomes ajustados: ${[...renamed].join('; ')}`);
const unfit = [...new Set(namedRoads.map((f) => f.properties.name).filter((n) => OUTSIDE_FONT.test(n)))];
if (unfit.length) console.warn(`  AVISO: nomes com letras fora da fonte do mapa (o rótulo não aparece): ${unfit.join('; ')}`);
console.log(`Matas: ${canopyCut.cut} copas com casas ou ruas por perto, recortadas${canopyCut.failed ? ` (${canopyCut.failed} mantidas inteiras: recorte falhou)` : ''}`);
console.log(`${file}: ${tiles.base.length} tiles, ${kb((await stat(path.join(OUT, file))).size)}`);
console.log(`${detailFile}: ${tiles.detail.length} tiles, ${kb((await stat(path.join(OUT, detailFile))).size)}`);
for (const [z, v] of Object.entries(perZoom)) console.log(`  ${z}: ${v.tiles} tiles, ${kb(v.bytes)} (maior ${kb(v.max)})`);
console.log(`Alturas: ${JSON.stringify(heightCounts)}`);

/** Outer ring of a building (the largest part of a multipolygon). */
function outerRing(g) {
  if (g.type === 'Polygon') return g.coordinates[0];
  let best = g.coordinates[0][0];
  let bestA = -1;
  for (const poly of g.coordinates) {
    const r = poly[0];
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
    if (Math.abs(a) > bestA) [best, bestA] = [r, Math.abs(a)];
  }
  return best;
}

/** Coordinates rounded to 6 decimals (≈ 0.1 m): smaller file, same shape. */
function roundGeometry(g) {
  const r = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6] : c.map(r));
  return { type: g.type, coordinates: r(g.coordinates) };
}
