// Content-Security-Policy of the pages, built from the build's own configuration (Supabase URL, Turnstile, address
// of the map tiles) so the allowed origins never drift from the code. Used by vite.config.ts (meta tag of index.html
// and site.html, and dist/_headers) and scripts/prerender.mjs (static listing pages).
import { createHash } from 'node:crypto';

/** Cloudflare Turnstile: widget script and frame (src/backend/captcha.ts), only when a site key is configured. */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
/** Embedded videos (videoEmbedUrl in src/data/listingText.ts). */
const VIDEO_FRAMES = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'];
/** CEP lookup of the "Anunciar" form (src/ui/addListing.ts). */
const VIACEP = 'https://viacep.com.br';
/** Fonts a client's site may pick (FONTS in src/site/config.ts). */
const FONTS_CSS = 'https://fonts.googleapis.com';
const FONTS_FILES = 'https://fonts.gstatic.com';

/** Origin of an absolute http(s) URL; null for anything else (relative paths, empty, other schemes). */
export function originOf(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** CSP source of an inline <style> element's exact text. */
export const styleHash = (css) => `'sha256-${createHash('sha256').update(css, 'utf8').digest('base64')}'`;

const serialize = (directives) =>
  Object.entries(directives)
    .map(([name, sources]) => [name, ...new Set(sources)].join(' '))
    .join('; ');

/** Directives only HTTP headers carry: a <meta> policy ignores frame-ancestors, and local previews are plain http. */
const headerOnly = (frameAncestors) => ({ 'frame-ancestors': [frameAncestors], 'upgrade-insecure-requests': [] });

/**
 * Policy of the app pages: the 3D map (index.html, also framed by the client's site on the same origin) and the
 * client's site (site.html). No inline scripts; inline styles stay allowed because the HTML templates set style
 * attributes (colours, sizes). `meta`: the variant for a <meta http-equiv> tag.
 * `tileUrls`: addresses of the map tiles from meta.json; absolute ones (object storage) are allowed to be read.
 * @param {{ supabaseUrl?: string, tileUrls?: string[], turnstile?: boolean, meta?: boolean }} o
 */
export function appCsp({ supabaseUrl, tileUrls = [], turnstile = false, meta = false } = {}) {
  const supabase = originOf(supabaseUrl);
  const tiles = tileUrls.map(originOf).filter(Boolean);
  const opt = (cond, ...v) => (cond ? v : []);
  return serialize({
    'default-src': ["'self'"],
    'script-src': ["'self'", ...opt(turnstile, TURNSTILE_ORIGIN)],
    'style-src': ["'self'", "'unsafe-inline'", FONTS_CSS],
    'font-src': ["'self'", FONTS_FILES],
    // data: and blob: for photos resized in the browser, placeholders and the QR code of the second factor
    'img-src': ["'self'", 'data:', 'blob:', ...opt(supabase, supabase)],
    'connect-src': ["'self'", ...opt(supabase, supabase), ...tiles, VIACEP, ...opt(turnstile, TURNSTILE_ORIGIN)],
    'frame-src': ["'self'", ...VIDEO_FRAMES, ...opt(turnstile, TURNSTILE_ORIGIN)],
    // MapLibre's worker: same origin, or a blob: wrapper when the worker file lives on another origin
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
    ...(meta ? {} : headerOnly("'self'")),
  });
}

/**
 * Policy of the static listing pages (scripts/prerender.mjs): no scripts at all (the JSON-LD block is data, not
 * code), only the page's own <style> and the photos; never framed.
 * @param {{ supabaseUrl?: string, styleHashes?: string[], meta?: boolean }} o
 */
export function listingCsp({ supabaseUrl, styleHashes = [], meta = false } = {}) {
  const supabase = originOf(supabaseUrl);
  return serialize({
    'default-src': ["'none'"],
    'img-src': ["'self'", ...(supabase ? [supabase] : [])],
    'style-src': styleHashes.length ? styleHashes : ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    ...(meta ? {} : headerOnly("'none'")),
  });
}

/** <meta> tag of a policy, for hosts that cannot set headers (GitHub Pages). */
export const cspMeta = (policy) =>
  `<meta http-equiv="Content-Security-Policy" content="${policy.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;

/** Fills the policies into the _headers template (public/_headers). */
export function renderHeaders(template, { app, listing }) {
  return template.replace(/__CSP_APP__/g, app).replace(/__CSP_LISTING__/g, listing);
}
