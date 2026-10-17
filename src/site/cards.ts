// Listing cards of the client's site (grid and list), in the style the market expects: photo carousel, code,
// favourite and compare, type, neighbourhood, specs with icons and the price (with a verified reduction).
import { AVAILABILITY_LABELS, TYPE_LABELS, hasBedrooms, isForRent, isForSale, priceIn, priceReduction, type Listing, type Photo } from '../data/types';
import { escapeHtml, formatArea, formatBRL } from '../utils/format';
import { photoSrcset } from '../utils/images';
import type { SiteConfig } from './config';
import { ICONS } from './icons';
import { placeholderPhoto } from './placeholder';
import { codeOf } from './routes';

export interface CardContext {
  config: SiteConfig;
  href: (route: string, params?: Record<string, string>) => string;
  isFavorite: (id: string) => boolean;
  isCompared: (id: string) => boolean;
  /** Show rents (searching for rentals). */
  rent: boolean;
}

/** Photos to show: the listing's, or one illustration (marked as such) when it has none. */
export function photosOf(l: Listing, c: SiteConfig): (Photo & { illustration?: true })[] {
  if (l.photos?.length) return l.photos;
  return [{ src: placeholderPhoto(l, c.colors.primary, c.theme === 'dark'), caption: 'Ilustração (imóvel sem fotos)', illustration: true }];
}

export const placeOf = (l: Listing) => [l.address?.bairro, l.address?.city ?? 'Joinville'].filter(Boolean).join(' - ');

/** Price block: rent "/mês", reduced price with the previous one struck through and the percentage. */
export function priceHtml(l: Listing, rent: boolean, compact = false): string {
  const showRent = rent ? isForRent(l) : !isForSale(l);
  const value = priceIn(l, showRent) ?? l.price;
  const red = showRent ? null : priceReduction(l);
  const other = !compact && !rent && isForSale(l) && isForRent(l) && l.rentPrice ? `<span class="p-alt">ou ${formatBRL(l.rentPrice)}/mês</span>` : '';
  return `<span class="price${red ? ' reduced' : ''}">${
    red
      ? `<span class="p-red" title="Preço reduzido em ${red.percent}% (histórico registrado)">↓ ${red.percent}%</span><s aria-label="Preço anterior">${formatBRL(red.previous)}</s>`
      : ''
  }<strong>${formatBRL(value)}${showRent ? '<small>/mês</small>' : ''}</strong>${other}</span>`;
}

export function specsHtml(l: Listing, full = false): string {
  const items: [keyof typeof ICONS, string, string][] = [];
  items.push(['area', formatArea(l.areaM2), l.type === 'land' ? 'de terreno' : 'de área']);
  if (l.type !== 'land') {
    if (hasBedrooms(l.type)) items.push(['bed', String(l.bedrooms), l.bedrooms === 1 ? 'quarto' : 'quartos']);
    if (l.suites) items.push(['suite', String(l.suites), l.suites === 1 ? 'suíte' : 'suítes']);
    if (full || !l.suites) items.push(['bath', String(l.bathrooms), l.bathrooms === 1 ? 'banheiro' : 'banheiros']);
    items.push(['car', String(l.parkingSpots), l.parkingSpots === 1 ? 'vaga' : 'vagas']);
  }
  return `<ul class="specs">${items
    .map(([icon, v, label]) => `<li title="${escapeHtml(`${v} ${label}`)}">${ICONS[icon]}<span><b>${escapeHtml(v)}</b> <span class="spec-label">${label}</span></span></li>`)
    .join('')}</ul>`;
}

function badges(l: Listing): string {
  const out: string[] = [];
  if (l.highlight && l.highlight !== 'standard') out.push(`<span class="badge badge-hl">${l.highlight === 'super' ? 'Super destaque' : 'Destaque'}</span>`);
  if (l.status === 'under_construction') out.push('<span class="badge">Lançamento</span>');
  if (l.availability && l.availability !== 'active') out.push(`<span class="badge badge-off">${AVAILABILITY_LABELS[l.availability]}</span>`);
  if (l.features.includes('financing')) out.push('<span class="badge badge-soft">Financiamento</span>');
  else if (l.features.includes('exchange')) out.push('<span class="badge badge-soft">Permuta</span>');
  return out.length ? `<div class="badges">${out.join('')}</div>` : '';
}

/** Width of a card's photo for `sizes`: the whole width on phones, a grid column on wider screens. */
const CARD_SIZES = '(max-width: 600px) 100vw, 400px';

