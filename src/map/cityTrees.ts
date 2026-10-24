import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from 'maplibre-gl';
import { PMTiles } from 'pmtiles';
import type { MultiPolygon, Polygon } from 'geojson';
import { TREE_TILE_ZOOM, decodeTreeTile } from '../../scripts/lib/tree-tiles.mjs';
import { cameraPosition } from './cameraGuard';
import type { Theme } from './lighting';
import { TREE_VERTEX_FLOATS, treeMesh, treeMeshSize } from './treeMesh';

/**
 * The city's trees (<região>-arvores.pmtiles, scripts/lib/tree-tiles.mjs), drawn by instancing (WebGL2): one
 * low-poly model (src/map/treeMesh.ts) repeated by the GPU, with a few numbers per tree. Tiles in view are fetched,
 * placed on the relief and sent to the GPU a few per frame, so a new stretch of city never stops the map. The trees
 * nearest the camera get the model with every facet, up to FULL_TREES of them; the rest a lighter one.
 * The trees laboratory (lab-arvores.html) measured both against the earlier trees, one prism per part.
 */

/** Trees from this zoom, growing to their height by TREE_GROWN_ZOOM. */
export const TREE_ZOOM = 15;
const TREE_GROWN_ZOOM = 15.8;
/** Trees drawn with the full model, the nearest first (a phone's GPU has less to spare). */
const FULL_TREES = { desktop: 12000, phone: 1500 };
/** How far from the centre of the view trees are drawn: this many screen widths, within these bounds (m). */
const REACH_WIDTHS = 2.2;
const REACH_M: [number, number] = [700, 3500];
/** Tiles fetched at a time, sent to the GPU per frame, and kept (the nearest) once out of view. */
const MAX_FETCHES = 6;
const UPLOADS_PER_FRAME = 2;
const KEEP_TILES = 64;
/** Time per frame for placing trees on the relief (ms). */
const ELEVATION_BUDGET_MS = 3;
/** Each tile in CELLS × CELLS cells: the unit of the near/far choice. */
const CELLS = 4;
/** Trunks reach this far into the ground on the relief (the drawn ground and the one queried differ a little). */
const ROOT_M = 0.4;
/** The relief's tiles have stopped coming in for this long (ms): place the trees again. */
const RELIEF_SETTLE_MS = 250;
/** The neighbourhood filter keeps trees this close to the chosen area (CLIP_BUFFER_M of the other layers). */
const CLIP_M = 100;

const INSTANCE_FLOATS = 8;
const SIZE = treeMeshSize();
const KIND = { broad: 0, edge: 1, canopy: 2, bush: 3 } as const;

const VERTEX = `#version 300 es
uniform mat4 u_matrix;
uniform float u_grow;
uniform float u_root;
uniform vec3 u_lightpos;
uniform vec3 u_lightcolor;
uniform float u_lightintensity;
uniform vec3 u_trunk;
uniform vec3 u_bush;
uniform vec3 u_crowns[3];
uniform vec3 u_tops[3];
in vec3 a_pos;
in vec3 a_normal;
in float a_part;
in vec3 i_pos;
in vec4 i_size;
in float i_shade;
out vec3 v_color;
void main() {
  // i_size: horizontal scale, vertical scale, how deep the model sinks (m: bushes and the edge of woods show only
  // their crown), turn
  float c = cos(i_size.w);
  float s = sin(i_size.w);
  vec3 p = a_pos * vec3(i_size.x, i_size.x, i_size.y);
  p.xy = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  p.z = max(p.z - i_size.z, 0.0) * u_grow;
  vec3 n = normalize(a_normal / vec3(i_size.x, i_size.x, i_size.y));
  n.xy = vec2(c * n.x - s * n.y, s * n.x + c * n.y);
  int shade = int(i_shade + 0.5);
  vec3 color = a_part < 0.5 ? u_trunk : shade == 3 ? u_bush : a_part < 1.5 ? u_crowns[shade] : u_tops[shade];
  // the fill-extrusions' light (MapLibre's fill_extrusion.vertex.glsl), so the trees sit with the buildings: the
  // light is in tile coordinates (y towards the south), and sides darker than the tops
  float colorvalue = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color += 0.03;
  float directional = clamp(dot(vec3(n.x, -n.y, n.z), u_lightpos), 0.0, 1.0);
  directional = mix(1.0 - u_lightintensity, max(1.0 - colorvalue + u_lightintensity, 1.0), directional);
  directional *= mix(mix(0.7, 0.98, 1.0 - u_lightintensity), 1.0, clamp(n.z, 0.0, 1.0));
  v_color = clamp(color * directional * u_lightcolor, mix(vec3(0.0), vec3(0.3), 1.0 - u_lightcolor), vec3(1.0));
  gl_Position = u_matrix * vec4(p.xy + i_pos.xy, p.z + i_pos.z - u_root, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 v_color;
out vec4 color;
void main() {
  color = vec4(v_color, 1.0);
}`;

