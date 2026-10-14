import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { appCsp, cspMeta, listingCsp, renderHeaders, styleHash } from './scripts/lib/csp.mjs';
import { LISTING_PAGE_CSS } from './src/seo/listingPage.ts';

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

export default defineConfig({
  base: './',
  plugins: [securityPolicy()],
  build: {
    // index.html: the 3D map (also embedded by the sites); site.html: a client's site (white label)
    rollupOptions: { input: { main: 'index.html', site: 'site.html' } },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
