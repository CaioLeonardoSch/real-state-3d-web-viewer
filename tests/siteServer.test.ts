import { describe, expect, it } from 'vitest';
import type { ListingRow, PhotoRow } from '../src/backend/mapping';
import { handleSiteRequest } from '../src/seo/siteServer';
import { listingPath, parsePath } from '../src/site/routes';

const row = (extra: Partial<ListingRow> = {}): ListingRow => ({
  id: '5c1e9a2b-0000-4000-8000-000000000001', org_id: 'o1', type: 'apartment', title: 'Apartamento 3 quartos no Centro',
  description: 'Sol da manhã.', transaction: 'sale', price: 500000, rent_price: null, previous_price: null, price_reduced_at: null,
  condo_fee: null, iptu_value: null, iptu_period: null, area_m2: '90.00', total_area_m2: null, land_area_m2: null, bedrooms: 3,
  suites: 1, bathrooms: 2, parking_spots: 1, covered_parking: 1, unit_floor: 5, floors: 10, towers: null, year_built: 2020,
  usage: 'residential', status: 'ready', features: [], address_display: 'neighborhood', building_osm_id: null,
  building_height_m: null, approx_radius_m: 150, address: { bairro: 'Centro' }, video_url: null, tour_url: null,
  advertiser: null, reference_code: 'AP-102', exclusive: false, availability: 'active', highlight: 'standard',
  published_at: '2026-09-01T12:00:00+00:00', updated_at: '2026-10-01T09:00:00+00:00',
  location: { type: 'Point', coordinates: [-48.85, -26.3] }, footprint: null, lot: null,
  ...extra,
});
const second = row({ id: 'a1b2c3d4-0000-4000-8000-000000000002', title: 'Casa com piscina', reference_code: null, type: 'house' });
const photo: PhotoRow = { listing_id: row().id, path: 'o1/l1/a.webp', thumb_path: null, large_path: null, caption: null, position: 0, is_floor_plan: false };
const BOOT = { org: { name: 'Casa Nova', branding: { name: 'Casa Nova Imóveis', menu: ['venda', 'sobre', 'contato'] } }, listings: [row(), second], photos: [photo] };
const SHELL =
  '<!doctype html><html lang="pt-BR"><head><title>Imóveis em Joinville</title><meta name="description" content="Imóveis." />' +
  '<script type="module" crossorigin src="./assets/site-1.js"></script><link rel="stylesheet" crossorigin href="./assets/site-1.css"></head>' +
  '<body><div id="site"></div></body></html>';
const ENV = { SUPABASE_URL: 'https://db.exemplo.com', SUPABASE_ANON_KEY: 'anon', PLATFORM_HOSTS: 'mapa.exemplo.com,*.pages.dev' };

async function ask(url: string, boot: unknown = BOOT, method = 'GET') {
  const calls: unknown[] = [];
  const fetchFn = (async (...args: unknown[]) => {
    calls.push(args);
    return new Response(JSON.stringify(boot));
  }) as typeof fetch;
  const shell = async () => new Response(SHELL, { headers: { 'x-frame-options': 'SAMEORIGIN', 'content-length': '1' } });
  const res = await handleSiteRequest(new Request(url, { method }), ENV, shell, fetchFn);
  return { res, calls, html: res && method === 'GET' ? await res.text() : '' };
}

describe('endereços do site do cliente', () => {
  it('cada imóvel tem título e código no endereço; o código o encontra mesmo com outro título', () => {
    const [a, b] = [row(), second].map((r) => ({ id: r.id, title: r.title, referenceCode: r.reference_code ?? undefined }));
    expect(listingPath(a)).toBe('/imovel/apartamento-3-quartos-no-centro-ap-102');
    expect(listingPath(b)).toBe('/imovel/casa-com-piscina-a1b2c3d4');
    expect(parsePath(listingPath(a), [a, b])).toEqual({ route: 'imovel', listing: a });
    expect(parsePath('/imovel/titulo-antigo-ap-102/', [a, b])?.listing).toBe(a);
    expect(parsePath('/imovel/nada-x9', [a, b])).toEqual({ route: 'imovel', listing: undefined });
    // the longest code that ends the address wins
    const c = { id: 'c', title: 'Sala', referenceCode: '102' };
    expect(parsePath('/imovel/sala-ap-102', [c, a])?.listing).toBe(a);
    expect(parsePath('/imovel/sala-102', [c, a])?.listing).toBe(c);
    expect(parsePath('/sobre/', [])).toEqual({ route: 'sobre' });
    expect(parsePath('/', [])).toEqual({ route: 'inicio' });
    expect(parsePath('/blog', [])).toBeNull();
    expect(parsePath('/%E0%A4%A', [])).toBeNull();
  });
});

