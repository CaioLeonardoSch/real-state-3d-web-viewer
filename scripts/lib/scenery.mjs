// Scenery of the 3D map, built with the tiles (scripts/build-tiles.mjs): road pavement classes, low-poly trees
// and street lamps. OSM maps few trees and lamps in Joinville (hundreds), so most are *illustrative*: trees are
// spread inside parks and woods near the city, lamps along paved streets. Deterministic (same input, same output),
// so a monthly rebuild only changes what changed in OSM.

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
 * trees and tree rows mapped in OSM. Returns { x, y, kind: 'broad' | 'edge' | 'bush' | 'canopy', scale } items.
 */
export function sampleTrees(green, osmTrees, mask, { lat0 = -26.3, max = Infinity } = {}) {
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
              if (p && mask.has(p)) out.push({ x: p[0], y: p[1], kind: 'edge', scale: 0.85 + r() * 0.55 });
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
        if (!mask.has(p) || !inside(p)) continue;
        out.push({ x: p[0], y: p[1], kind: kind === 'scrub' ? 'bush' : kind === 'wood' ? 'canopy' : 'broad', scale: 0.75 + scaleR * 0.6 });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

/** Regular polygon (closed ring) of `sides` vertices, radius in metres, rotated by `rot` radians. */
function ring(f, x, y, radius, sides, rot) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    pts.push([round7(x + f.dx(radius * Math.cos(a))), round7(y + f.dy(radius * Math.sin(a)))]);
  }
  pts.push(pts[0]);
  return [pts];
}
const round7 = (v) => Math.round(v * 1e7) / 1e7;

/**
 * Low-poly tree: a trunk and a faceted crown in two tiers (wide, then narrower on top); at the edge of woods and
 * inside them, a single crown; in scrub, a low bush.
 * Properties: p ('trunk' | 'crown' | 'top' | 'bush'), b/h (base/top in metres), v (shade 0–2).
 */
export function treeShapes(t, lat0 = -26.3) {
  const f = frame(lat0);
  const r = rng(hash(`${t.x.toFixed(6)},${t.y.toFixed(6)}`));
  const v = Math.floor(r() * 3);
  const rot = r() * Math.PI;
  const k = t.scale;
  if (t.kind === 'canopy') {
    // a crown sticking out of the canopy mass of a wood (its trunk is hidden in the mass)
    return [
      {
        type: 'Feature',
        properties: { p: 'crown', b: WOOD_CANOPY_M - 1, h: round1(WOOD_CANOPY_M + 0.8 + 4.5 * k * k), v },
        geometry: { type: 'Polygon', coordinates: ring(f, t.x, t.y, (2.6 + 2.2 * r()) * k, 6, rot) },
      },
    ];
  }
  if (t.kind === 'edge') {
    // edge of a wood: a crown down to the ground line (no trunk to draw: keeps the tiles small)
    return [
      {
        type: 'Feature',
        properties: { p: 'crown', b: 0.6, h: round1(4.5 + 4 * k), v },
        geometry: { type: 'Polygon', coordinates: ring(f, t.x, t.y, 2.6 * k, 6, rot) },
      },
    ];
  }
  if (t.kind === 'bush') {
    const rad = 1.3 * k;
    return [{ type: 'Feature', properties: { p: 'bush', b: 0, h: round1(1.6 * k + r() * 0.6), v }, geometry: { type: 'Polygon', coordinates: ring(f, t.x, t.y, rad, 6, rot) } }];
  }
  const crownR = 2.4 * k;
  const trunkTop = round1(2 * k);
  const crownTop = round1(trunkTop + 3.4 * k);
  return [
    { type: 'Feature', properties: { p: 'trunk', b: 0, h: trunkTop, v }, geometry: { type: 'Polygon', coordinates: ring(f, t.x, t.y, 0.35 * k, 4, rot) } },
    { type: 'Feature', properties: { p: 'crown', b: round1(trunkTop - 0.4), h: crownTop, v }, geometry: { type: 'Polygon', coordinates: ring(f, t.x, t.y, crownR, 6, rot) } },
    {
      type: 'Feature',
      properties: { p: 'top', b: crownTop, h: round1(crownTop + 1.6 * k), v },
      geometry: { type: 'Polygon', coordinates: ring(f, t.x, t.y, crownR * 0.55, 6, rot + Math.PI / 6) },
    },
  ];
}
const round1 = (v) => Math.round(v * 10) / 10;

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

