import type { RulerSeason, TimeOfDay } from '../map/lighting';

const OPTIONS: [TimeOfDay, string][] = [
  ['morning', 'Manhã'],
  ['afternoon', 'Tarde'],
  ['night', 'Noite'],
];
const SEASONS: [RulerSeason, string][] = [
  ['summer', 'Verão (21/12)'],
  ['equinox', 'Outono e primavera (20/03)'],
  ['winter', 'Inverno (21/06)'],
];
/** Range of the hour ruler, in minutes after midnight. */
export const RULER_MIN = 5 * 60 + 30;
export const RULER_MAX = 19 * 60 + 30;
const RULER_STEP = 15;

const clock = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;

/**
 * Morning / afternoon / night buttons, and next to them the hour-and-season ruler: dragging the hour moves the sun
 * and the building shadows. `onRuler` gets the season and minutes after midnight; a button goes back to its fixed time.
 */
export function mountTimeOfDay(
  el: HTMLElement,
  initial: TimeOfDay,
  onChange: (t: TimeOfDay) => void,
  onRuler?: (season: RulerSeason, minutes: number) => TimeOfDay,
): void {
  el.innerHTML = OPTIONS.map(
    ([v, label]) =>
      `<button type="button" role="radio" data-tod="${v}" aria-checked="${v === initial}">${label}</button>`,
  ).join('');
  const radios = [...el.querySelectorAll<HTMLButtonElement>('button')];
  // a radio group is one tab stop (the checked button, or the first when none is) and the arrows move inside it
  const check = (t: TimeOfDay | null) => {
    radios.forEach((x) => x.setAttribute('aria-checked', String(x.dataset.tod === t)));
    const stop = radios.find((x) => x.dataset.tod === t) ?? radios[0];
    radios.forEach((x) => (x.tabIndex = x === stop ? 0 : -1));
  };
  check(initial);
  radios.forEach((b) =>
    b.addEventListener('click', () => {
      check(b.dataset.tod as TimeOfDay);
      onChange(b.dataset.tod as TimeOfDay);
    }),
  );
  el.addEventListener('keydown', (e) => {
    const i = radios.indexOf(e.target as HTMLButtonElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? radios.length - 1 : step && i >= 0 ? (i + step + radios.length) % radios.length : -1;
    if (i < 0 || next < 0) return;
    e.preventDefault();
    radios[next].focus();
    radios[next].click();
  });
  if (!onRuler) return;
  const ruler = document.createElement('div');
  ruler.className = 'sun-ruler';
  ruler.innerHTML = `<button type="button" class="sun-ruler-toggle" aria-expanded="false" aria-controls="sun-ruler-panel">Hora e época</button>
    <div id="sun-ruler-panel" class="sun-ruler-panel" hidden>
      <label>Hora <output data-clock>9h00</output>
        <input type="range" data-hour min="${RULER_MIN}" max="${RULER_MAX}" step="${RULER_STEP}" value="${9 * 60}">
      </label>
      <label>Época
        <select data-season>${SEASONS.map(([v, l]) => `<option value="${v}"${v === 'equinox' ? ' selected' : ''}>${l}</option>`).join('')}</select>
      </label>
      <p class="sun-ruler-note">Arraste a hora e veja a sombra dos prédios andar.</p>
    </div>`;
  // the buttons and the ruler side by side, in the map's top-left corner
  const row = document.createElement('div');
  row.className = 'lighting';
  el.before(row);
  row.append(el, ruler);
  const toggle = ruler.querySelector<HTMLButtonElement>('.sun-ruler-toggle')!;
  const panel = ruler.querySelector<HTMLElement>('.sun-ruler-panel')!;
  const hour = ruler.querySelector<HTMLInputElement>('[data-hour]')!;
  const season = ruler.querySelector<HTMLSelectElement>('[data-season]')!;
  const out = ruler.querySelector<HTMLOutputElement>('[data-clock]')!;
  // dragging fires many inputs: the map is relit at most once per frame
  let frame = 0;
  const apply = () => {
    const m = Number(hour.value);
    out.textContent = clock(m);
    hour.setAttribute('aria-valuetext', clock(m));
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => check(onRuler(season.value as RulerSeason, m)));
  };
  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) apply();
  });
  hour.addEventListener('input', apply);
  ruler.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || panel.hidden) return;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  });
  season.addEventListener('change', apply);
}
