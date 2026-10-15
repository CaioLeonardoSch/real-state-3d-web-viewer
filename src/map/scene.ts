import turfBooleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { AttributionControl, LngLatBounds, Map as MlMap, Marker, NavigationControl } from 'maplibre-gl';
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  LayerSpecification,
  MapGeoJSONFeature,
  StyleSpecification,
} from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry, Point, Polygon, MultiPolygon } from 'geojson';
import turfCircle from '@turf/circle';
import turfBbox from '@turf/bbox';
import type { AppData } from '../data/load';
import { OverviewControl } from './overviewControl';
import type { Listing } from '../data/types';
import type { Theme } from './lighting';
import { M_PER_DEG, shadowOffset, shadowRing } from './shadows';
import { dirtRoad, pavingStones, waterFacets, type TextureImage } from './textures';
import { craneParts } from './crane';
import { osmNumericId } from '../data/osmId';

const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> (ODbL)';
const MAPLIBRE_ATTRIBUTION = '<a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a>';
const CADASTRE_ATTRIBUTION =
  'Alturas: <a href="https://www.joinville.sc.gov.br/servicos/acessar-sistema-de-informacoes-municipais-georreferenciadas-simgeo/" target="_blank" rel="noopener">cadastro da Prefeitura de Joinville (SIMGeo)</a>';

const LAND_HEIGHT_M = 0.5;
const METERS_PER_FLOOR = 3;
const DEFAULT_BUILDING_HEIGHT_M = 6;

/**
 * "3D only up close": the tiles carry buildings from z13. Up to Z_FLAT_END they are flat footprints;
 * from Z_3D_START they rise until reaching their full height at Z_3D_FULL. With a pitched camera the
 * far part of the view uses lower-zoom tiles, so the horizon stays light.
 */
const Z_3D_START = 14;
const Z_3D_FULL = 15.5;
const Z_FLAT_END = 14.6;
/** Scenery from the closest tiles (scripts/lib/scenery.mjs): trees, then street lamps a little closer. */
const Z_TREES = 15;
/**
 * Faceted water from this zoom; flat water before. The texture costs two more shaders and a canvas, kept out of the
 * first view of the city (the slowest moment on a phone).
 */
const Z_WATER_PATTERN = 13;
/**
 * Base of the extrusions seen from afar, read from the features (0 when absent). Listings, works and developments
 * then share one shader (data-driven base and colour): each extra variant costs a shader compilation on the first
 * view, the slowest moment on a phone.
 */
const FEATURE_BASE: ExpressionSpecification = ['coalesce', ['get', 'base'], ['get', 'b'], 0];
const Z_LAMPS = 16;
/**
 * Light of the street lamps at night: a pool fading out LAMP_POOL_M metres around the point under the luminaire and
 * a brighter spot LAMP_CORE_M wide, both scaled by the strength of the lamp (k: 1.25 on main streets, ±15% each).
 */
const LAMP_POOL_M = 12;
const LAMP_CORE_M = 4.5;
const LAMP_POOL_OPACITY = 0.6;
const LAMP_CORE_OPACITY = 0.85;
const LAMP_STRENGTH: ExpressionSpecification = ['coalesce', ['get', 'k'], 1];
/** Canopy mass of woods (m), as in scripts/lib/scenery.mjs. */
const WOOD_CANOPY_M = 6;
/**
 * Building shadows on the ground by day (src/map/shadows.ts): from Z_SHADOWS, when the buildings stand at their full
 * height (while they rise the shadows would be faint, and in the city centre cost some 0.2 s each time the camera
 * stops), fading in until Z_SHADOWS_FULL. They are cast by the buildings within SHADOW_RADIUS_M of the map centre at
 * Z_SHADOWS (half as far per zoom level in, at least SHADOW_MIN_RADIUS_M) and recomputed when the camera stops or the
 * sun moves.
 */
