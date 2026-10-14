// Numeric feature id of an OSM building ("way/123" → 246, "relation/123" → 247): roofs carry it as the vector
// tile feature id instead of the string, which would weigh on every close-up tile.
export function osmNumericId(osmId: string): number {
  const m = /^(way|relation)\/(\d+)$/.exec(osmId);
  if (!m) return -1;
  return Number(m[2]) * 2 + (m[1] === 'relation' ? 1 : 0);
}
