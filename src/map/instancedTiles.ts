import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from 'maplibre-gl';
import { PMTiles } from 'pmtiles';
import type { MultiPolygon, Polygon } from 'geojson';
import { cameraPosition } from './cameraGuard';
import type { Theme } from './lighting';

/**
 * 3D scenery drawn by instancing (WebGL2) from z15 tiles of plain numbers: one small model per kind repeated by
 * the GPU with a few numbers per item (the trees, src/map/cityTrees.ts; the roofs, src/map/cityRoofs.ts). Tiles in
 * view are fetched, placed on the relief and sent to the GPU a few per frame, so a new stretch of city never stops
 * the map. The trees laboratory (lab-arvores.html) measured this against one prism per part.
 */

export const INSTANCE_TILE_ZOOM = 15;
/** How far from the centre of the view items are drawn: this many screen widths, within these bounds (m). */
const REACH_WIDTHS = 2.2;
const REACH_M: [number, number] = [700, 3500];
/** Tiles fetched at a time, sent to the GPU per frame, and kept (the nearest) once out of view. */
const MAX_FETCHES = 6;
const UPLOADS_PER_FRAME = 2;
const KEEP_TILES = 64;
/** Time per frame for placing items on the relief (ms). */
const ELEVATION_BUDGET_MS = 3;
/** Each tile in CELLS × CELLS cells: drawn the nearest to the camera first (the unit of the near/far choice). */
const CELLS = 4;
/** The relief's tiles have stopped coming in for this long (ms): place the items again. */
const RELIEF_SETTLE_MS = 250;
/** The neighbourhood filter keeps items this close to the chosen area (CLIP_BUFFER_M of the other layers). */
const CLIP_M = 100;

/**
 * The fill-extrusions' light (MapLibre's fill_extrusion.vertex.glsl) as a GLSL function, so the instanced models sit
 * with the buildings: `n` east/north/up, the light in tile coordinates (y towards the south), sides darker than the
 * tops. Needs the uniforms u_lightpos, u_lightcolor and u_lightintensity.
 */
export const LIGHT_GLSL = `
uniform vec3 u_lightpos;
uniform vec3 u_lightcolor;
uniform float u_lightintensity;
vec3 lit(vec3 color, vec3 n) {
  float colorvalue = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color += 0.03;
  float directional = clamp(dot(vec3(n.x, -n.y, n.z), u_lightpos), 0.0, 1.0);
  directional = mix(1.0 - u_lightintensity, max(1.0 - colorvalue + u_lightintensity, 1.0), directional);
  directional *= mix(mix(0.7, 0.98, 1.0 - u_lightintensity), 1.0, clamp(n.z, 0.0, 1.0));
  return clamp(color * directional * u_lightcolor, mix(vec3(0.0), vec3(0.3), 1.0 - u_lightcolor), vec3(1.0));
}`;

