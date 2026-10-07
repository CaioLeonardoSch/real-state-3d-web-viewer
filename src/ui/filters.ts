import type { Agency, ListingType } from '../data/types';
import { LISTING_TYPES, TYPE_LABELS } from '../data/types';
import { EMPTY_CRITERIA, type FilterCriteria, type FilterStore } from '../state/filters';
import { escapeHtml, parseNumberInput } from '../utils/format';

/**
 * Renders the filter form. Editing a field only updates the store's *pending* criteria;
 * the map changes exclusively when the user presses "Buscar" (form submit) or "Limpar".
 */
export function mountFilters(form: HTMLFormElement, store: FilterStore, agencies: Agency[]): void {
  form.innerHTML = `
    <fieldset class="f-types">
      <legend>Tipo</legend>
      ${LISTING_TYPES.map(
        (t) => `<label class="chip"><input type="checkbox" name="type" value="${t}"><span>${TYPE_LABELS[t]}</span></label>`,
      ).join('')}
    </fieldset>
    <label class="f-field">Preço mín. (R$)<input name="priceMin" inputmode="numeric" placeholder="0"></label>
    <label class="f-field">Preço máx. (R$)<input name="priceMax" inputmode="numeric" placeholder="sem limite"></label>
    <label class="f-field">Quartos mín.
      <select name="bedroomsMin">
        <option value="">Qualquer</option>
        ${[1, 2, 3, 4].map((n) => `<option value="${n}">${n}+</option>`).join('')}
      </select>
    </label>
    <label class="f-field">Área mín. (m²)<input name="areaMin" inputmode="numeric" placeholder="0"></label>
    <label class="f-field">Imobiliária
      <select name="agency">
        <option value="">Todas</option>
        ${agencies.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('')}
      </select>
    </label>
    <div class="f-actions">
      <button type="submit" class="btn-primary">Buscar</button>
      <button type="button" class="btn-secondary" data-action="clear">Limpar</button>
      <span class="f-pending" hidden>Alterações não aplicadas</span>
    </div>
  `;

  const pendingHint = form.querySelector<HTMLElement>('.f-pending')!;
  const readForm = (): FilterCriteria => {
    const fd = new FormData(form);
    const bedrooms = String(fd.get('bedroomsMin') ?? '');
    const agency = String(fd.get('agency') ?? '');
    return {
      types: fd.getAll('type').map(String) as ListingType[],
      priceMin: parseNumberInput(String(fd.get('priceMin') ?? '')),
      priceMax: parseNumberInput(String(fd.get('priceMax') ?? '')),
      bedroomsMin: bedrooms === '' ? null : Number(bedrooms),
      areaMin: parseNumberInput(String(fd.get('areaMin') ?? '')),
      agency: agency === '' ? null : agency,
    };
  };
  const writeForm = (c: FilterCriteria) => {
    form.querySelectorAll<HTMLInputElement>('input[name="type"]').forEach((el) => (el.checked = c.types.includes(el.value as ListingType)));
    (form.elements.namedItem('priceMin') as HTMLInputElement).value = c.priceMin?.toString() ?? '';
    (form.elements.namedItem('priceMax') as HTMLInputElement).value = c.priceMax?.toString() ?? '';
    (form.elements.namedItem('bedroomsMin') as HTMLSelectElement).value = c.bedroomsMin?.toString() ?? '';
    (form.elements.namedItem('areaMin') as HTMLInputElement).value = c.areaMin?.toString() ?? '';
    (form.elements.namedItem('agency') as HTMLSelectElement).value = c.agency ?? '';
  };
  const refreshHint = () => {
    pendingHint.hidden = JSON.stringify(store.getPending()) === JSON.stringify(store.getApplied());
  };

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
    refreshHint();
  });
  form.querySelector('[data-action="clear"]')!.addEventListener('click', () => {
    writeForm(EMPTY_CRITERIA);
    store.clear();
    refreshHint();
  });
}
