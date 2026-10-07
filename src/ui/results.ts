import type { Listing } from '../data/types';
import { TYPE_LABELS } from '../data/types';
import { SORT_KEYS, SORT_LABELS, priceRangeLabel, type SortKey } from '../state/sort';
import { escapeHtml, formatArea, formatBRL } from '../utils/format';

export interface ResultsHandlers {
  onPick: (id: string) => void;
  onHover: (id: string | null) => void;
  onSortChange: (sort: SortKey) => void;
}

export interface ResultsView {
  /** Listings to show, already sorted. */
  results: Listing[];
  total: number;
  sort: SortKey;
}

/** Results list: count, price range, sort selector and clickable rows synced with the map. */
export class ResultsPanel {
  constructor(
    private el: HTMLElement,
    private handlers: ResultsHandlers,
  ) {}

  hide(): void {
    this.el.hidden = true;
  }

  render({ results, total, sort }: ResultsView): void {
    const range = priceRangeLabel(results);
    this.el.hidden = false;
    this.el.innerHTML = `
      <div class="results-head">
        <strong>${results.length === 1 ? '1 imóvel encontrado' : `${results.length} imóveis encontrados`}</strong>
        <span class="muted">de ${total}</span>
        <button type="button" class="icon-btn" data-action="close-results" aria-label="Ocultar lista">×</button>
      </div>
      ${
        results.length === 0
          ? '<p class="muted">Nenhum imóvel atende aos filtros. Ajuste e clique em Buscar.</p>'
          : `<div class="results-tools">
              <span class="results-range" title="Faixa de preço dos resultados">${range}</span>
              <label class="results-sort">Ordenar
                <select name="sort">${SORT_KEYS.map(
                  (k) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${SORT_LABELS[k]}</option>`,
                ).join('')}</select>
              </label>
            </div>
            <ul>${results
              .map(
                (l) => `<li><button type="button" data-id="${escapeHtml(l.id)}">
                  <span class="r-title">${escapeHtml(l.title)}</span>
                  <span class="r-meta">${TYPE_LABELS[l.type]} · ${formatArea(l.areaM2)} · <b>${formatBRL(l.price)}</b></span>
                </button></li>`,
              )
              .join('')}</ul>`
      }`;
    const { onPick, onHover, onSortChange } = this.handlers;
    this.el.querySelectorAll<HTMLButtonElement>('button[data-id]').forEach((b) => {
      b.addEventListener('click', () => onPick(b.dataset.id!));
      // hovering or focusing a row highlights the listing on the map
      b.addEventListener('mouseenter', () => onHover(b.dataset.id!));
      b.addEventListener('mouseleave', () => onHover(null));
      b.addEventListener('focus', () => onHover(b.dataset.id!));
      b.addEventListener('blur', () => onHover(null));
    });
    // Sorting only reorders the list (it does not filter), so it applies immediately.
    this.el
      .querySelector<HTMLSelectElement>('select[name="sort"]')
      ?.addEventListener('change', (e) => onSortChange((e.target as HTMLSelectElement).value as SortKey));
    this.el.querySelector('[data-action="close-results"]')!.addEventListener('click', () => this.hide());
  }

  /** Marks the row of the listing hovered on the map (null clears) and keeps it in view. */
  highlight(id: string | null): void {
    this.el.querySelectorAll<HTMLButtonElement>('button[data-id]').forEach((b) => {
      const on = b.dataset.id === id;
      b.classList.toggle('is-hover', on);
      if (on && !this.el.hidden) b.scrollIntoView({ block: 'nearest' });
    });
  }
}
