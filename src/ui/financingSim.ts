// "Simular financiamento" on a listing for sale (map panel and client site): price, down payment, FGTS, term, rate
// and system; the result updates as the visitor types. Estimate only: the bank's offer depends on the credit analysis.
import { MAX_YEARS, USUAL_LTV, simulateFinancing, type AmortizationSystem } from '../utils/financing';
import { escapeHtml, formatBRL, formatBRLCents, parseNumberInput } from '../utils/format';

/** Reference rate offered as the default (SBPE, mid-2026); the visitor types the one the bank quoted. */
export const DEFAULT_ANNUAL_RATE = 11.5;

const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const rateText = (r: number) => r.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** `field`: the label class of the page (a-field on the map, fld on the site). */
export function financingHtml(price: number, field: string): string {
  const down = Math.round(price * (1 - USUAL_LTV));
  const input = (name: string, label: string, value: string, mode = 'numeric') =>
    `<label class="${field}"><span>${label}</span><input name="${name}" inputmode="${mode}" value="${escapeHtml(value)}" autocomplete="off"></label>`;
  return `<details class="fin-sim">
    <summary>Simular financiamento</summary>
    <form class="fin-form" novalidate>
      <div class="fin-grid">
        ${input('price', 'Valor do imóvel (R$)', num.format(price))}
        ${input('down', 'Entrada (R$)', num.format(down))}
        ${input('fgts', 'FGTS (R$, opcional)', '')}
        ${input('years', `Prazo (anos, até ${MAX_YEARS})`, '30')}
        ${input('rate', 'Juros (% ao ano)', rateText(DEFAULT_ANNUAL_RATE), 'decimal')}
        <label class="${field}"><span>Sistema</span><select name="system">
          <option value="sac">SAC (parcelas que diminuem)</option>
          <option value="price">Price (parcelas iguais)</option>
        </select></label>
      </div>
    </form>
    <div class="fin-out" aria-live="polite"></div>
    <p class="fin-note">Estimativa sem TR, seguros (MIP e DFI) e taxa de administração, que aumentam a parcela. A taxa,
      o valor financiado e o prazo dependem do banco e da análise de crédito; não é proposta de financiamento.</p>
  </details>`;
}

/** Recomputes on every change. */
export function wireFinancing(root: ParentNode): void {
  const form = root.querySelector<HTMLFormElement>('.fin-form');
  const out = root.querySelector<HTMLElement>('.fin-out');
  if (!form || !out) return;
  const update = () => {
    const fd = new FormData(form);
    const money = (k: string) => parseNumberInput(String(fd.get(k) ?? '')) ?? 0;
    const rate = Number(String(fd.get('rate') ?? '').replace(/\s|%/g, '').replace(',', '.'));
    const years = Number(String(fd.get('years') ?? '').replace(',', '.'));
    const system = (fd.get('system') === 'price' ? 'price' : 'sac') as AmortizationSystem;
    const price = money('price');
    if (!(price > 0) || !(years > 0) || !Number.isFinite(rate) || rate < 0 || rate > 40) {
      out.innerHTML = '<p class="fin-warn">Confira o valor do imóvel, o prazo e os juros.</p>';
      return;
    }
    const r = simulateFinancing({ price, downPayment: money('down'), fgts: money('fgts'), years, annualRate: rate, system });
    if (!r) {
      out.innerHTML = '<p class="fin-warn">A entrada e o FGTS já cobrem o valor do imóvel.</p>';
      return;
    }
    const row = (t: string, v: string) => `<div><dt>${t}</dt><dd>${v}</dd></div>`;
    out.innerHTML = `<dl>
      ${row('Valor financiado', `${formatBRL(r.financed)} <small>(${Math.round(r.ltv * 100)}% do imóvel)</small>`)}
      ${system === 'sac' ? row('Primeira parcela', formatBRLCents(r.firstInstallment)) + row('Última parcela', formatBRLCents(r.lastInstallment)) : row('Parcela', formatBRLCents(r.firstInstallment))}
      ${row(`Total em ${r.months} meses`, formatBRL(r.totalPaid))}
      ${row('Juros no total', formatBRL(r.totalInterest))}
      ${row('Renda familiar sugerida', `${formatBRL(r.incomeNeeded)} <small>(parcela até 30% da renda)</small>`)}
    </dl>${
      r.ltv > USUAL_LTV + 1e-9
        ? `<p class="fin-warn">A maioria dos bancos financia até ${Math.round(USUAL_LTV * 100)}% do valor: a entrada (com o FGTS) costuma ser de ao menos ${formatBRL(price * (1 - USUAL_LTV))}.</p>`
        : ''
    }${years > MAX_YEARS ? `<p class="fin-warn">O prazo máximo é de ${MAX_YEARS} anos; a conta usa ${MAX_YEARS}.</p>` : ''}`;
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', (e) => e.preventDefault());
  update();
}
