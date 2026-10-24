import { decodeRoofTile } from '../../scripts/lib/roof-tiles.mjs';
import { Z_3D_FULL, Z_3D_START } from './baseStyle';
import { INSTANCE_TILE_ZOOM, InstancedTilesLayer, LIGHT_GLSL, rgb, type InstancedSpec } from './instancedTiles';
import type { Theme } from './lighting';
import { ROOF_VERTEX_FLOATS, gableMesh, hipMesh, tankMesh } from './roofMesh';

/**
 * The roofs (<região>-telhados.pmtiles, scripts/lib/roofs.mjs and roof-tiles.mjs): a gable, a hip and a water tank
 * model (src/map/roofMesh.ts) stretched over each roof by the GPU (src/map/instancedTiles.ts), with real slopes
 * where the fill-extrusions could only stack flat steps.
 */

/** Roofs from this zoom; they rise with the buildings (Z_3D_START to Z_3D_FULL), whose tops they sit on. */
export const ROOF_ZOOM = INSTANCE_TILE_ZOOM;
/** The eaves' edge, a little darker than the roof. */
const EDGE_SHADE = 0.82;

const INSTANCE_FLOATS = 9;

const VERTEX = `#version 300 es
uniform mat4 u_matrix;
uniform float u_grow;
uniform vec3 u_roofs[4];
uniform vec3 u_wall;
in vec3 a_pos;
in vec3 a_normal;
in float a_part;
in float a_ridge;
in vec3 i_pos;
in vec4 i_dims;
in float i_turn;
in float i_shade;
out vec3 v_color;
${LIGHT_GLSL}
void main() {
  // i_dims: length, width, rise, height of the walls
  float len = i_dims.x;
  float wid = i_dims.y;
  float x = a_ridge > 0.5 ? sign(a_pos.x) * max(0.0, 0.5 * (len - wid)) : a_pos.x * len;
  float z = a_part > 1.5 ? a_pos.z : a_pos.z * i_dims.z;
  vec2 p = vec2(x, a_pos.y * wid);
  vec3 n = normalize(a_normal / vec3(wid, wid, i_dims.z));
  float c = cos(i_turn);
  float s = sin(i_turn);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  n.xy = vec2(c * n.x - s * n.y, s * n.x + c * n.y);
  vec3 roof = u_roofs[int(i_shade + 0.5)];
  vec3 color = a_part < 0.5 ? roof : a_part < 1.5 ? u_wall : roof * ${EDGE_SHADE};
  v_color = lit(color, n);
  gl_Position = u_matrix * vec4(p + i_pos.xy, i_pos.z + (i_dims.w + z) * u_grow, 1.0);
}`;

const ROOFS: InstancedSpec = {
  id: 'roofs',
  label: 'Telhados',
  minZoom: ROOF_ZOOM,
  vertex: VERTEX,
  uniforms: ['u_grow', 'u_roofs', 'u_wall'],
  vertexFloats: ROOF_VERTEX_FLOATS,
  vertexAttribs: [
    ['a_pos', 3, 0],
    ['a_normal', 3, 3],
    ['a_part', 1, 6],
    ['a_ridge', 1, 7],
  ],
  instanceFloats: INSTANCE_FLOATS,
  instanceAttribs: [
    ['i_pos', 3, 0],
    ['i_dims', 4, 3],
    ['i_turn', 1, 7],
    ['i_shade', 1, 8],
  ],
  zSlot: 2,
  // in the order of ROOF_KINDS (scripts/lib/roof-tiles.mjs)
  meshes: [gableMesh(), hipMesh(), tankMesh()],
  groups: 3,
  decode(bytes, tile) {
    const d = decodeRoofTile(bytes);
    const data = new Float32Array(d.count * INSTANCE_FLOATS);
    for (let i = 0; i < d.count; i++)
      data.set([d.fx[i] * tile.sizeM, -d.fy[i] * tile.sizeM, 0, d.length[i], d.width[i], d.rise[i], d.base[i], d.angle[i], d.v[i]], i * INSTANCE_FLOATS);
    return { count: d.count, fx: d.fx, fy: d.fy, group: d.kind, data, id: d.id };
  },
  meshFor: (group) => group,
  setUniforms(g, u, { zoom, theme }) {
    g.uniform1f(u('u_grow'), Math.min(1, Math.max(0, (zoom - Z_3D_START) / (Z_3D_FULL - Z_3D_START))));
    g.uniform3fv(u('u_roofs'), theme.scenery.roofs.flatMap(rgb));
    g.uniform3fv(u('u_wall'), rgb(theme.context));
  },
};

/** The roofs layer ('roofs'). */
export const cityRoofs = (url: string, theme: Theme) => new InstancedTilesLayer(url, theme, ROOFS);
