import { describe, expect, it } from 'vitest';
import type { Listing } from '../src/data/types';
import { withPriceChange } from '../src/state/priceChange';

const base = { id: 'a', price: 500, publishedAt: '2026-01-01' } as Listing;

describe('withPriceChange', () => {
  it('records the history and strikes the highest price since the last increase', () => {
    const a = withPriceChange(base, { ...base, price: 450 }, '2026-02-01');
    expect(a).toMatchObject({ previousPrice: 500, priceReducedAt: '2026-02-01', updatedAt: '2026-02-01' });
    const b = withPriceChange(a, { ...a, price: 400 }, '2026-03-01');
    expect(b.previousPrice).toBe(500);
    expect(b.priceHistory!.map((h) => h.price)).toEqual([500, 450, 400]);
  });
  it('raising the price clears the reduction', () => {
    const a = withPriceChange(base, { ...base, price: 450 }, '2026-02-01');
    const b = withPriceChange(a, { ...a, price: 600 }, '2026-03-01');
    expect(b.previousPrice).toBeUndefined();
    expect(b.priceReducedAt).toBeUndefined();
  });
  it('an edit without a price change keeps the reduction (and cannot forge one)', () => {
    const a = withPriceChange(base, { ...base, price: 450 }, '2026-02-01');
    const b = withPriceChange(a, { ...a, title: 'novo', previousPrice: 9999 }, '2026-03-01');
    expect(b).toMatchObject({ previousPrice: 500, title: 'novo' });
    const c = withPriceChange(base, { ...base, previousPrice: 9999 }, '2026-03-01');
    expect(c.previousPrice).toBeUndefined();
  });
});
