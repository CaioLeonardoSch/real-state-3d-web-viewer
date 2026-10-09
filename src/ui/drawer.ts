import type { Agency, Listing } from '../data/types';
import {
  AMENITY_LABELS,
  AVAILABILITIES,
  AVAILABILITY_LABELS,
  HIGHLIGHT_LABELS,
  RENT_GUARANTEE_LABELS,
  STATUS_LABELS,
  TRANSACTION_LABELS,
  TYPE_LABELS,
  USAGE_LABELS,
  isForRent,
  isForSale,
  priceReduction,
  transactionOf,
  type Availability,
} from '../data/types';
import { addressLabel, formatDate, safeUrl, today, videoEmbedUrl, whatsappLink } from '../data/listingText';
import { escapeHtml, formatArea, formatBRL, formatBRLCents, parseNumberInput } from '../utils/format';
import { floorPlanSvg } from '../utils/floorplan';
import { simulatePayment } from '../utils/payment';

/** Position of the open listing inside the current list, for previous/next navigation. */
export interface DrawerNav {
  index: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
}

const isMobile = () => window.matchMedia('(max-width: 720px)').matches;
const SWIPE_PX = 30;

export class Drawer {
  private openId: string | null = null;
  private nav: DrawerNav | null = null;
  private swipeStartY: number | null = null;
  private ignoreNextClick = false;
  constructor(
    private el: HTMLElement,
    private agencies: Agency[],
    private onClose: () => void,
    private onNavigate: (id: string) => void = () => {},
    /** Deletes one of the user's listings; resolves to an error message or null. */
    private onDelete: (id: string) => Promise<string | null> = async () => null,
    /** Saves changes to one of the user's listings; resolves to an error message or null. */
    private onUpdate: (l: Listing) => Promise<string | null> = async () => null,
  ) {
    document.addEventListener('keydown', (e) => {
      if (!this.openId) return;
      if (e.key === 'Escape') return this.close();
      // ← / → browse the list while focus is in the drawer (not in a form field)
      const inDrawer = this.el.contains(document.activeElement);
      if (!inDrawer || (e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.key === 'ArrowLeft' && this.nav?.prevId) this.onNavigate(this.nav.prevId);
      if (e.key === 'ArrowRight' && this.nav?.nextId) this.onNavigate(this.nav.nextId);
    });
    this.bindSheetGestures();
  }

  get expanded() {
    return this.el.classList.contains('expanded');
  }

  /** Mobile bottom sheet: collapsed shows a summary strip; expanded shows everything. */
  setExpanded(on: boolean): void {
    this.el.classList.toggle('expanded', on);
    document.body.classList.toggle('drawer-expanded', on && this.openId !== null);
    this.el.querySelector('.drawer-handle')?.setAttribute('aria-expanded', String(on));
    this.el.querySelector('.drawer-handle')?.setAttribute('aria-label', on ? 'Recolher detalhes' : 'Expandir detalhes');
    if (!on) this.el.scrollTop = 0;
  }

  private bindSheetGestures(): void {
    // Swipe on the summary strip: up expands, down collapses (or closes when already collapsed).
    this.el.addEventListener('pointerdown', (e) => {
      if (!isMobile() || !(e.target as HTMLElement).closest('.drawer-handle, .drawer-summary')) return;
      this.swipeStartY = e.clientY;
    });
    window.addEventListener('pointerup', (e) => {
      if (this.swipeStartY === null) return;
      const dy = e.clientY - this.swipeStartY;
      this.swipeStartY = null;
      if (Math.abs(dy) < SWIPE_PX || !this.openId) return;
      this.ignoreNextClick = true;
      setTimeout(() => (this.ignoreNextClick = false), 0);
      if (dy < 0) this.setExpanded(true);
      else if (this.expanded) this.setExpanded(false);
      else this.close();
    });
    // Tap on the handle toggles; tap anywhere on the collapsed strip (except buttons) expands.
    this.el.addEventListener('click', (e) => {
      if (!isMobile() || this.ignoreNextClick) return;
      const t = e.target as HTMLElement;
      if (t.closest('.drawer-handle')) return this.setExpanded(!this.expanded);
      if (!this.expanded && !t.closest('button, a')) this.setExpanded(true);
    });
  }

  get currentId() {
    return this.openId;
  }

  open(l: Listing, nav: DrawerNav | null = null): void {
    const freshOpen = this.openId === null;
    this.openId = l.id;
    this.nav = nav;
    const agency = this.agencies.find((a) => a.id === l.agency)?.name ?? l.agency;
    const sim = simulatePayment(l.price, l.status);
    const sale = isForSale(l);
    const rentOnly = !sale;
    const building = l.type !== 'land';
    const opt = (cond: unknown, row: [string, string]): [string, string][] => (cond ? [row] : []);
    const rows: [string, string][] = [
      ['Tipo', TYPE_LABELS[l.type] + (l.usage === 'commercial' ? ` (${USAGE_LABELS.commercial.toLowerCase()})` : '')],
      ...opt(l.transaction, ['Negócio', TRANSACTION_LABELS[transactionOf(l)]]),
      [l.type === 'land' ? 'Área do lote' : 'Área útil', formatArea(l.areaM2)],
      ...opt(l.totalAreaM2, ['Área total', formatArea(l.totalAreaM2 ?? 0)]),
      ...opt(l.landAreaM2 && building, ['Área do terreno', formatArea(l.landAreaM2 ?? 0)]),
      ...(building
        ? ([
            ['Quartos', l.suites ? `${l.bedrooms} (${l.suites} ${l.suites === 1 ? 'suíte' : 'suítes'})` : String(l.bedrooms)],
            ['Banheiros', String(l.bathrooms)],
            ['Vagas', l.coveredParking ? `${l.parkingSpots} (${l.coveredParking} cobertas)` : String(l.parkingSpots)],
          ] as [string, string][])
        : []),
      ...opt(l.unitFloor, ['Andar da unidade', `${l.unitFloor}º`]),
      ...(l.floors
        ? ([
            [
              'Andares do edifício',
              // the generator uses the building's real floors when the cadastre (or OSM) knows them
              l.userAdded
                ? String(l.floors)
                : `${l.floors} (${l.buildingHeightM && Math.round(l.buildingHeightM / 3) === l.floors ? 'estimativa pelo cadastro' : 'fictício'})`,
            ],
          ] as [string, string][])
        : []),
      ...opt(l.towers && l.towers > 1, ['Torres', String(l.towers)]),
      ...opt(l.yearBuilt, [l.status === 'under_construction' ? 'Entrega prevista' : 'Ano de construção', String(l.yearBuilt)]),
      ...opt(building, ['Obra', STATUS_LABELS[l.status]]),
      ...opt(sale, ['Preço por m²', `${formatBRL(Math.round(l.price / l.areaM2))}/m²`]),
      ...opt(l.condoFee, ['Condomínio', `${formatBRL(l.condoFee ?? 0)}/mês`]),
      ...opt(l.iptu, ['IPTU', l.iptu ? `${formatBRL(l.iptu.value)}/${l.iptu.period === 'month' ? 'mês' : 'ano'}` : '']),
      ...opt(l.rentGuarantees?.length, ['Garantias aceitas', (l.rentGuarantees ?? []).map((g) => RENT_GUARANTEE_LABELS[g]).join(', ')]),
      ['Imobiliária', agency],
      ...opt(l.advertiser?.creci, ['CRECI', l.advertiser?.creci ?? '']),
      ...opt(l.referenceCode, ['Código', l.referenceCode ?? '']),
      ...opt(l.publishedAt, ['Publicado em', formatDate(l.publishedAt ?? '')]),
      ...opt(l.updatedAt && l.updatedAt !== l.publishedAt, ['Atualizado em', formatDate(l.updatedAt ?? '')]),
    ];
    const address = addressLabel(l);
    const tags = [
      l.availability && l.availability !== 'active' ? `<span class="r-tag tag-${l.availability}">${AVAILABILITY_LABELS[l.availability]}</span>` : '',
      l.highlight && l.highlight !== 'standard' ? `<span class="r-tag tag-${l.highlight}">${HIGHLIGHT_LABELS[l.highlight]}</span>` : '',
      l.exclusive ? '<span class="r-tag tag-exclusive">Exclusivo</span>' : '',
    ].join(' ');
    const priceBlock = (() => {
      const rent = isForRent(l) ? `${formatBRL(l.rentPrice ?? l.price)}<small>/mês</small>` : '';
      if (rentOnly) return `<p class="price">${rent}</p><p class="price-note">Aluguel</p>`;
      const r = priceReduction(l);
      const also = rent ? `<p class="price-note">ou aluguel de ${rent}</p>` : '';
      if (!r) return `<p class="price">${formatBRL(l.price)}</p>${also}`;
      const since = r.since ? ` em ${formatDate(r.since)}` : '';
      return `<p class="price-was"><s>${formatBRL(r.previous)}</s> <span class="price-cut">−${r.percent}%</span></p>
        <p class="price">${formatBRL(l.price)}</p>
        <p class="price-note">Preço reduzido${since}</p>${also}`;
    })();
    const contact = l.advertiser?.whatsapp
      ? whatsappLink(l.advertiser.whatsapp, `Olá! Vi o anúncio "${l.title}"${l.referenceCode ? ` (código ${l.referenceCode})` : ''} e gostaria de mais informações.`)
      : null;
    const video = safeUrl(l.videoUrl);
    const tour = safeUrl(l.tourUrl);
    // the price history is shown to the advertiser only (in "Gerenciar anúncio"), not to the public
    const history = l.userAdded && (l.priceHistory ?? []).length > 1 ? l.priceHistory! : null;
    const embed = videoEmbedUrl(l.videoUrl);
    const slides = this.slides(l);

    this.el.innerHTML = `
      <button type="button" class="drawer-handle" aria-expanded="false" aria-label="Expandir detalhes"><span></span></button>
      <div class="drawer-summary">
      <div class="drawer-head">
        ${
          nav
            ? `<div class="drawer-nav" role="group" aria-label="Navegar entre imóveis">
                <button type="button" class="nav-btn" data-action="prev" aria-label="Imóvel anterior" ${nav.prevId ? '' : 'disabled'}>‹</button>
                <span class="nav-pos">${nav.index + 1} de ${nav.total}</span>
                <button type="button" class="nav-btn" data-action="next" aria-label="Próximo imóvel" ${nav.nextId ? '' : 'disabled'}>›</button>
              </div>`
            : '<span></span>'
        }
        <button type="button" class="icon-btn" data-action="close" aria-label="Fechar detalhes">×</button>
      </div>
      ${
        l.userAdded
          ? `<span class="badge-fictional badge-user">${
              l.remote ? `Seu anúncio${l.draft ? ' · rascunho' : ''}` : 'Seu anúncio · salvo só neste navegador'
            }</span>`
          : l.fictional
            ? '<span class="badge-fictional">Imóvel fictício para demonstração</span>'
            : ''
      }
      <h2 id="drawer-title">${escapeHtml(l.title)}</h2>
      ${tags.trim() ? `<p class="drawer-tags">${tags}</p>` : ''}
      ${priceBlock}
      ${address ? `<p class="drawer-address">📍 ${escapeHtml(address)}</p>` : ''}
      </div>
      ${
        slides.length
          ? `<figure class="gallery" data-index="0">
              <img src="${escapeHtml(slides[0].src)}" alt="${escapeHtml(slides[0].caption ?? `Foto 1 de ${slides.length}`)}">
              ${slides.length > 1 ? `<button type="button" class="gal-btn gal-prev" aria-label="Foto anterior">‹</button><button type="button" class="gal-btn gal-next" aria-label="Próxima foto">›</button>` : ''}
              <figcaption><span class="gal-pos">1/${slides.length}</span> <span class="gal-caption">${escapeHtml(slides[0].caption ?? '')}</span></figcaption>
            </figure>`
          : ''
      }
      ${
        embed
          ? `<div class="video"><iframe src="${escapeHtml(embed)}" title="Vídeo do imóvel" loading="lazy"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen
              referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
          : ''
      }
      ${
        contact
          ? `<a class="btn-primary btn-whatsapp" href="${escapeHtml(contact)}" target="_blank" rel="noopener">Conversar no WhatsApp${l.advertiser?.contactName ? ` com ${escapeHtml(l.advertiser.contactName)}` : ''}</a>`
          : ''
      }
      ${
        l.approximateLocation
          ? `<p class="notice-approx">📍 Localização aproximada: a posição exata não é exibida; o círculo indica um raio de ~${l.approxRadiusM ?? 150} m.</p>`
          : ''
      }
      <dl class="facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>
      ${
        l.features.length
          ? `<ul class="amenities" aria-label="Comodidades">${l.features.map((f) => `<li>${AMENITY_LABELS[f]}</li>`).join('')}</ul>`
          : ''
      }
      <p class="description">${escapeHtml(l.description)}</p>
      ${
        (video && !embed) || tour
          ? `<p class="media-links">${video && !embed ? `<a href="${escapeHtml(video)}" target="_blank" rel="noopener">▶ Ver vídeo</a>` : ''}${
              tour ? `<a href="${escapeHtml(tour)}" target="_blank" rel="noopener">⟳ Tour 360°</a>` : ''
            }</p>`
          : ''
      }
      ${
        l.floorPlanImage
          ? ''
          : `<figure class="floorplan">
        ${floorPlanSvg(l)}
        <figcaption>Planta ilustrativa (não corresponde ao imóvel real)</figcaption>
      </figure>`
      }

      ${sale ? `<section class="simulation">
        <h3>Simulação ilustrativa</h3>
        <dl>
          <div><dt>Entrada (20%)</dt><dd>${formatBRLCents(sim.downPayment)}</dd></div>
          ${
            sim.balloons.count
              ? `<div><dt>${sim.balloons.count} reforços anuais (5% cada)</dt><dd>${formatBRLCents(sim.balloons.value)}</dd></div>`
              : ''
          }
          <div><dt>${sim.installments} parcelas mensais</dt><dd>${formatBRLCents(sim.installmentValue)}</dd></div>
        </dl>
        <p class="muted small">Sem juros nem correção. Valores apenas para demonstração; não é proposta de financiamento.</p>
      </section>` : ''}
      ${
        l.userAdded
          ? `<section class="manage">
              <h3>Gerenciar anúncio</h3>
              <form class="manage-form">
                <label class="a-field">Situação<select name="availability">${AVAILABILITIES.map(
                  (a) => `<option value="${a}" ${a === (l.availability ?? 'active') ? 'selected' : ''}>${AVAILABILITY_LABELS[a]}</option>`,
                ).join('')}</select></label>
                <label class="a-field">${rentOnly ? 'Aluguel (R$/mês)' : 'Preço de venda (R$)'}<input name="price" inputmode="numeric" value="${l.price}"></label>
                <p class="a-hint">Baixar o preço mostra o preço anterior riscado; o histórico fica registrado.</p>
                <p class="a-error" role="alert" hidden></p>
                <button type="submit" class="btn-secondary">Salvar alterações</button>
              </form>
              ${
                history
                  ? `<div class="price-history"><h3>Histórico de preço <small>(visível só para você)</small></h3><ol>${history
                      .map((h) => `<li><span>${formatDate(h.date)}</span> <b>${formatBRL(h.price)}</b></li>`)
                      .join('')}</ol></div>`
                  : ''
              }
              <button type="button" class="btn-secondary btn-danger" data-action="delete">Excluir este anúncio</button>
            </section>`
          : ''
      }
      <p class="drawer-attrib">Mapa: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> (ODbL) · <a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a></p>
    `;
    this.el.querySelector('[data-action="close"]')!.addEventListener('click', () => this.close());
    this.el.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      const where = l.remote ? 'Ele sai do ar para todos.' : 'Ele só existe neste navegador.';
      if (!window.confirm(`Excluir o anúncio "${l.title}"? ${where}`)) return;
      const error = await this.onDelete(l.id);
      if (error) window.alert(error);
    });
    this.bindGallery(l);
    this.el.querySelector<HTMLFormElement>('.manage-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.saveManage(l, e.currentTarget as HTMLFormElement);
    });
    this.el.querySelector('[data-action="prev"]')?.addEventListener('click', () => nav?.prevId && this.onNavigate(nav.prevId));
    this.el.querySelector('[data-action="next"]')?.addEventListener('click', () => nav?.nextId && this.onNavigate(nav.nextId));
    this.el.classList.add('open');
    document.body.classList.add('drawer-open');
    // a newly opened listing starts collapsed on mobile; browsing keeps the current state
    this.setExpanded(freshOpen ? false : this.expanded);
    this.el.setAttribute('aria-hidden', 'false');
    this.el.scrollTop = 0;
    this.el.focus({ preventScroll: true });
  }

  /** Photos (cover first), then the floor plan sent by the advertiser. */
  private slides(l: Listing) {
    return [...(l.photos ?? []), ...(l.floorPlanImage ? [{ src: l.floorPlanImage, caption: 'Planta' }] : [])];
  }

  private bindGallery(l: Listing): void {
    const fig = this.el.querySelector<HTMLElement>('.gallery');
    const photos = this.slides(l);
    if (!fig || photos.length < 2) return;
    const show = (i: number) => {
      const n = (i + photos.length) % photos.length;
      fig.dataset.index = String(n);
      const img = fig.querySelector('img')!;
      img.src = photos[n].src;
      img.alt = photos[n].caption ?? `Foto ${n + 1} de ${photos.length}`;
      fig.querySelector('.gal-pos')!.textContent = `${n + 1}/${photos.length}`;
      fig.querySelector('.gal-caption')!.textContent = photos[n].caption ?? '';
    };
    fig.querySelector('.gal-prev')!.addEventListener('click', () => show(Number(fig.dataset.index) - 1));
    fig.querySelector('.gal-next')!.addEventListener('click', () => show(Number(fig.dataset.index) + 1));
  }

  /** Status and price changes of the user's own listing. A lower price becomes a recorded reduction. */
  private async saveManage(l: Listing, form: HTMLFormElement): Promise<void> {
    const fd = new FormData(form);
    const price = parseNumberInput(String(fd.get('price') ?? ''));
    const err = form.querySelector<HTMLElement>('.a-error')!;
    if (!price || price < 100) {
      err.hidden = false;
      err.textContent = 'Informe um preço válido.';
      return;
    }
    const date = today();
    const next: Listing = { ...l, availability: fd.get('availability') as Availability, updatedAt: date };
    const newPrice = Math.round(price);
    if (newPrice !== l.price) {
      next.price = newPrice;
      if (transactionOf(l) === 'rent') next.rentPrice = newPrice;
      next.priceHistory = [...(l.priceHistory ?? [{ date: l.publishedAt ?? date, price: l.price }]), { date, price: newPrice }];
      if (newPrice < l.price) {
        // the struck-through price is the highest one since the last increase
        next.previousPrice = Math.max(l.previousPrice ?? 0, l.price);
        next.priceReducedAt = date;
      } else {
        delete next.previousPrice;
        delete next.priceReducedAt;
      }
    }
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    btn.disabled = true;
    const error = await this.onUpdate(next);
    btn.disabled = false;
    if (error) {
      err.hidden = false;
      err.textContent = error;
    }
  }

  close(): void {
    if (!this.openId) return;
    this.openId = null;
    this.nav = null;
    this.el.classList.remove('open');
    document.body.classList.remove('drawer-open');
    this.setExpanded(false);
    this.el.setAttribute('aria-hidden', 'true');
    this.onClose();
  }
}
