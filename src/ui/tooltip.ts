import type { Listing } from '../data/types';
import { AVAILABILITY_LABELS, TYPE_LABELS, isForSale, priceReduction } from '../data/types';
import { escapeHtml, formatArea, formatBRL } from '../utils/format';

const OFFSET = 14; // px from the cursor

/** Small hover label (type, price, area, bedrooms) that follows the mouse over a listing. */
export class HoverTooltip {
  private currentId: string | null = null;

  constructor(
    private el: HTMLElement,
    private container: HTMLElement,
  ) {}

  show(l: Listing, point: { x: number; y: number }): void {
    if (this.currentId !== l.id) {
      this.currentId = l.id;
      const facts = [TYPE_LABELS[l.type], formatArea(l.areaM2)];
      if (l.type !== 'land') facts.push(l.bedrooms === 1 ? '1 quarto' : `${l.bedrooms} quartos`);
      this.el.innerHTML = `
        <strong class="tt-price">${formatBRL(l.price)}${isForSale(l) ? '' : '/mês'}${
          priceReduction(l) ? ` <span class="price-cut">−${priceReduction(l)!.percent}%</span>` : ''
        }</strong>
        ${l.availability && l.availability !== 'active' ? `<span class="tt-note">${AVAILABILITY_LABELS[l.availability]}</span>` : ''}
        <span class="tt-facts">${escapeHtml(facts.join(' · '))}</span>
        ${l.approximateLocation ? '<span class="tt-note">Localização aproximada</span>' : ''}
        <span class="tt-hint">Clique para ver detalhes</span>`;
    }
    this.el.hidden = false;
    // keep the label inside the map area: flip to the left/top near the edges
    const { width: cw, height: ch } = this.container.getBoundingClientRect();
    const { width: w, height: h } = this.el.getBoundingClientRect();
    const x = point.x + OFFSET + w > cw ? point.x - OFFSET - w : point.x + OFFSET;
    const y = point.y + OFFSET + h > ch ? point.y - OFFSET - h : point.y + OFFSET;
    this.el.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, y)}px)`;
  }

  hide(): void {
    this.currentId = null;
    this.el.hidden = true;
  }
}
