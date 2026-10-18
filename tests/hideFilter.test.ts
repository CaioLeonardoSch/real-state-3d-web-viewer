import { describe, expect, it } from 'vitest';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { hideFilter } from '../src/map/scene';

const keeps = (ids: string[], osmId: string) =>
  featureFilter(hideFilter(['get', 'osmId'], ids), 'layers[0].filter').filter({ zoom: 15 }, { type: 3, properties: { osmId } });

describe('hideFilter (listed buildings hidden from the base map)', () => {
  it('hides the listed buildings and keeps the others', () => {
    expect(keeps(['way/1', 'way/2'], 'way/2')).toBe(false);
    expect(keeps(['way/1', 'way/2'], 'way/3')).toBe(true);
  });

  it('accepts repeated ids (a match with repeated labels is an invalid style)', () => {
    expect(keeps(['way/1', 'way/1'], 'way/1')).toBe(false);
  });

  it('keeps everything with no listed building', () => {
    expect(keeps([], 'way/1')).toBe(true);
  });

  it('works on the numeric feature id of the roofs', () => {
    const f = featureFilter(hideFilter(['id'], [10, 11]), 'layers[0].filter');
    expect(f.filter({ zoom: 15 }, { type: 3, id: 10, properties: {} })).toBe(false);
    expect(f.filter({ zoom: 15 }, { type: 3, id: 12, properties: {} })).toBe(true);
  });
});
