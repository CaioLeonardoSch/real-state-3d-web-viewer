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
import {
  EMPTY_CRITERIA,
  FilterStore,
  filterListings,
  isEmptyCriteria,
  suggestRelaxations,
  withoutCriterion,
} from './state/filters';
import { sameCriteria, searchToState, stateToSearch } from './state/url';
import { DEFAULT_SORT, sortListings, type SortKey } from './state/sort';
import { mountFilters } from './ui/filters';
import { ResultsPanel, resultsHeading } from './ui/results';
import { Drawer } from './ui/drawer';
import { mountTimeOfDay } from './ui/timeOfDay';
import { HoverTooltip } from './ui/tooltip';
import { AddListingPanel } from './ui/addListing';
import { exportUserListings, loadUserListings, newListingId, saveUserListings } from './state/userListings';
import { PlacementChecker } from './utils/placement';

setWorkerUrl(workerUrl);

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const status = $('#status');
const isMobile = () => window.matchMedia('(max-width: 720px)').matches;

/** Screen-reader announcement (visually hidden live region). */
function announce(text: string) {
  const el = $('#announcer');
  el.textContent = '';
  // a tick later, so repeated identical messages are announced again
  setTimeout(() => (el.textContent = text), 50);
}

/** history.state written by this app. `pristine`: entry pushed by opening the drawer, untouched since. */
interface HistoryState {
  drawer?: boolean;
  pristine?: boolean;
}

