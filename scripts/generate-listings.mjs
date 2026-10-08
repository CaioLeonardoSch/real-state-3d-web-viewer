#!/usr/bin/env node
// Generates FICTIONAL demo listings (public/data/listings.json) on top of real OSM buildings.
// Deterministic: fixed seed, no Date/Math.random. Re-running produces the same file
// as long as public/data/*.geojson do not change.
//
// Usage: node scripts/generate-listings.mjs [--count N]   (default 30, between 4 and 80)

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import turfArea from '@turf/area';
import turfBbox from '@turf/bbox';
import turfCentroid from '@turf/centroid';
import turfDistance from '@turf/distance';
import turfDestination from '@turf/destination';
import turfBooleanIntersects from '@turf/boolean-intersects';
import turfBooleanPointInPolygon from '@turf/boolean-point-in-polygon';
import turfNearestPointOnLine from '@turf/nearest-point-on-line';
import turfBearing from '@turf/bearing';
import { point, lineString, polygon } from '@turf/helpers';
import { isResidentialBuilding } from './lib/residential.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const SEED = 20261007;
const APPROX_RADIUS_M = 150;

// ---------- how many listings ----------
const argv = process.argv.slice(2);
const countArg = argv.find((a) => a.startsWith('--count='))?.split('=')[1] ?? (argv.includes('--count') ? argv[argv.indexOf('--count') + 1] : undefined);
const COUNT = countArg === undefined ? 30 : Number(countArg);
if (!Number.isInteger(COUNT) || COUNT < 4 || COUNT > 80) {
  console.error(`--count must be an integer between 4 and 80 (got ${countArg})`);
  process.exit(1);
}

