// Static page of a listing, for search engines and link previews (WhatsApp, Facebook): built at publish time by
// scripts/prerender.mjs, one HTML file per listing, plus sitemap.xml. Self-contained (only type imports and
// types.ts), so Node runs it directly.
import type { Listing } from '../data/types.ts';
import { photoSrcset } from '../utils/images.ts';
import { AMENITY_LABELS, HIGHLIGHT_LABELS, STATUS_LABELS, TRANSACTION_LABELS, TYPE_LABELS, hasBedrooms, inBuilding, isCommercialType } from '../data/types.ts';
import { REGION } from '../config/region.ts';

export interface PageContext {
  /** Absolute URL of the site root, ending with "/". */
  siteUrl: string;
  agencyName: string;
  siteName: string;
  /** Content-Security-Policy for a <meta> tag (scripts/lib/csp.mjs, listingCsp), for hosts without headers. */
  csp?: string;
}

/**
 * The page's only stylesheet, inline; its hash goes into the page's Content-Security-Policy. Text colours keep 4.5:1
 * on the background and on the buttons (WCAG AA; e2e-site checks the page with axe).
 */
export const LISTING_PAGE_CSS = `
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1f2328;background:#f6f5f2}
header,main,footer{max-width:880px;margin:0 auto;padding:12px 16px}
header{display:flex;justify-content:space-between;align-items:center;gap:12px}
header a{color:#a85000;text-decoration:none;font-weight:600}
h1{font-size:26px;margin:8px 0 4px}
.price{font-size:28px;font-weight:700;color:#c8650a;margin:4px 0}.price s{font-size:18px;color:#646b73;font-weight:400}.price small{font-size:16px}
.addr{color:#555;margin:0 0 12px}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px}
.gallery img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;background:#ddd}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
.btn{display:inline-block;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600;color:#fff;background:#b35600}
.btn.wa{background:#177a42}
dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin:16px 0}
dt{font-size:12px;color:#666}dd{margin:0;font-weight:600}
ul.features{display:flex;flex-wrap:wrap;gap:6px;padding:0;list-style:none}ul.features li{padding:4px 10px;border-radius:999px;background:#fff1df;font-size:13px}
.demo{background:#fff1df;padding:8px 12px;border-radius:8px;font-size:14px}
footer{color:#666;font-size:12px}
`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const brl = (v: number) => `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
const area = (v: number) => `${Math.round(v).toLocaleString('pt-BR')} m²`;

/** "Casa com piscina 3 quartos" → "casa-com-piscina-3-quartos". */
export function slugify(text: string): string {
  return text
    .replace(/×/g, 'x')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** Path of the listing page under the site root, e.g. "imovel/casa-com-piscina-3-quartos-5c1e9a2b/". */
export function pagePath(l: Pick<Listing, 'id' | 'title'>): string {
  return `imovel/${slugify(l.title)}-${pageCode(l.id)}/`;
}

/** End of a static page's address, which finds the listing whatever its title (platformPages.ts). */
export function pageCode(id: string): string {
  return slugify(/^[0-9a-f-]{36}$/.test(id) ? id.slice(0, 8) : id);
}

/** Address as the advertiser allows it to be shown. */
export function shownAddress(l: Listing): { line: string | null; street?: string; locality?: string; region: string; postal?: string } {
  const a = l.address ?? {};
  // no choice recorded: only the neighbourhood, as in addressLabel and publicAddress
  const display = l.addressDisplay ?? 'neighborhood';
  const street = display === 'neighborhood' ? undefined : display === 'full' ? [a.street, a.number].filter(Boolean).join(', ') || undefined : a.street;
  const locality = a.city ?? undefined;
  const line = [street, a.bairro, locality].filter(Boolean).join(' · ') || null;
  return { line, street, locality, region: REGION.uf, ...(display === 'full' && a.cep ? { postal: a.cep } : {}) };
}

export function description(l: Listing, agency: string): string {
  const parts = [TYPE_LABELS[l.type], area(l.areaM2)];
  if (hasBedrooms(l.type)) parts.push(`${l.bedrooms} ${l.bedrooms === 1 ? 'quarto' : 'quartos'}`);
  if (l.parkingSpots) parts.push(`${l.parkingSpots} ${l.parkingSpots === 1 ? 'vaga' : 'vagas'}`);
  const where = l.address?.bairro ? ` no ${l.address.bairro}` : '';
  const price = l.transaction === 'rent' ? `${brl(l.rentPrice ?? l.price)}/mês` : brl(l.price);
  const text = `${parts.join(', ')}${where} por ${price}. ${agency}. ${l.description}`;
  return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}

/** schema.org data (RealEstateListing + Offer) that search engines read. */
export function structuredData(l: Listing, ctx: PageContext, url: string): object {
  const addr = shownAddress(l);
  const kind =
    l.type === 'land' || l.type === 'farm' || isCommercialType(l.type) ? 'Place' : inBuilding(l.type) ? 'Apartment' : 'SingleFamilyResidence';
  const rent = l.transaction === 'rent';
  const center = !l.approximateLocation && l.footprint ? centroid(l.footprint.type === 'Polygon' ? l.footprint.coordinates[0] : l.footprint.coordinates[0][0]) : null;
  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: l.title,
    url,
    ...(l.publishedAt ? { datePosted: l.publishedAt } : {}),
    ...(l.photos?.length ? { image: l.photos.slice(0, 6).map((p) => p.src) } : {}),
    description: l.description,
    offers: {
      '@type': 'Offer',
      price: rent ? (l.rentPrice ?? l.price) : l.price,
      priceCurrency: 'BRL',
      ...(rent ? { priceSpecification: { '@type': 'UnitPriceSpecification', price: l.rentPrice ?? l.price, priceCurrency: 'BRL', unitCode: 'MON' } } : {}),
      availability:
        l.availability === 'sold'
          ? 'https://schema.org/SoldOut'
          : l.availability === 'reserved'
            ? 'https://schema.org/LimitedAvailability'
            : 'https://schema.org/InStock',
      seller: { '@type': 'RealEstateAgent', name: ctx.agencyName },
    },
    about: {
      '@type': kind,
      ...(hasBedrooms(l.type) ? { numberOfRooms: l.bedrooms, numberOfBathroomsTotal: l.bathrooms } : {}),
      floorSize: { '@type': 'QuantitativeValue', value: l.areaM2, unitCode: 'MTK' },
      address: {
        '@type': 'PostalAddress',
        addressCountry: 'BR',
        addressRegion: addr.region,
        ...(addr.locality ? { addressLocality: addr.locality } : {}),
        ...(addr.street ? { streetAddress: addr.street } : {}),
        ...(addr.postal ? { postalCode: addr.postal } : {}),
      },
      ...(center ? { geo: { '@type': 'GeoCoordinates', latitude: center[1], longitude: center[0] } } : {}),
    },
  };
}

function centroid(ring: number[][]): [number, number] {
  const n = ring.length - 1 || 1;
  const sum = ring.slice(0, n).reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  return [Number((sum[0] / n).toFixed(6)), Number((sum[1] / n).toFixed(6))];
}

/** The listing's facts (label, value), as the page lists them. */
export function listingFacts(l: Listing): [string, string][] {
  const rent = l.transaction === 'rent';
  return [
    ['Tipo', TYPE_LABELS[l.type]],
    ['Negócio', TRANSACTION_LABELS[l.transaction ?? 'sale']],
    [l.type === 'land' ? 'Área do lote' : 'Área útil', area(l.areaM2)],
    ...(l.totalAreaM2 ? ([['Área total', area(l.totalAreaM2)]] as [string, string][]) : []),
    ...(l.type !== 'land'
      ? ([
          ...(hasBedrooms(l.type)
            ? [['Quartos', l.suites ? `${l.bedrooms} (${l.suites} ${l.suites === 1 ? 'suíte' : 'suítes'})` : String(l.bedrooms)]]
            : []),
          ['Banheiros', String(l.bathrooms)],
          ['Vagas', String(l.parkingSpots)],
          ['Obra', STATUS_LABELS[l.status]],
        ] as [string, string][])
      : []),
    ...(l.unitFloor ? ([['Andar', `${l.unitFloor}º`]] as [string, string][]) : []),
    ...(l.condoFee ? ([['Condomínio', `${brl(l.condoFee)}/mês`]] as [string, string][]) : []),
    ...(l.iptu ? ([['IPTU', `${brl(l.iptu.value)}/${l.iptu.period === 'month' ? 'mês' : 'ano'}`]] as [string, string][]) : []),
    ...(rent || l.transaction === 'both' ? [] : ([['Preço por m²', `${brl(l.price / l.areaM2)}/m²`]] as [string, string][])),
    ...(l.referenceCode ? ([['Código', l.referenceCode]] as [string, string][]) : []),
  ];
}

/** Full HTML of a listing page. Demo listings are marked noindex (fictional data must not reach search results). */
export function renderListingPage(l: Listing, ctx: PageContext): string {
  const url = `${ctx.siteUrl}${pagePath(l)}`;
  const mapUrl = `${ctx.siteUrl}?imovel=${encodeURIComponent(l.id)}`;
  const desc = description(l, ctx.agencyName);
  const addr = shownAddress(l);
  const rent = l.transaction === 'rent';
  const price = rent ? `${brl(l.rentPrice ?? l.price)}<small>/mês</small>` : brl(l.price);
  const reduced = !rent && l.previousPrice && l.previousPrice > l.price ? `<s>${brl(l.previousPrice)}</s> ` : '';
  const facts = listingFacts(l);
  const wa = l.advertiser?.whatsapp?.replace(/\D/g, '');
  const waLink =
    wa && wa.length >= 10
      ? `https://wa.me/${wa.startsWith('55') ? wa : `55${wa}`}?text=${encodeURIComponent(`Olá! Vi o anúncio "${l.title}"${l.referenceCode ? ` (código ${l.referenceCode})` : ''} e gostaria de mais informações.`)}`
      : null;
  const cover = l.photos?.[0]?.src;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
