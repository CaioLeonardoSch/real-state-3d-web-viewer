import { rmSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { loadEnv, type Plugin } from 'vite';

/** Demonstration data in public/data: left out of production builds. */
const DEMO_FILES = ['listings.json', 'developments.json', 'sites.json'];

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
    plugins: [production(env.VITE_DEMO_LISTINGS !== 'false')],
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
