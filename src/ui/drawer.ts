import type { Agency, Listing } from '../data/types';
import { STATUS_LABELS, TYPE_LABELS } from '../data/types';
import { escapeHtml, formatArea, formatBRL, formatBRLCents } from '../utils/format';
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
    const rows: [string, string][] = [
      ['Tipo', TYPE_LABELS[l.type]],
      ['Imobiliária', agency],
      [l.type === 'land' ? 'Área do lote' : 'Área construída', formatArea(l.areaM2)],
      ...(l.landAreaM2 && l.type !== 'land' ? ([['Área do terreno', formatArea(l.landAreaM2)]] as [string, string][]) : []),
      ...(l.type !== 'land'
        ? ([
            ['Quartos', String(l.bedrooms)],
            ['Banheiros', String(l.bathrooms)],
            ['Vagas', String(l.parkingSpots)],
          ] as [string, string][])
        : []),
      ...(l.floors ? ([['Pavimentos do edifício', `${l.floors} (fictício)`]] as [string, string][]) : []),
      ['Situação', STATUS_LABELS[l.status]],
    ];

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
      <span class="badge-fictional">Imóvel fictício para demonstração</span>
      <h2 id="drawer-title">${escapeHtml(l.title)}</h2>
      <p class="price">${formatBRL(l.price)}</p>
      </div>
      ${
        l.approximateLocation
          ? `<p class="notice-approx">📍 Localização aproximada: a posição exata não é exibida; o círculo indica um raio de ~${l.approxRadiusM ?? 150} m.</p>`
          : ''
      }
      <dl class="facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>
      <p class="description">${escapeHtml(l.description)}</p>
      <figure class="floorplan">
        ${floorPlanSvg(l)}
        <figcaption>Planta ilustrativa (não corresponde ao imóvel real)</figcaption>
      </figure>
      <section class="simulation">
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
      </section>
      <p class="drawer-attrib">Mapa: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> (ODbL) · <a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a></p>
    `;
    this.el.querySelector('[data-action="close"]')!.addEventListener('click', () => this.close());
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
