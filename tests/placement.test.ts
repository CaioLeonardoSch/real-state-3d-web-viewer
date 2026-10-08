import { describe, expect, it } from 'vitest';
import turfArea from '@turf/area';
import turfDistance from '@turf/distance';
import { approxCenterFor, lotRectangle, lotSize } from '../src/utils/placement';
import { isResidentialBuilding } from '../scripts/lib/residential.mjs';

const center: [number, number] = [-48.8535, -26.2903];

describe('new listing geometry', () => {
  it('lotSize keeps the area and a 2.5:1 proportion', () => {
    const { front, depth } = lotSize(450);
    expect(front * depth).toBeCloseTo(450, -1);
    expect(depth / front).toBeCloseTo(2.5, 1);
  });
  it('lotRectangle has the requested size', () => {
    const lot = lotRectangle(center, 12, 30);
    expect(turfArea(lot)).toBeCloseTo(360, -1);
    expect(lot.coordinates[0]).toHaveLength(5);
  });
  it('approximate centre is 50–149 m away and deterministic', () => {
    const a = approxCenterFor('user-casa-abc', center);
    const d = turfDistance(center, a, { units: 'meters' });
    expect(d).toBeGreaterThanOrEqual(49);
    expect(d).toBeLessThan(150);
    expect(approxCenterFor('user-casa-abc', center)).toEqual(a);
  });
});

describe('isResidentialBuilding', () => {
  it('accepts plain residential buildings only', () => {
    expect(isResidentialBuilding({ building: 'house' })).toBe(true);
    expect(isResidentialBuilding({ building: 'yes' })).toBe(true);
    expect(isResidentialBuilding({ building: 'commercial' })).toBe(false);
    expect(isResidentialBuilding({ building: 'apartments', name: 'Edifício X' })).toBe(false);
    expect(isResidentialBuilding({ building: 'yes', shop: 'bakery' })).toBe(false);
    expect(isResidentialBuilding(undefined)).toBe(false);
  });
});
