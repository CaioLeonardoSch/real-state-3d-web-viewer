import { describe, expect, it } from 'vitest';
import type { Listing } from '../src/data/types';
import { pagePath, renderListingPage, renderSitemap, slugify } from '../src/seo/listingPage';

const base: Listing = {
  id: '5c1e9a2b-1111-2222-3333-444455556666', type: 'house', title: 'Casa com piscina, 3 quartos!', agency: 'o', price: 900000,
  areaM2: 180, bedrooms: 3, bathrooms: 2, parkingSpots: 2, status: 'ready', features: ['pool'], approximateLocation: false,
  description: 'Linda casa </script><script>alert(1)</script>', transaction: 'sale', addressDisplay: 'full',
  address: { street: 'Rua A', number: '10', bairro: 'Centro', city: 'Joinville', cep: '89201-000' },
  footprint: { type: 'Polygon', coordinates: [[[-48.85, -26.3], [-48.849, -26.3], [-48.849, -26.299], [-48.85, -26.3]]] },
  photos: [{ src: 'https://cdn/x.jpg', caption: 'Fachada' }], publishedAt: '2026-10-01', advertiser: { creci: '1-J', whatsapp: '47999990000' },
};
const ctx = { siteUrl: 'https://site.com/', agencyName: 'Imobiliária A', siteName: 'Joinville' };
const ld = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);

describe('listing pages for search engines', () => {
  it('slug and path', () => {
    expect(slugify('Apartamento Ação 2 quartos!')).toBe('apartamento-acao-2-quartos');
    expect(slugify('Terreno 15×30 m')).toBe('terreno-15x30-m');
    expect(pagePath(base)).toBe('imovel/casa-com-piscina-3-quartos-5c1e9a2b/');
    expect(pagePath({ id: 'apt-17', title: 'Apto' })).toBe('imovel/apto-apt-17/');
  });
  it('title, canonical, preview image, structured data and safe text', () => {
    const html = renderListingPage(base, ctx);
    expect(html).toContain('<title>Casa com piscina, 3 quartos! · R$ 900.000 · Imobiliária A</title>');
    expect(html).toContain('<link rel="canonical" href="https://site.com/imovel/casa-com-piscina-3-quartos-5c1e9a2b/">');
    expect(html).toContain('<meta property="og:image" content="https://cdn/x.jpg">');
    expect(html).not.toContain('noindex');
    expect(html).not.toMatch(/<\/script><script>alert/);
    const data = ld(html);
    expect(data).toMatchObject({ '@type': 'RealEstateListing', offers: { price: 900000, priceCurrency: 'BRL' } });
    expect(data.about.address).toMatchObject({ streetAddress: 'Rua A, 10', postalCode: '89201-000' });
    expect(data.about.geo.latitude).toBeCloseTo(-26.2997, 3);
    expect(html).toContain('href="https://site.com/?imovel=5c1e9a2b-1111-2222-3333-444455556666"');
  });
  it('hidden address stays hidden; rentals priced per month; demo listings are noindex', () => {
    const hidden = renderListingPage({ ...base, addressDisplay: 'neighborhood', approximateLocation: true, footprint: undefined }, ctx);
    expect(hidden).not.toContain('Rua A');
    expect(hidden).not.toContain('89201');
    expect(ld(hidden).about.geo).toBeUndefined();
    const rent = renderListingPage({ ...base, transaction: 'rent', price: 3500, rentPrice: 3500 }, ctx);
    expect(rent).toContain('R$ 3.500<small>/mês</small>');
    expect(ld(rent).offers.priceSpecification.unitCode).toBe('MON');
    expect(renderListingPage({ ...base, fictional: true }, ctx)).toContain('<meta name="robots" content="noindex">');
  });
  it('sitemap', () => {
    expect(renderSitemap([{ loc: 'https://site.com/a&b', lastmod: '2026-10-01' }])).toContain('<url><loc>https://site.com/a&amp;b</loc><lastmod>2026-10-01</lastmod></url>');
  });
});
