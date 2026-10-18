import { GUARD_MAX_ALTITUDE_M, cameraFix, cameraPosition } from './cameraGuard';
import turfBooleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { AttributionControl, LngLatBounds, Map as MlMap, Marker, NavigationControl } from 'maplibre-gl';
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  MapGeoJSONFeature,
  StyleSpecification,
} from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry, Point, Polygon, MultiPolygon } from 'geojson';
import turfCircle from '@turf/circle';
import turfBbox from '@turf/bbox';
import type { AppData } from '../data/load';
import { OverviewControl } from './overviewControl';
import { DrawAreaControl } from './drawArea';
import type { Listing } from '../data/types';
import type { Theme } from './lighting';
import { M_PER_DEG, shadowOffset, shadowRing } from './shadows';
import {
  BaseStyle,
  type StreetRef,
  streetHighlightFilter,
  CLIP_BUFFER_M,
  CLIP_LAYERS,
  DEFAULT_BUILDING_HEIGHT_M,
  FEATURE_BASE,
  LAMP_CORE_OPACITY,
  LAMP_POOL_OPACITY,
  LAND_HEIGHT_M,
  METERS_PER_FLOOR,
  SHADOW_CASTERS,
  SHADOW_MIN_HEIGHT_M,
  SHADOW_MIN_RADIUS_M,
  SHADOW_RADIUS_M,
  STREET_FONT,
  TEXTURES,
  Z_3D_FULL,
  Z_3D_START,
  Z_SHADOWS,
  Z_STREET_NAMES,
} from './baseStyle';
import { craneParts } from './crane';
import { floorBand, unitStrip } from './unitLayout';
import { osmNumericId } from '../data/osmId';
import interMedium from '@fontsource/inter/files/inter-latin-500-normal.woff2?url';
import { REGION } from '../config/region';

// moved to src/map/baseStyle.ts; still imported from here by the app and the tests
export { streetHighlightFilter, type StreetRef } from './baseStyle';

const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> (ODbL)';
const MAPLIBRE_ATTRIBUTION = '<a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a>';
const CADASTRE_ATTRIBUTION = REGION.cadastre
  ? `Alturas: <a href="${REGION.cadastre.url}" target="_blank" rel="noopener">${REGION.cadastre.label.replace(/^Cadastro/, 'cadastro')}</a>`
  : '';


/** Labels: cities and districts from afar, neighbourhoods in between, none up close. */
const BAIRRO_LABEL_ZOOMS: [number, number] = [12.6, 15];
const CITY_LABEL_MAX_ZOOM = 12.6;

type ListingKind = 'building' | 'land' | 'approx';
interface ListingFeatureProps {
  listingId: string;
  kind: ListingKind;
  height: number;
  matched: boolean;
  /** Under construction: height already built (m); the rest is drawn translucent. */
  built?: number;
  /** A unit (src/map/unitLayout.ts): where its floor starts (m); the building around it is drawn translucent. */
  base?: number;
  /** A unit: the height of its building (for the shadow). */
  shellH?: number;
}

/** Layers whose features are clickable listings (filters keep only matched ones). */
const INTERACTIVE_LAYERS = ['listing-pins', 'listing-buildings', 'listing-unbuilt', 'listing-land', 'listing-approx-fill'];
/** Both listing sources share feature ids, so hover/selected state is mirrored on them. */
const LISTING_SOURCES = ['listings', 'listing-pins'] as const;
/** Pins help find listings in the overview and fade out once the 3D highlight is readable. */
const PIN_FADE_START_ZOOM = 15.5;
const PIN_MAX_ZOOM = 16.5;
/**
 * Pins of the search that would overlap are grouped into one with the count (about twice a pin's width apart),
 * in the 2D overview only: once the 3D buildings show (Z_3D_START) each listing has its own pin, then its building, so a
 * group never covers the building it would open. Dimmed pins are not grouped.
 */
const CLUSTER_RADIUS_PX = 24;
const CLUSTER_MAX_ZOOM = Z_3D_START - 1;
/** Count on the group: dark on the accent, readable by day and by night. */
const CLUSTER_TEXT = '#141b2d';

/** How far from an address point (a point inside its lot) the building of that lot may be. */
const NEAR_BUILDING_M = 12;

/** A context building as the form takes it (osmId, residential flag, height, outline). */
function pickedBuilding(b: MapGeoJSONFeature): PickResult['building'] | undefined {
  if (b.geometry.type !== 'Polygon' && b.geometry.type !== 'MultiPolygon') return undefined;
  return {
    osmId: String(b.properties.osmId),
    residential: b.properties.residential === true,
    height: Number(b.properties.height) || DEFAULT_BUILDING_HEIGHT_M,
    geometry: b.geometry,
  };
}

/** What the user clicked while choosing the place of a new listing ("Anunciar imóvel"). */
export interface PickResult {
  lngLat: [number, number];
  /** Context building under the click, if any (buildings of existing listings are not pickable). */
  building?: { osmId: string; residential: boolean; height: number; geometry: Polygon | MultiPolygon };
  /** Buildings are only pickable up close (3D, zoom ≥ Z_3D_START). */
  tooFar?: boolean;
}

/**
 * Keeps the features whose `key` is not in `ids`. A `match` looks the key up in a table built once, where `in` over a
 * literal list compares it with every id: with 5,000 listed buildings, 20,000 buildings are filtered in about 2 ms
 * instead of 170 ms (scripts/bench-context-filter.mjs), and the filter runs on every tile the map loads.
 */
export function hideFilter(key: ExpressionSpecification, ids: string[] | number[]): ExpressionSpecification {
  const unique = [...new Set<string | number>(ids)] as string[] | number[];
  return unique.length ? ['match', key, unique, false, true] : ['literal', true];
}

/** Colour of the place being chosen for a new listing (distinct from the listing accent). */
const PICK_COLOR = '#2f7de1';
const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

export interface SceneEvents {
  onListingClick: (listingId: string) => void;
  onEmptyClick: () => void;
  /** Clicks on these points belong to another layer (developments): no listing click, no empty click. */
  ignoreClickAt?: (point: { x: number; y: number }) => boolean;
  /** Mouse is over a clickable listing (point in map-container pixels), or left it (null). */
  onListingHover?: (listingId: string | null, point?: { x: number; y: number }) => void;
}

/** Pitch of the opening view: lower on phones, where a steep camera shows mostly sky and hides the far listings. */
const overviewPitch = () => (window.matchMedia('(max-width: 720px)').matches ? 45 : 58);

/** MapLibre's own texts (buttons, and the messages of the embedded map's cooperativeGestures), in Portuguese. */
const MAP_TEXTS = {
  'AttributionControl.ToggleAttribution': 'Mostrar ou esconder os créditos',
  'FullscreenControl.Enter': 'Tela cheia',
  'FullscreenControl.Exit': 'Sair da tela cheia',
  'Map.Title': 'Mapa',
  'Marker.Title': 'Marcador',
  'NavigationControl.ResetBearing': 'Voltar para o norte',
  'NavigationControl.ZoomIn': 'Aproximar',
  'NavigationControl.ZoomOut': 'Afastar',
  'Popup.Close': 'Fechar',
  'CooperativeGesturesHandler.WindowsHelpText': 'Use Ctrl + rolagem para dar zoom no mapa',
  'CooperativeGesturesHandler.MacHelpText': 'Use ⌘ + rolagem para dar zoom no mapa',
  'CooperativeGesturesHandler.MobileHelpText': 'Use dois dedos para mover o mapa',
};

