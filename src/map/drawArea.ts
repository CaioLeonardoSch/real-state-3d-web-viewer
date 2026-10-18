import type { IControl } from 'maplibre-gl';
import { AREA_MAX_POINTS } from '../state/filters';

type Ring = [number, number][];
/** polygon-clipping's union (loaded with the drawing, like the neighbourhood cut). */
type Union = (...polys: [number, number][][][]) => [number, number][][][];

/** Map button that starts drawing the search area. */
export class DrawAreaControl implements IControl {
  private container: HTMLElement | null = null;

  constructor(private onClick: () => void) {}

  onAdd(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    div.innerHTML = `<button type="button" class="draw-area-btn" title="Desenhar a área da busca" aria-label="Desenhar a área da busca no mapa">
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 6l6-3 6 4-2 9-9-2z" stroke-dasharray="3 2"/>
        <circle cx="4" cy="6" r="1.4" fill="currentColor"/><circle cx="10" cy="3" r="1.4" fill="currentColor"/><circle cx="16" cy="7" r="1.4" fill="currentColor"/>
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

/**
 * The ring grown by `m` metres (what the map shows around a drawn area, like the 100 m around a neighbourhood):
 * the union of the polygon, a circle on each corner and a band along each side. Metres on a local flat projection,
 * enough for a city.
 */
export function growRing(ring: Ring, m: number, union: Union): [number, number][][][] {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  const dx = m / kx;
  const dy = m / ky;
  const close = (r: Ring): Ring => [...r, r[0]];
  const parts: [number, number][][][] = [[close(ring)]];
  const N = 16;
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i];
    parts.push([close(Array.from({ length: N }, (_, k): [number, number] => [x + dx * Math.cos((2 * Math.PI * k) / N), y + dy * Math.sin((2 * Math.PI * k) / N)]))]);
    const [x2, y2] = ring[(i + 1) % ring.length];
    // the side's normal, in metres
    const ex = (x2 - x) * kx;
    const ey = (y2 - y) * ky;
    const len = Math.hypot(ex, ey);
    if (!len) continue;
    const nx = (-ey / len) * dx;
    const ny = (ex / len) * dy;
    parts.push([close([[x + nx, y + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x - nx, y - ny]])]);
  }
  return union(...parts);
}

/** What the drawing needs from the map (Scene). */
export interface DrawSurface {
  startDrawing(onPoint: (p: [number, number], screen: { x: number; y: number }) => void): void;
  stopDrawing(): void;
  showDrawing(points: Ring): void;
  project(p: [number, number]): { x: number; y: number };
  /** The corners of the part of the map on screen. */
  visibleRing(): Ring;
}

export interface AreaDrawerHandlers {
  /** The finished area (3 or more corners). */
  onDone: (ring: Ring) => void;
  /** Left without an area (Cancelar, Esc). */
  onCancel: () => void;
  announce: (msg: string) => void;
}

/** A click this close (px) to the first corner closes the area. */
const CLOSE_PX = 14;

/**
 * "Desenhar área": a bar over the map (like the chosen street's card) while the user clicks the corners of the
 * search area. Clicking the first corner again or "Concluir" closes it; "Usar a área visível" takes what is on
 * screen (the way to do it without a mouse); Esc or × leaves.
 */
export class AreaDrawer {
  private readonly el: HTMLElement;
  private points: Ring = [];
  private active = false;

  constructor(
    parent: HTMLElement,
    private surface: DrawSurface,
    private handlers: AreaDrawerHandlers,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'street-card area-card';
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Desenhar área da busca');
    this.el.tabIndex = -1;
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="street-card-text">
        <p class="street-card-name">Desenhe a área da busca</p>
        <p class="street-card-place area-card-hint"></p>
      </div>
      <button type="button" class="btn-secondary" data-action="undo">Desfazer ponto</button>
      <button type="button" class="btn-secondary" data-action="visible">Usar a área visível</button>
      <button type="button" class="btn-primary" data-action="done">Concluir</button>
      <button type="button" class="icon-btn street-card-close" data-action="cancel" aria-label="Cancelar o desenho">×</button>`;
    parent.append(this.el);
    this.el.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'undo') this.undo();
      if (action === 'visible') this.finish(this.surface.visibleRing());
      if (action === 'done') this.finish(this.points);
      if (action === 'cancel') this.cancel();
    });
    document.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.cancel();
      } else if (e.key === 'Backspace' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.undo();
      }
      // capture: before the panels that close with Esc
    }, true);
  }

  get drawing(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.points = [];
    this.el.hidden = false;
    document.body.classList.add('street-card-open', 'drawing-area');
    this.refresh();
    this.surface.startDrawing((p, screen) => this.add(p, screen));
    this.el.focus();
    this.handlers.announce('Desenho da área: clique no mapa para marcar os cantos, ou use a área visível.');
  }

  private add(p: [number, number], screen: { x: number; y: number }) {
    if (!this.active) return;
    if (this.points.length >= 3) {
      const first = this.surface.project(this.points[0]);
      if (Math.hypot(first.x - screen.x, first.y - screen.y) <= CLOSE_PX) return this.finish(this.points);
    }
    if (this.points.length >= AREA_MAX_POINTS) return this.handlers.announce(`No máximo ${AREA_MAX_POINTS} pontos. Clique em Concluir.`);
    this.points.push(p);
    this.refresh();
  }

  private undo() {
    if (!this.points.length) return;
    this.points.pop();
    this.refresh();
    this.handlers.announce(`Ponto desfeito. ${this.countText()}.`);
  }

  private countText() {
    const n = this.points.length;
    return n === 1 ? '1 ponto marcado' : `${n} pontos marcados`;
  }

  private refresh() {
    const n = this.points.length;
    this.el.querySelector('.area-card-hint')!.textContent =
      n < 3 ? `Clique no mapa para marcar os cantos (${this.countText()}; faltam ${3 - n}).` : `${this.countText()}. Clique no primeiro ponto ou em Concluir para fechar.`;
    this.el.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = n === 0;
    this.el.querySelector<HTMLButtonElement>('[data-action="done"]')!.disabled = n < 3;
    // the card's height can change with the text (bar at the bottom on small screens)
    document.body.style.setProperty('--street-card-h', `${this.el.offsetHeight}px`);
    this.surface.showDrawing(this.points);
  }

  private stop() {
    this.active = false;
    this.points = [];
    this.el.hidden = true;
    this.surface.stopDrawing();
    this.surface.showDrawing([]);
    document.body.classList.remove('street-card-open', 'drawing-area');
    document.body.style.removeProperty('--street-card-h');
  }

  private finish(ring: Ring) {
    if (ring.length < 3) return;
    const done = ring.map(([x, y]): [number, number] => [x, y]);
    this.stop();
    this.handlers.onDone(done);
  }

  cancel(): void {
    if (!this.active) return;
    this.stop();
    this.handlers.onCancel();
  }
}
