// Cost of the base map's filter that hides the listed buildings (src/map/scene.ts, hideFilter), with many listings.
// MapLibre runs a layer's filter on every feature of every tile it loads, so this is paid while the map moves.
// Compares the old `in` over a literal list with the `match` table now used.  Run: node scripts/bench-context-filter.mjs
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';

const FEATURES = 20000; // buildings in the tiles of a city-centre view, roughly
const feats = Array.from({ length: FEATURES }, (_, i) => ({ type: 3, id: i, properties: { osmId: `way/${i * 7}` } }));
for (const listed of [100, 1000, 5000, 20000]) {
  const ids = Array.from({ length: listed }, (_, i) => `way/${i * 13}`);
  const filters = {
    in: ['!', ['in', ['get', 'osmId'], ['literal', ids]]],
    match: ['match', ['get', 'osmId'], ids, false, true],
  };
  const row = [];
  for (const [name, f] of Object.entries(filters)) {
    const ff = featureFilter(f, 'layers[0].filter');
    const t0 = performance.now();
    let kept = 0;
    for (const x of feats) if (ff.filter({ zoom: 15 }, x)) kept++;
    row.push(`${name} ${(performance.now() - t0).toFixed(1)} ms (${kept} kept)`);
  }
  console.log(`${listed} listed buildings, ${FEATURES} buildings filtered: ${row.join(', ')}`);
}
