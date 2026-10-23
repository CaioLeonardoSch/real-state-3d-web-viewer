#!/usr/bin/env node
// Relief of the map: the terrain model (MDT) of the State of Santa Catarina's aerial survey (SIGSC, 2010–2012, 1 m),
// read from the State's public WCS already reduced to TERRAIN_STEP_M, resampled into Web Mercator tiles of 512 px
// and written as public/data/<region>-relevo.pmtiles (raster-dem, "mapbox" Terrain-RGB encoding, 0.1 m steps,
// lossless WebP). meta.json gets "terrainTiles" and "terrain" (source, zooms), which the map reads (src/data/load.ts).
//
// Zooms TERRAIN_MIN_ZOOM to TERRAIN_MAX_ZOOM: at z13 a 512 px tile has ~8.6 m per pixel in Joinville, the detail of
// the terrain of the big web maps; closer, the map stretches the z13 tiles. The tiles cover the whole area the map can
// show (the region's bbox grown by 30% on each side, as maxBounds in src/map/scene.ts), so the relief never ends in a
// cliff inside the view. Where the WCS has no data (outside Santa Catarina, the sea) the ground is at 0 m.
//
// Downloads are kept in .cache/terrain (not versioned), one GeoTIFF per CHUNK_M square, one request at a time.
// Behind a proxy, Node's fetch needs NODE_USE_ENV_PROXY=1.
//
// The data is public and free (sigsc2.ciasc.sc.gov.br), but no licence for use in a product is stated: confirm it with
// the State (geoprocessamento@sde.sc.gov.br) before selling it (docs/prioridades.md, item 37).
//
// Usage: node scripts/build-terrain.mjs [--refresh]
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromArrayBuffer } from 'geotiff';
import proj4 from 'proj4';
import sharp from 'sharp';
import { COMPRESSION, TILE_TYPE, writePmtiles } from './lib/pmtiles-writer.mjs';
import { REGION } from './lib/region.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'terrain');
const META = path.join(ROOT, 'public', 'data', 'meta.json');
const OUT_NAME = `${REGION.id}-relevo.pmtiles`;
const WCS = 'https://sigsc.sc.gov.br/sigserver/SIGSC/wcs';
const COVERAGE = 'SIGSC__MDT-2012';
/** SIRGAS 2000 / UTM zone 22S (EPSG:31982), the grid of the State's survey. */
const UTM = '+proj=utm +zone=22 +south +ellps=GRS80 +units=m +no_defs';
export const TERRAIN_STEP_M = 10;
const CHUNK_M = 10_000;
/** Extent of the State's coverage (its DescribeCoverage); the WCS refuses requests that go past it. */
const COVERAGE_UTM = { e0: 214_794, n0: 6_751_542, e1: 766_209, n1: 7_128_977 };
export const TERRAIN_MIN_ZOOM = 8;
export const TERRAIN_MAX_ZOOM = 13;
export const TERRAIN_TILE_PX = 512;
const refresh = process.argv.includes('--refresh');

// ---- area: the map's maxBounds (src/map/scene.ts)
const meta = JSON.parse(await readFile(META, 'utf8'));
const [w0, s0, e0, n0] = meta.boundaryBbox;
const padX = (e0 - w0) * 0.3;
const padY = (n0 - s0) * 0.3;
const area = [w0 - padX, s0 - padY, e0 + padX, n0 + padY];

// ---- download the terrain grid (UTM, TERRAIN_STEP_M), chunk by chunk
const toUtm = proj4('EPSG:4326', UTM);
const corners = [[area[0], area[1]], [area[0], area[3]], [area[2], area[1]], [area[2], area[3]]].map((c) => toUtm.forward(c));
const snap = (v, down) => (down ? Math.floor(v / CHUNK_M) : Math.ceil(v / CHUNK_M)) * CHUNK_M;
const E0 = snap(Math.min(...corners.map((c) => c[0])), true);
const E1 = snap(Math.max(...corners.map((c) => c[0])), false);
const N0 = snap(Math.min(...corners.map((c) => c[1])), true);
const N1 = snap(Math.max(...corners.map((c) => c[1])), false);
const W = (E1 - E0) / TERRAIN_STEP_M;
const H = (N1 - N0) / TERRAIN_STEP_M;
/** Height (m) of each grid cell, row 0 at the north edge; NaN where the WCS has no data. */
const grid = new Float32Array(W * H).fill(NaN);
await mkdir(CACHE, { recursive: true });