/**
 * Lamp positions: one every LAMP_SPACING_M metres on paved streets of the urban mask (not where OSM says lit=no),
 * on the right-hand side of the way, plus the lamps mapped in OSM. Returns { x, y, angle } where angle points
 * from the pole to the street (radians, east = 0, north = π/2).
 */
export function lampPositions(roads, osmLamps, mask, lat0 = -26.3) {
  const f = frame(lat0);
  const out = [];
  for (const l of osmLamps) out.push({ x: l.geometry.coordinates[0], y: l.geometry.coordinates[1], angle: 0, mapped: true });
  for (const road of roads) {
    const p = road.properties;
    const half = LAMP_ROADS[p.highway];
    if (half === undefined || p.lit === 'no' || p.tunnel === 'yes' || p.bridge === 'yes') continue;
    if (surfaceClass(p.highway, p.surface) === 'u') continue;
    const coords = road.geometry.type === 'LineString' ? road.geometry.coordinates : null;
    if (!coords || coords.length < 2) continue;
    // start half a spacing in (no lamps on top of corners), phase from the way id so parallel ways don't align
    let next = LAMP_SPACING_M * (0.35 + (hash(p.osmId ?? '') % 1000) / 2500);
    let walked = 0;
    for (let i = 1; i < coords.length; i++) {
      const [x1, y1] = coords[i - 1];
      const [x2, y2] = coords[i];
      const ex = (x2 - x1) * f.kx;
      const ey = (y2 - y1) * f.ky;
      const len = Math.hypot(ex, ey);
      if (len === 0) continue;
      while (next <= walked + len) {
        const t = (next - walked) / len;
        const cx = x1 + (x2 - x1) * t;
        const cy = y1 + (y2 - y1) * t;
        // right-hand normal (in metres), pointing away from the street centre
        const nx = ey / len;
        const ny = -ex / len;
        const px = cx + f.dx(nx * (half + 0.7));
        const py = cy + f.dy(ny * (half + 0.7));
        if (mask.has([px, py])) out.push({ x: px, y: py, angle: Math.atan2(-ny, -nx) });
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
 * Low-poly street lamp: pole, arm reaching over the kerb and the luminaire (p: 'pole' | 'arm' | 'lum'), plus the
 * point under the luminaire where the light falls at night (returned separately).
 */
export function lampShapes(l, lat0 = -26.3) {
  const f = frame(lat0);
  const H = LAMP_HEIGHT_M;
  const shapes = [
    { type: 'Feature', properties: { p: 'pole', b: 0, h: H }, geometry: { type: 'Polygon', coordinates: rect(f, l.x, l.y, l.angle, -0.12, 0.12, 0.24) } },
    { type: 'Feature', properties: { p: 'arm', b: H - 0.25, h: H }, geometry: { type: 'Polygon', coordinates: rect(f, l.x, l.y, l.angle, 0, 1.5, 0.16) } },
    { type: 'Feature', properties: { p: 'lum', b: H - 0.45, h: H - 0.1 }, geometry: { type: 'Polygon', coordinates: rect(f, l.x, l.y, l.angle, 1.1, 1.9, 0.4) } },
  ];
  const lx = l.x + f.dx(Math.cos(l.angle) * 1.5);
  const ly = l.y + f.dy(Math.sin(l.angle) * 1.5);
  return { shapes, light: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [round7(lx), round7(ly)] } } };
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
