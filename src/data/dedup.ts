import { isForRent, isForSale, type Listing } from './types';

/**
 * The same property advertised by several agencies (docs/backend.md §5). Only matters in the portal, where the map
 * shows every agency's listings; a client's site only has its own. The map and the list show one listing per property
 * (the primary); its sheet lists the other agencies, each with its own price and contact.
 */
export interface DuplicateGroup {
  /** Listing shown on the map and in the list. */
  primary: string;
  /** All the group's listings, primary first. */
  members: string[];
  /** Same building and same unit (or the same house); otherwise only similar ("possivelmente o mesmo imóvel"). */
  certain: boolean;
  /** The primary has a checked exclusive authorisation: the others are hidden, not listed. */
  exclusive: boolean;
}

export interface Duplicates {
  /** Group of each listing that has duplicates. */
  groupOf: Map<string, DuplicateGroup>;
  /** Listings that are not the primary of their group. */
  hidden: Set<string>;
}

/** Tolerances of the "probable" match: area and price, relative. */
export const AREA_TOLERANCE = 0.05;
export const PRICE_TOLERANCE = 0.15;

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(a, b);
const hasUnit = (l: Listing) => l.unitFloor !== undefined && l.unitPosition !== undefined;
/** A building with one property in it: the listing is the whole building, not a unit. */
const wholeBuilding = (l: Listing) => l.type === 'house' || l.type === 'farm' || l.type === 'warehouse';
const sameDeal = (a: Listing, b: Listing) => (isForSale(a) && isForSale(b)) || (isForRent(a) && isForRent(b));
const comparablePrice = (a: Listing, b: Listing) =>
  isForSale(a) && isForSale(b) ? near(a.price, b.price, PRICE_TOLERANCE) : near(a.rentPrice ?? a.price, b.rentPrice ?? b.price, PRICE_TOLERANCE);

/** 'certain', 'probable' or null for two listings of different agencies. */
export function sameProperty(a: Listing, b: Listing): 'certain' | 'probable' | null {
  if (a.agency === b.agency || !a.buildingOsmId || a.buildingOsmId !== b.buildingOsmId || a.type !== b.type || !sameDeal(a, b)) return null;
  if (hasUnit(a) && hasUnit(b)) return a.unitFloor === b.unitFloor && a.unitPosition === b.unitPosition ? 'certain' : null;
  if (wholeBuilding(a)) return 'certain';
  // unit missing on one side: the same features and close area and price
  if (a.unitFloor !== undefined && b.unitFloor !== undefined && a.unitFloor !== b.unitFloor) return null;
  const similar =
    a.bedrooms === b.bedrooms && a.parkingSpots === b.parkingSpots && near(a.areaM2, b.areaM2, AREA_TOLERANCE) && comparablePrice(a, b);
  return similar ? 'probable' : null;
}

/** Order inside a group: exclusive, the most complete listing (photos, floor plan), then the most recent. */
function rank(l: Listing): [number, number, string] {
  const completeness = (l.photos?.length ?? 0) + (l.floorPlanImage ? 2 : 0) + (l.videoUrl || l.tourUrl ? 1 : 0);
  return [l.exclusive ? 1 : 0, completeness, l.updatedAt ?? l.publishedAt ?? ''];
}
const byRank = (a: Listing, b: Listing) => {
  const [ea, ca, da] = rank(a);
  const [eb, cb, db] = rank(b);
  return eb - ea || cb - ca || (db > da ? 1 : db < da ? -1 : a.id < b.id ? -1 : 1);
};

/** Groups the listings advertised by more than one agency. Drafts and listings under moderation are left out. */
export function findDuplicates(listings: Listing[]): Duplicates {
  const groupOf = new Map<string, DuplicateGroup>();
  const hidden = new Set<string>();
  const byBuilding = new Map<string, Listing[]>();
  for (const l of listings) {
    if (!l.buildingOsmId || l.draft || l.moderation) continue;
    const list = byBuilding.get(l.buildingOsmId);
    if (list) list.push(l);
    else byBuilding.set(l.buildingOsmId, [l]);
  }
  for (const list of byBuilding.values()) {
    if (list.length < 2 || new Set(list.map((l) => l.agency)).size < 2) continue;
    // union-find over the pairs that match, certain ones first; two different known units never end up together
    const parent = list.map((_, i) => i);
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    const unitOf = list.map((l) => (hasUnit(l) ? `${l.unitFloor}/${l.unitPosition}` : null));
    const pairs: [number, number, boolean][] = [];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const m = sameProperty(list[i], list[j]);
        if (m) pairs.push([i, j, m === 'certain']);
      }
    pairs.sort((a, b) => Number(b[2]) - Number(a[2]));
    for (const [i, j] of pairs) {
      const [ri, rj] = [root(i), root(j)];
      if (ri === rj || (unitOf[ri] && unitOf[rj] && unitOf[ri] !== unitOf[rj])) continue;
      parent[ri] = rj;
      unitOf[rj] ??= unitOf[ri];
    }
    const groups = new Map<number, Listing[]>();
    list.forEach((l, i) => {
      const r = root(i);
      groups.set(r, [...(groups.get(r) ?? []), l]);
    });
    // a group is certain when every listing in it is tied to another one by a certain match
    const certainIds = new Set(pairs.filter((p) => p[2]).flatMap(([i, j]) => [list[i].id, list[j].id]));
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      members.sort(byRank);
      const group: DuplicateGroup = {
        primary: members[0].id,
        members: members.map((l) => l.id),
        certain: members.every((l) => certainIds.has(l.id)),
        exclusive: !!members[0].exclusive,
      };
      for (const l of members) groupOf.set(l.id, group);
      for (const l of members.slice(1)) hidden.add(l.id);
    }
  }
  return { groupOf, hidden };
}

/**
 * The listings to show for a search: each matching listing is replaced by its group's primary, once. A property
 * stays in the results when any of its agencies' listings matches.
 */
export function collapse(matching: Listing[], all: Listing[], d: Duplicates): Listing[] {
  if (!d.hidden.size) return matching;
  const byId = new Map(all.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const out: Listing[] = [];
  for (const l of matching) {
    const id = d.groupOf.get(l.id)?.primary ?? l.id;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(byId.get(id) ?? l);
  }
  return out;
}
