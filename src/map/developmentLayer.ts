import { Marker, type Map as MlMap, type GeoJSONSource, type ExpressionSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import turfBbox from '@turf/bbox';
import turfCentroid from '@turf/centroid';
import turfDestination from '@turf/destination';
import { point } from '@turf/helpers';
import { countByStatus, type Development, type Level, type Unit } from '../data/developments';

/**
 * Developments on the map. Closed: one violet tower per development, with a label.
 * Open: the tower is split into levels; residential levels into units coloured by status
 * (available / reserved / sold). A chosen floor makes the levels above it translucent,
 * so the floor is visible from above.
 */

export const DEV_COLORS = {
  tower: '#7a5af8',
  towerHover: '#a28dfb',
  available: '#2e9d5b',
  reserved: '#e0a526',
  sold: '#c3c7ce',
  selected: '#2f7de1',
  garage: '#8d939c',
  lobby: '#b2b7bf',
  leisure: '#86b8a4',
};

/** Gap between stacked levels, so floors read as slabs. */
const LEVEL_GAP_M = 0.35;
const TOWER_LAYERS = ['dev-towers'];
const BLOCK_LAYERS = ['dev-blocks'];

interface BlockProps {
  devId: string;
  level: number;
  kind: 'unit' | Level['use'];
  unitId: string | null;
  status: Unit['status'] | null;
  base: number;
  top: number;
  /** Drawn translucent (above the chosen floor, or filtered out). */
  ghost: boolean;
}

export interface DevelopmentEvents {
  onOpen: (devId: string) => void;
  onUnitClick: (devId: string, unitId: string) => void;
  /** Ignore clicks (e.g. while choosing the place of a new listing). */
  isBlocked: () => boolean;
}

export class DevelopmentLayer {
  private openId: string | null = null;
  private floor: number | null = null;
  private visibleUnits: ((u: Unit) => boolean) | null = null;
  private blockIdByUnit = new Map<string, number>();
  private hoverTower: number | null = null;
  private hoverBlock: number | null = null;
  private selectedBlock: number | null = null;
  private markers: Marker[] = [];
  private viewing = false;
  private savedLimits: { maxZoom: number; maxPitch: number } | null = null;

  constructor(
    private map: MlMap,
    private developments: Development[],
    private events: DevelopmentEvents,
    beforeLayer: string,
  ) {
    if (!developments.length) return;
    map.addSource('dev-towers', { type: 'geojson', data: this.towerCollection() });
    map.addSource('dev-blocks', { type: 'geojson', data: EMPTY });
    const hover = (base: string, over: string): ExpressionSpecification => [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      over,
      base,
    ];
    map.addLayer(
      {
        id: 'dev-towers',
        type: 'fill-extrusion',
        source: 'dev-towers',
        filter: ['==', ['get', 'open'], false],
        paint: {
          'fill-extrusion-color': hover(DEV_COLORS.tower, DEV_COLORS.towerHover),
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-opacity': 0.95,
          'fill-extrusion-vertical-gradient': false,
        },
      },
      beforeLayer,
    );
    const blockColor: ExpressionSpecification = [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      DEV_COLORS.selected,
      ['boolean', ['feature-state', 'hover'], false],
      '#ffffff',
      [
        'match',
        ['get', 'kind'],
        'unit',
        ['match', ['get', 'status'], 'available', DEV_COLORS.available, 'reserved', DEV_COLORS.reserved, DEV_COLORS.sold],
        'garage',
        DEV_COLORS.garage,
        'leisure',
        DEV_COLORS.leisure,
        DEV_COLORS.lobby,
      ],
    ];
    for (const [id, ghost, opacity] of [
      ['dev-blocks', false, 1],
      ['dev-blocks-ghost', true, 0.14],
    ] as const) {
      map.addLayer(
        {
          id,
          type: 'fill-extrusion',
          source: 'dev-blocks',
          filter: ['==', ['get', 'ghost'], ghost],
          paint: {
            'fill-extrusion-color': blockColor,
            'fill-extrusion-base': ['get', 'base'],
            'fill-extrusion-height': ['get', 'top'],
            'fill-extrusion-opacity': opacity,
            'fill-extrusion-vertical-gradient': false,
          },
        },
        beforeLayer,
      );
    }
    this.addMarkers();
    this.bindInteractions();
  }

  // ---------------------------------------------------------------- data

  private towerCollection(): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: this.developments.map((d, i) => ({
        type: 'Feature',
        id: i + 1,
        properties: { devId: d.id, height: d.levels.at(-1)!.top, open: d.id === this.openId },
        geometry: d.footprint,
      })),
    };
  }

  private blockCollection(): FeatureCollection<Polygon, BlockProps> {
    this.blockIdByUnit.clear();
    const d = this.current;
    if (!d) return EMPTY as FeatureCollection<Polygon, BlockProps>;
    const features: Feature<Polygon, BlockProps>[] = [];
    let id = 0;
    const chosen = this.floor === null ? null : d.levels.find((l) => l.level === this.floor);
    for (const l of d.levels) {
      const above = chosen !== null && chosen !== undefined && l.level > chosen.level;
      const props = { devId: d.id, level: l.level, base: l.base, top: l.top - LEVEL_GAP_M };
      if (!l.units.length) {
        features.push({
          type: 'Feature',
          id: ++id,
          properties: { ...props, kind: l.use, unitId: null, status: null, ghost: above },
          geometry: d.footprint,
        });
        continue;
      }
      for (const u of l.units) {
        const hidden = this.visibleUnits !== null && !this.visibleUnits(u);
        this.blockIdByUnit.set(u.id, ++id);
        features.push({
          type: 'Feature',
          id,
          properties: { ...props, kind: 'unit', unitId: u.id, status: u.status, ghost: above || hidden },
          geometry: d.shapes[u.shape].polygon,
        });
      }
    }
    return { type: 'FeatureCollection', features };
  }

  private get current(): Development | undefined {
    return this.developments.find((d) => d.id === this.openId);
  }

  private refresh(): void {
    this.selectedBlock = null;
    this.hoverBlock = null;
    this.map.removeFeatureState({ source: 'dev-blocks' });
    (this.map.getSource('dev-blocks') as GeoJSONSource).setData(this.blockCollection());
    (this.map.getSource('dev-towers') as GeoJSONSource).setData(this.towerCollection());
  }

  // ---------------------------------------------------------------- markers

  private addMarkers(): void {
    for (const d of this.developments) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'dev-marker';
      const n = countByStatus(d).available;
      el.innerHTML = `<strong>${d.name}</strong><span>${d.developer} · ${n === 1 ? '1 disponível' : `${n} disponíveis`}</span>`;
      el.setAttribute('aria-label', `Abrir o espelho de vendas do ${d.name} (${d.developer})`);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.events.isBlocked()) this.events.onOpen(d.id);
      });
      this.markers.push(new Marker({ element: el, anchor: 'top' }).setLngLat(d.center).addTo(this.map));
    }
  }

  // ---------------------------------------------------------------- state

  get openDevelopmentId(): string | null {
    return this.openId;
  }

  open(devId: string, fly = true): void {
    const d = this.developments.find((x) => x.id === devId);
    if (!d) return;
    this.exitView();
    this.openId = devId;
    this.floor = null;
    this.visibleUnits = null;
    this.refresh();
    this.markers.forEach((m, i) => m.getElement().classList.toggle('is-open', this.developments[i].id === devId));
    if (fly) this.frame(d);
  }

  close(): void {
    if (!this.openId) return;
    this.exitView();
    this.clearPadding();
    this.openId = null;
    this.floor = null;
    this.visibleUnits = null;
    this.refresh();
    this.markers.forEach((m) => m.getElement().classList.remove('is-open'));
  }

  /** Floors above `level` turn translucent (null shows the whole tower). */
  setFloor(level: number | null): void {
    this.floor = level;
    this.refresh();
  }

  /** Units that do not pass the panel's filters turn translucent (null shows all). */
  setUnitFilter(fn: ((u: Unit) => boolean) | null): void {
    this.visibleUnits = fn;
    this.refresh();
  }

  selectUnit(unitId: string | null): void {
    if (this.selectedBlock !== null) this.map.setFeatureState({ source: 'dev-blocks', id: this.selectedBlock }, { selected: false });
    this.selectedBlock = unitId ? (this.blockIdByUnit.get(unitId) ?? null) : null;
    if (this.selectedBlock !== null) this.map.setFeatureState({ source: 'dev-blocks', id: this.selectedBlock }, { selected: true });
  }

  /** Highlights a unit hovered in the panel. */
  hoverUnit(unitId: string | null): void {
    this.setBlockHover(unitId ? (this.blockIdByUnit.get(unitId) ?? null) : null);
  }

  // ---------------------------------------------------------------- camera

  /** `padding` given to flyTo stays on the map: remove it so later framings start from a clean map. */
  private clearPadding(): void {
    this.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  }

  private padding() {
    const mobile = window.matchMedia('(max-width: 720px)').matches;
    // desktop: the panel takes ~440 px on the right
    // the tower rises above its base point, so keep the base low in the free area
    return mobile ? { top: 160, bottom: 380, left: 20, right: 20 } : { top: 260, bottom: 40, left: 330, right: 460 };
  }

  /** Close-up of the tower, looking at its street front, centred in the free part of the map. */
  frame(d: Development): void {
    const front = d.shapes[0]?.facing ?? 0;
    const mobile = window.matchMedia('(max-width: 720px)').matches;
    this.map.flyTo({
      elevation: 0,
      roll: 0,
      center: d.center,
      zoom: mobile ? 17.2 : 17.7,
      pitch: 60,
      bearing: front + 180,
      padding: this.padding(),
      duration: 1200,
      essential: true,
    });
  }

  /**
   * Camera at the window of a unit, at its floor height, looking out of its facade.
   * Returns false when the unit is unknown.
   */
  viewFrom(unitId: string): boolean {
    const d = this.current;
    const level = d?.levels.find((l) => l.units.some((u) => u.id === unitId));
    const unit = level?.units.find((u) => u.id === unitId);
    if (!d || !level || !unit) return false;
    const shape = d.shapes[unit.shape];
    const c = turfCentroid({ type: 'Feature', properties: {}, geometry: shape.polygon }).geometry.coordinates;
    const [w, s, e, n] = turfBbox(shape.polygon);
    // step out past the facade (half the unit's diagonal + 2 m), so the tower is behind the camera
    const halfDiag = Math.hypot((e - w) * 100000, (n - s) * 111000) / 2;
    const eye = turfDestination(point(c), halfDiag + 2, shape.facing, { units: 'meters' }).geometry.coordinates as [number, number];
    this.clearPadding();
    if (!this.savedLimits) this.savedLimits = { maxZoom: this.map.getMaxZoom(), maxPitch: this.map.getMaxPitch() };
    this.map.setMaxZoom(23);
    this.map.setMaxPitch(85);
    const cam = this.map.calculateCameraOptionsFromCameraLngLatAltRotation(eye, level.base + 1.6, shape.facing, 80);
    this.map.flyTo({ ...cam, duration: 1600, essential: true });
    this.viewing = true;
    return true;
  }

  get isViewing(): boolean {
    return this.viewing;
  }

  /** Leaves the window view (restores the zoom/pitch limits) and frames the tower again. */
  exitView(reframe = false): void {
    if (!this.viewing) return;
    this.viewing = false;
    if (this.savedLimits) {
      this.map.setMaxPitch(this.savedLimits.maxPitch);
      this.map.setMaxZoom(this.savedLimits.maxZoom);
      this.savedLimits = null;
    }
    // the window camera lifts the map centre to the floor height; the rest of the app assumes ground level
    const d = this.current;
    if (reframe && d) this.frame(d);
    else this.map.jumpTo({ elevation: 0, roll: 0 });
  }

  // ---------------------------------------------------------------- interaction

  private setBlockHover(id: number | null): void {
    if (this.hoverBlock === id) return;
    if (this.hoverBlock !== null) this.map.setFeatureState({ source: 'dev-blocks', id: this.hoverBlock }, { hover: false });
    this.hoverBlock = id;
    if (id !== null) this.map.setFeatureState({ source: 'dev-blocks', id }, { hover: true });
  }

  private bindInteractions(): void {
    const canvas = this.map.getCanvas();
    this.map.on('mousemove', (e) => {
      if (this.events.isBlocked() || this.map.isMoving()) return;
      const tower = this.map.queryRenderedFeatures(e.point, { layers: TOWER_LAYERS })[0];
      const block = this.map
        .queryRenderedFeatures(e.point, { layers: BLOCK_LAYERS })
        .find((f) => f.properties.kind === 'unit');
      const towerId = tower ? (tower.id as number) : null;
      if (this.hoverTower !== towerId) {
        if (this.hoverTower !== null) this.map.setFeatureState({ source: 'dev-towers', id: this.hoverTower }, { hover: false });
        this.hoverTower = towerId;
        if (towerId !== null) this.map.setFeatureState({ source: 'dev-towers', id: towerId }, { hover: true });
      }
      this.setBlockHover(block ? (block.id as number) : null);
      if (tower || block) canvas.style.cursor = 'pointer';
    });
    this.map.on('click', (e) => {
      if (this.events.isBlocked()) return;
      const block = this.map
        .queryRenderedFeatures(e.point, { layers: BLOCK_LAYERS })
        .find((f) => f.properties.kind === 'unit');
      if (block) return this.events.onUnitClick(String(block.properties.devId), String(block.properties.unitId));
      const tower = this.map.queryRenderedFeatures(e.point, { layers: TOWER_LAYERS })[0];
      if (tower) this.events.onOpen(String(tower.properties.devId));
    });
  }

  /** True when a development (tower or unit) is under the point: the listing click handler ignores it. */
  isDevelopmentAt(p: { x: number; y: number }): boolean {
    if (!this.developments.length) return false;
    return this.map.queryRenderedFeatures([p.x, p.y], { layers: [...TOWER_LAYERS, ...BLOCK_LAYERS] }).length > 0;
  }
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
