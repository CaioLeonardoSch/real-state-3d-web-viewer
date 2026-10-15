// Cloudflare Pages: requests pass here first. Clients' own domains get their pages from src/seo/siteServer.ts (title,
// description, canonical address, sitemap.xml and robots.txt of each client); everything else is the static build.
// Variables (Pages → Settings → Variables): SUPABASE_URL, SUPABASE_ANON_KEY and PLATFORM_HOSTS (the platform's own
// hosts, e.g. "mapa.exemplo.com.br,*.pages.dev"). public/_routes.json keeps the build's files out of here.
import { handleSiteRequest, type SiteEnv } from '../src/seo/siteServer.ts';

interface PagesContext {
  request: Request;
  env: SiteEnv & { ASSETS: { fetch(input: string): Promise<Response> } };
  next(): Promise<Response>;
}

export async function onRequest({ request, env, next }: PagesContext): Promise<Response> {
  // the site's HTML: Pages serves site.html at "/site" (addresses without .html)
  const shell = () => env.ASSETS.fetch(new URL('/site', request.url).href);
  return (await handleSiteRequest(request, env, shell)) ?? next();
}
