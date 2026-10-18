// Bank financing of a sale (SAC and Price), as the banks simulate it before the extra costs: the annual rate is the
// effective one (monthly = (1 + annual)^(1/12) − 1), without TR, insurance (MIP/DFI) or the monthly fee.

export type AmortizationSystem = 'sac' | 'price';

export interface FinancingInput {
  price: number;
  /** Own money, FGTS not included. */
  downPayment: number;
  /** FGTS balance used in the purchase (counts as down payment). */
  fgts: number;
  years: number;
  /** Effective annual rate, in percent (11.5 = 11,5% a.a.). */
  annualRate: number;
  system: AmortizationSystem;
}

export interface FinancingResult {
  financed: number;
  months: number;
  monthlyRate: number;
  firstInstallment: number;
  lastInstallment: number;
  totalPaid: number;
  totalInterest: number;
  /** Family income for the first installment to take 30% of it (the usual bank limit). */
  incomeNeeded: number;
  /** Share of the price financed (0–1). */
  ltv: number;
}

/** Highest term the banks offer (35 years) and the usual financed share (80% of the price). */
export const MAX_YEARS = 35;
export const USUAL_LTV = 0.8;
export const INCOME_SHARE = 0.3;

const cents = (n: number) => Math.round(n * 100) / 100;

/** null when there is nothing to finance (price missing or the down payment covers it). */
export function simulateFinancing(i: FinancingInput): FinancingResult | null {
  const financed = Math.max(0, i.price - Math.max(0, i.downPayment) - Math.max(0, i.fgts));
  const months = Math.round(Math.min(MAX_YEARS, Math.max(1, i.years)) * 12);
  if (!(i.price > 0) || financed <= 0) return null;
  const r = Math.pow(1 + Math.max(0, i.annualRate) / 100, 1 / 12) - 1;
  let first: number;
  let last: number;
  let interest: number;
  if (i.system === 'sac') {
    const amort = financed / months;
    first = amort + financed * r;
    last = amort + amort * r;
    // the balance falls by `amort` every month: interest = r·amort·(n + n−1 + … + 1)
    interest = r * amort * ((months * (months + 1)) / 2);
  } else {
    first = r === 0 ? financed / months : (financed * r) / (1 - Math.pow(1 + r, -months));
    last = first;
    interest = first * months - financed;
  }
  return {
    financed: cents(financed),
    months,
    monthlyRate: r,
    firstInstallment: cents(first),
    lastInstallment: cents(last),
    totalPaid: cents(financed + interest),
    totalInterest: cents(interest),
    incomeNeeded: cents(first / INCOME_SHARE),
    ltv: financed / i.price,
  };
}
