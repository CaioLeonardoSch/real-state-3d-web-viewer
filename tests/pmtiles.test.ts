import { describe, expect, it } from 'vitest';
import { PMTiles, type Source } from 'pmtiles';
import { writePmtiles } from '../scripts/lib/pmtiles-writer.mjs';
import meta from '../public/data/meta.json';

/** pmtiles Source over bytes in memory (the browser uses HTTP range requests on the same layout). */
const bufferSource = (bytes: Uint8Array): Source => ({
  getKey: () => 'memory',
  getBytes: async (offset: number, length: number) => ({ data: bytes.slice(offset, offset + length).buffer }),
});

const enc = (s: string) => new TextEncoder().encode(s);

describe('PMTiles writer', () => {
  it('round-trips tiles, metadata and the header', async () => {
    const tiles = [
      { z: 0, x: 0, y: 0, data: enc('root') },
      { z: 1, x: 1, y: 0, data: enc('a') },
      { z: 1, x: 0, y: 1, data: enc('a') }, // same content: stored once
      { z: 2, x: 3, y: 2, data: enc('deep') },
    ];
    const bytes = writePmtiles(tiles, {
      minZoom: 0,
      maxZoom: 2,
      bounds: [-48.9, -26.32, -48.78, -26.21],
      center: [-48.85, -26.28],
      centerZoom: 1,
      metadata: { name: 'teste' },
      tileCompression: 1, // none: the test tiles are plain text
    });
    const p = new PMTiles(bufferSource(new Uint8Array(bytes)));
    const h = await p.getHeader();
    expect([h.minZoom, h.maxZoom, h.numAddressedTiles, h.numTileContents]).toEqual([0, 2, 4, 3]);
    expect(h.minLon).toBeCloseTo(-48.9, 6);
    expect(h.maxLat).toBeCloseTo(-26.21, 6);
    const text = async (z: number, x: number, y: number) => {
      const r = await p.getZxy(z, x, y);
      return r ? new TextDecoder().decode(r.data) : null;
    };
    expect(await text(0, 0, 0)).toBe('root');
    expect(await text(1, 1, 0)).toBe('a');
    expect(await text(1, 0, 1)).toBe('a');
    expect(await text(2, 3, 2)).toBe('deep');
    expect(await text(2, 0, 0)).toBeNull();
    expect(await p.getMetadata()).toEqual({ name: 'teste' });
  });

  it('uses leaf directories when the root directory would be too large', async () => {
    // scattered tiles of varied sizes: their directory does not compress into the first 16 KiB
    let seed = 7;
    const rnd = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) % n;
    const seen = new Set<string>();
    const tiles = [];
    while (tiles.length < 30000) {
      const [x, y] = [rnd(16384), rnd(16384)];
      if (seen.has(`${x}/${y}`)) continue;
      seen.add(`${x}/${y}`);
      tiles.push({ z: 14, x, y, data: enc(`${x}/${y}`.padEnd(5 + rnd(40), '.')) });
    }
    const probe = tiles[12345];
    const bytes = writePmtiles(tiles, {
      minZoom: 14,
      maxZoom: 14,
      bounds: [-180, -85, 180, 85],
      center: [0, 0],
      centerZoom: 14,
      metadata: {},
      tileCompression: 1,
    });
    const p = new PMTiles(bufferSource(new Uint8Array(bytes)));
    const h = await p.getHeader();
    expect(h.leafDirectoryLength).toBeGreaterThan(0);
    const r = await p.getZxy(14, probe.x, probe.y);
    expect(new TextDecoder().decode(r!.data)).toBe(new TextDecoder().decode(probe.data));
  });
});

describe('region tiles (public/data)', () => {
  it('meta.json points to the tiles and lists the neighbourhoods', () => {
    expect(meta.tiles).toBe(`${meta.region}.pmtiles`);
    expect(meta.bairros).toContain('América');
    expect(meta.bairros).toContain('Costa e Silva');
    expect(meta.bairros.length).toBeGreaterThanOrEqual(10);
  });
});