/** GeoTIFF of one chunk (only the part inside the State's coverage), or null when it is all outside. */
async function chunk(e, n) {
  const ce0 = Math.max(e, COVERAGE_UTM.e0);
  const ce1 = Math.min(e + CHUNK_M, COVERAGE_UTM.e1);
  const cn0 = Math.max(n, COVERAGE_UTM.n0);
  const cn1 = Math.min(n + CHUNK_M, COVERAGE_UTM.n1);
  if (ce1 - ce0 < TERRAIN_STEP_M || cn1 - cn0 < TERRAIN_STEP_M) return null;
  const file = path.join(CACHE, `mdt-${TERRAIN_STEP_M}m-${e}-${n}.tif`);
  if (!refresh && existsSync(file)) return (await readFile(file)).buffer;
  const url =
    `${WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${COVERAGE}&format=image/tiff` +
    `&subset=E(${ce0},${ce1})&subset=N(${cn0},${cn1})&scalefactor=${1 / TERRAIN_STEP_M}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('tiff')) throw new Error(`HTTP ${res.status} ${type}: ${(await res.text()).slice(0, 200)}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(file, buf);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch (ex) {
      if (attempt >= 4) throw new Error(`MDT ${e},${n}: ${ex.message}`);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

let done = 0;
const total = ((E1 - E0) / CHUNK_M) * ((N1 - N0) / CHUNK_M);
for (let n = N0; n < N1; n += CHUNK_M) {
  for (let e = E0; e < E1; e += CHUNK_M) {
    const buf = await chunk(e, n);
    done++;
    if (!buf) continue;
    const tiff = await fromArrayBuffer(buf);
    const image = await tiff.getImage();
    const [bw, , , bn] = image.getBoundingBox();
    const [data] = await image.readRasters();
    const iw = image.getWidth();
    const ih = image.getHeight();
    // the WCS snaps to its own pixel grid (half a metre off ours): place by the chunk's own origin
    const col0 = Math.round((bw - E0) / TERRAIN_STEP_M);
    const row0 = Math.round((N1 - bn) / TERRAIN_STEP_M);
    for (let r = 0; r < ih; r++) {
      const gr = row0 + r;
      if (gr < 0 || gr >= H) continue;
      for (let c = 0; c < iw; c++) {
        const gc = col0 + c;
        if (gc < 0 || gc >= W) continue;
        const v = data[r * iw + c];
        // no data: the survey's own sentinel values and the zeros outside its coverage
        if (Number.isFinite(v) && v > -100 && v < 3000 && v !== 0) grid[gr * W + gc] = v;
      }
    }
    process.stdout.write(`\rMDT: ${done}/${total} trechos de ${CHUNK_M / 1000} km`);
  }
}
process.stdout.write('\n');

/** Height at a UTM point, bilinear between the grid cells (cell centres); 0 m where there is no data. */
function heightAt(e, n) {
  const x = (e - E0) / TERRAIN_STEP_M - 0.5;
  const y = (N1 - n) / TERRAIN_STEP_M - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  let sum = 0;
  let wsum = 0;
  for (const [dx, dy, wt] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const cx = x0 + dx;
    const cy = y0 + dy;
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
    const v = grid[cy * W + cx];
    if (Number.isNaN(v)) continue;
    sum += v * wt;
    wsum += wt;
  }
  return wsum > 0 ? sum / wsum : 0;
}

// ---- tiles
const lonOf = (x, z) => (x / 2 ** z) * 360 - 180;
const latOf = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
const tileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const P = TERRAIN_TILE_PX;

/** Heights of one max-zoom tile, sampled at the centre of each pixel. */
function sampleTile(z, x, y) {
  const out = new Float32Array(P * P);
  for (let py = 0; py < P; py++) {
    const lat = latOf(y + (py + 0.5) / P, z);
    for (let px = 0; px < P; px++) {
      const [e, n] = toUtm.forward([lonOf(x + (px + 0.5) / P, z), lat]);
      out[py * P + px] = heightAt(e, n);
    }
  }
  return out;
}

/** One tile from its four children (missing ones at 0 m), averaging 2×2 pixels. */
function downsample(children) {
  const out = new Float32Array(P * P);
  for (let qy = 0; qy < 2; qy++) {
    for (let qx = 0; qx < 2; qx++) {
      const ch = children[qy * 2 + qx];
      if (!ch) continue;
      for (let py = 0; py < P / 2; py++) {
        for (let px = 0; px < P / 2; px++) {
          const i = 2 * py * P + 2 * px;
          out[(qy * P) / 2 * P + py * P + (qx * P) / 2 + px] = (ch[i] + ch[i + 1] + ch[i + P] + ch[i + P + 1]) / 4;
        }
      }
    }
  }
  return out;
}

/** Terrain-RGB ("mapbox": height = -10000 + (R·65536 + G·256 + B) · 0.1) as lossless WebP. */
async function encode(heights) {
  const rgb = Buffer.alloc(P * P * 3);
  for (let i = 0; i < heights.length; i++) {
    const v = Math.max(0, Math.round((heights[i] + 10000) * 10));
    rgb[i * 3] = (v >> 16) & 255;
    rgb[i * 3 + 1] = (v >> 8) & 255;
    rgb[i * 3 + 2] = v & 255;
  }
  return sharp(rgb, { raw: { width: P, height: P, channels: 3 } }).webp({ lossless: true, effort: 6 }).toBuffer();
}

const Z = TERRAIN_MAX_ZOOM;
const range = (z) => ({ x0: tileX(area[0], z), x1: tileX(area[2], z), y0: tileY(area[3], z), y1: tileY(area[1], z) });
const tiles = [];
/** Heights of the tiles of the zoom being built, by "x/y"; each level is built from the one below. */
let level = new Map();
const r = range(Z);
const count = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
let n = 0;
for (let y = r.y0; y <= r.y1; y++) {
  for (let x = r.x0; x <= r.x1; x++) {
    const h = sampleTile(Z, x, y);
    level.set(`${x}/${y}`, h);
    tiles.push({ z: Z, x, y, data: await encode(h) });
    process.stdout.write(`\rz${Z}: ${++n}/${count}`);
  }
}
process.stdout.write('\n');
for (let z = Z - 1; z >= TERRAIN_MIN_ZOOM; z--) {
  const next = new Map();
  const rz = range(z);
  for (let y = rz.y0; y <= rz.y1; y++) {
    for (let x = rz.x0; x <= rz.x1; x++) {
      const children = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => level.get(`${2 * x + dx}/${2 * y + dy}`));
      if (children.every((c) => !c)) continue;
      const h = downsample(children);
      next.set(`${x}/${y}`, h);
      tiles.push({ z, x, y, data: await encode(h) });
    }
  }
  level = next;
}

const archive = writePmtiles(tiles, {
  minZoom: TERRAIN_MIN_ZOOM,
  maxZoom: Z,
  bounds: area,
  center: meta.center,
  centerZoom: 10,
  tileCompression: COMPRESSION.none,
  tileType: TILE_TYPE.webp,
  metadata: {
    name: `Relevo · ${REGION.name}`,
    attribution: 'Relevo: MDT do Levantamento Aerofotogramétrico de SC 2010–2012 (SDE/SC, SIGSC)',
    encoding: 'mapbox',
    tileSize: P,
  },
});
await writeFile(path.join(ROOT, 'public', 'data', OUT_NAME), archive);

let hmax = -Infinity;
for (const v of grid) if (v > hmax) hmax = v;
meta.terrainTiles = OUT_NAME;
meta.terrain = {
  source: 'MDT 2010–2012, Levantamento Aerofotogramétrico de SC (SDE/SC, SIGSC)',
  stepM: TERRAIN_STEP_M,
  minzoom: TERRAIN_MIN_ZOOM,
  maxzoom: Z,
  tileSize: P,
  encoding: 'mapbox',
  maxHeightM: Math.round(hmax),
};
await writeFile(META, JSON.stringify(meta, null, 2) + '\n');
console.log(`${OUT_NAME}: ${tiles.length} tiles, ${(archive.length / 1e6).toFixed(1)} MB; ponto mais alto ${Math.round(hmax)} m`);
