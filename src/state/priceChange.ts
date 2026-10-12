import type { Listing } from '../data/types';

/**
 * Applies the price rules to an edited listing: the history records every change, and lowering the price shows the
 * highest price since the last increase struck through (raising it clears the reduction). Without a price change
 * the previous reduction and history are kept. Same rules as the database trigger (supabase/migrations).
 */
export function withPriceChange(before: Listing, after: Listing, date: string): Listing {
  const history = before.priceHistory ?? [{ date: before.publishedAt ?? date, price: before.price }];
  const out: Listing = { ...after, updatedAt: date };
  if (after.price === before.price) {
    out.priceHistory = history;
    if (before.previousPrice) {
      out.previousPrice = before.previousPrice;
      out.priceReducedAt = before.priceReducedAt;
    } else {
      delete out.previousPrice;
      delete out.priceReducedAt;
    }
    return out;
  }
  out.priceHistory = [...history, { date, price: after.price }];
  if (after.price < before.price) {
    out.previousPrice = Math.max(before.previousPrice ?? 0, before.price);
    out.priceReducedAt = date;
  } else {
    delete out.previousPrice;
    delete out.priceReducedAt;
  }
  return out;
}
