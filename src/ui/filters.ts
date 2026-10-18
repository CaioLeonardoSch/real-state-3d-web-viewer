import type { Agency, Amenity, ListingStatus, ListingType } from '../data/types';
import { AMENITIES, AMENITY_LABELS, LISTING_STATUSES, LISTING_TYPES, MAIN_LISTING_TYPES, STATUS_LABELS, TYPE_LABELS } from '../data/types';
import { ADVANCED_FIELDS, EMPTY_CRITERIA, countActive, normalizeName, type FilterCriteria, type FilterStore } from '../state/filters';
import { sameCriteria } from '../state/url';
import { StreetFinder, findBairros, type StreetEntry } from '../data/streets';
import { escapeHtml, parseNumberInput } from '../utils/format';
import { NEAR_M, SERVICE_LABELS, type ServiceKind } from '../data/services';

/** Kinds offered in the "até 500 m de…" filter (bakeries are the worst mapped in OSM: left out). */
const NEAR_FILTER_KINDS: ServiceKind[] = ['school', 'market', 'pharmacy', 'health', 'park'];

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

/** Streets offered by the "Bairro ou rua" box. */
export interface StreetSearch {
  /** The list of streets; asked for when the box is first used, again after a failure. */
  load: () => Promise<StreetEntry[]>;
  /** A street was chosen: the map goes there (no criteria change). `finder` holds the whole list. */
  onStreet: (street: StreetEntry, finder: StreetFinder) => void;
}

const MAX_BAIRROS = 6;
const MAX_STREETS = 8;
/** Streets are searched from this many characters typed (one letter matches thousands). */
const STREET_MIN_CHARS = 2;

/**
 * Renders the filter form. Editing a field only updates the store's *pending* criteria;
 * the map changes exclusively when the user presses "Buscar" (form submit) or "Limpar".
 * Less common criteria live in a collapsible "Mais filtros" section.
 * The "Bairro ou rua" box suggests neighbourhoods (added to the search as chips) and streets (chosen = the map
 * goes there, see StreetSearch); `applyStreet` searches the listings on a street, like "Buscar".
 */
