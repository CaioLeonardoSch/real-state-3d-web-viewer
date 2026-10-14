import 'maplibre-gl/dist/maplibre-gl.css';
import { addProtocol, setWorkerUrl, type AddProtocolAction } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
// MapLibre v6 loads its worker from a separate module next to the library file. After bundling,
// that file must be emitted explicitly and its URL handed to MapLibre.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import './styles.css';
import { loadBairroAreas, loadData } from './data/load';
import type { MultiPolygon, Polygon } from 'geojson';
import turfBooleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Listing } from './data/types';
import { Scene } from './map/scene';
import { themeFor, type TimeOfDay } from './map/lighting';
import {
  EMPTY_CRITERIA,
  FilterStore,
  filterListings,
  isEmptyCriteria,
  normalizeName,
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
import { DevelopmentLayer } from './map/developmentLayer';
import { DevelopmentPanel } from './ui/developmentPanel';
import { countByStatus } from './data/developments';
import { RemoteBackend, backendConfig } from './backend/remote';
import { AccountPanel } from './ui/account';
import { withPriceChange } from './state/priceChange';
import { today } from './data/listingText';

setWorkerUrl(workerUrl);
// "pmtiles://" sources: vector tiles read from one static file with HTTP range requests.
// When MapLibre cancels a tile (camera moved on), the request may fail with a generic error; report it as
// an abort, which MapLibre ignores, instead of a map error.
const pmtiles = new Protocol();
addProtocol('pmtiles', (params, abortController) =>
  (pmtiles.tile as AddProtocolAction)(params, abortController).catch((err: Error) => {
    if (abortController.signal.aborted) throw new DOMException('Tile request cancelled', 'AbortError');
    throw err;
  }),
);

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

/**
 * Map embedded in a client's site (src/site): ?embed=1&site=<agency>&cor=<hex>&pagina=<listing page with __ID__>.
 * Only that client's listings, no top bar; the site sends the ids of its search results (postMessage).
 */
const embedParams = new URLSearchParams(location.search);
const embed = embedParams.get('embed') === '1'
  ? {
      agency: embedParams.get('site'),
      focus: embedParams.get('foco'),
      // the site's listing page; only on this same origin
      page: (() => {
        try {
          const u = new URL(embedParams.get('pagina') ?? '', location.href);
          return u.origin === location.origin && u.href.includes('__ID__') ? u.href : null;
        } catch {
          return null;
        }
      })(),
    }
  : null;
if (embed) {
  document.body.classList.add('embed');
  const cor = embedParams.get('cor');
  if (cor && /^[0-9a-f]{6}$/i.test(cor)) {
    document.documentElement.style.setProperty('--accent', `#${cor}`);
    document.documentElement.style.setProperty('--accent-strong', `#${cor}`);
  }
}

async function main() {
  status.textContent = 'Carregando o mapa…';
  const data = await loadData();
  const [lon, lat] = data.meta.center; // centre of the region, see scripts/extract-region.py
  const agencies = [...data.listings.agencies];
  // demo listings (listings.json); a client's site can hide them with VITE_DEMO_LISTINGS=false
  const ofSite = (list: Listing[]) => (embed?.agency ? list.filter((l) => l.agency === embed.agency) : list);
  const baseListings = ofSite(import.meta.env.VITE_DEMO_LISTINGS === 'false' ? [] : data.listings.listings);
  // With a back end (Supabase), listings come from it; without one, "Anunciar" keeps them in this browser.
  let remote: RemoteBackend | null = null;
  let remoteListings: Listing[] = [];
  if (backendConfig) {
    try {
      remote = await RemoteBackend.connect(backendConfig.url, backendConfig.key);
      const r = await remote.loadListings();
      remoteListings = ofSite(r.listings);
      mergeAgencies(r.agencies);
    } catch (err) {
      console.error(err);
      status.textContent = 'Não foi possível carregar os anúncios do servidor; mostrando só a demonstração.';
    }
  }
  function mergeAgencies(more: typeof agencies) {
    for (const a of more) if (!agencies.some((x) => x.id === a.id)) agencies.push(a);
  }
  let userListings = remote ? [] : loadUserListings(agencies, new Set(baseListings.map((l) => l.id)));
  let listings = [...baseListings, ...remoteListings, ...userListings];
  // the sales charts are a demo of a developer: not inside an agency's site
  const developments = embed ? [] : data.developments;
  const known = {
    bairros: data.meta.bairros,
    agencyIds: new Set(agencies.map((a) => a.id)),
    listingIds: new Set(listings.map((l) => l.id)),
    developments: new Map(developments.map((d) => [d.id, new Set(d.levels.flatMap((l) => l.units.map((u) => u.id)))])),
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
    onOpenDevelopment: (id) => openDevelopment(id),
  }, isMobile());
  // Row that opened the drawer, to give focus back to it when the drawer closes.
  let openedFromRow: string | null = null;
  // The list the drawer browses with previous/next: applied search results, in display order.
  let currentList: Listing[] = sortListings(filterListings(listings, store.getApplied()), sort);
  // True while the UI is being updated from the URL (back/forward, initial load): don't write history.
  let syncingFromUrl = false;
  // True while a search closes the drawer because its listing is no longer in the results.
  let closingForSearch = false;

  // ------------------------------------------------------------ URL / history
  // embedded in a client's site, the frame's own URL keeps the embed parameters (reloading the frame stays embedded)
  const embedQuery = embed ? ['embed', 'site', 'cor', 'pagina', 'foco'].flatMap((k) => (embedParams.has(k) ? [[k, embedParams.get(k)!]] : [])) : [];
  const urlFor = (listingId: string | null) => {
    const search = stateToSearch({
      criteria: store.getApplied(),
      listingId,
      sort,
      developmentId: devPanel.currentId,
      unitId: devPanel.selectedUnitId,
    });
    if (!embedQuery.length) return `${location.pathname}${search}${location.hash}`;
    const p = new URLSearchParams(embedQuery);
    for (const [k, v] of new URLSearchParams(search)) p.append(k, v);
    return `${location.pathname}?${p}${location.hash}`;
  };
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
    (l) => updateUserListing(l),
    (l) => {
      drawer.close();
      account?.close();
      addPanel.openEdit(l);
      addToggle.setAttribute('aria-expanded', 'true');
    },
  );
  const scene = new Scene($('#map'), data, themeFor(tod, lat, lon).theme, {
    // while the "Anunciar imóvel" form is open, the map is used to choose its place
    onListingClick: (id) => !addPanel.opened && openListing(id, false),
    onEmptyClick: () => drawer.close(),
    // towers and units of developments are handled by DevelopmentLayer
    ignoreClickAt: (p) => devLayer?.isDevelopmentAt(p) ?? false,
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
    // the listing takes over the camera and the URL
    leavingDevelopment = true;
    devPanel.close();
    leavingDevelopment = false;
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
    // A new entry when the drawer opens, so the browser's back button closes it. Not inside a site: the frame's
    // history would mix with the site's.
    if (wasOpen || embed) replaceUrl();
    else history.pushState({ drawer: true, pristine: true } satisfies HistoryState, '', urlFor(id));
  }

  const filtersUi = mountFilters($<HTMLFormElement>('#filters'), store, agencies, data.meta.bairros);

  // developments on the map (created once the map has loaded, see below)
  let devLayer: DevelopmentLayer | null = null;
  let clipRequest = 0;
  /** Area the map is cut to (developments outside it are hidden too). */
  let clipArea: Polygon | MultiPolygon | null = null;
  const inClip = (d: (typeof developments)[number]) => !clipArea || turfBooleanPointInPolygon(d.center, clipArea);
  function setClipArea(area: Polygon | MultiPolygon | null, names: string[] = [], mask: Polygon | MultiPolygon | null = null) {
    clipArea = area;
    scene.setClip(area, names, mask);
    devLayer?.setHidden(new Set(developments.filter((d) => !inClip(d)).map((d) => d.id)));
    showResults();
  }
  /**
   * "Bairro" filter: the map is cut to the chosen neighbourhoods plus 100 m around them (the rest of the city
   * disappears) and the camera frames them. Returns whether the map is cut.
   */
  async function applyBairroClip(names: readonly string[], frame: boolean): Promise<boolean> {
    const request = ++clipRequest;
    if (!names.length) {
      if (clipArea) setClipArea(null);
      return false;
    }
    try {
      const areas = await loadBairroAreas();
      if (request !== clipRequest) return false;
      const chosen = areas.features.filter((f) => names.some((n) => normalizeName(n) === normalizeName(f.properties.name)));
      if (!chosen.length) {
        setClipArea(null);
        return false;
      }
      const polys = (g: Polygon | MultiPolygon) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
      const polygons = chosen.flatMap((f) => polys(f.geometry));
      const area: Polygon | MultiPolygon = polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
      // mask: everything except the neighbourhoods grown by 100 m (union, so neighbouring ones merge)
      const { default: clipping } = await import('polygon-clipping');
      const [w, s, e, n] = data.meta.boundaryBbox;
      const world: [number, number][][] = [[[w - 1, s - 1], [e + 1, s - 1], [e + 1, n + 1], [w - 1, n + 1], [w - 1, s - 1]]];
      const grown = chosen.flatMap((f) => polys(f.properties.grown ?? f.geometry)) as [number, number][][][];
      const maskCoords = clipping.difference(world, ...grown);
      const mask: MultiPolygon = { type: 'MultiPolygon', coordinates: maskCoords };
      if (request !== clipRequest) return false;
      await scene.ready;
      setClipArea(area, chosen.map((f) => f.properties.name), mask);
      if (frame) scene.fitToClip();
      return true;
    } catch (err) {
      console.warn(`Recorte do bairro indisponível: ${(err as Error).message}`);
      return false;
    }
  }
  /** Re-sorts the applied results and refreshes the list. */
  function showResults() {
    const rent = store.getApplied().transaction === 'rent';
    currentList = sortListings(filterListings(listings, store.getApplied()), sort, rent);
    const filtered = !isEmptyCriteria(store.getApplied());
    results.render({
      rent,
      results: currentList,
      total: listings.length,
      sort,
      filtered,
      suggestions: currentList.length === 0 ? suggestRelaxations(listings, store.getApplied()) : [],
      developments: developments.filter(inClip).map((d) => ({
        id: d.id,
        name: d.name,
        developer: d.developer,
        available: countByStatus(d).available,
      })),
    });
  }

  store.onApply((criteria) => {
    showResults();
    // desktop: show the results; mobile: the collapsed pill already shows the count and the map is fitted
    if (!isMobile()) results.setCollapsed(false);
    announce(resultsHeading(currentList.length, !isEmptyCriteria(criteria), criteria.transaction === 'rent'));
    const matched = currentList;
    scene.setMatched(new Set(matched.map((l) => l.id)));
    if (drawer.currentId && !matched.some((l) => l.id === drawer.currentId)) {
      closingForSearch = true;
      drawer.close();
      closingForSearch = false;
    }
    // with a neighbourhood filter the camera frames the neighbourhood (even without results); otherwise the results
    if (criteria.bairros.length) void applyBairroClip(criteria.bairros, true);
    else {
      void applyBairroClip([], false);
      if (matched.length > 0) scene.fitToListings(matched);
    }
    document.body.classList.remove('filters-open');
    $('.filters-toggle').setAttribute('aria-expanded', 'false');
    if (!syncingFromUrl) replaceUrl({ ...historyState(), pristine: false });
  });

  // ------------------------------------------------------------ listings added in this browser
  /** Refreshes map, list and known ids after a listing is added or removed. */
  function listingsChanged() {
    listings = [...baseListings, ...remoteListings, ...userListings];
    known.agencyIds = new Set(agencies.map((a) => a.id));
    known.listingIds = new Set(listings.map((l) => l.id));
    scene.setListings(listings);
    showResults();
    scene.setMatched(new Set(filterListings(listings, store.getApplied()).map((l) => l.id)));
  }

  /** Reloads the back end's listings (after login, logout or a change) and refreshes the map and list. */
  async function reloadRemote() {
    if (!remote) return;
    const r = await remote.loadListings();
    mergeAgencies(r.agencies);
    remoteListings = ofSite(r.listings);
    listingsChanged();
  }

  async function deleteUserListing(id: string): Promise<string | null> {
    const l = listings.find((x) => x.id === id);
    if (remote && l?.remote) {
      try {
        await remote.trashListing(id);
        drawer.close();
        await reloadRemote();
        account?.refreshTrash();
      } catch (err) {
        return (err as Error).message;
      }
      announce('Anúncio movido para a lixeira.');
      return null;
    } else {
      const next = userListings.filter((x) => x.id !== id);
      if (!saveUserListings(next)) return 'O navegador não permitiu salvar a alteração.';
      userListings = next;
      drawer.close();
      listingsChanged();
    }
    announce('Anúncio excluído.');
    return null;
  }

  async function updateUserListing(l: Listing): Promise<string | null> {
    const before = listings.find((x) => x.id === l.id);
    if (remote && l.remote && before) {
      try {
        await remote.updateListing(l.id, {
          ...(l.price !== before.price ? { price: l.price } : {}),
          ...(l.transaction === 'rent' && l.price !== before.price ? { rentPrice: l.price } : {}),
          ...(l.availability !== before.availability ? { availability: l.availability } : {}),
        });
        await reloadRemote();
      } catch (err) {
        return (err as Error).message;
      }
    } else {
      const next = userListings.map((x) => (x.id === l.id ? l : x));
      if (!saveUserListings(next)) return 'O navegador não permitiu salvar a alteração.';
      userListings = next;
      listingsChanged();
    }
    announce('Anúncio atualizado.');
    openListing(l.id, false);
    return null;
  }

  /** Full edit from the "Anunciar" form in edit mode (same id). */
  async function saveEditedListing(l: Listing, center: [number, number]): Promise<string | null> {
    const before = listings.find((x) => x.id === l.id);
    if (!before) return 'Este anúncio não existe mais.';
    if (remote && l.remote) {
      try {
        await remote.updateListingFull(l, center);
        await reloadRemote();
      } catch (err) {
        return (err as Error).message;
      }
    } else {
      const next = userListings.map((x) => (x.id === l.id ? withPriceChange(before, l, today()) : x));
      if (!saveUserListings(next))
        return 'O navegador não permitiu salvar: falta espaço (as fotos ocupam espaço) ou o armazenamento está bloqueado.';
      userListings = next;
      listingsChanged();
    }
    announce(`Anúncio "${l.title}" atualizado.`);
    setTimeout(() => openListing(l.id, true), 0);
    return null;
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
    checker: new PlacementChecker(data, (layer, bbox) => scene.tileFeaturesIn(layer, bbox)),
    listingOnBuilding: (osmId) => listings.find((l) => l.buildingOsmId === osmId),
    otherLots: (exceptId) => listings.flatMap((l) => (l.lotPolygon && l.id !== exceptId ? [l.lotPolygon] : [])),
    newId: (slug) => newListingId(slug, known.listingIds),
    bairroAt: (p) => scene.bairroAt(p),
    remoteOrgName: () => (remote ? (account?.currentOrg?.name ?? null) : null),
    onSave: async (l, center) => {
      if (remote) {
        const org = account?.currentOrg;
        if (!org) return 'Entre na sua conta e cadastre a imobiliária para anunciar.';
        try {
          const id = await remote.createListing(l, org.id, center);
          await reloadRemote();
          announce(`Anúncio "${l.title}" publicado.`);
          setTimeout(() => openListing(id, true), 0);
          return null;
        } catch (err) {
          return (err as Error).message;
        }
      }
      const next = [...userListings, l];
      if (!saveUserListings(next))
        return 'O navegador não permitiu salvar: falta espaço (as fotos ocupam espaço; exclua anúncios antigos) ou o armazenamento está bloqueado. O anúncio não foi criado.';
      userListings = next;
      listingsChanged();
      announce(`Anúncio "${l.title}" salvo.`);
      // shown right away, even if the applied filters would hide it
      setTimeout(() => openListing(l.id, true), 0);
      return null;
    },
    onUpdate: saveEditedListing,
    onExport: downloadUserListings,
    userCount: () => userListings.length,
    onClose: () => {
      addToggle.setAttribute('aria-expanded', 'false');
      addToggle.focus();
    },
  });
  // account (login, client) when a back end is configured
  const account = remote
    ? new AccountPanel($('#account-panel'), $<HTMLButtonElement>('.account-toggle'), remote, () => {
        void reloadRemote().catch((err) => console.error(err));
      })
    : null;
  if (remote && account) {
    const backend = remote;
    drawer.contact = {
      submit: async (l, input) => {
        try {
          await backend.submitLead(l.id, input);
          return null;
        } catch (err) {
          return (err as Error).message.replace(/^Não foi possível enviar: /, '');
        }
      },
      whatsapp: (l) => backend.whatsappClick(l.id),
    };
    account.openListing = (id) => openListing(id, true);
  }
  if (embed?.page) {
    const page = embed.page;
    drawer.pageInSite = true;
    drawer.pageFor = (id) => page.replace('__ID__', encodeURIComponent(id));
  }
  // pages built at publish time (scripts/prerender.mjs): link to share, with a preview
  if (!embed) fetch(new URL(`${import.meta.env.BASE_URL}data/pages.json`, location.href))
    .then((r) => (r.ok ? r.json() : {}))
    .then((pages: Record<string, string>) => {
      drawer.pageFor = (id) => (pages[id] ? new URL(`${import.meta.env.BASE_URL}${pages[id]}`, location.href).href : null);
    })
    .catch(() => {});
  await account?.refresh();
  // opened from an invitation link (?convite=…): show it right away
  await account?.openFromLink();
  addToggle.addEventListener('click', () => {
    if (addPanel.opened) return addPanel.close();
    // with a back end, announcing needs a logged-in user working for a client
    if (account && !account.currentOrg) {
      return account.open(
        account.loggedIn
          ? 'Para anunciar, sua conta precisa estar ligada a uma imobiliária: aceite o convite que o administrador enviou.'
          : 'Entre na sua conta para anunciar.',
      );
    }
    account?.close();
    drawer.close();
    addPanel.open();
    addToggle.setAttribute('aria-expanded', 'true');
  });

  // ------------------------------------------------------------ developments ("espelho de vendas 3D")
  // True while another view (a listing) closes the development panel.
  let leavingDevelopment = false;
  const devPanel = new DevelopmentPanel($('#dev-panel'), {
    onClose: () => {
      devLayer?.close();
      if (syncingFromUrl || leavingDevelopment) return;
      // "Voltar ao bairro"
      scene.showOverview(true);
      replaceUrl();
    },
    onSelectUnit: (unitId) => {
      devLayer?.selectUnit(unitId);
      if (!syncingFromUrl) replaceUrl();
    },
    onFloor: (level) => devLayer?.setFloor(level),
    onFilter: (fn) => devLayer?.setUnitFilter(fn),
    onHoverUnit: (unitId) => devLayer?.hoverUnit(unitId),
    onView: (unitId) => devLayer?.viewFrom(unitId),
    onExitView: () => devLayer?.exitView(true),
  });

  function openDevelopment(id: string, unitId: string | null = null) {
    const d = developments.find((x) => x.id === id);
    if (!d || !devLayer) return;
    // like a search: replace the URL instead of stepping back in history
    closingForSearch = true;
    drawer.close();
    closingForSearch = false;
    if (addPanel.opened) addPanel.close();
    if (isMobile()) results.setCollapsed(true);
    if (devPanel.currentId !== id) {
      devPanel.open(d);
      devLayer.open(id);
    }
    devPanel.select(unitId);
    if (!syncingFromUrl) replaceUrl();
  }

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
      if (state.developmentId) {
        if (state.developmentId !== devPanel.currentId || state.unitId !== devPanel.selectedUnitId)
          openDevelopment(state.developmentId, state.unitId ?? null);
      } else if (!state.listingId) devPanel.close();
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
  // rent-only listings start dimmed: the default search is "Comprar"
  scene.setMatched(new Set(currentList.map((l) => l.id)));
  devLayer = new DevelopmentLayer(
    scene.map,
    developments,
    {
      onOpen: (id) => openDevelopment(id),
      onUnitClick: (devId, unitId) => openDevelopment(devId, devPanel.selectedUnitId === unitId ? null : unitId),
      isBlocked: () => scene.isPicking || addPanel.opened,
    },
    'listing-pins-dimmed',
  );
  if (clipArea) devLayer.setHidden(new Set(developments.filter((d) => !inClip(d)).map((d) => d.id)));
  // Shared link: restore filters and the open listing, then normalise the URL (drops invalid params).
  applyUrl();
  history.replaceState(historyState(), '', urlFor(drawer.currentId));
  status.textContent = '';
  document.body.dataset.ready = 'true';

  if (embed) {
    // the site's search results: only those stay lit, and the camera frames them
    window.addEventListener('message', (e) => {
      const msg = e.data as { type?: string; ids?: unknown; rent?: unknown; bairros?: unknown };
      if (e.origin !== location.origin || e.source !== window.parent || msg?.type !== 'site-results' || !Array.isArray(msg.ids)) return;
      const rent = msg.rent === true;
      if ((store.getApplied().transaction === 'rent') !== rent) {
        store.setPending({ ...EMPTY_CRITERIA, transaction: rent ? 'rent' : null });
        store.apply();
      }
      const ids = new Set(msg.ids.filter((x): x is string => typeof x === 'string'));
      currentList = sortListings(listings.filter((l) => ids.has(l.id)), sort, rent);
      scene.setMatched(ids);
      if (drawer.currentId && !ids.has(drawer.currentId)) drawer.close();
      const bairros = Array.isArray(msg.bairros) ? msg.bairros.filter((b): b is string => typeof b === 'string').slice(0, 20) : [];
      void applyBairroClip(bairros, true).then((cut) => {
        if (!cut && currentList.length) scene.fitToListings(currentList);
      });
    });
    const focus = embed.focus ? listings.find((l) => l.id === embed.focus) : undefined;
    if (focus) {
      scene.flyToListing(focus);
      scene.select(focus.id);
    }
    if (window.parent !== window) window.parent.postMessage({ type: 'map-ready' }, location.origin);
  }

  // Hook for automated browser checks (scripts/e2e-check.mjs). Read-only helpers.
  (window as unknown as { __demo: unknown }).__demo = {
    map: scene.map,
    get listingIds() {
      return listings.map((l) => l.id);
    },
    project: (id: string) => scene.projectListing(id),
    isHighlighted: (id: string) => scene.isHighlighted(id),
    isMatched: (id: string) => scene.isMatched(id),
    get clipped() {
      return scene.clipped;
    },
    sun: (t: TimeOfDay) => themeFor(t, lat, lon).sun,
    developmentIds: developments.map((d) => d.id),
  };
}

main().catch((err: Error) => {
  console.error(err);
  status.textContent = `Erro ao iniciar o mapa: ${err.message}`;
  status.classList.add('error');
});
