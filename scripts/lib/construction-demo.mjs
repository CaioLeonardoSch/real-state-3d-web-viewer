// Illustrative construction progress of the demo data (listings and developments under construction): deterministic
// per id, so the generators and the data files agree. Real progress comes from the advertiser (back end).
import { hash } from './scenery.mjs';

/** Month of the illustrative information. */
export const DEMO_PROGRESS_MONTH = '2026-09';

/**
 * Floors already built (15–90% of the total, at least one), marked as illustrative.
 * @param {string} id
 * @param {number} totalFloors
 */
export function demoProgress(id, totalFloors) {
  const share = 0.15 + ((hash(`obra:${id}`) % 1000) / 1000) * 0.75;
  return { floorsBuilt: Math.max(1, Math.min(totalFloors, Math.round(totalFloors * share))), updatedAt: DEMO_PROGRESS_MONTH, source: 'ilustrativo' };
}

/** Floors of a demo building: its fictional floors (apartments), else its height ÷ 3 m. */
export const demoFloors = (l) => l.floors ?? Math.max(1, Math.round((l.buildingHeightM ?? 6) / 3));
