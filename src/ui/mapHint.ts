// One-line navigation hint on the first visit: it goes away at the first move of the map (or on "Entendi") and does
// not come back on this browser.
import type { Map as MlMap } from 'maplibre-gl';

const KEY = 'mapa3d-dica-vista';

const dismiss = (el: HTMLElement) => {
  el.remove();
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* the hint shows again next time */
  }
};

/**
 * Puts the hint on screen. The page shell calls it at its first paint (src/boot.ts), before the map's code arrives:
 * the hint is the largest text of a first visit, and adding it with the map held the page's largest paint until then
 * (phone, slow 4G: 3.9 s). Returns the hint, or null when this browser has seen it.
 */
export function showMapHint(stage: HTMLElement): HTMLElement | null {
  try {
    if (localStorage.getItem(KEY)) return null;
  } catch {
    return null; // no storage (private mode, blocked): better no hint than one on every visit
  }
  const shown = stage.querySelector<HTMLElement>('.map-hint');
  if (shown) return shown;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const el = document.createElement('div');
  el.className = 'map-hint';
  el.setAttribute('role', 'note');
  el.innerHTML = `<span>${
    touch
      ? 'Um dedo move o mapa; dois dedos giram, inclinam e dão zoom.'
      : 'Arraste para mover, use a roda do mouse para o zoom e o botão direito (ou Ctrl + arrastar) para girar e inclinar.'
  }</span><button type="button" class="link-btn">Entendi</button>`;
  stage.append(el);
  el.querySelector('button')!.addEventListener('click', () => dismiss(el));
  return el;
}

/** Shows the hint if the shell did not, and takes it away at the visitor's first move of the map. */
export function mountMapHint(stage: HTMLElement, map: MlMap): void {
  const el = showMapHint(stage);
  if (!el?.isConnected) return;
  const events = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const;
  const done = (e?: { originalEvent?: Event }) => {
    // only the visitor's own moves: the opening flight and "Ver no mapa" move the camera too
    if (e && !e.originalEvent) return;
    for (const t of events) map.off(t, done);
    dismiss(el);
  };
  for (const t of events) map.on(t, done);
  el.querySelector('button')!.addEventListener('click', () => done());
}
