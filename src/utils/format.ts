const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const brlCents = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export const formatBRL = (v: number) => brl.format(v);
export const formatBRLCents = (v: number) => brlCents.format(v);
export const formatArea = (v: number) => `${num.format(v)} m²`;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Parses a pt-BR numeric input ("1.200.000", "1200000", "") to a number or null. */
export function parseNumberInput(v: string): number | null {
  const cleaned = v.replace(/[^\d,]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
