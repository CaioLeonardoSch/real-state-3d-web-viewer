// "Quero agendar uma visita" in the contact forms (map panel and client site): the visitor picks a day (tomorrow to
// 14 days ahead; the server accepts up to 30) and, optionally, a period. The broker confirms the time.
import { escapeHtml } from '../utils/format';

export type VisitPeriod = 'manha' | 'tarde' | 'noite';

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const PERIODS: [VisitPeriod | '', string][] = [
  ['', 'Tanto faz'],
  ['manha', 'Manhã'],
  ['tarde', 'Tarde'],
  ['noite', 'Noite'],
];

/** Today in Brasília time (America/Sao_Paulo, as the server checks it) as YYYY-MM-DD, whatever the visitor's clock zone. */
export function todayInBrazil(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}

/** The days offered: from tomorrow, `count` days, as { value: "2026-10-25", label: "sáb, 25/10" }. */
export function visitDays(today: string, count = 14): { value: string; label: string }[] {
  const [y, m, d] = today.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.UTC(y, m - 1, d + 1 + i));
    const value = day.toISOString().slice(0, 10);
    return { value, label: `${WEEKDAYS[day.getUTCDay()]}, ${value.slice(8, 10)}/${value.slice(5, 7)}` };
  });
}

/** The checkbox and the two selects (hidden until checked). `field`: the label class of the form (a-field or fld). */
export function visitFieldsHtml(field: string, check: string, today = todayInBrazil()): string {
  return `<label class="${check} visit-toggle"><input type="checkbox" name="visit"> <span>Quero agendar uma visita</span></label>
    <div class="visit-fields" hidden>
      <label class="${field}"><span>Dia</span><select name="visit_on">${visitDays(today)
        .map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`)
        .join('')}</select></label>
      <label class="${field}"><span>Período</span><select name="visit_period">${PERIODS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
      <p class="visit-note">A imobiliária confirma o horário com você.</p>
    </div>`;
}

/** Shows the selects while the box is checked; `onChange` gets whether a visit is asked (e.g. to relabel the button). */
export function wireVisitFields(form: HTMLFormElement, onChange?: (visit: boolean) => void): void {
  const box = form.querySelector<HTMLInputElement>('input[name="visit"]');
  const fields = form.querySelector<HTMLElement>('.visit-fields');
  if (!box || !fields) return;
  const sync = () => {
    fields.hidden = !box.checked;
    onChange?.(box.checked);
  };
  box.addEventListener('change', sync);
  form.addEventListener('reset', () => setTimeout(sync, 0));
}

/** The visit asked in the form, or nothing when the box is unchecked. */
export function readVisit(form: HTMLFormElement): { visitOn?: string; visitPeriod?: VisitPeriod } {
  const fd = new FormData(form);
  if (!fd.get('visit')) return {};
  const on = String(fd.get('visit_on') ?? '');
  const period = String(fd.get('visit_period') ?? '');
  return { visitOn: on || undefined, visitPeriod: (period || undefined) as VisitPeriod | undefined };
}
