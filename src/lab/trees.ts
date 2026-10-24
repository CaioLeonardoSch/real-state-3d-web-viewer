// Laboratory page (lab-arvores.html): the map's trees drawn as today (fill-extrusion prisms, the shapes of
// scripts/lib/scenery.mjs) and by instancing (src/map/instancedTrees.ts), side by side in numbers: 1, 100, 1,000 and
// 10,000 trees on a flat ground, the same camera for both. Measures how long the trees take to be ready, the time to
// draw a frame (CPU and GPU, while the camera turns) and what goes to the GPU. Runs on the visitor's own GPU.
import 'maplibre-gl/dist/maplibre-gl.css';
import './trees.css';
import { Map as MlMap, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { themeFor } from '../map/lighting';
import { InstancedTreesLayer, type TreeInstance } from '../map/instancedTrees';

setWorkerUrl(workerUrl);

type Tech = 'atual' | 'instanciada' | 'leve';
const TECH_LABEL: Record<Tech, string> = { atual: 'Atual', instanciada: 'Instanciada', leve: 'Instanciada leve' };
const ORIGIN: [number, number] = [-48.8456, -26.3044];
const SPACING_M = 7;
const FRAMES = 40;
const M_PER_DEG_LAT = 110_540;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

const { theme } = themeFor('morning', ORIGIN[1], ORIGIN[0]);
const sc = theme.scenery;

/** Deterministic random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Spot {
  x: number;
  y: number;
  scale: number;
  rot: number;
  v: number;
}

/** n trees on a jittered grid around ORIGIN (metres east, north), the same for both techniques. */
function spots(n: number): Spot[] {
  const r = rng(42);
  const side = Math.ceil(Math.sqrt(n));
  const out: Spot[] = [];
  for (let i = 0; i < n; i++) {
    const gx = (i % side) - (side - 1) / 2;
    const gy = Math.floor(i / side) - (side - 1) / 2;
    out.push({
      x: (gx + (n > 1 ? (r() - 0.5) * 0.6 : 0)) * SPACING_M,
      y: (gy + (n > 1 ? (r() - 0.5) * 0.6 : 0)) * SPACING_M,
      scale: n > 1 ? 0.75 + r() * 0.55 : 1,
      rot: r() * Math.PI * 2,
      v: Math.floor(r() * 3),
    });
  }
  return out;
}

// ---------------------------------------------------------------- today's trees (as scripts/lib/scenery.mjs draws them)

function ringAround(x: number, y: number, radius: number, sides: number, rot: number): number[][][] {
  const kx = mPerDegLng(ORIGIN[1]);
  const pts: number[][] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    pts.push([ORIGIN[0] + (x + radius * Math.cos(a)) / kx, ORIGIN[1] + (y + radius * Math.sin(a)) / M_PER_DEG_LAT]);
  }
  pts.push(pts[0]);
  return [pts];
}
const round1 = (v: number) => Math.round(v * 10) / 10;

/** A tree of today's map: trunk, faceted crown and its top (treeShapes in scripts/lib/scenery.mjs, a street tree). */
function prismTree(s: Spot): Feature<Polygon>[] {
  const k = s.scale;
  const crownR = 2.4 * k;
  const trunkTop = round1(2 * k);
  const crownTop = round1(trunkTop + 3.4 * k);
  const f = (p: string, b: number, h: number, coordinates: number[][][]): Feature<Polygon> => ({
    type: 'Feature',
    properties: { p, b, h, v: s.v },
    geometry: { type: 'Polygon', coordinates },
  });
  return [
    f('trunk', 0, trunkTop, ringAround(s.x, s.y, 0.35 * k, 4, s.rot)),
    f('crown', round1(trunkTop - 0.4), crownTop, ringAround(s.x, s.y, crownR, 6, s.rot)),
    f('top', crownTop, round1(crownTop + 1.6 * k), ringAround(s.x, s.y, crownR * 0.55, 6, s.rot + Math.PI / 6)),
  ];
}

const shade = (c: [string, string, string]): ExpressionSpecification => ['match', ['get', 'v'], 0, c[0], 1, c[1], c[2]];
const TREE_COLOR: ExpressionSpecification = ['match', ['get', 'p'], 'trunk', sc.trunk, 'top', shade(sc.tops), shade(sc.crowns)];

// ---------------------------------------------------------------- instanced trees

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

function instances(list: Spot[]): TreeInstance[] {
  const r = rng(7);
  return list.map((s) => {
    const base = rgb(sc.crowns[s.v]);
    const k = 0.94 + r() * 0.12;
    return { x: s.x, y: s.y, scale: s.scale, rot: s.rot, color: [base[0] * k, base[1] * k, base[2] * k] };
  });
}

