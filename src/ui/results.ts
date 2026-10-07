import type { Listing } from '../data/types';
import { TYPE_LABELS } from '../data/types';
import { SORT_KEYS, SORT_LABELS, priceRangeLabel, type SortKey } from '../state/sort';
import type { RelaxSuggestion, RelaxableField } from '../state/filters';
import { escapeHtml, formatArea, formatBRL } from '../utils/format';

export interface ResultsHandlers {
  onPick: (id: string) => void;
  onHover: (id: string | null) => void;
  onSortChange: (sort: SortKey) => void;
  /** Remove one criterion and search again (from the empty-results hint). */
  onRelax: (field: RelaxableField) => void;
  onClearAll: () => void;
}

const FIELD_LABELS: Record<RelaxableField, string> = {
  types: 'o filtro de tipo',
  priceMin: 'o preço mínimo',
  priceMax: 'o preço máximo',
  bedroomsMin: 'o mínimo de quartos',
  areaMin: 'a área mínima',
  agency: 'o filtro de imobiliária',
};

function closestHint(s: RelaxSuggestion): string | null {
  if (s.closest === null) return null;
  switch (s.field) {
    case 'priceMax':
      return `o mais barato custa ${formatBRL(s.closest)}`;
    case 'priceMin':
      return `o mais caro custa ${formatBRL(s.closest)}`;
    case 'areaMin':
      return `o maior tem ${formatArea(s.closest)}`;
    case 'bedroomsMin':
      return s.closest > 0 ? `o máximo é ${s.closest} ${s.closest === 1 ? 'quarto' : 'quartos'}` : null;
    default:
      return null;
  }
}

function emptyHtml(suggestions: RelaxSuggestion[]): string {
  const top = suggestions.slice(0, 2);
  return `<div class="results-empty">
    <p>Nenhum imóvel atende a todos os filtros.</p>
    ${
      top.length
        ? `<ul class="relax">${top
            .map((s) => {
              const hint = closestHint(s);
              const found = s.count === 1 ? '1 imóvel' : `${s.count} imóveis`;
              return `<li><button type="button" data-relax="${s.field}">
                <span class="r-title">Remover ${FIELD_LABELS[s.field]}</span>
                <span class="r-meta">${found}${hint ? ` · ${hint}` : ''}</span>
              </button></li>`;
            })
            .join('')}</ul>`
        : '<p class="muted">Nenhum filtro sozinho resolve.</p>'
    }
    <button type="button" class="btn-secondary" data-action="clear-all">Limpar todos os filtros</button>
  </div>`;
}

export interface ResultsView {
  /** Listings to show, already sorted. */
  results: Listing[];
  total: number;
  sort: SortKey;
  /** Shown when there are no results. */
  suggestions?: RelaxSuggestion[];
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

  render({ results, total, sort, suggestions = [] }: ResultsView): void {
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
          ? emptyHtml(suggestions)
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
    const { onPick, onHover, onSortChange, onRelax, onClearAll } = this.handlers;
    this.el
      .querySelectorAll<HTMLButtonElement>('button[data-relax]')
      .forEach((b) => b.addEventListener('click', () => onRelax(b.dataset.relax as RelaxableField)));
    this.el.querySelector('[data-action="clear-all"]')?.addEventListener('click', onClearAll);
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