describe('servidor das páginas no domínio do cliente', () => {
  it('deixa passar a plataforma, os arquivos, o que não é leitura e os domínios sem cliente', async () => {
    for (const url of ['http://localhost:4173/', 'http://127.0.0.1/', 'https://mapa.exemplo.com/', 'https://x.pages.dev/', 'https://casanova.com.br/assets/site-1.js', 'https://casanova.com.br/mapa.html']) {
      const { res, calls } = await ask(url);
      expect(res, url).toBeNull();
      expect(calls).toHaveLength(0);
    }
    expect((await ask('https://casanova.com.br/', BOOT, 'POST')).res).toBeNull();
    expect((await ask('https://outro.com.br/', null)).res).toBeNull();
  });

  it('página inicial: título, descrição, canônico, Open Graph e a imobiliária nos dados estruturados', async () => {
    const { res, html, calls } = await ask('https://casanova.com.br/');
    expect(res!.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect((calls[0] as [string, RequestInit])[1].body).toBe(JSON.stringify({ p_host: 'casanova.com.br' }));
    expect(html).toContain('<title>Casa Nova Imóveis · Imóveis em Joinville</title>');
    expect(html).toContain('<link rel="canonical" href="https://casanova.com.br/">');
    expect(html).toContain('<meta property="og:title" content="Casa Nova Imóveis · Imóveis em Joinville">');
    expect(html).toContain('"@type":"RealEstateAgent"');
    expect(html).toContain('<meta name="site-paths" content="1">');
    expect(html).toContain('src="/assets/site-1.js"');
    expect(html).toContain('href="/assets/site-1.css"');
    expect(html).not.toContain('noindex');
    // the security headers of the site's HTML, without the length of the original
    expect(res!.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res!.headers.get('content-length')).toBeNull();
  });

  it('ficha: título, preço na descrição, foto e dados do anúncio com o endereço do domínio', async () => {
    const { res, html } = await ask('https://casanova.com.br/imovel/apartamento-3-quartos-no-centro-ap-102');
    expect(res!.status).toBe(200);
    const canonical = 'https://casanova.com.br/imovel/apartamento-3-quartos-no-centro-ap-102';
    expect(html).toContain('<title>Apartamento 3 quartos no Centro · Casa Nova Imóveis</title>');
    expect(html).toContain(`<link rel="canonical" href="${canonical}">`);
    expect(html).toMatch(/<meta name="description" content="[^"]*R\$ 500\.000/);
    expect(html).toContain('<meta property="og:image" content="https://db.exemplo.com/storage/v1/object/public/listing-photos/o1/l1/a.webp">');
    const ld = /<script type="application\/ld\+json" data-ld>(.*?)<\/script>/.exec(html)![1];
    expect(ld).toContain(canonical);
  });

  it('o corpo já vem com o conteúdo, para quem não roda JavaScript', async () => {
    const ficha = (await ask('https://casanova.com.br/imovel/apartamento-3-quartos-no-centro-ap-102')).html;
    const body = /<div id="site">([\s\S]*)<\/div><\/body>/.exec(ficha)![1];
    expect(body).toContain('<h1>Apartamento 3 quartos no Centro</h1>');
    expect(body).toContain('R$ 500.000');
    expect(body).toContain('<dt>Quartos</dt><dd>3 (1 suíte)</dd>');
    expect(body).toContain('Sol da manhã.');
    expect(body).toContain('src="https://db.exemplo.com/storage/v1/object/public/listing-photos/o1/l1/a.webp"');
    expect(body).toContain('<a href="/sobre">Sobre nós</a>');
    // the list links every listing, by its current address
    const lista = (await ask('https://casanova.com.br/imoveis')).html;
    expect(lista).toContain('<a href="/imovel/apartamento-3-quartos-no-centro-ap-102">Apartamento 3 quartos no Centro</a>');
    expect(lista).toContain('<a href="/imovel/casa-com-piscina-a1b2c3d4">Casa com piscina</a>');
    expect((await ask('https://casanova.com.br/')).html).toContain('<h2>Imóveis recentes</h2>');
    expect((await ask('https://casanova.com.br/imovel/vendido-zz9')).html).toContain('<h1>Imóvel não encontrado</h1>');
    // text from the advertiser is escaped
    const evil = row({ title: '<img src=x onerror=alert(1)>', description: '<script>x</script>' });
    const html = (await ask('https://casanova.com.br/imoveis', { ...BOOT, listings: [evil] })).html;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('endereços antigos e títulos antigos vão para o endereço atual (301)', async () => {
    const id = row().id;
    const cases: [string, string][] = [
      ['/imovel/titulo-antigo-ap-102', '/imovel/apartamento-3-quartos-no-centro-ap-102'],
      [`/site.html?imobiliaria=casa-nova&p=imovel&id=${id}&negocio=alugar`, '/imovel/apartamento-3-quartos-no-centro-ap-102?negocio=alugar'],
      [`/imovel?id=${id}`, '/imovel/apartamento-3-quartos-no-centro-ap-102'],
      ['/?p=sobre', '/sobre'],
      ['/site.html', '/'],
      ['/index.html', '/'],
      ['/index.html?p=sobre', '/sobre'],
      ['/contato/', '/contato'],
    ];
    for (const [from, to] of cases) {
      const { res } = await ask(`https://casanova.com.br${from}`);
      expect([from, res!.status, res!.headers.get('location')]).toEqual([from, 301, to]);
    }
    // a search keeps its filters, with no redirect
    expect((await ask('https://casanova.com.br/imoveis?bairro=Centro&tipo=casa')).res!.status).toBe(200);
  });

  it('o que não existe responde 404, fora do Google; listas pessoais também ficam fora', async () => {
    for (const [path, title] of [
      ['/imovel/vendido-zz9', 'Imóvel não encontrado'],
      ['/blog', 'Página não encontrada'],
    ]) {
      const { res, html } = await ask(`https://casanova.com.br${path}`);
      expect(res!.status).toBe(404);
      expect(html).toContain(`<title>${title} · Casa Nova Imóveis</title>`);
      expect(html).toContain('<meta name="robots" content="noindex" data-page>');
      expect(html).not.toContain('rel="canonical"');
    }
    const fav = await ask('https://casanova.com.br/favoritos');
    expect(fav.res!.status).toBe(200);
    expect(fav.html).toContain('noindex');
  });

  it('sitemap.xml e robots.txt do cliente', async () => {
    const sitemap = (await ask('https://casanova.com.br/sitemap.xml')).html;
    expect(sitemap).toContain('<loc>https://casanova.com.br/</loc>');
    expect(sitemap).toContain('<loc>https://casanova.com.br/imoveis</loc>');
    expect(sitemap).toContain('<loc>https://casanova.com.br/sobre</loc>');
    expect(sitemap).not.toContain('/anunciar');
    expect(sitemap).toContain('<loc>https://casanova.com.br/imovel/apartamento-3-quartos-no-centro-ap-102</loc><lastmod>2026-10-01</lastmod>');
    expect(sitemap).toContain('<loc>https://casanova.com.br/imovel/casa-com-piscina-a1b2c3d4</loc>');
    const robots = (await ask('https://casanova.com.br/robots.txt')).html;
    expect(robots).toContain('Disallow: /favoritos');
    expect(robots).toContain('Sitemap: https://casanova.com.br/sitemap.xml');
  });
});
