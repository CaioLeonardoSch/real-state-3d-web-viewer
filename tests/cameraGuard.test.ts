import { describe, expect, it } from 'vitest';
import { cameraFix, cameraPosition } from '../src/map/cameraGuard';

const altitude = (distance: number, pitch: number) => distance * Math.cos((pitch * Math.PI) / 180);

describe('camera above the roofs', () => {
  it('leaves a camera that is already high enough', () => {
    expect(cameraFix(80, 60, 30)).toBeNull();
    expect(cameraFix(20, 75, 0)).toBeNull(); // no building below
  });
  it('tilts up, keeping the distance, until the roof is cleared', () => {
    const fix = cameraFix(altitude(120, 75), 75, 60)!;
    expect(fix.zoomBy).toBe(0);
    expect(fix.pitch).toBeLessThan(75);
    expect(altitude(120, fix.pitch)).toBeCloseTo(72, 6);
  });
  it('zooms out when even looking straight down is too low', () => {
    const fix = cameraFix(altitude(40, 70), 70, 70)!;
    expect(fix.pitch).toBe(0);
    expect(40 * 2 ** -fix.zoomBy).toBeCloseTo(82, 6);
  });
  it('places the camera behind the centre, looking along the bearing', () => {
    const top = cameraPosition([-48.85, -26.3], 18, 0, 0, 36.87, 800);
    expect(top.lngLat[0]).toBeCloseTo(-48.85, 9);
    // 1200 px of 0,537 m at zoom 18 (latitude 26,3°)
    expect(top.altitudeM).toBeCloseTo(1200 * ((40_075_016.686 * Math.cos((26.3 * Math.PI) / 180)) / (512 * 2 ** 18)), 1);
    const tilted = cameraPosition([-48.85, -26.3], 18, 60, 90, 36.87, 800); // looking east: the camera is west
    expect(tilted.lngLat[0]).toBeLessThan(-48.85);
    expect(tilted.lngLat[1]).toBeCloseTo(-26.3, 9);
    expect(tilted.altitudeM).toBeCloseTo(top.altitudeM / 2, 6);
  });
});