/** Direction towards the sun (east, north, up) from MapLibre's light position [radial, azimuth°, polar°]. */
function sunDirection(): [number, number, number] {
  const [, az, polar] = theme.light.position;
  const a = (az * Math.PI) / 180;
  const p = (polar * Math.PI) / 180;
  return [Math.sin(p) * Math.sin(a), Math.sin(p) * Math.cos(a), Math.cos(p)];
}

// ---------------------------------------------------------------- map and measurements

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const map = new MlMap({
  container: 'lab-map',
  style: {
    version: 8,
    sources: { prisms: { type: 'geojson', data: EMPTY, maxzoom: 20 } },
    light: { anchor: 'map', ...theme.light },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': sc.greens.park } },
      {
        id: 'prism-trees',
        type: 'fill-extrusion',
        source: 'prisms',
        paint: {
          'fill-extrusion-color': TREE_COLOR,
          'fill-extrusion-base': ['get', 'b'],
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-vertical-gradient': true,
        },
      },
    ],
  },
  center: ORIGIN,
  zoom: 18,
  pitch: 60,
  bearing: 20,
  maxPitch: 75,
  attributionControl: false,
  canvasContextAttributes: { antialias: true },
});
const instanced = new InstancedTreesLayer('instanced-trees', ORIGIN, 1);
const light = new InstancedTreesLayer('instanced-trees-light', ORIGIN, 0);
for (const layer of [instanced, light]) {
  layer.light = sunDirection();
  layer.trunk = rgb(sc.trunk);
}

const status = document.querySelector<HTMLElement>('.lab-status')!;
const tbody = document.querySelector<HTMLTableSectionElement>('.lab-results tbody')!;
const copyButton = document.querySelector<HTMLButtonElement>('[data-action="copy"]')!;
const idle = () => new Promise<void>((r) => map.once('idle', () => r()));

function gpuName(): string {
  const gl = map.getCanvas().getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'n/d';
}

function camera(n: number) {
  const half = (Math.ceil(Math.sqrt(n)) * SPACING_M) / 2 + 4;
  const kx = mPerDegLng(ORIGIN[1]);
  const bounds: LngLatBoundsLike = [
    [ORIGIN[0] - half / kx, ORIGIN[1] - half / M_PER_DEG_LAT],
    [ORIGIN[0] + half / kx, ORIGIN[1] + half / M_PER_DEG_LAT],
  ];
  return map.cameraForBounds(bounds, { padding: 30, pitch: 60, bearing: 20, maxZoom: 20.5 })!;
}

/** GPU bytes and triangles of the prism trees (the buckets of the GeoJSON source's tiles). */
function prismStats(): { bytes: number; triangles: number } {
  const tm = (map as unknown as { style: { tileManagers: Record<string, { getRenderableIds(): string[]; getTileByID(id: string): { buckets?: Record<string, unknown> } }> } }).style.tileManagers.prisms;
  let bytes = 0;
  let triangles = 0;
  type Arr = { bytesPerElement: number; length: number };
  type Bucket = { layoutVertexArray?: Arr; indexArray?: Arr; centroidVertexArray?: Arr; programConfigurations?: { programConfigurations: Record<string, { binders: Record<string, { paintVertexArray?: Arr }> }> } };
  const size = (a?: Arr) => (a ? a.bytesPerElement * a.length : 0);
  for (const id of tm.getRenderableIds()) {
    for (const b of Object.values(tm.getTileByID(id).buckets ?? {}) as Bucket[]) {
      bytes += size(b.layoutVertexArray) + size(b.indexArray) + size(b.centroidVertexArray);
      for (const pc of Object.values(b.programConfigurations?.programConfigurations ?? {})) for (const bd of Object.values(pc.binders)) bytes += size(bd.paintVertexArray);
      triangles += b.indexArray?.length ?? 0;
    }
  }
  return { bytes, triangles };
}

function clear(): void {
  (map.getSource('prisms') as GeoJSONSource).setData(EMPTY);
  instanced.setTrees([]);
  light.setTrees([]);
}

async function show(tech: Tech, n: number): Promise<number> {
  clear();
  map.jumpTo(camera(n));
  await idle();
  const list = spots(n);
  const t0 = performance.now();
  if (tech === 'atual') (map.getSource('prisms') as GeoJSONSource).setData({ type: 'FeatureCollection', features: list.flatMap(prismTree) });
  else (tech === 'leve' ? light : instanced).setTrees(instances(list));
  map.triggerRepaint();
  await idle();
  return performance.now() - t0;
}