// ---------- deterministic helpers ----------
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const between = (min, max) => min + (max - min) * rand();
const intBetween = (min, max) => Math.floor(between(min, max + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const roundTo = (n, step) => Math.round(n / step) * step;

// ---------- load data ----------
const readJson = async (f) => JSON.parse(await readFile(path.join(DATA, f), 'utf8'));
const boundaryFc = await readJson('boundary.geojson');
const buildingsFc = await readJson('buildings.geojson');
const roadsFc = await readJson('roads.geojson');
const waterFc = await readJson('water.geojson');
const greenFc = await readJson('green.geojson');
const boundary = boundaryFc.features[0];


const buildings = buildingsFc.features.map((f) => ({
  f,
  osmId: f.properties.osmId,
  area: turfArea(f),
  center: turfCentroid(f).geometry.coordinates,
  bbox: turfBbox(f),
}));

const candidates = buildings.filter(
  (b) => isResidentialBuilding(b.f.properties) && turfBooleanPointInPolygon(point(b.center), boundary),
);

// Flatten roads to LineStrings with bbox for quick filtering
const roads = [];
for (const r of roadsFc.features) {
  const lines = r.geometry.type === 'LineString' ? [r.geometry.coordinates] : r.geometry.coordinates;
  for (const coords of lines) {
    if (coords.length < 2) continue;
    const ls = lineString(coords, r.properties);
    roads.push({ ls, bbox: turfBbox(ls), highway: r.properties.highway });
  }
}
const obstacles = [
  ...buildings.map((b) => ({ g: b.f, bbox: b.bbox })),
  ...roads.map((r) => ({ g: r.ls, bbox: r.bbox })),
  ...waterFc.features.map((f) => ({ g: f, bbox: turfBbox(f) })),
  ...greenFc.features.map((f) => ({ g: f, bbox: turfBbox(f) })),
];
const bboxOverlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

// ---------- spread-out selection (farthest-point sampling) ----------
const selectedPoints = [];
const usedOsmIds = new Set();
function pickSpread(pool, label) {
  const avail = pool.filter((b) => !usedOsmIds.has(b.osmId));
  if (avail.length === 0) throw new Error(`No candidate buildings left for ${label}`);
  // Evaluate a deterministic random subset to keep it fast
  const sample = [];
  for (let i = 0; i < Math.min(300, avail.length); i++) sample.push(pick(avail));
  let best = sample[0];
  let bestD = -1;
  for (const c of sample) {
    const d = selectedPoints.length
      ? Math.min(...selectedPoints.map((p) => turfDistance(point(p), point(c.center), { units: 'meters' })))
      : rand();
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  usedOsmIds.add(best.osmId);
  selectedPoints.push(best.center);
  return best;
}

// ---------- land lots ----------
const DRIVABLE = new Set([
  'residential', 'tertiary', 'secondary', 'primary', 'unclassified', 'living_street', 'service', 'tertiary_link', 'secondary_link',
]);
const drivableRoads = roads.filter((r) => DRIVABLE.has(r.highway));
const [bW, bS, bE, bN] = turfBbox(boundary);
const lots = [];

// turf/destination with a signed distance: negative moves the opposite way
function move(from, distM, bearingDeg) {
  const b = distM < 0 ? bearingDeg + 180 : bearingDeg;
  return turfDestination(point(from), Math.abs(distM), ((b + 540) % 360) - 180, { units: 'meters' }).geometry.coordinates;
}

function rectangle(center, bearingDeg, frontM, depthM) {
  // corners relative to center: along road (bearing) ± front/2, perpendicular ± depth/2
  const pts = [
    [-frontM / 2, -depthM / 2],
    [frontM / 2, -depthM / 2],
    [frontM / 2, depthM / 2],
    [-frontM / 2, depthM / 2],
  ].map(([a, p]) => {
    const along = move(center, a, bearingDeg);
    return move(along, p, bearingDeg + 90);
  });
  return polygon([[...pts, pts[0]]]);
}

// Minimum distance between a lot and the other listings: shrinks with the number of listings,
// so larger runs still find room (250 m for the original 15 listings).
const LOT_SPACING_M = Math.round(Math.min(250, 250 * Math.sqrt(15 / COUNT)));

function tryLot(frontM, depthM, attempts) {
  for (let i = 0; i < attempts; i++) {
    const c = [between(bW, bE), between(bS, bN)];
    if (!turfBooleanPointInPolygon(point(c), boundary)) continue;
    // keep away from other picks for spread
    if (selectedPoints.some((p) => turfDistance(point(p), point(c), { units: 'meters' }) < LOT_SPACING_M)) continue;
    // nearest drivable road
    let nearest = null;
    for (const r of drivableRoads) {
      const pad = 0.0015; // ~150 m
      if (c[0] < r.bbox[0] - pad || c[0] > r.bbox[2] + pad || c[1] < r.bbox[1] - pad || c[1] > r.bbox[3] + pad) continue;
      const np = turfNearestPointOnLine(r.ls, point(c), { units: 'meters' });
      if (!nearest || np.properties.pointDistance < nearest.np.properties.pointDistance) nearest = { r, np };
    }
    if (!nearest) continue;
    const dist = nearest.np.properties.pointDistance;
    // lot should front the road: center roughly depth/2 + a few metres away from it
    if (dist < depthM / 2 + 2 || dist > depthM / 2 + 12) continue;
    const coords = nearest.r.ls.geometry.coordinates;
    const idx = Math.min(nearest.np.properties.segmentIndex, coords.length - 2);
    const roadBearing = turfBearing(point(coords[idx]), point(coords[idx + 1]));
    const lot = rectangle(c, roadBearing, frontM, depthM);
    const lb = turfBbox(lot);
    if (lot.geometry.coordinates[0].some((p) => !turfBooleanPointInPolygon(point(p), boundary))) continue;
    if (obstacles.some((o) => bboxOverlap(lb, o.bbox) && turfBooleanIntersects(lot, o.g))) continue;
    if (lots.some((l) => turfBooleanIntersects(lot, l))) continue;
    return { lot, center: c };
  }
  return null;
}

const LOT_SIZES = [
  [12, 30],
  [15, 30],
  [15, 35],
  [20, 40],
];
const FALLBACK_SIZES = [
  [10, 25],
  [8, 20],
];
const lotNotes = [];
function makeLot() {
  const [f, d] = pick(LOT_SIZES);
  let r = tryLot(f, d, 4000);
  if (r) return { ...r, front: f, depth: d };
  for (const [ff, dd] of FALLBACK_SIZES) {
    r = tryLot(ff, dd, 4000);
    if (r) {
      lotNotes.push(`Lote reduzido de ${f}×${d} m para ${ff}×${dd} m por falta de espaço livre.`);
      return { ...r, front: ff, depth: dd };
    }
  }
  throw new Error('Could not place a land lot without intersecting buildings/roads. Not fabricating one.');
}

// ---------- listing content ----------
const agencies = [
  { id: 'agency-a', name: 'Imobiliária Exemplo A', fictional: true },
  { id: 'agency-b', name: 'Imobiliária Exemplo B', fictional: true },
];

const listings = [];
let counter = 0;
const nextId = (prefix) => `${prefix}-${String(++counter).padStart(2, '0')}`;

function approxCenterFor(id, trueCenter) {
  const h = strHash(id);
  const bearing = (h % 360) - 180;
  const distM = 50 + ((h >>> 9) % 100); // 50–149 m, always inside the 150 m circle
  return turfDestination(point(trueCenter), distM, bearing, { units: 'meters' }).geometry.coordinates.map((n) =>
    Number(n.toFixed(6)),
  );
}

// Plausible pools, avoiding overlap of building types
const aptPool = candidates.filter((b) => b.area >= 250);
const housePool = candidates.filter(
  (b) => b.area >= 70 && b.area <= 400 && ['yes', 'house', 'residential', 'detached'].includes(b.f.properties.building),
);
const semiTagged = candidates.filter((b) => ['semidetached_house', 'terrace'].includes(b.f.properties.building));
const semiPool = semiTagged.length >= 3 ? semiTagged : candidates.filter((b) => b.area >= 50 && b.area <= 220);

// Mix of types (5 : 4 : 3 : 3, as in the original 15-listing demo), scaled to COUNT.
const MIX = [
  ['apartment', 5],
  ['house', 4],
  ['semi_detached', 3],
  ['land', 3],
];
const perType = MIX.map(([t, w]) => [t, Math.max(1, Math.floor((COUNT * w) / 15))]);
for (let i = 0; perType.reduce((n, [, c]) => n + c, 0) < COUNT; i++) perType[i % MIX.length][1]++;
for (let i = MIX.length - 1; perType.reduce((n, [, c]) => n + c, 0) > COUNT; i = (i + MIX.length - 1) % MIX.length)
  if (perType[i][1] > 1) perType[i][1]--;
const plan = perType.flatMap(([t, c]) => Array(c).fill(t));
// Which listings get an approximate location (one house, one semi-detached, one land)
const approxTypes = new Set(['house', 'semi_detached', 'land']);
const approxDone = new Set();

const APT_TITLES = ['Apartamento com sacada', 'Apartamento amplo', 'Apartamento com vista', 'Apartamento compacto', 'Apartamento garden'];
const HOUSE_TITLES = ['Casa térrea com quintal', 'Casa com piscina', 'Sobrado familiar', 'Casa com edícula'];
const SEMI_TITLES = ['Geminado com pátio', 'Geminado novo', 'Geminado com quintal'];
const LAND_TITLES = ['Terreno plano', 'Terreno residencial', 'Lote para construir'];

// Amenities come from their own random stream, so they do not shift the other draws.
const featureRand = mulberry32(SEED + 1);
const AMENITY_ODDS = {
  apartment: { pool: 0.4, barbecue: 0.6, balcony: 0.7, elevator: 1, gym: 0.4, pets: 0.6, furnished: 0.2, financing: 0.85, exchange: 0.2 },
  house: { pool: 0.35, barbecue: 0.8, balcony: 0.3, pets: 0.9, furnished: 0.15, financing: 0.8, exchange: 0.35 },
  semi_detached: { barbecue: 0.6, balcony: 0.3, pets: 0.8, furnished: 0.1, financing: 0.9, exchange: 0.25 },
  land: { financing: 0.5, exchange: 0.4 },
};
/** Amenities for a listing; the title's promise ("com piscina", "com sacada") is always kept. */
function amenitiesFor(type, title) {
  const out = Object.entries(AMENITY_ODDS[type])
    .filter(([, p]) => featureRand() < p)
    .map(([k]) => k);
  if (/piscina/i.test(title) && !out.includes('pool')) out.unshift('pool');
  if (/sacada/i.test(title) && !out.includes('balcony')) out.push('balcony');
  return out;
}

for (const type of plan) {
  const idPrefix = { apartment: 'apt', house: 'house', semi_detached: 'semi', land: 'land' }[type];
  const id = nextId(idPrefix);
  const agency = agencies[counter % 2].id;
  const approximateLocation = approxTypes.has(type) && !approxDone.has(type);
  if (approximateLocation) approxDone.add(type);

  let listing;
  if (type === 'land') {
    const lot = makeLot();
    selectedPoints.push(lot.center);
    lots.push(lot.lot);
    const areaM2 = Math.round(turfArea(lot.lot));
    const price = roundTo(areaM2 * between(1400, 2400), 5000);
    listing = {
      id,
      type,
      title: `${pick(LAND_TITLES)} ${lot.front}×${lot.depth} m`,
      agency,
      price,
      areaM2,
      landAreaM2: areaM2,
      bedrooms: 0,
      bathrooms: 0,
      parkingSpots: 0,
      status: 'ready',
      lotPolygon: {
        type: 'Polygon',
        coordinates: lot.lot.geometry.coordinates.map((ring) => ring.map(([x, y]) => [Number(x.toFixed(7)), Number(y.toFixed(7))])),
      },
      description: `Lote de ${areaM2} m² em rua residencial, pronto para construir. Dados fictícios para demonstração.`,
    };
    if (approximateLocation) listing.approxCenter = approxCenterFor(id, lot.center);
  } else {
    const pool = type === 'apartment' ? aptPool : type === 'house' ? housePool : semiPool;
    const b = pickSpread(pool, type);
    let areaM2, bedrooms, bathrooms, parkingSpots, status, floors, landAreaM2, title, pricePerM2;
    if (type === 'apartment') {
      floors = intBetween(8, 14);
      bedrooms = intBetween(1, 4);
      // unit area grows with bedrooms: 1q ≈ 45–65 m², 4q ≈ 120–140 m²
      areaM2 = Math.round(23 + bedrooms * 24 + between(0, 20));
      bathrooms = Math.max(1, bedrooms - intBetween(0, 1));
      parkingSpots = Math.min(3, Math.max(1, bedrooms - 1));
      status = rand() < 0.4 ? 'under_construction' : 'ready';
      pricePerM2 = between(8000, 11500);
      title = `${pick(APT_TITLES)} ${bedrooms} ${bedrooms === 1 ? 'quarto' : 'quartos'}`;
    } else if (type === 'house') {
      areaM2 = Math.round(Math.min(380, Math.max(90, b.area * between(1, 1.8))));
      bedrooms = Math.min(5, Math.max(2, Math.round(areaM2 / 65)));
      landAreaM2 = Math.round(Math.max(areaM2 * 1.3, b.area * between(1.8, 2.8)));
      bathrooms = Math.max(1, bedrooms - intBetween(0, 1));
      parkingSpots = intBetween(1, 3);
      status = rand() < 0.2 ? 'under_construction' : 'ready';
      pricePerM2 = between(6500, 9500);
      title = `${pick(HOUSE_TITLES)} ${bedrooms} quartos`;
    } else {
      areaM2 = Math.round(between(85, 150));
      bedrooms = areaM2 >= 115 ? 3 : 2;
      landAreaM2 = Math.round(areaM2 * between(1.1, 1.6));
      bathrooms = intBetween(1, bedrooms);
      parkingSpots = intBetween(1, 2);
      status = rand() < 0.35 ? 'under_construction' : 'ready';
      pricePerM2 = between(5800, 7800);
      title = `${pick(SEMI_TITLES)} ${bedrooms} quartos`;
    }
    const price = roundTo(areaM2 * pricePerM2, 5000);
    listing = {
      id,
      type,
      title,
      agency,
      price,
      areaM2,
      ...(landAreaM2 ? { landAreaM2 } : {}),
      bedrooms,
      bathrooms,
      parkingSpots,
      status,
      buildingOsmId: b.osmId,
      ...(floors ? { floors } : {}),
      description:
        type === 'apartment'
          ? `Unidade de ${areaM2} m² em edifício de ${floors} pavimentos (altura fictícia). ${status === 'ready' ? 'Pronto para morar.' : 'Em construção.'} Dados fictícios para demonstração.`
          : `Imóvel de ${areaM2} m² construídos, ${bedrooms} quartos e ${parkingSpots} ${parkingSpots === 1 ? 'vaga' : 'vagas'}. Dados fictícios para demonstração.`,
    };
    if (approximateLocation) listing.approxCenter = approxCenterFor(id, b.center);
  }

  listing.features = amenitiesFor(type, listing.title);
  listing.approximateLocation = approximateLocation;
  if (approximateLocation) listing.approxRadiusM = APPROX_RADIUS_M;
  listing.fictional = true;
  listings.push(listing);
}

const out = {
  fictional: true,
  notice: 'Imóveis, imobiliárias e valores FICTÍCIOS, gerados para demonstração. Não representam ofertas reais.',
  seed: SEED,
  agencies,
  listings,
};
await writeFile(path.join(DATA, 'listings.json'), JSON.stringify(out, null, 2) + '\n');

console.log(`Residential candidate buildings: ${candidates.length} (apartment pool ${aptPool.length}, house pool ${housePool.length}, semi pool ${semiPool.length}${semiTagged.length >= 3 ? ' tagged' : ' by area'})`);
console.log(`Generated ${listings.length} fictional listings:`);
for (const l of listings) {
  console.log(
    `  ${l.id.padEnd(9)} ${l.type.padEnd(14)} ${String(l.price).padStart(8)} BRL  ${l.buildingOsmId ?? 'lot'}${l.approximateLocation ? '  (approximate)' : ''}`,
  );
}
for (const n of lotNotes) console.log('  NOTE:', n);
