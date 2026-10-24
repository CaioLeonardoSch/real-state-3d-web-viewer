// Scenery of the 3D map, built with the tiles (scripts/build-tiles.mjs): road pavement classes, low-poly trees
// and street lamps. OSM maps few trees and lamps in Joinville (hundreds), so most are *illustrative*: trees are
// spread inside parks and woods near the city, lamps along paved streets. Deterministic (same input, same output),
// so a monthly rebuild only changes what changed in OSM.
import polygonClipping from 'polygon-clipping';

// ---------------------------------------------------------------- pavement

const PAVING_STONES = new Set(['paving_stones', 'sett', 'cobblestone', 'unhewn_cobblestone', 'pebblestone', 'concrete:plates', 'bricks', 'brick', 'stone']);
const PAVED = new Set(['paved', 'concrete', 'concrete:lanes', 'metal', 'wood']);
const UNPAVED = new Set(['unpaved', 'compacted', 'ground', 'gravel', 'fine_gravel', 'dirt', 'earth', 'grass', 'sand', 'mud', 'clay', 'rock', 'grass_paver', 'woodchips']);

/**
 * Pavement class of a road for the style: 'a' asphalt, 'c' paving stones ("calçamento"), 'p' other paved,
 * 'u' unpaved ("estrada de chão"), '' unknown. Tracks without a surface tag are unpaved by OSM convention.
 * @param {string} highway
 * @param {string | undefined} surface
 */
export function surfaceClass(highway, surface) {
  const s = (surface ?? '').trim().toLowerCase();
  if (s === 'asphalt' || s === 'chipseal') return 'a';
  if (PAVING_STONES.has(s)) return 'c';
  if (PAVED.has(s)) return 'p';
  if (UNPAVED.has(s)) return 'u';
  if (!s && highway === 'track') return 'u';
  return '';
}

// ---------------------------------------------------------------- local metric frame and random numbers

/** Metres ↔ degrees around a reference latitude (equirectangular; good to ~0.1% at city scale). */
export function frame(lat0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  return { kx, ky, dx: (m) => m / kx, dy: (m) => m / ky };
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit hash of a string (seeds the PRNG per feature, so features don't shift when others change). */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------- where the city is

/**
 * Cells (≈ cellM metres) with buildings, grown by `grow` cells: trees and lamps are only generated there, so the
 * big forests of the Serra do Mar stay a flat green area (cheap) and detail goes where people look.
 */
export function urbanMask(points, cellM = 100, grow = 2, lat0 = -26.3) {
  const f = frame(lat0);
  const cw = f.dx(cellM);
  const ch = f.dy(cellM);
  const core = new Set();
  for (const [x, y] of points) core.add(`${Math.floor(x / cw)}:${Math.floor(y / ch)}`);
  const cells = new Set();
  for (const k of core) {
    const [i, j] = k.split(':').map(Number);
    for (let a = -grow; a <= grow; a++) for (let b = -grow; b <= grow; b++) if (a * a + b * b <= grow * grow + 1) cells.add(`${i + a}:${j + b}`);
  }
  return { has: ([x, y]) => cells.has(`${Math.floor(x / cw)}:${Math.floor(y / ch)}`), size: cells.size, cellW: cw, cellH: ch };
}

// ---------------------------------------------------------------- point in polygon (fast enough for big woods)

/** Ray-casting test with the polygon's edges bucketed by latitude (big OSM woods have thousands of vertices). */
export function polygonTester(geometry, buckets = 64) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let s = Infinity;
  let n = -Infinity;
  for (const poly of polys) for (const ring of poly) for (const [, y] of ring) (s = Math.min(s, y)), (n = Math.max(n, y));
  const h = (n - s) / buckets || 1;
  const rows = Array.from({ length: buckets }, () => []);
  for (const poly of polys)
    for (const ring of poly)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[j];
        const a = Math.max(0, Math.min(buckets - 1, Math.floor((Math.min(y1, y2) - s) / h)));
        const b = Math.max(0, Math.min(buckets - 1, Math.floor((Math.max(y1, y2) - s) / h)));
        for (let k = a; k <= b; k++) rows[k].push(x1, y1, x2, y2);
      }
  return ([x, y]) => {
    if (y < s || y > n) return false;
    const edges = rows[Math.max(0, Math.min(buckets - 1, Math.floor((y - s) / h)))];
    let inside = false;
    for (let i = 0; i < edges.length; i += 4) {
      const x1 = edges[i];
      const y1 = edges[i + 1];
      const x2 = edges[i + 2];
      const y2 = edges[i + 3];
      if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
    }
    return inside;
  };
}

