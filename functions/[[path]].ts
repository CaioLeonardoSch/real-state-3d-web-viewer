// Cloudflare Pages: requests pass here first. Clients' own domains get their pages from src/seo/siteServer.ts (title,
// description, canonical address, content, sitemap.xml and robots.txt of each client); everything else is the static
// build, where a listing's static page whose title changed moves to its current address (src/seo/platformPages.ts).
// Variables (Pages → Settings → Variables): SUPABASE_URL, SUPABASE_ANON_KEY and PLATFORM_HOSTS (the platform's own
// hosts, e.g. "mapa.exemplo.com.br,*.pages.dev"). public/_routes.json keeps the build's files out of here.
import { movedPage } from '../src/seo/platformPages.ts';
import { handleSiteRequest, type SiteEnv } from '../src/seo/siteServer.ts';

interface PagesContext {
  request: Request;
  env: SiteEnv & { ASSETS: { fetch(input: string): Promise<Response> } };
  next(): Promise<Response>;
}

export async function onRequest({ request, env, next }: PagesContext): Promise<Response> {
  // the site's HTML: Pages serves site.html at "/site" (addresses without .html)
  const shell = () => env.ASSETS.fetch(new URL('/site', request.url).href);
  const site = await handleSiteRequest(request, env, shell);
  if (site) return site;
  const res = await next();
  // not found (Pages answers dist/404.html with 404): a listing page under an older title?
  if (res.status !== 404 || !new URL(request.url).pathname.startsWith('/imovel/')) return res;
  const codes = await env.ASSETS.fetch(new URL('/data/page-codes.json', request.url).href);
  const page = codes.ok ? movedPage(new URL(request.url).pathname, (await codes.json()) as Record<string, string>) : null;
  return page ? new Response(null, { status: 301, headers: { location: `/${page}`, 'cache-control': 'public, max-age=3600' } }) : res;
}