async function main() {
  status.textContent = 'Carregando dados do bairro…';
  const data = await loadData();
  const [lon, lat] = data.meta.center; // from Nominatim, see scripts/fetch-osm.mjs
  const agencies = data.listings.agencies;
  const baseListings = data.listings.listings;
  const buildingIds = new Set(data.buildings.features.map((f) => f.properties.osmId));
  // listings added through "Anunciar imóvel", kept in this browser
  let userListings = loadUserListings(agencies, buildingIds, new Set(baseListings.map((l) => l.id)));
  let listings = [...baseListings, ...userListings];
  const known = {
    agencyIds: new Set(agencies.map((a) => a.id)),
    listingIds: new Set(listings.map((l) => l.id)),
  };

  let tod: TimeOfDay = 'morning';
  const store = new FilterStore();
  let sort: SortKey = DEFAULT_SORT;
  const results = new ResultsPanel($('#results'), {
    onPick: (id) => {
      openListing(id, true);
      openedFromRow = id;
      // on small screens the list would cover the map and the sheet
      if (isMobile()) results.setCollapsed(true);
    },
    onHover: (id) => scene.highlight(id),
    onSortChange: (next) => {
      sort = next;
      showResults();
      // keep previous/next in the drawer consistent with the new order
      if (drawer.currentId) openListing(drawer.currentId, false);
      else replaceUrl();
    },
    // These are explicit clicks, like "Buscar": they change the form and search again.
    onRelax: (field) => {
      const next = withoutCriterion(store.getApplied(), field);
      filtersUi.setForm(next);
      store.setPending(next);
      store.apply();
    },
    onClearAll: () => {
      filtersUi.setForm(EMPTY_CRITERIA);
      store.clear();
    },
  }, isMobile());
  // Row that opened the drawer, to give focus back to it when the drawer closes.
  let openedFromRow: string | null = null;
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
    agencies,
    () => {
      scene.select(null);
      if (openedFromRow && !isMobile()) results.focusRow(openedFromRow);
      openedFromRow = null;
      if (syncingFromUrl) return;
      const st = historyState();
      // Closing from the UI right after opening: step back, so "back" and "close" stay equivalent.
      if (!closingForSearch && st.drawer && st.pristine) history.back();
      else replaceUrl({});
    },
    (id) => openListing(id, true),
    (id) => deleteUserListing(id),
  );
  const scene = new Scene($('#map'), data, themeFor(tod, lat, lon).theme, {
    // while the "Anunciar imóvel" form is open, the map is used to choose its place
    onListingClick: (id) => !addPanel.opened && openListing(id, false),
    onEmptyClick: () => drawer.close(),
    onListingHover: (id, point) => {
      const l = id ? listings.find((x) => x.id === id) : undefined;
      if (l && point) tooltip.show(l, point);
      else tooltip.hide();
      results.highlight(l ? l.id : null);
    },
  }, listings);

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

  const filtersUi = mountFilters($<HTMLFormElement>('#filters'), store, agencies);
  /** Re-sorts the applied results and refreshes the list. */
  function showResults() {
    currentList = sortListings(filterListings(listings, store.getApplied()), sort);
    const filtered = !isEmptyCriteria(store.getApplied());
    results.render({
      results: currentList,
      total: listings.length,
      sort,
      filtered,
      suggestions: currentList.length === 0 ? suggestRelaxations(listings, store.getApplied()) : [],
    });
  }

  store.onApply((criteria) => {
    showResults();
    // desktop: show the results; mobile: the collapsed pill already shows the count and the map is fitted
    if (!isMobile()) results.setCollapsed(false);
    announce(resultsHeading(currentList.length, !isEmptyCriteria(criteria)));
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

  // ------------------------------------------------------------ listings added in this browser
  /** Refreshes map, list and known ids after a listing is added or removed. */
  function listingsChanged() {
    listings = [...baseListings, ...userListings];
    known.listingIds = new Set(listings.map((l) => l.id));
    scene.setListings(listings);
    showResults();
    scene.setMatched(new Set(filterListings(listings, store.getApplied()).map((l) => l.id)));
  }

  function deleteUserListing(id: string) {
    const next = userListings.filter((l) => l.id !== id);
    if (!saveUserListings(next)) return void window.alert('O navegador não permitiu salvar a alteração.');
    userListings = next;
    drawer.close();
    listingsChanged();
    announce('Anúncio excluído.');
  }

  function downloadUserListings() {
    const json = JSON.stringify(exportUserListings(userListings, agencies), null, 2) + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'meus-anuncios.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const addToggle = $<HTMLButtonElement>('.add-toggle');
  const addPanel = new AddListingPanel($('#add-panel'), {
    agencies,
    scene,
    checker: new PlacementChecker(data),
    listingOnBuilding: (osmId) => listings.find((l) => l.buildingOsmId === osmId),
    otherLots: () => listings.flatMap((l) => (l.lotPolygon ? [l.lotPolygon] : [])),
    newId: (slug) => newListingId(slug, known.listingIds),
    onSave: (l) => {
      const next = [...userListings, l];
      if (!saveUserListings(next))
        return 'O navegador não permitiu salvar (modo privado ou armazenamento bloqueado). O anúncio não foi criado.';
      userListings = next;
      listingsChanged();
      announce(`Anúncio "${l.title}" salvo.`);
      // shown right away, even if the applied filters would hide it
      setTimeout(() => openListing(l.id, true), 0);
      return null;
    },
    onExport: downloadUserListings,
    userCount: () => userListings.length,
    onClose: () => {
      addToggle.setAttribute('aria-expanded', 'false');
      addToggle.focus();
    },
  });
  addToggle.addEventListener('click', () => {
    if (addPanel.opened) return addPanel.close();
    drawer.close();
    addPanel.open();
    addToggle.setAttribute('aria-expanded', 'true');
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

  // Skip link: jump straight to the list of listings (keyboard / screen readers)
  $('.skip-link').addEventListener('click', (e) => {
    e.preventDefault();
    results.focusFirst();
  });

  showResults();
  await scene.ready;
  // Shared link: restore filters and the open listing, then normalise the URL (drops invalid params).
  applyUrl();
  history.replaceState(historyState(), '', urlFor(drawer.currentId));
  status.textContent = '';
  document.body.dataset.ready = 'true';

  // Hook for automated browser checks (scripts/e2e-check.mjs). Read-only helpers.
  (window as unknown as { __demo: unknown }).__demo = {
    map: scene.map,
    get listingIds() {
      return listings.map((l) => l.id);
    },
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
