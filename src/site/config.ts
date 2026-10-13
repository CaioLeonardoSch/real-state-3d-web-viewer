// Configuration of a client's site (white label): brand, contacts, menu, texts and layout. Stored as data
// (organizations.branding in the back end, public/data/sites.json in the demo), never as code: every value is
// checked here before use, because any admin of a client can write it.
import { SORT_KEYS, type SortKey } from '../state/sort';

export const TEMPLATES = ['leve', 'classico', 'lateral', 'escuro', 'moderno'] as const;
export type Template = (typeof TEMPLATES)[number];
export const TEMPLATE_LABELS: Record<Template, string> = {
  leve: 'Leve (cabeçalho branco, busca rápida sobre a capa)',
  classico: 'Clássico (cabeçalho escuro, filtros no topo)',
  lateral: 'Filtros na lateral',
  escuro: 'Escuro e sofisticado',
  moderno: 'Moderno (claro, cantos arredondados)',
};

/** Fonts the site may load (Google Fonts) or the system font. */
export const FONTS = {
  system: { label: 'Do sistema (mais rápida)', css: "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif", google: null },
  inter: { label: 'Inter', css: "'Inter', system-ui, sans-serif", google: 'Inter:wght@400;600;700' },
  montserrat: { label: 'Montserrat', css: "'Montserrat', system-ui, sans-serif", google: 'Montserrat:wght@400;600;700' },
  poppins: { label: 'Poppins', css: "'Poppins', system-ui, sans-serif", google: 'Poppins:wght@400;600;700' },
  lato: { label: 'Lato', css: "'Lato', system-ui, sans-serif", google: 'Lato:wght@400;700' },
  raleway: { label: 'Raleway', css: "'Raleway', system-ui, sans-serif", google: 'Raleway:wght@400;600;700' },
  playfair: { label: 'Playfair Display (títulos)', css: "'Playfair Display', Georgia, serif", google: 'Playfair+Display:wght@500;700' },
  lora: { label: 'Lora (títulos)', css: "'Lora', Georgia, serif", google: 'Lora:wght@500;700' },
} as const;
export type FontKey = keyof typeof FONTS;
const FONT_KEYS = Object.keys(FONTS) as FontKey[];

export const HOME_SECTIONS = ['destaques', 'descontos', 'mapa', 'lancamentos', 'bairros', 'recentes', 'sobre', 'anunciar'] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];
export const HOME_SECTION_LABELS: Record<HomeSection, string> = {
  destaques: 'Imóveis em destaque',
  descontos: 'Baixaram o preço',
  mapa: 'Chamada para o mapa 3D',
  lancamentos: 'Lançamentos (em construção)',
  bairros: 'Bairros com mais imóveis',
  recentes: 'Anunciados recentemente',
  sobre: 'Resumo da imobiliária',
  anunciar: 'Chamada "Anuncie seu imóvel"',
};

export const MENU_ITEMS = ['venda', 'locacao', 'lancamentos', 'descontos', 'mapa', 'sobre', 'anunciar', 'contato', 'favoritos'] as const;
export type MenuItem = (typeof MENU_ITEMS)[number];
export const MENU_LABELS: Record<MenuItem, string> = {
  venda: 'Comprar',
  locacao: 'Alugar',
  lancamentos: 'Lançamentos',
  descontos: 'Baixaram o preço',
  mapa: 'Mapa 3D',
  sobre: 'Sobre nós',
  anunciar: 'Anunciar imóvel',
  contato: 'Contato',
  favoritos: 'Favoritos',
};

export const SOCIALS = ['instagram', 'facebook', 'youtube', 'linkedin', 'tiktok'] as const;
export type Social = (typeof SOCIALS)[number];
export const SOCIAL_LABELS: Record<Social, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
};

export type SearchView = 'grade' | 'lista' | 'mapa';

