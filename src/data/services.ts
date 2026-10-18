// Services near a listing (schools, health, pharmacies, markets, bakeries, parks), from OpenStreetMap
// (public/data/servicos.json, built by scripts/build-services.mjs). Distances are in a straight line: walking time
// would need routes. OSM misses some small shops, so "none nearby" is always said as "none mapped".
import turfCentroid from '@turf/centroid';
import type { Listing } from './types';

export const SERVICE_KINDS = ['school', 'health', 'pharmacy', 'market', 'bakery', 'park'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];
export const SERVICE_LABELS: Record<ServiceKind, string> = {
  school: 'Escola',
  health: 'Saúde',
  pharmacy: 'Farmácia',
  market: 'Mercado',
  bakery: 'Padaria',
  park: 'Parque',
};
/** Map colour of each kind (the "Serviços" layer and the dots in the listing panel). */
export const SERVICE_COLORS: Record<ServiceKind, string> = {
  school: '#2563eb',
  health: '#dc2626',
  pharmacy: '#16a34a',
  market: '#d97706',
  bakery: '#a16207',
  park: '#15803d',
};
/** Radius of the "até 500 m de…" filter. */
export const NEAR_M = 500;
/** How far the listing panel looks for the closest of each kind. */
export const NEARBY_MAX_M = 2000;

/** servicos.json: [kind index in `kinds`, lon, lat, name?]. */
export interface ServicesFile {
  kinds: ServiceKind[];
  items: [number, number, number, string?][];
}

export interface Service {
  kind: ServiceKind;
  lon: number;
  lat: number;
  name?: string;
}

export interface NearbyService extends Service {
  distanceM: number;
}

const CELL = 0.01; // ≈ 1 km
const M_PER_DEG_LAT = 110_540;

/** Straight-line distance in metres (equirectangular: exact enough within a city). */
export function distanceM(a: [number, number], b: [number, number]): number {
  const kx = 111_320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * M_PER_DEG_LAT);
}

/** Services in a grid of ≈ 1 km cells, for "closest of each kind" queries. */
export class ServiceIndex {
  readonly services: Service[];
  private cells = new Map<string, Service[]>();

  constructor(file: ServicesFile) {
    this.services = file.items.flatMap(([k, lon, lat, name]) => {
      const kind = file.kinds[k];
      return kind && (SERVICE_KINDS as readonly string[]).includes(kind) ? [{ kind, lon, lat, ...(name ? { name } : {}) }] : [];
    });
    for (const s of this.services) {
      const key = `${Math.floor(s.lon / CELL)}:${Math.floor(s.lat / CELL)}`;
      const list = this.cells.get(key);
      if (list) list.push(s);
      else this.cells.set(key, [s]);
    }
  }

  /** Closest service of each kind within `maxM` of `p` (kinds with none mapped are left out). */
  nearest(p: [number, number], maxM = NEARBY_MAX_M): Partial<Record<ServiceKind, NearbyService>> {
    const out: Partial<Record<ServiceKind, NearbyService>> = {};
    const r = Math.ceil(maxM / (CELL * M_PER_DEG_LAT * Math.cos((p[1] * Math.PI) / 180)));
    const cx = Math.floor(p[0] / CELL);
    const cy = Math.floor(p[1] / CELL);
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++)
        for (const s of this.cells.get(`${x}:${y}`) ?? []) {
          const d = distanceM(p, [s.lon, s.lat]);
          if (d <= maxM && d < (out[s.kind]?.distanceM ?? Infinity)) out[s.kind] = { ...s, distanceM: d };
        }
    return out;
  }
}

/** Point a listing is measured from: the centre of its circle (hidden address), building or lot. */
export function listingPoint(l: Listing): [number, number] | null {
  if (l.approximateLocation) return l.approxCenter ?? null;
  const shape = l.footprint ?? l.lotPolygon;
  return shape ? (turfCentroid(shape).geometry.coordinates as [number, number]) : null;
}

/** Distance (m) to the closest service of each kind, rounded; what the "até 500 m de…" filter reads. */
export function nearbyDistances(index: ServiceIndex, l: Listing): Partial<Record<ServiceKind, number>> {
  const p = listingPoint(l);
  if (!p) return {};
  return Object.fromEntries(Object.entries(index.nearest(p, NEAR_M)).map(([k, s]) => [k, Math.round(s.distanceM)]));
}

/** "350 m", "1,2 km" (straight line). */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(Math.round(m / 100) / 10).toLocaleString('pt-BR')} km`;
}
