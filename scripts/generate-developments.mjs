#!/usr/bin/env node
// Builds public/data/developments.json from scripts/data/developments.mjs: tower footprints facing their
// street, one cell per unit position, the stack of levels and every unit with an ILLUSTRATIVE price and
// FICTIONAL availability. Deterministic (fixed seed per development).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import turfBbox from '@turf/bbox';
import turfBearing from '@turf/bearing';
import turfBooleanIntersects from '@turf/boolean-intersects';
import turfBooleanPointInPolygon from '@turf/boolean-point-in-polygon';
import turfDestination from '@turf/destination';
import turfNearestPointOnLine from '@turf/nearest-point-on-line';
import { lineString, point, polygon } from '@turf/helpers';
import { DEVELOPMENTS } from './data/developments.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const SEED = 20261008;
/** Gap between the street centreline and the tower (half a street + front setback), metres. */
const SETBACK_M = 9;
/** Built floor plate ≈ private area of the units × this factor (walls, halls, elevators). */
const PLATE_FACTOR = 1.3;
const STAGE_SOLD = { launch: 0.3, construction: 0.6, ready: 0.8 };

// Region GeoJSON from scripts/extract-region.py (not versioned)
const readJson = async (f) => JSON.parse(await readFile(path.join(ROOT, '.cache', 'region', f), 'utf8'));
const [boundaryFc, buildingsFc, roadsFc] = await Promise.all(['boundary.geojson', 'buildings.geojson', 'roads.geojson'].map(readJson));
const boundary = boundaryFc.features[0];

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const round = (n, d = 7) => Number(n.toFixed(d));

/** Point `along` metres in the direction `bearing` and `perp` metres to its right (bearing + 90°). */
function offset(origin, along, perp, bearing) {
  const step = (from, dist, b) =>
    dist === 0 ? from : turfDestination(point(from), Math.abs(dist), dist < 0 ? b + 180 : b, { units: 'meters' }).geometry.coordinates;
  return step(step(origin, along, bearing), perp, bearing + 90);
}

/** Rectangle in a local frame (x along the street, y away from it), as a GeoJSON polygon ring. */
function rect(origin, bearing, side, x0, x1, y0, y1) {
  const corners = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ].map(([x, y]) => offset(origin, x, side * y, bearing).map((n) => round(n)));
  return polygon([[...corners, corners[0]]]).geometry;
}

const roadLines = [];
for (const r of roadsFc.features) {
  const lines = r.geometry.type === 'LineString' ? [r.geometry.coordinates] : r.geometry.type === 'MultiLineString' ? r.geometry.coordinates : [];
  for (const coords of lines) if (coords.length >= 2) roadLines.push({ ls: lineString(coords), name: r.properties.name, highway: r.properties.highway });
}
const CAR_ROADS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service']);
const bboxOverlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const carRoads = roadLines.filter((r) => CAR_ROADS.has(r.highway)).map((r) => ({ ...r, bbox: turfBbox(r.ls) }));

