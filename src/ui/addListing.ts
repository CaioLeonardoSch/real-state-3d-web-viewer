import type { MultiPolygon, Polygon } from 'geojson';
import turfCentroid from '@turf/centroid';
import {
  ADDRESS_DISPLAYS,
  ADDRESS_DISPLAY_LABELS,
  AMENITIES,
  AMENITY_LABELS,
  AVAILABILITIES,
  AVAILABILITY_LABELS,
  HIGHLIGHTS,
  HIGHLIGHT_LABELS,
  LISTING_STATUSES,
  LISTING_TYPES,
  RENT_GUARANTEES,
  RENT_GUARANTEE_LABELS,
  STATUS_LABELS,
  TRANSACTIONS,
  TRANSACTION_LABELS,
  TYPE_LABELS,
  USAGES,
  USAGE_LABELS,
  type Address,
  type AddressDisplay,
  type Agency,
  type Amenity,
  type Availability,
  type Highlight,
  type Listing,
  type ListingStatus,
  type ListingType,
  hasBedrooms,
  inBuilding,
  isCommercialType,
  onOwnLot,
  type Photo,
  type RentGuarantee,
  type Transaction,
  type Usage,
} from '../data/types';
import { formatCep, safeUrl, today } from '../data/listingText';
import { makeThumb, photoVersions, resizeImage } from '../utils/images';
import type { PickResult, Scene } from '../map/scene';
import { MAX_FLOORS, MAX_UNITS_PER_FLOOR, floorBand, unitNumber, unitStrip, validLayout, type BuildingLayout } from '../map/unitLayout';
import { APPROX_RADIUS_M, approxCenterFor, lotRectangle, lotSize, type PlacementChecker } from '../utils/placement';
import { escapeHtml, formatArea, parseNumberInput } from '../utils/format';
import { REGION } from '../config/region';
import { exclusivityDocProblem } from '../backend/mapping';

const METERS_PER_FLOOR = 3;
const TYPE_SLUG: Record<ListingType, string> = {
  apartment: 'apto',
  house: 'casa',
  semi_detached: 'geminado',
  land: 'terreno',
  penthouse: 'cobertura',
  studio: 'studio',
  farm: 'chacara',
  office: 'sala',
  store: 'loja',
  warehouse: 'galpao',
};
/** Start of the automatic title ("Apartamento 2 quartos", "Galpão de 800 m²"). */
const TITLE_KIND: Record<ListingType, string> = {
  apartment: 'Apartamento',
  house: 'Casa',
  semi_detached: 'Geminado',
  land: 'Terreno',
  penthouse: 'Cobertura',
  studio: 'Studio',
  farm: 'Chácara',
  office: 'Sala comercial',
  store: 'Loja',
  warehouse: 'Galpão',
};
/** data-for="…" with the types a field applies to. */
const forTypes = (test: (t: ListingType) => boolean) => `data-for="${LISTING_TYPES.filter(test).join(' ')}"`;

export interface AddListingDeps {
  agencies: Agency[];
  scene: Scene;
  checker: PlacementChecker;
  /** Listings already in this OSM building (several only when each is a unit). */
  listingsOnBuilding: (osmId: string) => Listing[];
  /** Floors × units per floor already given for this building (by an earlier listing), if any. */
  buildingLayout: (osmId: string) => Promise<BuildingLayout | null>;
  /** Keeps the layout for the building's next listings. */
  saveBuildingLayout: (osmId: string, layout: BuildingLayout) => void;
  /** Lots of the other land listings (a new lot must not overlap them); `exceptId`: the listing being edited. */
  otherLots: (exceptId?: string) => (Polygon | MultiPolygon)[];
  newId: (slug: string) => string;
  /** Neighbourhood containing a point (fills the address). */
  bairroAt: (lngLat: [number, number]) => string | null;
  /** Saves the new listing (`center`: exact point of the place); resolves to an error message, or null on success. */
  onSave: (l: Listing, center: [number, number], exclusivityDoc?: File) => Promise<string | null>;
  /** Saves an edited listing (same id); resolves to an error message, or null on success. */
  onUpdate: (l: Listing, center: [number, number], exclusivityDoc?: File) => Promise<string | null>;
  /** With the back end: name of the client the listing is saved for (replaces the agency choice). */
  remoteOrgName?: () => string | null;
  onExport: () => void;
  userCount: () => number;
  onClose: () => void;
}

/** Place chosen on the map for the new listing. */
type Place =
  | { kind: 'building'; osmId: string; center: [number, number]; geometry: Polygon | MultiPolygon; height: number }
  | { kind: 'land'; center: [number, number]; lot: Polygon; front: number; depth: number };

/**
 * "Anunciar imóvel": a form plus a map pick (a grey residential building, or free ground for a lot).
 * The new listing is validated with the same rules as listings.json and kept in this browser.
 */
export class AddListingPanel {
  private place: Place | null = null;
  private isOpen = false;
  /** Listing being edited (null: a new one). */
  private editing: Listing | null = null;

