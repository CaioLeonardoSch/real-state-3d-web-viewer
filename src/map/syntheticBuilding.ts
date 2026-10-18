import type { Polygon } from 'geojson';
import type { ListingType } from '../data/types';
import { lotRectangle } from '../utils/placement';

/**
 * Standard building of a listing whose building is not in OpenStreetMap (located by the address or by a pasted
 * point, item 51): a north-aligned box sized from the type, the area and the floors, drawn on our map only. Its id
 * comes from the point, so a second listing at the same address (another unit) finds the same building.
 */
export const SYNTHETIC_PREFIX = 'sintetico/';

export const isSynthetic = (osmId: string | undefined) => !!osmId?.startsWith(SYNTHETIC_PREFIX);

export const syntheticId = ([lng, lat]: [number, number]) => `${SYNTHETIC_PREFIX}${lng.toFixed(5)},${lat.toFixed(5)}`;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface SyntheticBuilding {
  osmId: string;
  geometry: Polygon;
  height: number;
}

/**
 * The box for a listing: `areaM2` is the listing's area, `builtM2` the lot's built area from the cadastre (0 when
 * unknown), `floors` the building's floors from the form.
 */
export function syntheticBuilding(center: [number, number], type: ListingType, areaM2: number | null, floors: number | null, builtM2 = 0): SyntheticBuilding {
  const area = areaM2 && areaM2 > 0 ? areaM2 : 0;
  let front: number;
  let depth: number;
  let height: number;
  if (type === 'warehouse') {
    const f = clamp(Math.sqrt((builtM2 || area || 600) / 1.5), 12, 60);
    [front, depth, height] = [f, f * 1.5, 8];
  } else if (type === 'store' || type === 'office' || type === 'apartment' || type === 'penthouse' || type === 'studio') {
    // a building of flats or rooms: about 4 units per floor, 4 floors unless the form says how many
    const n = floors ?? (type === 'store' ? 1 : 4);
    const plate = builtM2 && n ? builtM2 / n : Math.max(area * 4, 120);
    const f = clamp(Math.sqrt(plate / 1.3), 8, 40);
    [front, depth, height] = [f, f * 1.3, n * 3];
  } else {
    // houses: one floor up to 150 m², two above
    const total = builtM2 || area || 90;
    const storeys = total > 150 ? 2 : 1;
    const f = clamp(Math.sqrt(total / storeys / 1.25), 5, 22);
    [front, depth, height] = [f, f * 1.25, storeys * 3 + 1];
  }
  const r = (v: number) => Math.round(v * 10) / 10;
  return { osmId: syntheticId(center), geometry: lotRectangle(center, r(front), r(depth)), height };
}
