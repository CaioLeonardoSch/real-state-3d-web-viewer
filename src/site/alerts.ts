// E-mails of the new-listing alerts (table search_alerts, sent by scripts/send-alerts.mjs): which listings are new
// for an alert, the links of the client's site and the two messages (confirmation, then the new listings). Pure, so
// the unit tests and the Node script share it.
import { TYPE_LABELS, isForRent, isForSale, priceIn, type Listing } from '../data/types.ts';
import { escapeHtml, formatArea, formatBRL } from '../utils/format.ts';
import type { SortKey } from '../state/sort';
import type { SearchView } from './config';
import { bairroCounts, queryToSearch, runSearch } from './search.ts';

/** The most listings in one e-mail (the rest are counted, and the search link shows all). */
export const ALERT_MAX_LISTED = 10;

export interface AlertSite {
  id: string;
  name: string;
  slug: string;
  customDomain: string | null;
}

/**
 * Addresses of the client's site: on its own domain, the page paths (/imoveis, /imovel?id=); on the platform's
 * address (`platformUrl`, where site.html is), ?imobiliaria=slug&p=…
 */
export function siteHref(site: AlertSite, platformUrl: string, page: string, params: Record<string, string> | URLSearchParams = {}): string {
  const p = new URLSearchParams(params);
  if (site.customDomain) return `https://${site.customDomain}/${page}${p.size ? `?${p}` : ''}`;
  const q = new URLSearchParams({ imobiliaria: site.slug, p: page });
  for (const [k, v] of p) q.append(k, v);
  return `${platformUrl.replace(/\/$/, '')}/site.html?${q}`;
}

/** Listings of the search published after `since` (ISO time), in the search's order. */
export function newForAlert(
  listings: readonly Listing[],
  publishedAt: ReadonlyMap<string, string>,
  query: string,
  since: string,
  site: { id: string; search: { sort: SortKey; view: SearchView } },
): Listing[] {
  const bairros = bairroCounts(listings, false).map((b) => b.name);
  const t = Date.parse(since);
  return runSearch(listings, queryToSearch(query, site.search, new Set([site.id]), bairros)).filter((l) => Date.parse(publishedAt.get(l.id) ?? '') > t);
}

export interface Mail {
  subject: string;
  text: string;
  html: string;
}

const shell = (site: AlertSite, body: string, cancel: string) =>
  `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;color:#1d2127">${body}
  <p style="color:#5d6570;font-size:13px;margin-top:28px">Você recebe este e-mail porque pediu avisos no site de ${escapeHtml(site.name)}.
  <a href="${escapeHtml(cancel)}">Cancelar este alerta</a>.</p></div>`;

export function confirmMail(site: AlertSite, label: string, token: string, platformUrl: string): Mail {
  const confirm = siteHref(site, platformUrl, 'favoritos', { alerta: 'confirmar', token });
  const cancel = siteHref(site, platformUrl, 'favoritos', { alerta: 'cancelar', token });
  return {
    subject: `Confirme o alerta de imóveis de ${site.name}`,
    text: `Para receber um e-mail quando entrar imóvel novo na busca "${label}", confirme pelo link:\n${confirm}\n\nSe não foi você que pediu, ignore este e-mail: sem a confirmação, nada mais é enviado.\nCancelar: ${cancel}`,
    html: shell(
      site,
      `<p>Para receber um e-mail quando entrar imóvel novo na busca <b>${escapeHtml(label)}</b>, confirme:</p>
      <p><a href="${escapeHtml(confirm)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#1f4fd1;color:#fff;text-decoration:none">Confirmar o alerta</a></p>
      <p>Se não foi você que pediu, ignore este e-mail: sem a confirmação, nada mais é enviado.</p>`,
      cancel,
    ),
  };
}

export function newListingsMail(site: AlertSite, label: string, query: string, found: readonly Listing[], token: string, platformUrl: string): Mail {
  const rent = new URLSearchParams(query).get('negocio') === 'alugar';
  const cancel = siteHref(site, platformUrl, 'favoritos', { alerta: 'cancelar', token });
  const all = siteHref(site, platformUrl, 'imoveis', new URLSearchParams(query));
  const shown = found.slice(0, ALERT_MAX_LISTED);
  const line = (l: Listing) => {
    // as on the cards: a rent search shows the rent; a sale search, the price (or the rent of a rent-only listing)
    const showRent = rent ? isForRent(l) : !isForSale(l);
    const price = priceIn(l, showRent);
    const money = price === null ? 'Consulte' : `${formatBRL(price)}${showRent ? '/mês' : ''}`;
    const href = siteHref(site, platformUrl, 'imovel', { id: l.id, ...(rent ? { negocio: 'alugar' } : {}) });
    return { href, title: l.title, info: [TYPE_LABELS[l.type], l.address?.bairro, formatArea(l.areaM2), money].filter(Boolean).join(' · ') };
  };
  const rows = shown.map(line);
  const more = found.length - shown.length;
  const n = found.length === 1 ? '1 imóvel novo' : `${found.length} imóveis novos`;
  return {
    subject: `${n} na sua busca: ${label}`,
    text: `${n} em ${site.name} na busca "${label}":\n\n${rows.map((r) => `${r.title}\n${r.info}\n${r.href}`).join('\n\n')}${
      more > 0 ? `\n\nE mais ${more}.` : ''
    }\n\nVer a busca: ${all}\nCancelar este alerta: ${cancel}`,
    html: shell(
      site,
      `<p>${n} em ${escapeHtml(site.name)} na busca <b>${escapeHtml(label)}</b>:</p>
      ${rows.map((r) => `<p><a href="${escapeHtml(r.href)}"><b>${escapeHtml(r.title)}</b></a><br><span style="color:#5d6570">${escapeHtml(r.info)}</span></p>`).join('')}
      ${more > 0 ? `<p>E mais ${more}.</p>` : ''}<p><a href="${escapeHtml(all)}">Ver a busca no site</a></p>`,
      cancel,
    ),
  };
}
