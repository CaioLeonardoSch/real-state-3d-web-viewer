// "Simular financiamento" on a listing for sale (map panel and client site): price, down payment and term; the
// financed amount updates as the visitor types. The installments come after the visitor leaves a contact (as the big
// portals do): the agency gets the lead, the visitor the estimate. Estimate only: the bank's offer depends on the
// credit analysis.
import { MAX_YEARS, USUAL_LTV, simulateFinancing } from '../utils/financing';
import { escapeHtml, formatBRL, formatBRLCents, parseNumberInput } from '../utils/format';

/** Reference rate of the installments (SBPE, mid-2026); the bank's depends on the buyer's profile. */
export const DEFAULT_ANNUAL_RATE = 11.5;
/** Terms offered, 5 to 35 years. */
export const TERMS = [5, 10, 15, 20, 25, 30, 35] as const;
const DEFAULT_YEARS = 30;

const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const rateText = (r: number) => r.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/**
 * `field`: the label class of the page (a-field on the map, fld on the site). `gate`: what unlocks the installments
 * (the site's contact form; on the map, a button to the agency's form).
 */
export function financingHtml(price: number, field: string, gate: string): string {
  const down = Math.round(price * (1 - USUAL_LTV));
  const input = (name: string, label: string, value: string) =>
    `<label class="${field}"><span>${label}</span><input name="${name}" inputmode="numeric" value="${escapeHtml(value)}" autocomplete="off"></label>`;
  return `<details class="fin-sim">
    <summary>Simular financiamento</summary>
    <form class="fin-form" novalidate>
      <div class="fin-grid">
        ${input('price', 'Valor do imóvel (R$)', num.format(price))}
        ${input('down', 'Entrada (R$)', num.format(down))}
        <label class="${field}"><span>Prazo</span><select name="years">${TERMS.map(
          (y) => `<option value="${y}"${y === DEFAULT_YEARS ? ' selected' : ''}>${y} anos</option>`,
        ).join('')}</select></label>
      </div>
    </form>
    <div class="fin-out" aria-live="polite"></div>
    <div class="fin-lock">
      <p class="fin-lock-title"><strong>Quer ver as parcelas?</strong> Deixe seu contato: um corretor confirma a taxa para o seu perfil e você vê a simulação na hora.</p>
      ${gate}
    </div>
    <div class="fin-parcels" aria-live="polite" hidden></div>
    <p class="fin-note">Estimativa. A taxa, o valor financiado e o prazo dependem do banco e da análise de crédito; não é proposta de financiamento.</p>
  </details>`;
}

export interface FinancingSim {
  /** Shows the installments (after the visitor left a contact). */
  reveal(): void;
  /** The simulation in words, for the message the agency receives. */
  summary(): string;
}

/** Recomputes on every change. */
export function wireFinancing(root: ParentNode): FinancingSim | null {
  const form = root.querySelector<HTMLFormElement>('.fin-form');
  const out = root.querySelector<HTMLElement>('.fin-out');
  const parcels = root.querySelector<HTMLElement>('.fin-parcels');
  if (!form || !out || !parcels) return null;
  let shown = false;
  const read = () => {
    const fd = new FormData(form);
    const money = (k: string) => parseNumberInput(String(fd.get(k) ?? '')) ?? 0;
    const years = Math.min(MAX_YEARS, Number(fd.get('years')) || DEFAULT_YEARS);
    return { price: money('price'), down: money('down'), years };
  };
  const update = () => {
    const { price, down, years } = read();
    const r = price > 0 ? simulateFinancing({ price, downPayment: down, fgts: 0, years, annualRate: DEFAULT_ANNUAL_RATE, system: 'sac' }) : null;
    if (!(price > 0)) out.innerHTML = '<p class="fin-warn">Confira o valor do imóvel.</p>';
    else if (!r) out.innerHTML = '<p class="fin-warn">A entrada já cobre o valor do imóvel.</p>';
    else
      out.innerHTML = `<dl><div><dt>Valor financiado</dt><dd>${formatBRL(r.financed)} <small>(${Math.round(r.ltv * 100)}% do imóvel, em ${years} anos)</small></dd></div></dl>${
        r.ltv > USUAL_LTV + 1e-9
          ? `<p class="fin-warn">A maioria dos bancos financia até ${Math.round(USUAL_LTV * 100)}% do valor: a entrada costuma ser de ao menos ${formatBRL(price * (1 - USUAL_LTV))}.</p>`
          : ''
      }`;
    if (!shown) return;
    const row = (t: string, v: string) => `<div><dt>${t}</dt><dd>${v}</dd></div>`;
    parcels.innerHTML = r
      ? `<dl>
          ${row('Primeira parcela', formatBRLCents(r.firstInstallment))}
          ${row('Última parcela', formatBRLCents(r.lastInstallment))}
          ${row('Renda familiar sugerida', `${formatBRL(r.incomeNeeded)} <small>(parcela até 30% da renda)</small>`)}
        </dl>
        <p class="fin-note">Tabela SAC (parcelas que diminuem), juros de referência de ${rateText(DEFAULT_ANNUAL_RATE)}% ao ano, sem TR, seguros e taxa de administração.</p>`
      : '';
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', (e) => e.preventDefault());
  update();
  return {
    reveal() {
      shown = true;
      root.querySelector<HTMLElement>('.fin-lock')!.hidden = true;
      parcels.hidden = false;
      update();
    },
    summary() {
      const { price, down, years } = read();
      return `Simulação de financiamento: imóvel ${formatBRL(price)}, entrada ${formatBRL(down)}, prazo de ${years} anos.`;
    },
  };
}
