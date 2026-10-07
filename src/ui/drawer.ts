import type { Agency, Listing } from '../data/types';
import { STATUS_LABELS, TYPE_LABELS } from '../data/types';
import { escapeHtml, formatArea, formatBRL, formatBRLCents } from '../utils/format';
import { floorPlanSvg } from '../utils/floorplan';
import { simulatePayment } from '../utils/payment';

export class Drawer {
  private openId: string | null = null;
  constructor(
    private el: HTMLElement,
    private agencies: Agency[],
    private onClose: () => void,
  ) {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.openId) this.close();
    });
  }

  get currentId() {
    return this.openId;
  }

  open(l: Listing): void {
    this.openId = l.id;
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
      <div class="drawer-handle" aria-hidden="true"></div>
      <div class="drawer-head">
        <span class="badge-fictional">Imóvel fictício para demonstração</span>
        <button type="button" class="icon-btn" data-action="close" aria-label="Fechar detalhes">×</button>
      </div>
      <h2 id="drawer-title">${escapeHtml(l.title)}</h2>
      <p class="price">${formatBRL(l.price)}</p>
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
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    this.el.scrollTop = 0;
    this.el.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.openId) return;
    this.openId = null;
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    this.onClose();
  }
}
