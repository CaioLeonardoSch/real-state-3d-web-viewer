import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from 'maplibre-gl';
import type { Polygon } from 'geojson';
import type { Development, Unit } from '../data/developments';

/**
 * Windows of the open development ("hero" building, item 48): each unit gets windows on its facade walls (the
 * walls it does not share with a neighbour on the floor), drawn by a small WebGL layer, since a fill-extrusion
 * has no texture per face. At night the windows of occupied units (sold or reserved) and of the chosen unit are lit.
 * Plain WebGL instead of Three.js: one shader and one buffer of quads, without ~150 KB more to download.
 */

/** One window: four corners in metres around the origin (x east, y north, z up), and its unit. */
export interface WindowQuad {
  unitId: string;
  corners: [number, number, number][];
}

/** Window size and spacing (m): a 1.4 m wide window every 3 m of facade, from sill to lintel. */
const PITCH_M = 3;
const WIDTH_M = 1.4;
const SILL_M = 0.9;
const LINTEL_M = 0.55;
/** Out of the wall, so the glass is not hidden by the wall's own depth. */
const OFFSET_M = 0.08;
const MIN_WALL_M = 2;

const M_PER_DEG_LAT = 110_540;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

const key = (a: number[], b: number[]) => {
  const k = (p: number[]) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  return [k(a), k(b)].sort().join('|');
};

/** Signed area (m², positive counter-clockwise) of a ring in local metres. */
const signedArea = (r: [number, number][]) => r.reduce((s, p, i) => (i ? s + (r[i - 1][0] * p[1] - p[0] * r[i - 1][1]) : s), 0) / 2;

/**
 * The windows of every unit of a development, in metres around `origin`. Floors whose top is above `builtTop`
 * (works under way) and units `skip` returns true for (translucent ones) get none.
 */
export function windowQuads(
  d: Development,
  origin: [number, number],
  opts: { builtTop?: number | null; skip?: (u: Unit) => boolean } = {},
): WindowQuad[] {
  const kx = mPerDegLng(origin[1]);
  const local = (p: number[]): [number, number] => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * M_PER_DEG_LAT];
  const quads: WindowQuad[] = [];
  for (const l of d.levels) {
    if (!l.units.length || (opts.builtTop != null && l.top > opts.builtTop + 0.01)) continue;
    // an edge used by two units of the floor is an inner wall
    const uses = new Map<string, number>();
    const rings = new Map<number, number[][]>();
    for (const u of l.units) {
      const ring = (d.shapes[u.shape]?.polygon as Polygon | undefined)?.coordinates[0];
      if (!ring) continue;
      rings.set(u.shape, ring);
      for (let i = 1; i < ring.length; i++) uses.set(key(ring[i - 1], ring[i]), (uses.get(key(ring[i - 1], ring[i])) ?? 0) + 1);
    }
    const z0 = l.base + SILL_M;
    const z1 = l.top - LINTEL_M;
    if (z1 - z0 < 0.6) continue;
    for (const u of l.units) {
      const ring = rings.get(u.shape);
      if (!ring || opts.skip?.(u)) continue;
      const pts = ring.map(local);
      const ccw = signedArea(pts) > 0;
      for (let i = 1; i < ring.length; i++) {
        if ((uses.get(key(ring[i - 1], ring[i])) ?? 0) > 1) continue;
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        const len = Math.hypot(bx - ax, by - ay);
        if (len < MIN_WALL_M) continue;
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        // outward normal: right of the edge on a counter-clockwise ring
        const [nx, ny] = ccw ? [uy, -ux] : [-uy, ux];
        const n = Math.max(1, Math.floor(len / PITCH_M));
        const w = Math.min(WIDTH_M, (len / n) * 0.7);
        for (let k = 0; k < n; k++) {
          const c = ((k + 0.5) * len) / n;
          const s0 = c - w / 2;
          const s1 = c + w / 2;
          const at = (s: number, z: number): [number, number, number] => [ax + ux * s + nx * OFFSET_M, ay + uy * s + ny * OFFSET_M, z];
          quads.push({ unitId: u.id, corners: [at(s0, z0), at(s1, z0), at(s1, z1), at(s0, z1)] });
        }
      }
    }
  }
  return quads;
}

