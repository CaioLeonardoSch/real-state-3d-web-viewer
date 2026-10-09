// Floors of the buildings of one lot from the city cadastre's built area. See scripts/estimate-heights.mjs.
export const MAX_FLOORS = 32; // Joinville's tallest buildings have ~30 floors
export const MAIN_SHARE = 0.7;
export const MIN_RATIO = 0.2;
/** A tower (more than TOWER_FLOORS floors) needs a footprint of at least TOWER_MIN_AREA_M2. */
export const TOWER_FLOORS = 4;
export const TOWER_MIN_AREA_M2 = 150;

/**
 * @param {number} builtArea built area of the lot in the cadastre (m², all floors)
 * @param {number[]} footprints footprint (m²) of each OSM building whose interior point is in the lot
 * @returns {number[] | null} floors per building, or null when cadastre and OSM disagree
 */
export function floorsForLot(builtArea, footprints) {
  const F = footprints.reduce((s, a) => s + a, 0);
  if (!(builtArea > 0) || F < 15) return null;
  const ratio = builtArea / F;
  if (ratio < MIN_RATIO || ratio > MAX_FLOORS) return null;
  const clamp = (n) => Math.min(MAX_FLOORS, Math.max(1, Math.round(n)));
  const mainArea = Math.max(...footprints);
  const main = footprints.indexOf(mainArea);
  if (mainArea / F >= MAIN_SHARE) {
    // one main building; the others (garage, annex) count as one floor
    const floors = clamp((builtArea - (F - mainArea)) / mainArea);
    // a tall estimate on a small outline: the tower itself is not mapped in OSM
    if (floors > TOWER_FLOORS && mainArea < TOWER_MIN_AREA_M2) return null;
    return footprints.map((_, i) => (i === main ? floors : 1));
  }
  // several similar buildings, e.g. a condominium of houses: same floors for all
  if (ratio > TOWER_FLOORS + 0.5) return null;
  return footprints.map(() => clamp(ratio));
}
