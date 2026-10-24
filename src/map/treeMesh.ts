/**
 * Low-poly tree model for the instanced trees (src/map/instancedTrees.ts): a tapered hexagonal trunk and a crown of two
 * faceted lobes (icospheres pushed in and out a little, so the facets catch the light like the rest of the low-poly
 * city). Metres, x east, y north, z up, the trunk's foot at the origin; about 2.4 m of trunk and 6.5 m in all at scale 1.
 * Flat shaded: each triangle has its own three vertices with the triangle's normal.
 *
 * Per vertex, 7 floats: position (3), normal (3) and part (0 trunk, 1 foliage).
 */

export const TREE_VERTEX_FLOATS = 7;

type V3 = [number, number, number];

function icosphere(level: number): { v: V3[]; f: [number, number, number][] } {
  const t = (1 + Math.sqrt(5)) / 2;
  let v: V3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => norm(p as V3));
  let f: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let l = 0; l < level; l++) {
    const mid = new Map<string, number>();
    const at = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let i = mid.get(key);
      if (i === undefined) {
        i = v.length;
        v = [...v, norm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2])];
        mid.set(key, i);
      }
      return i;
    };
    f = f.flatMap(([a, b, c]) => {
      const ab = at(a, b);
      const bc = at(b, c);
      const ca = at(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] as [number, number, number][];
    });
  }
  return { v, f };
}

function norm(p: V3): V3 {
  const l = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / l, p[1] / l, p[2] / l];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Deterministic noise in [-1, 1] for vertex i. */
const jitter = (i: number) => Math.sin(i * 12.9898 + 78.233) * 43758.5453 % 1;

/**
 * The model as flat-shaded triangles (TREE_VERTEX_FLOATS floats per vertex). `detail` 1: lobes of 80 facets (172
 * triangles in all), for up close; 0: lobes of 20 facets (52 triangles), the same tree for further away.
 */
export function treeMesh(detail: 0 | 1 = 1): Float32Array {
  const out: number[] = [];
  const tri = (a: V3, b: V3, c: V3, part: number) => {
    let n = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
    // outward: away from the shape's axis (the crown lobes and the trunk are all convex around it)
    const mid: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (n[0] * mid[0] + n[1] * mid[1] < 0 && Math.abs(n[2]) < 0.9) n = [-n[0], -n[1], -n[2]];
    for (const p of [a, b, c]) out.push(p[0], p[1], p[2], n[0], n[1], n[2], part);
  };
  // trunk: hexagonal frustum
  const sides = 6;
  const r0 = 0.28;
  const r1 = 0.18;
  const h = 2.6;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const p00: V3 = [r0 * Math.cos(a0), r0 * Math.sin(a0), 0];
    const p01: V3 = [r0 * Math.cos(a1), r0 * Math.sin(a1), 0];
    const p10: V3 = [r1 * Math.cos(a0), r1 * Math.sin(a0), h];
    const p11: V3 = [r1 * Math.cos(a1), r1 * Math.sin(a1), h];
    tri(p00, p01, p11, 0);
    tri(p00, p11, p10, 0);
  }
  // crown: a main lobe and a smaller one on top, slightly off the axis
  const sphere = icosphere(detail);
  const lobes: { c: V3; r: V3 }[] = [
    { c: [0, 0, 3.9], r: [2.3, 2.3, 1.9] },
    { c: [0.45, -0.3, 5.3], r: [1.45, 1.45, 1.25] },
  ];
  let k = 0;
  for (const lobe of lobes) {
    const pts = sphere.v.map((p, i) => {
      const s = 1 + 0.13 * jitter(i + k * 101);
      return [lobe.c[0] + p[0] * lobe.r[0] * s, lobe.c[1] + p[1] * lobe.r[1] * s, lobe.c[2] + p[2] * lobe.r[2] * s] as V3;
    });
    for (const [a, b, c] of sphere.f) {
      // facet normal pointing out of the lobe
      const pa = pts[a];
      const pb = pts[b];
      const pc = pts[c];
      const n = cross([pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]]);
      const mid: V3 = [(pa[0] + pb[0] + pc[0]) / 3 - lobe.c[0], (pa[1] + pb[1] + pc[1]) / 3 - lobe.c[1], (pa[2] + pb[2] + pc[2]) / 3 - lobe.c[2]];
      const outward = n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] >= 0;
      const [x, y, z] = outward ? [pa, pb, pc] : [pa, pc, pb];
      const nn = norm(cross([y[0] - x[0], y[1] - x[1], y[2] - x[2]], [z[0] - x[0], z[1] - x[1], z[2] - x[2]]));
      for (const p of [x, y, z]) out.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], 1);
    }
    k++;
  }
  return new Float32Array(out);
}
