import type { MultiPolygon, Polygon, Position } from 'geojson';

/** The most units a floor may have in the layout editor. */
export const MAX_UNITS_PER_FLOOR = 12;
/** The most floors a building may have (same bound as the "Anunciar" form). */
export const MAX_FLOORS = 40;
/** How far (m) the unit sticks out of the building's walls, so it reads in front of the translucent rest. */
const UNIT_PAD_M = 0.4;
/** Gap (m) under the next floor, so the unit reads as one floor. */
const SLAB_GAP_M = 0.3;

/** Floors × units per floor of a building, reused by its next listings. */
export interface BuildingLayout {
  floors: number;
  unitsPerFloor: number;
}

export const validLayout = (l: Partial<BuildingLayout> | null | undefined): l is BuildingLayout =>
  !!l &&
  Number.isInteger(l.floors) && l.floors! >= 1 && l.floors! <= MAX_FLOORS &&
  Number.isInteger(l.unitsPerFloor) && l.unitsPerFloor! >= 1 && l.unitsPerFloor! <= MAX_UNITS_PER_FLOOR;

/** The unit's number as the building writes it: floor and "final" (7th floor, 2nd unit → "702"). */
export const unitNumber = (floor: number, position: number) => `${floor}${String(position).padStart(2, '0')}`;

/** Base and top (m) of a floor; floor 0 is the ground floor ("térreo"), floor 1 the one above it. */
export function floorBand(floor: number, floorHeightM: number): { base: number; top: number } {
  const base = Math.max(0, floor - 1) * floorHeightM;
  return { base, top: base + floorHeightM - SLAB_GAP_M };
}

/**
 * The unit's share of the footprint: the building split into `count` equal strips across its long side (the
 * direction of its longest wall), strip `position` (1 = the first). Grown by UNIT_PAD_M. Null when nothing is left.
 * A guess of where the unit is; the real plan comes from the builder.
 */
export function unitStrip(footprint: Polygon | MultiPolygon, position: number, count: number): Polygon | MultiPolygon | null {
  const polys = footprint.type === 'Polygon' ? [footprint.coordinates] : footprint.coordinates;
  const first = polys[0]?.[0]?.[0];
  if (!first || count < 1 || position < 1 || position > count) return null;
  // metres on a flat local projection around the building
  const kx = 111_320 * Math.cos((first[1] * Math.PI) / 180);
  const ky = 110_540;
  const toM = (p: Position): [number, number] => [(p[0] - first[0]) * kx, (p[1] - first[1]) * ky];
  const toLngLat = ([x, y]: [number, number]): [number, number] => [first[0] + x / kx, first[1] + y / ky];
  const local = polys.map((rings) => rings.map((r) => r.map(toM)));
  // the long side: the longest wall of the outer rings
  let axis: [number, number] = [1, 0];
  let longest = 0;
  for (const rings of local) {
    const r = rings[0];
    for (let i = 1; i < r.length; i++) {
      const len = Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
      if (len > longest) [longest, axis] = [len, [(r[i][0] - r[i - 1][0]) / len, (r[i][1] - r[i - 1][1]) / len]];
    }
  }
  const along = (p: [number, number]) => p[0] * axis[0] + p[1] * axis[1];
  const us = local.flatMap((rings) => rings[0].map(along));
  const min = Math.min(...us);
  const step = (Math.max(...us) - min) / count;
  const lo = min + (position - 1) * step;
  const hi = lo + step;
  const out = local
    .map((rings) => rings.map((r) => clipBand(r, along, lo, hi)).filter((r, i) => i > 0 || r.length >= 3))
    .filter((rings) => rings.length && rings[0].length >= 3)
    .map((rings) => rings.filter((r) => r.length >= 3));
  if (!out.length) return null;
  // grow around the strip's centre so it sticks out of the walls a little
  const pts = out.flatMap((rings) => rings[0]);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const radius = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy)), 1);
  const k = 1 + UNIT_PAD_M / radius;
  const grow = (p: [number, number]): [number, number] => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k];
  const coords = out.map((rings) => rings.map((r) => [...r, r[0]].map((p) => toLngLat(grow(p)))));
  return coords.length === 1 ? { type: 'Polygon', coordinates: coords[0] } : { type: 'MultiPolygon', coordinates: coords };
}

/** The part of a ring between two lines across the axis (Sutherland–Hodgman on the two half-planes); open ring. */
function clipBand(ring: [number, number][], along: (p: [number, number]) => number, lo: number, hi: number): [number, number][] {
  const open = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  const cut = (pts: [number, number][], inside: (u: number) => boolean, edge: number) => {
    const res: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ua = along(a);
      const ub = along(b);
      if (inside(ua)) res.push(a);
      if (inside(ua) !== inside(ub)) {
        const t = (edge - ua) / (ub - ua);
        res.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return res;
  };
  return cut(cut(open, (u) => u >= lo, lo), (u) => u <= hi, hi);
}

const STORE_KEY = 'mapa3d-layouts';

/** Layouts saved in this browser (the demo; with the backend they come from `building_layouts`). */
export function savedLayout(osmId: string): BuildingLayout | null {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, BuildingLayout>;
    return validLayout(all[osmId]) ? all[osmId] : null;
  } catch {
    return null;
  }
}

export function saveLayout(osmId: string, layout: BuildingLayout): void {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, BuildingLayout>;
    all[osmId] = { floors: layout.floors, unitsPerFloor: layout.unitsPerFloor };
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    // private window or full storage: the layout is just not remembered
  }
}
