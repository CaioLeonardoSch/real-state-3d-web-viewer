// Hours of direct sun on each side of a building, at a given floor, in winter and in summer, discounting the
// buildings around it (their footprint and height, from the loaded map tiles). For the listing panel: "face norte"
// becomes "a fachada norte tem 7 h de sol no inverno". Simplifications: a flat ground (no terrain), trees ignored,
// one point in the middle of the longest wall of each side, sun sampled every 10 minutes.
import { getPosition } from 'suncalc';
import { REGION } from '../config/region';

export type Side = 'N' | 'L' | 'S' | 'O';
export const SIDES: readonly Side[] = ['N', 'L', 'S', 'O'];
export const SIDE_LABELS: Record<Side, string> = { N: 'Norte', L: 'Leste', S: 'Sul', O: 'Oeste' };
export type Season = 'winter' | 'summer';
/** Solstices (southern hemisphere: June is winter). */
export const SEASON_DAYS: Record<Season, string> = { winter: '2026-06-21', summer: '2026-12-21' };
/** Storey height used to place the unit's floor (m). */
export const STOREY_M = 3;
const STEP_MIN = 10;
const MARCH_M = 3;
/** Buildings farther than this are not looked at (also how far the panel asks the map for buildings). */
export const SUN_RADIUS_M = 300;
const CELL_M = 20;
const KM_LAT = 110_540;

export interface SunBuilding {
  /** Outer ring, [lon, lat]. */
  ring: [number, number][];
  height: number;
}

interface Local {
  pts: [number, number][];
  height: number;
  box: [number, number, number, number];
}

/** Wall that represents a side: middle point and outward direction, in metres east/north of the origin. */
export interface Wall {
  side: Side;
  x: number;
  y: number;
  /** Outward normal, degrees clockwise from north. */
  normal: number;
}

const toLocal = (o: [number, number], kx: number) => (p: [number, number]): [number, number] => [(p[0] - o[0]) * kx, (p[1] - o[1]) * KM_LAT];

function inside(p: [number, number], pts: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Longest wall facing each side (N, L, S, O) of a footprint given in local metres. */
export function walls(pts: [number, number][]): Wall[] {
  let area = 0;
  for (let i = 0; i < pts.length - 1; i++) area += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  const best = new Map<Side, { len: number; wall: Wall }>();
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    // outward normal: right of the edge for a counter-clockwise ring
    const [nx, ny] = area > 0 ? [dy, -dx] : [-dy, dx];
    const normal = ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360;
    const side = SIDES[Math.round(normal / 90) % 4];
    if ((best.get(side)?.len ?? 0) < len) best.set(side, { len, wall: { side, x: (ax + bx) / 2, y: (ay + by) / 2, normal } });
  }
  return SIDES.flatMap((s) => (best.has(s) ? [best.get(s)!.wall] : []));
}

/** Obstacles in a grid of CELL_M cells, so each step of a ray only tests the few buildings under it. */
export class Obstacles {
  readonly top: number;
  private cells = new Map<string, Local[]>();
  constructor(list: Local[]) {
    this.top = list.reduce((m, o) => Math.max(m, o.height), 0);
    for (const o of list)
      for (let x = Math.floor(o.box[0] / CELL_M); x <= Math.floor(o.box[2] / CELL_M); x++)
        for (let y = Math.floor(o.box[1] / CELL_M); y <= Math.floor(o.box[3] / CELL_M); y++) {
          const k = `${x}:${y}`;
          const c = this.cells.get(k);
          if (c) c.push(o);
          else this.cells.set(k, [o]);
        }
  }
  /** Is `p` inside a building taller than `h`? */
  blocks(p: [number, number], h: number): boolean {
    const c = this.cells.get(`${Math.floor(p[0] / CELL_M)}:${Math.floor(p[1] / CELL_M)}`);
    return !!c && c.some((o) => o.height > h && p[0] >= o.box[0] && p[0] <= o.box[2] && p[1] >= o.box[1] && p[1] <= o.box[3] && inside(p, o.pts));
  }
}

/** Minutes of direct sun on `wall` at height `z` on `day` (YYYY-MM-DD, local time), with `obstacles` around it. */
export function sunMinutes(wall: Wall, z: number, obstacles: Obstacles, day: string, lat: number, lon: number): number {
  const top = obstacles.top;
  const nRad = (wall.normal * Math.PI) / 180;
  // start just outside the wall
  const x0 = wall.x + Math.sin(nRad) * 0.5;
  const y0 = wall.y + Math.cos(nRad) * 0.5;
  let minutes = 0;
  for (let t = 0; t < 24 * 60; t += STEP_MIN) {
    const hh = String(Math.floor(t / 60)).padStart(2, '0');
    const mm = String(t % 60).padStart(2, '0');
    const { azimuth, altitude } = getPosition(new Date(`${day}T${hh}:${mm}:00${REGION.utcOffset}`), lat, lon);
    if (altitude <= 1) continue;
    const aRad = (azimuth * Math.PI) / 180;
    // the sun must be in front of the wall
    if (Math.cos(aRad - nRad) <= 0.05) continue;
    const sx = Math.sin(aRad);
    const sy = Math.cos(aRad);
    const rise = Math.tan((altitude * Math.PI) / 180);
    let lit = true;
    for (let s = MARCH_M; s <= SUN_RADIUS_M && z + s * rise < top; s += MARCH_M) {
      if (obstacles.blocks([x0 + sx * s, y0 + sy * s], z + s * rise)) {
        lit = false;
        break;
      }
    }
    if (lit) minutes += STEP_MIN;
  }
  return minutes;
}

export type SunTable = { side: Side; winter: number; summer: number }[];

/**
 * Hours of sun on each side of `footprint` at floor `floor` (0 = ground), in winter and summer. `around` are the
 * buildings nearby (the building itself, found among them by its centre, is left out).
 */
export function sunTable(footprint: [number, number][], floor: number, around: SunBuilding[]): SunTable {
  const n = footprint.length;
  const origin: [number, number] = [footprint.reduce((a, p) => a + p[0], 0) / n, footprint.reduce((a, p) => a + p[1], 0) / n];
  const kx = 111_320 * Math.cos((origin[1] * Math.PI) / 180);
  const local = toLocal(origin, kx);
  const list: Local[] = [];
  for (const b of around) {
    const pts = b.ring.map(local);
    if (inside([0, 0], pts)) continue;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    list.push({ pts, height: b.height, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
  const obstacles = new Obstacles(list);
  const z = Math.max(0, floor) * STOREY_M + 1.5;
  return walls(footprint.map(local)).map((w) => ({
    side: w.side,
    winter: sunMinutes(w, z, obstacles, SEASON_DAYS.winter, origin[1], origin[0]) / 60,
    summer: sunMinutes(w, z, obstacles, SEASON_DAYS.summer, origin[1], origin[0]) / 60,
  }));
}

/** "7 h", "4,5 h", "menos de 1 h". */
export function formatHours(h: number): string {
  if (h < 1) return h > 0 ? 'menos de 1 h' : 'sem sol direto';
  return `${(Math.round(h * 2) / 2).toLocaleString('pt-BR')} h`;
}
