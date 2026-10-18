import { describe, expect, it } from 'vitest';
import turfArea from '@turf/area';
import { isSynthetic, syntheticBuilding, syntheticId } from '../src/map/syntheticBuilding';

const at: [number, number] = [-48.84612, -26.30442];

describe('prédio padrão quando o OpenStreetMap não tem o prédio', () => {
  it('casa: área do anúncio (ou a construída do cadastro), um ou dois pavimentos', () => {
    const small = syntheticBuilding(at, 'house', 90, null);
    expect(turfArea(small.geometry)).toBeCloseTo(90, -1);
    expect(small.height).toBe(4);
    const big = syntheticBuilding(at, 'house', 120, null, 260);
    expect(turfArea(big.geometry)).toBeCloseTo(130, -1);
    expect(big.height).toBe(7);
  });

  it('apartamento: andares do formulário, ou 4', () => {
    expect(syntheticBuilding(at, 'apartment', 70, null).height).toBe(12);
    expect(syntheticBuilding(at, 'apartment', 70, 10).height).toBe(30);
    // the cadastre's built area spread over the floors
    expect(turfArea(syntheticBuilding(at, 'apartment', 70, 10, 4000).geometry)).toBeCloseTo(400, -1);
  });

  it('o mesmo ponto dá o mesmo prédio (outra unidade no mesmo endereço)', () => {
    expect(syntheticBuilding(at, 'apartment', 70, null).osmId).toBe(syntheticId([-48.846121, -26.304419]));
    expect(isSynthetic(syntheticId(at))).toBe(true);
    expect(isSynthetic('way/123')).toBe(false);
  });
});