export class Scene {
  readonly map: MlMap;
  private listingFeatures: Feature<Polygon | MultiPolygon, ListingFeatureProps>[] = [];
  /** Listings shown as a unit: their whole building (drawn translucent around the unit), by feature id. */
  private unitShells = new Map<number, { osmId: string; geometry: Polygon | MultiPolygon; height: number }>();
  private featureIdByListing = new Map<string, number>();
  private hoveredId: number | null = null;
  private selectedId: number | null = null;
  private onPick: ((p: PickResult) => void) | null = null;
  private onDraw: ((p: [number, number], screen: { x: number; y: number }) => void) | null = null;
  /** "Desenhar área" button pressed (main.ts starts the drawing). */
  onDrawArea: (() => void) | null = null;
  private listings: Listing[];
  readonly ready: Promise<void>;
  /** Pixels per metre at zoom 0 at the region's latitude (512 px tiles). */
  private readonly pxPerM0: number;
  /** Own filter of each layer before the neighbourhood cut is added. */
  private baseFilters = new Map<string, FilterSpecification | undefined>();
  /** Area the map is cut to (neighbourhood filter), or null. */
  private clip: Polygon | MultiPolygon | null = null;
  private labelMarkers: { marker: Marker; kind: string; name: string }[] = [];
  /** The shadows must be recomputed at the map's next idle moment (camera stopped, sun or listings changed). */
  private shadowsDirty = true;
  private shadowStats: { count: number; ms: number; offset: [number, number] | null } = { count: 0, ms: 0, offset: null };

  constructor(
    container: HTMLElement,
    private data: AppData,
    private theme: Theme,
    private events: SceneEvents,
    listings: Listing[] = data.listings.listings,
    /** Embedded in a page (client site): one finger and the plain wheel scroll the page, not the map. */
    opts: { cooperative?: boolean; drawArea?: boolean } = {},
  ) {
    this.listings = listings;
    this.pxPerM0 = 512 / (40075016.686 * Math.cos(((data.meta.center?.[1] ?? -26.3) * Math.PI) / 180));
    const [w, s, e, n] = data.meta.boundaryBbox;
    // maxBounds: region bbox expanded by 30% of its size on each side
    const padX = (e - w) * 0.3;
    const padY = (n - s) * 0.3;
    this.buildListingFeatures();

    this.map = new MlMap({
      container,
      style: this.buildStyle(),
      bounds: [w, s, e, n],
      fitBoundsOptions: { padding: 40 },
      pitch: overviewPitch(),
      bearing: -20,
      maxPitch: 75,
      cooperativeGestures: !!opts.cooperative,
      locale: MAP_TEXTS,
      minZoom: 9.8,
      maxZoom: 19.5,
      maxBounds: [w - padX, s - padY, e + padX, n + padY],
      attributionControl: false,
    });
    this.map.addControl(new AttributionControl({ compact: false, customAttribution: MAPLIBRE_ATTRIBUTION }), 'bottom-left');
    this.map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right');
    // added after the navigation control: bottom corners stack upwards, so it sits above zoom +/−
    this.map.addControl(new OverviewControl(() => this.showOverview(true)), 'bottom-right');
    if (opts.drawArea) this.map.addControl(new DrawAreaControl(() => this.onDrawArea?.()), 'bottom-right');

    this.showOverview(false);

    this.ready = new Promise((resolve) =>
      this.map.once('load', () => {
        // frame again: the container can change size while the page lays out (banner, panels)
        this.showOverview(false);
        resolve();
      }),
    );
    // While the camera flies, MapLibre sometimes asks the base map for a tile beyond the archive's zoom 15
    // and that request fails ("Failed to fetch"); the tile is dropped and the overzoomed z15 tile is shown.
    // Those go to the console as warnings; any other map error stays an error.
    this.map.on('error', (e) => {
      const { error, sourceId } = e as unknown as { error?: Error; sourceId?: string };
      // tiles of the base map or of its close-up detail requested past z15 during camera flights (see README)
      if (sourceId === 'osm' || sourceId === 'detail') console.warn(`Bloco do mapa base não carregado: ${error?.message ?? error}`);
      else console.error(error ?? e);
    });
    // textures of water, paving stones and dirt roads: drawn when a layer first needs them
    this.map.setMissingStyleImageResolver((id) => {
      const img = this.baseStyle().texture(id);
      if (img && !this.map.hasImage(id)) this.map.addImage(id, img, { pixelRatio: 2 });
    });
    this.bindInteractions();
    this.addBairroLabels();
    // the shadows follow the camera: recomputed once the tiles it moved to are loaded
    this.map.on('moveend', (e) => {
      this.shadowsDirty = true;
      if (!(e as { cameraGuard?: boolean }).cameraGuard) this.guardCamera();
    });
    this.map.on('idle', () => this.updateShadows());
  }

  // ---------------------------------------------------------------- building shadows

  /** Last shadow computation: shadows drawn, time taken (ms) and the sun's offset (for scripts/e2e-check.mjs). */
  get shadowInfo(): { count: number; ms: number; offset: [number, number] | null } {
    return this.shadowStats;
  }

  /** Recomputes the shadows at the map's next idle moment (after the frame that shows the change). */
  private invalidateShadows(): void {
    this.shadowsDirty = true;
    this.map.triggerRepaint();
  }

  private updateShadows(): void {
    const source = this.map.getSource('shadows') as GeoJSONSource | undefined;
    if (!this.shadowsDirty || !source) return;
    this.shadowsDirty = false;
    const t0 = performance.now();
    const sun = this.theme.sun;
    const offset = sun && this.map.getZoom() >= Z_SHADOWS ? shadowOffset(sun, this.map.getCenter().lat) : null;
    const features = offset ? this.castShadows(offset) : [];
    if (features.length || this.shadowStats.count) source.setData({ type: 'FeatureCollection', features });
    this.shadowStats = { count: features.length, ms: Math.round(performance.now() - t0), offset };
  }

