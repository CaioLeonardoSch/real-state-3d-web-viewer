// One-line navigation hint on the first visit: it goes away at the first move of the map (or on "Entendi") and does
// not come back on this browser.
import type { Map as MlMap } from 'maplibre-gl';

const KEY = 'mapa3d-dica-vista';

export function mountMapHint(stage: HTMLElement, map: MlMap): void {
  try {
    if (localStorage.getItem(KEY)) return;
  } catch {
    return; // no storage (private mode, blocked): better no hint than one on every visit
  }
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
  const events = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const;
  const done = (e?: { originalEvent?: Event }) => {
    // only the visitor's own moves: the opening flight and "Ver no mapa" move the camera too
    if (e && !e.originalEvent) return;
    for (const t of events) map.off(t, done);
    el.remove();
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* the hint shows again next time */
    }
  };
  for (const t of events) map.on(t, done);
  el.querySelector('button')!.addEventListener('click', () => done());
}
