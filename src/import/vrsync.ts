// Reads a VRSync feed: the XML real-estate CRMs send to ZAP, VivaReal and OLX (Grupo OLX), so a new client does not
// re-type its listings. Pure (no I/O): scripts/import-xml.mjs places each listing on the map, downloads the photos
// and saves. Runs in Node directly (type imports and explicit .ts paths only).
import { XMLParser } from 'fast-xml-parser';
import { hasBedrooms, inBuilding, type AddressDisplay, type Amenity, type Highlight, type ListingType, type Transaction } from '../data/types.ts';

export interface ImportedListing {
  /** ListingID of the feed: kept as the reference code, so a new import updates instead of duplicating. */
  referenceCode: string;
  title: string;
  description: string;
  type: ListingType;
  usage: 'residential' | 'commercial';
  transaction: Transaction;
  price: number;
  rentPrice: number | null;
  condoFee: number | null;
  iptu: { value: number; period: 'month' | 'year' } | null;
  areaM2: number;
  totalAreaM2: number | null;
  landAreaM2: number | null;
  bedrooms: number;
  suites: number | null;
  bathrooms: number;
  parkingSpots: number;
  unitFloor: number | null;
  floors: number | null;
  yearBuilt: number | null;
  features: Amenity[];
  highlight: Highlight;
  addressDisplay: AddressDisplay;
  address: { cep?: string; street?: string; number?: string; complement?: string; bairro?: string; city?: string };
  /** [lon, lat] when the feed has coordinates. */
  point: [number, number] | null;
  photos: { url: string; caption: string | null }[];
  floorPlans: string[];
  videoUrl: string | null;
  contact: { name?: string; email?: string; phone?: string };
}

export interface FeedResult {
  provider: { name?: string; email?: string; phone?: string };
  listings: ImportedListing[];
  /** Listings left out, with the reason (shown in the import report). */
  skipped: { referenceCode: string; title: string; reason: string }[];
  /** Imported, but something needs a look. */
  warnings: { referenceCode: string; message: string }[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  isArray: (name) => ['Listing', 'Item', 'Feature'].includes(name),
});

type Node = Record<string, unknown> | string | undefined;
const text = (n: Node): string => (n === undefined || n === null ? '' : typeof n === 'object' ? String((n as Record<string, unknown>)['#text'] ?? '') : String(n)).trim();
const attr = (n: Node, a: string): string => (n && typeof n === 'object' ? String((n as Record<string, unknown>)[`@${a}`] ?? '') : '');
const num = (n: Node): number | null => {
  const t = text(n).replace(/\s/g, '');
  if (!t) return null;
  // "1.234.567,89" or "1234567.89"
  const v = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
};
const int = (n: Node) => {
  const v = num(n);
  return v === null ? null : Math.round(v);
};
const stripHtml = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** PropertyType ("Residential / Apartment") → our type; null = not supported. */
export function mapPropertyType(t: string): { type: ListingType; usage: 'residential' | 'commercial' } | null {
  const [group, kind] = t.split('/').map((s) => s.trim().toLowerCase());
  const usage = group === 'commercial' ? 'commercial' : 'residential';
  const k = kind ?? '';
  if (/land|lot|terreno/.test(k)) return { type: 'land', usage };
  if (/farm|ranch|ch[aá]cara|s[ií]tio|fazenda/.test(k)) return { type: 'farm', usage };
  if (group === 'commercial') {
    if (/office|sala|business|consult/.test(k)) return { type: 'office', usage };
    if (/store|loja|retail|shop|ponto/.test(k)) return { type: 'store', usage };
    if (/warehouse|galp[aã]o|industrial|dep[oó]sito|shed/.test(k)) return { type: 'warehouse', usage };
    if (/building|pr[eé]dio/.test(k)) return { type: 'office', usage };
    if (/home|house|casa/.test(k)) return { type: 'house', usage };
    return null;
  }
  if (group !== 'residential') return null;
  if (/penthouse|cobertura/.test(k)) return { type: 'penthouse', usage };
  if (/kitnet|studio|flat|loft/.test(k)) return { type: 'studio', usage };
  if (/apartment|duplex|triplex/.test(k)) return { type: 'apartment', usage };
  if (/sobrado|townhouse|village/.test(k)) return { type: 'semi_detached', usage };
  if (/home|house|condo|casa/.test(k)) return { type: 'house', usage };
  return null;
}