  /** Shadows of the volumes of SHADOW_CASTERS near the map centre, from the tiles already loaded. */
  private castShadows(offset: [number, number]): Feature<Polygon>[] {
    const m = this.map;
    const { lng, lat } = m.getCenter();
    const kx = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
    const radius = Math.max(SHADOW_MIN_RADIUS_M, SHADOW_RADIUS_M * 2 ** (Z_SHADOWS - m.getZoom()));
    const near = (x: number, y: number) => Math.hypot((x - lng) * kx, (y - lat) * M_PER_DEG) <= radius;
    // tiles wholly beyond the radius are skipped without reading their features' geometry
    const tileNear = new Map<string, boolean>();
    const inReach = ({ z, x, y }: { z: number; x: number; y: number }): boolean => {
      const key = `${z}/${x}/${y}`;
      let ok = tileNear.get(key);
      if (ok === undefined) {
        const n = 2 ** z;
        const lat2 = (j: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
        const cx = Math.min(Math.max(lng, (x / n) * 360 - 180), ((x + 1) / n) * 360 - 180);
        const cy = Math.min(Math.max(lat, lat2(y + 1)), lat2(y));
        ok = near(cx, cy);
        tileNear.set(key, ok);
      }
      return ok;
    };
    const out: Feature<Polygon>[] = [];
    for (const { layer, height } of SHADOW_CASTERS) {
      const l = m.getLayer(layer);
      if (!l || m.getLayoutProperty(layer, 'visibility') === 'none') continue;
      // the layer's own filter (hidden listing buildings), without the bairro cut: the mask covers what is beyond
      const filter = this.baseFilters.has(layer) ? this.baseFilters.get(layer) : m.getFilter(layer);
      for (const f of m.querySourceFeatures(l.source, { sourceLayer: l.sourceLayer, filter: filter ?? undefined })) {
        const h = height(f.properties);
        const tile = (f as { tile?: { z: number; x: number; y: number } }).tile;
        if (!(h >= SHADOW_MIN_HEIGHT_M) || (tile && !inReach(tile))) continue;
        const g = f.geometry;
        for (const rings of g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) {
          if (!near(rings[0][0][0], rings[0][0][1])) continue;
          const ring = shadowRing(rings[0], h, offset);
          if (ring) out.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } });
        }
      }
    }
    return out;
  }


  /**
   * Place names as HTML labels: cities/districts from afar, then neighbourhoods (street names, closer, are drawn by
   * the style: 'road-names').
   */
  private addBairroLabels(): void {
    const labels = this.data.bairros.features.map((f) => {
      const kind = f.properties.kind ?? 'bairro';
      const el = document.createElement('div');
      el.className = `bairro-label kind-${kind}`;
      el.textContent = f.properties.name;
      const marker = new Marker({ element: el }).setLngLat(f.geometry.coordinates as [number, number]).addTo(this.map);
      return { marker, kind, name: f.properties.name };
    });
    this.labelMarkers = labels;
    this.map.on('zoomend', () => this.updateLabels());
    this.updateLabels();
  }

  /** Neighbourhood labels by zoom; with the map cut to some neighbourhoods, only theirs. */
  private clipNames: Set<string> | null = null;
  private updateLabels(): void {
    const z = this.map.getZoom();
    for (const { marker, kind, name } of this.labelMarkers) {
      let show = kind === 'bairro' ? z >= BAIRRO_LABEL_ZOOMS[0] && z < BAIRRO_LABEL_ZOOMS[1] : z < CITY_LABEL_MAX_ZOOM;
      if (this.clipNames) show = kind === 'bairro' && this.clipNames.has(name) && z < BAIRRO_LABEL_ZOOMS[1];
      marker.getElement().classList.toggle('is-hidden', !show);
    }
  }

  // ---------------------------------------------------------------- style

  /**
   * Listing buildings are drawn by the listing layers, not as grey context; buildings on the plot of a
   * development are hidden (replaced by its tower).
   */
  private contextFilter(): ExpressionSpecification {
    return hideFilter(['get', 'osmId'], this.contextHiddenIds());
  }

  /** The same for the roofs, which carry the building as a numeric feature id (src/data/osmId.ts). */
  private roofFilter(): ExpressionSpecification {
    return hideFilter(['id'], this.contextHiddenIds().map(osmNumericId));
  }

  private contextHiddenIds(): string[] {
    return [
      ...this.listings.filter((l) => l.buildingOsmId && !l.approximateLocation).map((l) => l.buildingOsmId!),
      ...this.data.developments.flatMap((d) => d.hiddenBuildingIds),
    ];
  }


  /** The base map's layers for the current theme (src/map/baseStyle.ts). */
  private baseStyle(): BaseStyle {
    return new BaseStyle(this.theme, this.data, this.pxPerM0, this.baseFilters, {
      contextFilter: () => this.contextFilter(),
      roofFilter: () => this.roofFilter(),
    });
  }

  private buildStyle(): StyleSpecification {
    const t = this.theme;
    const base = this.baseStyle();
    const matchedFilter: ExpressionSpecification = ['==', ['get', 'matched'], true];
    const dimFilter: ExpressionSpecification = ['==', ['get', 'matched'], false];
    const hoverColor = (base: string): ExpressionSpecification => [
      'case',
      ['any', ['boolean', ['feature-state', 'hover'], false], ['boolean', ['feature-state', 'selected'], false]],
      t.accentHover,
      base,
    ];

    return {
      version: 8,
      // No sprites and no glyphs URL: the only text, the street names, is drawn from this font file (absolute URL,
      // resolved as the data files are: the page may live in a subfolder or an iframe).
      // Its latin subset covers the names; any other letter falls back to the browser's sans-serif.
      'font-faces': { [STREET_FONT]: new URL(interMedium, location.href).href },
      // Base map: one local PMTiles file (vector tiles, loaded by range requests).
      sources: {
        osm: {
          type: 'vector',
          url: `pmtiles://${this.data.tilesUrl}`,
          // also stated here (the archive says the same): without it, tiles requested before the archive
          // header is read use the default maxzoom and fail at z16+
          minzoom: 10,
          maxzoom: 15,
          attribution: (this.data.meta.heightSources?.length ?? 0) > 1 ? `${OSM_ATTRIBUTION} · ${CADASTRE_ATTRIBUTION}` : OSM_ATTRIBUTION,
        },
        // close-up detail (roofs, trees, street lamps): a second file, read only from zoom 15
        ...(this.data.detailUrl
          ? { detail: { type: 'vector' as const, url: `pmtiles://${this.data.detailUrl}`, minzoom: 15, maxzoom: 15 } }
          : {}),
        boundary: { type: 'geojson', data: this.data.boundary },
        listings: { type: 'geojson', data: this.listingCollection() },
        'listing-pins': {
          type: 'geojson',
          data: this.pinCollection(true),
          cluster: true,
          clusterRadius: CLUSTER_RADIUS_PX,
          clusterMaxZoom: CLUSTER_MAX_ZOOM,
        },
        'listing-pins-dimmed': { type: 'geojson', data: this.pinCollection(false) },
        // buildings under construction: the part still to build (translucent) and a tower crane
        construction: { type: 'geojson', data: this.constructionCollection() },
        'pick-preview': { type: 'geojson', data: EMPTY_FC },
        'pick-unit': { type: 'geojson', data: EMPTY_FC },
        // neighbourhood(s) the map is cut to (filter "bairro"), and the ground outside them plus 100 m (masked)
        'clip-area': { type: 'geojson', data: EMPTY_FC },
        'clip-mask': { type: 'geojson', data: EMPTY_FC },
        // the area being drawn ("Desenhar área"): its sides and corners
        'draw-area': { type: 'geojson', data: EMPTY_FC },
        // building shadows by day (updateShadows)
        shadows: { type: 'geojson', data: EMPTY_FC, maxzoom: 16 },
      },
      light: { anchor: 'map', ...t.light },
      sky: { 'sky-color': t.sky.sky, 'horizon-color': t.sky.horizon, 'fog-color': t.sky.horizon },
      layers: [
        ...base.baseLayers(t),
        {
          id: 'clip-line',
          type: 'line',
          source: 'clip-area',
          paint: { 'line-color': t.accentStrong, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 17, 3.5], 'line-opacity': 0.85 },
        },
        {
          id: 'draw-fill',
          type: 'fill',
          source: 'draw-area',
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': t.accentStrong, 'fill-opacity': 0.14 },
        },
        {
          id: 'draw-line',
          type: 'line',
          source: 'draw-area',
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: { 'line-color': t.accentStrong, 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
        },
        {
          id: 'draw-points',
          type: 'circle',
          source: 'draw-area',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: { 'circle-radius': ['case', ['get', 'first'], 7, 5], 'circle-color': '#fff', 'circle-stroke-color': t.accentStrong, 'circle-stroke-width': 2.5 },
        },
        {
          id: 'listing-dimmed',
          type: 'fill-extrusion',
          source: 'listings',
          filter: ['all', dimFilter, ['in', ['get', 'kind'], ['literal', ['building', 'land']]]],
          paint: {
            'fill-extrusion-color': t.dimmed,
            'fill-extrusion-base': FEATURE_BASE,
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-opacity': 0.4,
          },
        },
        {
          // the building of a dimmed listing shown as a unit
          id: 'listing-shell-dimmed',
          type: 'fill-extrusion',
          source: 'construction',
          filter: ['all', ['==', ['get', 'shell'], true], ['==', ['get', 'matched'], false]],
          paint: {
            'fill-extrusion-color': t.dimmed,
            'fill-extrusion-height': ['get', 'h'],
            'fill-extrusion-opacity': 0.25,
          },
        },
        {
          id: 'listing-land',
          type: 'fill-extrusion',
          source: 'listings',
          filter: ['all', matchedFilter, ['==', ['get', 'kind'], 'land']],
          paint: {
            'fill-extrusion-color': hoverColor(t.land),
            'fill-extrusion-base': FEATURE_BASE,
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-opacity': 0.95,
          },
        },
        {
          id: 'listing-buildings',
          type: 'fill-extrusion',
          source: 'listings',
          filter: ['all', matchedFilter, ['==', ['get', 'kind'], 'building']],
          paint: {
            'fill-extrusion-color': hoverColor(t.accent),
            'fill-extrusion-base': FEATURE_BASE,
            // under construction: only what is built is solid
            'fill-extrusion-height': ['coalesce', ['get', 'built'], ['get', 'height']],
            'fill-extrusion-opacity': 1,
            // no darkening towards the base: keeps the highlight colour readable on shaded faces
            'fill-extrusion-vertical-gradient': false,
          },
        },
        {
          // the floors still to build, translucent over the built part
          id: 'listing-unbuilt',
          type: 'fill-extrusion',
          source: 'construction',
          filter: ['all', ['==', ['get', 'part'], 'ghost'], ['==', ['get', 'matched'], true]],
          paint: {
            'fill-extrusion-color': hoverColor(t.accent),
            'fill-extrusion-base': ['get', 'b'],
            'fill-extrusion-height': ['get', 'h'],
            'fill-extrusion-opacity': 0.28,
            'fill-extrusion-vertical-gradient': false,
          },
        },
        {
          id: 'construction-cranes',
          type: 'fill-extrusion',
          source: 'construction',
          minzoom: Z_3D_START,
          filter: ['==', ['get', 'part'], 'crane'],
          paint: {
            'fill-extrusion-color': ['case', ['==', ['get', 'matched'], true], t.scenery.crane, t.dimmed],
            'fill-extrusion-base': ['get', 'b'],
            'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], Z_3D_START, 0, Z_3D_FULL, ['get', 'h']],
            'fill-extrusion-vertical-gradient': false,
          },
        },
        {
          id: 'listing-outline',
          type: 'line',
          source: 'listings',
          filter: ['all', matchedFilter, ['!=', ['get', 'kind'], 'approx']],
          paint: { 'line-color': t.accentStrong, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.5, 18, 3] },
        },
        {
          id: 'listing-approx-fill',
          type: 'fill',
          source: 'listings',
          filter: ['==', ['get', 'kind'], 'approx'],
          paint: {
            'fill-color': [
              'case',
              ['==', ['get', 'matched'], false],
              t.dimmed,
              ['boolean', ['feature-state', 'hover'], false],
              t.accentHover,
              t.accent,
            ],
            'fill-opacity': ['case', ['==', ['get', 'matched'], false], 0.12, 0.25],
          },
        },
        {
          id: 'listing-approx-line',
          type: 'line',
          source: 'listings',
          filter: ['==', ['get', 'kind'], 'approx'],
          paint: {
            'line-color': ['case', ['==', ['get', 'matched'], false], t.dimmed, t.accent],
            'line-width': 2,
            'line-dasharray': [2, 2],
          },
        },
        {
          id: 'pick-preview',
          type: 'fill-extrusion',
          source: 'pick-preview',
          paint: {
            'fill-extrusion-color': PICK_COLOR,
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-opacity': 0.9,
            'fill-extrusion-vertical-gradient': false,
          },
        },
        {
          // the unit chosen in the building (the building turns translucent around it)
          id: 'pick-unit',
          type: 'fill-extrusion',
          source: 'pick-unit',
          paint: {
            'fill-extrusion-color': PICK_COLOR,
            'fill-extrusion-base': ['get', 'base'],
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-opacity': 1,
            'fill-extrusion-vertical-gradient': false,
          },
        },
        {
          id: 'listing-pins-dimmed',
          type: 'circle',
          source: 'listing-pins-dimmed',
          maxzoom: PIN_MAX_ZOOM,
          filter: dimFilter,
          paint: {
            'circle-color': t.dimmed,
            'circle-radius': 4.5,
            'circle-stroke-color': t.pinStroke,
            'circle-stroke-width': 1.5,
            'circle-opacity': this.pinFade(0.9),
            'circle-stroke-opacity': this.pinFade(0.9),
          },
        },
        // over the 3D layers (developments are added before 'listing-pins-dimmed'), under the listing pins
        base.streetNamesLayer(t),
        {
          id: 'listing-pins',
          type: 'circle',
          source: 'listing-pins',
          maxzoom: PIN_MAX_ZOOM,
          filter: matchedFilter,
          paint: {
            'circle-color': hoverColor(t.accent),
            'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 9, 7],
            'circle-stroke-color': t.pinStroke,
            'circle-stroke-width': 2,
            'circle-opacity': this.pinFade(1),
            'circle-stroke-opacity': this.pinFade(1),
          },
        },
        {
          id: 'listing-clusters',
          type: 'circle',
          source: 'listing-pins',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': t.accent,
            'circle-radius': ['step', ['get', 'point_count'], 11, 10, 14, 50, 18],
            'circle-stroke-color': t.pinStroke,
            'circle-stroke-width': 2,
          },
        },
        {
          id: 'listing-cluster-count',
          type: 'symbol',
          source: 'listing-pins',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': [STREET_FONT],
            'text-size': 12,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: { 'text-color': CLUSTER_TEXT },
        },
      ],
    };
  }

  // ---------------------------------------------------------------- listings

  private buildListingFeatures(): void {
    this.listingFeatures = [];
    this.featureIdByListing.clear();
    this.unitShells.clear();
    this.listings.forEach((l, i) => {
      const id = i + 1;
      this.featureIdByListing.set(l.id, id);
      let geometry: Polygon | MultiPolygon;
      let kind: ListingKind;
      let height: number;
      if (l.approximateLocation && l.approxCenter) {
        geometry = turfCircle(l.approxCenter, (l.approxRadiusM ?? 150) / 1000, { steps: 64, units: 'kilometers' }).geometry;
        kind = 'approx';
        height = 0;
      } else if (l.type === 'land' && l.lotPolygon) {
        geometry = l.lotPolygon;
        kind = 'land';
        height = LAND_HEIGHT_M;
      } else {
        if (!l.footprint) return;
        geometry = l.footprint;
        kind = 'building';
        height = l.floors ? l.floors * METERS_PER_FLOOR : (l.buildingHeightM ?? DEFAULT_BUILDING_HEIGHT_M);
      }
      const props: ListingFeatureProps = { listingId: l.id, kind, height, matched: true };
      if (kind === 'building' && l.status === 'under_construction' && l.construction)
        props.built = Math.min(height, l.construction.floorsBuilt * METERS_PER_FLOOR);
      else if (kind === 'building' && l.unitPosition && l.unitsPerFloor && l.unitFloor !== undefined) {
        // listed by the unit: only its floor and stretch of the building is highlighted
        const strip = unitStrip(geometry, l.unitPosition, l.unitsPerFloor);
        if (strip) {
          const { base, top } = floorBand(l.unitFloor, l.floors ? height / l.floors : METERS_PER_FLOOR);
          this.unitShells.set(id, { osmId: l.buildingOsmId ?? l.id, geometry, height });
          geometry = strip;
          props.base = base;
          props.height = Math.min(top, height);
          props.shellH = height;
        }
      }
      this.listingFeatures.push({ type: 'Feature', id, properties: props, geometry });
    });
  }

  private pinFade(max: number): ExpressionSpecification {
    return ['interpolate', ['linear'], ['zoom'], PIN_FADE_START_ZOOM, max, PIN_MAX_ZOOM, 0];
  }

  /**
   * One point per listing at the centre of its highlighted shape (same feature ids as `listings`): those of the search
   * (grouped when close) or the dimmed ones.
   */
  private pinCollection(matched: boolean): FeatureCollection<Point, ListingFeatureProps> {
    return {
      type: 'FeatureCollection',
      features: this.listingFeatures.filter((f) => f.properties.matched === matched).map((f) => {
        const [w, s, e, n] = turfBbox(f);
        return {
          type: 'Feature',
          id: f.id,
          properties: f.properties,
          geometry: { type: 'Point', coordinates: [(w + e) / 2, (s + n) / 2] },
        };
      }),
    };
  }

  private updatePins(): void {
    (this.map.getSource('listing-pins') as GeoJSONSource | undefined)?.setData(this.pinCollection(true));
    (this.map.getSource('listing-pins-dimmed') as GeoJSONSource | undefined)?.setData(this.pinCollection(false));
  }

  private listingCollection(): FeatureCollection<Polygon | MultiPolygon, ListingFeatureProps> {
    return { type: 'FeatureCollection', features: this.listingFeatures };
  }

  /**
   * Buildings under construction: the floors still to build (same feature id as the listing, so hovering it
   * highlights the listing) and a tower crane beside the built part.
   */
  private constructionCollection(): FeatureCollection {
    const features: Feature[] = [];
    for (const f of this.listingFeatures) {
      const p = f.properties;
      if (p.built === undefined) continue;
      if (p.built < p.height)
        features.push({ type: 'Feature', id: f.id, properties: { part: 'ghost', listingId: p.listingId, matched: p.matched, kind: 'building', b: p.built, h: p.height }, geometry: f.geometry });
      const [w, s, e, n] = turfBbox(f);
      // the crane stands at a corner of the building, pointing over it
      const seed = [...p.listingId].reduce((a, c) => a + c.charCodeAt(0), 0);
      features.push(...craneParts([w + (e - w) * 0.15, s + (n - s) * 0.2], p.height, (seed % 360) * (Math.PI / 180), { part: 'crane', matched: p.matched }));
    }
    // listings shown as a unit: the building around them, translucent (once per building, matched first)
    const shells = new Map<string, Feature>();
    for (const f of [...this.listingFeatures].sort((a, b) => Number(b.properties.matched) - Number(a.properties.matched))) {
      const shell = this.unitShells.get(f.id as number);
      if (!shell || shells.has(shell.osmId)) continue;
      const p = f.properties;
      shells.set(shell.osmId, { type: 'Feature', id: f.id, properties: { part: 'ghost', shell: true, listingId: p.listingId, matched: p.matched, kind: 'building', b: 0, h: shell.height }, geometry: shell.geometry });
    }
    features.push(...shells.values());
    return { type: 'FeatureCollection', features };
  }

  /** Marks which listings match the applied filters (others are dimmed and not clickable). */
  setMatched(matchedIds: Set<string>): void {
    for (const f of this.listingFeatures) f.properties.matched = matchedIds.has(f.properties.listingId);
    (this.map.getSource('listings') as GeoJSONSource | undefined)?.setData(this.listingCollection());
    this.updatePins();
    (this.map.getSource('construction') as GeoJSONSource | undefined)?.setData(this.constructionCollection());
    this.setHover(null);
    this.invalidateShadows();
  }

  /** Replaces the listings shown on the map (e.g. after one is added or removed in this browser). */
  setListings(listings: Listing[]): void {
    this.setHover(null);
    this.select(null);
    this.listings = listings;
    this.buildListingFeatures();
    for (const source of LISTING_SOURCES) this.map.removeFeatureState({ source });
    (this.map.getSource('listings') as GeoJSONSource | undefined)?.setData(this.listingCollection());
    this.updatePins();
    (this.map.getSource('construction') as GeoJSONSource | undefined)?.setData(this.constructionCollection());
    for (const id of ['context-buildings', 'buildings-flat', 'roofs']) {
      this.baseFilters.set(id, id === 'roofs' ? this.roofFilter() : this.contextFilter());
      this.applyFilter(id);
    }
    this.invalidateShadows();
  }

  // ---------------------------------------------------------------- neighbourhood cut ("bairro" filter)

  /** The layer's own filter, plus "within CLIP_BUFFER_M of the chosen area" while the map is cut. */
  private applyFilter(id: string): void {
    if (!this.map.getLayer(id)) return;
    if (!this.baseFilters.has(id)) this.baseFilters.set(id, (this.map.getFilter(id) ?? undefined) as FilterSpecification | undefined);
    const base = this.baseFilters.get(id);
    const cut: FilterSpecification | null = this.clip
      ? ['<=', ['distance', { type: 'Feature', properties: {}, geometry: this.clip }], CLIP_BUFFER_M]
      : null;
    this.map.setFilter(id, cut ? (base ? (['all', base, cut] as FilterSpecification) : cut) : (base ?? null));
  }

  /**
   * Cuts the map to an area (the chosen neighbourhoods) plus CLIP_BUFFER_M around it: buildings, streets, trees and
   * the other listings further away disappear, so the neighbourhood and its edges stand out. null shows everything.
   */
  setClip(area: Polygon | MultiPolygon | null, names: string[] = [], mask: Polygon | MultiPolygon | null = null): void {
    const same = JSON.stringify(area) === JSON.stringify(this.clip);
    (this.map.getSource('clip-mask') as GeoJSONSource | undefined)?.setData(
      area && mask ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: mask }] } : EMPTY_FC,
    );
    this.clip = area;
    this.clipNames = area ? new Set(names) : null;
    if (!same) for (const id of CLIP_LAYERS) this.applyFilter(id);
    // the chosen area has its own outline: hide the other neighbourhoods' and the region's
    for (const id of ['bairros-line', 'boundary-line']) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', area ? 'none' : 'visible');
    (this.map.getSource('clip-area') as GeoJSONSource | undefined)?.setData(
      area ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: area }] } : EMPTY_FC,
    );
    this.updateLabels();
  }

  get clipped(): boolean {
    return this.clip !== null;
  }

  /** Frames the area the map is cut to. */
  fitToClip(): void {
    if (!this.clip) return;
    const [w, s, e, n] = turfBbox(this.clip);
    this.map.fitBounds([w, s, e, n], { padding: this.cameraPadding(), maxZoom: 16.5, pitch: 55, duration: 1200 });
  }

  // ---------------------------------------------------------------- drawing the search area

  /** Map clicks go to `onPoint` (a corner of the area) until `stopDrawing()`. */
  startDrawing(onPoint: (p: [number, number], screen: { x: number; y: number }) => void): void {
    this.onDraw = onPoint;
    this.setHover(null);
    this.events.onListingHover?.(null);
    this.map.getCanvas().style.cursor = 'crosshair';
    // quick clicks on corners must not zoom
    this.map.doubleClickZoom.disable();
  }

  get isDrawing(): boolean {
    return this.onDraw !== null;
  }

  stopDrawing(): void {
    // after the other click handlers of this click (the developments' too: the click closing the area is not theirs)
    const ended = this.onDraw;
    setTimeout(() => {
      if (this.onDraw === ended) this.onDraw = null;
    });
    this.map.getCanvas().style.cursor = '';
    this.map.doubleClickZoom.enable();
  }

  /** The corners drawn so far: their points, the open path and, from 3 corners, the area filled. */
  showDrawing(points: [number, number][]): void {
    const f = (geometry: Geometry, properties: Record<string, unknown> = {}): Feature => ({ type: 'Feature', properties, geometry });
    const features: Feature[] = points.map((p, i) => f({ type: 'Point', coordinates: p }, { first: i === 0 }));
    if (points.length >= 2) features.push(f({ type: 'LineString', coordinates: points.length >= 3 ? [...points, points[0]] : points }));
    if (points.length >= 3) features.push(f({ type: 'Polygon', coordinates: [[...points, points[0]]] }));
    (this.map.getSource('draw-area') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  project(p: [number, number]): { x: number; y: number } {
    const { x, y } = this.map.project(p);
    return { x, y };
  }

  /** The part of the map on screen, as a rectangle (with the camera tilted, the box around what is seen). */
  visibleRing(): [number, number][] {
    const b = this.map.getBounds();
    return [
      [b.getWest(), b.getSouth()],
      [b.getEast(), b.getSouth()],
      [b.getEast(), b.getNorth()],
      [b.getWest(), b.getNorth()],
    ];
  }

  // ---------------------------------------------------------------- choosing a place for a new listing

  /** Next map click is reported to `onPick` instead of opening listings, until `stopPicking()`. */
  startPicking(onPick: (p: PickResult) => void): void {
    this.onPick = onPick;
    this.setHover(null);
    this.events.onListingHover?.(null);
    this.map.getCanvas().style.cursor = 'crosshair';
  }

  /**
   * The map building at a point found without a click (address typed, coordinates pasted): flies there in 3D, waits
   * for the tiles and takes the building under the point, else the nearest one within NEAR_BUILDING_M. `listingId`:
   * the point falls on a building that already has a listing (those are not context buildings).
   */
  async buildingAt(lngLat: [number, number]): Promise<{ building?: PickResult['building']; listingId?: string }> {
    this.flyToPoint(lngLat);
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 8000);
      this.map.once('idle', () => {
        clearTimeout(t);
        resolve();
      });
    });
    const p = this.map.project(lngLat);
    const pt: Feature<Point> = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: lngLat } };
    const listed = this.queryListing(p);
    if (listed && listed.properties.kind !== 'approx') return { listingId: String(listed.properties.listingId) };
    const r = NEAR_BUILDING_M / this.metersPerPixel();
    const around = this.map
      .queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: ['context-buildings'] })
      .filter((f) => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
    const inside = around.find((f) => turfBooleanPointInPolygon(pt, f as Feature<Polygon | MultiPolygon>));
    const dist = (f: MapGeoJSONFeature) => {
      const [w, s, e, n] = turfBbox(f);
      const c = this.map.project([(w + e) / 2, (s + n) / 2]);
      return Math.hypot(c.x - p.x, c.y - p.y);
    };
    const nearest = inside ?? around.sort((a, b) => dist(a) - dist(b))[0];
    const building = nearest && pickedBuilding(nearest);
    return building ? { building } : {};
  }

  /** Close-up of a point in 3D (a place found by the address). */
  flyToPoint(lngLat: [number, number]): void {
    this.map.flyTo({ center: lngLat, zoom: 17.6, pitch: 55, duration: 900, padding: this.cameraPadding() });
  }

  /** Metres per screen pixel at the centre of the map (Web Mercator). */
  private metersPerPixel(): number {
    const lat = this.map.getCenter().lat;
    return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** this.map.getZoom());
  }

  stopPicking(): void {
    this.onPick = null;
    this.map.getCanvas().style.cursor = '';
  }

  get isPicking(): boolean {
    return this.onPick !== null;
  }

  /** Shows (or clears) the shape chosen for the new listing, extruded to `height` metres. */
  setPickPreview(geometry: Polygon | MultiPolygon | null, height = 0.5): void {
    const fc: FeatureCollection = geometry
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { height }, geometry }] }
      : EMPTY_FC;
    (this.map.getSource('pick-preview') as GeoJSONSource | undefined)?.setData(fc);
  }

  /** Shows (or clears) the unit chosen in the previewed building, from `base` to `height` metres. */
  setPickUnit(geometry: Polygon | MultiPolygon | null, base = 0, height = 0): void {
    const fc: FeatureCollection = geometry
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { base, height }, geometry }] }
      : EMPTY_FC;
    (this.map.getSource('pick-unit') as GeoJSONSource | undefined)?.setData(fc);
    if (this.map.getLayer('pick-preview')) this.map.setPaintProperty('pick-preview', 'fill-extrusion-opacity', geometry ? 0.3 : 0.9);
  }

  /** After a move: lifts the camera when it ended up inside or just above a building (see cameraGuard.ts). */
  /** Where the camera is: its point on the ground and its height (m). */
  camera(): { lngLat: [number, number]; altitudeM: number } {
    const c = this.map.getCenter();
    return cameraPosition([c.lng, c.lat], this.map.getZoom(), this.map.getPitch(), this.map.getBearing(),
      this.map.getVerticalFieldOfView(), this.map.getContainer().clientHeight);
  }

  private guardCamera(): void {
    // "Ver a vista da janela" (DevelopmentLayer.viewFrom) puts the camera at the window on purpose, with the
    // pitch limit raised to 85°
    if (this.map.getMaxPitch() > 75) return;
    const cam = this.camera();
    const altitude = cam.altitudeM;
    if (altitude >= GUARD_MAX_ALTITUDE_M) return;
    const [lng, lat] = cam.lngLat;
    const d = 0.0002; // ≈ 20 m around the camera
    let roof = 0;
    for (const f of this.tileFeaturesIn('buildings', [lng - d, lat - d, lng + d, lat + d])) roof = Math.max(roof, Number(f.properties?.height) || 0);
    const fix = cameraFix(altitude, this.map.getPitch(), roof);
    if (fix) this.map.easeTo({ pitch: fix.pitch, zoom: this.map.getZoom() + fix.zoomBy, duration: 500 }, { cameraGuard: true });
  }

  /** Features of a tile layer in the loaded tiles around `bbox` (used to check where a new lot fits). */
  tileFeaturesIn(sourceLayer: string, bbox: [number, number, number, number]): Feature<Geometry>[] {
    const out: Feature<Geometry>[] = [];
    for (const f of this.map.querySourceFeatures('osm', { sourceLayer })) {
      const g = f.geometry;
      const [w, s, e, n] = turfBbox(g);
      if (w <= bbox[2] && e >= bbox[0] && s <= bbox[3] && n >= bbox[1]) out.push({ type: 'Feature', properties: f.properties, geometry: g });
    }
    return out;
  }

  /** Name of the neighbourhood containing the point (from the loaded tiles), or null. */
  bairroAt([x, y]: [number, number]): string | null {
    const d = 0.0005;
    for (const f of this.tileFeaturesIn('bairros', [x - d, y - d, x + d, y + d])) {
      const g = f.geometry;
      if ((g.type === 'Polygon' || g.type === 'MultiPolygon') && turfBooleanPointInPolygon([x, y], g))
        return (f.properties?.name as string | undefined) ?? null;
    }
    return null;
  }

  listingBounds(listing: Listing): [number, number, number, number] | null {
    const f = this.listingFeatures.find((x) => x.properties.listingId === listing.id);
    return f ? (turfBbox(f) as [number, number, number, number]) : null;
  }

  /** Initial framing: every listing (pitched camera), so none starts off-screen. Also the "Visão geral" button. */
  showOverview(animate: boolean): void {
    const all = this.unionBounds(this.listings);
    if (!all) return;
    this.map.fitBounds(all, { padding: this.cameraPadding(), pitch: overviewPitch(), bearing: -20, animate, duration: 1200 });
  }

  private unionBounds(listings: Listing[]): LngLatBounds | null {
    const b = new LngLatBounds();
    for (const l of listings) {
      const bb = this.listingBounds(l);
      if (bb) b.extend([bb[0], bb[1]]).extend([bb[2], bb[3]]);
    }
    return b.isEmpty() ? null : b;
  }

  fitToListings(listings: Listing[]): void {
    const b = this.unionBounds(listings);
    if (!b) return;
    this.map.fitBounds(b, { padding: this.cameraPadding(), maxZoom: 17.5, pitch: 55, duration: 1200 });
  }

  flyToListing(listing: Listing): void {
    const bb = this.listingBounds(listing);
    if (!bb) return;
    this.map.fitBounds(bb, { padding: this.cameraPadding(), maxZoom: 17.5, pitch: 58, duration: 1200 });
  }

  /**
   * Frames a street chosen in the search: its whole length when that still shows the street names (zoom
   * Z_STREET_NAMES and closer), otherwise a close-up of `point` (a point on the street) at which they show.
   * `extra.bottom` (px) is added to the bottom padding (e.g. a card over the bottom of the map on phones): the street
   * is framed in the part of the map above it.
   */
  frameStreet(bbox: [number, number, number, number], point: [number, number], extra: { bottom?: number } = {}): void {
    const below = Math.max(0, extra.bottom ?? 0);
    const base = this.cameraPadding();
    const padding = { ...base, bottom: base.bottom + below };
    const camera = this.map.cameraForBounds(bbox, { padding });
    if (camera?.zoom !== undefined && camera.zoom >= Z_STREET_NAMES)
      this.map.fitBounds(bbox, { padding, maxZoom: 17.5, pitch: 55, duration: 1200 });
    else
      this.map.flyTo({
        center: point,
        zoom: Z_STREET_NAMES + 0.3,
        pitch: 55,
        duration: 1200,
        // the point in the middle of the part of the map above the card (cameraPadding clears it at the next framing)
        ...(below ? { padding: { top: 0, left: 0, right: 0, bottom: below } } : {}),
      });
  }

  /** Lights the street chosen in the search (only its own segments, see streetHighlightFilter); null clears it. */
  highlightStreet(street: StreetRef | null): void {
    this.map.setFilter('road-highlight', streetHighlightFilter(street));
  }

  /**
   * Padding for framing. Clears the map's own padding first: a padding passed to flyTo elsewhere
   * (development close-ups) stays on the map and would add up with this one.
   */
  private cameraPadding() {
    this.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    const mobile = window.matchMedia('(max-width: 720px)').matches;
    // desktop: the results list occupies ~320 px on the left
    return mobile ? { top: 80, bottom: 120, left: 30, right: 30 } : { top: 120, bottom: 60, left: 340, right: 60 };
  }

  select(listingId: string | null): void {
    if (this.selectedId !== null) this.setListingState(this.selectedId, { selected: false });
    this.selectedId = listingId ? (this.featureIdByListing.get(listingId) ?? null) : null;
    if (this.selectedId !== null) this.setListingState(this.selectedId, { selected: true });
  }

  // ---------------------------------------------------------------- theme

  setTheme(t: Theme): void {
    this.theme = t;
    const base = this.baseStyle();
    const m = this.map;
    const listingBuildingHover: ExpressionSpecification = [
      'case',
      ['any', ['boolean', ['feature-state', 'hover'], false], ['boolean', ['feature-state', 'selected'], false]],
      t.accentHover,
      t.accent,
    ];
    const landHover: ExpressionSpecification = [...listingBuildingHover] as ExpressionSpecification;
    landHover[3] = t.land;
    const sc = t.scenery;
    m.setPaintProperty('background', 'background-color', t.background);
    m.setPaintProperty('clip-mask', 'fill-color', t.background);
    m.setPaintProperty('green', 'fill-color', base.greenColor(t));
    m.setPaintProperty('water-area', 'fill-color', t.water);
    m.setPaintProperty('water-shore', 'line-color', sc.waterShore);
    m.setPaintProperty('water-line', 'line-color', t.water);
    m.setPaintProperty('roads', 'line-color', base.roadColor(t));
    m.setPaintProperty('roads-sidewalk', 'line-color', sc.sidewalk);
    m.setPaintProperty('roads-lanes', 'line-color', sc.laneMark);
    m.setPaintProperty('road-highlight', 'line-color', t.streetHighlight);
    m.setPaintProperty('road-names', 'text-color', t.streetName.text);
    m.setPaintProperty('road-names', 'text-halo-color', t.streetName.halo);
    m.setPaintProperty('trees', 'fill-extrusion-color', base.treeColor(t));
    m.setPaintProperty('roofs', 'fill-extrusion-color', base.roofColor(t));
    m.setPaintProperty('lamps', 'fill-extrusion-color', base.lampColor(sc));
    for (const [id, share] of [['lamp-glow', LAMP_POOL_OPACITY], ['lamp-core', LAMP_CORE_OPACITY]] as const) {
      m.setPaintProperty(id, 'circle-color', base.glowColor(sc));
      m.setPaintProperty(id, 'circle-opacity', sc.glowOpacity * share);
    }
    m.setPaintProperty('clip-line', 'line-color', t.accentStrong);
    m.setPaintProperty('draw-fill', 'fill-color', t.accentStrong);
    m.setPaintProperty('draw-line', 'line-color', t.accentStrong);
    m.setPaintProperty('draw-points', 'circle-stroke-color', t.accentStrong);
    for (const id of TEXTURES) {
      const img = base.texture(id);
      if (img && m.hasImage(id)) m.updateImage(id, img);
    }
    m.setPaintProperty('boundary-line', 'line-color', t.boundary);
    m.setPaintProperty('context-buildings', 'fill-extrusion-color', t.context);
    m.setPaintProperty('buildings-flat', 'fill-color', t.context);
    m.setPaintProperty('bairros-line', 'line-color', t.boundary);
    m.setPaintProperty('listing-dimmed', 'fill-extrusion-color', t.dimmed);
    m.setPaintProperty('listing-shell-dimmed', 'fill-extrusion-color', t.dimmed);
    m.setPaintProperty('listing-buildings', 'fill-extrusion-color', listingBuildingHover);
    m.setPaintProperty('listing-land', 'fill-extrusion-color', landHover);
    m.setPaintProperty('listing-outline', 'line-color', t.accentStrong);
    m.setPaintProperty('listing-unbuilt', 'fill-extrusion-color', listingBuildingHover);
    m.setPaintProperty('construction-cranes', 'fill-extrusion-color', ['case', ['==', ['get', 'matched'], true], t.scenery.crane, t.dimmed]);
    m.setPaintProperty('listing-approx-fill', 'fill-color', [
      'case',
      ['==', ['get', 'matched'], false],
      t.dimmed,
      ['boolean', ['feature-state', 'hover'], false],
      t.accentHover,
      t.accent,
    ]);
    m.setPaintProperty('listing-approx-line', 'line-color', ['case', ['==', ['get', 'matched'], false], t.dimmed, t.accent]);
    m.setPaintProperty('listing-pins', 'circle-color', listingBuildingHover);
    m.setPaintProperty('listing-pins', 'circle-stroke-color', t.pinStroke);
    m.setPaintProperty('listing-pins-dimmed', 'circle-color', t.dimmed);
    m.setPaintProperty('listing-pins-dimmed', 'circle-stroke-color', t.pinStroke);
    m.setPaintProperty('listing-clusters', 'circle-color', t.accent);
    m.setPaintProperty('listing-clusters', 'circle-stroke-color', t.pinStroke);
    m.setLight({ anchor: 'map', ...t.light });
    m.setSky({ 'sky-color': t.sky.sky, 'horizon-color': t.sky.horizon, 'fog-color': t.sky.horizon });
    this.invalidateShadows();
  }

  // ---------------------------------------------------------------- interaction

  private queryListing(point: { x: number; y: number }): MapGeoJSONFeature | undefined {
    const layers = INTERACTIVE_LAYERS.filter((id) => this.map.getLayer(id));
    return this.map
      .queryRenderedFeatures([point.x, point.y], { layers })
      .find((f) => f.properties?.matched === true);
  }

  private queryCluster(point: { x: number; y: number }): MapGeoJSONFeature | undefined {
    return this.map.getLayer('listing-clusters') ? this.map.queryRenderedFeatures([point.x, point.y], { layers: ['listing-clusters'] })[0] : undefined;
  }

  /** A click on a group of pins zooms in until it splits. */
  private async openCluster(f: MapGeoJSONFeature): Promise<void> {
    const source = this.map.getSource('listing-pins') as GeoJSONSource;
    const zoom = await source.getClusterExpansionZoom(f.properties.cluster_id as number);
    this.map.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom: Math.max(zoom, this.map.getZoom() + 1) });
  }

  private setListingState(id: number, state: Record<string, boolean>): void {
    for (const source of LISTING_SOURCES) this.map.setFeatureState({ source, id }, state);
  }

  /** Highlights a listing from outside the map (e.g. hovering the results list). */
  highlight(listingId: string | null): void {
    this.setHover(listingId ? (this.featureIdByListing.get(listingId) ?? null) : null, false);
  }

  /** Current hover state of a listing (used by automated checks). */
  /** Lit by the current search (not dimmed). */
  isMatched(listingId: string): boolean {
    return this.listingFeatures.some((f) => f.properties.listingId === listingId && f.properties.matched);
  }

  isHighlighted(listingId: string): boolean {
    const id = this.featureIdByListing.get(listingId);
    return id !== undefined && this.hoveredId === id;
  }

  private setHover(id: number | null, fromMap = true): void {
    if (this.hoveredId === id) return;
    if (this.hoveredId !== null) this.setListingState(this.hoveredId, { hover: false });
    this.hoveredId = id;
    if (id !== null) this.setListingState(id, { hover: true });
    if (fromMap) this.map.getCanvas().style.cursor = id !== null ? 'pointer' : '';
  }

  private bindInteractions(): void {
    const hoverOff = () => {
      this.setHover(null);
      this.events.onListingHover?.(null);
    };
    this.map.on('mousemove', (e) => {
      if (this.onPick || this.onDraw) return;
      // no tooltip while the user is dragging/rotating the map
      if (this.map.isMoving()) return hoverOff();
      // a group of pins is drawn over the buildings, and a click on it zooms in (see 'click')
      const cluster = this.queryCluster(e.point);
      const f = cluster ? undefined : this.queryListing(e.point);
      this.setHover(f ? (f.id as number) : null);
      if (cluster) this.map.getCanvas().style.cursor = 'pointer';
      this.events.onListingHover?.(f ? String(f.properties.listingId) : null, { x: e.point.x, y: e.point.y });
    });
    this.map.on('mouseout', hoverOff);
    this.map.on('movestart', hoverOff);
    this.map.on('click', (e) => {
      if (this.onDraw) return this.onDraw([e.lngLat.lng, e.lngLat.lat], { x: e.point.x, y: e.point.y });
      if (this.onPick) {
        const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        if (this.map.getZoom() < Z_3D_START) return this.onPick({ lngLat, tooFar: true });
        const b = this.map.queryRenderedFeatures(e.point, { layers: ['context-buildings'] })[0];
        const building = b && pickedBuilding(b);
        this.onPick({ lngLat, ...(building ? { building } : {}) });
        return;
      }
      this.events.onListingHover?.(null);
      if (this.events.ignoreClickAt?.(e.point)) return;
      const cluster = this.queryCluster(e.point);
      if (cluster) return void this.openCluster(cluster);
      const f = this.queryListing(e.point);
      if (f) this.events.onListingClick(String(f.properties.listingId));
      else this.events.onEmptyClick();
    });
  }

  /** Screen position of a listing's center (used by automated checks). */
  projectListing(listingId: string): { x: number; y: number } | null {
    const f = this.listingFeatures.find((x) => x.properties.listingId === listingId);
    if (!f) return null;
    const [w, s, e, n] = turfBbox(f);
    const p = this.map.project([(w + e) / 2, (s + n) / 2]);
    return { x: p.x, y: p.y };
  }
}