export interface SiteConfig {
  version: 1;
  template: Template;
  /** Trade name shown in the header (defaults to the client's name). */
  name: string;
  creci: string;
  /** Logo image (https URL, or a data: image saved by the editor in the demo). Without it, the name is shown. */
  logo: string;
  /** Logo height in the header, px. */
  logoHeight: number;
  colors: {
    /** Buttons, links, prices. */
    primary: string;
    /** Badges and details ("Destaque", favourite). */
    accent: string;
    header: string;
  };
  theme: 'light' | 'dark';
  font: FontKey;
  headingFont: FontKey;
  corners: 'retos' | 'suaves' | 'redondos';
  contacts: { whatsapp: string; phone: string; email: string; address: string; hours: string };
  social: Record<Social, string>;
  /** Menu items in display order (absent = hidden). */
  menu: MenuItem[];
  home: { title: string; subtitle: string; heroImage: string; sections: HomeSection[] };
  about: { title: string; text: string; image: string };
  search: {
    filters: 'lateral' | 'topo';
    view: SearchView;
    perPage: number;
    sort: SortKey;
    /** Price over the photo (wPrime style) or below it. */
    cardPrice: 'foto' | 'abaixo';
    showCode: boolean;
  };
  whatsappButton: { enabled: boolean; message: string };
  seo: { description: string };
}

const TEMPLATE_DEFAULTS: Record<Template, Pick<SiteConfig, 'colors' | 'theme' | 'font' | 'headingFont' | 'corners' | 'search'>> = {
  leve: {
    colors: { primary: '#1f4fd1', accent: '#e8892b', header: '#ffffff' },
    theme: 'light',
    font: 'inter',
    headingFont: 'inter',
    corners: 'suaves',
    search: { filters: 'topo', view: 'grade', perPage: 12, sort: 'relevance', cardPrice: 'abaixo', showCode: true },
  },
  classico: {
    colors: { primary: '#1d4f91', accent: '#f2a900', header: '#0f2747' },
    theme: 'light',
    font: 'system',
    headingFont: 'montserrat',
    corners: 'suaves',
    search: { filters: 'topo', view: 'grade', perPage: 12, sort: 'relevance', cardPrice: 'abaixo', showCode: true },
  },
  lateral: {
    colors: { primary: '#17694f', accent: '#c9a227', header: '#0f3d2e' },
    theme: 'light',
    font: 'lato',
    headingFont: 'lato',
    corners: 'retos',
    search: { filters: 'lateral', view: 'grade', perPage: 12, sort: 'recent', cardPrice: 'foto', showCode: true },
  },
  escuro: {
    colors: { primary: '#c8a165', accent: '#c8a165', header: '#0d0d0d' },
    theme: 'dark',
    font: 'raleway',
    headingFont: 'playfair',
    corners: 'retos',
    search: { filters: 'topo', view: 'grade', perPage: 12, sort: 'price-desc', cardPrice: 'abaixo', showCode: true },
  },
  moderno: {
    colors: { primary: '#e4572e', accent: '#2a9d8f', header: '#ffffff' },
    theme: 'light',
    font: 'poppins',
    headingFont: 'poppins',
    corners: 'redondos',
    search: { filters: 'lateral', view: 'grade', perPage: 12, sort: 'relevance', cardPrice: 'foto', showCode: false },
  },
};

export function defaultSiteConfig(name = 'Sua imobiliária', template: Template = 'leve'): SiteConfig {
  return {
    version: 1,
    template,
    name,
    creci: '',
    logo: '',
    logoHeight: 44,
    ...structuredClone(TEMPLATE_DEFAULTS[template]),
    contacts: { whatsapp: '', phone: '', email: '', address: '', hours: '' },
    social: { instagram: '', facebook: '', youtube: '', linkedin: '', tiktok: '' },
    menu: ['venda', 'locacao', 'lancamentos', 'mapa', 'sobre', 'anunciar', 'contato'],
    home: {
      title: 'Encontre o imóvel certo em Joinville',
      subtitle: 'Veja cada imóvel no mapa 3D da cidade: o prédio, a rua e o que tem por perto.',
      heroImage: '',
      sections: ['destaques', 'descontos', 'mapa', 'lancamentos', 'bairros', 'sobre', 'anunciar'],
    },
    about: { title: 'Sobre nós', text: '', image: '' },
    whatsappButton: { enabled: true, message: 'Olá! Vim pelo site e gostaria de mais informações.' },
    seo: { description: '' },
  };
}

/** Keeps the client's data and texts, and takes colours, fonts and layout from another template. */
export function applyTemplate(c: SiteConfig, template: Template): SiteConfig {
  return { ...c, template, ...structuredClone(TEMPLATE_DEFAULTS[template]) };
}

// ------------------------------------------------------------------ validation

const HEX = /^#[0-9a-f]{6}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);
const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const list = <T extends string>(v: unknown, options: readonly T[], fallback: T[]): T[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is T => options.includes(x as T)))] : fallback;

