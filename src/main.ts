import 'maplibre-gl/dist/maplibre-gl.css';
import { setWorkerUrl } from 'maplibre-gl';
// MapLibre v6 loads its worker from a separate module next to the library file. After bundling,
// that file must be emitted explicitly and its URL handed to MapLibre.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import './styles.css';
import { loadData } from './data/load';
import type { Listing } from './data/types';
import { Scene } from './map/scene';
import { themeFor, type TimeOfDay } from './map/lighting';
import { FilterStore, filterListings, isEmptyCriteria } from './state/filters';
import { sameCriteria, searchToState, stateToSearch } from './state/url';
import { DEFAULT_SORT, sortListings, type SortKey } from './state/sort';
import { mountFilters } from './ui/filters';
import { ResultsPanel } from './ui/results';
import { Drawer } from './ui/drawer';
import { mountTimeOfDay } from './ui/timeOfDay';
import { HoverTooltip } from './ui/tooltip';

setWorkerUrl(workerUrl);

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const status = $('#status');

/** history.state written by this app. `pristine`: entry pushed by opening the drawer, untouched since. */
interface HistoryState {
  drawer?: boolean;
  pristine?: boolean;
}

async function main() {
  status.textContent = 'Carregando dados do bairro…';
  const data = await loadData();
  const [lon, lat] = data.meta.center; // from Nominatim, see scripts/fetch-osm.mjs
  const listings = data.listings.listings;
  const known = {
    agencyIds: new Set(data.listings.agencies.map((a) => a.id)),
    listingIds: new Set(listings.map((l) => l.id)),
  };

  let tod: TimeOfDay = 'morning';
  const store = new FilterStore();
  let sort: SortKey = DEFAULT_SORT;
  const results = new ResultsPanel($('#results'), {
    onPick: (id) => openListing(id, true),
    onHover: (id) => scene.highlight(id),
    onSortChange: (next) => {
      sort = next;
      showResults();
      // keep previous/next in the drawer consistent with the new order
      if (drawer.currentId) openListing(drawer.currentId, false);
      else replaceUrl();
    },
  });
  // The list the drawer browses with previous/next: applied search results, in display order.
  let currentList: Listing[] = sortListings(listings, sort);
  // True while the UI is being updated from the URL (back/forward, initial load): don't write history.
  let syncingFromUrl = false;
  // True while a search closes the drawer because its listing is no longer in the results.
  let closingForSearch = false;

  // ------------------------------------------------------------ URL / history
  const urlFor = (listingId: string | null) =>
    `${location.pathname}${stateToSearch({ criteria: store.getApplied(), listingId, sort })}${location.hash}`;
  const historyState = () => (history.state ?? {}) as HistoryState;

  /** Updates the current entry (filters changed, or browsing between listings). */
  function replaceUrl(state: HistoryState = historyState()) {
    history.replaceState(state, '', urlFor(drawer.currentId));
  }

  const tooltip = new HoverTooltip($('#hover-tooltip'), $('#map'));
  const drawer = new Drawer(
    $('#drawer'),
    data.listings.agencies,
    () => {
      scene.select(null);
      if (syncingFromUrl) return;
      const st = historyState();
      // Closing from the UI right after opening: step back, so "back" and "close" stay equivalent.
      if (!closingForSearch && st.drawer && st.pristine) history.back();
      else replaceUrl({});
    },
    (id) => openListing(id, true),
  );
  const scene = new Scene($('#map'), data, themeFor(tod, lat, lon).theme, {
    onListingClick: (id) => openListing(id, false),
    onEmptyClick: () => drawer.close(),
    onListingHover: (id, point) => {
      const l = id ? listings.find((x) => x.id === id) : undefined;
      if (l && point) tooltip.show(l, point);
      else tooltip.hide();
      results.highlight(l ? l.id : null);
    },
  });

  function openListing(id: string, fly: boolean) {
    const l = listings.find((x) => x.id === id);
    if (!l) return;
    const wasOpen = drawer.currentId !== null;
    if (fly) scene.flyToListing(l);
    scene.select(id);
    const index = currentList.findIndex((x) => x.id === id);
    drawer.open(
      l,
      index < 0
        ? null
        : {
            index,
            total: currentList.length,
            prevId: currentList[index - 1]?.id ?? null,
            nextId: currentList[index + 1]?.id ?? null,
          },
    );
    if (syncingFromUrl) return;
    // A new entry when the drawer opens, so the browser's back button closes it.
    if (wasOpen) replaceUrl();
    else history.pushState({ drawer: true, pristine: true } satisfies HistoryState, '', urlFor(id));
  }

  const filtersUi = mountFilters($<HTMLFormElement>('#filters'), store, data.listings.agencies);
  /** Re-sorts the applied results and refreshes the list. */
  function showResults() {
    currentList = sortListings(filterListings(listings, store.getApplied()), sort);
    if (isEmptyCriteria(store.getApplied())) results.hide();
    else results.render({ results: currentList, total: listings.length, sort });
  }

  store.onApply(() => {
    showResults();
    const matched = currentList;
    scene.setMatched(new Set(matched.map((l) => l.id)));
    if (drawer.currentId && !matched.some((l) => l.id === drawer.currentId)) {
      closingForSearch = true;
      drawer.close();
      closingForSearch = false;
    }
    if (matched.length > 0) scene.fitToListings(matched);
    document.body.classList.remove('filters-open');
    $('.filters-toggle').setAttribute('aria-expanded', 'false');
    if (!syncingFromUrl) replaceUrl({ ...historyState(), pristine: false });
  });

  /** Brings filters and the drawer in line with the address bar. */
  function applyUrl() {
    const state = searchToState(location.search, known);
    syncingFromUrl = true;
    try {
      if (state.sort !== sort) {
        sort = state.sort;
        showResults();
      }
      if (!sameCriteria(state.criteria, store.getApplied())) {
        filtersUi.setForm(state.criteria);
        store.setPending(state.criteria);
        store.apply();
      }
      if (state.listingId) {
        if (state.listingId !== drawer.currentId) openListing(state.listingId, true);
      } else drawer.close();
    } finally {
      syncingFromUrl = false;
    }
  }
  window.addEventListener('popstate', applyUrl);

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
  // Shared link: restore filters and the open listing, then normalise the URL (drops invalid params).
  applyUrl();
  history.replaceState(historyState(), '', urlFor(drawer.currentId));
  status.textContent = '';
  document.body.dataset.ready = 'true';

  // Hook for automated browser checks (scripts/e2e-check.mjs). Read-only helpers.
  (window as unknown as { __demo: unknown }).__demo = {
    map: scene.map,
    listingIds: listings.map((l) => l.id),
    project: (id: string) => scene.projectListing(id),
    isHighlighted: (id: string) => scene.isHighlighted(id),
    sun: (t: TimeOfDay) => themeFor(t, lat, lon).sun,
  };
}

main().catch((err: Error) => {
  console.error(err);
  status.textContent = `Erro ao iniciar o mapa: ${err.message}`;
  status.classList.add('error');
});