const bboxOf = (geometry) => {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys) for (const [x, y] of poly[0]) (w = Math.min(w, x)), (e = Math.max(e, x)), (s = Math.min(s, y)), (n = Math.max(n, y));
  return [w, s, e, n];
};

// ---------------------------------------------------------------- clearings: no trees on houses or streets

/** Clear ground (m) around buildings: no tree stands closer, and the canopy mass of woods is cut back as far. */
export const BUILDING_CLEARING_M = 6;
/** Half width (m) of the carriageway by road class (links 3.5 m, paths 1 m); trees keep ROAD_CLEARING_M beyond it. */
export const ROAD_HALF_M = {
  motorway: 7,
  trunk: 6,
  primary: 4.8,
  secondary: 4.8,
  tertiary: 4.2,
  unclassified: 2.8,
  residential: 2.8,
  living_street: 2.4,
  service: 2.2,
  busway: 3.5,
  pedestrian: 3,
  track: 1.8,
};
export const ROAD_CLEARING_M = 0.8;
const roadHalf = (highway) => ROAD_HALF_M[highway] ?? (highway.endsWith('_link') ? 3.5 : 1);

/** Distance (m) from p to the segment a–b (degrees), in the local metric frame f. */
function segmentDistance(f, px, py, x1, y1, x2, y2) {
  const ax = (x1 - px) * f.kx;
  const ay = (y1 - py) * f.ky;
  const dx = (x2 - x1) * f.kx;
  const dy = (y2 - y1) * f.ky;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function inRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[j];
    if (y1 > py !== y2 > py && px < ((x2 - x1) * (py - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

/**
 * What trees keep clear of: building outlines (BUILDING_CLEARING_M around them) and road carriageways (half width
 * plus ROAD_CLEARING_M; not in tunnels). Each item is filed in the grid cells (≈ cellM metres) its cleared area
 * reaches. `blocked(p)` tells whether a tree may not stand at p; `near(bbox)` lists the items around an area.
 * OSM puts many houses inside woods (country houses, streets opened in the woods): without this, the illustrative
 * trees and the canopy mass covered them.
 */
export function clearings(buildings, roads, { lat0 = -26.3, cellM = 50 } = {}) {
  const f = frame(lat0);
  const cw = f.dx(cellM);
  const ch = f.dy(cellM);
  const cells = new Map();
  const file = (item) => {
    const [w, s, e, n] = item.bb;
    for (let i = Math.floor(w / cw); i <= Math.floor(e / cw); i++)
      for (let j = Math.floor(s / ch); j <= Math.floor(n / ch); j++) {
        const list = cells.get(`${i}:${j}`);
        if (list) list.push(item);
        else cells.set(`${i}:${j}`, [item]);
      }
  };
  const grow = (w, s, e, n, m) => [w - f.dx(m), s - f.dy(m), e + f.dx(m), n + f.dy(m)];
  for (const b of buildings) {
    const g = b.geometry;
    const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0]) : [];
    for (const ring of rings) {
      let w = Infinity;
      let s = Infinity;
      let e = -Infinity;
      let n = -Infinity;
      for (const [x, y] of ring) (w = Math.min(w, x)), (e = Math.max(e, x)), (s = Math.min(s, y)), (n = Math.max(n, y));
      file({ ring, clear: BUILDING_CLEARING_M, bb: grow(w, s, e, n, BUILDING_CLEARING_M) });
    }
  }
  for (const r of roads) {
    const p = r.properties;
    if (p.tunnel && p.tunnel !== 'no') continue;
    const g = r.geometry;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    const half = roadHalf(p.highway);
    const clear = half + ROAD_CLEARING_M;
    for (const line of lines)
      for (let i = 1; i < line.length; i++) {
        const [x1, y1] = line[i - 1];
        const [x2, y2] = line[i];
        const bb = grow(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2), clear);
        file({ seg: [x1, y1, x2, y2], clear, car: half > 1, bb });
      }
  }
  const blocked = ([x, y]) => {
    const list = cells.get(`${Math.floor(x / cw)}:${Math.floor(y / ch)}`);
    if (!list) return false;
    for (const it of list) {
      if (x < it.bb[0] || x > it.bb[2] || y < it.bb[1] || y > it.bb[3]) continue;
      if (it.seg) {
        if (segmentDistance(f, x, y, ...it.seg) < it.clear) return true;
        continue;
      }
      const r = it.ring;
      if (inRing(x, y, r)) return true;
      for (let i = 1; i < r.length; i++) if (segmentDistance(f, x, y, r[i - 1][0], r[i - 1][1], r[i][0], r[i][1]) < it.clear) return true;
    }
    return false;
  };
  const near = ([w, s, e, n]) => {
    const found = new Set();
    for (let i = Math.floor(w / cw); i <= Math.floor(e / cw); i++)
      for (let j = Math.floor(s / ch); j <= Math.floor(n / ch); j++) for (const it of cells.get(`${i}:${j}`) ?? []) found.add(it);
    return [...found].filter((it) => it.bb[0] <= e && it.bb[2] >= w && it.bb[1] <= n && it.bb[3] >= s);
  };
  return { blocked, near, frame: f };
}

/** Convex hull (monotone chain) of [x, y] points, as a closed ring. */
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  const hull = [...half(pts), ...half(pts.reverse())];
  hull.push(hull[0]);
  return hull;
}