/** Lit at night: someone lives there (sold or reserved), or the unit the panel shows. */
export const isLit = (u: Unit, selected: string | null) => u.id === selected || u.status !== 'available';

const GLASS_DAY: [number, number, number, number] = [0.23, 0.32, 0.41, 0.92];
const GLASS_NIGHT: [number, number, number, number] = [0.1, 0.13, 0.18, 0.95];
const LIT: [number, number, number, number] = [1, 0.84, 0.5, 1];
const LIT_SELECTED: [number, number, number, number] = [1, 0.95, 0.75, 1];

const VERTEX = `
uniform mat4 u_matrix;
attribute vec3 a_pos;
attribute vec4 a_color;
varying vec4 v_color;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  v_color = a_color;
}`;
const FRAGMENT = `
precision mediump float;
varying vec4 v_color;
void main() {
  gl_FragColor = vec4(v_color.rgb * v_color.a, v_color.a);
}`;

/** 4×4 column-major product a·b. */
function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return new Float32Array(o);
}

export class HeroWindowsLayer implements CustomLayerInterface {
  readonly id = 'dev-windows';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private map!: MlMap;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private vertexCount = 0;
  private dirty = true;
  private dev: Development | null = null;
  private quads: WindowQuad[] = [];
  private origin: [number, number] = [0, 0];
  private night = false;
  private selected: string | null = null;
  /** For the browser checks: windows drawn and lit in the last frame. */
  stats = { windows: 0, lit: 0, frames: 0 };

  /** The open development's windows (null: nothing to draw). */
  setDevelopment(d: Development | null, opts: { builtTop?: number | null; skip?: (u: Unit) => boolean } = {}): void {
    this.dev = d;
    if (d) this.origin = d.center;
    this.quads = d ? windowQuads(d, this.origin, opts) : [];
    this.changed();
  }

  setNight(night: boolean): void {
    if (night === this.night) return;
    this.night = night;
    this.changed();
  }

  setSelected(unitId: string | null): void {
    if (unitId === this.selected) return;
    this.selected = unitId;
    this.changed();
  }

  private changed(): void {
    this.dirty = true;
    this.map?.triggerRepaint();
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext): void {
    this.map = map;
    this.gl = gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(p);
    this.program = p;
    this.buffer = gl.createBuffer();
  }

  onRemove(): void {
    if (this.gl) {
      this.gl.deleteBuffer(this.buffer);
      this.gl.deleteProgram(this.program);
    }
    this.gl = null;
  }

  private upload(gl: WebGLRenderingContext): void {
    this.dirty = false;
    const units = new Map((this.dev?.levels ?? []).flatMap((l) => l.units.map((u) => [u.id, u] as const)));
    const data = new Float32Array(this.quads.length * 6 * 7);
    let o = 0;
    let lit = 0;
    for (const q of this.quads) {
      const u = units.get(q.unitId);
      const on = this.night && !!u && isLit(u, this.selected);
      if (on) lit++;
      const c = on ? (q.unitId === this.selected ? LIT_SELECTED : LIT) : this.night ? GLASS_NIGHT : GLASS_DAY;
      for (const i of [0, 1, 2, 0, 2, 3]) {
        data.set(q.corners[i], o);
        data.set(c, o + 3);
        o += 7;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.vertexCount = this.quads.length * 6;
    this.stats.windows = this.quads.length;
    this.stats.lit = lit;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    if (!this.program || !this.dev) return;
    if (this.dirty) this.upload(gl);
    if (!this.vertexCount) return;
    // metres around the origin → mercator, composed in double precision (no jitter close up); on the relief, the
    // windows start at the ground of the tower's centre, as its extrusion
    const m = MercatorCoordinate.fromLngLat(this.origin, this.map.queryTerrainElevation(this.origin) ?? 0);
    const s = m.meterInMercatorCoordinateUnits();
    const model = [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, m.x, m.y, m.z, 1];
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'u_matrix'), false, mul(args.defaultProjectionData.mainMatrix, model));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const pos = gl.getAttribLocation(this.program, 'a_pos');
    const col = gl.getAttribLocation(this.program, 'a_color');
    gl.enableVertexAttribArray(pos);
    gl.enableVertexAttribArray(col);
    gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 28, 0);
    gl.vertexAttribPointer(col, 4, gl.FLOAT, false, 28, 12);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    this.stats.frames++;
  }
}