export function mountFilters(
  form: HTMLFormElement,
  store: FilterStore,
  agencies: Agency[],
  bairros: readonly string[] = [],
  streets: StreetSearch | null = null,
): { setForm: (c: FilterCriteria) => void; applyStreet: (name: string) => void } {
  form.innerHTML = `
    <fieldset class="f-chips f-deal">
      <legend class="sr-only">Negócio</legend>
      <div class="segmented">
        <label><input type="radio" name="transaction" value="" checked><span>Comprar</span></label>
        <label><input type="radio" name="transaction" value="rent"><span>Alugar</span></label>
      </div>
    </fieldset>
    ${chips('type', 'Tipo', MAIN_LISTING_TYPES, TYPE_LABELS)}
    <div class="f-field f-bairro">
      <label for="f-bairro-input">${streets ? 'Bairro ou rua' : 'Bairro'}</label>
      <div class="f-bairro-box">
        <span class="f-bairro-chips"></span>
        <span class="f-street-chips"></span>
        <input id="f-bairro-input" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="f-place-list"
          placeholder="${bairros.length ? 'Todos' : ''}" autocomplete="off" spellcheck="false">
      </div>
      <div id="f-place-list" class="f-place-list" role="listbox" aria-label="Sugestões" hidden></div>
      <div class="sr-only f-place-status" role="status"></div>
    </div>
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
      ${chips('type', 'Outros tipos', LISTING_TYPES.filter((t) => !MAIN_LISTING_TYPES.includes(t)), TYPE_LABELS)}
      ${chips('status', 'Situação', LISTING_STATUSES, STATUS_LABELS)}
      ${chips('reducedOnly', 'Ofertas', ['1'], { 1: 'Preço reduzido' })}
      ${chips('feature', 'Comodidades (todas as marcadas)', AMENITIES, AMENITY_LABELS)}
      ${chips('near', `Até ${NEAR_M} m de (em linha reta; dados do OpenStreetMap)`, NEAR_FILTER_KINDS, SERVICE_LABELS)}
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
      transaction: fd.get('transaction') === 'rent' ? 'rent' : null,
      types: fd.getAll('type').map(String) as ListingType[],
      bairros: fd.getAll('bairro').map(String),
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
      near: fd.getAll('near').map(String) as ServiceKind[],
      street: str('street').trim() || null,
    };
  };
  const writeForm = (c: FilterCriteria) => {
    const check = (name: string, values: readonly string[]) =>
      form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((el) => (el.checked = values.includes(el.value)));
    check('transaction', [c.transaction ?? '']);
    check('type', c.types);
    check('status', c.statuses);
    check('feature', c.features);
    check('reducedOnly', c.reducedOnly ? ['1'] : []);
    check('near', c.near);
    for (const k of [...Object.keys(NUMBER_INPUTS), ...Object.keys(MIN_SELECTS)] as (NumberInput | MinSelect)[])
      field<HTMLInputElement>(k).value = c[k]?.toString() ?? '';
    field<HTMLSelectElement>('agency').value = c.agency ?? '';
    renderBairros(c.bairros);
    renderStreet(c.street);
  };
  // ---------------------------------------------------------------- "Bairro ou rua" (WAI-ARIA 1.2 combobox)
  // Neighbourhoods chosen in it are removable chips (hidden inputs named "bairro"); the searched street, a chip
  // after them (hidden input "street"). List autocomplete with manual selection: typing only suggests, an
  // option is taken with Enter or a click, and Enter without a highlighted option keeps submitting the form.
  const placeInput = form.querySelector<HTMLInputElement>('#f-bairro-input')!;
  const placeList = form.querySelector<HTMLElement>('#f-place-list')!;
  const placeStatus = form.querySelector<HTMLElement>('.f-place-status')!;
  const bairroChips = form.querySelector<HTMLElement>('.f-bairro-chips')!;
  const streetChips = form.querySelector<HTMLElement>('.f-street-chips')!;
  const chosenBairros = () => [...form.querySelectorAll<HTMLInputElement>('input[name="bairro"]')].map((i) => i.value);
  const chosenStreet = () => form.querySelector<HTMLInputElement>('input[name="street"]')?.value ?? null;
  const setPlaceholder = () =>
    (placeInput.placeholder = chosenBairros().length || chosenStreet() ? '+ bairro' : bairros.length ? 'Todos' : '');
  const renderBairros = (list: readonly string[]) => {
    bairroChips.innerHTML = list
      .map(
        (b) => `<span class="f-bairro-chip">${escapeHtml(b)}<input type="hidden" name="bairro" value="${escapeHtml(b)}">
          <button type="button" data-remove-bairro="${escapeHtml(b)}" aria-label="Tirar o bairro ${escapeHtml(b)}">×</button></span>`,
      )
      .join('');
    setPlaceholder();
  };
  const renderStreet = (name: string | null) => {
    streetChips.innerHTML = name
      ? `<span class="f-street-chip"><span title="${escapeHtml(name)}">${escapeHtml(name)}</span><input type="hidden" name="street" value="${escapeHtml(name)}">
          <button type="button" data-remove-street aria-label="Tirar a busca por ${escapeHtml(name)}">×</button></span>`
      : '';
    setPlaceholder();
  };
  /** Chips changed: pending criteria only, like any other field. */
  const chipsEdited = () => {
    store.setPending(readForm());
    refreshHint();
  };
  const addBairro = (name: string) => {
    const current = chosenBairros();
    if (!current.includes(name)) renderBairros([...current, name]);
    chipsEdited();
  };
  const removeLastChip = () => {
    const street = chosenStreet();
    const current = chosenBairros();
    const gone = street ?? current.at(-1);
    if (!gone) return;
    if (street) renderStreet(null);
    else renderBairros(current.slice(0, -1));
    chipsEdited();
    say(`${gone} retirado da busca.`, 0);
  };
  bairroChips.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-remove-bairro]');
    if (!btn) return;
    renderBairros(chosenBairros().filter((b) => b !== btn.dataset.removeBairro));
    chipsEdited();
    placeInput.focus();
  });
  streetChips.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-remove-street]')) return;
    renderStreet(null);
    chipsEdited();
    placeInput.focus();
  });

  // the list of streets: loaded on first use of the box, the neighbourhood suggestions work meanwhile
  let finder: StreetFinder | null = null;
  let streetsState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  const loadStreets = () => {
    if (!streets || streetsState === 'loading' || streetsState === 'ready') return;
    streetsState = 'loading';
    streets.load().then(
      (list) => {
        finder = new StreetFinder(list);
        streetsState = 'ready';
        if (!placeList.hidden) suggest(true);
      },
      (err: Error) => {
        streetsState = 'failed';
        console.warn(`Lista de ruas indisponível: ${err.message}`);
        if (!placeList.hidden) suggest(true);
      },
    );
  };

  /** Options shown, by index (the id of option i is f-place-o<i>); disabled notes are not in it. */
  let shown: ({ bairro: string } | { street: StreetEntry })[] = [];
  let active = -1;
  let statusTimer = 0;
  /** Screen-reader status next to the box; counts wait for typing to pause. */
  const say = (text: string, delay = 600) => {
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => (placeStatus.textContent = text), delay);
  };
  const placeOf = (s: StreetEntry) => (s.bairro ? `${s.bairro}, ${s.city}` : s.city);
  const option = (i: number, name: string, sub: string) =>
    `<div role="option" id="f-place-o${i}" class="f-place-opt" aria-selected="false" data-i="${i}"><span class="f-place-name">${escapeHtml(name)}</span><span class="sr-only">, </span><span class="f-place-sub">${escapeHtml(sub)}</span></div>`;
  const note = (text: string) => `<div role="option" class="f-place-opt f-place-note" aria-disabled="true" aria-selected="false">${escapeHtml(text)}</div>`;
  const group = (id: string, label: string, body: string) =>
    `<div role="group" aria-labelledby="f-place-${id}"><div role="presentation" id="f-place-${id}" class="f-place-head">${escapeHtml(label)}</div>${body}</div>`;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const setOpen = (open: boolean) => {
    placeList.hidden = !open;
    placeInput.setAttribute('aria-expanded', String(open));
    if (!open) setActive(-1);
  };
  const setActive = (i: number) => {
    placeList.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    active = i;
    const opt = i >= 0 ? placeList.querySelector<HTMLElement>(`#f-place-o${i}`) : null;
    if (!opt) return placeInput.removeAttribute('aria-activedescendant');
    opt.setAttribute('aria-selected', 'true');
    placeInput.setAttribute('aria-activedescendant', opt.id);
    // keep it in view inside the list (scrollIntoView could scroll the page too); a group's first option
    // brings its heading along
    const head = opt.previousElementSibling?.classList.contains('f-place-head') ? (opt.previousElementSibling as HTMLElement) : opt;
    if (head.offsetTop < placeList.scrollTop) placeList.scrollTop = head.offsetTop;
    else if (opt.offsetTop + opt.offsetHeight > placeList.scrollTop + placeList.clientHeight)
      placeList.scrollTop = opt.offsetTop + opt.offsetHeight - placeList.clientHeight;
  };
  /**
   * Fills the list for the text typed (empty: every neighbourhood not chosen yet). `keep` keeps the highlighted
   * option (the streets arrived while the user was choosing).
   */
  const suggest = (keep = false) => {
    const typed = placeInput.value.trim();
    const chosen = chosenBairros();
    const free = bairros.filter((b) => !chosen.includes(b));
    const bs = typed ? findBairros(free, typed, MAX_BAIRROS) : free;
    // with a neighbourhood search applied the rest of the map is cut away: only streets inside it
    const cut = store.getApplied().bairros;
    let ss: StreetEntry[] = [];
    let wait = '';
    if (streets && typed.length >= STREET_MIN_CHARS) {
      if (finder) ss = finder.find(typed, MAX_STREETS, cut);
      else wait = streetsState === 'failed' ? 'Lista de ruas indisponível' : 'Carregando ruas…';
    }
    shown = [...bs.map((bairro) => ({ bairro })), ...ss.map((street) => ({ street }))];
    let html = '';
    if (bs.length) html += group('gb', 'Bairros', bs.map((b, i) => option(i, b, 'adicionar à busca')).join(''));
    if (ss.length || wait)
      html += group(
        'gr',
        cut.length ? 'Ruas nos bairros escolhidos' : 'Ruas',
        ss.map((s, j) => option(bs.length + j, s.name, `${placeOf(s)} · ir para a rua`)).join('') + (wait ? note(wait) : ''),
      );
    const searched = !!finder && typed.length >= STREET_MIN_CHARS;
    const none = cut.length ? 'Nenhum bairro ou rua com esse nome nos bairros escolhidos' : 'Nenhum bairro ou rua com esse nome';
    if (!html && searched) html = note(none);
    const keepActive = keep && active >= 0 && active < shown.length ? active : -1;
    placeList.innerHTML = html;
    placeList.scrollTop = 0;
    setOpen(!!html);
    setActive(keepActive);
    const found = [bs.length && count(bs.length, 'bairro', 'bairros'), ss.length && count(ss.length, 'rua', 'ruas')].filter(Boolean).join(' e ');
    say(html ? [found, wait].filter(Boolean).join('. ') || none : '');
  };
  const move = (step: number) => {
    const n = shown.length;
    if (n) setActive(active < 0 ? (step > 0 ? 0 : n - 1) : (active + step + n) % n);
  };
  const choose = (i: number) => {
    const picked = shown[i];
    if (!picked) return;
    placeInput.value = '';
    setOpen(false);
    if ('bairro' in picked) {
      addBairro(picked.bairro);
      say(`${picked.bairro} adicionado à busca.`, 0);
    } else if (streets && finder) {
      say('', 0);
      streets.onStreet(picked.street, finder);
    }
  };

  placeInput.addEventListener('focus', loadStreets);
  placeInput.addEventListener('input', () => {
    // typing without a focus first (autofill, tests); after a failure only the next focus tries again, not each key
    if (streetsState === 'idle') loadStreets();
    if (placeInput.value.trim()) suggest();
    else {
      setOpen(false);
      say('', 0);
    }
  });
  placeInput.addEventListener('blur', () => setOpen(false));
  placeInput.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const open = !placeList.hidden;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // Alt+↓ only opens the list, Alt+↑ closes it
      if (e.altKey) {
        if (e.key === 'ArrowUp') setOpen(false);
        else if (!open) suggest();
        return;
      }
      if (!open) suggest();
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      if (open && active >= 0) {
        e.preventDefault();
        return choose(active);
      }
      setOpen(false);
      // a neighbourhood typed in full is taken; anything else submits the form ("Buscar")
      const exact = bairros.find((b) => normalizeName(b) === normalizeName(placeInput.value));
      if (!exact) return;
      e.preventDefault();
      placeInput.value = '';
      addBairro(exact);
    } else if (e.key === 'Escape') {
      // first the list, then the text; with neither, Escape is left to the panels
      if (!open && !placeInput.value) return;
      e.preventDefault();
      e.stopPropagation();
      if (open) setOpen(false);
      else placeInput.value = '';
      say('', 0);
    } else if (e.key === 'Tab') setOpen(false);
    else if (e.key === 'Backspace' && !placeInput.value) removeLastChip();
  });
  // Options are clicked without taking the focus from the box. The list can be rebuilt between the press and the
  // release (the streets arrive): the browser then sends no click, as the option pressed is gone, so the release
  // takes the option pressed, found again by what it is rather than by its place in the list.
  let pressed: { item: (typeof shown)[number]; el: HTMLElement } | null = null;
  const sameOption = (a: (typeof shown)[number], b: (typeof shown)[number]) =>
    'bairro' in a ? 'bairro' in b && a.bairro === b.bairro : 'street' in b && a.street === b.street;
  const optionEl = (target: EventTarget | null) => {
    const opt = (target as HTMLElement | null)?.closest<HTMLElement>('[data-i]');
    return opt && placeList.contains(opt) ? opt : null;
  };
  const chooseItem = (item: (typeof shown)[number]) => {
    const i = shown.findIndex((o) => sameOption(o, item));
    if (i >= 0) choose(i);
  };
  placeList.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const el = optionEl(e.target);
    const item = el ? shown[Number(el.dataset.i)] : undefined;
    pressed = el && item ? { item, el } : null;
  });
  placeList.addEventListener('mouseup', () => {
    if (!pressed || pressed.el.isConnected) return;
    const { item } = pressed;
    pressed = null;
    chooseItem(item);
  });
  placeList.addEventListener('click', (e) => {
    pressed = null;
    const el = optionEl(e.target);
    if (el) choose(Number(el.dataset.i));
  });
  const setMoreOpen = (open: boolean) => {
    more.hidden = !open;
    moreToggle.setAttribute('aria-expanded', String(open));
  };
  const refreshHint = () => {
    pendingHint.hidden = sameCriteria(store.getPending(), store.getApplied());
    // a type of "Outros tipos" (inside the panel) counts like the other filters there
    const n = countActive(store.getPending(), ADVANCED_FIELDS) + (store.getPending().types.some((t) => !MAIN_LISTING_TYPES.includes(t)) ? 1 : 0);
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

  return {
    /** Shows criteria that were applied from outside the form (e.g. a shared link). */
    setForm: (c: FilterCriteria) => {
      writeForm(c);
      refreshHint();
    },
    /** Searches the listings on a street ("Imóveis nesta rua"), keeping the form's other edits, like "Buscar". */
    applyStreet: (name: string) => {
      const next = { ...readForm(), street: name };
      writeForm(next);
      store.setPending(next);
      store.apply();
      setMoreOpen(false);
      refreshHint();
    },
  };
}
