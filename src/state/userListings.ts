import { validateListingsFile, type Agency, type Listing } from '../data/types';

/**
 * Listings added through "Anunciar imóvel". They live only in this browser (localStorage) until
 * exported as JSON and merged into public/data/listings.json with `npm run listings:add`.
 */
const STORAGE_KEY = 'mapa3d-america:user-listings:v1';

/** File format of the export (same shape as listings.json, so the merge script can validate it). */
export interface UserListingsExport {
  fictional: true;
  notice: string;
  agencies: Agency[];
  listings: Listing[];
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // blocked (privacy mode, iframe sandbox)
  }
}

/**
 * Reads the stored listings. Entries that no longer validate (e.g. after a data update removed their
 * building) are dropped rather than breaking the page.
 */
export function loadUserListings(agencies: Agency[], buildingIds: Set<string>, takenIds: Set<string>): Listing[] {
  let raw: unknown;
  try {
    raw = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Listing[] = [];
  for (const item of raw) {
    try {
      const [l] = validateListingsFile({ fictional: true, agencies, listings: [item] }, buildingIds).listings;
      if (takenIds.has(l.id)) continue;
      takenIds.add(l.id);
      out.push({ ...l, userAdded: true });
    } catch {
      // invalid entry: skip it
    }
  }
  return out;
}

/** Persists the listings; returns false when the browser does not allow storage. */
export function saveUserListings(listings: Listing[]): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(listings.map(stripRuntimeFields)));
    return true;
  } catch {
    return false;
  }
}

const stripRuntimeFields = ({ userAdded: _ignored, ...l }: Listing): Listing => l;

export function exportUserListings(listings: Listing[], agencies: Agency[]): UserListingsExport {
  return {
    fictional: true,
    notice: 'Imóveis cadastrados pelo formulário "Anunciar imóvel" do protótipo. Dados de demonstração.',
    agencies,
    listings: listings.map(stripRuntimeFields),
  };
}

/** Unique, readable id for a new listing: "user-casa-lx3k2a". */
export function newListingId(slug: string, taken: Set<string>): string {
  for (;;) {
    const id = `user-${slug}-${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 2).toString(36)}`;
    if (!taken.has(id)) return id;
  }
}
