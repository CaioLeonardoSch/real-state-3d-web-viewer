import type { ExpressionSpecification, FilterSpecification, LayerSpecification } from 'maplibre-gl';
import type { AppData } from '../data/load';
import type { Theme } from './lighting';
import { M_PER_DEG } from './shadows';
import { dirtRoad, pavingStones, waterFacets, type TextureImage } from './textures';

/*
 * Base map style (src/map/scene.ts draws the listings over it): layers of the OSM archive, their textures and the
 * constants they share with the scene (zoom thresholds, road widths, layers cut by the neighbourhood filter).
 */

export const LAND_HEIGHT_M = 0.5;
export const METERS_PER_FLOOR = 3;
export const DEFAULT_BUILDING_HEIGHT_M = 6;

/**
 * "3D only up close": the tiles carry buildings from z13. Up to Z_FLAT_END they are flat footprints;
 * from Z_3D_START they rise until reaching their full height at Z_3D_FULL. With a pitched camera the
 * far part of the view uses lower-zoom tiles, so the horizon stays light.
 */
export const Z_3D_START = 14;
export const Z_3D_FULL = 15.5;
export const Z_FLAT_END = 14.6;
/** Scenery from the closest tiles (scripts/lib/scenery.mjs): trees, then street lamps a little closer. */
export const Z_TREES = 15;
/**
 * Faceted water from this zoom; flat water before. The texture costs two more shaders and a canvas, kept out of the
 * first view of the city (the slowest moment on a phone).
 */
export const Z_WATER_PATTERN = 13;
/**
 * Base of the extrusions seen from afar, read from the features (0 when absent). Listings, works and developments
 * then share one shader (data-driven base and colour): each extra variant costs a shader compilation on the first
 * view, the slowest moment on a phone.
 */
export const FEATURE_BASE: ExpressionSpecification = ['coalesce', ['get', 'base'], ['get', 'b'], 0];
export const Z_LAMPS = 16;
/**
 * Light of the street lamps at night: a pool fading out LAMP_POOL_M metres around the point under the luminaire and
 * a brighter spot LAMP_CORE_M wide, both scaled by the strength of the lamp (k: 1.25 on main streets, ±15% each).
 */
export const LAMP_POOL_M = 12;
export const LAMP_CORE_M = 4.5;
export const LAMP_POOL_OPACITY = 0.6;
export const LAMP_CORE_OPACITY = 0.85;
export const LAMP_STRENGTH: ExpressionSpecification = ['coalesce', ['get', 'k'], 1];
/**
 * Street names, drawn by the style from this zoom (the neighbourhood labels end at BAIRRO_LABEL_ZOOMS[1], so the two
 * never meet). The glyphs come from the Inter file the site already serves (no glyph files, no other origin): MapLibre
 * downloads it the first time a name is drawn and rasterises the letters in the browser.
 */
export const Z_STREET_NAMES = 16;
export const STREET_FONT = 'Inter Medium';
/** The street chosen in the search is lit within its bounding box grown by this much (m), this much wider than the road. */
export const STREET_HIGHLIGHT_MARGIN_M = 60;
export const STREET_HIGHLIGHT_EXTRA_M = 5;
/** Least width (px) of the street highlight at zoom 16 and 17, and its opacity (the name stays readable on it). */
export const STREET_HIGHLIGHT_MIN_PX: [number, number] = [14, 20];
export const STREET_HIGHLIGHT_OPACITY = 0.65;
/** Canopy mass of woods (m), as in scripts/lib/scenery.mjs. */
export const WOOD_CANOPY_M = 6;
/**
 * Building shadows on the ground by day (src/map/shadows.ts): from Z_SHADOWS, when the buildings stand at their full
 * height (while they rise the shadows would be faint, and in the city centre cost some 0.2 s each time the camera
 * stops), fading in until Z_SHADOWS_FULL. They are cast by the buildings within SHADOW_RADIUS_M of the map centre at
 * Z_SHADOWS (half as far per zoom level in, at least SHADOW_MIN_RADIUS_M) and recomputed when the camera stops or the
 * sun moves.
 */
