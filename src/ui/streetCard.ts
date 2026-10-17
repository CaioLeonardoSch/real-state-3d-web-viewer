import type { StreetEntry } from '../data/streets';
import { escapeHtml } from '../utils/format';

/** What the card shows about the chosen street. */
export interface StreetCardInfo {
  street: StreetEntry;
  /** Listings whose public address is on a street of this name, with the form's other criteria. */
  count: number;
  /**
   * The name is also listed in another place: the same street crossing into the next neighbourhood, or another
   * street with the same name. The search matches by name, so it counts and finds those too.
   */
  elsewhere: boolean;
}

export interface StreetCardHandlers {
  /** "Imóveis nesta rua": search the listings on the street. */
  onSearch: (name: string) => void;
  /** Closed by the user (× or Escape). */
  onClose: () => void;
}

/**
 * Card of the street chosen in the "Bairro ou rua" box: where the map went and, when listings show that street in
 * their address, a button to search them. Top centre of the map; a bar at the bottom on small screens.
 */
export class StreetCard {
  private readonly el: HTMLElement;
  private street: StreetEntry | null = null;

  constructor(
    parent: HTMLElement,
    private handlers: StreetCardHandlers,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'street-card';
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Rua escolhida');
    this.el.tabIndex = -1;
    this.el.hidden = true;
    parent.append(this.el);
    this.el.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'search' && this.street) this.handlers.onSearch(this.street.name);
      if (action === 'close') this.close();
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      // the card only: panels listening on the document stay as they are
      e.stopPropagation();
      this.close();
    });
  }

  /** The street shown, or null when the card is hidden. */
  get current(): StreetEntry | null {
    return this.street;
  }

  show({ street, count, elsewhere }: StreetCardInfo): void {
    this.street = street;
    const place = street.bairro ? `${street.bairro}, ${street.city}` : street.city;
    this.el.innerHTML = `
      <div class="street-card-text">
        <p class="street-card-name">${escapeHtml(street.name)}</p>
        <p class="street-card-place">${escapeHtml(place)}</p>
        ${count && elsewhere ? '<p class="street-card-note">O nome também aparece em outros bairros; a busca inclui todos os trechos.</p>' : ''}
      </div>
      ${
        count
          ? `<button type="button" class="btn-primary street-card-search" data-action="search">Imóveis nesta rua (${count})</button>`
          : '<p class="street-card-empty">Nenhum anúncio mostra esta rua no endereço.</p>'
      }
      <button type="button" class="icon-btn street-card-close" data-action="close" aria-label="Fechar">×</button>`;
    this.el.hidden = false;
    document.body.classList.add('street-card-open');
    // lets the map controls step above the bar on small screens
    document.body.style.setProperty('--street-card-h', `${this.el.offsetHeight}px`);
  }

  /** Hides the card (a search was applied, or another street chosen). */
  hide(): void {
    if (!this.street) return;
    this.street = null;
    this.el.hidden = true;
    this.el.innerHTML = '';
    document.body.classList.remove('street-card-open');
    document.body.style.removeProperty('--street-card-h');
  }

  /** Height of the card on screen (0 when hidden), to keep the map's subject clear of the bar on small screens. */
  get height(): number {
    return this.el.hidden ? 0 : this.el.offsetHeight;
  }

  /** Whether focus is inside the card (it is lost when the card hides). */
  get hasFocus(): boolean {
    return this.el.contains(document.activeElement);
  }

  /** Puts focus on the card (small screens: the box it came from is gone with the filters panel). */
  focus(): void {
    if (this.street) this.el.focus();
  }

  private close(): void {
    this.hide();
    this.handlers.onClose();
  }
}
