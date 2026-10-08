import type { MultiPolygon, Polygon } from 'geojson';
import turfCentroid from '@turf/centroid';
import { isResidentialBuilding } from '../../scripts/lib/residential.mjs';
import {
  AMENITIES,
  AMENITY_LABELS,
  LISTING_STATUSES,
  LISTING_TYPES,
  STATUS_LABELS,
  TYPE_LABELS,
  type Agency,
  type Amenity,
  type Listing,
  type ListingStatus,
  type ListingType,
} from '../data/types';
import type { PickResult, Scene } from '../map/scene';
import { APPROX_RADIUS_M, approxCenterFor, lotRectangle, lotSize, type PlacementChecker } from '../utils/placement';
import { escapeHtml, formatArea, parseNumberInput } from '../utils/format';

const METERS_PER_FLOOR = 3;
const TYPE_SLUG: Record<ListingType, string> = { apartment: 'apto', house: 'casa', semi_detached: 'geminado', land: 'terreno' };

export interface AddListingDeps {
  agencies: Agency[];
  scene: Scene;
  checker: PlacementChecker;
  /** Listing already using this OSM building, if any. */
  listingOnBuilding: (osmId: string) => Listing | undefined;
  /** Lots of the other land listings (a new lot must not overlap them). */
  otherLots: () => (Polygon | MultiPolygon)[];
  newId: (slug: string) => string;
  /** Saves the new listing; returns an error message, or null on success. */
  onSave: (l: Listing) => string | null;
  onExport: () => void;
  userCount: () => number;
  onClose: () => void;
}

/** Place chosen on the map for the new listing. */
type Place =
  | { kind: 'building'; osmId: string; center: [number, number] }
  | { kind: 'land'; center: [number, number]; lot: Polygon; front: number; depth: number };

/**
 * "Anunciar imóvel": a form plus a map pick (a grey residential building, or free ground for a lot).
 * The new listing is validated with the same rules as listings.json and kept in this browser.
 */