const out = [];
const placed = [];
for (const dev of DEVELOPMENTS) {
  const rand = mulberry32(SEED ^ strHash(dev.id));
  const { cols, rows } = dev.grid;

  // ---- floor plate: the typical floor with the most private area
  const residential = dev.levels.filter((l) => l.use === 'residential');
  const plateArea = Math.max(...residential.map((l) => l.units.reduce((s, u) => s + u.areaM2, 0))) * PLATE_FACTOR;
  const front = Math.sqrt(plateArea * (cols / rows) * 1.1);
  const depth = plateArea / front;

  // ---- face the named street, at the point nearest to the geocoded address
  const street = roadLines.filter((r) => r.name === dev.street);
  if (!street.length) throw new Error(`${dev.id}: street "${dev.street}" not in roads.geojson`);
  let best = null;
  for (const r of street) {
    const np = turfNearestPointOnLine(r.ls, point(dev.location), { units: 'meters' });
    if (!best || np.properties.pointDistance < best.np.properties.pointDistance) best = { r, np };
  }
  const coords = best.r.ls.geometry.coordinates;
  const i = Math.min(best.np.properties.segmentIndex, coords.length - 2);
  const bearing = turfBearing(point(coords[i]), point(coords[i + 1]));
  const onStreet = best.np.geometry.coordinates;
  // which side of the street the address is on (geocoded points of a house sit off the centreline)
  const toAddr = turfBearing(point(onStreet), point(dev.location));
  const rel = (((toAddr - bearing) % 360) + 360) % 360;
  const preferred = best.np.properties.pointDistance < 1 ? 1 : rel < 180 ? 1 : -1;

  // ---- slide along the street until the tower clears every road and the other towers
  let footprint = null;
  let origin = null;
  let side = preferred;
  search: for (const s of [preferred, -preferred]) {
    for (const shift of [0, 6, -6, 12, -12, 18, -18, 24, -24, 32, -32, 40, -40, 50, -50, 60, -60]) {
      const o = offset(onStreet, shift, 0, bearing);
      const fp = rect(o, bearing, s, -front / 2, front / 2, SETBACK_M, SETBACK_M + depth);
      const fb = turfBbox(fp);
      if (fp.coordinates[0].some((c) => !turfBooleanPointInPolygon(point(c), boundary))) continue;
      if (carRoads.some((r) => bboxOverlap(fb, r.bbox) && turfBooleanIntersects(fp, r.ls))) continue;
      if (placed.some((p) => turfBooleanIntersects(fp, p))) continue;
      footprint = fp;
      origin = o;
      side = s;
      break search;
    }
  }
  if (!footprint) throw new Error(`${dev.id}: no room for a ${front.toFixed(0)}×${depth.toFixed(0)} m tower near ${dev.address}`);
  placed.push(footprint);

  // ---- unit cells: row 0 faces the street
  const cellW = front / cols;
  const cellD = depth / rows;
  const cellBox = (c) => {
    const col = c % cols;
    const row = Math.floor(c / cols);
    return [-front / 2 + col * cellW, -front / 2 + (col + 1) * cellW, SETBACK_M + row * cellD, SETBACK_M + (row + 1) * cellD];
  };
  const centre = offset(origin, 0, side * (SETBACK_M + depth / 2), bearing);
  const shapes = [];
  const shapeIndex = new Map();
  /** Polygon covering contiguous cells (a penthouse may take two). */
  function shapeFor(cells) {
    const key = cells.join(',');
    if (!shapeIndex.has(key)) {
      const boxes = cells.map(cellBox);
      const [x0, x1, y0, y1] = [
        Math.min(...boxes.map((b) => b[0])),
        Math.max(...boxes.map((b) => b[1])),
        Math.min(...boxes.map((b) => b[2])),
        Math.max(...boxes.map((b) => b[3])),
      ];
      const shape = rect(origin, bearing, side, x0 + 0.4, x1 - 0.4, y0 + 0.4, y1 - 0.4);
      const mid = offset(origin, (x0 + x1) / 2, side * ((y0 + y1) / 2), bearing);
      // facing: from the tower centre towards the unit; a full-width unit faces its row's side
      const facing = Math.abs(x1 - x0 - front) < 0.01 ? (y0 === SETBACK_M ? bearing - 90 * side : bearing + 90 * side) : turfBearing(point(centre), point(mid));
      shapeIndex.set(key, shapes.length);
      shapes.push({ polygon: shape, facing: Math.round((((facing % 360) + 360) % 360)) });
    }
    return shapeIndex.get(key);
  }

  // ---- levels and units
  const levels = [];
  let unitCount = 0;
  const firstResidential = Math.min(...residential.map((l) => l.from));
  for (const spec of dev.levels) {
    for (let level = spec.from; level <= spec.to; level++) {
      const base = round(level * dev.floorHeightM, 2);
      const entry = { level, use: spec.use, base, top: round(base + dev.floorHeightM, 2), units: [] };
      for (const u of spec.units ?? []) {
        const shape = shapeFor(u.cells);
        // illustrative price: higher floors and larger plans cost more per m²
        const floorPremium = 1 + 0.01 * (level - firstResidential);
        const price = Math.round((u.areaM2 * dev.pricePerM2 * floorPremium * (0.97 + rand() * 0.06)) / 1000) * 1000;
        const soldOdds = Math.min(0.97, STAGE_SOLD[dev.stage] + 0.012 * (level - firstResidential));
        const r = rand();
        const status = r < soldOdds ? 'sold' : r < soldOdds + 0.08 ? 'reserved' : 'available';
        const number = `${level}${String(u.final).padStart(2, '0')}`;
        entry.units.push({
          id: `${dev.id}-${number}`,
          number,
          final: u.final,
          plan: u.plan,
          areaM2: u.areaM2,
          bedrooms: u.bedrooms,
          suites: u.suites,
          parkingSpots: u.parking,
          shape,
          cells: u.cells.length,
          price,
          status,
        });
        unitCount++;
      }
      levels.push(entry);
    }
  }
  levels.sort((a, b) => a.level - b.level);
  if (dev.expectedUnits && unitCount !== dev.expectedUnits)
    throw new Error(`${dev.id}: ${unitCount} units, but the developer announces ${dev.expectedUnits}`);

  // OSM buildings on the plot are assumed demolished for the tower
  const fb = turfBbox(footprint);
  const hiddenBuildingIds = buildingsFc.features
    .filter((b) => bboxOverlap(fb, turfBbox(b)) && turfBooleanIntersects(footprint, b))
    .map((b) => b.properties.osmId);

  out.push({
    id: dev.id,
    name: dev.name,
    developer: dev.developer,
    address: dev.address,
    location: dev.location,
    locationNote: dev.locationNote,
    stage: dev.stage,
    delivery: dev.delivery,
    floorHeightM: dev.floorHeightM,
    facts: dev.facts,
    estimates: dev.estimates,
    sources: dev.sources,
    footprint,
    center: centre.map((n) => round(n)),
    grid: dev.grid,
    shapes,
    hiddenBuildingIds,
    levels,
  });
  const n = (s) => levels.flatMap((l) => l.units).filter((u) => u.status === s).length;
  console.log(
    `${dev.id.padEnd(15)} ${levels.length} níveis, ${unitCount} unidades (${n('available')} disp., ${n('reserved')} res., ${n('sold')} vend.), ` +
      `torre ${front.toFixed(0)}×${depth.toFixed(0)} m, ${hiddenBuildingIds.length} prédios do OSM ocultos`,
  );
}

await writeFile(
  path.join(DATA, 'developments.json'),
  JSON.stringify(
    {
      notice:
        'Endereço, metragens, tipologias, número de unidades e prazos vêm da divulgação pública das incorporadoras (ver sources). ' +
        'Posição da torre, distribuição por andar, preços e disponibilidade são estimativas ou FICTÍCIOS, só para demonstração. ' +
        'Sem vínculo com Halsten ou Plaenge.',
      seed: SEED,
      developments: out,
    },
    null,
    1,
  ) + '\n',
);
