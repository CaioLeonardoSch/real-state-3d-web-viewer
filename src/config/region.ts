// The map region (scripts/data/region.json, the same file the data pipeline reads): the city the forms start with,
// the texts of the sites and the credit of the heights. Another region: docs/nova-regiao.md.
import region from '../../scripts/data/region.json' with { type: 'json' };

export const REGION = {
  id: region.id,
  /** Name of the whole region, e.g. "Joinville e Araquari". */
  name: region.name,
  /** Main city: default in the forms and in the sites' texts. */
  city: region.city,
  uf: region.uf,
  /** Offset of the local time (no daylight saving in Brazil since 2019), e.g. "-03:00". */
  utcOffset: region.utcOffset,
  /** City cadastre the heights come from, or null (OpenStreetMap only). */
  cadastre: (region.cadastre ?? null) as { source: string; label: string; url: string } | null,
};