export class AddListingPanel {
  private place: Place | null = null;
  private isOpen = false;

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
    this.place = null;
    this.render();
    this.el.hidden = false;
    document.body.classList.add('add-open');
    this.el.querySelector<HTMLElement>('select[name="type"]')?.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.deps.scene.stopPicking();
    this.deps.scene.setPickPreview(null);
    this.el.hidden = true;
    this.el.classList.remove('picking');
    document.body.classList.remove('add-open');
    this.deps.onClose();
  }

  // ------------------------------------------------------------------ form

  private render(): void {
    const { agencies } = this.deps;
    const options = <T extends string>(values: readonly T[], labels: Record<T, string>, selected?: T) =>
      values.map((v) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${labels[v]}</option>`).join('');
    this.el.innerHTML = `
      <div class="add-head">
        <h2 id="add-title">Anunciar imóvel</h2>
        <button type="button" class="icon-btn" data-action="close" aria-label="Fechar formulário">×</button>
      </div>
      <p class="muted small">O anúncio fica salvo só neste navegador. Para publicar para todos, exporte o JSON e rode
        <code>npm run listings:add</code> (veja o README).</p>
      <form class="add-form" novalidate>
        <label class="a-field">Tipo<select name="type">${options(LISTING_TYPES, TYPE_LABELS, 'apartment')}</select></label>
        <div class="a-place">
          <span class="a-label">Local no mapa</span>
          <p class="a-place-status" aria-live="polite"></p>
          <button type="button" class="btn-secondary" data-action="pick">Escolher no mapa</button>
        </div>
        <label class="a-field a-wide">Título<input name="title" maxlength="80" placeholder="ex.: Apartamento com sacada 2 quartos"></label>
        <label class="a-field">Preço (R$)<input name="price" inputmode="numeric" required></label>
        <label class="a-field"><span data-area-label>Área construída (m²)</span><input name="areaM2" inputmode="numeric" required></label>
        <label class="a-field" data-for="house semi_detached">Área do terreno (m²)<input name="landAreaM2" inputmode="numeric" placeholder="opcional"></label>
        <label class="a-field" data-for="apartment">Pavimentos do edifício<input name="floors" inputmode="numeric" placeholder="opcional"></label>
        <label class="a-field" data-for="apartment house semi_detached">Quartos<input name="bedrooms" type="number" min="0" max="10" value="2"></label>
        <label class="a-field" data-for="apartment house semi_detached">Banheiros<input name="bathrooms" type="number" min="0" max="10" value="1"></label>
        <label class="a-field" data-for="apartment house semi_detached">Vagas<input name="parkingSpots" type="number" min="0" max="10" value="1"></label>
        <label class="a-field">Situação<select name="status">${options(LISTING_STATUSES, STATUS_LABELS)}</select></label>
        <label class="a-field">Imobiliária<select name="agency">${agencies
          .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`)
          .join('')}</select></label>
        <fieldset class="f-chips a-wide">
          <legend>Comodidades</legend>
          ${AMENITIES.map(
            (a) => `<label class="chip"><input type="checkbox" name="feature" value="${a}"><span>${AMENITY_LABELS[a]}</span></label>`,
          ).join('')}
        </fieldset>
        <label class="a-field a-wide">Descrição<textarea name="description" rows="3" maxlength="600" placeholder="opcional"></textarea></label>
        <label class="a-check a-wide"><input type="checkbox" name="approximate"> Ocultar o endereço exato (mostrar um raio de ${APPROX_RADIUS_M} m)</label>
        <p class="a-error a-wide" role="alert" hidden></p>
        <div class="a-actions a-wide">
          <button type="submit" class="btn-primary">Salvar anúncio</button>
          <button type="button" class="btn-secondary" data-action="close">Cancelar</button>
        </div>
      </form>
      <div class="a-mine"></div>
      <div class="a-picking" hidden>
        <p class="a-picking-hint"></p>
        <button type="button" class="btn-secondary" data-action="cancel-pick">Cancelar escolha</button>
      </div>`;
    const form = this.form;
    this.el.querySelectorAll('[data-action="close"]').forEach((b) => b.addEventListener('click', () => this.close()));
    this.el.querySelector('[data-action="pick"]')!.addEventListener('click', () => this.startPick());
    this.el.querySelector('[data-action="cancel-pick"]')!.addEventListener('click', () => this.cancelPick());
    (form.elements.namedItem('type') as HTMLElement).addEventListener('change', () => this.onTypeChange());
    (form.elements.namedItem('areaM2') as HTMLElement).addEventListener('change', () => this.onAreaChange());
    (form.elements.namedItem('floors') as HTMLElement).addEventListener('change', () => this.refreshPreview());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    this.onTypeChange();
    this.renderMine();
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

  private onTypeChange(): void {
    const type = this.type;
    this.form.querySelectorAll<HTMLElement>('[data-for]').forEach((el) => {
      el.hidden = !el.dataset.for!.split(' ').includes(type);
    });
    this.el.querySelector('[data-area-label]')!.textContent = type === 'land' ? 'Área do lote (m²)' : 'Área construída (m²)';
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
    if (!this.deps.checker.insideBoundary(p.lngLat)) return this.pickHint('Esse ponto fica fora do bairro América. Clique dentro do limite tracejado.');
    if (this.type === 'land') {
      const problem = this.tryLot(p.lngLat);
      if (problem) return this.pickHint(problem);
    } else {
      if (!p.building) return this.pickHint('Aí não há prédio disponível. Clique num prédio cinza (os laranja já estão à venda).');
      if (!isResidentialBuilding(p.building.properties))
        return this.pickHint('Esse prédio não é residencial no OpenStreetMap (ou tem nome próprio). Escolha outro.');
      const taken = this.deps.listingOnBuilding(p.building.osmId);
      if (taken) return this.pickHint(`Esse prédio já tem um anúncio: "${taken.title}". Escolha outro.`);
      const shape = this.deps.scene.buildingShape(p.building.osmId)!;
      const center = turfCentroid({ type: 'Feature', properties: {}, geometry: shape.geometry }).geometry.coordinates as [number, number];
      this.setPlace({ kind: 'building', osmId: p.building.osmId, center });
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
    const problem = this.deps.checker.lotProblem(lot, this.deps.otherLots());
    if (problem) {
      this.renderPlaceStatus(problem);
      return problem;
    }
    this.setPlace({ kind: 'land', center, lot, front, depth });
    return null;
  }

  private setPlace(place: Place | null): void {
    this.place = place;
    this.refreshPreview();
    this.renderPlaceStatus();
  }

  private refreshPreview(): void {
    const { scene } = this.deps;
    if (!this.place) return scene.setPickPreview(null);
    if (this.place.kind === 'land') return scene.setPickPreview(this.place.lot, 0.5);
    const shape = scene.buildingShape(this.place.osmId);
    const floors = this.type === 'apartment' ? parseNumberInput(this.value('floors')) : null;
    scene.setPickPreview(shape?.geometry ?? null, floors ? floors * METERS_PER_FLOOR : (shape?.height ?? 6));
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

  private submit(): void {
    const type = this.type;
    const num = (name: string) => parseNumberInput(this.value(name));
    const count = (name: string) => {
      const n = Number(this.value(name) || 0);
      return Number.isInteger(n) && n >= 0 && n <= 10 ? n : NaN;
    };
    const price = num('price');
    const areaM2 = num('areaM2');
    const landAreaM2 = type === 'house' || type === 'semi_detached' ? num('landAreaM2') : null;
    const floors = type === 'apartment' ? num('floors') : null;
    const [bedrooms, bathrooms, parkingSpots] =
      type === 'land' ? [0, 0, 0] : ['bedrooms', 'bathrooms', 'parkingSpots'].map(count);
    const status = this.value('status') as ListingStatus;

    const problems: string[] = [];
    if (!this.place) problems.push(type === 'land' ? 'escolha o lote no mapa' : 'escolha o prédio no mapa');
    if (!price || price < 1000) problems.push('informe o preço');
    if (!areaM2 || areaM2 < 10) problems.push('informe a área');
    if ([bedrooms, bathrooms, parkingSpots].some(Number.isNaN)) problems.push('quartos, banheiros e vagas vão de 0 a 10');
    if (floors !== null && (!Number.isInteger(floors) || floors < 1 || floors > 40)) problems.push('pavimentos vão de 1 a 40');
    if (problems.length) return this.showError(`Falta pouco: ${problems.join('; ')}.`);

    const place = this.place!;
    const id = this.deps.newId(TYPE_SLUG[type]);
    const approximate = (this.form.elements.namedItem('approximate') as HTMLInputElement).checked;
    const features = [...this.form.querySelectorAll<HTMLInputElement>('input[name="feature"]:checked')].map(
      (el) => el.value as Amenity,
    );
    const title =
      this.value('title') ||
      (type === 'land'
        ? `Terreno de ${formatArea(areaM2!)}`
        : `${{ apartment: 'Apartamento', house: 'Casa', semi_detached: 'Geminado' }[type]} ${bedrooms} ${bedrooms === 1 ? 'quarto' : 'quartos'}`);
    const listing: Listing = {
      id,
      type,
      title,
      agency: this.value('agency'),
      price: Math.round(price!),
      areaM2: Math.round(areaM2!),
      ...(type === 'land' ? { landAreaM2: Math.round(areaM2!) } : landAreaM2 ? { landAreaM2: Math.round(landAreaM2) } : {}),
      bedrooms,
      bathrooms,
      parkingSpots,
      status,
      features,
      ...(place.kind === 'land' ? { lotPolygon: place.lot } : { buildingOsmId: place.osmId }),
      ...(floors ? { floors } : {}),
      approximateLocation: approximate,
      ...(approximate ? { approxCenter: approxCenterFor(id, place.center), approxRadiusM: APPROX_RADIUS_M } : {}),
      fictional: true,
      description: this.value('description') || 'Anúncio cadastrado no protótipo. Dados de demonstração.',
      userAdded: true,
    };
    const error = this.deps.onSave(listing);
    if (error) return this.showError(error);
    this.close();
  }

  private renderMine(): void {
    const n = this.deps.userCount();
    const el = this.el.querySelector<HTMLElement>('.a-mine')!;
    el.innerHTML = n
      ? `<p class="small">Você tem ${n === 1 ? '1 anúncio salvo' : `${n} anúncios salvos`} neste navegador.</p>
         <button type="button" class="btn-secondary" data-action="export">Exportar meus anúncios (JSON)</button>`
      : '';
    el.querySelector('[data-action="export"]')?.addEventListener('click', () => this.deps.onExport());
  }
}
