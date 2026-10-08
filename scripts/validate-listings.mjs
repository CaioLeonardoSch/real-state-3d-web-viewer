#!/usr/bin/env node
// Validates public/data/listings.json against the real OSM data:
// unique ids, every buildingOsmId exists, every lot is inside the boundary and does not
// intersect any building (nor road/water/green), approximate circles contain the true location.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import turfBbox from '@turf/bbox';
import turfCentroid from '@turf/centroid';
import turfDistance from '@turf/distance';
import turfBooleanIntersects from '@turf/boolean-intersects';
import turfBooleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import { isResidentialBuilding } from './lib/residential.mjs';

// Optional path: validate another file in the listings.json format (e.g. an export to be merged).
const file = process.argv[2] ? path.resolve(process.argv[2]) : null;

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const read = async (f) => JSON.parse(await readFile(path.join(DATA, f), 'utf8'));
const [listingsFile, buildings, roads, water, green, boundaryFc] = await Promise.all([
  file ? readFile(file, 'utf8').then(JSON.parse) : read('listings.json'),
  ...['buildings.geojson', 'roads.geojson', 'water.geojson', 'green.geojson', 'boundary.geojson'].map(read),
]);
const boundary = boundaryFc.features[0];
const errors = [];
const ok = (msg) => console.log(`  ✔ ${msg}`);
const bboxOverlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

const { listings, agencies } = listingsFile;
if (listingsFile.fictional !== true) errors.push('root.fictional !== true');

// counts
const count = (t) => listings.filter((l) => l.type === t).length;
console.log(`Listings: ${listings.length} (apt ${count('apartment')}, house ${count('house')}, semi ${count('semi_detached')}, land ${count('land')}); agencies: ${agencies.length}`);
if (listings.length < 1) errors.push('no listings');

// amenities
const AMENITIES = new Set(['pool', 'barbecue', 'balcony', 'elevator', 'gym', 'pets', 'furnished', 'financing', 'exchange']);
const badFeatures = listings.filter(
  (l) => !Array.isArray(l.features) || l.features.some((f) => !AMENITIES.has(f)) || new Set(l.features).size !== l.features.length,
);
if (badFeatures.length) errors.push(`invalid features: ${badFeatures.map((l) => l.id).join(', ')}`);
else ok('every listing has a valid list of amenities');

// unique ids
const ids = listings.map((l) => l.id);
if (new Set(ids).size !== ids.length) errors.push('duplicated listing ids');
else ok('all listing ids are unique');

// fictional flag
if (listings.some((l) => l.fictional !== true)) errors.push('some listing lacks fictional: true');
else ok('every listing has fictional: true');

// buildingOsmId existence + uniqueness
const byId = new Map(buildings.features.map((f) => [f.properties.osmId, f]));
const withBuilding = listings.filter((l) => l.type !== 'land');
const missing = withBuilding.filter((l) => !byId.has(l.buildingOsmId));
if (missing.length) errors.push(`buildingOsmId not found: ${missing.map((l) => l.id).join(', ')}`);
else ok(`all ${withBuilding.length} buildingOsmId exist in buildings.geojson`);
const bIds = withBuilding.map((l) => l.buildingOsmId);
if (new Set(bIds).size !== bIds.length) errors.push('two listings share the same building');

// residential & untagged building check
const bad = withBuilding.filter((l) => !isResidentialBuilding(byId.get(l.buildingOsmId)?.properties));
if (bad.length) errors.push(`non-residential building chosen: ${bad.map((l) => l.id).join(', ')}`);
else ok('all chosen buildings are residential without amenity/shop/office/healthcare tags');

// lots
const obstacles = [
  ...buildings.features.map((g) => ['building', g]),
  ...roads.features.map((g) => ['road', g]),
  ...water.features.map((g) => ['water', g]),
  ...green.features.map((g) => ['green', g]),
].map(([k, g]) => ({ k, g, bbox: turfBbox(g) }));
const lotListings = listings.filter((x) => x.type === 'land');
for (const [i, l] of lotListings.entries()) {
  const overlaps = lotListings.slice(i + 1).filter((o) => turfBooleanIntersects(l.lotPolygon, o.lotPolygon));
  if (overlaps.length) errors.push(`${l.id} lot overlaps ${overlaps.map((o) => o.id).join(', ')}`);
  const lot = { type: 'Feature', properties: {}, geometry: l.lotPolygon };
  const lb = turfBbox(lot);
  const hits = obstacles.filter((o) => bboxOverlap(lb, o.bbox) && turfBooleanIntersects(lot, o.g));
  if (hits.length) errors.push(`${l.id} intersects ${hits.map((h) => `${h.k}:${h.g.properties.osmId}`).join(', ')}`);
  else ok(`${l.id} lot does not intersect any building/road/water/green`);
  if (l.lotPolygon.coordinates[0].some((c) => !turfBooleanPointInPolygon(point(c), boundary)))
    errors.push(`${l.id} lot is not fully inside the neighbourhood boundary`);
}

// buildings inside boundary
const outside = withBuilding.filter((l) => !turfBooleanPointInPolygon(turfCentroid(byId.get(l.buildingOsmId)), boundary));
if (outside.length) errors.push(`buildings outside boundary: ${outside.map((l) => l.id).join(', ')}`);
else ok('all listing buildings are inside the neighbourhood boundary');

// approximate locations
const approx = listings.filter((l) => l.approximateLocation);
for (const l of approx) {
  const truth =
    l.type === 'land' ? turfCentroid({ type: 'Feature', properties: {}, geometry: l.lotPolygon }) : turfCentroid(byId.get(l.buildingOsmId));
  const d = turfDistance(truth, point(l.approxCenter), { units: 'meters' });
  if (d > l.approxRadiusM) errors.push(`${l.id}: true location ${d.toFixed(0)} m from circle center > radius`);
  else ok(`${l.id} approximate: offset ${d.toFixed(0)} m, circle radius ${l.approxRadiusM} m`);
}

if (errors.length) {
  console.error('\nVALIDATION FAILED:\n - ' + errors.join('\n - '));
  process.exit(1);
}
console.log(`\n${file ? path.basename(file) : 'listings.json'} OK`);