/** 4×4 column-major product a·b, in double precision (no jitter close up). */
function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return new Float32Array(o);
}

const rgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

/** MapLibre's sphericalToCartesian: the light's [radial, azimuthal, polar] as the fill-extrusions get it. */
function lightPosition([r, azimuthal, polar]: [number, number, number]): [number, number, number] {
  const a = ((azimuthal + 90) * Math.PI) / 180;
  const p = (polar * Math.PI) / 180;
  return [r * Math.cos(a) * Math.sin(p), r * Math.sin(a) * Math.sin(p), r * Math.cos(p)];
}

/** A tree tile: its trees in metres from the tile's north-west corner, and their place on the GPU. */
interface TreeTile {
  key: string;
  x: number;
  y: number;
  /** The tile's corner (mercator) and the metre there, in mercator units. */
  origin: MercatorCoordinate;
  meter: number;
  /** All the trees of the tile: longitude, latitude, metres east and south of the corner, and the instance numbers. */
  lng: Float64Array;
  lat: Float64Array;
  all: Float32Array;
  /** The trees drawn (the neighbourhood filter may leave some out), by cell, and where each cell starts. */
  data: Float32Array;
  index: Uint32Array;
  cellStart: Uint32Array;
  buffer: WebGLBuffer | null;
  uploaded: boolean;
  /**
   * On the relief: the version of the relief all the tile's trees stand on (-1: not yet placed, not drawn), and the
   * placing under way (up to which tree, for which version).
   */
  placedFor: number;
  placing: number;
  placingFor: number;
  lastUsed: number;
}

