// Which OSM buildings may host a listing. Shared by scripts/generate-listings.mjs,
// scripts/validate-listings.mjs and the in-app "Anunciar imóvel" form.
export const RESIDENTIAL_BUILDING_VALUES = [
  'yes', 'house', 'residential', 'apartments', 'detached', 'semidetached_house', 'terrace',
];
// Named buildings are usually landmarks, so they are excluded too.
export const NON_RESIDENTIAL_TAGS = [
  'amenity', 'shop', 'office', 'healthcare', 'craft', 'tourism', 'leisure', 'religion', 'denomination', 'industrial', 'name',
];

/**
 * @param {Record<string, unknown> | undefined} props building feature properties (OSM tags)
 * @returns {boolean}
 */
export function isResidentialBuilding(props) {
  return (
    !!props &&
    RESIDENTIAL_BUILDING_VALUES.includes(String(props.building)) &&
    NON_RESIDENTIAL_TAGS.every((k) => props[k] === undefined)
  );
}
