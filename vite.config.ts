import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { appCsp, cspMeta, listingCsp, renderHeaders, styleHash } from './scripts/lib/csp.mjs';
import { LISTING_PAGE_CSS } from './src/seo/listingPage.ts';

/** Demonstration data in public/data: left out of production builds. */
const DEMO_FILES = ['listings.json', 'developments.json', 'sites.json'];

/**
 * Content-Security-Policy of the build, from its own configuration (scripts/lib/csp.mjs): a <meta> tag in the HTML
 * pages, for hosts without headers (GitHub Pages), and the full headers in dist/_headers (public/_headers is the
 * template), for Cloudflare Pages or Netlify. Development (vite dev) gets no policy: its HMR needs inline code.
 */
function securityPolicy(): Plugin {
  let policies = { meta: '', app: '', listing: '' };
  let outDir = 'dist';
  return {
    name: 'security-policy',
    apply: 'build',
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir, 'VITE_');
      // tile files may live on object storage (absolute URL in meta.json; see src/data/load.ts)
      const meta = JSON.parse(readFileSync(path.join(config.root, 'public', 'data', 'meta.json'), 'utf8')) as Record<string, unknown>;
      const tileUrls = Object.entries(meta).flatMap(([k, v]) => (/tiles/i.test(k) && typeof v === 'string' ? [v] : []));
      const o = { supabaseUrl: env.VITE_SUPABASE_URL, tileUrls, turnstile: !!env.VITE_TURNSTILE_SITE_KEY };
      policies = {
        meta: appCsp({ ...o, meta: true }),
        app: appCsp(o),
        listing: listingCsp({ supabaseUrl: o.supabaseUrl, styleHashes: [styleHash(LISTING_PAGE_CSS)] }),
      };
      outDir = path.resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: {
      // after Vite's own tags, right below <meta charset>: the policy covers everything the page loads
      order: 'post',
      handler: (html) => html.replace(/<meta charset="[^"]*"\s*\/?>/i, (tag) => `${tag}\n    ${cspMeta(policies.meta)}`),
    },
    writeBundle() {
      const file = path.join(outDir, '_headers');
      if (existsSync(file)) writeFileSync(file, renderHeaders(readFileSync(file, 'utf8'), policies));
    },
  };
}

/**
 * Production build (VITE_DEMO_LISTINGS=false): the map page loses the demonstration title, description and banner,
 * and the demonstration data is not published (listings come from the back end; see src/data/load.ts).
 */
function production(demo: boolean): Plugin {
  let outDir = 'dist';
  return {
    name: 'production',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!demo) for (const f of DEMO_FILES) rmSync(path.join(outDir, 'data', f), { force: true });
    },
    transformIndexHtml(html, ctx) {
      if (demo || !ctx.filename.endsWith('index.html')) return html;
      return html
        .replace(/<title>[^<]*<\/title>/, '<title>Mapa 3D de imóveis · Joinville e região</title>')
        .replace(
          /<meta name="description" content="[^"]*"/,
          '<meta name="description" content="Imóveis à venda e para alugar em Joinville e Araquari (SC), no mapa 3D da cidade."',
        )
        .replace(/\s*<span class="demo-banner"[^>]*>[^<]*<\/span>/, '');
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  return {
    base: './',
    plugins: [securityPolicy(), production(env.VITE_DEMO_LISTINGS !== 'false')],
    build: {
      // index.html: the 3D map (also embedded by the sites); site.html: a client's site (white label)
      rollupOptions: { input: { main: 'index.html', site: 'site.html' } },
    },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});