const Z_SHADOWS = Z_3D_FULL;
const Z_SHADOWS_FULL = Z_3D_FULL + 0.5;
const SHADOW_RADIUS_M = 1000;
const SHADOW_MIN_RADIUS_M = 500;
const SHADOW_MIN_HEIGHT_M = 2;
const SHADOW_COLOR = '#1b2236';
const SHADOW_OPACITY = 0.3;
/** Layers whose volumes cast shadows (all standing on the ground), and their height in metres. */
const SHADOW_CASTERS: { layer: string; height: (p: Record<string, unknown>) => number }[] = [
  { layer: 'context-buildings', height: (p) => Number(p.height) },
  { layer: 'listing-buildings', height: (p) => Number(p.built ?? p.height) },
  { layer: 'listing-dimmed', height: (p) => (p.kind === 'building' ? Number(p.height) : 0) },
  // developments (src/map/developmentLayer.ts): the tower, or its floors while it is open
  { layer: 'dev-towers', height: (p) => Number(p.height) },
  { layer: 'dev-blocks', height: (p) => Number(p.top) },
];
/** Road widths (m) by OSM class, at real scale from zoom 16 (lamps stand just beyond the kerb). */
const ROAD_WIDTH_M: ExpressionSpecification = [
  'match',
  ['get', 'highway'],
  ['motorway', 'trunk'],
  11,
  ['primary', 'secondary'],
  10,
  'tertiary',
  8.4,
  ['motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'],
  6,
  ['residential', 'unclassified'],
  5.6,
  'living_street',
  4.8,
  'service',
  3.6,
  'track',
  3,
  ['footway', 'path', 'steps', 'cycleway', 'pedestrian', 'bridleway', 'corridor'],
  1.8,
  4,
];
const MAJOR_ROADS = ['primary', 'secondary', 'tertiary'];
const FOOT_ROADS = ['footway', 'path', 'steps', 'cycleway', 'pedestrian'];
/** Streets drawn with sidewalks up close (where the illustrative lamps stand). */
const SIDEWALK_ROADS = ['primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link', 'residential', 'unclassified', 'living_street'];
/** Base-map layers cut by the neighbourhood filter (only what is within CLIP_BUFFER_M of the chosen area stays). */
const CLIP_LAYERS = [
  'green',
  'wood-canopy',
  'water-area',
  'water-pattern',
  'water-shore',
  'water-line',
  'roads-sidewalk',
  'roads',
  'roads-paving',
  'roads-dirt',
  'roads-lanes',
  'lamp-glow',
  'lamp-core',
  'buildings-flat',
  'context-buildings',
  'roofs',
  'trees',
  'lamps',
  'listing-dimmed',
  'listing-approx-fill',
  'listing-approx-line',
  'listing-pins-dimmed',
  'construction-cranes',
  'dev-towers',
  'dev-towers-ghost',
  'dev-cranes',
];
export const CLIP_BUFFER_M = 100;
/** Textures drawn in the browser (src/map/textures.ts), re-coloured with the time of day. */
const TEXTURES = ['water-facets', 'canopy-facets', 'paving-stones', 'dirt-road'] as const;

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
}

/** Layers whose features are clickable listings (filters keep only matched ones). */
const INTERACTIVE_LAYERS = ['listing-pins', 'listing-buildings', 'listing-unbuilt', 'listing-land', 'listing-approx-fill'];
/** Both listing sources share feature ids, so hover/selected state is mirrored on them. */
const LISTING_SOURCES = ['listings', 'listing-pins'] as const;
/** Pins help find listings in the overview and fade out once the 3D highlight is readable. */
const PIN_FADE_START_ZOOM = 15.5;
const PIN_MAX_ZOOM = 16.5;

