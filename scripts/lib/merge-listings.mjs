// Merge step of scripts/add-listings.mjs: adds the listings of an export ("Anunciar imóvel" → "Exportar meus
// anúncios") to the content of public/data/listings.json. Kept apart from the script so it can be tested without the
// OSM data the validation needs.
import { publicAddress } from '../../src/data/listingText.ts';

/**
 * Adds `incoming.listings` (and the agencies they reference that `target` lacks) to `target`, which is changed in
 * place. Ids already in use get a numeric suffix. Throws, before changing any listing, when a listing uses a building
 * that already has one. listings.json is public: only the part of the address the advertiser chose to show is kept,
 * even when the export came from an older version that still carried the whole address.
 */
export function mergeListings(target, incoming) {
  const ids = new Set(target.listings.map((l) => l.id));
  const buildings = new Map(target.listings.filter((l) => l.buildingOsmId).map((l) => [l.buildingOsmId, l.id]));
  const added = [];
  const renamed = [];
  for (const raw of incoming.listings) {
    const l = { ...raw };
    delete l.userAdded;
    if (l.address) l.address = publicAddress(l.address, l.addressDisplay);
    if (l.buildingOsmId && buildings.has(l.buildingOsmId))
      throw new Error(`Recusado: "${l.title}" usa o prédio ${l.buildingOsmId}, que já tem o anúncio ${buildings.get(l.buildingOsmId)}.`);
    let id = l.id;
    for (let n = 2; ids.has(id); n++) id = `${l.id}-${n}`;
    if (id !== l.id) renamed.push([l.id, id]);
    l.id = id;
    ids.add(id);
    if (l.buildingOsmId) buildings.set(l.buildingOsmId, id);
    added.push(l);
  }

  // agencies referenced by the export but missing from listings.json are added
  const agencyIds = new Set(target.agencies.map((a) => a.id));
  for (const a of incoming.agencies ?? []) {
    if (!agencyIds.has(a.id) && incoming.listings.some((l) => l.agency === a.id)) {
      target.agencies.push(a);
      agencyIds.add(a.id);
    }
  }
  target.listings.push(...added);
  return { added, renamed };
}
