import { describe, expect, it } from 'vitest';
import type { Position } from 'geojson';
import { M_PER_DEG, SHADOW_MAX_RATIO, convexHull, shadowOffset, shadowRing } from '../src/map/shadows';
import { sunPosition } from '../src/map/lighting';

const LAT = -26.3;
const LON = -48.85;
const kx = M_PER_DEG * Math.cos((LAT * Math.PI) / 180);
/** Deslocamento em metros [leste, norte]. */
const metres = (o: [number, number] | null): [number, number] => [o![0] * kx, o![1] * M_PER_DEG];

describe('sombra dos prédios no chão', () => {
  it('cai do lado oposto ao sol, com comprimento altura / tan(altitude)', () => {
    // sol a leste, 45° acima do horizonte: cada metro de altura faz 1 m de sombra para oeste
    const [e, n] = metres(shadowOffset({ azimuth: 90, altitude: 45 }, LAT));
    expect(e).toBeCloseTo(-1, 6);
    expect(n).toBeCloseTo(0, 6);
    // sol ao norte a 30°: √3 m para o sul
    const [e2, n2] = metres(shadowOffset({ azimuth: 0, altitude: 30 }, LAT));
    expect(e2).toBeCloseTo(0, 6);
    expect(n2).toBeCloseTo(-Math.sqrt(3), 6);
  });
  it('sem sombra à noite ou com o sol rente ao horizonte; perto dele, comprimento limitado', () => {
    expect(shadowOffset({ azimuth: 90, altitude: -10 }, LAT)).toBeNull();
    expect(shadowOffset({ azimuth: 90, altitude: 2 }, LAT)).toBeNull();
    expect(-metres(shadowOffset({ azimuth: 90, altitude: 5 }, LAT))[0]).toBeCloseTo(SHADOW_MAX_RATIO, 6);
  });
  it('em Joinville, de manhã a sombra vai para oeste e à tarde para leste', () => {
    const morning = metres(shadowOffset(sunPosition('morning', LAT, LON), LAT));
    const afternoon = metres(shadowOffset(sunPosition('afternoon', LAT, LON), LAT));
    expect(morning[0]).toBeLessThan(-1);
    expect(afternoon[0]).toBeGreaterThan(0.5);
    expect(shadowOffset(sunPosition('night', LAT, LON), LAT)).toBeNull();
  });
  it('prédio retangular: a sombra é o casco do pé e da cópia deslocada', () => {
    const [w, s, e, n] = [LON, LAT, LON + 10 / kx, LAT + 10 / M_PER_DEG];
    const ring: Position[] = [[w, s], [e, s], [e, n], [w, n], [w, s]];
    // 20 m de altura, sol a leste a 45°: 20 m de sombra para oeste
    const shadow = shadowRing(ring, 20, shadowOffset({ azimuth: 90, altitude: 45 }, LAT)!)!;
    expect(shadow).toHaveLength(5); // retângulo de 30 m × 10 m, fechado
    expect(shadow[0]).toEqual(shadow[4]);
    const xs = shadow.map((p) => (p[0] - w) * kx);
    expect(Math.min(...xs)).toBeCloseTo(-20, 5);
    expect(Math.max(...xs)).toBeCloseTo(10, 5);
  });
  it('casco convexo ignora pontos internos e alinhados; nulo se todos estão em linha', () => {
    expect(convexHull([[0, 0], [2, 0], [1, 0], [2, 2], [0, 2], [1, 1]])).toHaveLength(5);
    expect(convexHull([[0, 0], [1, 1], [2, 2]])).toBeNull();
  });
});