/**
 * Frame time with the GPU done, turning the camera a little each frame. gl.finish() does not wait in Chrome (WebGL runs
 * in another process); reading one pixel back does.
 */
function frameTimes(): number[] {
  const gl = map.getCanvas().getContext('webgl2')!;
  const b0 = map.getBearing();
  const times: number[] = [];
  const px = new Uint8Array(4);
  for (let i = 0; i < FRAMES; i++) {
    const t = performance.now();
    map.setBearing(b0 + (i + 1) * 1.5);
    map.redraw();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    times.push(performance.now() - t);
  }
  map.setBearing(b0);
  return times.sort((a, b) => a - b);
}

interface Row {
  tech: Tech;
  n: number;
  setupMs: number;
  medianMs: number;
  p95Ms: number;
  gpuMB: number;
  triangles: number;
}
const rows: Row[] = [];

async function measure(tech: Tech, n: number): Promise<Row> {
  status.textContent = `Medindo: ${TECH_LABEL[tech].toLowerCase()}, ${n.toLocaleString('pt-BR')} árvores…`;
  const setupMs = await show(tech, n);
  const layer = tech === 'leve' ? light : instanced;
  const st = tech === 'atual' ? prismStats() : { bytes: layer.stats.gpuBytes, triangles: layer.stats.triangles };
  const f = frameTimes();
  const row: Row = {
    tech,
    n,
    setupMs: Math.round(setupMs),
    medianMs: +f[Math.floor(f.length / 2)].toFixed(1),
    p95Ms: +f[Math.floor(f.length * 0.95)].toFixed(1),
    gpuMB: +(st.bytes / 1e6).toFixed(2),
    triangles: st.triangles,
  };
  rows.push(row);
  const tr = document.createElement('tr');
  for (const v of [TECH_LABEL[row.tech], row.n.toLocaleString('pt-BR'), row.setupMs, row.medianMs, row.p95Ms, row.gpuMB, row.triangles.toLocaleString('pt-BR')]) {
    const td = document.createElement('td');
    td.textContent = String(v);
    tr.append(td);
  }
  tbody.append(tr);
  copyButton.disabled = false;
  status.textContent = `Pronto. Placa de vídeo: ${gpuName()}`;
  return row;
}

const selected = () => ({
  tech: (document.querySelector<HTMLInputElement>('input[name="tech"]:checked')!.value as Tech) ?? 'atual',
  n: Number(document.querySelector<HTMLInputElement>('input[name="n"]:checked')!.value),
});

let busy = false;
const run = async (job: () => Promise<unknown>) => {
  if (busy) return;
  busy = true;
  document.querySelectorAll<HTMLButtonElement>('.lab-controls button').forEach((b) => (b.disabled = true));
  try {
    await job();
  } catch (e) {
    status.textContent = `Erro: ${(e as Error).message}`;
  } finally {
    busy = false;
    document.querySelectorAll<HTMLButtonElement>('.lab-controls button').forEach((b) => (b.disabled = b.dataset.action === 'copy' && !rows.length));
  }
};

map.on('load', () => {
  map.addLayer(instanced);
  map.addLayer(light);
  status.textContent = `Placa de vídeo: ${gpuName()}. Escolha a técnica e a quantidade, ou meça todas.`;
  const s = selected();
  void run(() => show(s.tech, s.n));
  document.querySelectorAll<HTMLInputElement>('.lab-controls input').forEach((i) =>
    i.addEventListener('change', () => {
      const c = selected();
      void run(() => show(c.tech, c.n));
    }),
  );
  document.querySelector('[data-action="one"]')!.addEventListener('click', () => {
    const c = selected();
    void run(() => measure(c.tech, c.n));
  });
  document.querySelector('[data-action="all"]')!.addEventListener('click', () =>
    run(async () => {
      for (const n of [1, 100, 1000, 10000]) for (const tech of ['atual', 'instanciada', 'leve'] as Tech[]) await measure(tech, n);
    }),
  );
  copyButton.addEventListener('click', async () => {
    const text = [`Placa de vídeo: ${gpuName()}`, 'técnica\tárvores\tmontagem ms\tquadro mediana ms\tquadro p95 ms\tplaca MB\ttriângulos', ...rows.map((r) => [r.tech, r.n, r.setupMs, r.medianMs, r.p95Ms, r.gpuMB, r.triangles].join('\t'))].join('\n');
    await navigator.clipboard.writeText(text).catch(() => undefined);
    status.textContent = 'Resultados copiados: cole na conversa.';
  });
});

// for the automated checks and for measuring from the console
(window as unknown as { __lab: unknown }).__lab = { map, measure, show, rows, instanced, light };
