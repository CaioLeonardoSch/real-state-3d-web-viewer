// Low-poly roofs of the 3D map, built with the tiles (scripts/build-tiles.mjs). OSM rarely says what a roof looks
// like in Joinville (almost every building is a plain `building=yes` outline), so the roof is estimated from the
// outline, the floors and the use: houses get a gabled roof (elongated outlines) or a hipped one (squarish ones),
// towers a flat roof with the water tank and lift room on top. `roof:shape`, when mapped, wins. The map draws them
// as stacked steps (fill-extrusion only makes flat-topped prisms), in the same spirit as the low-poly trees.
// Deterministic: the same building always gets the same roof.
import { frame, hash } from './scenery.mjs';
import { osmNumericId } from '../../src/data/osmId.ts';

/** Roof pitch of the estimated roofs (tan 26°): rise per metre from the eave to the ridge. */
export const ROOF_PITCH = 0.49;
/** Eave overhang of pitched roofs (m). */
export const EAVE_M = 0.35;
/** Pitched roofs only on simple outlines: at least this share of their oriented bounding rectangle. */
export const MIN_RECT_FILL = 0.8;

const GABLE = new Set(['gabled', 'skillion', 'gambrel', 'saltbox', 'round', 'half-hipped']);
const HIP = new Set(['hipped', 'pyramidal', 'mansard']);

/**
 * Oriented minimum-area bounding rectangle of a ring, in metres around its centre (rotating calipers on the convex
 * hull). `fill` is the ring's area over the rectangle's (1 for a rectangle, ~0.75 for an L shape).
 * @param {[number, number][]} ring lon/lat
 */
export function orientedRect(ring, lat0 = -26.3) {
  const { kx, ky } = frame(lat0);
  const x0 = ring[0][0];
  const y0 = ring[0][1];
  const pts = ring.map(([x, y]) => [(x - x0) * kx, (y - y0) * ky]);
  const hull = convexHull(pts);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    let [minU, maxU, minV, maxV] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [px, py] of hull) {
      const u = px * ux + py * uy;
      const v = -px * uy + py * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, ux, uy, minU, maxU, minV, maxV };
  }
  if (!best || best.area < 1e-6) return null;
  const { ux, uy, minU, maxU, minV, maxV } = best;
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  let [L, W, ax, ay] = [maxU - minU, maxV - minV, ux, uy];
  // the long axis goes first
  if (W > L) [L, W, ax, ay] = [W, L, -uy, ux];
  return {
    // centre back in lon/lat
    center: [x0 + (cu * ux - cv * uy) / kx, y0 + (cu * uy + cv * ux) / ky],
    axis: [ax, ay],
    length: L,
    width: W,
    fill: Math.abs(ringArea(pts)) / best.area,
  };
}

function ringArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Kind of roof: 'gable', 'hip', 'flat' (nothing drawn) or 'tank' (flat, with the water tank and lift room).
 * @param {{ osmId: string, 'roof:shape'?: string, residential?: boolean }} props
 * @param {{ area: number, height: number, floors: number, rect: ReturnType<typeof orientedRect> }} b
 */
export function roofKind(props, { area, height, floors, rect }) {
  const shape = (props['roof:shape'] ?? '').toLowerCase();
  if (shape) return GABLE.has(shape) ? 'gable' : HIP.has(shape) ? 'hip' : 'flat';
  if (floors >= 5 && area >= 150) return 'tank';
  // annexes and sheds under 30 m² stay flat (and keep the tiles light)
  if (floors >= 4 || height >= 12 || area > 450 || area < 30) return 'flat';
  if (!rect || rect.fill < MIN_RECT_FILL || rect.width < 3) return 'flat';
  const elongated = rect.length / rect.width >= 1.35;
  // a quarter of the houses get the other shape, so streets do not look stamped out
  const swap = hash(props.osmId) % 4 === 0;
  return elongated !== swap ? 'gable' : 'hip';
}

/**
 * Stepped low-poly roof on top of a building `height` metres tall: `steps` prisms rising to the ridge (gable: the
 * steps narrow across the width only; hip: on all four sides). Properties for the style: b and h in decimetres
 * (integers are smaller in the tiles), v (colour: 0 clay tiles, 1 fibre cement, 2 dark tiles, 3 concrete); the
 * feature id is the building's (src/data/osmId.ts), so the map can hide the roofs of listing buildings.
 */
export function roofShapes(osmId, rect, kind, height, lat0 = -26.3) {
  if (!rect || kind === 'flat') return [];
  const { kx, ky } = frame(lat0);
  const [ux, uy] = rect.axis;
  const [cx, cy] = rect.center;
  const box = (hl, hw) => {
    const at = (u, v) => [round(cx + (u * ux - v * uy) / kx), round(cy + (u * uy + v * ux) / ky)];
    const ring = [at(-hl, -hw), at(hl, -hw), at(hl, hw), at(-hl, hw)];
    return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
  };
  const h = hash(osmId);
  if (kind === 'tank') {
    // water tank and lift room: a box on the middle of the roof
    const hl = Math.max(1.5, Math.min(rect.length * 0.15, 4));
    const hw = Math.max(1.2, Math.min(rect.width * 0.15, 3));
    return [feature(osmId, box(hl, hw), height, height + 3.2, 3)];
  }
  const L = rect.length / 2;
  const W = rect.width / 2;
  const rise = Math.min(3.2, Math.max(1, W * ROOF_PITCH));
  // two steps on narrow or small houses, three on wider ones (each step is a prism in the tiles)
  const steps = rect.width < 7 || rect.length * rect.width < 80 ? 2 : 3;
  const v = [0, 0, 0, 1, 2][h % 5];
  const out = [];
  for (let i = 0; i < steps; i++) {
    const inset = (W * i) / steps;
    const eave = i === 0 ? EAVE_M : 0;
    const hw = W - inset + eave;
    const hl = (kind === 'hip' ? L - inset : L) + eave;
    out.push(feature(osmId, box(hl, hw), height + (rise * i) / steps, height + (rise * (i + 1)) / steps, v));
  }
  return out;
}

const round = (x) => Math.round(x * 1e7) / 1e7;
const feature = (osmId, geometry, b, h, v) => ({
  type: 'Feature',
  id: osmNumericId(osmId),
  properties: { b: Math.round(b * 10), h: Math.round(h * 10), v },
  geometry,
});
