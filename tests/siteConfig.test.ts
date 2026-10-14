import { describe, expect, it } from 'vitest';
import {
  applyTemplate,
  colorWarnings,
  contrast,
  defaultSiteConfig,
  fontsHref,
  formatPhone,
  inkOn,
  normalizeSiteConfig,
  readableOn,
  safeImage,
  socialUrl,
  themeVars,
  whatsappHref,
} from '../src/site/config';

describe('configuração do site do cliente', () => {
  it('qualquer valor vira uma configuração completa e segura', () => {
    const c = normalizeSiteConfig(
      {
        template: 'escuro',
        name: '  Imobiliária X  ',
        colors: { primary: 'red', accent: '#ABCDEF', header: '#000000; background:url(x)' },
        logo: 'javascript:alert(1)',
        contacts: { whatsapp: '(47) 99999-1234', email: 'não é e-mail', phone: '47 3333-4444' },
        menu: ['venda', 'inexistente', 'venda', 'contato'],
        search: { perPage: 1000, sort: 'aleatorio', filters: 'lateral' },
        home: { sections: ['mapa', '<script>'] },
        extra: { qualquer: 'coisa' },
      },
      'Org',
    );
    expect(c.name).toBe('Imobiliária X');
    expect(c.template).toBe('escuro');
    expect(c.colors.primary).toBe('#c8a165'); // inválida → a do modelo
    expect(c.colors.accent).toBe('#abcdef');
    expect(c.colors.header).toBe('#0d0d0d');
    expect(c.logo).toBe('');
    expect(c.contacts).toMatchObject({ whatsapp: '47999991234', email: '', phone: '4733334444' });
    expect(c.menu).toEqual(['venda', 'contato']);
    expect(c.search).toMatchObject({ perPage: 12, sort: 'price-desc', filters: 'lateral' });
    expect(c.home.sections).toEqual(['mapa']);
    expect('extra' in c).toBe(false);
    expect(normalizeSiteConfig(null, 'Org').name).toBe('Org');
    expect(normalizeSiteConfig('lixo', 'Org').template).toBe('leve');
  });

  it('imagens: só https (ou localhost) e data: de imagem', () => {
    expect(safeImage('https://cdn.x.com/logo.png')).toBe('https://cdn.x.com/logo.png');
    expect(safeImage('http://exemplo.com/logo.png')).toBe('');
    expect(safeImage('http://127.0.0.1:54321/storage/v1/logo.png')).toBe('http://127.0.0.1:54321/storage/v1/logo.png');
    expect(safeImage('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(safeImage('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
    // SVG can carry scripts
    expect(safeImage('data:image/svg+xml;base64,PHN2Zz4=')).toBe('');
    expect(safeImage('javascript:alert(1)')).toBe('');
  });

  it('redes sociais: @perfil vira link; link de outro site é descartado', () => {
    expect(socialUrl('instagram', '@imob.x')).toBe('https://www.instagram.com/imob.x');
    expect(socialUrl('youtube', 'canalx')).toBe('https://www.youtube.com/@canalx');
    expect(socialUrl('facebook', 'https://www.facebook.com/imobx')).toBe('https://www.facebook.com/imobx');
    expect(socialUrl('facebook', 'https://golpe.com/facebook.com')).toBe('');
    expect(socialUrl('instagram', 'javascript:alert(1)')).toBe('');
  });

  it('trocar o modelo mantém dados e textos', () => {
    const c = { ...defaultSiteConfig('A'), contacts: { ...defaultSiteConfig().contacts, phone: '4733334444' } };
    const d = applyTemplate(c, 'lateral');
    expect(d.template).toBe('lateral');
    expect(d.search.filters).toBe('lateral');
    expect(d.contacts.phone).toBe('4733334444');
    expect(d.name).toBe('A');
  });

  it('contraste: texto dos botões e cor de links legíveis', () => {
    expect(inkOn('#ffffff')).toBe('#16181d');
    expect(inkOn('#0f2747')).toBe('#ffffff');
    // amarelo-claro em fundo branco é escurecido até 4,5:1
    const fixed = readableOn('#f2d600', '#ffffff');
    expect(contrast(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(readableOn('#1d4f91', '#ffffff')).toBe('#1d4f91');
    const c = normalizeSiteConfig({ colors: { primary: '#f7f3a0' } });
    expect(colorWarnings(c).length).toBeGreaterThan(0);
    expect(colorWarnings(defaultSiteConfig())).toEqual([]);
    // destaque amarelo-claro: avisa, e o preço reduzido usa a cor escurecida
    const y = normalizeSiteConfig({ colors: { accent: '#ffee00' } });
    expect(colorWarnings(y).map((w) => w.field)).toContain('accent');
    expect(contrast(themeVars(y)['--s-accent-text'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
    const v = themeVars(c);
    expect(contrast(v['--s-primary-text'], v['--s-bg'])).toBeGreaterThanOrEqual(4.5);
  });

  it('fontes, telefone e WhatsApp', () => {
    expect(fontsHref(normalizeSiteConfig({ font: 'system', headingFont: 'system' }))).toBeNull();
    expect(fontsHref(normalizeSiteConfig({ font: 'inter', headingFont: 'playfair' }))).toBe(
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@500;700&display=swap',
    );
    expect(formatPhone('47999991234')).toBe('(47) 99999-1234');
    expect(formatPhone('4733334444')).toBe('(47) 3333-4444');
    expect(whatsappHref('47999991234', 'Olá!')).toBe('https://wa.me/5547999991234?text=Ol%C3%A1!');
  });
});