  constructor(
    private el: HTMLElement,
    private deps: AddListingDeps,
  ) {
    document.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.key !== 'Escape') return;
      if (this.deps.scene.isPicking) this.cancelPick();
      else this.close();
    });
  }

  get opened() {
    return this.isOpen;
  }

  open(): void {
    this.isOpen = true;
    this.editing = null;
    this.place = null;
    this.render();
    this.el.hidden = false;
    document.body.classList.add('add-open');
    this.el.querySelector<HTMLElement>('select[name="type"]')?.focus();
  }

  /** Opens the form filled with one of the user's listings; saving keeps its id, history and dates. */
  openEdit(l: Listing): void {
    this.isOpen = true;
    this.editing = l;
    this.place = null;
    this.render();
    this.fill(l);
    this.el.hidden = false;
    document.body.classList.add('add-open');
    this.el.querySelector<HTMLElement>('input[name="title"]')?.focus();
  }

  get editingId(): string | null {
    return this.isOpen ? (this.editing?.id ?? null) : null;
  }

  /** Puts a listing's values in the form (edit mode). */
  private fill(l: Listing): void {
    const f = this.form;
    const set = (name: string, v: string | number | undefined | null) => {
      const el = f.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      if (el && v !== undefined && v !== null) el.value = String(v);
    };
    const check = (name: string, values: readonly string[]) =>
      f.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((el) => (el.checked = values.includes(el.value)));
    const tx = l.transaction ?? 'sale';
    set('transaction', tx);
    set('price', tx === 'rent' ? undefined : l.price);
    set('rentPrice', l.rentPrice ?? (tx === 'rent' ? l.price : undefined));
    set('condoFee', l.condoFee);
    set('iptu', l.iptu?.value);
    set('iptuPeriod', l.iptu?.period);
    check('feature', l.features);
    check('guarantee', l.rentGuarantees ?? []);
    set('type', l.type);
    set('usage', l.usage);
    set('title', l.title);
    set('areaM2', l.areaM2);
    set('totalAreaM2', l.totalAreaM2);
    if (l.type !== 'land') set('landAreaM2', l.landAreaM2);
    for (const k of ['bedrooms', 'suites', 'bathrooms', 'parkingSpots', 'coveredParking', 'unitFloor', 'floors', 'unitsPerFloor', 'unitPosition', 'towers', 'yearBuilt'] as const)
      set(k, l[k]);
    set('status', l.status);
    set('floorsBuilt', l.construction?.floorsBuilt);
    set('constructionMonth', l.construction?.updatedAt);
    this.refreshObra();
    set('description', l.description);
    for (const k of ['cep', 'street', 'number', 'complement', 'bairro', 'city'] as const) set(k, l.address?.[k] ?? (k === 'city' ? '' : undefined));
    set('addressDisplay', l.addressDisplay ?? (l.approximateLocation ? 'neighborhood' : 'full'));
    set('videoUrl', l.videoUrl);
    set('tourUrl', l.tourUrl);
    set('agency', l.agency);
    for (const k of ['creci', 'contactName', 'whatsapp', 'phone', 'email'] as const) set(k, l.advertiser?.[k]);
    set('referenceCode', l.referenceCode);
    (f.elements.namedItem('exclusive') as HTMLInputElement).checked = !!l.exclusive;
    this.el.querySelector<HTMLElement>('[data-exclusive]')!.hidden = !l.exclusive;
    if (l.moderation) {
      const notice = document.createElement('p');
      notice.className = l.moderation.status === 'rejected' ? 'a-error' : 'a-hint';
      notice.setAttribute('role', 'status');
      notice.textContent =
        l.moderation.status === 'rejected'
          ? `O suporte recusou este anúncio${l.moderation.note ? `: ${l.moderation.note}` : ''}. Corrija e salve: ele volta para a análise.`
          : 'Este anúncio aguarda a aprovação do suporte; só aparece no público depois.';
      f.prepend(notice);
    }
    const review = l.exclusivityReview;
    if (review) {
      const box = this.el.querySelector<HTMLElement>('[data-exclusive-status]')!;
      box.hidden = false;
      box.textContent =
        review.status === 'verified'
          ? 'Exclusividade conferida pelo suporte. Enviar outro documento faz uma nova conferência.'
          : review.status === 'refused'
            ? `O suporte recusou o documento${review.note ? `: ${review.note}` : ''}. Envie outro para nova conferência.`
            : 'Documento enviado. Aguardando a conferência do suporte; o selo aparece depois.';
    }
    set('availability', l.availability);
    set('highlight', l.highlight);
    const draft = f.elements.namedItem('draft') as HTMLInputElement | null;
    if (draft) draft.checked = !!l.draft;
    this.photos = (l.photos ?? []).map((p) => ({ ...p }));
    this.floorPlan = l.floorPlanImage ?? null;
    this.renderPhotos();
    this.renderPlanStatus();
    this.onTypeChange();
    this.onTransactionChange();
    // the place the listing already has
    const centroid = (g: Polygon | MultiPolygon) =>
      turfCentroid({ type: 'Feature', properties: {}, geometry: g }).geometry.coordinates as [number, number];
    if (l.type === 'land' && l.lotPolygon) {
      const { front, depth } = lotSize(l.areaM2);
      this.lastLandCenter = centroid(l.lotPolygon);
      this.setPlace({ kind: 'land', center: this.lastLandCenter, lot: l.lotPolygon, front, depth });
    } else if (l.footprint && l.buildingOsmId) {
      this.setPlace({ kind: 'building', osmId: l.buildingOsmId, center: centroid(l.footprint), geometry: l.footprint, height: l.buildingHeightM ?? 6 });
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.deps.scene.stopPicking();
    this.deps.scene.setPickPreview(null);
    this.deps.scene.setPickUnit(null);
    this.el.hidden = true;
    this.el.classList.remove('picking');
    document.body.classList.remove('add-open');
    this.deps.onClose();
  }

  // ------------------------------------------------------------------ form

  private photos: Photo[] = [];
  private floorPlan: string | null = null;

  private render(): void {
    const { agencies } = this.deps;
    const remoteOrg = this.deps.remoteOrgName?.() ?? null;
    this.photos = [];
    this.floorPlan = null;
    const options = <T extends string>(values: readonly T[], labels: Record<T, string>, selected?: T) =>
      values.map((v) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${labels[v]}</option>`).join('');
    const chips = (name: string, values: readonly string[], labels: Record<string, string>) =>
      values.map((v) => `<label class="chip"><input type="checkbox" name="${name}" value="${v}"><span>${labels[v]}</span></label>`).join('');
    const field = (label: string, input: string, attrs = '') => `<label class="a-field" ${attrs}>${label}${input}</label>`;
    const num = (name: string, placeholder = '') => `<input name="${name}" inputmode="numeric" placeholder="${placeholder}">`;
    const count = (name: string, value: number) => `<input name="${name}" type="number" min="0" max="10" value="${value}">`;
    const buildingOnly = forTypes((t) => t !== 'land');
    const homeOnly = forTypes(hasBedrooms);
    const unitOnly = forTypes(inBuilding);
    this.el.innerHTML = `
      <div class="add-head">
        <h2 id="add-title">${this.editing ? 'Editar anúncio' : 'Anunciar imóvel'}</h2>
        <button type="button" class="icon-btn" data-action="close" aria-label="Fechar formulário">×</button>
      </div>
      ${
        this.editing
          ? '<p class="muted small">As mudanças valem ao salvar. Para mudar o local, use "Trocar local". Campos com * são obrigatórios.</p>'
          : remoteOrg
          ? '<p class="muted small">Ao salvar, o anúncio é publicado para todos. Campos com * são obrigatórios.</p>'
          : `<p class="muted small">O anúncio fica salvo só neste navegador. Para publicar para todos, exporte o JSON e rode
        <code>npm run listings:add</code> (veja o README). Campos com * são obrigatórios.</p>`
      }
      <form class="add-form" novalidate>
        <fieldset class="a-section">
          <legend>Negócio</legend>
          ${field('Tipo de negócio', `<select name="transaction">${options(TRANSACTIONS, TRANSACTION_LABELS, 'sale')}</select>`)}
          ${field('Preço de venda (R$) *', num('price'), 'data-tx="sale both"')}
          ${field('Aluguel mensal (R$) *', num('rentPrice'), 'data-tx="rent both"')}
          ${field('Condomínio (R$/mês)', num('condoFee', 'se houver'))}
          <div class="a-field a-pair">IPTU (R$)
            <span>${num('iptu', 'opcional')}<select name="iptuPeriod" aria-label="Período do IPTU"><option value="year">por ano</option><option value="month">por mês</option></select></span>
          </div>
          <fieldset class="f-chips a-wide" data-tx="sale both"><legend>Condições de venda</legend>${chips('feature', ['financing', 'exchange'], AMENITY_LABELS)}</fieldset>
          <fieldset class="f-chips a-wide" data-tx="rent both"><legend>Garantias aceitas na locação</legend>${chips('guarantee', RENT_GUARANTEES, RENT_GUARANTEE_LABELS)}</fieldset>
        </fieldset>

        <fieldset class="a-section">
          <legend>Imóvel</legend>
          ${field('Tipo', `<select name="type">${options(LISTING_TYPES, TYPE_LABELS, 'apartment')}</select>`)}
          ${field('Finalidade', `<select name="usage">${options(USAGES, USAGE_LABELS, 'residential')}</select>`)}
          <div class="a-place">
            <span class="a-label">Local no mapa *</span>
            <p class="a-place-status" aria-live="polite"></p>
            <button type="button" class="btn-secondary" data-action="pick">Escolher no mapa</button>
          </div>
          <label class="a-field a-wide">Título<input name="title" maxlength="80" placeholder="ex.: Apartamento com sacada 2 quartos"></label>
          ${field('<span data-area-label>Área útil (m²) *</span>', num('areaM2'))}
          ${field('Área total (m²)', num('totalAreaM2', 'opcional'), buildingOnly)}
          ${field('Área do terreno (m²)', num('landAreaM2', 'opcional'), forTypes(onOwnLot))}
          ${field('Quartos', count('bedrooms', 2), homeOnly)}
          ${field('Suítes', count('suites', 0), homeOnly)}
          ${field('Banheiros', count('bathrooms', 1), buildingOnly)}
          ${field('Vagas', count('parkingSpots', 1), buildingOnly)}
          ${field('Vagas cobertas', count('coveredParking', 0), buildingOnly)}
          ${field('Andar da unidade', num('unitFloor', 'ex.: 7'), unitOnly)}
          ${field('Andares do edifício', num('floors', 'opcional'), unitOnly)}
          ${field('Unidades por andar', num('unitsPerFloor', 'opcional'), unitOnly)}
          <div class="a-units a-wide" ${unitOnly}>
            <input type="hidden" name="unitPosition">
            <p class="a-hint a-units-hint" aria-live="polite"></p>
            <div class="a-unit-grid" role="group" aria-label="Unidades do prédio, do último andar ao primeiro"></div>
          </div>
          ${field('Torres', num('towers', '1'), unitOnly)}
          ${field('Ano de construção', num('yearBuilt', 'ou de entrega'), buildingOnly)}
          ${field('Obra', `<select name="status">${options(LISTING_STATUSES, STATUS_LABELS)}</select>`, buildingOnly)}
          ${field('Andares já construídos', num('floorsBuilt', 'ex.: 6'), 'data-obra hidden')}
          ${field('Andamento informado em', `<input name="constructionMonth" type="month">`, 'data-obra hidden')}
          <p class="a-hint a-wide" data-obra hidden>Atualize todo mês: no mapa, os andares já construídos aparecem sólidos e o
            restante do prédio translúcido, com uma grua. O visitante vê a data da informação.</p>
          <fieldset class="f-chips a-wide">
            <legend>Comodidades</legend>
            ${chips('feature', AMENITIES.filter((a) => a !== 'financing' && a !== 'exchange'), AMENITY_LABELS)}
          </fieldset>
          <label class="a-field a-wide">Descrição<textarea name="description" rows="3" maxlength="1500" placeholder="opcional"></textarea></label>
        </fieldset>

        <fieldset class="a-section">
          <legend>Endereço</legend>
          ${field('CEP', `<input name="cep" inputmode="numeric" maxlength="9" placeholder="00000-000">`)}
          <p class="a-cep-status muted small" aria-live="polite"></p>
          <label class="a-field a-wide">Rua<input name="street" maxlength="120"></label>
          ${field('Número', `<input name="number" maxlength="12">`)}
          ${field('Complemento', `<input name="complement" maxlength="40" placeholder="apto, bloco…">`)}
          ${field('Bairro *', `<input name="bairro" maxlength="60" placeholder="preenchido pelo mapa">`)}
          ${field('Cidade', `<input name="city" maxlength="60" value="${escapeHtml(REGION.city)}">`)}
          <label class="a-field a-wide">Mostrar ao público<select name="addressDisplay">${options(ADDRESS_DISPLAYS, ADDRESS_DISPLAY_LABELS, 'street')}</select>
            <span class="a-hint">Sem o endereço completo, o mapa mostra um raio de ${APPROX_RADIUS_M} m em vez do prédio.</span></label>
        </fieldset>

        <fieldset class="a-section">
          <legend>Fotos e mídia</legend>
          <label class="a-field a-wide">Fotos (a marcada como capa aparece primeiro)
            <input name="photos" type="file" accept="image/*" multiple></label>
          <ul class="a-photos a-wide" aria-label="Fotos escolhidas"></ul>
          <label class="a-field a-wide">Planta (imagem)<input name="floorPlan" type="file" accept="image/*"></label>
          <p class="a-plan a-wide" hidden><span></span> <button type="button" class="link-btn" data-action="remove-plan">Remover planta</button></p>
          <label class="a-field a-wide">Vídeo (link do YouTube ou Vimeo)<input name="videoUrl" type="url" placeholder="https://"></label>
          <label class="a-field a-wide">Tour 360° (link)<input name="tourUrl" type="url" placeholder="https://"></label>
        </fieldset>

        <fieldset class="a-section">
          <legend>Anunciante</legend>
          ${
            remoteOrg
              ? `<p class="a-field a-wide">Imobiliária<strong>${escapeHtml(remoteOrg)}</strong></p>`
              : `<label class="a-field a-wide">Imobiliária<select name="agency">${agencies
                  .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`)
                  .join('')}</select></label>`
          }
          ${field('CRECI *', `<input name="creci" maxlength="20" placeholder="ex.: 12345-J">`)}
          ${field('Código de referência', `<input name="referenceCode" maxlength="30" placeholder="seu código interno">`)}
          ${field('Nome do contato', `<input name="contactName" maxlength="60">`)}
          ${field('WhatsApp *', `<input name="whatsapp" type="tel" maxlength="20" placeholder="(47) 99999-0000">`)}
          ${field('Telefone', `<input name="phone" type="tel" maxlength="20">`)}
          ${field('E-mail', `<input name="email" type="email" maxlength="80">`)}
          <label class="a-check a-wide"><input type="checkbox" name="exclusive"> Tenho autorização de venda com exclusividade</label>
          <label class="a-field a-wide" data-exclusive hidden>Documento de autorização (PDF, JPG ou PNG, até 10 MB; o selo “Exclusivo” aparece depois da conferência do suporte)
            <input name="exclusivityDoc" type="file" accept="application/pdf,image/jpeg,image/png"></label>
          <p class="a-hint a-wide" data-exclusive-status role="status" hidden></p>
        </fieldset>

        <fieldset class="a-section">
          <legend>Publicação</legend>
          ${field('Situação do anúncio', `<select name="availability">${options(AVAILABILITIES, AVAILABILITY_LABELS, 'active')}</select>`)}
          ${field('Tipo de destaque', `<select name="highlight">${options(HIGHLIGHTS, HIGHLIGHT_LABELS, 'standard')}</select>`)}
          ${remoteOrg ? '<label class="a-check a-wide"><input type="checkbox" name="draft"> Salvar como rascunho (só a equipe vê)</label>' : ''}
          <p class="a-hint a-wide">Datas de publicação e de atualização são registradas automaticamente. O preço reduzido aparece
            quando você baixa o preço de um anúncio já publicado (no painel do imóvel); o histórico de preços fica registrado.</p>
        </fieldset>

        <p class="a-error a-wide" role="alert" hidden></p>
        <div class="a-actions a-wide">
          <button type="submit" class="btn-primary">${this.editing ? 'Salvar alterações' : 'Salvar anúncio'}</button>
          <button type="button" class="btn-secondary" data-action="close">Cancelar</button>
        </div>
      </form>
      <div class="a-mine"></div>
      <div class="a-picking" hidden>
        <p class="a-picking-hint"></p>
        <button type="button" class="btn-secondary" data-action="cancel-pick">Cancelar escolha</button>
      </div>`;
    const form = this.form;
    const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
    this.el.querySelectorAll('[data-action="close"]').forEach((b) => b.addEventListener('click', () => this.close()));
    this.el.querySelector('[data-action="pick"]')!.addEventListener('click', () => this.startPick());
    this.el.querySelector('[data-action="cancel-pick"]')!.addEventListener('click', () => this.cancelPick());
    input('type').addEventListener('change', () => {
      // offices, stores and warehouses are commercial; a change back to a home goes back to residential
      (form.elements.namedItem('usage') as HTMLSelectElement).value = isCommercialType(this.type) ? 'commercial' : 'residential';
      this.onTypeChange();
    });
    input('transaction').addEventListener('change', () => this.onTransactionChange());
    input('areaM2').addEventListener('change', () => this.onAreaChange());
    input('floors').addEventListener('input', () => this.refreshUnits());
    input('unitsPerFloor').addEventListener('input', () => this.refreshUnits());
    input('unitFloor').addEventListener('input', () => this.refreshUnits());
    this.el.querySelector('.a-unit-grid')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-floor]');
      if (!b || b.disabled) return;
      input('unitFloor').value = b.dataset.floor!;
      input('unitPosition').value = b.dataset.pos!;
      this.refreshUnits();
      this.el.querySelector<HTMLButtonElement>(`.a-unit-grid button[data-floor="${b.dataset.floor}"][data-pos="${b.dataset.pos}"]`)?.focus();
    });
    (form.elements.namedItem('status') as HTMLSelectElement).addEventListener('change', () => this.refreshObra());
    input('cep').addEventListener('input', () => this.onCepInput());
    input('photos').addEventListener('change', () => void this.addPhotos());
    input('floorPlan').addEventListener('change', () => void this.setFloorPlan());
    this.el.querySelector('[data-action="remove-plan"]')!.addEventListener('click', () => {
      this.floorPlan = null;
      this.renderPlanStatus();
    });
    input('exclusive').addEventListener('change', () => {
      this.el.querySelector<HTMLElement>('[data-exclusive]')!.hidden = !input('exclusive').checked;
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
    this.onTypeChange();
    this.onTransactionChange();
    this.renderPhotos();
    this.renderMine();
  }

  private onTransactionChange(): void {
    const tx = this.value('transaction');
    this.form.querySelectorAll<HTMLElement>('[data-tx]').forEach((el) => {
      el.hidden = !el.dataset.tx!.split(' ').includes(tx);
    });
  }

  // ------------------------------------------------------------------ address

  private cepRequest = 0;

  /** CEP → street, neighbourhood and city from ViaCEP (public service); fills only empty fields. */
  private onCepInput(): void {
    const el = this.form.elements.namedItem('cep') as HTMLInputElement;
    el.value = formatCep(el.value);
    const digits = el.value.replace(/\D/g, '');
    const status = this.el.querySelector('.a-cep-status')!;
    if (digits.length !== 8) return void (status.textContent = '');
    const req = ++this.cepRequest;
    status.textContent = 'Buscando o CEP…';
    fetch(`https://viacep.com.br/ws/${digits}/json/`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string }) => {
        if (req !== this.cepRequest) return;
        if (d.erro) return void (status.textContent = 'CEP não encontrado. Preencha o endereço à mão.');
        const fill = (name: string, v?: string) => {
          const f = this.form.elements.namedItem(name) as HTMLInputElement;
          if (v && (!f.value.trim() || (name === 'city' && f.value === REGION.city))) f.value = v;
        };
        fill('street', d.logradouro);
        fill('bairro', d.bairro);
        fill('city', d.localidade);
        status.textContent = `✓ ${[d.logradouro, d.bairro, d.localidade && `${d.localidade}/${d.uf}`].filter(Boolean).join(', ')}`;
      })
      .catch(() => {
        if (req === this.cepRequest) status.textContent = 'Não foi possível consultar o CEP agora. Preencha o endereço à mão.';
      });
  }

  // ------------------------------------------------------------------ media

  private async addPhotos(): Promise<void> {
    const input = this.form.elements.namedItem('photos') as HTMLInputElement;
    const files = [...(input.files ?? [])].filter((f) => f.type.startsWith('image/'));
    input.value = '';
    if (!files.length) return;
    this.showError(null);
    try {
      // with a back end the photos go to storage in three sizes; kept in this browser, two small ones
      const remote = !!this.deps.remoteOrgName?.();
      for (const f of files) this.photos.push(remote ? await photoVersions(f) : { src: await resizeImage(f), thumb: await makeThumb(f) });
    } catch {
      this.showError('Não foi possível ler uma das imagens. Use JPEG, PNG ou WebP.');
    }
    this.renderPhotos();
  }

  private async setFloorPlan(): Promise<void> {
    const file = (this.form.elements.namedItem('floorPlan') as HTMLInputElement).files?.[0];
    try {
      this.floorPlan = file ? await resizeImage(file, 1200, 0.8) : this.floorPlan;
    } catch {
      this.showError('Não foi possível ler a imagem da planta.');
    }
    this.renderPlanStatus();
  }

  /** "Planta enviada" with a remove button, when there is one (edit mode keeps the current plan). */
  private renderPlanStatus(): void {
    const el = this.el.querySelector<HTMLElement>('.a-plan')!;
    el.hidden = !this.floorPlan;
    el.querySelector('span')!.textContent = '✓ Planta enviada.';
  }

  /** Thumbnails with caption, cover choice and removal. The cover is kept first in `photos`. */
  private renderPhotos(): void {
    const list = this.el.querySelector<HTMLElement>('.a-photos')!;
    list.innerHTML =
      this.photos
        .map(
          (p, i) => `<li>
            <img src="${escapeHtml(p.thumb ?? p.src)}" alt="Foto ${i + 1}">
            <label class="a-cover"><input type="radio" name="cover" value="${i}" ${i === 0 ? 'checked' : ''}> Capa</label>
            <input class="a-caption" data-i="${i}" maxlength="80" placeholder="Legenda" value="${escapeHtml(p.caption ?? '')}" aria-label="Legenda da foto ${i + 1}">
            <button type="button" class="link-btn" data-remove="${i}" aria-label="Remover foto ${i + 1}">Remover</button>
          </li>`,
        )
        .join('') +
      (this.photos.length ? `<li class="a-photos-count">${this.photos.length} ${this.photos.length === 1 ? 'foto' : 'fotos'}</li>` : '');
    list.querySelectorAll<HTMLInputElement>('.a-caption').forEach((el) =>
      el.addEventListener('input', () => (this.photos[Number(el.dataset.i)].caption = el.value.trim() || undefined)),
    );
    list.querySelectorAll<HTMLInputElement>('input[name="cover"]').forEach((el) =>
      el.addEventListener('change', () => {
        const [cover] = this.photos.splice(Number(el.value), 1);
        this.photos.unshift(cover);
        this.renderPhotos();
      }),
    );
    list.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) =>
      b.addEventListener('click', () => {
        this.photos.splice(Number(b.dataset.remove), 1);
        this.renderPhotos();
      }),
    );
  }

  private get form(): HTMLFormElement {
    return this.el.querySelector<HTMLFormElement>('.add-form')!;
  }

  private value(name: string): string {
    const f = this.form.elements.namedItem(name) as HTMLInputElement | null;
    return f ? f.value.trim() : '';
  }

  private get type(): ListingType {
    return this.value('type') as ListingType;
  }

  /** "Andares já construídos" only for buildings under construction. */
  private refreshObra(): void {
    const show = this.type !== 'land' && this.value('status') === 'under_construction';
    this.form.querySelectorAll<HTMLElement>('[data-obra]').forEach((el) => (el.hidden = !show));
  }

  private onTypeChange(): void {
    const type = this.type;
    this.form.querySelectorAll<HTMLElement>('[data-for]').forEach((el) => {
      el.hidden = !el.dataset.for!.split(' ').includes(type);
    });
    this.refreshObra();
    this.el.querySelector('[data-area-label]')!.textContent = type === 'land' ? 'Área do lote (m²) *' : 'Área útil (m²) *';
    // a lot and a building are picked differently: switching between them asks for a new place
    if (this.place && (this.place.kind === 'land') !== (type === 'land')) this.setPlace(null);
    else this.refreshPreview();
    this.renderPlaceStatus();
  }

  private onAreaChange(): void {
    if (this.place?.kind !== 'land') return;
    // the lot keeps its centre and grows or shrinks with the area
    this.setPlace(null);
    this.tryLot(this.lastLandCenter!);
  }

  private lastLandCenter: [number, number] | null = null;

  // ------------------------------------------------------------------ choosing the place

  private startPick(): void {
    this.showError(null);
    const land = this.type === 'land';
    if (land && !this.lotArea()) return this.showError('Informe a área do lote antes de escolher o local.');
    this.el.classList.add('picking');
    this.el.querySelector<HTMLElement>('.a-picking')!.hidden = false;
    this.el.querySelector('.a-picking-hint')!.textContent = land
      ? 'Clique num espaço livre do mapa, sem prédios, ruas ou áreas verdes. O lote será desenhado no ponto clicado.'
      : 'Clique num prédio cinza do mapa (residencial e sem outro anúncio).';
    this.deps.scene.startPicking((p) => this.onPick(p));
  }

  private cancelPick(): void {
    this.deps.scene.stopPicking();
    this.endPickUi();
  }

  private endPickUi(): void {
    this.el.classList.remove('picking');
    this.el.querySelector<HTMLElement>('.a-picking')!.hidden = true;
    this.el.querySelector<HTMLElement>('[data-action="pick"]')?.focus();
  }

  private pickHint(msg: string): void {
    this.el.querySelector('.a-picking-hint')!.textContent = msg;
  }

  private onPick(p: PickResult): void {
    if (!this.deps.checker.insideBoundary(p.lngLat)) return this.pickHint('Esse ponto fica fora da região do mapa. Clique dentro do limite tracejado.');
    if (p.tooFar) return this.pickHint('Aproxime o mapa (os prédios ficam em 3D) e clique de novo.');
    if (this.type === 'land') {
      const problem = this.tryLot(p.lngLat);
      if (problem) return this.pickHint(problem);
    } else {
      if (!p.building) return this.pickHint('Aí não há prédio disponível. Clique num prédio cinza (os laranja já estão à venda).');
      // residential rule (scripts/lib/residential.mjs), computed when the tiles were built
      if (!p.building.residential)
        return this.pickHint('Esse prédio não é residencial no OpenStreetMap (ou tem nome próprio). Escolha outro.');
      // a building takes several listings only when each one is a unit (item 45)
      const taken = this.deps.listingsOnBuilding(p.building.osmId).find((l) => l.id !== this.editing?.id && !l.unitPosition);
      if (taken) return this.pickHint(`Esse prédio já tem um anúncio: "${taken.title}". Escolha outro.`);
      const { geometry, height, osmId } = p.building;
      const center = turfCentroid({ type: 'Feature', properties: {}, geometry }).geometry.coordinates as [number, number];
      this.setPlace({ kind: 'building', osmId, center, geometry, height });
    }
    this.deps.scene.stopPicking();
    this.endPickUi();
  }

  private lotArea(): number | null {
    const a = parseNumberInput(this.value('areaM2'));
    return a && a >= 50 && a <= 20000 ? a : null;
  }

  /** Places a lot centred on `center`; returns the problem when it does not fit. */
  private tryLot(center: [number, number]): string | null {
    this.lastLandCenter = center;
    const area = this.lotArea();
    if (!area) return 'Informe uma área de lote entre 50 e 20.000 m².';
    const { front, depth } = lotSize(area);
    const lot = lotRectangle(center, front, depth);
    const problem = this.deps.checker.lotProblem(lot, this.deps.otherLots(this.editing?.id));
    if (problem) {
      this.renderPlaceStatus(problem);
      return problem;
    }
    this.setPlace({ kind: 'land', center, lot, front, depth });
    return null;
  }

  private setPlace(place: Place | null): void {
    this.place = place;
    const bairro = this.form.elements.namedItem('bairro') as HTMLInputElement;
    if (place && !bairro.value.trim()) bairro.value = this.deps.bairroAt(place.center) ?? '';
    this.layoutNote = '';
    this.refreshUnits();
    this.renderPlaceStatus();
    if (place?.kind === 'building') void this.loadLayout(place.osmId);
  }

  /** What the form says about the building's layout (given by an earlier listing). */
  private layoutNote = '';

  /** Fills floors × units per floor with what an earlier listing of the building gave (empty fields only). */
  private async loadLayout(osmId: string): Promise<void> {
    const layout = await this.deps.buildingLayout(osmId).catch(() => null);
    if (!layout || this.place?.kind !== 'building' || this.place.osmId !== osmId) return;
    const set = (name: string, v: number) => {
      const el = this.form.elements.namedItem(name) as HTMLInputElement;
      if (!el.value.trim()) el.value = String(v);
    };
    set('floors', layout.floors);
    set('unitsPerFloor', layout.unitsPerFloor);
    this.layoutNote = `Este prédio já foi informado por outro anúncio: ${layout.floors} andares × ${layout.unitsPerFloor} unidades por andar.`;
    this.refreshUnits();
  }

  /** The layout typed in the form, when it is complete and valid. */
  private layout(): BuildingLayout | null {
    const l = { floors: parseNumberInput(this.value('floors')) ?? undefined, unitsPerFloor: parseNumberInput(this.value('unitsPerFloor')) ?? undefined };
    return validLayout(l) ? l : null;
  }

  /** The unit chosen on the grid: floor and position, when they fit the layout. */
  private chosenUnit(layout: BuildingLayout | null): { floor: number; position: number } | null {
    const floor = parseNumberInput(this.value('unitFloor'));
    const position = parseNumberInput(this.value('unitPosition'));
    if (!layout || floor === null || position === null || !Number.isInteger(floor) || floor < 0 || floor > layout.floors) return null;
    return Number.isInteger(position) && position >= 1 && position <= layout.unitsPerFloor ? { floor, position } : null;
  }

  /** Grid of the building's units ("Anunciar pela unidade"): floors top to bottom, units by their "final". */
  private refreshUnits(): void {
    const box = this.el.querySelector<HTMLElement>('.a-units');
    if (box) {
      const grid = box.querySelector<HTMLElement>('.a-unit-grid')!;
      const hint = box.querySelector<HTMLElement>('.a-units-hint')!;
      const layout = this.place?.kind === 'building' ? this.layout() : null;
      const chosen = this.chosenUnit(layout);
      if (!chosen) (this.form.elements.namedItem('unitPosition') as HTMLInputElement).value = '';
      if (this.place?.kind !== 'building') hint.textContent = 'Escolha o prédio no mapa para marcar a unidade nele.';
      else if (!layout)
        hint.textContent = `${this.layoutNote ? `${this.layoutNote} ` : ''}Informe os andares (1 a ${MAX_FLOORS}) e as unidades por andar (1 a ${MAX_UNITS_PER_FLOOR}) para escolher a unidade no prédio (opcional).`;
      else
        hint.textContent = `${this.layoutNote ? `${this.layoutNote} ` : ''}${
          chosen ? `Unidade ${unitNumber(chosen.floor, chosen.position)} marcada em azul no prédio.` : 'Clique na unidade anunciada: ela fica marcada no prédio.'
        } As unidades são contadas ao longo do lado maior do prédio.`;
      if (!layout || this.place?.kind !== 'building') grid.innerHTML = '';
      else {
        const osmId = this.place.osmId;
        const taken = new Map(
          this.deps.listingsOnBuilding(osmId)
            .filter((l) => l.id !== this.editing?.id && l.unitPosition && l.unitFloor !== undefined)
            .map((l) => [`${l.unitFloor}-${l.unitPosition}`, l.title]),
        );
        const rows: string[] = [];
        for (let f = layout.floors; f >= 1; f--) {
          const cells: string[] = [];
          for (let u = 1; u <= layout.unitsPerFloor; u++) {
            const n = unitNumber(f, u);
            const other = taken.get(`${f}-${u}`);
            const on = chosen?.floor === f && chosen.position === u;
            cells.push(
              `<button type="button" data-floor="${f}" data-pos="${u}" aria-pressed="${on}" ${other ? 'disabled' : ''}
                aria-label="Unidade ${n}, ${f}º andar${other ? `, já anunciada (${escapeHtml(other)})` : ''}">${n}</button>`,
            );
          }
          rows.push(`<div class="a-unit-row"><span class="a-unit-floor" aria-hidden="true">${f}º</span>${cells.join('')}</div>`);
        }
        grid.innerHTML = rows.join('');
      }
    }
    this.refreshPreview();
  }

  private refreshPreview(): void {
    const { scene } = this.deps;
    scene.setPickUnit(null);
    if (!this.place) return scene.setPickPreview(null);
    if (this.place.kind === 'land') return scene.setPickPreview(this.place.lot, 0.5);
    const floors = inBuilding(this.type) ? parseNumberInput(this.value('floors')) : null;
    const height = floors ? floors * METERS_PER_FLOOR : this.place.height;
    scene.setPickPreview(this.place.geometry, height);
    const layout = inBuilding(this.type) ? this.layout() : null;
    const unit = this.chosenUnit(layout);
    const strip = unit && layout ? unitStrip(this.place.geometry, unit.position, layout.unitsPerFloor) : null;
    if (!strip || !unit) return;
    const { base, top } = floorBand(unit.floor, METERS_PER_FLOOR);
    scene.setPickUnit(strip, base, Math.min(top, height));
  }

  private renderPlaceStatus(problem?: string): void {
    const el = this.el.querySelector('.a-place-status')!;
    const btn = this.el.querySelector('[data-action="pick"]')!;
    el.classList.toggle('is-error', !!problem);
    if (problem) el.textContent = problem;
    else if (!this.place) el.textContent = this.type === 'land' ? 'Nenhum lote escolhido.' : 'Nenhum prédio escolhido.';
    else if (this.place.kind === 'land')
      el.textContent = `✓ Lote de ${this.place.front} × ${this.place.depth} m marcado em azul no mapa.`;
    else el.textContent = '✓ Prédio marcado em azul no mapa.';
    btn.textContent = this.place ? 'Trocar local' : 'Escolher no mapa';
  }

  // ------------------------------------------------------------------ saving

  private showError(msg: string | null): void {
    const el = this.el.querySelector<HTMLElement>('.a-error')!;
    el.hidden = !msg;
    el.textContent = msg ?? '';
  }

  private saving = false;

  private async submit(): Promise<void> {
    if (this.saving) return;
    const type = this.type;
    const tx = this.value('transaction') as Transaction;
    const building = type !== 'land';
    const num = (name: string) => parseNumberInput(this.value(name));
    const count = (name: string) => {
      const n = Number(this.value(name) || 0);
      return Number.isInteger(n) && n >= 0 && n <= 10 ? n : NaN;
    };
    const checked = (name: string) => [...this.form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((el) => el.value);
    const salePrice = tx !== 'rent' ? num('price') : null;
    const rentPrice = tx !== 'sale' ? num('rentPrice') : null;
    const areaM2 = num('areaM2');
    const totalAreaM2 = building ? num('totalAreaM2') : null;
    const landAreaM2 = onOwnLot(type) ? num('landAreaM2') : null;
    const floors = inBuilding(type) ? num('floors') : null;
    const unitFloor = inBuilding(type) ? num('unitFloor') : null;
    const unitsPerFloor = inBuilding(type) ? num('unitsPerFloor') : null;
    const layout = inBuilding(type) && this.place?.kind === 'building' ? this.layout() : null;
    const unit = this.chosenUnit(layout);
    const towers = inBuilding(type) ? num('towers') : null;
    const yearBuilt = building ? num('yearBuilt') : null;
    const underConstruction = building && this.value('status') === 'under_construction';
    const floorsBuilt = underConstruction ? num('floorsBuilt') : null;
    const month = this.value('constructionMonth');
    const [bedrooms, suites, bathrooms, parkingSpots, coveredParking] = building
      ? ['bedrooms', 'suites', 'bathrooms', 'parkingSpots', 'coveredParking'].map((n) => (!hasBedrooms(type) && (n === 'bedrooms' || n === 'suites') ? 0 : count(n)))
      : [0, 0, 0, 0, 0];
    const display = this.value('addressDisplay') as AddressDisplay;
    const address: Address = Object.fromEntries(
      (['cep', 'street', 'number', 'complement', 'bairro', 'city'] as const)
        .map((k) => [k, this.value(k)])
        .filter(([, v]) => v),
    );
    const whatsapp = this.value('whatsapp');
    const phone = this.value('phone');
    const year = new Date().getFullYear();

    const problems: string[] = [];
    if (!this.place) problems.push(type === 'land' ? 'escolha o lote no mapa' : 'escolha o prédio no mapa');
    if (tx !== 'rent' && (!salePrice || salePrice < 1000)) problems.push('informe o preço de venda');
    if (tx !== 'sale' && (!rentPrice || rentPrice < 100)) problems.push('informe o aluguel mensal');
    if (!areaM2 || areaM2 < 10) problems.push('informe a área');
    if (totalAreaM2 !== null && areaM2 && totalAreaM2 < areaM2) problems.push('a área total não pode ser menor que a útil');
    if ([bedrooms, suites, bathrooms, parkingSpots, coveredParking].some(Number.isNaN))
      problems.push('quartos, suítes, banheiros e vagas vão de 0 a 10');
    else {
      if (suites > bedrooms) problems.push('há mais suítes que quartos');
      if (coveredParking > parkingSpots) problems.push('há mais vagas cobertas que vagas');
    }
    if (floors !== null && (!Number.isInteger(floors) || floors < 1 || floors > 40)) problems.push('andares do edifício vão de 1 a 40');
    if (unitFloor !== null && (!Number.isInteger(unitFloor) || unitFloor > (floors ?? 40))) problems.push('o andar da unidade passa do número de andares');
    if (unitsPerFloor !== null && (!Number.isInteger(unitsPerFloor) || unitsPerFloor < 1 || unitsPerFloor > MAX_UNITS_PER_FLOOR))
      problems.push(`unidades por andar vão de 1 a ${MAX_UNITS_PER_FLOOR}`);
    if (unitsPerFloor !== null && floors === null) problems.push('com as unidades por andar, informe também os andares do edifício');
    if (this.place?.kind === 'building') {
      const others = this.deps.listingsOnBuilding(this.place.osmId).filter((l) => l.id !== this.editing?.id);
      // a second listing in the building has to be a unit, and not one already listed
      if (others.length && !unit) problems.push('esse prédio já tem anúncios: marque a unidade na grade de unidades');
      if (unit && others.some((l) => l.unitFloor === unit.floor && l.unitPosition === unit.position))
        problems.push(`a unidade ${unitNumber(unit.floor, unit.position)} já está anunciada`);
    }
    if (towers !== null && (!Number.isInteger(towers) || towers < 1 || towers > 20)) problems.push('torres vão de 1 a 20');
    if (yearBuilt !== null && (!Number.isInteger(yearBuilt) || yearBuilt < 1850 || yearBuilt > year + 6)) problems.push('ano de construção inválido');
    if (floorsBuilt !== null && (!Number.isInteger(floorsBuilt) || floorsBuilt < 0 || floorsBuilt > (floors ?? 40)))
      problems.push('os andares construídos passam do número de andares');
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) problems.push('mês do andamento da obra inválido');
    if (!address.bairro) problems.push('informe o bairro');
    if (display !== 'neighborhood' && !address.street) problems.push('informe a rua (ou mostre só o bairro)');
    if (display === 'full' && !address.number) problems.push('informe o número (ou não mostre o endereço completo)');
    if (address.cep && address.cep.replace(/\D/g, '').length !== 8) problems.push('o CEP tem 8 dígitos');
    for (const k of ['videoUrl', 'tourUrl']) if (this.value(k) && !safeUrl(this.value(k))) problems.push('os links precisam começar com https://');
    if (!this.value('creci')) problems.push('informe o CRECI');
    if (whatsapp.replace(/\D/g, '').length < 10) problems.push('informe o WhatsApp com DDD');
    if (problems.length) return this.showError(`Falta pouco: ${[...new Set(problems)].join('; ')}.`);

    const place = this.place!;
    const remote = !!this.deps.remoteOrgName?.();
    const editing = this.editing;
    const id = editing?.id ?? this.deps.newId(TYPE_SLUG[type]);
    const approximate = display !== 'full';
    const features = checked('feature') as Amenity[];
    const guarantees = tx !== 'sale' ? (checked('guarantee') as RentGuarantee[]) : [];
    const price = Math.round((tx === 'rent' ? rentPrice : salePrice)!);
    const doc = (this.form.elements.namedItem('exclusivityDoc') as HTMLInputElement).files?.[0];
    const exclusive = (this.form.elements.namedItem('exclusive') as HTMLInputElement).checked;
    const docProblem = exclusive && doc ? exclusivityDocProblem(doc) : null;
    if (docProblem) return this.showError(docProblem);
    const opt = <T>(key: string, v: T | null | undefined | '') => (v === null || v === undefined || v === '' ? {} : { [key]: v });
    const iptu = num('iptu');
    const date = today();
    const title =
      this.value('title') ||
      (hasBedrooms(type)
        ? `${TITLE_KIND[type]} ${bedrooms} ${bedrooms === 1 ? 'quarto' : 'quartos'}`
        : `${TITLE_KIND[type]} de ${formatArea(areaM2!)}`);
    const listing: Listing = {
      id,
      type,
      title,
      agency: editing?.remote ? editing.agency : this.value('agency') || 'remote',
      price,
      transaction: tx,
      ...(rentPrice ? { rentPrice: Math.round(rentPrice) } : {}),
      ...opt('condoFee', num('condoFee') && Math.round(num('condoFee')!)),
      ...(iptu ? { iptu: { value: Math.round(iptu), period: this.value('iptuPeriod') === 'month' ? 'month' : 'year' } } : {}),
      ...(guarantees.length ? { rentGuarantees: guarantees } : {}),
      areaM2: Math.round(areaM2!),
      ...opt('totalAreaM2', totalAreaM2 && Math.round(totalAreaM2)),
      ...(type === 'land' ? { landAreaM2: Math.round(areaM2!) } : landAreaM2 ? { landAreaM2: Math.round(landAreaM2) } : {}),
      bedrooms,
      bathrooms,
      parkingSpots,
      ...(building ? { suites, coveredParking } : {}),
      ...opt('unitFloor', unitFloor),
      ...(unit && layout ? { unitPosition: unit.position, unitsPerFloor: layout.unitsPerFloor } : opt('unitsPerFloor', unitsPerFloor)),
      ...opt('towers', towers),
      ...opt('yearBuilt', yearBuilt),
      usage: this.value('usage') as Usage,
      status: building ? (this.value('status') as ListingStatus) : 'ready',
      // works under way: floors built, as informed by the advertiser (the map draws the rest translucent)
      ...(floorsBuilt !== null ? { construction: { floorsBuilt, updatedAt: month || date.slice(0, 7), source: 'anunciante' as const } } : {}),
      features,
      ...(place.kind === 'land'
        ? { lotPolygon: place.lot }
        : { buildingOsmId: place.osmId, footprint: place.geometry, buildingHeightM: place.height }),
      ...(floors ? { floors } : {}),
      address,
      addressDisplay: display,
      approximateLocation: approximate,
      ...(approximate ? { approxCenter: approxCenterFor(id, place.center), approxRadiusM: APPROX_RADIUS_M } : {}),
      ...(this.photos.length ? { photos: this.photos } : {}),
      ...opt('floorPlanImage', this.floorPlan),
      ...opt('videoUrl', safeUrl(this.value('videoUrl'))),
      ...opt('tourUrl', safeUrl(this.value('tourUrl'))),
      advertiser: Object.fromEntries(
        Object.entries({ creci: this.value('creci'), contactName: this.value('contactName'), whatsapp, phone, email: this.value('email') }).filter(
          ([, v]) => v,
        ),
      ),
      ...opt('referenceCode', this.value('referenceCode')),
      ...(exclusive ? { exclusive: true, ...opt('exclusivityDoc', doc?.name ?? editing?.exclusivityDoc) } : {}),
      availability: this.value('availability') as Availability,
      highlight: this.value('highlight') as Highlight,
      publishedAt: editing?.publishedAt ?? date,
      updatedAt: date,
      // edit: history and reduction come from the price rules (withPriceChange / database trigger)
      priceHistory: editing?.priceHistory ?? [{ date, price }],
      ...(editing?.previousPrice ? { previousPrice: editing.previousPrice, priceReducedAt: editing.priceReducedAt } : {}),
      ...((editing ? editing.fictional : !remote) ? { fictional: true as const } : {}),
      ...(editing?.remote ? { remote: true as const } : {}),
      ...((remote ? (this.form.elements.namedItem('draft') as HTMLInputElement | null)?.checked : editing?.draft) ? { draft: true as const } : {}),
      description: this.value('description') || (remote || editing ? '' : 'Anúncio cadastrado no protótipo. Dados de demonstração.'),
      userAdded: true,
    };
    const btn = this.form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    this.saving = true;
    btn.disabled = true;
    btn.textContent = 'Salvando…';
    try {
      const file = exclusive ? doc : undefined;
      const error = editing ? await this.deps.onUpdate(listing, place.center, file) : await this.deps.onSave(listing, place.center, file);
      if (error) return this.showError(error);
      if (layout && place.kind === 'building') this.deps.saveBuildingLayout(place.osmId, layout);
      this.close();
    } finally {
      this.saving = false;
      btn.disabled = false;
      btn.textContent = editing ? 'Salvar alterações' : 'Salvar anúncio';
    }
  }

  private renderMine(): void {
    const n = this.deps.remoteOrgName?.() ? 0 : this.deps.userCount();
    const el = this.el.querySelector<HTMLElement>('.a-mine')!;
    el.innerHTML = n
      ? `<p class="small">Você tem ${n === 1 ? '1 anúncio salvo' : `${n} anúncios salvos`} neste navegador.</p>
         <button type="button" class="btn-secondary" data-action="export">Exportar meus anúncios (JSON)</button>`
      : '';
    el.querySelector('[data-action="export"]')?.addEventListener('click', () => this.deps.onExport());
  }
}