/** A card's photo: the small version, or the one the screen needs among the small and the medium. */
const cardPhoto = (p: Photo): [string, string | null] => [p.thumb ?? p.src, photoSrcset(p, 'src')];

/** A listing card; `level` is its title's heading level (2 under a page's h1, 3 under a section's h2). */
export function cardHtml(l: Listing, ctx: CardContext, layout: 'grade' | 'lista' = 'grade', level: 2 | 3 = 3): string {
  const c = ctx.config;
  const photos = photosOf(l, c);
  // searching for rentals: the listing page opens in rent mode too
  const href = ctx.href('imovel', { id: l.id, ...(ctx.rent && isForRent(l) ? { negocio: 'alugar' } : {}) });
  const fav = ctx.isFavorite(l.id);
  const cmp = ctx.isCompared(l.id);
  const title = escapeHtml(l.title);
  const priceOnPhoto = c.search.cardPrice === 'foto' && layout === 'grade';
  return `<article class="card card-${layout}" data-id="${escapeHtml(l.id)}">
    <div class="card-media" data-index="0" data-photos="${escapeHtml(JSON.stringify(photos.slice(0, 8).map(cardPhoto)))}">
      <a href="${escapeHtml(href)}" data-nav tabindex="-1" aria-hidden="true"><img src="${escapeHtml(cardPhoto(photos[0])[0])}"${
        cardPhoto(photos[0])[1] ? ` srcset="${escapeHtml(cardPhoto(photos[0])[1]!)}" sizes="${CARD_SIZES}"` : ''
      } alt="" loading="lazy" decoding="async"></a>
      ${badges(l)}
      <button type="button" class="icon-btn fav${fav ? ' on' : ''}" data-fav="${escapeHtml(l.id)}" aria-pressed="${fav}" aria-label="Favorito: ${title}">${ICONS.heart}</button>
      ${
        photos.length > 1
          ? `<button type="button" class="icon-btn car-btn car-prev" aria-label="Foto anterior">${ICONS.left}</button><button type="button" class="icon-btn car-btn car-next" aria-label="Próxima foto">${ICONS.right}</button><span class="car-dots" aria-hidden="true">${photos
              .slice(0, 8)
              .map((_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`)
              .join('')}</span>`
          : ''
      }
      ${priceOnPhoto ? `<div class="price-on-photo">${priceHtml(l, ctx.rent, true)}</div>` : ''}
    </div>
    <div class="card-body">
      <div class="card-head">
        <span class="card-type">${TYPE_LABELS[l.type]}</span>
        ${c.search.showCode ? `<span class="card-code">Cód. ${escapeHtml(codeOf(l))}</span>` : ''}
      </div>
      <h${level} class="card-title"><a href="${escapeHtml(href)}" data-nav>${title}</a></h${level}>
      <p class="card-place">${ICONS.pin}${escapeHtml(placeOf(l))}</p>
      ${layout === 'lista' ? `<p class="card-desc">${escapeHtml(l.description.slice(0, 220))}${l.description.length > 220 ? '…' : ''}</p>` : ''}
      ${specsHtml(l)}
      <div class="card-foot">
        ${priceOnPhoto ? `<span class="card-condo">${l.condoFee ? `Cond. ${formatBRL(l.condoFee)}` : ''}</span>` : priceHtml(l, ctx.rent)}
        <label class="cmp"><input type="checkbox" data-cmp="${escapeHtml(l.id)}"${cmp ? ' checked' : ''} aria-label="Comparar: ${title}"> Comparar</label>
      </div>
    </div>
  </article>`;
}

/** Photo carousel of the cards (event delegation on a container). */
export function wireCarousels(root: HTMLElement): void {
  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.car-btn');
    if (!btn) return;
    e.preventDefault();
    const media = btn.closest<HTMLElement>('.card-media')!;
    const photos = JSON.parse(media.dataset.photos ?? '[]') as [string, string | null][];
    const i = (Number(media.dataset.index) + (btn.classList.contains('car-next') ? 1 : -1) + photos.length) % photos.length;
    media.dataset.index = String(i);
    const img = media.querySelector('img')!;
    const [src, set] = photos[i];
    if (set) {
      img.srcset = set;
      img.sizes = CARD_SIZES;
    } else img.removeAttribute('srcset');
    img.src = src;
    media.querySelectorAll('.car-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
  });
}
