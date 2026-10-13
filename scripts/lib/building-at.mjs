// Building of the map at a point, read from the region's vector tiles (public/data/<region>.pmtiles): outline,
// OSM id, height and the "residential" mark computed when the tiles were built. Used by the XML import to put each
// listing on its real building.
import { open } from 'node:fs/promises';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';
import turfBooleanPointInPolygon from '@turf/boolean-point-in-polygon';
import turfDistance from '@turf/distance';
import turfCentroid from '@turf/centroid';

const Z = 15; // the tiles' full-detail zoom

/** Reads byte ranges of a local file (the pmtiles library reads archives by range). */
class FileRangeSource {
  constructor(handle, key) {
    this.handle = handle;
    this.key = key;
  }
  getKey() {
    return this.key;
  }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await this.handle.read(buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead) };
  }
}

export async function openBuildings(pmtilesPath) {
  const handle = await open(pmtilesPath, 'r');
  const archive = new PMTiles(new FileRangeSource(handle, pmtilesPath));
  const tiles = new Map();
  const tileAt = async ([lon, lat]) => {
    const n = 2 ** Z;
    const x = Math.floor(((lon + 180) / 360) * n);
    const r = (lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    const key = `${x}/${y}`;
    if (!tiles.has(key)) {
      const t = await archive.getZxy(Z, x, y);
      const layer = t ? new VectorTile(new Pbf(new Uint8Array(t.data))).layers.buildings : undefined;
      const features = [];
      for (let i = 0; layer && i < layer.length; i++) features.push(layer.feature(i).toGeoJSON(x, y, Z));
      tiles.set(key, features);
    }
    return tiles.get(key);
  };
  return {
    /**
     * The building containing the point, else the nearest one whose centre is within `maxM` metres (coordinates in
     * feeds are often on the street in front). Null when there is none.
     */
    async at(point, maxM = 25) {
      const features = await tileAt(point);
      const inside = features.find((f) => turfBooleanPointInPolygon(point, f));
      let best = inside ?? null;
      if (!best) {
        let bestD = Infinity;
        for (const f of features) {
          const d = turfDistance(point, turfCentroid(f), { units: 'meters' });
          if (d < bestD && d <= maxM) [best, bestD] = [f, d];
        }
      }
      if (!best) return null;
      return {
        osmId: best.properties.osmId,
        residential: best.properties.residential === true || best.properties.residential === 'true',
        height: Number(best.properties.height) || 6,
        geometry: best.geometry,
        inside: !!inside,
      };
    },
    close: () => handle.close(),
  };
}