const FEATURES: [RegExp, Amenity][] = [
  [/pool|piscina/i, 'pool'],
  [/bbq|barbecue|churrasq/i, 'barbecue'],
  [/balcony|varanda|sacada|terrace/i, 'balcony'],
  [/elevator|elevador/i, 'elevator'],
  [/gym|fitness|academia/i, 'gym'],
  [/pet/i, 'pets'],
  [/furnished|mobiliad/i, 'furnished'],
];

const HIGHLIGHTS: Record<string, Highlight> = { PREMIUM: 'featured', SUPER_PREMIUM: 'super', PREMIERE_1: 'super', PREMIERE_2: 'featured', TRIPLE: 'super' };

export function parseVrsync(xml: string): FeedResult {
  const doc = parser.parse(xml) as Record<string, Record<string, unknown>>;
  const root = doc.ListingDataFeed;
  if (!root) throw new Error('não é um feed VRSync (falta <ListingDataFeed>)');
  const header = (root.Header ?? {}) as Record<string, Node>;
  const out: FeedResult = {
    provider: { name: text(header.ContactName) || text(header.Provider) || undefined, email: text(header.Email) || undefined, phone: text(header.Telephone) || undefined },
    listings: [],
    skipped: [],
    warnings: [],
  };
  const items = ((root.Listings as Record<string, unknown> | undefined)?.Listing ?? []) as Record<string, Node>[];
  for (const it of items) {
    const ref = text(it.ListingID);
    const title = text(it.Title);
    const d = (it.Details ?? {}) as Record<string, Node>;
    const loc = (it.Location ?? {}) as Record<string, Node>;
    const skip = (reason: string) => out.skipped.push({ referenceCode: ref, title, reason });
    const warn = (message: string) => out.warnings.push({ referenceCode: ref, message });
    if (!ref) {
      skip('sem ListingID');
      continue;
    }
    const kind = mapPropertyType(text(d.PropertyType));
    if (!kind) {
      skip(`tipo não suportado: ${text(d.PropertyType) || 'vazio'}`);
      continue;
    }
    const tt = text(it.TransactionType).toLowerCase();
    const transaction: Transaction = tt.includes('sale') && tt.includes('rent') ? 'both' : tt.includes('rent') ? 'rent' : 'sale';
    const listPrice = int(d.ListPrice);
    const rentPrice = int(d.RentalPrice);
    if (transaction !== 'rent' && !listPrice) {
      skip('sem preço de venda');
      continue;
    }
    if (transaction !== 'sale' && !rentPrice) {
      skip('sem valor de aluguel');
      continue;
    }
    const living = num(d.LivingArea) ?? num(d.UsableArea);
    const lot = num(d.LotArea);
    const areaM2 = kind.type === 'land' ? (lot ?? living) : (living ?? num(d.TotalArea) ?? lot);
    if (!areaM2 || areaM2 <= 0) {
      skip('sem área');
      continue;
    }
    const lat = num(loc.Latitude);
    const lon = num(loc.Longitude);
    const point: [number, number] | null = lat !== null && lon !== null && Math.abs(lat) > 0.1 && Math.abs(lon) > 0.1 ? [lon, lat] : null;
    const display = attr(it.Location as Node, 'displayAddress').toLowerCase();
    const media = ((it.Media as Record<string, unknown> | undefined)?.Item ?? []) as Node[];
    const images = media.filter((m) => /image/i.test(attr(m, 'medium') || 'image') && /^https?:\/\//.test(text(m)));
    const plans = images.filter((m) => /planta|floor\s*plan/i.test(attr(m, 'caption')));
    const photos = images
      .filter((m) => !plans.includes(m))
      .sort((a, b) => Number(attr(b, 'primary') === 'true') - Number(attr(a, 'primary') === 'true'))
      .map((m) => ({ url: text(m), caption: attr(m, 'caption') || null }));
    if (!photos.length) warn('sem fotos');
    const video = media.find((m) => /video/i.test(attr(m, 'medium')));
    const features = [
      ...new Set(
        ((d.Features as Record<string, unknown> | undefined)?.Feature as Node[] | undefined ?? [])
          .map((f) => text(f))
          .flatMap((f) => FEATURES.filter(([re]) => re.test(f)).map(([, a]) => a)),
      ),
    ];
    const contact = (it.ContactInfo ?? {}) as Record<string, Node>;
    const bedrooms = hasBedrooms(kind.type) ? (int(d.Bedrooms) ?? 0) : 0;
    const parking = kind.type === 'land' ? 0 : (int(d.Garage) ?? 0);
    const tax = int(d.YearlyTax) ?? int(d.Iptu);
    const cep = text(loc.PostalCode).replace(/\D/g, '');
    const description = stripHtml(text(d.Description));
    out.listings.push({
      referenceCode: ref,
      title: title || `${kind.type === 'land' ? 'Terreno' : 'Imóvel'} ${ref}`,
      description,
      type: kind.type,
      usage: kind.usage,
      transaction,
      price: transaction === 'rent' ? rentPrice! : listPrice!,
      rentPrice: transaction === 'sale' ? null : rentPrice,
      condoFee: int(d.PropertyAdministrationFee),
      iptu: tax ? { value: tax, period: 'year' } : int(d.MonthlyTax) ? { value: int(d.MonthlyTax)!, period: 'month' } : null,
      areaM2: Math.round(areaM2),
      totalAreaM2: kind.type !== 'land' && num(d.TotalArea) && num(d.TotalArea)! >= areaM2 ? Math.round(num(d.TotalArea)!) : null,
      landAreaM2: kind.type === 'land' ? Math.round(areaM2) : lot ? Math.round(lot) : null,
      bedrooms,
      suites: !hasBedrooms(kind.type) ? null : (() => {
        const s = int(d.Suites);
        return s === null ? null : Math.min(s, bedrooms);
      })(),
      bathrooms: kind.type === 'land' ? 0 : (int(d.Bathrooms) ?? 0),
      parkingSpots: parking,
      unitFloor: inBuilding(kind.type) ? int(d.UnitFloor) : null,
      floors: inBuilding(kind.type) ? int(d.Floors) : null,
      yearBuilt: (() => {
        const y = int(d.YearBuilt);
        return y && y > 1800 && y < 2100 ? y : null;
      })(),
      features,
      highlight: HIGHLIGHTS[text(it.PublicationType).toUpperCase()] ?? 'standard',
      addressDisplay: display === 'all' ? 'full' : display === 'street' ? 'street' : 'neighborhood',
      address: Object.fromEntries(
        Object.entries({
          cep: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : undefined,
          street: text(loc.Address) || undefined,
          number: text(loc.StreetNumber) || undefined,
          complement: text(loc.Complement) || undefined,
          bairro: text(loc.Neighborhood) || undefined,
          city: text(loc.City) || undefined,
        }).filter(([, v]) => v),
      ),
      point,
      photos,
      floorPlans: plans.map((m) => text(m)),
      videoUrl: video && /^https:\/\//.test(text(video)) ? text(video) : null,
      contact: Object.fromEntries(
        Object.entries({ name: text(contact.Name) || undefined, email: text(contact.Email).toLowerCase() || undefined, phone: text(contact.Telephone) || undefined }).filter(
          ([, v]) => v,
        ),
      ),
    });
  }
  return out;
}
