import { describe, expect, it } from 'vitest';
import { simulatePayment } from '../src/utils/payment';

describe('simulatePayment', () => {
  it('ready: 20% down + 120 equal installments', () => {
    const s = simulatePayment(600_000, 'ready');
    expect(s.downPayment).toBe(120_000);
    expect(s.installments).toBe(120);
    expect(s.installmentValue).toBe(4_000);
    expect(s.balloons.count).toBe(0);
    expect(s.downPayment + s.installments * s.installmentValue).toBeCloseTo(600_000, 2);
  });
  it('under construction: 20% down + 4 annual 5% balloons + 60 installments', () => {
    const s = simulatePayment(1_000_000, 'under_construction');
    expect(s.downPayment).toBe(200_000);
    expect(s.balloons).toEqual({ count: 4, value: 50_000 });
    expect(s.installments).toBe(60);
    expect(s.installmentValue).toBeCloseTo(10_000, 2);
    expect(s.downPayment + s.balloons.count * s.balloons.value + s.installments * s.installmentValue).toBeCloseTo(1_000_000, 2);
  });
  it('rounds installment to cents', () => {
    const s = simulatePayment(777_777, 'ready');
    expect(Number.isInteger(Math.round(s.installmentValue * 100))).toBe(true);
    expect(Math.abs(s.downPayment + 120 * s.installmentValue - 777_777)).toBeLessThan(1);
  });
});