/** Images: https (or http on localhost, for tests) or a data: image; anything else is dropped. */
export function safeImage(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i.test(s) && s.length <= 1_500_000) return s;
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) return u.href;
  } catch {
    /* not a URL */
  }
  return '';
}

/** Social profile: full https URL on the network's own domain, or "@usuario" (turned into the profile URL). */
export function socialUrl(network: Social, v: unknown): string {
  const s = str(v, 200);
  if (!s) return '';
  const hosts: Record<Social, string> = {
    instagram: 'instagram.com',
    facebook: 'facebook.com',
    youtube: 'youtube.com',
    linkedin: 'linkedin.com',
    tiktok: 'tiktok.com',
  };
  const handle = /^@?([a-z0-9._-]{2,60})$/i.exec(s);
  if (handle) return network === 'tiktok' || network === 'youtube' ? `https://www.${hosts[network]}/@${handle[1]}` : `https://www.${hosts[network]}/${handle[1]}`;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (u.protocol === 'https:' && (host === hosts[network] || host.endsWith(`.${hosts[network]}`) || (network === 'youtube' && host === 'youtu.be')))
      return u.href;
  } catch {
    /* not a URL */
  }
  return '';
}

const digits = (v: unknown, max = 15) => str(v, 40).replace(/\D/g, '').slice(0, max);
const email = (v: unknown) => {
  const s = str(v, 120).toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : '';
};

/** Any stored value → a complete, safe configuration (unknown keys dropped, bad values replaced by defaults). */
export function normalizeSiteConfig(raw: unknown, orgName = 'Sua imobiliária'): SiteConfig {
  const r = isObj(raw) ? raw : {};
  const template = oneOf(r.template, TEMPLATES, 'leve');
  const d = defaultSiteConfig(str(r.name, 80) || orgName, template);
  const colors = isObj(r.colors) ? r.colors : {};
  const contacts = isObj(r.contacts) ? r.contacts : {};
  const social = isObj(r.social) ? r.social : {};
  const home = isObj(r.home) ? r.home : {};
  const about = isObj(r.about) ? r.about : {};
  const search = isObj(r.search) ? r.search : {};
  const wa = isObj(r.whatsappButton) ? r.whatsappButton : {};
  const seo = isObj(r.seo) ? r.seo : {};
  const perPage = Number(search.perPage);
  const logoHeight = Number(r.logoHeight);
  return {
    version: 1,
    template,
    name: d.name,
    creci: str(r.creci, 30),
    logo: safeImage(r.logo),
    logoHeight: Number.isFinite(logoHeight) ? Math.min(80, Math.max(24, Math.round(logoHeight))) : d.logoHeight,
    colors: {
      primary: color(colors.primary, d.colors.primary),
      accent: color(colors.accent, d.colors.accent),
      header: color(colors.header, d.colors.header),
    },
    theme: oneOf(r.theme, ['light', 'dark'] as const, d.theme),
    font: oneOf(r.font, FONT_KEYS, d.font),
    headingFont: oneOf(r.headingFont, FONT_KEYS, d.headingFont),
    corners: oneOf(r.corners, ['retos', 'suaves', 'redondos'] as const, d.corners),
    contacts: {
      whatsapp: digits(contacts.whatsapp),
      phone: digits(contacts.phone),
      email: email(contacts.email),
      address: str(contacts.address, 200),
      hours: str(contacts.hours, 120),
    },
    social: Object.fromEntries((Object.keys(d.social) as Social[]).map((k) => [k, socialUrl(k, social[k])])) as Record<Social, string>,
    menu: list(r.menu, MENU_ITEMS, d.menu),
    home: {
      title: str(home.title, 120) || d.home.title,
      subtitle: str(home.subtitle, 240, d.home.subtitle),
      heroImage: safeImage(home.heroImage),
      sections: list(home.sections, HOME_SECTIONS, d.home.sections),
    },
    about: { title: str(about.title, 80) || d.about.title, text: str(about.text, 4000), image: safeImage(about.image) },
    search: {
      filters: oneOf(search.filters, ['lateral', 'topo'] as const, d.search.filters),
      view: oneOf(search.view, ['grade', 'lista', 'mapa'] as const, d.search.view),
      perPage: [12, 24, 36].includes(perPage) ? perPage : d.search.perPage,
      sort: oneOf(search.sort, SORT_KEYS, d.search.sort),
      cardPrice: oneOf(search.cardPrice, ['foto', 'abaixo'] as const, d.search.cardPrice),
      showCode: bool(search.showCode, d.search.showCode),
    },
    whatsappButton: { enabled: bool(wa.enabled, d.whatsappButton.enabled), message: str(wa.message, 300) || d.whatsappButton.message },
    seo: { description: str(seo.description, 300) },
  };
}

