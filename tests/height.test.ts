import { describe, expect, it } from 'vitest';
import { computeRenderHeight, parseOsmNumber } from '../scripts/lib/height.mjs';

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
