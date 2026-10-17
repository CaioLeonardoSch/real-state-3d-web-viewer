import type { Agency, Listing } from '../../src/data/types';

export interface ListingsContent {
  agencies: Agency[];
  listings: Listing[];
}
export function mergeListings(
  target: ListingsContent,
  incoming: { agencies?: Agency[]; listings: Listing[] },
): { added: Listing[]; renamed: [from: string, to: string][] };
