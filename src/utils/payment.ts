import type { ListingStatus } from '../data/types';

export interface PaymentSimulation {
  downPayment: number;
  installments: number;
  installmentValue: number;
  /** Annual balloon payments (under construction only). */
  balloons: { count: number; value: number };
  total: number;
}

export const DOWN_PAYMENT_RATE = 0.2;
export const READY_INSTALLMENTS = 120;
export const CONSTRUCTION_INSTALLMENTS = 60;
export const CONSTRUCTION_BALLOONS = 4;
export const BALLOON_RATE = 0.05;

/** Rounds to cents. */
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Illustrative, interest-free payment plan:
 * - ready: 20% down + balance in 120 equal installments.
 * - under construction: 20% down + 4 annual balloons of 5% of the price + balance in 60 installments.
 */
export function simulatePayment(price: number, status: ListingStatus): PaymentSimulation {
  const downPayment = cents(price * DOWN_PAYMENT_RATE);
  if (status === 'ready') {
    const balance = price - downPayment;
    return {
      downPayment,
      installments: READY_INSTALLMENTS,
      installmentValue: cents(balance / READY_INSTALLMENTS),
      balloons: { count: 0, value: 0 },
      total: price,
    };
  }
  const balloonValue = cents(price * BALLOON_RATE);
  const balance = price - downPayment - balloonValue * CONSTRUCTION_BALLOONS;
  return {
    downPayment,
    installments: CONSTRUCTION_INSTALLMENTS,
    installmentValue: cents(balance / CONSTRUCTION_INSTALLMENTS),
    balloons: { count: CONSTRUCTION_BALLOONS, value: balloonValue },
    total: price,
  };
}
