import type { IControl } from 'maplibre-gl';

/** Map button that flies back to the initial overview (all listings, default pitch and bearing). */
export class OverviewControl implements IControl {
  private container: HTMLElement | null = null;

  constructor(private onClick: () => void) {}

  onAdd(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    div.innerHTML = `<button type="button" class="overview-btn" title="Visão geral do bairro" aria-label="Voltar à visão geral do bairro">
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/>
        <rect x="7" y="7" width="6" height="6" rx="1"/>
      </svg>
    </button>`;
    div.querySelector('button')!.addEventListener('click', this.onClick);
    this.container = div;
    return div;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
  }
}