// ------------------------------------------------------------------ colours

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: [number, number, number]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text colour for a background: white or near-black, whichever reads better. */
export const inkOn = (bg: string) => (contrast(bg, '#ffffff') >= contrast(bg, '#16181d') ? '#ffffff' : '#16181d');

/** Mixes two colours (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as [number, number, number]);
}

/** The colour, darkened or lightened just enough to reach `ratio` against `bg` (links and prices stay readable). */
export function readableOn(color: string, bg: string, ratio = 4.5): string {
  if (contrast(color, bg) >= ratio) return color;
  const toward = luminance(bg) > 0.4 ? '#000000' : '#ffffff';
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(color, toward, t);
    if (contrast(c, bg) >= ratio) return c;
  }
  return toward;
}

export interface ColorWarning {
  field: 'primary' | 'accent' | 'header';
  message: string;
}

/** What the editor warns about (the site still corrects text colours on its own). */
export function colorWarnings(c: SiteConfig): ColorWarning[] {
  const out: ColorWarning[] = [];
  const bg = c.theme === 'dark' ? '#121417' : '#ffffff';
  if (contrast(c.colors.primary, bg) < 3)
    out.push({ field: 'primary', message: 'A cor principal tem pouco contraste com o fundo; nos textos ela será escurecida (ou clareada) para continuar legível.' });
  if (contrast(c.colors.primary, inkOn(c.colors.primary)) < 4.5)
    out.push({ field: 'primary', message: 'O texto dos botões fica difícil de ler nessa cor.' });
  if (c.theme === 'dark' && contrast(c.colors.header, bg) < 1.15)
    out.push({ field: 'header', message: 'O cabeçalho se confunde com o fundo escuro.' });
  return out;
}

/** CSS custom properties of the theme (applied on <html>). */
export function themeVars(c: SiteConfig): Record<string, string> {
  const dark = c.theme === 'dark';
  const bg = dark ? '#121417' : '#ffffff';
  const surface = dark ? '#1b1e23' : '#f5f6f8';
  const text = dark ? '#eceef1' : '#1d2127';
  const radius = { retos: '2px', suaves: '8px', redondos: '16px' }[c.corners];
  return {
    '--s-bg': bg,
    '--s-surface': surface,
    '--s-card': dark ? '#1f2329' : '#ffffff',
    '--s-text': text,
    '--s-muted': dark ? '#a4abb6' : '#5d6570',
    '--s-line': dark ? '#30353d' : '#e2e5ea',
    '--s-primary': c.colors.primary,
    '--s-primary-ink': inkOn(c.colors.primary),
    '--s-primary-text': readableOn(c.colors.primary, bg),
    '--s-primary-soft': mix(c.colors.primary, bg, 0.88),
    '--s-accent': c.colors.accent,
    '--s-accent-ink': inkOn(c.colors.accent),
    '--s-header': c.colors.header,
    '--s-header-ink': inkOn(c.colors.header),
    '--s-header-muted': mix(inkOn(c.colors.header), c.colors.header, 0.3),
    '--s-radius': radius,
    '--s-radius-lg': { retos: '4px', suaves: '14px', redondos: '24px' }[c.corners],
    '--s-font': FONTS[c.font].css,
    '--s-heading-font': FONTS[c.headingFont].css,
  };
}

/** Google Fonts stylesheet for the chosen fonts (null when only system fonts are used). */
export function fontsHref(c: SiteConfig): string | null {
  const families = [...new Set([FONTS[c.font].google, FONTS[c.headingFont].google].filter(Boolean))];
  return families.length ? `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join('&')}&display=swap` : null;
}

/** "(47) 99999-1234" from digits. */
export function formatPhone(d: string): string {
  const n = d.replace(/^55(?=\d{10,11}$)/, '');
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return d;
}

/** wa.me link (Brazilian numbers get the country code). */
export function whatsappHref(d: string, text = ''): string {
  const n = d.length <= 11 ? `55${d}` : d;
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
