import type { TimeOfDay } from '../map/lighting';

const OPTIONS: [TimeOfDay, string][] = [
  ['morning', 'Manhã'],
  ['afternoon', 'Tarde'],
  ['night', 'Noite'],
];

export function mountTimeOfDay(el: HTMLElement, initial: TimeOfDay, onChange: (t: TimeOfDay) => void): void {
  el.innerHTML = OPTIONS.map(
    ([v, label]) =>
      `<button type="button" role="radio" data-tod="${v}" aria-checked="${v === initial}">${label}</button>`,
  ).join('');
  el.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      onChange(b.dataset.tod as TimeOfDay);
    }),
  );
}