/** What the user clicked while choosing the place of a new listing ("Anunciar imóvel"). */
export interface PickResult {
  lngLat: [number, number];
  /** Context building under the click, if any (buildings of existing listings are not pickable). */
  building?: { osmId: string; residential: boolean; height: number; geometry: Polygon | MultiPolygon };
  /** Buildings are only pickable up close (3D, zoom ≥ Z_3D_START). */
  tooFar?: boolean;
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

export class Scene {
  readonly map: MlMap;
  private listingFeatures: Feature<Polygon | MultiPolygon, ListingFeatureProps>[] = [];
  private featureIdByListing = new Map<string, number>();
  private hoveredId: number | null = null;
  private selectedId: number | null = null;
  private onPick: ((p: PickResult) => void) | null = null;
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
      pitch: 58,
      bearing: -20,
      maxPitch: 75,
      minZoom: 9.8,
      maxZoom: 19.5,
      maxBounds: [w - padX, s - padY, e + padX, n + padY],
      attributionControl: false,
    });
    this.map.addControl(new AttributionControl({ compact: false, customAttribution: MAPLIBRE_ATTRIBUTION }), 'bottom-left');
    this.map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right');
    // added after the navigation control: bottom corners stack upwards, so it sits above zoom +/−
    this.map.addControl(new OverviewControl(() => this.showOverview(true)), 'bottom-right');

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
      const img = this.texture(id);
      if (img && !this.map.hasImage(id)) this.map.addImage(id, img, { pixelRatio: 2 });
    });
    this.bindInteractions();
    this.addBairroLabels();
    // the shadows follow the camera: recomputed once the tiles it moved to are loaded
    this.map.on('moveend', () => (this.shadowsDirty = true));
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

  private texture(id: string): TextureImage | null {
    const sc = this.theme.scenery;
    if (id === 'water-facets') return waterFacets(this.theme.water, sc.waterLight, sc.waterDeep);
    if (id === 'canopy-facets') return waterFacets(sc.canopy, sc.canopyLight, sc.canopyDark, 96);
    if (id === 'paving-stones') return pavingStones(sc.paving, sc.pavingJoint);
    if (id === 'dirt-road') return dirtRoad(sc.unpaved, sc.unpavedSpot);
    return null;
  }

  /** Width in pixels of something `m` metres wide, at real scale (zoom interpolation, base 2). */
  private meters(m: ExpressionSpecification | number, fromZoom = 14, minPx = 0): ExpressionSpecification {
    const at = (z: number): ExpressionSpecification | number =>
      typeof m === 'number' ? Math.max(minPx, m * this.pxPerM0 * 2 ** z) : ['max', minPx, ['*', m, this.pxPerM0 * 2 ** z]];
    return ['interpolate', ['exponential', 2], ['zoom'], fromZoom, at(fromZoom), 22, at(22)];
  }

  /** Road width: stylised from afar, real width (plus `extraM`, e.g. sidewalks) from zoom 16. */
  private roadWidth(extraM = 0): ExpressionSpecification {
    const real = (z: number): ExpressionSpecification => ['*', extraM ? ['+', ROAD_WIDTH_M, extraM] : ROAD_WIDTH_M, this.pxPerM0 * 2 ** z];
    return [
      'interpolate',
      ['exponential', 2],
      ['zoom'],
      11,
      ['match', ['get', 'highway'], MAJOR_ROADS, 1.2, FOOT_ROADS, 0, 0.3],
      14,
      ['match', ['get', 'highway'], MAJOR_ROADS, 2.5, FOOT_ROADS, 0.5, 1.5],
      16,
      real(16),
      22,
      real(22),
    ];
  }

  /** Place names as HTML labels (the style has no fonts): cities/districts from afar, then neighbourhoods. */
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
    return ['!', ['in', ['get', 'osmId'], ['literal', this.contextHiddenIds()]]];
  }

  /** The same for the roofs, which carry the building as a numeric feature id (src/data/osmId.ts). */
  private roofFilter(): ExpressionSpecification {
    return ['!', ['in', ['id'], ['literal', this.contextHiddenIds().map(osmNumericId)]]];
  }

  private contextHiddenIds(): string[] {
    return [
      ...this.listings.filter((l) => l.buildingOsmId && !l.approximateLocation).map((l) => l.buildingOsmId!),
      ...this.data.developments.flatMap((d) => d.hiddenBuildingIds),
    ];
  }

  /**
   * Base map, bottom to top: ground, green areas, water, roads by pavement (sidewalks, paving stones, dirt, lane
   * marks up close), boundaries, night light pools, buildings, then the low-poly scenery (canopy of woods, trees,
   * street lamps). Each layer's own filter is kept in `baseFilters`, so the neighbourhood cut can be added to it.
   */
  private baseLayers(t: Theme): LayerSpecification[] {
    const sc = t.scenery;
    const layers: LayerSpecification[] = [
      { id: 'background', type: 'background', paint: { 'background-color': t.background } },
      {
        id: 'green',
        type: 'fill',
        source: 'osm',
        'source-layer': 'green',
        // opacity per kind (woods a little denser), also to share the shader of the other data-driven fills
        paint: { 'fill-color': this.greenColor(t), 'fill-opacity': ['match', ['get', 'k'], 'wood', 0.9, 0.85] },
      },
      {
        id: 'water-area',
        type: 'fill',
        source: 'osm',
        'source-layer': 'water',
        maxzoom: Z_WATER_PATTERN,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': t.water },
      },
      {
        // faceted low-poly water up close (texture drawn in the browser, src/map/textures.ts)
        id: 'water-pattern',
        type: 'fill',
        source: 'osm',
        'source-layer': 'water',
        minzoom: Z_WATER_PATTERN,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-pattern': 'water-facets' },
      },
      {
        id: 'water-shore',
        type: 'line',
        source: 'osm',
        'source-layer': 'water',
        minzoom: 13,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'line-color': sc.waterShore, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 17, 3], 'line-blur': 0.8 },
      },
      {
        id: 'water-line',
        type: 'line',
        source: 'osm',
        'source-layer': 'water',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': t.water,
          'line-width': this.meters(['match', ['get', 'waterway'], 'river', 10, 'canal', 5, 2.5], 14, 1.5),
        },
      },
      {
        // sidewalks under the urban streets, up close
        id: 'roads-sidewalk',
        type: 'line',
        source: 'osm',
        'source-layer': 'roads',
        minzoom: 15.5,
        filter: ['all', ['in', ['get', 'highway'], ['literal', SIDEWALK_ROADS]], ['!=', ['get', 's'], 'u']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': sc.sidewalk, 'line-width': this.roadWidth(3.2) },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'osm',
        'source-layer': 'roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': this.roadColor(t), 'line-width': this.roadWidth() },
      },
      {
        // paving stones ("calçamento") up close
        id: 'roads-paving',
        type: 'line',
        source: 'osm',
        'source-layer': 'roads',
        minzoom: 16,
        filter: ['==', ['get', 's'], 'c'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-pattern': 'paving-stones', 'line-width': this.roadWidth() },
      },
      {
        // dirt roads ("estrada de chão") up close
        id: 'roads-dirt',
        type: 'line',
        source: 'osm',
        'source-layer': 'roads',
        minzoom: 16,
        filter: ['==', ['get', 's'], 'u'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-pattern': 'dirt-road', 'line-width': this.roadWidth() },
      },
      {
        // dashed centre line on asphalted avenues
        id: 'roads-lanes',
        type: 'line',
        source: 'osm',
        'source-layer': 'roads',
        minzoom: 16.5,
        filter: ['all', ['in', ['get', 'highway'], ['literal', MAJOR_ROADS]], ['==', ['get', 's'], 'a']],
        paint: { 'line-color': sc.laneMark, 'line-width': this.meters(0.2, 16.5, 1), 'line-dasharray': [6, 8] },
      },
      {
        id: 'bairros-line',
        type: 'line',
        source: 'osm',
        'source-layer': 'bairros',
        paint: { 'line-color': t.boundary, 'line-width': 1, 'line-dasharray': [2, 3], 'line-opacity': 0.45 },
      },
      {
        id: 'boundary-line',
        type: 'line',
        source: 'boundary',
        paint: { 'line-color': t.boundary, 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
      },
      {
        // pools of light under the street lamps (night only): fading from the middle to the edge (blur 1), in the
        // colour of the kind of lamp (t) and as wide as its strength (k, scripts/lib/scenery.mjs)
        id: 'lamp-glow',
        type: 'circle',
        source: this.detailSource,
        'source-layer': 'lights',
        minzoom: Z_TREES + 0.5,
        // always visible, transparent by day: a layer hidden when the tiles load gets no features when it is shown
        // later (the night chosen up close would stay dark)
        paint: {
          'circle-color': this.glowColor(sc),
          'circle-opacity': sc.glowOpacity * LAMP_POOL_OPACITY,
          'circle-radius': this.meters(['*', LAMP_POOL_M, LAMP_STRENGTH], Z_TREES),
          'circle-blur': 1,
          'circle-pitch-alignment': 'map',
          'circle-pitch-scale': 'map',
        },
      },
      {
        // the bright spot right under the luminaire, over the pool
        id: 'lamp-core',
        type: 'circle',
        source: this.detailSource,
        'source-layer': 'lights',
        minzoom: Z_TREES + 0.5,
        paint: {
          'circle-color': this.glowColor(sc),
          'circle-opacity': sc.glowOpacity * LAMP_CORE_OPACITY,
          'circle-radius': this.meters(['*', LAMP_CORE_M, LAMP_STRENGTH], Z_TREES),
          'circle-blur': 1,
          'circle-pitch-alignment': 'map',
          'circle-pitch-scale': 'map',
        },
      },
      {
        // by day the buildings cast their shadows on the ground (empty at night). A flat translucent extrusion:
        // MapLibre colours each pixel of such a layer once, so overlapping shadows do not darken twice; the
        // buildings drawn after it hide the part of the shadow behind them. The ground layers before it get
        // shaded; the bairro mask after it covers the shadows outside the chosen area.
        id: 'building-shadows',
        type: 'fill-extrusion',
        source: 'shadows',
        minzoom: Z_SHADOWS,
        paint: {
          'fill-extrusion-color': SHADOW_COLOR,
          'fill-extrusion-height': 0,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], Z_SHADOWS, 0, Z_SHADOWS_FULL, SHADOW_OPACITY],
          'fill-extrusion-vertical-gradient': false,
        },
      },
      {
        // from afar: flat footprints (texture of the city without the cost and clutter of 3D)
        id: 'buildings-flat',
        type: 'fill',
        source: 'osm',
        'source-layer': 'buildings',
        maxzoom: Z_FLAT_END,
        filter: this.contextFilter(),
        paint: {
          'fill-color': t.context,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.35, Z_FLAT_END, 0.9],
        },
      },
      {
        // "bairro" filter: the ground beyond 100 m of the chosen neighbourhoods, in the background colour (big
        // woods and long roads would otherwise stick out); 3D layers are cut by their filters
        id: 'clip-mask',
        type: 'fill',
        source: 'clip-mask',
        paint: { 'fill-color': t.background },
      },
      {
        // up close: buildings rise from flat to their height between Z_3D_START and Z_3D_FULL
        id: 'context-buildings',
        type: 'fill-extrusion',
        source: 'osm',
        'source-layer': 'buildings',
        minzoom: Z_3D_START,
        filter: this.contextFilter(),
        paint: {
          'fill-extrusion-color': t.context,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], Z_3D_START, 0, Z_3D_FULL, ['get', 'height']],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.95,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      {
        // low-poly roofs up close (scripts/lib/roofs.mjs): stepped gabled and hipped roofs on houses, the water
        // tank on towers; they rise with the buildings, and listing buildings (drawn by the listing layers) have none
        id: 'roofs',
        type: 'fill-extrusion',
        source: this.detailSource,
        'source-layer': 'roofs',
        minzoom: Z_TREES,
        filter: this.roofFilter(),
        paint: {
          'fill-extrusion-color': this.roofColor(t),
          // b and h in decimetres
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], Z_3D_START, 0, Z_3D_FULL, ['/', ['get', 'b'], 10]],
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], Z_3D_START, 0, Z_3D_FULL, ['/', ['get', 'h'], 10]],
          'fill-extrusion-opacity': 0.95,
          'fill-extrusion-vertical-gradient': false,
        },
      },
      {
        // canopy mass of woods (woods shrunk by 6 m): the edge trees stand in front of it and taller crowns
        // (trees layer) poke out of its top
        id: 'wood-canopy',
        type: 'fill-extrusion',
        source: 'osm',
        'source-layer': 'canopy',
        minzoom: Z_3D_START,
        paint: {
          'fill-extrusion-pattern': 'canopy-facets',
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], Z_3D_START, 0, Z_3D_FULL, WOOD_CANOPY_M],
          'fill-extrusion-base': 0,
          'fill-extrusion-vertical-gradient': false,
        },
      },
      {
        // low-poly trees: trunk, faceted crown and its top (properties p, b, h, v from scripts/lib/scenery.mjs)
        id: 'trees',
        type: 'fill-extrusion',
        source: this.detailSource,
        'source-layer': 'trees',
        minzoom: Z_TREES,
        paint: {
          'fill-extrusion-color': this.treeColor(t),
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], Z_TREES, 0, Z_TREES + 1, ['get', 'b']],
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], Z_TREES, 0, Z_TREES + 1, ['get', 'h']],
          'fill-extrusion-vertical-gradient': true,
        },
      },
      {
        // illustrative street lamps: pole, arm and luminaire (bright at night)
        id: 'lamps',
        type: 'fill-extrusion',
        source: this.detailSource,
        'source-layer': 'lamps',
        minzoom: Z_LAMPS,
        paint: {
          'fill-extrusion-color': this.lampColor(sc),
          'fill-extrusion-base': ['get', 'b'],
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-vertical-gradient': false,
        },
      },
    ];
    for (const l of layers) if ('filter' in l) this.baseFilters.set(l.id, l.filter as FilterSpecification);
    return layers;
  }

  private greenColor(t: Theme): ExpressionSpecification {
    const g = t.scenery.greens;
    return ['match', ['get', 'k'], 'grass', g.grass, 'wood', g.wood, 'scrub', g.scrub, 'wetland', g.wetland, 'farm', g.farm, g.park];
  }

  private roadColor(t: Theme): ExpressionSpecification {
    const sc = t.scenery;
    return ['match', ['get', 's'], 'a', sc.asphalt, 'c', sc.paving, 'p', sc.paved, 'u', sc.unpaved, t.roads];
  }

  /** Light of a street lamp by its kind (t, scripts/lib/scenery.mjs): warm white LED, neutral white LED, sodium. */
  private glowColor(sc: Theme['scenery']): ExpressionSpecification {
    return ['match', ['coalesce', ['get', 't'], 'w'], 'n', sc.glowNeutral, 's', sc.glowSodium, sc.glow];
  }

  /** Pole and arm, and the luminaire in the colour of its light (orange for sodium). */
  private lampColor(sc: Theme['scenery']): ExpressionSpecification {
    return ['match', ['get', 'p'], 'lum', ['match', ['coalesce', ['get', 't'], 'w'], 's', sc.lumSodium, sc.lum], sc.pole];
  }

  private treeColor(t: Theme): ExpressionSpecification {
    const sc = t.scenery;
    const shade = (c: [string, string, string]): ExpressionSpecification => ['match', ['get', 'v'], 0, c[0], 1, c[1], c[2]];
    return ['match', ['get', 'p'], 'trunk', sc.trunk, 'bush', sc.bush, 'top', shade(sc.tops), shade(sc.crowns)];
  }

  /** Source of the close-up detail layers (older data has them in the base archive). */
  private get detailSource(): string {
    return this.data.detailUrl ? 'detail' : 'osm';
  }

  /** Roof colour per variant v (clay tiles, fibre cement, dark tiles, concrete). */
  private roofColor(t: Theme): ExpressionSpecification {
    const r = t.scenery.roofs;
    return ['match', ['get', 'v'], 1, r[1], 2, r[2], 3, r[3], r[0]];
  }

  private buildStyle(): StyleSpecification {
    const t = this.theme;
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
      // No glyphs or sprites. Base map: one local PMTiles file (vector tiles, loaded by range requests).
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
        'listing-pins': { type: 'geojson', data: this.pinCollection() },
        // buildings under construction: the part still to build (translucent) and a tower crane
        construction: { type: 'geojson', data: this.constructionCollection() },
        'pick-preview': { type: 'geojson', data: EMPTY_FC },
        // neighbourhood(s) the map is cut to (filter "bairro"), and the ground outside them plus 100 m (masked)
        'clip-area': { type: 'geojson', data: EMPTY_FC },
        'clip-mask': { type: 'geojson', data: EMPTY_FC },
        // building shadows by day (updateShadows)
        shadows: { type: 'geojson', data: EMPTY_FC, maxzoom: 16 },
      },
      light: { anchor: 'map', ...t.light },
      sky: { 'sky-color': t.sky.sky, 'horizon-color': t.sky.horizon, 'fog-color': t.sky.horizon },
      layers: [
        ...this.baseLayers(t),
        {
          id: 'clip-line',
          type: 'line',
          source: 'clip-area',
          paint: { 'line-color': t.accentStrong, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 17, 3.5], 'line-opacity': 0.85 },
        },
        {
          id: 'listing-dimmed',
          type: 'fill-extrusion',
          source: 'listings',
          filter: ['all', dimFilter, ['in', ['get', 'kind'], ['literal', ['building', 'land']]]],
          paint: {
            'fill-extrusion-color': t.dimmed,
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-opacity': 0.4,
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
          id: 'listing-pins-dimmed',
          type: 'circle',
          source: 'listing-pins',
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
      ],
    };
  }

  // ---------------------------------------------------------------- listings

  private buildListingFeatures(): void {
    this.listingFeatures = [];
    this.featureIdByListing.clear();
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
      this.listingFeatures.push({ type: 'Feature', id, properties: props, geometry });
    });
  }

  private pinFade(max: number): ExpressionSpecification {
    return ['interpolate', ['linear'], ['zoom'], PIN_FADE_START_ZOOM, max, PIN_MAX_ZOOM, 0];
  }

  /** One point per listing at the centre of its highlighted shape (same feature ids as `listings`). */
  private pinCollection(): FeatureCollection<Point, ListingFeatureProps> {
    return {
      type: 'FeatureCollection',
      features: this.listingFeatures.map((f) => {
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
    return { type: 'FeatureCollection', features };
  }

  /** Marks which listings match the applied filters (others are dimmed and not clickable). */
  setMatched(matchedIds: Set<string>): void {
    for (const f of this.listingFeatures) f.properties.matched = matchedIds.has(f.properties.listingId);
    (this.map.getSource('listings') as GeoJSONSource | undefined)?.setData(this.listingCollection());
    (this.map.getSource('listing-pins') as GeoJSONSource | undefined)?.setData(this.pinCollection());
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
    (this.map.getSource('listing-pins') as GeoJSONSource | undefined)?.setData(this.pinCollection());
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

  // ---------------------------------------------------------------- choosing a place for a new listing

  /** Next map click is reported to `onPick` instead of opening listings, until `stopPicking()`. */
  startPicking(onPick: (p: PickResult) => void): void {
    this.onPick = onPick;
    this.setHover(null);
    this.events.onListingHover?.(null);
    this.map.getCanvas().style.cursor = 'crosshair';
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
    this.map.fitBounds(all, { padding: this.cameraPadding(), pitch: 58, bearing: -20, animate, duration: 1200 });
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
    m.setPaintProperty('green', 'fill-color', this.greenColor(t));
    m.setPaintProperty('water-area', 'fill-color', t.water);
    m.setPaintProperty('water-shore', 'line-color', sc.waterShore);
    m.setPaintProperty('water-line', 'line-color', t.water);
    m.setPaintProperty('roads', 'line-color', this.roadColor(t));
    m.setPaintProperty('roads-sidewalk', 'line-color', sc.sidewalk);
    m.setPaintProperty('roads-lanes', 'line-color', sc.laneMark);
    m.setPaintProperty('trees', 'fill-extrusion-color', this.treeColor(t));
    m.setPaintProperty('roofs', 'fill-extrusion-color', this.roofColor(t));
    m.setPaintProperty('lamps', 'fill-extrusion-color', this.lampColor(sc));
    for (const [id, share] of [['lamp-glow', LAMP_POOL_OPACITY], ['lamp-core', LAMP_CORE_OPACITY]] as const) {
      m.setPaintProperty(id, 'circle-color', this.glowColor(sc));
      m.setPaintProperty(id, 'circle-opacity', sc.glowOpacity * share);
    }
    m.setPaintProperty('clip-line', 'line-color', t.accentStrong);
    for (const id of TEXTURES) {
      const img = this.texture(id);
      if (img && m.hasImage(id)) m.updateImage(id, img);
    }
    m.setPaintProperty('boundary-line', 'line-color', t.boundary);
    m.setPaintProperty('context-buildings', 'fill-extrusion-color', t.context);
    m.setPaintProperty('buildings-flat', 'fill-color', t.context);
    m.setPaintProperty('bairros-line', 'line-color', t.boundary);
    m.setPaintProperty('listing-dimmed', 'fill-extrusion-color', t.dimmed);
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
      if (this.onPick) return;
      // no tooltip while the user is dragging/rotating the map
      if (this.map.isMoving()) return hoverOff();
      const f = this.queryListing(e.point);
      this.setHover(f ? (f.id as number) : null);
      this.events.onListingHover?.(f ? String(f.properties.listingId) : null, { x: e.point.x, y: e.point.y });
    });
    this.map.on('mouseout', hoverOff);
    this.map.on('movestart', hoverOff);
    this.map.on('click', (e) => {
      if (this.onPick) {
        const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        if (this.map.getZoom() < Z_3D_START) return this.onPick({ lngLat, tooFar: true });
        const b = this.map.queryRenderedFeatures(e.point, { layers: ['context-buildings'] })[0];
        this.onPick({
          lngLat,
          ...(b && (b.geometry.type === 'Polygon' || b.geometry.type === 'MultiPolygon')
            ? {
                building: {
                  osmId: String(b.properties.osmId),
                  residential: b.properties.residential === true,
                  height: Number(b.properties.height) || DEFAULT_BUILDING_HEIGHT_M,
                  geometry: b.geometry,
                },
              }
            : {}),
        });
        return;
      }
      this.events.onListingHover?.(null);
      if (this.events.ignoreClickAt?.(e.point)) return;
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

