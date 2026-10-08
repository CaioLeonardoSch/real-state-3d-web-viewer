import {
  LEVEL_USE_LABELS,
  STAGE_LABELS,
  UNIT_STATUS_LABELS,
  countByStatus,
  facingInfo,
  levelOf,
  type Development,
  type Level,
  type Unit,
} from '../data/developments';
import { escapeHtml, formatArea, formatBRL } from '../utils/format';

export interface DevelopmentPanelHandlers {
  onClose: () => void;
  onSelectUnit: (unitId: string | null) => void;
  /** Floors above `level` become translucent on the map (null = whole tower). */
  onFloor: (level: number | null) => void;
  onFilter: (fn: ((u: Unit) => boolean) | null) => void;
  onHoverUnit: (unitId: string | null) => void;
  onView: (unitId: string) => void;
  onExitView: () => void;
}

interface UnitFilter {
  onlyAvailable: boolean;
  suitesMin: number | null;
}

const floorLabel = (level: number) => (level === 0 ? 'Térreo' : `${level}º`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "Espelho de vendas": every floor of a development as a row of units coloured by status, a unit
 * card (area, suites, parking, facing and sun, illustrative price) and where the data comes from.
 */
export class DevelopmentPanel {
  private dev: Development | null = null;
  private unitId: string | null = null;
  private floor: number | null = null;
  private filter: UnitFilter = { onlyAvailable: false, suitesMin: null };
  private viewing = false;

  constructor(
    private el: HTMLElement,
    private handlers: DevelopmentPanelHandlers,
  ) {
    document.addEventListener('keydown', (e) => {
      if (!this.dev || e.key !== 'Escape') return;
      if (this.viewing) this.setViewing(false, true);
      else if (this.unitId) this.select(null);
      else this.close();
    });
  }

  get currentId(): string | null {
    return this.dev?.id ?? null;
  }
  get selectedUnitId(): string | null {
    return this.unitId;
  }

  open(dev: Development): void {
    this.dev = dev;
    this.unitId = null;
    this.floor = null;
    this.filter = { onlyAvailable: false, suitesMin: null };
    this.viewing = false;
    this.render();
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('dev-open');
    this.el.scrollTop = 0;
    this.el.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.dev) return;
    this.dev = null;
    this.unitId = null;
    this.viewing = false;
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('dev-open');
    this.handlers.onClose();
  }

  /** Selects a unit (null clears) and shows its floor; called from the grid or from the map. */
  select(unitId: string | null): void {
    if (!this.dev) return;
    this.setViewing(false, false);
    this.unitId = unitId;
    const level = unitId ? levelOf(this.dev, unitId) : undefined;
    this.floor = level ? level.level : null;
    this.handlers.onSelectUnit(unitId);
    this.handlers.onFloor(this.floor);
    this.renderDetail();
    this.markGrid();
    // scroll inside the panel only (scrollIntoView would also scroll the page while the panel slides in)
    const detail = this.el.querySelector<HTMLElement>('.dev-detail');
    if (unitId && detail) this.el.scrollTop = Math.max(0, detail.offsetTop - 12);
  }

  // ------------------------------------------------------------------ rendering

  private render(): void {
    const d = this.dev!;
    const c = countByStatus(d);
    this.el.innerHTML = `
      <div class="drawer-head">
        <button type="button" class="link-btn dev-back" data-action="close">‹ Voltar ao bairro</button>
        <button type="button" class="icon-btn" data-action="close" aria-label="Fechar empreendimento">×</button>
      </div>
      <span class="badge-fictional badge-dev">Espelho de vendas 3D · demonstração</span>
      <h2 id="dev-title">${escapeHtml(d.name)}</h2>
      <p class="dev-sub">${escapeHtml(d.developer)} · ${STAGE_LABELS[d.stage]} · entrega ${escapeHtml(d.delivery)}<br>
        <span class="muted">${escapeHtml(d.address)}</span></p>
      <p class="dev-counts">
        <span class="st st-available">${plural(c.available, 'disponível', 'disponíveis')}</span>
        <span class="st st-reserved">${plural(c.reserved, 'reservado', 'reservados')}</span>
        <span class="st st-sold">${plural(c.sold, 'vendido', 'vendidos')}</span>
      </p>
      <p class="notice-approx small">Preços e disponibilidade são <b>fictícios</b>. A distribuição por andar e a posição da
        torre são estimadas a partir da divulgação pública. Sem vínculo com a ${escapeHtml(d.developer)}.</p>
      <div class="dev-detail" aria-live="polite"></div>
      <div class="dev-tools">
        <label class="a-check"><input type="checkbox" name="onlyAvailable"> Só disponíveis</label>
        <label class="results-sort">Suítes
          <select name="suitesMin"><option value="">Qualquer</option>${[2, 3, 4]
            .map((n) => `<option value="${n}">${n}+</option>`)
            .join('')}</select>
        </label>
        <button type="button" class="link-btn" data-action="whole-tower" hidden>Ver torre inteira</button>
      </div>
      <div class="dev-grid" role="group" aria-label="Unidades por andar, do último ao primeiro">${this.gridHtml(d)}</div>
      <p class="dev-legend small"><span class="st st-available">disponível</span> <span class="st st-reserved">reservado</span>
        <span class="st st-sold">vendido</span> <span class="st st-selected">selecionado</span></p>
      <details class="dev-about">
        <summary>De onde vêm esses dados</summary>
        <h3>Público</h3>
        <ul>${d.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
        <h3>Estimado nesta demonstração</h3>
        <ul>${d.estimates.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}
          <li>preços (ilustrativos) e disponibilidade (fictícia) de cada unidade</li>
          <li>localização: ${escapeHtml(d.locationNote)}</li></ul>
        <h3>Fontes</h3>
        <ul>${d.sources
          .map((s) => `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.label)}</a></li>`)
          .join('')}</ul>
      </details>`;
    this.el.querySelectorAll('[data-action="close"]').forEach((b) => b.addEventListener('click', () => this.close()));
    this.el.querySelector('[data-action="whole-tower"]')!.addEventListener('click', () => this.select(null));
    const only = this.el.querySelector<HTMLInputElement>('input[name="onlyAvailable"]')!;
    const suites = this.el.querySelector<HTMLSelectElement>('select[name="suitesMin"]')!;
    const onFilter = () => {
      this.filter = { onlyAvailable: only.checked, suitesMin: suites.value ? Number(suites.value) : null };
      this.applyFilter();
    };
    only.addEventListener('change', onFilter);
    suites.addEventListener('change', onFilter);
    this.bindGrid();
    this.renderDetail();
  }

  private gridHtml(d: Development): string {
    // non-residential levels are grouped ("Garagem 1º–3º") to keep the grid short
    const rows: string[] = [];
    const levels = [...d.levels].reverse();
    for (let i = 0; i < levels.length; i++) {
      const l = levels[i];
      if (l.units.length) {
        rows.push(this.rowHtml(l));
        continue;
      }
      let j = i;
      while (j + 1 < levels.length && !levels[j + 1].units.length && levels[j + 1].use === l.use) j++;
      const range = j === i ? floorLabel(l.level) : `${floorLabel(levels[j].level)}–${floorLabel(l.level)}`;
      rows.push(`<div class="dev-row dev-row-${l.use}"><span class="dev-row-label">${range}</span>
        <span class="dev-row-use">${LEVEL_USE_LABELS[l.use]}</span></div>`);
      i = j;
    }
    return rows.join('');
  }

  private rowHtml(l: Level): string {
    return `<div class="dev-row" data-level="${l.level}">
      <button type="button" class="dev-row-label" data-floor="${l.level}" aria-label="Ver o ${floorLabel(l.level)} andar">${floorLabel(l.level)}</button>
      <div class="dev-row-units">${l.units
        .map((u) => {
          const label = `Apartamento ${u.number}, ${u.plan}, ${formatArea(u.areaM2)}, ${UNIT_STATUS_LABELS[u.status].toLowerCase()}`;
          return `<button type="button" class="unit st-${u.status}" style="flex-grow:${u.cells}" data-unit="${escapeHtml(u.id)}"
            aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${escapeHtml(u.number)}</button>`;
        })
        .join('')}</div>
    </div>`;
  }

  private bindGrid(): void {
    this.el.querySelectorAll<HTMLButtonElement>('button[data-unit]').forEach((b) => {
      const id = b.dataset.unit!;
      b.addEventListener('click', () => this.select(this.unitId === id ? null : id));
      b.addEventListener('mouseenter', () => this.handlers.onHoverUnit(id));
      b.addEventListener('mouseleave', () => this.handlers.onHoverUnit(null));
      b.addEventListener('focus', () => this.handlers.onHoverUnit(id));
      b.addEventListener('blur', () => this.handlers.onHoverUnit(null));
    });
    this.el.querySelectorAll<HTMLButtonElement>('button[data-floor]').forEach((b) =>
      b.addEventListener('click', () => {
        const level = Number(b.dataset.floor);
        this.unitId = null;
        this.handlers.onSelectUnit(null);
        this.floor = this.floor === level ? null : level;
        this.handlers.onFloor(this.floor);
        this.renderDetail();
        this.markGrid();
      }),
    );
  }

  private matches(u: Unit): boolean {
    const f = this.filter;
    return (!f.onlyAvailable || u.status === 'available') && (f.suitesMin === null || u.suites >= f.suitesMin);
  }

  private applyFilter(): void {
    const active = this.filter.onlyAvailable || this.filter.suitesMin !== null;
    this.handlers.onFilter(active ? (u) => this.matches(u) : null);
    this.markGrid();
  }

  /** Grid state: selected unit, chosen floor, units filtered out. */
  private markGrid(): void {
    const d = this.dev!;
    const units = new Map(d.levels.flatMap((l) => l.units).map((u) => [u.id, u]));
    this.el.querySelectorAll<HTMLButtonElement>('button[data-unit]').forEach((b) => {
      const u = units.get(b.dataset.unit!)!;
      b.classList.toggle('is-selected', u.id === this.unitId);
      b.classList.toggle('is-out', !this.matches(u));
      b.setAttribute('aria-pressed', String(u.id === this.unitId));
    });
    this.el.querySelectorAll<HTMLElement>('.dev-row[data-level]').forEach((r) =>
      r.classList.toggle('is-floor', this.floor !== null && Number(r.dataset.level) === this.floor),
    );
    this.el.querySelector<HTMLElement>('[data-action="whole-tower"]')!.hidden = this.floor === null;
  }

  private renderDetail(): void {
    const d = this.dev!;
    const box = this.el.querySelector<HTMLElement>('.dev-detail')!;
    const level = this.unitId ? levelOf(d, this.unitId) : undefined;
    const u = level?.units.find((x) => x.id === this.unitId);
    if (!u || !level) {
      box.innerHTML =
        this.floor !== null
          ? `<p class="small">Mostrando o <b>${floorLabel(this.floor)} andar</b>: os andares de cima ficaram transparentes. Escolha uma unidade.</p>`
          : '<p class="small muted">Clique numa unidade na grade ou no prédio para ver os detalhes.</p>';
      return;
    }
    const face = facingInfo(d.shapes[u.shape].facing);
    const rows: [string, string][] = [
      ['Planta', u.plan],
      ['Área privativa', formatArea(u.areaM2)],
      ['Quartos', u.suites === u.bedrooms ? plural(u.suites, 'suíte', 'suítes') : `${u.bedrooms} (${plural(u.suites, 'suíte', 'suítes')})`],
      ['Vagas', String(u.parkingSpots)],
      ['Andar', floorLabel(level.level)],
      ['Face', `${face.direction} · ${face.sun}`],
      ['Preço (ilustrativo)', formatBRL(u.price)],
      ['Preço por m²', `${formatBRL(Math.round(u.price / u.areaM2))}/m²`],
    ];
    box.innerHTML = `<div class="dev-card">
      <div class="dev-card-head"><h3>Apto ${escapeHtml(u.number)}</h3>
        <span class="st st-${u.status}">${UNIT_STATUS_LABELS[u.status]}</span></div>
      <dl class="facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>
      <div class="dev-card-actions">
        <button type="button" class="btn-primary" data-action="view">${this.viewing ? 'Sair da vista' : 'Ver a vista da janela'}</button>
        <button type="button" class="btn-secondary" data-action="deselect">Fechar unidade</button>
      </div>
      <p class="muted small">A vista usa a altura do andar e a direção da fachada; os prédios vizinhos vêm do
        OpenStreetMap (muitos com altura padrão de 6 m).</p>
    </div>`;
    box.querySelector('[data-action="view"]')!.addEventListener('click', () => this.setViewing(!this.viewing, true));
    box.querySelector('[data-action="deselect"]')!.addEventListener('click', () => this.select(null));
  }

  private setViewing(on: boolean, notify: boolean): void {
    if (this.viewing === on) return;
    this.viewing = on;
    document.body.classList.toggle('dev-viewing', on);
    if (notify) {
      if (on && this.unitId) this.handlers.onView(this.unitId);
      else this.handlers.onExitView();
    }
    if (this.dev) this.renderDetail();
  }
}