/** The clearing around a building: its outline's convex hull grown by `m` metres (an octagon at each corner). */
function grownHull(f, ring, m) {
  const pts = [];
  for (const [x, y] of ring)
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      pts.push([x + f.dx(m * Math.cos(a)), y + f.dy(m * Math.sin(a))]);
    }
  return [convexHull(pts)];
}

/** A street's cleared strip: the segment grown by `m` metres on every side (square ends cover the joints). */
function segmentStrip(f, [x1, y1, x2, y2], m) {
  const dx = (x2 - x1) * f.kx;
  const dy = (y2 - y1) * f.ky;
  const len = Math.hypot(dx, dy);
  if (!len) return null;
  const ux = dx / len;
  const uy = dy / len;
  const at = (along, across) => [x1 + f.dx(ux * along - uy * across), y1 + f.dy(uy * along + ux * across)];
  return [[at(-m, -m), at(len + m, -m), at(len + m, m), at(-m, m), at(-m, -m)]];
}

/** Area (m²) of a polygon given as [outer, ...holes] in degrees. */
function polygonAreaM2(f, poly) {
  const ringArea = (ring) => {
    let a = 0;
    for (let i = 1; i < ring.length; i++) a += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
    return Math.abs(a / 2) * f.kx * f.ky;
  };
  return poly.reduce((acc, ring, i) => (i ? acc - ringArea(ring) : ringArea(ring)), 0);
}

/**
 * The canopy mass of woods with clearings: cut back BUILDING_CLEARING_M around the buildings inside it and along
 * the streets for cars that cross it (`index` from clearings()). Pieces under 150 m² are dropped, as for the mass
 * itself (scripts/extract-region.py). Returns { features, cut, failed }: masses with something to clear around
 * them, and those the clipping failed on (kept whole).
 */
export function cutCanopy(canopy, index, minAreaM2 = 150) {
  const f = index.frame;
  const out = [];
  let cut = 0;
  let failed = 0;
  for (const feature of canopy) {
    const g = feature.geometry;
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') continue;
    const clips = index
      .near(bboxOf(g))
      .filter((it) => !it.seg || it.car)
      .map((it) => (it.seg ? segmentStrip(f, it.seg, it.clear) : grownHull(f, it.ring, BUILDING_CLEARING_M)))
      .filter(Boolean);
    if (!clips.length) {
      out.push(feature);
      continue;
    }
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).filter((p) => p[0].length >= 4);
    let rest;
    try {
      rest = polygonClipping.difference(polys, ...clips).filter((p) => polygonAreaM2(f, p) >= minAreaM2);
    } catch {
      // the clipping library gives up on some degenerate outlines: keep that mass as it was
      failed++;
      out.push(feature);
      continue;
    }
    cut++;
    if (rest.length) out.push({ ...feature, geometry: rest.length === 1 ? { type: 'Polygon', coordinates: rest[0] } : { type: 'MultiPolygon', coordinates: rest } });
  }
  return { features: out, cut, failed };
}

// ---------------------------------------------------------------- trees

/**
 * Spacing (m) and share of grid points kept, per kind of green area. Grass, wetlands and fields get no trees.
 * Woods are drawn as a low canopy mass (the green area extruded by the style); here they only get trees along their
 * edges and sparse taller crowns inside, which break the flat top into a low-poly canopy.
 */
