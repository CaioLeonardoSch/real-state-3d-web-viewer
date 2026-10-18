#!/usr/bin/env node
// After `vite build`: one static HTML page per listing (dist/imovel/<slug>/index.html), sitemap.xml, robots.txt and
// data/pages.json (listing id → page), so search engines index the listings and shared links get a preview.
// Listings: the demo file (marked noindex, kept out of the sitemap) and, when VITE_SUPABASE_URL/ANON_KEY are set,
// the published listings of the back end (read like any visitor, through public_listings).
// SITE_URL: absolute address of the site (default: the GitHub Pages address of this repository).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LISTING_PAGE_CSS, pageCode, pagePath, renderListingPage, renderSitemap } from '../src/seo/listingPage.ts';
import { NOT_FOUND_CSS, NOT_FOUND_SCRIPT, renderNotFoundPage } from '../src/seo/platformPages.ts';
import { rowToListing } from '../src/backend/mapping.ts';
import { listingCsp, styleHash } from './lib/csp.mjs';
import { REGION } from './lib/region.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, process.env.OUT_DIR || "dist");
const SITE_URL = (process.env.SITE_URL || 'https://caioleonardosch.github.io/real-state-3d-web-viewer/').replace(/\/?$/, '/');
const SITE_NAME = process.env.SITE_NAME || `${REGION.city} e região`;

const listingsFile = JSON.parse(await readFile(path.join(DIST, 'data', 'listings.json'), 'utf8'));
const agencyName = new Map(listingsFile.agencies.map((a) => [a.id, a.name]));
const pages = [];
if (process.env.VITE_DEMO_LISTINGS !== 'false') pages.push(...listingsFile.listings);

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (url && key) {
  const get = async (q) => {
    const r = await fetch(`${url}/rest/v1/${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`${q.split('?')[0]}: HTTP ${r.status}`);
    return r.json();
  };
  try {
    const rows = await get('public_listings?select=*&limit=5000');
    const ids = rows.map((r) => r.id);
    const photos = ids.length ? await get(`listing_photos?select=listing_id,path,thumb_path,large_path,caption,position,is_floor_plan&limit=50000`) : [];
    const orgs = ids.length ? await get('organizations?select=id,name') : [];
    for (const o of orgs) agencyName.set(o.id, o.name);
    const photoUrl = (p) => `${url}/storage/v1/object/public/listing-photos/${p}`;
    pages.push(...rows.map((r) => rowToListing(r, photos, photoUrl, false)));
    console.log(`Backend: ${rows.length} anúncios publicados.`);
  } catch (err) {
    // the site still publishes; the pages of real listings come in the next build
    console.warn(`Backend indisponível para as páginas (${err.message}).`);
  }
}

// the same policy goes into dist/_headers (vite.config.ts); the <meta> copy covers hosts without headers
const csp = listingCsp({ supabaseUrl: url, styleHashes: [styleHash(LISTING_PAGE_CSS)], meta: true });
const index = {};
const codes = {};
const sitemap = [{ loc: SITE_URL }];
for (const l of pages) {
  const rel = pagePath(l);
  const html = renderListingPage(l, { siteUrl: SITE_URL, agencyName: agencyName.get(l.agency) ?? '', siteName: SITE_NAME, csp });
  await mkdir(path.join(DIST, rel), { recursive: true });
  await writeFile(path.join(DIST, rel, 'index.html'), html);
  index[l.id] = rel;
  codes[pageCode(l.id)] = rel;
  if (!l.fictional) sitemap.push({ loc: `${SITE_URL}${rel}`, ...(l.updatedAt ? { lastmod: l.updatedAt } : {}) });
}
await writeFile(path.join(DIST, 'data', 'pages.json'), JSON.stringify(index));
// an old title of a page moves to the current one, a listing that left answers 404 (src/seo/platformPages.ts)
await writeFile(path.join(DIST, 'data', 'page-codes.json'), JSON.stringify(codes));
const notFoundCsp = `default-src 'none'; script-src ${styleHash(NOT_FOUND_SCRIPT)}; style-src ${styleHash(NOT_FOUND_CSS)}; connect-src 'self'; base-uri 'none'; form-action 'none'`;
await writeFile(path.join(DIST, '404.html'), renderNotFoundPage({ siteUrl: SITE_URL, siteName: SITE_NAME, csp: notFoundCsp }));
await writeFile(path.join(DIST, 'sitemap.xml'), renderSitemap(sitemap));
await writeFile(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`);
console.log(`Páginas: ${pages.length} (${sitemap.length - 1} no sitemap); ${SITE_URL}`);
