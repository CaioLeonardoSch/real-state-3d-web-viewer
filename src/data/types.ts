import type { MultiPolygon, Polygon } from 'geojson';

export const LISTING_TYPES = ['apartment', 'house', 'semi_detached', 'land'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export const LISTING_STATUSES = ['ready', 'under_construction'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** Amenities ("comodidades") a listing may offer; filterable. */
export const AMENITIES = [
  'pool',
  'barbecue',
  'balcony',
  'elevator',
  'gym',
  'pets',
  'furnished',
  'financing',
  'exchange',
] as const;
export type Amenity = (typeof AMENITIES)[number];

export const AMENITY_LABELS: Record<Amenity, string> = {
  pool: 'Piscina',
  barbecue: 'Churrasqueira',
  balcony: 'Sacada',
  elevator: 'Elevador',
  gym: 'Academia',
  pets: 'Aceita pets',
  furnished: 'Mobiliado',
  financing: 'Aceita financiamento',
  exchange: 'Aceita permuta',
};

export interface Agency {
  id: string;
  name: string;
  fictional: true;
}

export interface Listing {
  id: string;
  type: ListingType;
  title: string;
  /** Agency id (see `ListingsFile.agencies`). */
  agency: string;
  /** Price in BRL, integer. Illustrative only. */
  price: number;
  /** Price before the last reduction (BRL). Shown struck through only when higher than `price`. */
  previousPrice?: number;
  /** When the price was reduced (YYYY-MM-DD). */
  priceReducedAt?: string;
  /** Built area (buildings) or lot area (land), m². */
  areaM2: number;
  landAreaM2?: number;
  bedrooms: number;
  bathrooms: number;
  parkingSpots: number;
  status: ListingStatus;
  /** Amenities, without duplicates. */
  features: Amenity[];
  /** OSM id of a real building, e.g. "way/123". Absent for land. */
  buildingOsmId?: string;
  /** Outline of that building (the map tiles only carry the context buildings). */
  footprint?: Polygon | MultiPolygon;
  /** Height of that building on the map, metres (OSM tag, levels × 3 m, or 6 m). */
  buildingHeightM?: number;
  /** Generated lot polygon (land only). */
  lotPolygon?: Polygon;
  /** Fictional number of floors (apartments only); overrides the building height on the map. */
  floors?: number;
  approximateLocation: boolean;
  /** Displayed center [lon, lat] when approximateLocation is true (deterministically offset). */
  approxCenter?: [number, number];
  /** Radius of the uncertainty circle (m) when approximateLocation is true. */
  approxRadiusM?: number;
  fictional: true;
  description: string;
  /** Added in this browser through "Anunciar imóvel" (kept in localStorage, never in listings.json). */
  userAdded?: true;
}

export interface ListingsFile {
  fictional: true;
  notice: string;
  seed: number;
  agencies: Agency[];
  listings: Listing[];
}

export const TYPE_LABELS: Record<ListingType, string> = {
  apartment: 'Apartamento',
  house: 'Casa',
  semi_detached: 'Geminado',
  land: 'Terreno',
};

export const STATUS_LABELS: Record<ListingStatus, string> = {
  ready: 'Pronto',
  under_construction: 'Em construção',
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isLonLat = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

/** Load-time validation of listings.json. Returns the typed file or throws with every problem found. */
export function validateListingsFile(raw: unknown): ListingsFile {
  const errors: string[] = [];
  if (!isObj(raw)) throw new Error('listings.json: root is not an object');
  if (raw.fictional !== true) errors.push('root.fictional must be true');
  if (!Array.isArray(raw.agencies)) errors.push('agencies must be an array');
  if (!Array.isArray(raw.listings)) errors.push('listings must be an array');
  if (errors.length) throw new Error('listings.json invalid:\n' + errors.join('\n'));

  const agencies = raw.agencies as unknown[];
  const agencyIds = new Set<string>();
  agencies.forEach((a, i) => {
    if (!isObj(a) || !isStr(a.id) || !isStr(a.name) || a.fictional !== true) {
      errors.push(`agencies[${i}] invalid`);
    } else agencyIds.add(a.id);
  });

  const ids = new Set<string>();
  (raw.listings as unknown[]).forEach((l, i) => {
    const at = `listings[${i}]`;
    if (!isObj(l)) return void errors.push(`${at} not an object`);
    if (!isStr(l.id)) errors.push(`${at}.id missing`);
    else if (ids.has(l.id)) errors.push(`${at}.id duplicated: ${l.id}`);
    else ids.add(l.id);
    if (!LISTING_TYPES.includes(l.type as ListingType)) errors.push(`${at}.type invalid`);
    if (!isStr(l.title)) errors.push(`${at}.title missing`);
    if (!isStr(l.agency) || !agencyIds.has(l.agency)) errors.push(`${at}.agency unknown`);
    if (!isInt(l.price) || l.price <= 0) errors.push(`${at}.price must be a positive integer`);
    if (l.previousPrice !== undefined && (!isInt(l.previousPrice) || l.previousPrice <= (l.price as number)))
      errors.push(`${at}.previousPrice must be an integer above price`);
    if (l.priceReducedAt !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(l.priceReducedAt)))
      errors.push(`${at}.priceReducedAt must be YYYY-MM-DD`);
    if (!isNum(l.areaM2) || l.areaM2 <= 0) errors.push(`${at}.areaM2 invalid`);
    if (l.landAreaM2 !== undefined && !isNum(l.landAreaM2)) errors.push(`${at}.landAreaM2 invalid`);
    for (const k of ['bedrooms', 'bathrooms', 'parkingSpots'] as const) {
      if (!isInt(l[k]) || (l[k] as number) < 0) errors.push(`${at}.${k} invalid`);
    }
    if (!LISTING_STATUSES.includes(l.status as ListingStatus)) errors.push(`${at}.status invalid`);
    if (
      !Array.isArray(l.features) ||
      l.features.some((f) => !AMENITIES.includes(f as Amenity)) ||
      new Set(l.features).size !== l.features.length
    )
      errors.push(`${at}.features invalid`);
    if (typeof l.approximateLocation !== 'boolean') errors.push(`${at}.approximateLocation invalid`);
    if (l.fictional !== true) errors.push(`${at}.fictional must be true`);
    if (!isStr(l.description)) errors.push(`${at}.description missing`);
    if (l.type === 'land') {
      if (l.bedrooms !== 0) errors.push(`${at}: land must have 0 bedrooms`);
      if (!isObj(l.lotPolygon) || l.lotPolygon.type !== 'Polygon') errors.push(`${at}.lotPolygon missing`);
    } else {
      if (!isStr(l.buildingOsmId)) errors.push(`${at}.buildingOsmId missing`);
      const fp = l.footprint;
      if (!isObj(fp) || (fp.type !== 'Polygon' && fp.type !== 'MultiPolygon')) errors.push(`${at}.footprint missing`);
      if (l.buildingHeightM !== undefined && !isNum(l.buildingHeightM)) errors.push(`${at}.buildingHeightM invalid`);
    }
    if (l.approximateLocation === true) {
      if (!isLonLat(l.approxCenter)) errors.push(`${at}.approxCenter missing`);
      if (!isNum(l.approxRadiusM)) errors.push(`${at}.approxRadiusM missing`);
    }
  });

  if (errors.length) throw new Error('listings.json invalid:\n' + errors.join('\n'));
  return raw as unknown as ListingsFile;
}

/** Price reduction of a listing, or null when it has none. */
export function priceReduction(l: Listing): { previous: number; percent: number; since?: string } | null {
  if (!l.previousPrice || l.previousPrice <= l.price) return null;
  return {
    previous: l.previousPrice,
    percent: Math.round((100 * (l.previousPrice - l.price)) / l.previousPrice),
    since: l.priceReducedAt,
  };
}
