// Static pages of the listings on the platform's own domain (scripts/prerender.mjs: dist/imovel/<título>-<código>/).
// Their address ends with the listing's code, so a page whose title changed moves for good (301) to its current
// address, and a listing that left the site answers 404 with noindex (dist/404.html). The codes are in
// data/page-codes.json (code → page). functions/[[path]].ts answers the 301 on Cloudflare Pages; on hosts without
// functions (GitHub Pages) the script of 404.html sends the visitor to the current page.

/** Current page of a requested "/imovel/<segment>/" ("imovel/.../"), or null: no listing with that code. */
export function movedPage(pathname: string, codes: Record<string, string>): string | null {
  const m = /\/imovel\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  let seg: string;
  try {
    seg = decodeURIComponent(m[1]).toLowerCase();
  } catch {
    return null;
  }
  // the longest ending that is a code: "casa-nova-apt-18" is apt-18, not 18
  for (let i = -1; i < seg.length; i = seg.indexOf('-', i + 1)) {
    const page = Object.hasOwn(codes, seg.slice(i + 1)) ? codes[seg.slice(i + 1)] : undefined;
    if (page) return page;
    if (seg.indexOf('-', i + 1) < 0) break;
  }
  return null;
}

/** Same as movedPage, for the browser (inline in 404.html; reads the site's address from data-base). */
export const NOT_FOUND_SCRIPT = `(function () {
  var base = document.currentScript.dataset.base;
  var m = /\\/imovel\\/([^/]+)\\/?$/.exec(location.pathname);
  if (!m) return;
  fetch(base + 'data/page-codes.json').then(function (r) { return r.json(); }).then(function (codes) {
    var seg = decodeURIComponent(m[1]).toLowerCase();
    for (var i = -1; i < seg.length; i = seg.indexOf('-', i + 1)) {
      var code = seg.slice(i + 1);
      if (Object.prototype.hasOwnProperty.call(codes, code)) return location.replace(base + codes[code]);
      if (seg.indexOf('-', i + 1) < 0) break;
    }
  }).catch(function () {});
})();`;

export const NOT_FOUND_CSS = 'body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px}';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** dist/404.html: "Página não encontrada", out of the search engines; `csp` allows its script and style by their hashes. */
export function renderNotFoundPage(ctx: { siteUrl: string; siteName: string; csp: string }): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(ctx.csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Página não encontrada · ${esc(ctx.siteName)}</title>
<style>${NOT_FOUND_CSS}</style>
</head>
<body>
<h1>Página não encontrada</h1>
<p>O imóvel pode ter sido vendido ou retirado do site.</p>
<p><a href="${esc(ctx.siteUrl)}">Ver os imóveis no mapa</a></p>
<script data-base="${esc(ctx.siteUrl)}">${NOT_FOUND_SCRIPT}</script>
</body>
</html>
`;
}
