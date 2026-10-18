import { describe, expect, it } from 'vitest';
import { BRAND_FONTS, brandErrors, brandVars, contrast, parseBrand, textOn } from '../src/data/devBrand';

describe('identidade do empreendimento (item 46)', () => {
  it('lê a identidade guardada e descarta o que não vale', () => {
    expect(parseBrand(null)).toBeNull();
    expect(parseBrand([])).toBeNull();
    expect(parseBrand({})).toBeNull();
    expect(parseBrand({ color: 'red', font: 'comic', logo: 'javascript:alert(1)' })).toBeNull();
    expect(
      parseBrand({
        color: '#AABBCC',
        accent: '#112233',
        logo: '/logo.png',
        font: 'classica',
        materials: [
          { label: '  Book  ', url: 'https://exemplo.com/book.pdf' },
          { label: 'Inseguro', url: 'http://exemplo.com' },
          { label: '', url: 'https://exemplo.com' },
        ],
      }),
    ).toEqual({ color: '#aabbcc', accent: '#112233', logo: '/logo.png', font: 'classica', materials: [{ label: 'Book', url: 'https://exemplo.com/book.pdf' }] });
    const many = Array.from({ length: 12 }, (_, i) => ({ label: `M${i}`, url: `https://exemplo.com/${i}` }));
    expect(parseBrand({ materials: many })!.materials).toHaveLength(8);
  });

  it('aponta o que o banco recusaria antes de enviar', () => {
    expect(brandErrors({ color: '#123456', font: 'moderna', materials: [{ label: 'Tabela', url: 'https://x.com/t.pdf' }] })).toEqual([]);
    expect(brandErrors({ color: '#12345', logo: 'ftp://x', materials: [{ label: 'Vídeo', url: 'http://x.com' }] })).toEqual([
      'a cor principal',
      'o logotipo',
      'o material "Vídeo" (nome e endereço https://)',
    ]);
  });

  it('escolhe o texto que se lê sobre a cor e monta as variáveis do painel', () => {
    expect(textOn('#ffffff')).toBe('#1f2328');
    expect(textOn('#0b2545')).toBe('#ffffff');
    expect(textOn('#ffd400')).toBe('#1f2328');
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(brandVars({ color: '#0b2545', accent: '#ff8800', font: 'elegante' })).toEqual({
      '--dev-brand': '#0b2545',
      '--dev-brand-text': '#ffffff',
      '--dev-accent': '#ff8800',
      '--dev-font': BRAND_FONTS.elegante.stack,
    });
    expect(brandVars({})).toEqual({});
  });
});
