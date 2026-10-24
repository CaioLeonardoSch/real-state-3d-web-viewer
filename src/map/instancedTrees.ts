import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from 'maplibre-gl';
import { TREE_VERTEX_FLOATS, treeMesh } from './treeMesh';

/**
 * Trees drawn by instancing (WebGL2): one low-poly model (src/map/treeMesh.ts) and, per tree, a few numbers (where it
 * stands, its size, turn and foliage colour). The GPU repeats the model for every tree, so a thousand trees cost about
 * as much memory as the numbers that place them, where fill-extrusion trees are each their own prisms.
 */

/** One tree: metres east and north of the layer's origin, scale (1 ≈ 6.5 m tall), turn (radians), foliage colour (0–1). */
export interface TreeInstance {
  x: number;
  y: number;
  scale: number;
  rot: number;
  color: [number, number, number];
}

const INSTANCE_FLOATS = 7;

const VERTEX = `#version 300 es
uniform mat4 u_matrix;
uniform vec3 u_light;
uniform vec3 u_trunk;
in vec3 a_pos;
in vec3 a_normal;
in float a_part;
in vec2 i_offset;
in float i_scale;
in float i_rot;
in vec3 i_color;
out vec3 v_color;
void main() {
  float c = cos(i_rot);
  float s = sin(i_rot);
  vec3 p = a_pos * i_scale;
  p.xy = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vec3 n = a_normal;
  n.xy = vec2(c * n.x - s * n.y, s * n.x + c * n.y);
  vec3 base = mix(u_trunk, i_color, min(a_part, 1.0));
  // sun on the facets, a little sky from above, the rest ambient (close to the fill-extrusions' look)
  float light = 0.58 + 0.34 * max(dot(n, u_light), 0.0) + 0.1 * n.z;
  v_color = base * light;
  gl_Position = u_matrix * vec4(p.xy + i_offset, p.z, 1.0);
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

export class InstancedTreesLayer implements CustomLayerInterface {
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private map!: MlMap;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private meshBuffer: WebGLBuffer | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private meshVertices = 0;
  private trees: TreeInstance[] = [];
  private dirty = true;
  /** Where the trees' metres start, and the light (direction towards the sun: east, north, up). */
  origin: [number, number];
  light: [number, number, number] = [0.55, 0.2, 0.81];
  trunk: [number, number, number] = [0.55, 0.43, 0.33];
  /** Bytes on the GPU (model and instances) and triangles drawn, for the measurements. */
  stats = { gpuBytes: 0, triangles: 0, meshTriangles: 0 };

  constructor(
    readonly id: string,
    origin: [number, number],
    /** Facets of the model (src/map/treeMesh.ts): 1 up close, 0 further away. */
    readonly detail: 0 | 1 = 1,
  ) {
    this.origin = origin;
  }

  setTrees(trees: TreeInstance[]): void {
    this.trees = trees;
    this.dirty = true;
    this.map?.triggerRepaint();
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (!('drawArraysInstanced' in gl)) throw new Error('As árvores instanciadas precisam de WebGL2.');
    this.map = map;
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
    this.program = p;
    const mesh = treeMesh(this.detail);
    this.meshVertices = mesh.length / TREE_VERTEX_FLOATS;
    this.stats.meshTriangles = this.meshVertices / 3;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.meshBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
    const stride = TREE_VERTEX_FLOATS * 4;
    const attrib = (name: string, size: number, offset: number, divisor: number) => {
      const loc = gl.getAttribLocation(p, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, divisor ? INSTANCE_FLOATS * 4 : stride, offset * 4);
      gl.vertexAttribDivisor(loc, divisor);
    };
    attrib('a_pos', 3, 0, 0);
    attrib('a_normal', 3, 3, 0);
    attrib('a_part', 1, 6, 0);
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    attrib('i_offset', 2, 0, 1);
    attrib('i_scale', 1, 2, 1);
    attrib('i_rot', 1, 3, 1);
    attrib('i_color', 3, 4, 1);
    gl.bindVertexArray(null);
    this.meshBytes = mesh.byteLength;
  }

  private meshBytes = 0;

  onRemove(): void {
    const gl = this.gl;
    if (!gl) return;
    gl.deleteBuffer(this.meshBuffer);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    this.gl = null;
  }

  private upload(gl: WebGL2RenderingContext): void {
    this.dirty = false;
    const data = new Float32Array(this.trees.length * INSTANCE_FLOATS);
    this.trees.forEach((t, i) => data.set([t.x, t.y, t.scale, t.rot, ...t.color], i * INSTANCE_FLOATS));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.stats.gpuBytes = this.meshBytes + data.byteLength;
    this.stats.triangles = this.stats.meshTriangles * this.trees.length;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const g = gl as WebGL2RenderingContext;
    if (!this.program || !this.vao) return;
    if (this.dirty) this.upload(g);
    if (!this.trees.length) return;
    const m = MercatorCoordinate.fromLngLat(this.origin, this.map.queryTerrainElevation(this.origin) ?? 0);
    const s = m.meterInMercatorCoordinateUnits();
    const model = [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, m.x, m.y, m.z, 1];
    g.useProgram(this.program);
    g.uniformMatrix4fv(g.getUniformLocation(this.program, 'u_matrix'), false, mul(args.defaultProjectionData.mainMatrix, model));
    g.uniform3fv(g.getUniformLocation(this.program, 'u_light'), this.light);
    g.uniform3fv(g.getUniformLocation(this.program, 'u_trunk'), this.trunk);
    g.bindVertexArray(this.vao);
    g.enable(g.DEPTH_TEST);
    g.depthFunc(g.LEQUAL);
    g.depthMask(true);
    g.disable(g.BLEND);
    g.disable(g.CULL_FACE);
    g.drawArraysInstanced(g.TRIANGLES, 0, this.meshVertices, this.trees.length);
    g.bindVertexArray(null);
  }
}
