import { describe, expect, it } from 'vitest';
import { computeRenderHeight, parseOsmNumber } from '../scripts/lib/height.mjs';
import { floorsForLot } from '../scripts/lib/cadastre-floors.mjs';

describe('computeRenderHeight', () => {
  it('uses the height tag when present', () => {
    expect(computeRenderHeight({ height: '21.5', 'building:levels': '3' })).toEqual({ renderHeight: 21.5, source: 'height' });
  });
  it('accepts "12 m" and decimal comma', () => {
    expect(computeRenderHeight({ height: '12 m' }).renderHeight).toBe(12);
    expect(computeRenderHeight({ height: '7,5' }).renderHeight).toBe(7.5);
  });
  it('falls back to building:levels × 3 m', () => {
    expect(computeRenderHeight({ 'building:levels': '4' })).toEqual({ renderHeight: 12, source: 'levels' });
  });
  it('ignores invalid height and uses levels', () => {
    expect(computeRenderHeight({ height: 'tall', 'building:levels': '2' })).toEqual({ renderHeight: 6, source: 'levels' });
  });
  it('uses the cadastre estimate when OSM has no height', () => {
    expect(computeRenderHeight({ building: 'yes' }, 10)).toEqual({ renderHeight: 30, source: 'cadastre' });
    // OSM data wins over the estimate
    expect(computeRenderHeight({ 'building:levels': '4' }, 10)).toEqual({ renderHeight: 12, source: 'levels' });
  });
  it('defaults to 6 m', () => {
    expect(computeRenderHeight({ building: 'yes' })).toEqual({ renderHeight: 6, source: 'default' });
    expect(computeRenderHeight(undefined)).toEqual({ renderHeight: 6, source: 'default' });
    expect(computeRenderHeight({ height: '0' }).source).toBe('default');
  });
  it('parseOsmNumber rejects garbage', () => {
    expect(parseOsmNumber('3;4')).toBeNaN();
    expect(parseOsmNumber(undefined)).toBeNaN();
  });
});

describe('floorsForLot (cadastre built area ÷ OSM footprint)', () => {
  it('one building: built area over footprint', () => {
    expect(floorsForLot(2400, [400])).toEqual([6]);
    expect(floorsForLot(120, [130])).toEqual([1]);
  });
  it('main building plus annex: the annex is one floor, the rest goes to the main one', () => {
    // 600 m² tower floor plate + 40 m² guardhouse, 6.040 m² built → (6040 − 40) / 600 = 10
    expect(floorsForLot(6040, [600, 40])).toEqual([10, 1]);
  });
  it('condominium of similar houses: same floors for all', () => {
    expect(floorsForLot(1200, [100, 100, 100, 100, 100, 100])).toEqual([2, 2, 2, 2, 2, 2]);
  });
  it('rejects data that disagree', () => {
    expect(floorsForLot(0, [100])).toBeNull(); // no built area
    expect(floorsForLot(10, [200])).toBeNull(); // ratio below 0.2
    expect(floorsForLot(5000, [100])).toBeNull(); // 50 floors on 100 m²
    expect(floorsForLot(1200, [120])).toBeNull(); // 10 floors on a 120 m² outline: tower not mapped in OSM
    expect(floorsForLot(3000, [100, 100, 100])).toBeNull(); // "10-floor houses"
  });
});