export const Z_SHADOWS = Z_3D_FULL;
export const Z_SHADOWS_FULL = Z_3D_FULL + 0.5;
export const SHADOW_RADIUS_M = 1000;
export const SHADOW_MIN_RADIUS_M = 500;
export const SHADOW_MIN_HEIGHT_M = 2;
export const SHADOW_COLOR = '#1b2236';
export const SHADOW_OPACITY = 0.3;
/** Layers whose volumes cast shadows (all standing on the ground), and their height in metres. */
export const SHADOW_CASTERS: { layer: string; height: (p: Record<string, unknown>) => number }[] = [
  { layer: 'context-buildings', height: (p) => Number(p.height) },
  { layer: 'listing-buildings', height: (p) => Number(p.built ?? p.height) },
  { layer: 'listing-dimmed', height: (p) => (p.kind === 'building' ? Number(p.height) : 0) },
  // developments (src/map/developmentLayer.ts): the tower, or its floors while it is open
  { layer: 'dev-towers', height: (p) => Number(p.height) },
  { layer: 'dev-blocks', height: (p) => Number(p.top) },
];
/** Road widths (m) by OSM class, at real scale from zoom 16 (lamps stand just beyond the kerb). */
export const ROAD_WIDTH_M: ExpressionSpecification = [
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
export const MAJOR_ROADS = ['primary', 'secondary', 'tertiary'];
export const MINOR_ROADS = ['residential', 'unclassified', 'living_street'];
export const FOOT_ROADS = ['footway', 'path', 'steps', 'cycleway', 'pedestrian'];
/** Streets drawn with sidewalks up close (where the illustrative lamps stand). */
export const SIDEWALK_ROADS = ['primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link', 'residential', 'unclassified', 'living_street'];
/** Base-map layers cut by the neighbourhood filter (only what is within CLIP_BUFFER_M of the chosen area stays). */
export const CLIP_LAYERS = [
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
  'road-names',
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
export const TEXTURES = ['water-facets', 'canopy-facets', 'paving-stones', 'dirt-road'] as const;

/** A street of the search, as the search hands it to the map: its name and the bounding box of its segments. */
export interface StreetRef {
  name: string;
  bbox: [number, number, number, number];
}

/**
 * Filter of the 'road-highlight' layer: the segments named as the street within its bounding box grown by
 * STREET_HIGHLIGHT_MARGIN_M (a street of the same name elsewhere stays unlit); nothing for null.
 */
export function streetHighlightFilter(street: StreetRef | null): FilterSpecification {
  if (!street) return false;
  const [w, s, e, n] = street.bbox;
  const dy = STREET_HIGHLIGHT_MARGIN_M / M_PER_DEG;
  const dx = dy / Math.cos((((s + n) / 2) * Math.PI) / 180);
  const ring = [[w - dx, s - dy], [e + dx, s - dy], [e + dx, n + dy], [w - dx, n + dy], [w - dx, s - dy]];
  return ['all', ['==', ['get', 'name'], street.name], ['within', { type: 'Polygon', coordinates: [ring] }]];
}

/** Layers of the base map for one theme; the scene supplies the buildings it hides and keeps the layers' own filters. */
export class BaseStyle {
  constructor(
    private theme: Theme,
    private data: AppData,
    /** Pixels per metre at zoom 0 at the region's latitude (512 px tiles). */
    private pxPerM0: number,
    /** Own filter of each layer before the neighbourhood cut is added (filled here, read by the scene). */
    private baseFilters: Map<string, FilterSpecification | undefined>,
    private hidden: { contextFilter(): ExpressionSpecification; roofFilter(): ExpressionSpecification },
  ) {}

  texture(id: string): TextureImage | null {
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

  /**
   * Base map, bottom to top: ground, green areas, water, roads by pavement (sidewalks, paving stones, dirt, lane
   * marks up close), boundaries, night light pools, flat buildings, the street chosen in the search and the street
   * names (on the ground), then the 3D buildings and the low-poly scenery (canopy of woods, trees, street lamps).
   * Each layer's own filter is kept in `baseFilters`, so the neighbourhood cut can be added to it.
   */
  baseLayers(t: Theme): LayerSpecification[] {
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
        filter: this.hidden.contextFilter(),
        paint: {
          'fill-color': t.context,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.35, Z_FLAT_END, 0.9],
        },
      },
      {
        // the street chosen in the search (highlightStreet): a soft band wider than the road, under the names (drawn
        // over everything at the end of the style); it lies after the shadows and the light pools, so neither darkens
        // nor tints it
        id: 'road-highlight',
        type: 'line',
        source: 'osm',
        'source-layer': 'roads',
        filter: streetHighlightFilter(null),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': t.streetHighlight,
          'line-opacity': STREET_HIGHLIGHT_OPACITY,
          'line-blur': ['interpolate', ['linear'], ['zoom'], 14, 1, 17, 2.5],
          'line-width': this.streetHighlightWidth(),
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
        filter: this.hidden.contextFilter(),
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
        filter: this.hidden.roofFilter(),
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

  /**
   * Width of the street highlight: a few pixels from afar, at least STREET_HIGHLIGHT_MIN_PX at zoom 16-17 (where the
   * search frames a street; the road alone is a thin line there, on phones too), the road's real width plus
   * STREET_HIGHLIGHT_EXTRA_M up close.
   */
  private streetHighlightWidth(): ExpressionSpecification {
    const real = (z: number): ExpressionSpecification => ['*', ['+', ROAD_WIDTH_M, STREET_HIGHLIGHT_EXTRA_M], this.pxPerM0 * 2 ** z];
    const [min16, min17] = STREET_HIGHLIGHT_MIN_PX;
    return ['interpolate', ['exponential', 2], ['zoom'], 12, 4, 14, 8, 16, ['max', real(16), min16], 17, ['max', real(17), min17], 22, real(22)];
  }

  /**
   * Street names up close. The letters stand upright towards the viewer (pitch alignment 'viewport') while the name
   * still follows the street (rotation alignment 'map'): lying on the ground they were foreshortened and unreadable
   * at the usual 3D pitch. The layer is drawn over the 3D layers, so a building or a tree in front does not cut a name;
   * the bairro mask does not cover it there, the cut is its CLIP_LAYERS filter. MapLibre's collision drops the names
   * that would overlap (with some room around each, text-padding); main streets are placed first.
   */
  streetNamesLayer(t: Theme): LayerSpecification {
    const filter: FilterSpecification = ['has', 'name'];
    // not in baseLayers: its own filter is kept here for the bairro cut (applyFilter)
    this.baseFilters.set('road-names', filter);
    return {
      id: 'road-names',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'roads',
      minzoom: Z_STREET_NAMES,
      filter,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 320,
        'symbol-sort-key': ['match', ['get', 'highway'], ['motorway', 'trunk', ...MAJOR_ROADS], 0, MINOR_ROADS, 1, 2],
        'text-field': ['get', 'name'],
        'text-font': [STREET_FONT],
        'text-size': ['interpolate', ['linear'], ['zoom'], Z_STREET_NAMES, 12, 19, 15],
        'text-letter-spacing': 0.03,
        'text-max-angle': 35,
        'text-padding': 6,
        'text-pitch-alignment': 'viewport',
        'text-rotation-alignment': 'map',
        'text-keep-upright': true,
      },
      paint: {
        'text-color': t.streetName.text,
        'text-halo-color': t.streetName.halo,
        'text-halo-width': 1.6,
        'text-halo-blur': 0.3,
      },
    };
  }

  greenColor(t: Theme): ExpressionSpecification {
    const g = t.scenery.greens;
    return ['match', ['get', 'k'], 'grass', g.grass, 'wood', g.wood, 'scrub', g.scrub, 'wetland', g.wetland, 'farm', g.farm, g.park];
  }

  roadColor(t: Theme): ExpressionSpecification {
    const sc = t.scenery;
    return ['match', ['get', 's'], 'a', sc.asphalt, 'c', sc.paving, 'p', sc.paved, 'u', sc.unpaved, t.roads];
  }

  /** Light of a street lamp by its kind (t, scripts/lib/scenery.mjs): warm white LED, neutral white LED, sodium. */
  glowColor(sc: Theme['scenery']): ExpressionSpecification {
    return ['match', ['coalesce', ['get', 't'], 'w'], 'n', sc.glowNeutral, 's', sc.glowSodium, sc.glow];
  }

  /** Pole and arm, and the luminaire in the colour of its light (orange for sodium). */
  lampColor(sc: Theme['scenery']): ExpressionSpecification {
    return ['match', ['get', 'p'], 'lum', ['match', ['coalesce', ['get', 't'], 'w'], 's', sc.lumSodium, sc.lum], sc.pole];
  }

  treeColor(t: Theme): ExpressionSpecification {
    const sc = t.scenery;
    const shade = (c: [string, string, string]): ExpressionSpecification => ['match', ['get', 'v'], 0, c[0], 1, c[1], c[2]];
    return ['match', ['get', 'p'], 'trunk', sc.trunk, 'bush', sc.bush, 'top', shade(sc.tops), shade(sc.crowns)];
  }

  /** Source of the close-up detail layers (older data has them in the base archive). */
  get detailSource(): string {
    return this.data.detailUrl ? 'detail' : 'osm';
  }

  /** Roof colour per variant v (clay tiles, fibre cement, dark tiles, concrete). */
  roofColor(t: Theme): ExpressionSpecification {
    const r = t.scenery.roofs;
    return ['match', ['get', 'v'], 1, r[1], 2, r[2], 3, r[3], r[0]];
  }
}
