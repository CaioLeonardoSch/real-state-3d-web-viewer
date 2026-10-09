import type { Agency, Amenity, ListingStatus, ListingType } from '../data/types';
import { AMENITIES, AMENITY_LABELS, LISTING_STATUSES, LISTING_TYPES, STATUS_LABELS, TYPE_LABELS } from '../data/types';
import { ADVANCED_FIELDS, EMPTY_CRITERIA, countActive, type FilterCriteria, type FilterStore } from '../state/filters';
import { sameCriteria } from '../state/url';
import { escapeHtml, parseNumberInput } from '../utils/format';

/** Free-typed numeric fields: [criteria field, label, placeholder]. */
const NUMBER_INPUTS = {
  priceMin: ['Preço mín. (R$)', '0'],
  priceMax: ['Preço máx. (R$)', 'sem limite'],
  areaMin: ['Área mín. (m²)', '0'],
  areaMax: ['Área máx. (m²)', 'sem limite'],
  pricePerM2Max: ['R$/m² máx.', 'sem limite'],
} as const;
type NumberInput = keyof typeof NUMBER_INPUTS;

/** "N+" selects: [criteria field, label, options]. */
const MIN_SELECTS = {
  bedroomsMin: ['Quartos mín.', [1, 2, 3, 4]],
  bathroomsMin: ['Banheiros mín.', [1, 2, 3]],
  parkingMin: ['Vagas mín.', [1, 2, 3]],
} as const;
type MinSelect = keyof typeof MIN_SELECTS;

const numberInput = (name: NumberInput) =>
  `<label class="f-field">${NUMBER_INPUTS[name][0]}<input name="${name}" inputmode="numeric" placeholder="${NUMBER_INPUTS[name][1]}"></label>`;
const minSelect = (name: MinSelect) => `<label class="f-field">${MIN_SELECTS[name][0]}
  <select name="${name}">
    <option value="">Qualquer</option>
    ${MIN_SELECTS[name][1].map((n) => `<option value="${n}">${n}+</option>`).join('')}
  </select>
</label>`;
const chips = (name: string, legend: string, values: readonly string[], labels: Record<string, string>) => `
  <fieldset class="f-chips f-${name}">
    <legend>${legend}</legend>
    ${values.map((v) => `<label class="chip"><input type="checkbox" name="${name}" value="${v}"><span>${labels[v]}</span></label>`).join('')}
  </fieldset>`;

/**
 * Renders the filter form. Editing a field only updates the store's *pending* criteria;
 * the map changes exclusively when the user presses "Buscar" (form submit) or "Limpar".
 * Less common criteria live in a collapsible "Mais filtros" section.
 */
export function mountFilters(
  form: HTMLFormElement,
  store: FilterStore,
  agencies: Agency[],
): { setForm: (c: FilterCriteria) => void } {
  form.innerHTML = `
    ${chips('type', 'Tipo', LISTING_TYPES, TYPE_LABELS)}
    ${numberInput('priceMin')}
    ${numberInput('priceMax')}
    ${minSelect('bedroomsMin')}
    ${numberInput('areaMin')}
    <div class="f-actions">
      <button type="button" class="btn-secondary f-more-toggle" aria-expanded="false" aria-controls="filters-more">Mais filtros</button>
      <button type="submit" class="btn-primary">Buscar</button>
      <button type="button" class="btn-secondary" data-action="clear">Limpar</button>
      <span class="f-pending" hidden>Alterações não aplicadas</span>
    </div>
    <div class="f-more" id="filters-more" hidden>
      ${minSelect('bathroomsMin')}
      ${minSelect('parkingMin')}
      ${numberInput('areaMax')}
      ${numberInput('pricePerM2Max')}
      <label class="f-field">Imobiliária
        <select name="agency">
          <option value="">Todas</option>
          ${agencies.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('')}
        </select>
      </label>
      ${chips('status', 'Situação', LISTING_STATUSES, STATUS_LABELS)}
      ${chips('reducedOnly', 'Ofertas', ['1'], { 1: 'Preço reduzido' })}
      ${chips('feature', 'Comodidades (todas as marcadas)', AMENITIES, AMENITY_LABELS)}
    </div>
  `;

  const pendingHint = form.querySelector<HTMLElement>('.f-pending')!;
  const more = form.querySelector<HTMLElement>('.f-more')!;
  const moreToggle = form.querySelector<HTMLButtonElement>('.f-more-toggle')!;
  const field = <T extends HTMLElement>(name: string) => form.elements.namedItem(name) as unknown as T & { value: string };

  const readForm = (): FilterCriteria => {
    const fd = new FormData(form);
    const str = (k: string) => String(fd.get(k) ?? '');
    const int = (k: string) => (str(k) === '' ? null : Number(str(k)));
    const agency = str('agency');
    return {
      types: fd.getAll('type').map(String) as ListingType[],
      priceMin: parseNumberInput(str('priceMin')),
      priceMax: parseNumberInput(str('priceMax')),
      bedroomsMin: int('bedroomsMin'),
      bathroomsMin: int('bathroomsMin'),
      parkingMin: int('parkingMin'),
      areaMin: parseNumberInput(str('areaMin')),
      areaMax: parseNumberInput(str('areaMax')),
      pricePerM2Max: parseNumberInput(str('pricePerM2Max')),
      statuses: fd.getAll('status').map(String) as ListingStatus[],
      features: fd.getAll('feature').map(String) as Amenity[],
      agency: agency === '' ? null : agency,
      reducedOnly: fd.get('reducedOnly') ? true : null,
    };
  };
  const writeForm = (c: FilterCriteria) => {
    const check = (name: string, values: readonly string[]) =>
      form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((el) => (el.checked = values.includes(el.value)));
    check('type', c.types);
    check('status', c.statuses);
    check('feature', c.features);
    check('reducedOnly', c.reducedOnly ? ['1'] : []);
    for (const k of [...Object.keys(NUMBER_INPUTS), ...Object.keys(MIN_SELECTS)] as (NumberInput | MinSelect)[])
      field<HTMLInputElement>(k).value = c[k]?.toString() ?? '';
    field<HTMLSelectElement>('agency').value = c.agency ?? '';
  };
  const setMoreOpen = (open: boolean) => {
    more.hidden = !open;
    moreToggle.setAttribute('aria-expanded', String(open));
  };
  const refreshHint = () => {
    pendingHint.hidden = sameCriteria(store.getPending(), store.getApplied());
    const n = countActive(store.getPending(), ADVANCED_FIELDS);
    moreToggle.textContent = n ? `Mais filtros (${n})` : 'Mais filtros';
  };

  moreToggle.addEventListener('click', () => setMoreOpen(moreToggle.getAttribute('aria-expanded') !== 'true'));
  // criteria can also be applied from outside the form (suggestions, shared links)
  store.onApply(refreshHint);

  // Field changes → pending state only
  const onEdit = () => {
    store.setPending(readForm());
    refreshHint();
  };
  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    store.setPending(readForm());
    store.apply();
    setMoreOpen(false);
    refreshHint();
  });
  form.querySelector('[data-action="clear"]')!.addEventListener('click', () => {
    writeForm(EMPTY_CRITERIA);
    store.clear();
    refreshHint();
  });

  /** Shows criteria that were applied from outside the form (e.g. a shared link). */
  return {
    setForm: (c: FilterCriteria) => {
      writeForm(c);
      refreshHint();
    },
  };
}