${ctx.csp ? `<meta http-equiv="Content-Security-Policy" content="${esc(ctx.csp)}">\n` : ''}<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(l.title)} · ${esc(rent ? `${brl(l.rentPrice ?? l.price)}/mês` : brl(l.price))} · ${esc(ctx.agencyName)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
${l.fictional ? '<meta name="robots" content="noindex">\n' : ''}<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(ctx.siteName)}">
<meta property="og:title" content="${esc(l.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
${cover ? `<meta property="og:image" content="${esc(cover)}">\n<meta name="twitter:card" content="summary_large_image">\n` : ''}<script type="application/ld+json">${JSON.stringify(structuredData(l, ctx, url)).replace(/</g, '\\u003c')}</script>
<style>${LISTING_PAGE_CSS}</style>
</head>
<body>
<header><strong>${esc(ctx.siteName)}</strong><a href="${esc(mapUrl)}">Ver no mapa 3D →</a></header>
<main>
${l.fictional ? '<p class="demo">Imóvel fictício, usado para demonstração.</p>' : ''}
<h1>${esc(l.title)}</h1>
<p class="price">${reduced}${price}</p>
${addr.line ? `<p class="addr">${esc(addr.line)}</p>` : ''}
${
  l.photos?.length
    ? `<div class="gallery">${l.photos
        .map((p, i) => {
          const set = photoSrcset(p, 'src');
          return `<img src="${esc(p.src)}"${set ? ` srcset="${esc(set)}" sizes="(max-width: 560px) 100vw, 300px"` : ''} alt="${esc(p.caption ?? `${l.title}, foto ${i + 1}`)}" ${i ? 'loading="lazy"' : ''}>`;
        })
        .join('')}</div>`
    : ''
}
<div class="actions">
<a class="btn" href="${esc(mapUrl)}">Ver o imóvel no mapa 3D</a>
${waLink ? `<a class="btn wa" href="${esc(waLink)}" rel="nofollow">Conversar no WhatsApp</a>` : ''}
</div>
<dl>${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
${l.features.length ? `<ul class="features">${l.features.map((f) => `<li>${esc(AMENITY_LABELS[f])}</li>`).join('')}</ul>` : ''}
${l.highlight && l.highlight !== 'standard' ? `<p>${esc(HIGHLIGHT_LABELS[l.highlight])}</p>` : ''}
<p>${esc(l.description).replace(/\n/g, '<br>')}</p>
<p>Anunciado por <strong>${esc(ctx.agencyName)}</strong>${l.advertiser?.creci ? ` · CRECI ${esc(l.advertiser.creci)}` : ''}.</p>
</main>
<footer>Mapa © OpenStreetMap contributors (ODbL).</footer>
</body>
</html>
`;
}

export function renderSitemap(urls: { loc: string; lastmod?: string }[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}