export const TREE_DENSITY = {
  park: { spacing: 11, keep: 0.55 },
  scrub: { spacing: 9, keep: 0.4 },
  wood: { spacing: 17, keep: 0.55 },
};
/** Trees along the edge of woods: one every WOOD_EDGE_STEP_M metres, WOOD_EDGE_INSET_M inside the edge. */
export const WOOD_EDGE_STEP_M = 10;
export const WOOD_EDGE_INSET_M = 2.5;
/** Height (m) of the canopy mass of woods (the style extrudes the "canopy" layer, woods shrunk by 6 m, to it). */
export const WOOD_CANOPY_M = 6;

/**
 * Tree positions inside green areas (jittered grid, only in the urban mask), along the edges of woods, plus the
 * trees and tree rows mapped in OSM. `blocked` (from clearings()) keeps the illustrative ones off houses and
 * streets. Returns { x, y, kind: 'broad' | 'edge' | 'bush' | 'canopy', scale } items.
 */
export function sampleTrees(green, osmTrees, mask, { lat0 = -26.3, max = Infinity, blocked = () => false } = {}) {
  const f = frame(lat0);
  const out = [];
  for (const t of osmTrees) {
    const g = t.geometry;
    if (g.type === 'Point') out.push({ x: g.coordinates[0], y: g.coordinates[1], kind: 'broad', scale: 1.1, mapped: true });
    else if (g.type === 'LineString') {
      // tree row: one tree every 8 m along the line
      for (let i = 1; i < g.coordinates.length; i++) {
        const [x1, y1] = g.coordinates[i - 1];
        const [x2, y2] = g.coordinates[i];
        const len = Math.hypot((x2 - x1) * f.kx, (y2 - y1) * f.ky);
        for (let d = 0; d < len; d += 8) out.push({ x: x1 + ((x2 - x1) * d) / len, y: y1 + ((y2 - y1) * d) / len, kind: 'broad', scale: 0.9, mapped: true });
      }
    }
  }
  for (const area of green) {
    const kind = area.properties.kind;
    const density = TREE_DENSITY[kind];
    if (!density) continue;
    const g = area.geometry;
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') continue;
    const [w, s, e, n] = bboxOf(g);
    // skip areas entirely outside the urban mask quickly (check a coarse grid of the bbox)
    let any = false;
    for (let x = w; x <= e + mask.cellW && !any; x += mask.cellW) for (let y = s; y <= n + mask.cellH && !any; y += mask.cellH) any = mask.has([x, y]);
    if (!any) continue;
    const inside = polygonTester(g);
    const r = rng(hash(area.properties.osmId ?? `${w},${s}`));
    if (kind === 'wood') {
      // edge trees: walk the rings, step inwards (the side that is inside the polygon)
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      for (const poly of polys)
        for (const ringCoords of poly) {
          let next = r() * WOOD_EDGE_STEP_M;
          let walked = 0;
          for (let i = 1; i < ringCoords.length; i++) {
            const [x1, y1] = ringCoords[i - 1];
            const [x2, y2] = ringCoords[i];
            const ex = (x2 - x1) * f.kx;
            const ey = (y2 - y1) * f.ky;
            const len = Math.hypot(ex, ey);
            if (len === 0) continue;
            while (next <= walked + len) {
              const t = (next - walked) / len;
              const cx = x1 + (x2 - x1) * t;
              const cy = y1 + (y2 - y1) * t;
              const inset = WOOD_EDGE_INSET_M + r() * 2;
              const a = [cx + f.dx((ey / len) * inset), cy + f.dy((-ex / len) * inset)];
              const b = [cx - f.dx((ey / len) * inset), cy - f.dy((-ex / len) * inset)];
              const p = inside(a) ? a : inside(b) ? b : null;
              if (p && mask.has(p) && !blocked(p)) out.push({ x: p[0], y: p[1], kind: 'edge', scale: 0.85 + r() * 0.55 });
              next += WOOD_EDGE_STEP_M * (0.7 + r() * 0.6);
            }
            walked += len;
          }
        }
    }
    const sx = f.dx(density.spacing);
    const sy = f.dy(density.spacing);
    for (let y = s + sy / 2; y < n; y += sy) {
      for (let x = w + sx / 2; x < e; x += sx) {
        const keep = r();
        const jx = (r() - 0.5) * sx * 0.8;
        const jy = (r() - 0.5) * sy * 0.8;
        const scaleR = r();
        if (keep > density.keep) continue;
        const p = [x + jx, y + jy];
        if (!mask.has(p) || !inside(p) || blocked(p)) continue;
        out.push({ x: p[0], y: p[1], kind: kind === 'scrub' ? 'bush' : kind === 'wood' ? 'canopy' : 'broad', scale: 0.75 + scaleR * 0.6 });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

/**
 * A tree as the map draws it (one low-poly model repeated by the GPU, src/map/cityTrees.ts): its kind, crown shade
 * v (0–2), turn (radians), overall height h and crown radius r (metres). Broad trees stand about 7k tall with a
 * crown 2.4k wide (k: the tree's scale); at the edge of woods a crown down to the ground line; inside woods taller
 * crowns, which stick out of the canopy mass where there is one; in scrub, a low bush.
 */
export function treeParams(t) {
  const r = rng(hash(`${t.x.toFixed(6)},${t.y.toFixed(6)}`));
  const v = Math.floor(r() * 3);
  const rot = r() * Math.PI;
  const k = t.scale;
  if (t.kind === 'canopy') return { kind: 'canopy', v, rot, r: round1((2.6 + 2.2 * r()) * k), h: round1(WOOD_CANOPY_M + 0.8 + 4.5 * k * k) };
  if (t.kind === 'edge') return { kind: 'edge', v, rot, r: round1(2.6 * k), h: round1(4.5 + 4 * k) };
  if (t.kind === 'bush') return { kind: 'bush', v, rot, r: round1(1.3 * k), h: round1(1.6 * k + r() * 0.6) };
  return { kind: 'broad', v, rot, r: round1(2.4 * k), h: round1(7 * k) };
}
const round1 = (v) => Math.round(v * 10) / 10;
const round7 = (v) => Math.round(v * 1e7) / 1e7;

// ---------------------------------------------------------------- street lamps

/** Streets that get illustrative lamps, with the distance (m) from the centre line to the kerb. */
export const LAMP_ROADS = {
  primary: 4.8,
  primary_link: 3.5,
  secondary: 4.8,
  secondary_link: 3.5,
  tertiary: 4.2,
  tertiary_link: 3.2,
  unclassified: 2.8,
  residential: 2.8,
  living_street: 2.4,
};
export const LAMP_SPACING_M = 38;
export const LAMP_HEIGHT_M = 7;
/** Main streets: neutral white LED and a wider, stronger pool of light (taller luminaires, more lumens). */
const MAIN_LAMP_ROADS = new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link']);
/** Share of the other streets still with sodium lamps (orange); the rest warm white LED. Illustrative. */
export const SODIUM_SHARE = 0.15;

/**
 * Lamp positions: one every LAMP_SPACING_M metres on paved streets of the urban mask (not where OSM says lit=no),
 * on the right-hand side of the way, plus the lamps mapped in OSM. Returns { x, y, angle, t, k } where angle
 * points from the pole to the street (radians, east = 0, north = π/2), t is the kind of lamp ('n' neutral white
 * LED on main streets, 'w' warm white LED, 's' sodium; the same along a street) and k scales its pool of light
 * (main streets 1.25, give or take 15% per lamp).
 */
export function lampPositions(roads, osmLamps, mask, lat0 = -26.3) {
  const f = frame(lat0);
  const out = [];
  for (const l of osmLamps) {
    const [x, y] = l.geometry.coordinates;
    const r = rng(hash(`${x.toFixed(6)},${y.toFixed(6)}`));
    out.push({ x, y, angle: 0, mapped: true, t: r() < SODIUM_SHARE ? 's' : 'w', k: round1(0.85 + r() * 0.3) });
  }
  for (const road of roads) {
    const p = road.properties;
    const half = LAMP_ROADS[p.highway];
    if (half === undefined || p.lit === 'no' || p.tunnel === 'yes' || p.bridge === 'yes') continue;
    if (surfaceClass(p.highway, p.surface) === 'u') continue;
    const coords = road.geometry.type === 'LineString' ? road.geometry.coordinates : null;
    if (!coords || coords.length < 2) continue;
    const seed = hash(p.osmId ?? `${coords[0][0]},${coords[0][1]}`);
    const r = rng(seed);
    const main = MAIN_LAMP_ROADS.has(p.highway);
    const t = main ? 'n' : r() < SODIUM_SHARE ? 's' : 'w';
    // start half a spacing in (no lamps on top of corners), phase from the way id so parallel ways don't align
    let next = LAMP_SPACING_M * (0.35 + (seed % 1000) / 2500);
    let walked = 0;
    for (let i = 1; i < coords.length; i++) {
      const [x1, y1] = coords[i - 1];
      const [x2, y2] = coords[i];
      const ex = (x2 - x1) * f.kx;
      const ey = (y2 - y1) * f.ky;
      const len = Math.hypot(ex, ey);
      if (len === 0) continue;
      while (next <= walked + len) {
        const u = (next - walked) / len;
        const cx = x1 + (x2 - x1) * u;
        const cy = y1 + (y2 - y1) * u;
        // right-hand normal (in metres), pointing away from the street centre
        const nx = ey / len;
        const ny = -ex / len;
        const px = cx + f.dx(nx * (half + 0.7));
        const py = cy + f.dy(ny * (half + 0.7));
        const k = round1((main ? 1.25 : 1) * (0.85 + r() * 0.3));
        if (mask.has([px, py])) out.push({ x: px, y: py, angle: Math.atan2(-ny, -nx), t, k });
        next += LAMP_SPACING_M;
      }
      walked += len;
    }
  }
  return out;
}

/** Rectangle centred at (cx, cy) metres offset from (x, y), length along `angle`, width across it. */
function rect(f, x, y, angle, along0, along1, width) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const vx = -uy;
  const vy = ux;
  const w = width / 2;
  const corner = (a, b) => [round7(x + f.dx(ux * a + vx * b)), round7(y + f.dy(uy * a + vy * b))];
  const pts = [corner(along0, -w), corner(along1, -w), corner(along1, w), corner(along0, w)];
  pts.push(pts[0]);
  return [pts];
}

/**
 * Low-poly street lamp: pole, arm reaching over the kerb and the luminaire (p: 'pole' | 'arm' | 'lum'; the
 * luminaire keeps the kind of lamp t, for its colour at night), plus the point under the luminaire where the light
 * falls at night (returned separately, with t and k).
 */
export function lampShapes(l, lat0 = -26.3) {
  // warm white ('w') is the default of the map style: left out, it saves a property on most lamps
  const kind = l.t && l.t !== 'w' ? { t: l.t } : {};
  const f = frame(lat0);
  const H = LAMP_HEIGHT_M;
  const shapes = [
    { type: 'Feature', properties: { p: 'pole', b: 0, h: H }, geometry: { type: 'Polygon', coordinates: rect(f, l.x, l.y, l.angle, -0.12, 0.12, 0.24) } },
    { type: 'Feature', properties: { p: 'arm', b: H - 0.25, h: H }, geometry: { type: 'Polygon', coordinates: rect(f, l.x, l.y, l.angle, 0, 1.5, 0.16) } },
    { type: 'Feature', properties: { p: 'lum', b: H - 0.45, h: H - 0.1, ...kind }, geometry: { type: 'Polygon', coordinates: rect(f, l.x, l.y, l.angle, 1.1, 1.9, 0.4) } },
  ];
  const lx = l.x + f.dx(Math.cos(l.angle) * 1.5);
  const ly = l.y + f.dy(Math.sin(l.angle) * 1.5);
  return { shapes, light: { type: 'Feature', properties: { ...kind, k: l.k ?? 1 }, geometry: { type: 'Point', coordinates: [round7(lx), round7(ly)] } } };
}

// ---------------------------------------------------------------- simplification (for the neighbourhood areas)

/** Douglas–Peucker on a ring of [lon, lat] (tolerance in degrees); keeps rings closed and at least 4 points. */
export function simplifyRing(ringCoords, tol) {
  if (ringCoords.length <= 4) return ringCoords;
  const keep = new Uint8Array(ringCoords.length);
  keep[0] = keep[ringCoords.length - 1] = 1;
  const stack = [[0, ringCoords.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = -1;
    let idx = -1;
    const [x1, y1] = ringCoords[a];
    const [x2, y2] = ringCoords[b];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = ringCoords[i];
      let d;
      if (len2 === 0) d = Math.hypot(x - x1, y - y1);
      else {
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
        d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      }
      if (d > maxD) (maxD = d), (idx = i);
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = ringCoords.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ringCoords;
}

export function simplifyGeometry(g, tol) {
  const poly = (p) => p.map((r) => simplifyRing(r, tol));
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: poly(g.coordinates) };
  if (g.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: g.coordinates.map(poly) };
  return g;
}