export class CityTreesLayer implements CustomLayerInterface {
  readonly id = 'trees';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private map!: MlMap;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private attribs = new Map<string, number>();
  private lods: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; vertices: number }[] = [];
  private archive: PMTiles;
  private tiles = new Map<string, TreeTile>();
  private pending = new Set<string>();
  private failed = new Set<string>();
  private clip: Polygon | MultiPolygon | null = null;
  private reliefVersion = 0;
  private frame = 0;
  private readonly fullTrees = window.matchMedia('(pointer: coarse)').matches ? FULL_TREES.phone : FULL_TREES.desktop;
  /** Counts for the checks (scripts/e2e-check.mjs) and the console: tiles and trees loaded, trees drawn (with every facet). */
  stats = { tiles: 0, trees: 0, drawn: 0, full: 0 };

  constructor(
    url: string,
    private theme: Theme,
  ) {
    this.archive = new PMTiles(url);
  }

  setTheme(t: Theme): void {
    this.theme = t;
    this.map?.triggerRepaint();
  }

  /** The neighbourhood filter: only the trees within CLIP_M of the area (null: all). */
  setClip(area: Polygon | MultiPolygon | null): void {
    this.clip = area;
    for (const t of this.tiles.values()) this.select(t);
    this.map?.triggerRepaint();
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    if (!('drawArraysInstanced' in gl)) {
      console.warn('Árvores 3D indisponíveis: o navegador não tem WebGL2.');
      return;
    }
    this.gl = gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program');
    this.program = p;
    for (const name of ['u_matrix', 'u_grow', 'u_root', 'u_lightpos', 'u_lightcolor', 'u_lightintensity', 'u_trunk', 'u_bush', 'u_crowns', 'u_tops'])
      this.uniforms.set(name, gl.getUniformLocation(p, name));
    for (const name of ['a_pos', 'a_normal', 'a_part', 'i_pos', 'i_size', 'i_shade']) this.attribs.set(name, gl.getAttribLocation(p, name));
    // the model with every facet (near) and the lighter one (far), each with its vertex array
    for (const detail of [1, 0] as const) {
      const mesh = treeMesh(detail);
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
      const stride = TREE_VERTEX_FLOATS * 4;
      for (const [name, size, offset] of [['a_pos', 3, 0], ['a_normal', 3, 3], ['a_part', 1, 6]] as const) {
        const loc = this.attribs.get(name)!;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
      }
      for (const name of ['i_pos', 'i_size', 'i_shade']) {
        const loc = this.attribs.get(name)!;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribDivisor(loc, 1);
      }
      gl.bindVertexArray(null);
      this.lods.push({ vao, buffer, vertices: mesh.length / TREE_VERTEX_FLOATS });
    }
    // the relief's tiles come in sharper as the camera nears: place the trees again on them
    map.on('sourcedata', this.onSourceData);
  }

  onRemove(): void {
    this.map.off('sourcedata', this.onSourceData);
    clearTimeout(this.reliefTimer);
    const gl = this.gl;
    if (!gl) return;
    for (const t of this.tiles.values()) gl.deleteBuffer(t.buffer);
    for (const l of this.lods) {
      gl.deleteBuffer(l.buffer);
      gl.deleteVertexArray(l.vao);
    }
    gl.deleteProgram(this.program);
    this.tiles.clear();
    this.gl = null;
  }

  /** Once the relief's tiles stop coming for a moment, the trees are placed again on them. */
  private onSourceData = (e: { sourceId?: string; tile?: unknown }) => {
    if (e.sourceId !== 'terrain' || !e.tile) return;
    clearTimeout(this.reliefTimer);
    this.reliefTimer = setTimeout(() => {
      this.reliefVersion++;
      this.map.triggerRepaint();
    }, RELIEF_SETTLE_MS);
  };
  private reliefTimer: ReturnType<typeof setTimeout> | undefined;

  // ---------------------------------------------------------------- which tiles

  /** Metres from the centre of the view within which trees are drawn. */
  private reach(): number {
    const lat = this.map.getCenter().lat;
    const mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** this.map.getZoom());
    return Math.min(REACH_M[1], Math.max(REACH_M[0], REACH_WIDTHS * this.map.getCanvas().clientWidth * mPerPx));
  }

  /** z15 tiles in view and within reach of the centre. */
  private wanted(): { x: number; y: number; key: string }[] {
    const n = 2 ** TREE_TILE_ZOOM;
    const b = this.map.getBounds();
    const c = MercatorCoordinate.fromLngLat(this.map.getCenter());
    const r = this.reach() * c.meterInMercatorCoordinateUnits();
    const nw = MercatorCoordinate.fromLngLat([b.getWest(), b.getNorth()]);
    const se = MercatorCoordinate.fromLngLat([b.getEast(), b.getSouth()]);
    const x0 = Math.floor(Math.max(nw.x, c.x - r) * n);
    const x1 = Math.floor(Math.min(se.x, c.x + r) * n);
    const y0 = Math.floor(Math.max(nw.y, c.y - r) * n);
    const y1 = Math.floor(Math.min(se.y, c.y + r) * n);
    const out = [];
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        // the tile's nearest point to the centre within reach
        const dx = Math.max(x / n - c.x, 0, c.x - (x + 1) / n);
        const dy = Math.max(y / n - c.y, 0, c.y - (y + 1) / n);
        if (Math.hypot(dx, dy) <= r) out.push({ x, y, key: `${x}/${y}` });
      }
    return out;
  }

  private fetchTile(x: number, y: number, key: string): void {
    this.pending.add(key);
    this.archive
      .getZxy(TREE_TILE_ZOOM, x, y)
      .then((res) => {
        if (res?.data) this.tiles.set(key, this.makeTile(x, y, key, res.data));
        else this.failed.add(key);
      })
      .catch((err: Error) => {
        console.warn(`Árvores do bloco ${key} não carregadas: ${err.message}`);
        this.failed.add(key);
      })
      .finally(() => {
        this.pending.delete(key);
        this.map.triggerRepaint();
      });
  }

  private makeTile(x: number, y: number, key: string, bytes: ArrayBuffer): TreeTile {
    const d = decodeTreeTile(bytes);
    const n = 2 ** TREE_TILE_ZOOM;
    const origin = new MercatorCoordinate(x / n, y / n, 0);
    const meter = origin.meterInMercatorCoordinateUnits();
    const tileM = 1 / n / meter;
    const lng = new Float64Array(d.count);
    const lat = new Float64Array(d.count);
    const all = new Float32Array(d.count * INSTANCE_FLOATS);
    for (let i = 0; i < d.count; i++) {
      const ll = new MercatorCoordinate((x + d.fx[i]) / n, (y + d.fy[i]) / n, 0).toLngLat();
      lng[i] = ll.lng;
      lat[i] = ll.lat;
      // size the model to the tree: overall height h and crown radius r; bushes and the trees at the edge of woods
      // show their crown only (from the ground, and from 0.6 m)
      const h = d.h[i];
      const kind = d.kind[i];
      const crownH = SIZE.top - SIZE.crownBottom;
      let sz = h / SIZE.top;
      let sink = 0;
      if (kind === KIND.edge) {
        sz = (h - 0.6) / crownH;
        sink = SIZE.crownBottom * sz - 0.6;
      } else if (kind === KIND.bush) {
        sz = h / crownH;
        sink = SIZE.crownBottom * sz;
      }
      all.set([d.fx[i] * tileM, -d.fy[i] * tileM, 0, d.r[i] / SIZE.crownRadius, sz, sink, d.rot[i], kind === KIND.bush ? 3 : d.v[i]], i * INSTANCE_FLOATS);
    }
    const tile: TreeTile = {
      key,
      x,
      y,
      origin,
      meter,
      lng,
      lat,
      all,
      data: new Float32Array(0),
      index: new Uint32Array(0),
      cellStart: new Uint32Array(CELLS * CELLS + 1),
      buffer: null,
      uploaded: false,
      placedFor: -1,
      placing: 0,
      placingFor: -1,
      lastUsed: this.frame,
    };
    this.select(tile);
    return tile;
  }

  /** The tile's trees to draw (the neighbourhood filter), ordered by cell. */
  private select(t: TreeTile): void {
    const count = t.lng.length;
    const keep = this.clip ? clipTester(this.clip) : null;
    const cellOf = new Uint8Array(count);
    const perCell = new Uint32Array(CELLS * CELLS);
    const kept: number[] = [];
    for (let i = 0; i < count; i++) {
      if (keep && !keep(t.lng[i], t.lat[i])) continue;
      const fx = t.all[i * INSTANCE_FLOATS] * t.meter * 2 ** TREE_TILE_ZOOM;
      const fy = -t.all[i * INSTANCE_FLOATS + 1] * t.meter * 2 ** TREE_TILE_ZOOM;
      const cell = Math.min(CELLS - 1, Math.floor(fy * CELLS)) * CELLS + Math.min(CELLS - 1, Math.floor(fx * CELLS));
      cellOf[i] = cell;
      perCell[cell]++;
      kept.push(i);
    }
    t.cellStart[0] = 0;
    for (let c = 0; c < CELLS * CELLS; c++) t.cellStart[c + 1] = t.cellStart[c] + perCell[c];
    const next = t.cellStart.slice(0, CELLS * CELLS);
    t.index = new Uint32Array(kept.length);
    for (const i of kept) t.index[next[cellOf[i]]++] = i;
    t.data = new Float32Array(kept.length * INSTANCE_FLOATS);
    t.index.forEach((i, j) => t.data.set(t.all.subarray(i * INSTANCE_FLOATS, (i + 1) * INSTANCE_FLOATS), j * INSTANCE_FLOATS));
    t.uploaded = false;
  }

  // ---------------------------------------------------------------- each frame

  prerender(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    const g = gl as WebGL2RenderingContext;
    if (!this.gl || this.map.getZoom() < TREE_ZOOM) return;
    this.frame++;
    const wanted = this.wanted();
    let fetching = this.pending.size;
    let uploads = 0;
    const relief = !!this.map.getTerrain();
    const deadline = performance.now() + ELEVATION_BUDGET_MS;
    let busy = false;
    for (const w of wanted) {
      const t = this.tiles.get(w.key);
      if (!t) {
        if (!this.pending.has(w.key) && !this.failed.has(w.key) && fetching < MAX_FETCHES) {
          this.fetchTile(w.x, w.y, w.key);
          fetching++;
        }
        busy ||= this.pending.has(w.key);
        continue;
      }
      t.lastUsed = this.frame;
      // on the relief, each tree on its ground: a few milliseconds a frame, the tile drawn once all its trees stand
      // (as they stood before, while the relief's sharper tiles move them again)
      if (relief && t.placedFor !== this.reliefVersion) {
        if (t.placingFor !== this.reliefVersion) [t.placing, t.placingFor] = [0, this.reliefVersion];
        const count = t.lng.length;
        while (t.placing < count && performance.now() < deadline) {
          const end = Math.min(count, t.placing + 64);
          for (let i = t.placing; i < end; i++) t.all[i * INSTANCE_FLOATS + 2] = this.map.queryTerrainElevation([t.lng[i], t.lat[i]]) ?? 0;
          t.placing = end;
        }
        if (t.placing < count) {
          busy = true;
          if (t.placedFor < 0) continue;
        } else {
          t.placedFor = this.reliefVersion;
          t.index.forEach((i, j) => (t.data[j * INSTANCE_FLOATS + 2] = t.all[i * INSTANCE_FLOATS + 2]));
          t.uploaded = false;
        }
      }
      if (!t.uploaded && uploads < UPLOADS_PER_FRAME) {
        t.buffer ??= g.createBuffer();
        g.bindBuffer(g.ARRAY_BUFFER, t.buffer);
        g.bufferData(g.ARRAY_BUFFER, t.data, g.STATIC_DRAW);
        g.bindBuffer(g.ARRAY_BUFFER, null);
        t.uploaded = true;
        uploads++;
      }
      busy ||= !t.uploaded;
    }
    this.evict(new Set(wanted.map((w) => w.key)));
    if (busy) this.map.triggerRepaint();
  }

  /** Out-of-view tiles beyond KEEP_TILES, the least recently seen first, leave the GPU. */
  private evict(inView: Set<string>): void {
    if (this.tiles.size <= KEEP_TILES) return;
    const old = [...this.tiles.values()].filter((t) => !inView.has(t.key)).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const t of old.slice(0, this.tiles.size - KEEP_TILES) as TreeTile[]) {
      this.gl?.deleteBuffer(t.buffer);
      this.tiles.delete(t.key);
    }
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const g = gl as WebGL2RenderingContext;
    const zoom = this.map.getZoom();
    this.stats = { tiles: this.tiles.size, trees: [...this.tiles.values()].reduce((a, t) => a + t.lng.length, 0), drawn: 0, full: 0 };
    if (!this.program || zoom < TREE_ZOOM) return;
    const relief = !!this.map.getTerrain();
    // cells of the tiles ready to draw, the nearest to the camera first: the first FULL_TREES trees get the full model
    const view = cameraPosition([this.map.getCenter().lng, this.map.getCenter().lat], zoom, this.map.getPitch(), this.map.getBearing(),
      this.map.getVerticalFieldOfView(), this.map.getContainer().clientHeight);
    const cam = MercatorCoordinate.fromLngLat(view.lngLat, view.altitudeM);
    const n = 2 ** TREE_TILE_ZOOM;
    const cells: { t: TreeTile; c: number; d: number; count: number }[] = [];
    for (const key of this.wanted().map((w) => w.key)) {
      const t = this.tiles.get(key);
      if (!t?.buffer || (relief && t.placedFor < 0)) continue;
      for (let c = 0; c < CELLS * CELLS; c++) {
        const count = t.cellStart[c + 1] - t.cellStart[c];
        if (!count) continue;
        const cx = (t.x + ((c % CELLS) + 0.5) / CELLS) / n;
        const cy = (t.y + (Math.floor(c / CELLS) + 0.5) / CELLS) / n;
        cells.push({ t, c, d: Math.hypot(cx - cam.x, cy - cam.y, cam.z), count });
      }
    }
    cells.sort((a, b) => a.d - b.d);
    const th = this.theme;
    const sc = th.scenery;
    g.useProgram(this.program);
    const u = (name: string) => this.uniforms.get(name) ?? null;
    g.uniform1f(u('u_grow'), Math.min(1, Math.max(0, (zoom - TREE_ZOOM) / (TREE_GROWN_ZOOM - TREE_ZOOM))));
    g.uniform1f(u('u_root'), relief ? ROOT_M : 0);
    g.uniform3fv(u('u_lightpos'), lightPosition(th.light.position));
    g.uniform3fv(u('u_lightcolor'), rgb(th.light.color));
    g.uniform1f(u('u_lightintensity'), th.light.intensity);
    g.uniform3fv(u('u_trunk'), rgb(sc.trunk));
    g.uniform3fv(u('u_bush'), rgb(sc.bush));
    g.uniform3fv(u('u_crowns'), sc.crowns.flatMap(rgb));
    g.uniform3fv(u('u_tops'), sc.tops.flatMap(rgb));
    g.disable(g.CULL_FACE);
    g.disable(g.BLEND);
    let full = 0;
    let drawn = 0;
    let lastTile: TreeTile | null = null;
    const stride = INSTANCE_FLOATS * 4;
    for (const cell of cells) {
      const lod = full < this.fullTrees ? 0 : 1;
      const { vao, vertices } = this.lods[lod];
      g.bindVertexArray(vao);
      if (cell.t !== lastTile) {
        const t: TreeTile = cell.t;
        const s = t.meter;
        // x metres east, y metres north (south of the corner: negative), z metres up
        const model = [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, t.origin.x, t.origin.y, 0, 1];
        g.uniformMatrix4fv(u('u_matrix'), false, mul(args.defaultProjectionData.mainMatrix, model));
        lastTile = t;
      }
      g.bindBuffer(g.ARRAY_BUFFER, cell.t.buffer);
      const first = cell.t.cellStart[cell.c] * stride;
      g.vertexAttribPointer(this.attribs.get('i_pos')!, 3, g.FLOAT, false, stride, first);
      g.vertexAttribPointer(this.attribs.get('i_size')!, 4, g.FLOAT, false, stride, first + 12);
      g.vertexAttribPointer(this.attribs.get('i_shade')!, 1, g.FLOAT, false, stride, first + 28);
      g.drawArraysInstanced(g.TRIANGLES, 0, vertices, cell.count);
      if (lod === 0) full += cell.count;
      drawn += cell.count;
    }
    g.bindVertexArray(null);
    g.bindBuffer(g.ARRAY_BUFFER, null);
    this.stats.drawn = drawn;
    this.stats.full = full;
  }
}

