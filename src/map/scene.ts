import { AttributionControl, LngLatBounds, Map as MlMap, NavigationControl } from 'maplibre-gl';
import type { ExpressionSpecification, GeoJSONSource, MapGeoJSONFeature, StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import turfCircle from '@turf/circle';
import turfBbox from '@turf/bbox';
import type { AppData } from '../data/load';
import type { Listing } from '../data/types';
import type { Theme } from './lighting';

const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> (ODbL)';
const MAPLIBRE_ATTRIBUTION = '<a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a>';

const LAND_HEIGHT_M = 0.5;
const METERS_PER_FLOOR = 3;

type ListingKind = 'building' | 'land' | 'approx';
interface ListingFeatureProps {
  listingId: string;
  kind: ListingKind;
  height: number;
  matched: boolean;
}

/** Layers whose features are clickable listings (filters keep only matched ones). */
const INTERACTIVE_LAYERS = ['listing-buildings', 'listing-land', 'listing-approx-fill'];

export interface SceneEvents {
  onListingClick: (listingId: string) => void;
  onEmptyClick: () => void;
  /** Mouse is over a clickable listing (point in map-container pixels), or left it (null). */
  onListingHover?: (listingId: string | null, point?: { x: number; y: number }) => void;
}

export class Scene {
  readonly map: MlMap;
  private listingFeatures: Feature<Polygon | MultiPolygon, ListingFeatureProps>[] = [];
  private featureIdByListing = new Map<string, number>();
  private hoveredId: number | null = null;
  private selectedId: number | null = null;
  readonly ready: Promise<void>;

  constructor(
    container: HTMLElement,
    private data: AppData,
    private theme: Theme,
    private events: SceneEvents,
  ) {
    const [w, s, e, n] = data.meta.boundaryBbox;
    // maxBounds: neighbourhood bbox expanded by 60% of its size on each side
    const padX = (e - w) * 0.6;
    const padY = (n - s) * 0.6;
    this.buildListingFeatures();

    this.map = new MlMap({
      container,
      style: this.buildStyle(),
      bounds: [w, s, e, n],
      fitBoundsOptions: { padding: 40 },
      pitch: 58,
      bearing: -20,
      maxPitch: 75,
      minZoom: 13.5,
      maxZoom: 19.5,
      maxBounds: [w - padX, s - padY, e + padX, n + padY],
      attributionControl: false,
    });
    this.map.addControl(new AttributionControl({ compact: false, customAttribution: MAPLIBRE_ATTRIBUTION }), 'bottom-left');
    this.map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right');

    // fitBounds leaves a lot of empty margin with a pitched camera; start slightly closer
    if (!window.matchMedia('(max-width: 720px)').matches) this.map.setZoom(this.map.getZoom() + 0.5);

    this.ready = new Promise((resolve) => this.map.once('load', () => resolve()));
    this.bindInteractions();
  }

  // ---------------------------------------------------------------- style

  private buildStyle(): StyleSpecification {
    const t = this.theme;
    const listingBuildingIds = this.data.listings.listings
      .filter((l) => l.buildingOsmId && !l.approximateLocation)
      .map((l) => l.buildingOsmId!);
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
      // No external tiles, glyphs or sprites: everything comes from local GeoJSON.
      sources: {
        boundary: { type: 'geojson', data: this.data.boundary, attribution: OSM_ATTRIBUTION },
        buildings: { type: 'geojson', data: this.data.buildings },
        roads: { type: 'geojson', data: this.data.roads },
        water: { type: 'geojson', data: this.data.water },
        green: { type: 'geojson', data: this.data.green },
        listings: { type: 'geojson', data: this.listingCollection() },
      },
      light: { anchor: 'map', ...t.light },
      sky: { 'sky-color': t.sky.sky, 'horizon-color': t.sky.horizon, 'fog-color': t.sky.horizon },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': t.background } },
        {
          id: 'green',
          type: 'fill',
          source: 'green',
          paint: { 'fill-color': t.green, 'fill-opacity': 0.8 },
        },
        {
          id: 'water-area',
          type: 'fill',
          source: 'water',
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': t.water },
        },
        {
          id: 'water-line',
          type: 'line',
          source: 'water',
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: { 'line-color': t.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.5, 18, 6] },
        },
        {
          id: 'roads',
          type: 'line',
          source: 'roads',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': t.roads,
            'line-width': [
              'interpolate',
              ['exponential', 1.6],
              ['zoom'],
              14,
              ['match', ['get', 'highway'], ['primary', 'secondary', 'tertiary'], 2.5, ['footway', 'path', 'steps', 'cycleway', 'pedestrian'], 0.5, 1.5],
              18,
              ['match', ['get', 'highway'], ['primary', 'secondary', 'tertiary'], 18, ['footway', 'path', 'steps', 'cycleway', 'pedestrian'], 2, 10],
            ],
          },
        },
        {
          id: 'boundary-line',
          type: 'line',
          source: 'boundary',
          paint: { 'line-color': t.boundary, 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
        },
        {
          id: 'context-buildings',
          type: 'fill-extrusion',
          source: 'buildings',
          // Listing buildings are drawn by the listing layers instead
          filter: ['!', ['in', ['get', 'osmId'], ['literal', listingBuildingIds]]],
          paint: {
            'fill-extrusion-color': t.context,
            'fill-extrusion-height': ['get', 'renderHeight'],
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.95,
            'fill-extrusion-vertical-gradient': true,
          },
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
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-opacity': 1,
            // no darkening towards the base: keeps the highlight colour readable on shaded faces
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
      ],
    };
  }

  // ---------------------------------------------------------------- listings

  private buildListingFeatures(): void {
    const byOsmId = new Map(this.data.buildings.features.map((f) => [f.properties.osmId, f]));
    this.listingFeatures = [];
    this.data.listings.listings.forEach((l, i) => {
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
        const b = byOsmId.get(l.buildingOsmId!);
        if (!b) return;
        geometry = b.geometry;
        kind = 'building';
        height = l.floors ? l.floors * METERS_PER_FLOOR : b.properties.renderHeight;
      }
      this.listingFeatures.push({
        type: 'Feature',
        id,
        properties: { listingId: l.id, kind, height, matched: true },
        geometry,
      });
    });
  }

  private listingCollection(): FeatureCollection<Polygon | MultiPolygon, ListingFeatureProps> {
    return { type: 'FeatureCollection', features: this.listingFeatures };
  }

  /** Marks which listings match the applied filters (others are dimmed and not clickable). */
  setMatched(matchedIds: Set<string>): void {
    for (const f of this.listingFeatures) f.properties.matched = matchedIds.has(f.properties.listingId);
    (this.map.getSource('listings') as GeoJSONSource | undefined)?.setData(this.listingCollection());
    this.setHover(null);
  }

  listingBounds(listing: Listing): [number, number, number, number] | null {
    const f = this.listingFeatures.find((x) => x.properties.listingId === listing.id);
    return f ? (turfBbox(f) as [number, number, number, number]) : null;
  }

  fitToListings(listings: Listing[]): void {
    const b = new LngLatBounds();
    for (const l of listings) {
      const bb = this.listingBounds(l);
      if (bb) b.extend([bb[0], bb[1]]).extend([bb[2], bb[3]]);
    }
    if (b.isEmpty()) return;
    this.map.fitBounds(b, { padding: this.cameraPadding(), maxZoom: 17.5, pitch: 55, duration: 1200 });
  }

  flyToListing(listing: Listing): void {
    const bb = this.listingBounds(listing);
    if (!bb) return;
    this.map.fitBounds(bb, { padding: this.cameraPadding(), maxZoom: 17.5, pitch: 58, duration: 1200 });
  }

  private cameraPadding() {
    const mobile = window.matchMedia('(max-width: 720px)').matches;
    return mobile ? { top: 80, bottom: 120, left: 30, right: 30 } : { top: 120, bottom: 60, left: 60, right: 60 };
  }

  select(listingId: string | null): void {
    if (this.selectedId !== null) this.map.setFeatureState({ source: 'listings', id: this.selectedId }, { selected: false });
    this.selectedId = listingId ? (this.featureIdByListing.get(listingId) ?? null) : null;
    if (this.selectedId !== null) this.map.setFeatureState({ source: 'listings', id: this.selectedId }, { selected: true });
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
    m.setPaintProperty('background', 'background-color', t.background);
    m.setPaintProperty('green', 'fill-color', t.green);
    m.setPaintProperty('water-area', 'fill-color', t.water);
    m.setPaintProperty('water-line', 'line-color', t.water);
    m.setPaintProperty('roads', 'line-color', t.roads);
    m.setPaintProperty('boundary-line', 'line-color', t.boundary);
    m.setPaintProperty('context-buildings', 'fill-extrusion-color', t.context);
    m.setPaintProperty('listing-dimmed', 'fill-extrusion-color', t.dimmed);
    m.setPaintProperty('listing-buildings', 'fill-extrusion-color', listingBuildingHover);
    m.setPaintProperty('listing-land', 'fill-extrusion-color', landHover);
    m.setPaintProperty('listing-outline', 'line-color', t.accentStrong);
    m.setPaintProperty('listing-approx-fill', 'fill-color', [
      'case',
      ['==', ['get', 'matched'], false],
      t.dimmed,
      ['boolean', ['feature-state', 'hover'], false],
      t.accentHover,
      t.accent,
    ]);
    m.setPaintProperty('listing-approx-line', 'line-color', ['case', ['==', ['get', 'matched'], false], t.dimmed, t.accent]);
    m.setLight({ anchor: 'map', ...t.light });
    m.setSky({ 'sky-color': t.sky.sky, 'horizon-color': t.sky.horizon, 'fog-color': t.sky.horizon });
  }

  // ---------------------------------------------------------------- interaction

  private queryListing(point: { x: number; y: number }): MapGeoJSONFeature | undefined {
    const layers = INTERACTIVE_LAYERS.filter((id) => this.map.getLayer(id));
    return this.map
      .queryRenderedFeatures([point.x, point.y], { layers })
      .find((f) => f.properties?.matched === true);
  }

  private setHover(id: number | null): void {
    if (this.hoveredId === id) return;
    if (this.hoveredId !== null) this.map.setFeatureState({ source: 'listings', id: this.hoveredId }, { hover: false });
    this.hoveredId = id;
    if (id !== null) this.map.setFeatureState({ source: 'listings', id }, { hover: true });
    this.map.getCanvas().style.cursor = id !== null ? 'pointer' : '';
  }

  private bindInteractions(): void {
    const hoverOff = () => {
      this.setHover(null);
      this.events.onListingHover?.(null);
    };
    this.map.on('mousemove', (e) => {
      // no tooltip while the user is dragging/rotating the map
      if (this.map.isMoving()) return hoverOff();
      const f = this.queryListing(e.point);
      this.setHover(f ? (f.id as number) : null);
      this.events.onListingHover?.(f ? String(f.properties.listingId) : null, { x: e.point.x, y: e.point.y });
    });
    this.map.on('mouseout', hoverOff);
    this.map.on('movestart', hoverOff);
    this.map.on('click', (e) => {
      this.events.onListingHover?.(null);
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

