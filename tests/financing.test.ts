import { describe, expect, it } from 'vitest';
import { simulateFinancing } from '../src/utils/financing';

// 1% ao mês = 12,6825% ao ano efetivo
const base = { price: 125_000, downPayment: 20_000, fgts: 5_000, years: 30, annualRate: (1.01 ** 12 - 1) * 100 };

describe('simulação de financiamento', () => {
  it('Price: parcela fixa pela fórmula da tabela Price', () => {
    const r = simulateFinancing({ ...base, system: 'price' })!;
    expect(r.financed).toBe(100_000);
    expect(r.months).toBe(360);
    expect(r.monthlyRate).toBeCloseTo(0.01, 10);
    expect(r.firstInstallment).toBeCloseTo(1028.61, 2);
    expect(r.lastInstallment).toBe(r.firstInstallment);
    expect(r.totalInterest).toBeCloseTo(1028.6126 * 360 - 100_000, 0);
    expect(r.incomeNeeded).toBeCloseTo(1028.61 / 0.3, 0);
    expect(r.ltv).toBeCloseTo(0.8);
  });

  it('SAC: amortização constante, parcelas que diminuem e juros menores que na Price', () => {
    const r = simulateFinancing({ ...base, system: 'sac' })!;
    expect(r.firstInstallment).toBeCloseTo(100_000 / 360 + 1000, 2);
    expect(r.lastInstallment).toBeCloseTo((100_000 / 360) * 1.01, 2);
    expect(r.totalInterest).toBeCloseTo(180_500, 0);
    expect(r.totalInterest).toBeLessThan(simulateFinancing({ ...base, system: 'price' })!.totalInterest);
  });

  it('sem juros, prazo acima do máximo e entrada que cobre tudo', () => {
    expect(simulateFinancing({ ...base, annualRate: 0, years: 10, system: 'price' })!.firstInstallment).toBeCloseTo(100_000 / 120, 2);
    expect(simulateFinancing({ ...base, years: 50, system: 'sac' })!.months).toBe(420);
    expect(simulateFinancing({ ...base, downPayment: 130_000, system: 'sac' })).toBeNull();
    expect(simulateFinancing({ ...base, price: 0, system: 'sac' })).toBeNull();
  });
});
