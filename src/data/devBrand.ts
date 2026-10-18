// Identity of a development in the sales mirror (item 46): the developer's colours, logo, font style and the
// launch's materials. Same rules as public.valid_development_brand (supabase/migrations/20261105000001_…).

export const BRAND_FONTS = {
  moderna: { label: 'Moderna (sem serifa)', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  classica: { label: 'Clássica (com serifa)', stack: 'Georgia, "Times New Roman", serif' },
  geometrica: { label: 'Geométrica', stack: '"Century Gothic", Futura, "Avenir Next", Avenir, system-ui, sans-serif' },
  elegante: { label: 'Elegante', stack: 'Didot, "Bodoni MT", "Palatino Linotype", Palatino, Georgia, serif' },
} as const;
export type BrandFont = keyof typeof BRAND_FONTS;

export interface DevelopmentBrand {
  /** Main colour (#rrggbb): the header band and the primary buttons. */
  color?: string;
  /** Second colour (#rrggbb): the line under the header. */
  accent?: string;
  /** Address of the logo image (uploaded in Minha conta; the map's CSP loads images only from Supabase and the site). */
  logo?: string;
  font?: BrandFont;
  /** Book, price table, video: up to 8 links. */
  materials?: { label: string; url: string }[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const LOGO = /^(https?:\/\/|\/[^/\s])[^\s"'<>()\\]{0,400}$/;
const MATERIAL_URL = /^https:\/\/[^\s"'<>\\]{1,400}$/;
export const MAX_MATERIALS = 8;

/** The brand as stored, with whatever is invalid dropped (null: nothing left). */
export function parseBrand(raw: unknown): DevelopmentBrand | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const b: DevelopmentBrand = {};
  if (typeof r.color === 'string' && HEX.test(r.color)) b.color = r.color.toLowerCase();
  if (typeof r.accent === 'string' && HEX.test(r.accent)) b.accent = r.accent.toLowerCase();
  if (typeof r.logo === 'string' && LOGO.test(r.logo)) b.logo = r.logo;
  if (typeof r.font === 'string' && r.font in BRAND_FONTS) b.font = r.font as BrandFont;
  if (Array.isArray(r.materials)) {
    const m = r.materials
      .filter((x): x is { label: string; url: string } =>
        !!x && typeof x.label === 'string' && x.label.trim().length > 0 && x.label.length <= 60 && typeof x.url === 'string' && MATERIAL_URL.test(x.url),
      )
      .slice(0, MAX_MATERIALS)
      .map((x) => ({ label: x.label.trim(), url: x.url }));
    if (m.length) b.materials = m;
  }
  return Object.keys(b).length ? b : null;
}

/** Whether a brand passes the database's check as it is (the editor refuses before sending). */
export const brandErrors = (b: DevelopmentBrand): string[] => {
  const e: string[] = [];
  if (b.color !== undefined && !HEX.test(b.color)) e.push('a cor principal');
  if (b.accent !== undefined && !HEX.test(b.accent)) e.push('a segunda cor');
  if (b.logo !== undefined && !LOGO.test(b.logo)) e.push('o logotipo');
  if ((b.materials?.length ?? 0) > MAX_MATERIALS) e.push(`no máximo ${MAX_MATERIALS} materiais`);
  for (const m of b.materials ?? []) if (!m.label.trim() || m.label.length > 60 || !MATERIAL_URL.test(m.url)) e.push(`o material "${m.label || m.url}" (nome e endereço https://)`);
  return e;
};

/** Relative luminance (WCAG) of #rrggbb. */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Text colour on top of `bg`: white or near black, whichever reads better. */
export const textOn = (bg: string) => (contrast(bg, '#ffffff') >= contrast(bg, '#1f2328') ? '#ffffff' : '#1f2328');

/** CSS custom properties the panel reads (styles.css, .dev-branded). */
export function brandVars(b: DevelopmentBrand): Record<string, string> {
  const v: Record<string, string> = {};
  if (b.color) {
    v['--dev-brand'] = b.color;
    v['--dev-brand-text'] = textOn(b.color);
  }
  if (b.accent) v['--dev-accent'] = b.accent;
  if (b.font) v['--dev-font'] = BRAND_FONTS[b.font].stack;
  return v;
}
