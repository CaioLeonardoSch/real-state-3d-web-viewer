/**
 * Low-poly roof models for the instanced roofs (src/map/cityRoofs.ts), in unit coordinates: x along the ridge
 * (−0.5 to 0.5 of the length), y across it (−0.5 to 0.5 of the width), z up (0 at the eaves to 1 at the ridge, of
 * the rise). The shader stretches them over each roof. Flat shaded: each triangle has its own three vertices.
 *
 * Per vertex, 8 floats: position (3), normal (3, in unit coordinates: the shader divides it by width, width and
 * rise), part (0 roof, 1 gable wall, 2 the eaves' edge: its z in metres below the roof) and ridge (1: x is the end
 * of a hip's ridge, set from the length and width).
 */

export const ROOF_VERTEX_FLOATS = 8;
/** Depth of the eaves' edge (m): the roof shows a thickness. */
const EDGE_M = 0.25;

type V3 = [number, number, number];

function builder() {
  const out: number[] = [];
  const tri = (a: V3, b: V3, c: V3, n: V3, part: number, ridge: [number, number, number] = [0, 0, 0]) => {
    [a, b, c].forEach((p, i) => out.push(p[0], p[1], p[2], n[0], n[1], n[2], part, ridge[i]));
  };
  const quad = (a: V3, b: V3, c: V3, d: V3, n: V3, part: number, ridge: [number, number, number, number] = [0, 0, 0, 0]) => {
    tri(a, b, c, n, part, [ridge[0], ridge[1], ridge[2]]);
    tri(a, c, d, n, part, [ridge[0], ridge[2], ridge[3]]);
  };
  /** The eaves' edge: a band EDGE_M deep all around the roof's outline. */
  const edge = () => {
    const z = -EDGE_M;
    quad([-0.5, -0.5, z], [0.5, -0.5, z], [0.5, -0.5, 0], [-0.5, -0.5, 0], [0, -1, 0], 2);
    quad([0.5, 0.5, z], [-0.5, 0.5, z], [-0.5, 0.5, 0], [0.5, 0.5, 0], [0, 1, 0], 2);
    quad([0.5, -0.5, z], [0.5, 0.5, z], [0.5, 0.5, 0], [0.5, -0.5, 0], [1, 0, 0], 2);
    quad([-0.5, 0.5, z], [-0.5, -0.5, z], [-0.5, -0.5, 0], [-0.5, 0.5, 0], [-1, 0, 0], 2);
  };
  return { out, tri, quad, edge };
}

/** Gable: two slopes up to a ridge along the length, a triangular wall at each end. */
export function gableMesh(): Float32Array {
  const { out, tri, quad, edge } = builder();
  // the slopes rise half the width over the whole rise: normal (0, ±1, 0.5) in unit coordinates
  quad([-0.5, 0.5, 0], [0.5, 0.5, 0], [0.5, 0, 1], [-0.5, 0, 1], [0, 1, 0.5], 0);
  quad([0.5, -0.5, 0], [-0.5, -0.5, 0], [-0.5, 0, 1], [0.5, 0, 1], [0, -1, 0.5], 0);
  tri([0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, 0, 1], [1, 0, 0], 1);
  tri([-0.5, 0.5, 0], [-0.5, -0.5, 0], [-0.5, 0, 1], [-1, 0, 0], 1);
  edge();
  return new Float32Array(out);
}

/** Hip: four slopes; the ridge is shortened by the width (marked vertices), so every slope has the same pitch. */
export function hipMesh(): Float32Array {
  const { out, tri, quad, edge } = builder();
  quad([-0.5, 0.5, 0], [0.5, 0.5, 0], [0.5, 0, 1], [-0.5, 0, 1], [0, 1, 0.5], 0, [0, 0, 1, 1]);
  quad([0.5, -0.5, 0], [-0.5, -0.5, 0], [-0.5, 0, 1], [0.5, 0, 1], [0, -1, 0.5], 0, [0, 0, 1, 1]);
  tri([0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, 0, 1], [1, 0, 0.5], 0, [0, 0, 1]);
  tri([-0.5, 0.5, 0], [-0.5, -0.5, 0], [-0.5, 0, 1], [-1, 0, 0.5], 0, [0, 0, 1]);
  edge();
  return new Float32Array(out);
}

/** Water tank and lift room: a box on the flat roof. */
export function tankMesh(): Float32Array {
  const { out, quad } = builder();
  quad([-0.5, -0.5, 1], [0.5, -0.5, 1], [0.5, 0.5, 1], [-0.5, 0.5, 1], [0, 0, 1], 0);
  quad([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, -0.5, 1], [-0.5, -0.5, 1], [0, -1, 0], 0);
  quad([0.5, 0.5, 0], [-0.5, 0.5, 0], [-0.5, 0.5, 1], [0.5, 0.5, 1], [0, 1, 0], 0);
  quad([0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, -0.5, 1], [1, 0, 0], 0);
  quad([-0.5, 0.5, 0], [-0.5, -0.5, 0], [-0.5, -0.5, 1], [-0.5, 0.5, 1], [-1, 0, 0], 0);
  return new Float32Array(out);
}
