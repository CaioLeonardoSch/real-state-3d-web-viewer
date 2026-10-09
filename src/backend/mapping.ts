// Conversion between database rows (supabase/migrations) and the app's Listing. Pure functions, unit-tested.
import type { MultiPolygon, Point, Polygon, Position } from 'geojson';
import type { Listing, Photo } from '../data/types';

/** Row of public.public_listings or public.my_listings (geometries already as GeoJSON). */
export interface ListingRow {
  id: string;
  org_id: string;
  type: Listing['type'];
  title: string;
  description: string;
  transaction: NonNullable<Listing['transaction']>;
  price: number;
  rent_price: number | null;
  previous_price: number | null;
  price_reduced_at: string | null;
  condo_fee: number | null;
  iptu_value: number | null;
  iptu_period: 'month' | 'year' | null;
  area_m2: number | string;
  total_area_m2: number | string | null;
  land_area_m2: number | string | null;
  bedrooms: number;
  suites: number | null;
  bathrooms: number;
  parking_spots: number;
  covered_parking: number | null;
  unit_floor: number | null;
  floors: number | null;
  towers: number | null;
  year_built: number | null;
  usage: NonNullable<Listing['usage']>;
  status: Listing['status'];
  features: Listing['features'];
  address_display: NonNullable<Listing['addressDisplay']>;
  building_osm_id: string | null;
  building_height_m: number | string | null;
  approx_radius_m: number | null;
  address: Listing['address'] | null;
  video_url: string | null;
  tour_url: string | null;
  advertiser: Listing['advertiser'] | null;
  reference_code: string | null;
  exclusive: boolean;
  availability: NonNullable<Listing['availability']>;
  highlight: NonNullable<Listing['highlight']>;
  published_at: string;
  updated_at: string;
  // public_listings
  approximate_location?: boolean;
  location?: Point | null;
  footprint?: Polygon | MultiPolygon | null;
  lot?: Polygon | null;
  // my_listings
  published?: boolean;
  location_geojson?: Point | null;
  footprint_geojson?: Polygon | MultiPolygon | null;
  lot_geojson?: Polygon | null;
  approx_center_geojson?: Point | null;
}

export interface PhotoRow {
  listing_id: string;
  path: string;
  caption: string | null;
  position: number;
  is_floor_plan: boolean;
}

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? undefined : Number(v));
const opt = <K extends string, V>(key: K, v: V | null | undefined) =>
  (v === null || v === undefined ? {} : { [key]: v }) as Partial<Record<K, V>>;
const day = (ts: string) => ts.slice(0, 10);
const round6 = (p: Position) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))] as [number, number];

/**
 * A row as the app's Listing. `mine`: the row comes from my_listings (exact location known, editable).
 * `photoUrl` turns a storage path into a public URL.
 */
export function rowToListing(r: ListingRow, photos: PhotoRow[], photoUrl: (path: string) => string, mine: boolean): Listing {
  const approximate = r.address_display !== 'full';
  const location = (mine ? r.location_geojson : r.location) ?? null;
  const footprint = mine ? r.footprint_geojson : r.footprint;
  const lot = mine ? r.lot_geojson : r.lot;
  const center = mine ? r.approx_center_geojson : approximate ? location : null;
  const own = photos.filter((p) => p.listing_id === r.id).sort((a, b) => a.position - b.position);
  const gallery: Photo[] = own.filter((p) => !p.is_floor_plan).map((p) => ({ src: photoUrl(p.path), ...opt('caption', p.caption) }));
  const plan = own.find((p) => p.is_floor_plan);
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    agency: r.org_id,
    price: r.price,
    ...opt('previousPrice', r.previous_price),
    ...opt('priceReducedAt', r.price_reduced_at),
    areaM2: Number(r.area_m2),
    ...opt('landAreaM2', num(r.land_area_m2)),
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    parkingSpots: r.parking_spots,
    status: r.status,
    features: r.features ?? [],
    ...opt('buildingOsmId', r.building_osm_id),
    ...opt('footprint', footprint),
    ...opt('buildingHeightM', num(r.building_height_m)),
    ...opt('lotPolygon', lot),
    ...opt('floors', r.floors),
    approximateLocation: approximate,
    ...(approximate && center ? { approxCenter: round6(center.coordinates), approxRadiusM: r.approx_radius_m ?? 150 } : {}),
    description: r.description,
    transaction: r.transaction,
    ...opt('rentPrice', r.rent_price),
    ...opt('condoFee', r.condo_fee),
    ...(r.iptu_value !== null && r.iptu_period ? { iptu: { value: r.iptu_value, period: r.iptu_period } } : {}),
    ...(r.address && Object.keys(r.address).length ? { address: r.address } : {}),
    addressDisplay: r.address_display,
    ...opt('unitFloor', r.unit_floor),
    ...opt('towers', r.towers),
    ...opt('suites', r.suites),
    ...opt('coveredParking', r.covered_parking),
    ...opt('totalAreaM2', num(r.total_area_m2)),
    ...opt('yearBuilt', r.year_built),
    usage: r.usage,
    ...(gallery.length ? { photos: gallery } : {}),
    ...(plan ? { floorPlanImage: photoUrl(plan.path) } : {}),
    ...opt('videoUrl', r.video_url),
    ...opt('tourUrl', r.tour_url),
    ...(r.advertiser && Object.keys(r.advertiser).length ? { advertiser: r.advertiser } : {}),
    ...opt('referenceCode', r.reference_code),
    ...(r.exclusive ? { exclusive: true } : {}),
    availability: r.availability,
    highlight: r.highlight,
    publishedAt: day(r.published_at),
    updatedAt: day(r.updated_at),
    remote: true,
    ...(mine ? { userAdded: true as const } : {}),
    ...(mine && r.published === false ? { draft: true as const } : {}),
  };
}

