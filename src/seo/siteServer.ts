// The pages of a client's site on the client's own domain, as search engines and link previews (WhatsApp, Facebook)
// read them: each address gets the site's HTML (site.html) with its own title, description, canonical address, Open
// Graph tags and structured data already in it, with no JavaScript run; plus the client's /sitemap.xml and
// /robots.txt. Old addresses (site.html?p=..., ?id=, a listing's former title) move for good (301) to the new ones.
// Written for any host that speaks Request/Response: functions/[[path]].ts on Cloudflare Pages, and the preview
// server in vite.config.ts for local tests.
import { rowToListing, type ListingRow, type PhotoRow } from '../backend/mapping.ts';
import type { Listing } from '../data/types.ts';
import { SOCIALS, normalizeSiteConfig, socialUrl, telHref, type SiteConfig } from '../site/config.ts';
import { listingPath, pageMeta, parsePath, routePath, type PageMeta, type Route } from '../site/routes.ts';
import { escapeHtml } from '../utils/format.ts';
import { description, renderSitemap, structuredData } from './listingPage.ts';
import { renderSiteBody } from './siteBody.ts';

export interface SiteEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  /** The platform's own hosts, comma-separated ("*.pages.dev" covers its subdomains): served as usual. */
  PLATFORM_HOSTS?: string;
}

interface Site {
  config: SiteConfig;
  listings: Listing[];
}

