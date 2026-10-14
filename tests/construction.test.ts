import { describe, expect, it } from 'vitest';
import { builtShare, formatMonth, monthsOld, parseProgress, progressLabel } from '../src/data/construction';
import { craneParts } from '../src/map/crane';

describe('obra em andamento', () => {
  const p = { floorsBuilt: 12, updatedAt: '2026-09', source: 'anunciante' as const };

  it('mês e andamento por extenso', () => {
    expect(formatMonth('2026-09')).toBe('set/2026');
    expect(formatMonth('2026-13')).toBe('2026-13');
    expect(progressLabel(p, 20)).toBe('12 de 20 andares (60%)');
    expect(progressLabel({ ...p, floorsBuilt: 0 }, 20)).toBe('fundação');
    expect(progressLabel({ ...p, floorsBuilt: 1 }, 1)).toBe('1 de 1 andar (100%)');
    // mais andares informados que o prédio tem: não passa de 100%
    expect(builtShare({ ...p, floorsBuilt: 25 }, 20)).toBe(1);
    expect(builtShare(p, 0)).toBe(0);
  });

  it('aceita só andamento válido, com origem conhecida', () => {
    expect(parseProgress(p)).toEqual(p);
    expect(parseProgress({ floorsBuilt: 3, updatedAt: '2026-10', source: 'qualquer' })?.source).toBe('anunciante');
    expect(parseProgress({ floorsBuilt: -1, updatedAt: '2026-10' })).toBeNull();
    expect(parseProgress({ floorsBuilt: 2.5, updatedAt: '2026-10' })).toBeNull();
    expect(parseProgress({ floorsBuilt: 3, updatedAt: '2026-1' })).toBeNull();
    expect(parseProgress({ floorsBuilt: 3, updatedAt: '2026-00' })).toBeNull();
    expect(parseProgress(null)).toBeNull();
  });

  it('idade da informação em meses', () => {
    expect(monthsOld(p, new Date(2026, 8, 30))).toBe(0);
    expect(monthsOld(p, new Date(2027, 0, 1))).toBe(4);
  });

  it('grua: mastro 8 m acima do prédio (ao menos 22 m), lança e contrapeso', () => {
    const parts = craneParts([-48.85, -26.3], 40, 0, { id: 'x' });
    expect(parts.map((q) => q.properties.p)).toEqual(['mast', 'jib', 'counter', 'weight', 'top']);
    expect(parts[0].properties.h).toBe(48);
    expect(parts.every((q) => q.properties.id === 'x' && q.properties.h > q.properties.b)).toBe(true);
    expect(craneParts([-48.85, -26.3], 6, 0)[0].properties.h).toBe(22);
    // a lança (30 m) aponta para o ângulo pedido: a leste com ângulo 0
    const jib = parts[1].geometry.coordinates[0].map((c) => c[0]);
    expect(Math.max(...jib)).toBeGreaterThan(-48.85 + 25 / (111320 * Math.cos((26.3 * Math.PI) / 180)));
  });
});
