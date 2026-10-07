import type { Listing } from '../data/types';
import { TYPE_LABELS } from '../data/types';
import { escapeHtml, formatArea, formatBRL } from '../utils/format';

export function renderResults(
  el: HTMLElement,
  results: Listing[],
  total: number,
  onPick: (id: string) => void,
  onClose: () => void,
): void {
  el.hidden = false;
  el.innerHTML = `
    <div class="results-head">
      <strong>${results.length === 1 ? '1 imóvel encontrado' : `${results.length} imóveis encontrados`}</strong>
      <span class="muted">de ${total}</span>
      <button type="button" class="icon-btn" data-action="close-results" aria-label="Ocultar lista">×</button>
    </div>
    ${
      results.length === 0
        ? '<p class="muted">Nenhum imóvel atende aos filtros. Ajuste e clique em Buscar.</p>'
        : `<ul>${results
            .map(
              (l) => `<li><button type="button" data-id="${escapeHtml(l.id)}">
                <span class="r-title">${escapeHtml(l.title)}</span>
                <span class="r-meta">${TYPE_LABELS[l.type]} · ${formatArea(l.areaM2)} · <b>${formatBRL(l.price)}</b></span>
              </button></li>`,
            )
            .join('')}</ul>`
    }`;
  el.querySelectorAll<HTMLButtonElement>('button[data-id]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.id!)));
  el.querySelector('[data-action="close-results"]')!.addEventListener('click', onClose);
}
