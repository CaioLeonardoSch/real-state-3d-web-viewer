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

/** Kind of deal. For rent-only listings `price` holds the monthly rent (same as `rentPrice`). */
export const TRANSACTIONS = ['sale', 'rent', 'both'] as const;
export type Transaction = (typeof TRANSACTIONS)[number];
export const TRANSACTION_LABELS: Record<Transaction, string> = {
  sale: 'Venda',
  rent: 'Locação',
  both: 'Venda e locação',
};

export const RENT_GUARANTEES = ['deposit', 'guarantor', 'insurance', 'capitalization'] as const;
export type RentGuarantee = (typeof RENT_GUARANTEES)[number];
export const RENT_GUARANTEE_LABELS: Record<RentGuarantee, string> = {
  deposit: 'Caução',
  guarantor: 'Fiador',
  insurance: 'Seguro fiança',
  capitalization: 'Título de capitalização',
};

/** What the public sees of the address. Anything but `full` also hides the exact building on the map. */
export const ADDRESS_DISPLAYS = ['full', 'street', 'neighborhood'] as const;
export type AddressDisplay = (typeof ADDRESS_DISPLAYS)[number];
export const ADDRESS_DISPLAY_LABELS: Record<AddressDisplay, string> = {
  full: 'Endereço completo',
  street: 'Só a rua',
  neighborhood: 'Só o bairro',
};

export const USAGES = ['residential', 'commercial'] as const;
export type Usage = (typeof USAGES)[number];
export const USAGE_LABELS: Record<Usage, string> = { residential: 'Residencial', commercial: 'Comercial' };

/** State of the advertisement (not of the construction, see `ListingStatus`). */
export const AVAILABILITIES = ['active', 'reserved', 'sold'] as const;
export type Availability = (typeof AVAILABILITIES)[number];
export const AVAILABILITY_LABELS: Record<Availability, string> = { active: 'Ativo', reserved: 'Reservado', sold: 'Vendido' };

export const HIGHLIGHTS = ['standard', 'featured', 'super'] as const;
export type Highlight = (typeof HIGHLIGHTS)[number];
export const HIGHLIGHT_LABELS: Record<Highlight, string> = { standard: 'Padrão', featured: 'Destaque', super: 'Super destaque' };

export interface Address {
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  bairro?: string;
  city?: string;
}

export interface Photo {
  /** Image URL or data: URL (photos uploaded in this browser). */
  src: string;
  caption?: string;
}

export interface Advertiser {
  creci?: string;
  contactName?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
}

export interface PricePoint {
  /** YYYY-MM-DD */
  date: string;
  price: number;
}

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

  // ---- deal (absent = sale)
  transaction?: Transaction;
  /** Monthly rent (BRL) when the listing is also, or only, for rent. */
  rentPrice?: number;
  /** Monthly condominium fee (BRL). */
  condoFee?: number;
  iptu?: { value: number; period: 'month' | 'year' };
  rentGuarantees?: RentGuarantee[];
  // ---- address
  address?: Address;
  addressDisplay?: AddressDisplay;
  // ---- unit and building
  /** Floor of the unit (apartments). */
  unitFloor?: number;
  towers?: number;
  suites?: number;
  /** How many of `parkingSpots` are covered. */
  coveredParking?: number;
  /** Total area (m²), e.g. private + common areas; `areaM2` is the usable area. */
  totalAreaM2?: number;
  /** Year of construction (or expected delivery while under construction). */
  yearBuilt?: number;
  usage?: Usage;
  // ---- media (the first photo is the cover)
  photos?: Photo[];
  floorPlanImage?: string;
  videoUrl?: string;
  tourUrl?: string;
  // ---- advertiser
  advertiser?: Advertiser;
  /** Advertiser's own code for the property. */
  referenceCode?: string;
  /** Exclusive sale authorisation (the document is checked by the back end). */
  exclusive?: boolean;
  exclusivityDoc?: string;
  // ---- control
  availability?: Availability;
  /** YYYY-MM-DD */
  publishedAt?: string;
  updatedAt?: string;
  highlight?: Highlight;
  /** Prices recorded by the platform, oldest first. A reduction is shown only from this history. */
  priceHistory?: PricePoint[];
}

/** Minimum number of photos for a listing published through the form. */
export const MIN_PHOTOS = 5;
export const transactionOf = (l: Listing): Transaction => l.transaction ?? 'sale';
export const isForSale = (l: Listing) => transactionOf(l) !== 'rent';
export const isForRent = (l: Listing) => transactionOf(l) !== 'sale';
/** Price in the given mode: sale price, or monthly rent. Null when the listing is not offered that way. */
export function priceIn(l: Listing, rent: boolean): number | null {
  if (rent) return isForRent(l) ? (l.rentPrice ?? l.price) : null;
  return isForSale(l) ? l.price : null;
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
    const optInt = (k: string, min = 0) => {
      const v = l[k];
      if (v !== undefined && (!isInt(v) || v < min)) errors.push(`${at}.${k} invalid`);
    };
    ['rentPrice', 'condoFee', 'unitFloor', 'suites', 'coveredParking'].forEach((k) => optInt(k));
    optInt('towers', 1);
    optInt('yearBuilt', 1800);
    if (l.transaction !== undefined && !TRANSACTIONS.includes(l.transaction as Transaction)) errors.push(`${at}.transaction invalid`);
    if (l.transaction === 'rent' || l.transaction === 'both') {
      if (!isInt(l.rentPrice) || l.rentPrice <= 0) errors.push(`${at}.rentPrice required for rent`);
    }
    if (l.totalAreaM2 !== undefined && (!isNum(l.totalAreaM2) || l.totalAreaM2 < (l.areaM2 as number)))
      errors.push(`${at}.totalAreaM2 must be at least areaM2`);
    if (l.suites !== undefined && (l.suites as number) > (l.bedrooms as number)) errors.push(`${at}.suites above bedrooms`);
    if (l.coveredParking !== undefined && (l.coveredParking as number) > (l.parkingSpots as number))
      errors.push(`${at}.coveredParking above parkingSpots`);
    const inList = <T extends string>(k: string, list: readonly T[]) => {
      if (l[k] !== undefined && !list.includes(l[k] as T)) errors.push(`${at}.${k} invalid`);
    };
    inList('addressDisplay', ADDRESS_DISPLAYS);
    inList('usage', USAGES);
    inList('availability', AVAILABILITIES);
    inList('highlight', HIGHLIGHTS);
    if (l.rentGuarantees !== undefined && (!Array.isArray(l.rentGuarantees) || l.rentGuarantees.some((g) => !RENT_GUARANTEES.includes(g))))
      errors.push(`${at}.rentGuarantees invalid`);
    if (l.iptu !== undefined && (!isObj(l.iptu) || !isInt(l.iptu.value) || (l.iptu.period !== 'month' && l.iptu.period !== 'year')))
      errors.push(`${at}.iptu invalid`);
    if (l.photos !== undefined && (!Array.isArray(l.photos) || l.photos.some((p) => !isObj(p) || !isStr(p.src))))
      errors.push(`${at}.photos invalid`);
    for (const k of ['publishedAt', 'updatedAt'])
      if (l[k] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(l[k]))) errors.push(`${at}.${k} must be YYYY-MM-DD`);
    if (
      l.priceHistory !== undefined &&
      (!Array.isArray(l.priceHistory) || l.priceHistory.some((p) => !isObj(p) || !isInt(p.price) || !/^\d{4}-\d{2}-\d{2}$/.test(String(p.date))))
    )
      errors.push(`${at}.priceHistory invalid`);
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
