// Small textures drawn in the browser (no image files): faceted low-poly water, paving stones and dirt.
// They follow the time of day (colours from the theme) and are re-drawn when it changes.

export interface TextureImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Deterministic random numbers (the same texture every time, no flicker on theme changes). */
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

function canvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  // read back once with getImageData: a CPU canvas avoids a slow GPU read
  return c.getContext('2d', { willReadFrequently: true })!;
}

const image = (ctx: CanvasRenderingContext2D): TextureImage => {
  const d = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  return { width: d.width, height: d.height, data: d.data };
};

/**
 * Faceted surface (water, canopy of woods): a grid of triangles in three close shades (low poly), seamless when
 * tiled. Drawn at 2× for sharp screens (the map gets pixelRatio 2).
 */
export function waterFacets(base: string, light: string, deep: string, size = 128): TextureImage {
  const ctx = canvas(size, size);
  const r = rng(7);
  const n = 4;
  const cell = size / n;
  // jittered grid points; the border points repeat on the opposite side so the tile is seamless
  const jit: [number, number][][] = [];
  for (let i = 0; i <= n; i++) {
    jit[i] = [];
    for (let j = 0; j <= n; j++) jit[i][j] = [(r() - 0.5) * cell * 0.5, (r() - 0.5) * cell * 0.5];
  }
  for (let i = 0; i <= n; i++) jit[i][n] = jit[i][0];
  for (let j = 0; j <= n; j++) jit[n][j] = jit[0][j];
  const p = (i: number, j: number): [number, number] => [i * cell + jit[i][j][0], j * cell + jit[i][j][1]];
  const shades = [base, light, deep, base];
  const tri = (a: [number, number], b: [number, number], c: [number, number], fill: string) => {
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.lineTo(...c);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    // a hairline of the same colour hides the anti-aliasing seams between triangles
    ctx.strokeStyle = fill;
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      // draw the cell and its copies one tile away, so triangles crossing the edge wrap around
      for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]] as const) {
        const q = (a: number, b: number): [number, number] => {
          const [x, y] = p(a, b);
          return [x + ox, y + oy];
        };
        const s1 = shades[Math.floor(rng(i * 31 + j * 7 + 1)() * shades.length)];
        const s2 = shades[Math.floor(rng(i * 17 + j * 13 + 5)() * shades.length)];
        tri(q(i, j), q(i + 1, j), q(i + 1, j + 1), s1);
        tri(q(i, j), q(i + 1, j + 1), q(i, j + 1), s2);
      }
    }
  return image(ctx);
}

/**
 * Paving stones ("calçamento", bloquetes) for `line-pattern`: rows of offset blocks. The image height maps to the
 * width of the road.
 */
export function pavingStones(stone: string, joint: string, w = 64, h = 32): TextureImage {
  const ctx = canvas(w, h);
  ctx.fillStyle = joint;
  ctx.fillRect(0, 0, w, h);
  const rows = 4;
  const rh = h / rows;
  const bw = w / 4;
  const r = rng(11);
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let k = -1; k < 5; k++) {
      const x = k * bw + off;
      ctx.fillStyle = stone;
      ctx.globalAlpha = 0.85 + r() * 0.15;
      ctx.fillRect(x + 1, row * rh + 1, bw - 2, rh - 2);
    }
  }
  ctx.globalAlpha = 1;
  return image(ctx);
}

/** Dirt road ("estrada de chão") for `line-pattern`: sandy ground with darker specks and two wheel tracks. */
export function dirtRoad(ground: string, spot: string, w = 64, h = 32): TextureImage {
  const ctx = canvas(w, h);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);
  const r = rng(23);
  ctx.fillStyle = spot;
  for (let i = 0; i < 90; i++) {
    ctx.globalAlpha = 0.25 + r() * 0.35;
    const x = r() * w;
    const y = r() * h;
    const s = 1 + r() * 2.2;
    ctx.fillRect(x, y, s, s * (0.6 + r()));
  }
  // wheel tracks
  ctx.globalAlpha = 0.35;
  ctx.fillRect(0, h * 0.28, w, h * 0.1);
  ctx.fillRect(0, h * 0.62, w, h * 0.1);
  ctx.globalAlpha = 1;
  return image(ctx);
}