/** The client whose domain this is and its published listings, in one request (public.site_bootstrap). */
async function loadSite(host: string, env: SiteEnv, fetchFn: typeof fetch): Promise<Site | null> {
  const res = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/site_bootstrap`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_host: host }),
  });
  if (!res.ok) throw new Error(`site_bootstrap: HTTP ${res.status}`);
  const data = (await res.json()) as { org: { name: string; branding: unknown }; listings: ListingRow[]; photos: PhotoRow[] } | null;
  if (!data) return null;
  // public address of a photo, as the storage client builds it (backend/remote.ts)
  const photoUrl = (path: string) => encodeURI(`${env.SUPABASE_URL}/storage/v1/object/public/listing-photos/${path}`);
  return {
    config: normalizeSiteConfig(data.org.branding, data.org.name),
    listings: data.listings.map((r) => rowToListing(r, data.photos, photoUrl, false)),
  };
}

/** Hosts answered as usual: the platform's own, and addresses without a domain (localhost, IPs). */
function isPlatform(host: string, list = ''): boolean {
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[')) return true;
  return list
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .some((h) => h && (h.startsWith('*.') ? host.endsWith(h.slice(1)) : host === h));
}

const https = (u: string) => (/^https:\/\//.test(u) ? u : undefined);

/** The client as a real estate agency (schema.org), on every page. */
function agencyData(c: SiteConfig, origin: string): object {
  const sameAs = SOCIALS.map((s) => socialUrl(s, c.social[s])).filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateAgent',
    name: c.name,
    url: `${origin}/`,
    logo: https(c.logo),
    telephone: c.contacts.phone ? telHref(c.contacts.phone).slice(4) : undefined,
    email: c.contacts.email || undefined,
    address: c.contacts.address || undefined,
    sameAs: sameAs.length ? sameAs : undefined,
  };
}

const json = (data: object) => JSON.stringify(data).replace(/</g, '\\u003c');

/** The site's HTML with the page's own head, and its content in #site (siteBody.ts) until the script runs. */
function render(shell: string, m: PageMeta, tags: string[], body: string): string {
  // functions as replacements: a price ("R$ 1$") must not be read as a replacement pattern
  return (
    shell
      // the pages live at any depth ("/imovel/..."): the site's files are at the root
      .replace(/(\s(?:src|href))="\.\//g, (_, attr: string) => `${attr}="/`)
      .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(m.title)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*"/, (_, start: string) => `${start}${escapeHtml(m.description.slice(0, 300))}"`)
      .replace('</head>', () => `  ${tags.join('\n    ')}\n  </head>`)
      .replace(/(<div id="site"[^>]*>)(?:\s*<p class="site-loading">[^<]*<\/p>\s*)?<\/div>/, (_, open: string) => `${open}${body}</div>`)
  );
}

const text = (body: string, type: string) => new Response(body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=3600' } });

/**
 * Answers a request to a client's domain; null: not one (another host, a file, not a read), for the host to serve as
 * usual. `shell` gives the site's HTML (site.html of the build).
 */
export async function handleSiteRequest(req: Request, env: SiteEnv, shell: () => Promise<Response>, fetchFn: typeof fetch = fetch): Promise<Response | null> {
  const url = new URL(req.url);
  const host = url.hostname.toLowerCase();
  const special = ['/sitemap.xml', '/robots.txt', '/site.html'].includes(url.pathname);
  if ((req.method !== 'GET' && req.method !== 'HEAD') || isPlatform(host, env.PLATFORM_HOSTS) || (/\.\w+$/.test(url.pathname) && !special)) return null;
  const site = await loadSite(host, env, fetchFn);
  if (!site) return null;
  const c = site.config;
  const origin = url.origin;

  if (url.pathname === '/robots.txt')
    return text(`User-agent: *\nDisallow: /favoritos\nDisallow: /comparar\nDisallow: /index.html\n\nSitemap: ${origin}/sitemap.xml\n`, 'text/plain; charset=utf-8');
  if (url.pathname === '/sitemap.xml') {
    const pages: Route[] = ['inicio', 'imoveis', ...(['sobre', 'contato', 'anunciar'] as const).filter((r) => c.menu.includes(r))];
    const urls = [
      ...pages.map((r) => ({ loc: origin + routePath(r) })),
      ...site.listings.map((l) => ({ loc: origin + listingPath(l), lastmod: (l.updatedAt ?? l.publishedAt)?.slice(0, 10) })),
    ];
    return text(renderSitemap(urls), 'application/xml; charset=utf-8');
  }

  // the page asked for; the old addresses name it in the query (site.html?p=imovel&id=...)
  let path = url.pathname;
  const query = new URLSearchParams(url.search);
  if (path === '/site.html' || query.has('p')) {
    path = `/${query.get('p') ?? ''}`;
    query.delete('p');
    query.delete('imobiliaria');
  }
  const page = parsePath(path, site.listings);
  // "/imovel?id=": the map's links to a listing, and the old addresses
  if (page?.route === 'imovel' && !page.listing && query.has('id')) {
    page.listing = site.listings.find((l) => l.id === query.get('id'));
    if (page.listing) query.delete('id');
  }
  const found = !!page && (page.route !== 'imovel' || !!page.listing);
  const l = page?.listing;
  // the page's own address: anything else (old address, former title, "/sobre/") moves there for good
  const own = page && found ? (l ? listingPath(l) : routePath(page.route)) : null;
  if (own) {
    const q = `${query}`;
    const search = q === `${url.searchParams}` ? url.search : q && `?${q}`;
    if (own + search !== url.pathname + url.search)
      return new Response(null, { status: 301, headers: { location: own + search, 'cache-control': 'public, max-age=3600' } });
  }

  const m: PageMeta = !found
    ? pageMeta(page ? 'imovel-nao-encontrado' : 'nao-encontrada', c)
    : l
      ? { title: `${l.title} · ${c.name}`, description: description(l, c.name) }
      : pageMeta(page.route as Exclude<Route, 'imovel'>, c);
  const canonical = own && !m.noindex ? origin + own : null;
  const image = l?.photos?.[0]?.src ?? https(c.home.heroImage) ?? https(c.logo);
  const a = escapeHtml;
  const tags = [
    canonical && `<link rel="canonical" href="${a(canonical)}">`,
    // removed by the site itself when the visitor moves to a page that is indexed (app.ts, setMeta)
    m.noindex && '<meta name="robots" content="noindex" data-page>',
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="pt_BR">',
    `<meta property="og:site_name" content="${a(c.name)}">`,
    `<meta property="og:title" content="${a(m.title)}">`,
    m.description && `<meta property="og:description" content="${a(m.description.slice(0, 300))}">`,
    canonical && `<meta property="og:url" content="${a(canonical)}">`,
    image && `<meta property="og:image" content="${a(image)}">`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<script type="application/ld+json" data-site-ld>${json(agencyData(c, origin))}</script>`,
    // the listing's data: the site writes the same when it renders the page (app.ts, detail)
    l && canonical && `<script type="application/ld+json" data-ld>${json(structuredData(l, { siteUrl: `${origin}/`, agencyName: c.name, siteName: c.name }, canonical))}</script>`,
    // tells the site to use these addresses (app.ts)
    '<meta name="site-paths" content="1">',
  ].filter((t): t is string => !!t);

  const res = await shell();
  const headers = new Headers(res.headers); // the security headers of the site's HTML
  for (const h of ['content-length', 'content-encoding', 'etag', 'last-modified']) headers.delete(h);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  const body = renderSiteBody(c, found ? { route: page.route, listing: l } : { route: page ? 'imovel' : 'nao-encontrada' }, m, site.listings);
  return new Response(req.method === 'HEAD' ? null : render(await res.text(), m, tags, body), { status: found ? 200 : 404, headers });
}
