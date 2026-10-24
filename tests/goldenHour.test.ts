import { describe, expect, it } from 'vitest';
import { GOLDEN_FULL, GOLDEN_START, goldenHour, mixHex, rulerDate, themeAt, themeFor } from '../src/map/lighting';

const LAT = -26.3;
const LON = -48.85;
/** Quanto a cor puxa para o quente: vermelho menos azul. */
const warmth = (hex: string) => parseInt(hex.slice(1, 3), 16) - parseInt(hex.slice(5, 7), 16);

describe('hora dourada', () => {
  it('mistura cores', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
  it('com o sol alto, o tema não muda', () => {
    const base = themeFor('afternoon', LAT, LON).theme;
    expect(goldenHour(base, GOLDEN_START + 5)).toBe(base);
  });
  it('quanto mais baixo o sol, mais quente a luz e o horizonte', () => {
    const base = themeFor('afternoon', LAT, LON).theme;
    const meio = goldenHour(base, (GOLDEN_START + GOLDEN_FULL) / 2);
    const cheio = goldenHour(base, GOLDEN_FULL);
    expect(warmth(meio.light.color)).toBeGreaterThan(warmth(base.light.color));
    expect(warmth(cheio.light.color)).toBeGreaterThan(warmth(meio.light.color));
    expect(warmth(cheio.sky.horizon)).toBeGreaterThan(warmth(base.sky.horizon));
    expect(cheio.light.intensity).toBeGreaterThan(base.light.intensity);
  });
  it('na régua, o fim da tarde de verão em Joinville é dourado e o meio da tarde não', () => {
    const fim = themeAt(rulerDate('summer', 18 * 60 + 30), 18 * 60 + 30, LAT, LON).theme;
    const meio = themeAt(rulerDate('summer', 15 * 60), 15 * 60, LAT, LON).theme;
    expect(warmth(fim.light.color)).toBeGreaterThan(warmth(meio.light.color) + 40);
    expect(meio.light.color).toBe(themeFor('afternoon', LAT, LON).theme.light.color);
  });
});
