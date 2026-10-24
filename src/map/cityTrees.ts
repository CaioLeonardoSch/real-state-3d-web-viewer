import { decodeTreeTile } from '../../scripts/lib/tree-tiles.mjs';
import { INSTANCE_TILE_ZOOM, InstancedTilesLayer, LIGHT_GLSL, rgb, type InstancedSpec } from './instancedTiles';
import type { Theme } from './lighting';
import { TREE_VERTEX_FLOATS, treeMesh, treeMeshSize } from './treeMesh';

/**
 * The city's trees (<região>-arvores.pmtiles, scripts/lib/tree-tiles.mjs): one low-poly model (src/map/treeMesh.ts)
 * repeated by the GPU (src/map/instancedTiles.ts). The trees nearest the camera get the model with every facet, up
 * to FULL_TREES of them; the rest a lighter one.
 */

/** Trees from this zoom, growing to their height by TREE_GROWN_ZOOM. */
export const TREE_ZOOM = INSTANCE_TILE_ZOOM;
const TREE_GROWN_ZOOM = 15.8;
/** Trees drawn with the full model, the nearest first (a phone's GPU has less to spare). */
const FULL_TREES = { desktop: 12000, phone: 1500 };
/** Trunks reach this far into the ground on the relief (the drawn ground and the one queried differ a little). */
const ROOT_M = 0.4;

const INSTANCE_FLOATS = 8;
const SIZE = treeMeshSize();
const KIND = { broad: 0, edge: 1, canopy: 2, bush: 3 } as const;

const VERTEX = `#version 300 es
uniform mat4 u_matrix;
uniform float u_grow;
uniform float u_root;
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
${LIGHT_GLSL}
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
  v_color = lit(color, n);
  gl_Position = u_matrix * vec4(p.xy + i_pos.xy, p.z + i_pos.z - u_root, 1.0);
}`;

const fullTrees = () => (window.matchMedia('(pointer: coarse)').matches ? FULL_TREES.phone : FULL_TREES.desktop);

const TREES: InstancedSpec = {
  id: 'trees',
  label: 'Árvores',
  minZoom: TREE_ZOOM,
  vertex: VERTEX,
  uniforms: ['u_grow', 'u_root', 'u_trunk', 'u_bush', 'u_crowns', 'u_tops'],
  vertexFloats: TREE_VERTEX_FLOATS,
  vertexAttribs: [
    ['a_pos', 3, 0],
    ['a_normal', 3, 3],
    ['a_part', 1, 6],
  ],
  instanceFloats: INSTANCE_FLOATS,
  instanceAttribs: [
    ['i_pos', 3, 0],
    ['i_size', 4, 3],
    ['i_shade', 1, 7],
  ],
  zSlot: 2,
  // the model with every facet (near) and the lighter one (far)
  meshes: [treeMesh(1), treeMesh(0)],
  groups: 1,
  decode(bytes, tile) {
    const d = decodeTreeTile(bytes);
    const data = new Float32Array(d.count * INSTANCE_FLOATS);
    for (let i = 0; i < d.count; i++) {
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
      data.set([d.fx[i] * tile.sizeM, -d.fy[i] * tile.sizeM, 0, d.r[i] / SIZE.crownRadius, sz, sink, d.rot[i], kind === KIND.bush ? 3 : d.v[i]], i * INSTANCE_FLOATS);
    }
    return { count: d.count, fx: d.fx, fy: d.fy, group: new Uint8Array(d.count), data };
  },
  meshFor: (_group, nearerDetailed) => (nearerDetailed < fullTrees() ? 0 : 1),
  setUniforms(g, u, { zoom, theme, relief }) {
    const sc = theme.scenery;
    g.uniform1f(u('u_grow'), Math.min(1, Math.max(0, (zoom - TREE_ZOOM) / (TREE_GROWN_ZOOM - TREE_ZOOM))));
    g.uniform1f(u('u_root'), relief ? ROOT_M : 0);
    g.uniform3fv(u('u_trunk'), rgb(sc.trunk));
    g.uniform3fv(u('u_bush'), rgb(sc.bush));
    g.uniform3fv(u('u_crowns'), sc.crowns.flatMap(rgb));
    g.uniform3fv(u('u_tops'), sc.tops.flatMap(rgb));
  },
};

/** The trees layer ('trees'). */
export const cityTrees = (url: string, theme: Theme) => new InstancedTilesLayer(url, theme, TREES);