/** Whether a point (lng, lat) is in the area or within CLIP_M of its edge. */
function clipTester(area: Polygon | MultiPolygon): (lng: number, lat: number) => boolean {
  const polys = area.type === 'Polygon' ? [area.coordinates] : area.coordinates;
  const rings = polys.flat();
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings)
    for (const [x, y] of r) {
      [w, s, e, n] = [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)];
    }
  const lat0 = (s + n) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  const [mx, my] = [CLIP_M / kx, CLIP_M / ky];
  return (lng, lat) => {
    if (lng < w - mx || lng > e + mx || lat < s - my || lat > n + my) return false;
    let inside = false;
    let near = Infinity;
    for (const poly of polys) {
      let inPoly = false;
      poly.forEach((ring) => {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inPoly = !inPoly;
          // distance to the side, in metres
          const ax = (xi - lng) * kx;
          const ay = (yi - lat) * ky;
          const bx = (xj - lng) * kx;
          const by = (yj - lat) * ky;
          const dx = bx - ax;
          const dy = by - ay;
          const len = dx * dx + dy * dy;
          const tt = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
          near = Math.min(near, Math.hypot(ax + tt * dx, ay + tt * dy));
        }
      });
      inside ||= inPoly;
    }
    return inside || near <= CLIP_M;
  };
}
