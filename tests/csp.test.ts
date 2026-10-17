import { describe, expect, it } from 'vitest';
import headersTemplate from '../public/_headers?raw';
import indexHtml from '../index.html?raw';
import siteHtml from '../site.html?raw';
import panelHtml from '../painel.html?raw';
import { appCsp, cspMeta, listingCsp, originOf, renderHeaders, styleHash } from '../scripts/lib/csp.mjs';
import { LISTING_PAGE_CSS, renderListingPage } from '../src/seo/listingPage';
import type { Listing } from '../src/data/types';

const directive = (policy: string, name: string) => policy.split('; ').find((d) => d.split(' ')[0] === name)?.split(' ').slice(1) ?? null;

describe('Content-Security-Policy', () => {
  it('app pages: own scripts only, back end and tiles origins from the build, nothing inline but styles', () => {
    const p = appCsp({ supabaseUrl: 'https://abc.supabase.co/', tileUrls: ['joinville.pmtiles', 'https://tiles.example.com/j-2026-11.pmtiles'] });
    expect(directive(p, 'script-src')).toEqual(["'self'"]);
    expect(directive(p, 'connect-src')).toEqual(["'self'", 'https://abc.supabase.co', 'https://tiles.example.com', 'https://viacep.com.br']);
    expect(directive(p, 'img-src')).toContain('https://abc.supabase.co');
    expect(directive(p, 'frame-src')).toEqual(["'self'", 'https://www.youtube-nocookie.com', 'https://player.vimeo.com']);
    expect(directive(p, 'object-src')).toEqual(["'none'"]);
    expect(directive(p, 'frame-ancestors')).toEqual(["'self'"]);
    expect(p).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  });

  it('meta variant leaves out what a <meta> policy cannot carry; Turnstile only when configured', () => {
    const meta = appCsp({ meta: true });
    expect(directive(meta, 'frame-ancestors')).toBeNull();
    expect(directive(meta, 'upgrade-insecure-requests')).toBeNull();
    expect(meta).not.toContain('challenges.cloudflare.com');
    const t = appCsp({ turnstile: true });
    for (const d of ['script-src', 'frame-src', 'connect-src']) expect(directive(t, d)).toContain('https://challenges.cloudflare.com');
  });

  it('listing pages: no scripts, only their own stylesheet, never framed', () => {
    const p = listingCsp({ supabaseUrl: 'http://127.0.0.1:54321', styleHashes: [styleHash(LISTING_PAGE_CSS)] });
    expect(directive(p, 'default-src')).toEqual(["'none'"]);
    expect(directive(p, 'img-src')).toEqual(["'self'", 'http://127.0.0.1:54321']);
    expect(directive(p, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(p, 'script-src')).toBeNull(); // falls back to default-src 'none'
  });

  it('the hash matches the <style> the page really has, and the meta tag goes in the page', () => {
    const csp = listingCsp({ styleHashes: [styleHash(LISTING_PAGE_CSS)], meta: true });
    const l = { id: 'apt-1', type: 'apartment', title: 'Apto', agency: 'a', price: 1, areaM2: 50, bedrooms: 1, bathrooms: 1, parkingSpots: 0, status: 'ready', features: [], approximateLocation: false, description: '' } as unknown as Listing;
    const html = renderListingPage(l, { siteUrl: 'https://s.com/', agencyName: 'A', siteName: 'S', csp });
    const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
    expect(styleHash(css)).toBe(styleHash(LISTING_PAGE_CSS));
    expect(html.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(html.indexOf('<style>'));
  });

  it('origins, meta tag and the _headers template', () => {
    expect(originOf('https://x.supabase.co/rest/v1')).toBe('https://x.supabase.co');
    expect(originOf('joinville.pmtiles')).toBeNull();
    expect(originOf('javascript:alert(1)')).toBeNull();
    expect(cspMeta(`default-src 'self'`)).toBe(`<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`);
    const out = renderHeaders(headersTemplate, { app: 'APP', listing: 'LISTING' });
    expect(out).toMatch(/^\/\*\n(  [A-Za-z-]+: .+\n)*  Content-Security-Policy: APP$/m);
    expect(out).toMatch(/^\/imovel\/\*\n  Content-Security-Policy: LISTING$/m);
    for (const h of ['Strict-Transport-Security', 'X-Content-Type-Options: nosniff', 'Referrer-Policy: strict-origin-when-cross-origin', 'Permissions-Policy', 'X-Frame-Options'])
      expect(out).toContain(h);
  });

  it('no inline scripts or event-handler attributes in the pages and templates (the policy would block them)', () => {
    for (const html of [indexHtml, siteHtml, panelHtml]) {
      expect([...html.matchAll(/<script\b([^>]*)>/g)].every((m) => /\bsrc=/.test(m[1]) || /application\/ld\+json/.test(m[1]))).toBe(true);
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    }
    const sources = import.meta.glob<string>('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(sources).length).toBeGreaterThan(40);
    const offenders = Object.entries(sources)
      .filter(([, code]) => /<[a-z][^<>]*\son(click|load|error|submit|change|input|focus|blur|key\w+|mouse\w+)\s*=/i.test(code))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
