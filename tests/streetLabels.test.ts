import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import type { FilterSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { Scene, streetHighlightFilter } from '../src/map/scene';
import { themeFor } from '../src/map/lighting';
import { M_PER_DEG } from '../src/map/shadows';

const LAT = -26.3;
const LON = -48.85;
/** Page published in a subfolder (GitHub Pages), as vite.config.ts base './' allows. */
const PAGE = 'https://exemplo.github.io/mapa/index.html';

/** The style of a scene, without a map (buildStyle only reads the data, the theme and the listings). */
function sceneOf(tod: 'morning' | 'night'): Scene {
  return Object.assign(Object.create(Scene.prototype), {
    data: {
      tilesUrl: 'https://exemplo.github.io/mapa/data/joinville.pmtiles',
      detailUrl: 'https://exemplo.github.io/mapa/data/joinville-detalhe.pmtiles',
      meta: { center: [LON, LAT], heightSources: ['OpenStreetMap'] },
      boundary: { type: 'FeatureCollection', features: [] },
      developments: [],
    },
    theme: themeFor(tod, LAT, LON).theme,
    listings: [],
    listingFeatures: [],
    featureIdByListing: new Map(),
    baseFilters: new Map(),
    pxPerM0: 512 / (40075016.686 * Math.cos((LAT * Math.PI) / 180)),
  });
}

function styleOf(tod: 'morning' | 'night'): StyleSpecification {
  return (Scene.prototype as unknown as { buildStyle(): StyleSpecification }).buildStyle.call(sceneOf(tod));
}

const layer = (style: StyleSpecification, id: string): LayerSpecification => {
  const l = style.layers.find((x) => x.id === id);
  if (!l) throw new Error(`camada ${id} ausente`);
  return l;
};

describe('nomes das ruas no estilo do mapa', () => {
  beforeAll(() => vi.stubGlobal('location', new URL(PAGE)));
  afterAll(() => vi.unstubAllGlobals());

  it('é um estilo válido', () => {
    expect(validateStyleMin(styleOf('morning'))).toEqual([]);
    expect(validateStyleMin(styleOf('night'))).toEqual([]);
  });

  it('desenha as letras com a fonte Inter do próprio site, sem arquivos de glifos', () => {
    const style = styleOf('morning');
    expect(style.glyphs).toBeUndefined();
    const face = style['font-faces']?.['Inter Medium'];
    expect(typeof face).toBe('string');
    const url = new URL(face as string);
    // endereço absoluto, na mesma origem da página
    expect(url.origin).toBe(new URL(PAGE).origin);
    expect(url.pathname).toMatch(/inter-latin-500-normal.*\.woff2$/);
    expect(layer(style, 'road-names').layout).toMatchObject({ 'text-font': ['Inter Medium'] });
  });

  it('desenha os nomes sobre a cidade em 3D e sob os marcadores dos imóveis', () => {
    const ids = styleOf('morning').layers.map((l) => l.id);
    const at = (id: string) => ids.indexOf(id);
    // prédios, telhados, árvores, postes, sombras, obras e imóveis em 3D não cortam os nomes
    for (const id of ['building-shadows', 'context-buildings', 'roofs', 'wood-canopy', 'lamps', 'listing-buildings', 'listing-unbuilt', 'construction-cranes', 'pick-preview', 'listing-pins-dimmed'])
      expect(at('road-names'), id).toBeGreaterThan(at(id));
    // os empreendimentos entram antes de 'listing-pins-dimmed' (main.ts): também ficam sob os nomes
    expect(at('road-names')).toBeLessThan(at('listing-pins'));
    // a máscara do bairro não cobre mais os nomes: o recorte é o filtro de distância (teste abaixo)
    expect(at('road-names')).toBeGreaterThan(at('clip-mask'));
    // a rua escolhida na busca fica no chão: sobre as ruas, sob os prédios e os nomes
    expect(at('road-highlight')).toBeGreaterThan(at('roads-lanes'));
    expect(at('road-highlight')).toBeLessThan(at('context-buildings'));
    expect(at('road-highlight')).toBeLessThan(at('road-names'));
  });

  it('em pé para quem olha (legíveis com o mapa inclinado), seguindo a direção da rua', () => {
    const l = layer(styleOf('morning'), 'road-names') as { layout: Record<string, unknown> };
    expect(l.layout).toMatchObject({
      'symbol-placement': 'line',
      'text-pitch-alignment': 'viewport',
      'text-rotation-alignment': 'map',
      'text-keep-upright': true,
    });
    // maiores de perto: 12 px no zoom 16, 15 px no 19
    expect(l.layout['text-size']).toEqual(['interpolate', ['linear'], ['zoom'], 16, 12, 19, 15]);
  });

  it('só de perto, só ruas com nome, e com as cores do dia e da noite', () => {
    const day = layer(styleOf('morning'), 'road-names');
    const night = layer(styleOf('night'), 'road-names');
    expect(day).toMatchObject({ type: 'symbol', source: 'osm', 'source-layer': 'roads', minzoom: 16, filter: ['has', 'name'] });
    const paint = (l: LayerSpecification) => (l as { paint: Record<string, unknown> }).paint;
    expect(paint(day)['text-color']).toBe(themeFor('morning', LAT, LON).theme.streetName.text);
    expect(paint(night)['text-color']).toBe(themeFor('night', LAT, LON).theme.streetName.text);
    expect(paint(night)['text-halo-color']).not.toBe(paint(day)['text-halo-color']);
    // contraste: texto escuro de dia e claro à noite, com halo largo
    const lum = (hex: string) => [1, 3, 5].reduce((a, i) => a + parseInt(hex.slice(i, i + 2), 16), 0) / 3;
    expect(lum(paint(day)['text-color'] as string)).toBeLessThan(90);
    expect(lum(paint(day)['text-halo-color'] as string)).toBeGreaterThan(230);
    expect(lum(paint(night)['text-color'] as string)).toBeGreaterThan(210);
    expect(lum(paint(night)['text-halo-color'] as string)).toBeLessThan(40);
    expect(paint(day)['text-halo-width']).toBeGreaterThanOrEqual(1.5);
  });

  it('com o mapa recortado num bairro, os nomes de fora somem pelo filtro de distância', () => {
    const scene = sceneOf('morning');
    (Scene.prototype as unknown as { buildStyle(): StyleSpecification }).buildStyle.call(scene);
    const filters = new Map<string, unknown>();
    const map = {
      getLayer: () => ({}),
      getFilter: () => null,
      setFilter: (id: string, f: unknown) => filters.set(id, f),
      getSource: () => undefined,
      setLayoutProperty: () => {},
      getZoom: () => 17,
    };
    Object.assign(scene, { map, clip: null, clipNames: null, labelMarkers: [] });
    const area = { type: 'Polygon', coordinates: [[[LON, LAT], [LON + 0.01, LAT], [LON + 0.01, LAT + 0.01], [LON, LAT]]] };
    (scene as unknown as { setClip(a: unknown): void }).setClip(area);
    const f = filters.get('road-names') as unknown[];
    expect(f[0]).toBe('all');
    expect(f[1]).toEqual(['has', 'name']);
    expect((f[2] as unknown[])[0]).toBe('<=');
    expect(((f[2] as unknown[])[1] as unknown[])[0]).toBe('distance');
    (scene as unknown as { setClip(a: unknown): void }).setClip(null);
    expect(filters.get('road-names')).toEqual(['has', 'name']);
  });

  it('a rua destacada começa apagada', () => {
    expect(layer(styleOf('morning'), 'road-highlight')).toMatchObject({ type: 'line', 'source-layer': 'roads', filter: false });
  });
});

describe('destaque da rua escolhida na busca', () => {
  it('sem rua, nada aceso', () => {
    expect(streetHighlightFilter(null)).toBe(false);
  });

  it('o nome da rua, dentro do retângulo dela com uma margem de cerca de 60 m', () => {
    const bbox: [number, number, number, number] = [-48.85, -26.31, -48.84, -26.3];
    const f = streetHighlightFilter({ name: 'Rua do Príncipe', bbox }) as unknown[];
    expect(f[0]).toBe('all');
    expect(f[1]).toEqual(['==', ['get', 'name'], 'Rua do Príncipe']);
    const [op, geometry] = f[2] as [string, { type: string; coordinates: number[][][] }];
    expect(op).toBe('within');
    expect(geometry.type).toBe('Polygon');
    const ring = geometry.coordinates[0];
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const kx = M_PER_DEG * Math.cos((LAT * Math.PI) / 180);
    expect((bbox[1] - Math.min(...ys)) * M_PER_DEG).toBeCloseTo(60, 0);
    expect((Math.max(...xs) - bbox[2]) * kx).toBeCloseTo(60, 0);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('é um filtro válido para a camada', () => {
    const style = {
      version: 8,
      sources: { osm: { type: 'vector', tiles: ['https://exemplo/{z}/{x}/{y}.pbf'] } },
      layers: [
        {
          id: 'road-highlight',
          type: 'line',
          source: 'osm',
          'source-layer': 'roads',
          filter: streetHighlightFilter({ name: 'Rua XV de Novembro', bbox: [-48.85, -26.31, -48.84, -26.3] }) as FilterSpecification,
        },
      ],
    } as StyleSpecification;
    expect(validateStyleMin(style)).toEqual([]);
  });
});

describe('enquadramento da rua escolhida (frameStreet)', () => {
  const calls: { fn: string; opts: Record<string, unknown> }[] = [];
  const sceneWith = (zoom: number) =>
    Object.assign(Object.create(Scene.prototype), {
      map: {
        setPadding: () => {},
        cameraForBounds: (_b: unknown, o: Record<string, unknown>) => (calls.push({ fn: 'camera', opts: o }), { zoom }),
        fitBounds: (_b: unknown, o: Record<string, unknown>) => calls.push({ fn: 'fit', opts: o }),
        flyTo: (o: Record<string, unknown>) => calls.push({ fn: 'fly', opts: o }),
      },
    }) as Scene;
  const bbox: [number, number, number, number] = [-48.85, -26.31, -48.84, -26.3];
  const point: [number, number] = [-48.845, -26.305];
  beforeAll(() => vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) }));
  afterAll(() => vi.unstubAllGlobals());

  it('sem margem extra, como antes: a rua inteira, ou um ponto dela de perto', () => {
    calls.length = 0;
    sceneWith(16.5).frameStreet(bbox, point);
    expect(calls.map((c) => c.fn)).toEqual(['camera', 'fit']);
    expect(calls[1].opts).toMatchObject({ padding: { top: 80, bottom: 120, left: 30, right: 30 }, pitch: 55 });
    calls.length = 0;
    sceneWith(14).frameStreet(bbox, point);
    expect(calls[1]).toMatchObject({ fn: 'fly', opts: { center: point, zoom: 16.3, pitch: 55 } });
    expect(calls[1].opts.padding).toBeUndefined();
  });

  it('com margem extra embaixo (cartão no celular), a rua fica na parte do mapa acima dele', () => {
    calls.length = 0;
    sceneWith(16.5).frameStreet(bbox, point, { bottom: 150 });
    expect(calls[0].opts).toMatchObject({ padding: { bottom: 270 } });
    expect(calls[1].opts).toMatchObject({ padding: { top: 80, bottom: 270, left: 30, right: 30 } });
    calls.length = 0;
    sceneWith(14).frameStreet(bbox, point, { bottom: 150 });
    expect(calls[1]).toMatchObject({ fn: 'fly', opts: { center: point, zoom: 16.3, padding: { top: 0, bottom: 150, left: 0, right: 0 } } });
  });
});
