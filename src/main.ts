import 'maplibre-gl/dist/maplibre-gl.css';
import { setWorkerUrl } from 'maplibre-gl';
// MapLibre v6 loads its worker from a separate module next to the library file. After bundling,
// that file must be emitted explicitly and its URL handed to MapLibre.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import './styles.css';
import { loadData } from './data/load';
import { Scene } from './map/scene';
import { themeFor, type TimeOfDay } from './map/lighting';
import { FilterStore, filterListings, isEmptyCriteria } from './state/filters';
import { mountFilters } from './ui/filters';
import { renderResults } from './ui/results';
import { Drawer } from './ui/drawer';
import { mountTimeOfDay } from './ui/timeOfDay';
import { HoverTooltip } from './ui/tooltip';

setWorkerUrl(workerUrl);

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const status = $('#status');

async function main() {
  status.textContent = 'Carregando dados do bairro…';
  const data = await loadData();
  const [lon, lat] = data.meta.center; // from Nominatim, see scripts/fetch-osm.mjs
  const listings = data.listings.listings;

  let tod: TimeOfDay = 'morning';
  const store = new FilterStore();
  const resultsEl = $('#results');

  const tooltip = new HoverTooltip($('#hover-tooltip'), $('#map'));
  const drawer = new Drawer($('#drawer'), data.listings.agencies, () => scene.select(null));
  const scene = new Scene($('#map'), data, themeFor(tod, lat, lon).theme, {
    onListingClick: (id) => openListing(id, false),
    onEmptyClick: () => drawer.close(),
    onListingHover: (id, point) => {
      const l = id ? listings.find((x) => x.id === id) : undefined;
      if (l && point) tooltip.show(l, point);
      else tooltip.hide();
    },
  });

  function openListing(id: string, fly: boolean) {
    const l = listings.find((x) => x.id === id);
    if (!l) return;
    if (fly) scene.flyToListing(l);
    scene.select(id);
    drawer.open(l);
  }

  mountFilters($<HTMLFormElement>('#filters'), store, data.listings.agencies);
  store.onApply((criteria) => {
    const results = filterListings(listings, criteria);
    scene.setMatched(new Set(results.map((l) => l.id)));
    if (drawer.currentId && !results.some((l) => l.id === drawer.currentId)) drawer.close();
    if (isEmptyCriteria(criteria)) {
      resultsEl.hidden = true;
    } else {
      renderResults(resultsEl, results, listings.length, (id) => openListing(id, true), () => (resultsEl.hidden = true));
    }
    if (results.length > 0) scene.fitToListings(results);
    document.body.classList.remove('filters-open');
    $('.filters-toggle').setAttribute('aria-expanded', 'false');
  });

  mountTimeOfDay($('.time-of-day'), tod, (next) => {
    tod = next;
    scene.setTheme(themeFor(tod, lat, lon).theme);
    document.body.dataset.tod = tod;
  });
  document.body.dataset.tod = tod;

  // Mobile: collapsible filters
  const toggle = $('.filters-toggle');
  toggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('filters-open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  await scene.ready;
  status.textContent = '';
  document.body.dataset.ready = 'true';

  // Hook for automated browser checks (scripts/e2e-check.mjs). Read-only helpers.
  (window as unknown as { __demo: unknown }).__demo = {
    map: scene.map,
    listingIds: listings.map((l) => l.id),
    project: (id: string) => scene.projectListing(id),
    sun: (t: TimeOfDay) => themeFor(t, lat, lon).sun,
  };
}

main().catch((err: Error) => {
  console.error(err);
  status.textContent = `Erro ao iniciar o mapa: ${err.message}`;
  status.classList.add('error');
});