// ---------------------------------------------------------------- writing

const coords = (ring: Position[]) => ring.map((p) => `${p[0]} ${p[1]}`).join(',');
/** GeoJSON → EWKT, the text form PostGIS accepts on insert. */
export function toEwkt(g: Point | Polygon | MultiPolygon): string {
  if (g.type === 'Point') return `SRID=4326;POINT(${g.coordinates[0]} ${g.coordinates[1]})`;
  const poly = (rings: Position[][]) => `(${rings.map((r) => `(${coords(r)})`).join(',')})`;
  // footprints are stored as MULTIPOLYGON
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return `SRID=4326;MULTIPOLYGON(${polys.map(poly).join(',')})`;
}

const polygonEwkt = (p: Polygon) => `SRID=4326;POLYGON(${p.coordinates.map((r) => `(${coords(r)})`).join(',')})`;

/** Columns of public.listings for a new listing (the server fills ids, dates, previous price and approximate centre). */
export function listingToRow(l: Listing, orgId: string, location: [number, number]): Record<string, unknown> {
  return {
    org_id: orgId,
    type: l.type,
    title: l.title,
    description: l.description,
    transaction: l.transaction ?? 'sale',
    price: l.price,
    rent_price: l.rentPrice ?? null,
    condo_fee: l.condoFee ?? null,
    iptu_value: l.iptu?.value ?? null,
    iptu_period: l.iptu?.period ?? null,
    area_m2: l.areaM2,
    total_area_m2: l.totalAreaM2 ?? null,
    land_area_m2: l.landAreaM2 ?? null,
    bedrooms: l.bedrooms,
    suites: l.suites ?? null,
    bathrooms: l.bathrooms,
    parking_spots: l.parkingSpots,
    covered_parking: l.coveredParking ?? null,
    unit_floor: l.unitFloor ?? null,
    floors: l.floors ?? null,
    towers: l.towers ?? null,
    year_built: l.yearBuilt ?? null,
    usage: l.usage ?? 'residential',
    status: l.status,
    features: l.features,
    location: toEwkt({ type: 'Point', coordinates: location }),
    building_osm_id: l.buildingOsmId ?? null,
    footprint: l.footprint ? toEwkt(l.footprint) : null,
    lot: l.lotPolygon ? polygonEwkt(l.lotPolygon) : null,
    building_height_m: l.buildingHeightM ?? null,
    address: l.address ?? {},
    address_display: l.addressDisplay ?? 'street',
    video_url: l.videoUrl ?? null,
    tour_url: l.tourUrl ?? null,
    advertiser: l.advertiser ?? {},
    reference_code: l.referenceCode ?? null,
    exclusive: l.exclusive ?? false,
    availability: l.availability ?? 'active',
    highlight: l.highlight ?? 'standard',
  };
}

/** "data:image/jpeg;base64,…" → Blob, for uploading photos prepared in the browser. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',', 2);
  const type = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