export const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 v_color;
out vec4 color;
void main() {
  color = vec4(v_color, 1.0);
}`;

export const rgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

/** MapLibre's sphericalToCartesian: the light's [radial, azimuthal, polar] as the fill-extrusions get it. */
function lightPosition([r, azimuthal, polar]: [number, number, number]): [number, number, number] {
  const a = ((azimuthal + 90) * Math.PI) / 180;
  const p = (polar * Math.PI) / 180;
  return [r * Math.cos(a) * Math.sin(p), r * Math.sin(a) * Math.sin(p), r * Math.cos(p)];
}

/** 4×4 column-major product a·b, in double precision (no jitter close up). */
function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return new Float32Array(o);
}

/** A z15 tile as a spec reads it: its x, y and its width in metres. */
export interface TileFrame {
  x: number;
  y: number;
  /** Metres from the tile's west edge to its east one. */
  sizeM: number;
}

/** The items of one tile, as a spec decodes them. */
export interface DecodedItems {
  count: number;
  /** Where each item stands, as a fraction of the tile from its north-west corner (east, south). */
  fx: Float32Array;
  fy: Float32Array;
  /** Which model draws it (spec.groups of them; see spec.meshFor). */
  group: Uint8Array;
  /** The instance numbers, spec.instanceFloats each; x and y (metres east and north of the tile's corner) first. */
  data: Float32Array;
  /** Building of each item, for setHidden (roofs). */
  id?: Float64Array;
}

/** What differs between the instanced layers: the models, the shader and the numbers per item. */
export interface InstancedSpec {
  id: string;
  /** Names the layer in warnings ("Árvores", "Telhados"). */
  label: string;
  minZoom: number;
  vertex: string;
  uniforms: string[];
  vertexFloats: number;
  vertexAttribs: [name: string, size: number, offset: number][];
  instanceFloats: number;
  instanceAttribs: [name: string, size: number, offset: number][];
  /** Where the item's ground height goes in its instance numbers (set from the relief, 0 without it). */
  zSlot: number;
  meshes: Float32Array[];
  groups: number;
  decode(bytes: ArrayBuffer, tile: TileFrame): DecodedItems;
  /** The model for a group, given how many items nearer the camera were already drawn with model 0. */
  meshFor(group: number, nearerDetailed: number): number;
  setUniforms(gl: WebGL2RenderingContext, u: (name: string) => WebGLUniformLocation | null, ctx: { zoom: number; theme: Theme; relief: boolean }): void;
}

interface ItemTile {
  key: string;
  x: number;
  y: number;
  /** The tile's corner (mercator) and the metre there, in mercator units. */
  origin: MercatorCoordinate;
  meter: number;
  lng: Float64Array;
  lat: Float64Array;
  group: Uint8Array;
  id: Float64Array | null;
  /** All the items' instance numbers. */
  all: Float32Array;
  /** The items drawn (the neighbourhood filter and the hidden buildings leave some out), by cell then group. */
  data: Float32Array;
  index: Uint32Array;
  /** Where each (cell, group) range starts in data, and the end. */
  start: Uint32Array;
  buffer: WebGLBuffer | null;
  uploaded: boolean;
  /**
   * On the relief: the version of the relief all the tile's items stand on (-1: not yet placed, not drawn), and the
   * placing under way (up to which item, for which version).
   */
  placedFor: number;
  placing: number;
  placingFor: number;
  lastUsed: number;
}

export class InstancedTilesLayer implements CustomLayerInterface {
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  readonly id: string;
  private map!: MlMap;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private attribs = new Map<string, number>();
  private meshes: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; vertices: number }[] = [];
  private archive: PMTiles;
  private tiles = new Map<string, ItemTile>();
  private pending = new Set<string>();
  private failed = new Set<string>();
  private clip: Polygon | MultiPolygon | null = null;
  private hidden = new Set<number>();
  private reliefVersion = 0;
  private reliefTimer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;
  /** Counts for the checks (scripts/e2e-check.mjs) and the console: tiles and items loaded, items drawn, by model. */
  stats = { tiles: 0, loaded: 0, drawn: 0, byMesh: [] as number[] };

  constructor(
    url: string,
    private theme: Theme,
    private spec: InstancedSpec,
  ) {
    this.id = spec.id;
    this.archive = new PMTiles(url);
  }

  setTheme(t: Theme): void {
    this.theme = t;
    this.map?.triggerRepaint();
  }

  /** The neighbourhood filter: only the items within CLIP_M of the area (null: all). */
  setClip(area: Polygon | MultiPolygon | null): void {
    this.clip = area;
    this.reselect();
  }

  /** Items of these buildings are not drawn (the roofs of listing buildings, drawn by the listing layers). */
  setHidden(ids: Iterable<number>): void {
    this.hidden = new Set(ids);
    this.reselect();
  }

  private reselect(): void {
    for (const t of this.tiles.values()) this.select(t);
    this.map?.triggerRepaint();
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    if (!('drawArraysInstanced' in gl)) {
      console.warn(`${this.spec.label} em 3D indisponíveis: o navegador não tem WebGL2.`);
      return;
    }
    this.gl = gl;
    const spec = this.spec;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl.VERTEX_SHADER, spec.vertex));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program');
    this.program = p;
    for (const name of ['u_matrix', 'u_lightpos', 'u_lightcolor', 'u_lightintensity', ...spec.uniforms]) this.uniforms.set(name, gl.getUniformLocation(p, name));
    for (const [name] of [...spec.vertexAttribs, ...spec.instanceAttribs]) this.attribs.set(name, gl.getAttribLocation(p, name));
    // each model with its vertex array; the instance numbers are pointed at per draw (render)
    for (const mesh of spec.meshes) {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
      for (const [name, size, offset] of spec.vertexAttribs) {
        const loc = this.attribs.get(name)!;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, spec.vertexFloats * 4, offset * 4);
      }
      for (const [name] of spec.instanceAttribs) {
        const loc = this.attribs.get(name)!;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribDivisor(loc, 1);
      }
      gl.bindVertexArray(null);
      this.meshes.push({ vao, buffer, vertices: mesh.length / spec.vertexFloats });
    }
    // the relief's tiles come in sharper as the camera nears: place the items again on them
    map.on('sourcedata', this.onSourceData);
  }

  onRemove(): void {
    this.map.off('sourcedata', this.onSourceData);
    clearTimeout(this.reliefTimer);
    const gl = this.gl;
    if (!gl) return;
    for (const t of this.tiles.values()) gl.deleteBuffer(t.buffer);
    for (const m of this.meshes) {
      gl.deleteBuffer(m.buffer);
      gl.deleteVertexArray(m.vao);
    }
    gl.deleteProgram(this.program);
    this.tiles.clear();
    this.gl = null;
  }

  /** Once the relief's tiles stop coming for a moment, the items are placed again on them. */
  private onSourceData = (e: { sourceId?: string; tile?: unknown }) => {
    if (e.sourceId !== 'terrain' || !e.tile) return;
    clearTimeout(this.reliefTimer);
    this.reliefTimer = setTimeout(() => {
      this.reliefVersion++;
      this.map.triggerRepaint();
    }, RELIEF_SETTLE_MS);
  };

  // ---------------------------------------------------------------- which tiles

  /** Metres from the centre of the view within which items are drawn. */
  private reach(): number {
    const lat = this.map.getCenter().lat;
    const mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** this.map.getZoom());
    return Math.min(REACH_M[1], Math.max(REACH_M[0], REACH_WIDTHS * this.map.getCanvas().clientWidth * mPerPx));
  }

  /** z15 tiles in view and within reach of the centre. */
  private wanted(): { x: number; y: number; key: string }[] {
    const n = 2 ** INSTANCE_TILE_ZOOM;
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
      .getZxy(INSTANCE_TILE_ZOOM, x, y)
      .then((res) => {
        if (res?.data) this.tiles.set(key, this.makeTile(x, y, key, res.data));
        else this.failed.add(key);
      })
      .catch((err: Error) => {
        console.warn(`${this.spec.label} do bloco ${key} não carregados: ${err.message}`);
        this.failed.add(key);
      })
      .finally(() => {
        this.pending.delete(key);
        this.map.triggerRepaint();
      });
  }

  private makeTile(x: number, y: number, key: string, bytes: ArrayBuffer): ItemTile {
    const n = 2 ** INSTANCE_TILE_ZOOM;
    const origin = new MercatorCoordinate(x / n, y / n, 0);
    const meter = origin.meterInMercatorCoordinateUnits();
    const d = this.spec.decode(bytes, { x, y, sizeM: 1 / n / meter });
    const lng = new Float64Array(d.count);
    const lat = new Float64Array(d.count);
    for (let i = 0; i < d.count; i++) {
      const ll = new MercatorCoordinate((x + d.fx[i]) / n, (y + d.fy[i]) / n, 0).toLngLat();
      lng[i] = ll.lng;
      lat[i] = ll.lat;
    }
    const tile: ItemTile = {
      key,
      x,
      y,
      origin,
      meter,
      lng,
      lat,
      group: d.group,
      id: d.id ?? null,
      all: d.data,
      data: new Float32Array(0),
      index: new Uint32Array(0),
      start: new Uint32Array(CELLS * CELLS * this.spec.groups + 1),
      buffer: null,
      uploaded: false,
      placedFor: -1,
      placing: 0,
      placingFor: -1,
      lastUsed: this.frame,
    };
    // the cell of each item, from its place in the tile
    this.cellOf.set(tile, Uint8Array.from(d.fx, (fx, i) => Math.min(CELLS - 1, Math.floor(d.fy[i] * CELLS)) * CELLS + Math.min(CELLS - 1, Math.floor(fx * CELLS))));
    this.select(tile);
    return tile;
  }

  private cellOf = new WeakMap<ItemTile, Uint8Array>();

  /** The tile's items to draw (the neighbourhood filter, the hidden buildings), ordered by cell and group. */
  private select(t: ItemTile): void {
    const F = this.spec.instanceFloats;
    const G = this.spec.groups;
    const count = t.lng.length;
    const keep = this.clip ? clipTester(this.clip) : null;
    const cells = this.cellOf.get(t)!;
    const slotOf = new Uint32Array(count);
    const perSlot = new Uint32Array(CELLS * CELLS * G);
    const kept: number[] = [];
    for (let i = 0; i < count; i++) {
      if (keep && !keep(t.lng[i], t.lat[i])) continue;
      if (t.id && this.hidden.has(t.id[i])) continue;
      const slot = cells[i] * G + t.group[i];
      slotOf[i] = slot;
      perSlot[slot]++;
      kept.push(i);
    }
    t.start[0] = 0;
    for (let s = 0; s < perSlot.length; s++) t.start[s + 1] = t.start[s] + perSlot[s];
    const next = t.start.slice(0, perSlot.length);
    t.index = new Uint32Array(kept.length);
    for (const i of kept) t.index[next[slotOf[i]]++] = i;
    t.data = new Float32Array(kept.length * F);
    t.index.forEach((i, j) => t.data.set(t.all.subarray(i * F, (i + 1) * F), j * F));
    t.uploaded = false;
  }

  // ---------------------------------------------------------------- each frame

  prerender(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    const g = gl as WebGL2RenderingContext;
    if (!this.gl || this.map.getZoom() < this.spec.minZoom) return;
    this.frame++;
    const F = this.spec.instanceFloats;
    const Z = this.spec.zSlot;
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
      // on the relief, each item on its ground: a few milliseconds a frame, the tile drawn once all its items stand
      // (as they stood before, while the relief's sharper tiles move them again)
      if (relief && t.placedFor !== this.reliefVersion) {
        if (t.placingFor !== this.reliefVersion) [t.placing, t.placingFor] = [0, this.reliefVersion];
        const count = t.lng.length;
        while (t.placing < count && performance.now() < deadline) {
          const end = Math.min(count, t.placing + 64);
          for (let i = t.placing; i < end; i++) t.all[i * F + Z] = this.map.queryTerrainElevation([t.lng[i], t.lat[i]]) ?? 0;
          t.placing = end;
        }
        if (t.placing < count) {
          busy = true;
          if (t.placedFor < 0) continue;
        } else {
          t.placedFor = this.reliefVersion;
          t.index.forEach((i, j) => (t.data[j * F + Z] = t.all[i * F + Z]));
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
    for (const t of old.slice(0, this.tiles.size - KEEP_TILES) as ItemTile[]) {
      this.gl?.deleteBuffer(t.buffer);
      this.tiles.delete(t.key);
    }
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const g = gl as WebGL2RenderingContext;
    const spec = this.spec;
    const zoom = this.map.getZoom();
    const byMesh = spec.meshes.map(() => 0);
    this.stats = { tiles: this.tiles.size, loaded: [...this.tiles.values()].reduce((a, t) => a + t.lng.length, 0), drawn: 0, byMesh };
    if (!this.program || zoom < spec.minZoom) return;
    const relief = !!this.map.getTerrain();
    // cells of the tiles ready to draw, the nearest to the camera first
    const view = cameraPosition([this.map.getCenter().lng, this.map.getCenter().lat], zoom, this.map.getPitch(), this.map.getBearing(),
      this.map.getVerticalFieldOfView(), this.map.getContainer().clientHeight);
    const cam = MercatorCoordinate.fromLngLat(view.lngLat, view.altitudeM);
    const n = 2 ** INSTANCE_TILE_ZOOM;
    const G = spec.groups;
    const cells: { t: ItemTile; c: number; d: number }[] = [];
    for (const key of this.wanted().map((w) => w.key)) {
      const t = this.tiles.get(key);
      if (!t?.buffer || (relief && t.placedFor < 0)) continue;
      for (let c = 0; c < CELLS * CELLS; c++) {
        if (t.start[(c + 1) * G] === t.start[c * G]) continue;
        const cx = (t.x + ((c % CELLS) + 0.5) / CELLS) / n;
        const cy = (t.y + (Math.floor(c / CELLS) + 0.5) / CELLS) / n;
        cells.push({ t, c, d: Math.hypot(cx - cam.x, cy - cam.y, cam.z) });
      }
    }
    cells.sort((a, b) => a.d - b.d);
    g.useProgram(this.program);
    const u = (name: string) => this.uniforms.get(name) ?? null;
    const th = this.theme;
    g.uniform3fv(u('u_lightpos'), lightPosition(th.light.position));
    g.uniform3fv(u('u_lightcolor'), rgb(th.light.color));
    g.uniform1f(u('u_lightintensity'), th.light.intensity);
    spec.setUniforms(g, u, { zoom, theme: th, relief });
    g.disable(g.CULL_FACE);
    g.disable(g.BLEND);
    let drawn = 0;
    let lastTile: ItemTile | null = null;
    const stride = spec.instanceFloats * 4;
    for (const cell of cells) {
      const t: ItemTile = cell.t;
      if (t !== lastTile) {
        const s = t.meter;
        // x metres east, y metres north (south of the corner: negative), z metres up
        const model = [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, t.origin.x, t.origin.y, 0, 1];
        g.uniformMatrix4fv(u('u_matrix'), false, mul(args.defaultProjectionData.mainMatrix, model));
        lastTile = t;
      }
      for (let grp = 0; grp < G; grp++) {
        const slot = cell.c * G + grp;
        const count = t.start[slot + 1] - t.start[slot];
        if (!count) continue;
        const m = spec.meshFor(grp, byMesh[0]);
        g.bindVertexArray(this.meshes[m].vao);
        g.bindBuffer(g.ARRAY_BUFFER, t.buffer);
        const first = t.start[slot] * stride;
        for (const [name, size, offset] of spec.instanceAttribs) g.vertexAttribPointer(this.attribs.get(name)!, size, g.FLOAT, false, stride, first + offset * 4);
        g.drawArraysInstanced(g.TRIANGLES, 0, this.meshes[m].vertices, count);
        byMesh[m] += count;
        drawn += count;
      }
    }
    g.bindVertexArray(null);
    g.bindBuffer(g.ARRAY_BUFFER, null);
    this.stats.drawn = drawn;
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
