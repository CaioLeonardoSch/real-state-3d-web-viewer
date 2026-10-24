import { addProtocol, setWorkerUrl, type AddProtocolAction } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
// MapLibre v6 loads its worker from a separate module next to the library file. After bundling,
// that file must be emitted explicitly and its URL handed to MapLibre.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { loadBairroAreas, loadData, loadStreets } from './data/load';
import type { StreetEntry, StreetFinder } from './data/streets';
import type { MultiPolygon, Polygon } from 'geojson';
import turfBooleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Listing } from './data/types';
import { NEARBY_MAX_M, ServiceIndex, listingPoint, nearbyDistances, type ServicesFile } from './data/services';
import { Scene, type StreetRef } from './map/scene';
import { rulerDate, themeAt, themeFor, type TimeOfDay } from './map/lighting';
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
import { StreetCard } from './ui/streetCard';
import { ResultsPanel, resultsHeading } from './ui/results';
import { Drawer } from './ui/drawer';
import { mountTimeOfDay } from './ui/timeOfDay';
import { HoverTooltip } from './ui/tooltip';
import { AddListingPanel } from './ui/addListing';
import { exportUserListings, loadUserListings, newListingId, saveUserListings } from './state/userListings';
import { PlacementChecker } from './utils/placement';
import { DevelopmentLayer } from './map/developmentLayer';
import { DevelopmentPanel } from './ui/developmentPanel';
import { countByStatus, type Development } from './data/developments';
import { backendConfig } from './backend/config';
import type { RemoteBackend } from './backend/remote';
import { mountMapHint } from './ui/mapHint';
import { saveLayout, savedLayout, validLayout } from './map/unitLayout';
import { AreaDrawer, growRing } from './map/drawArea';
import { CLIP_BUFFER_M } from './map/baseStyle';
import type { AccountPanel } from './ui/account';
import { withPriceChange } from './state/priceChange';
import { today } from './data/listingText';
import { DEMO } from './data/demo';

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
  // inside a client's site the server sends only that client's listings
  const siteOrg = embed?.agency && /^[0-9a-f-]{36}$/i.test(embed.agency) ? embed.agency : null;
  const baseListings = ofSite(data.listings.listings);
  // With a back end (Supabase), listings come from it; without one, "Anunciar" keeps them in this browser.
  let remote: RemoteBackend | null = null;
  let remoteListings: Listing[] = [];
  let remoteDevelopments: Development[] = [];
  // the back end's client and the account panel load only when there is one (the demo does without them)
  let Account: typeof AccountPanel | null = null;
  if (backendConfig) {
    try {
      const [{ RemoteBackend }, ui] = await Promise.all([import('./backend/remote'), import('./ui/account')]);
      Account = ui.AccountPanel;
      remote = await RemoteBackend.connect(backendConfig.url, backendConfig.key);
      const r = await remote.loadListings(siteOrg);
      remoteListings = ofSite(r.listings);
      mergeAgencies(r.agencies);
    } catch (err) {
      console.error(err);
      status.textContent = DEMO
        ? 'Não foi possível carregar os anúncios do servidor; mostrando só a demonstração.'
        : 'Não foi possível carregar os anúncios agora. Tente de novo em instantes.';
    }
    // sales mirrors kept by developers (an error leaves only the demonstration)
    if (remote && !embed) remoteDevelopments = await remote.loadDevelopments().catch((err: Error) => (console.error(err), []));
  }
  function mergeAgencies(more: typeof agencies) {
    for (const a of more) if (!agencies.some((x) => x.id === a.id)) agencies.push(a);
  }
  let userListings = remote ? [] : loadUserListings(agencies, new Set(baseListings.map((l) => l.id)));
  let listings = [...baseListings, ...remoteListings, ...userListings];
  // the sales charts are a demo of a developer: not inside an agency's site
  // one kept in the back end replaces the demonstration's with the same address
  const developments = embed
    ? []
    : [...data.developments.filter((d) => !remoteDevelopments.some((r) => r.id === d.id)), ...remoteDevelopments];
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
  // embedded in a client's site, the frame's own URL keeps the embed parameters (reloading the frame stays embedded);
  // ?relevo=0 (map without the relief) is kept too
  const keptKeys = [...(embed ? ['embed', 'site', 'cor', 'pagina', 'foco'] : []), 'relevo'];
  const keptQuery = keptKeys.flatMap((k) => (embedParams.has(k) ? [[k, embedParams.get(k)!]] : []));
  const urlFor = (listingId: string | null) => {
    const search = stateToSearch({
      criteria: store.getApplied(),
      listingId,
      sort,
      developmentId: devPanel.currentId,
      unitId: devPanel.selectedUnitId,
    });
    if (!keptQuery.length) return `${location.pathname}${search}${location.hash}`;
    const p = new URLSearchParams(keptQuery);
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
  }, listings, { cooperative: !!embed, drawArea: !embed });
  if (!embed) mountMapHint($('.stage'), scene.map);

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
    if (remote && l.remote && !l.draft) remote.trackView(id, embed ? 'site' : 'map');
    const index = currentList.findIndex((x) => x.id === id);
    if (l.partial) loadDetail(l);
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

  // A summary from the back end opens at once; its description and photos follow. Only the last listing opened
  // is shown when its details arrive.
  let detailToken = 0;
  function loadDetail(l: Listing) {
    if (!remote) return;
    const token = ++detailToken;
    remote.listingDetail(l.id, Boolean(l.userAdded)).then(
      (full) => {
        if (token !== detailToken || drawer.currentId !== l.id) return;
        if (!full) return drawer.detailFailed(l.id, 'Este anúncio saiu do ar.');
        // the same object everywhere (map, list, filters) gets the details
        Object.assign(l, full);
        delete l.partial;
        drawer.refresh(l);
      },
      (err: Error) => {
        if (token === detailToken) drawer.detailFailed(l.id, `${err.message}. Feche e abra o anúncio de novo.`);
      },
    );
  }

  const filtersUi = mountFilters($<HTMLFormElement>('#filters'), store, agencies, data.meta.bairros, {
    load: loadStreets,
    onStreet: (street, finder) => goToStreet(street, finder),
  });

  // ------------------------------------------------------------ a street chosen in the search box
  // Choosing a street is navigation: the map goes there and lights it, the criteria stay. Its card offers the
  // listings on it as a search ("Imóveis nesta rua"). Any search, closing the card or another street ends it.
  let litStreet: StreetRef | null = null;
  /** Lights a street on the map (null: none) once the map's style is there. */
  function lightStreet(street: StreetRef | null) {
    if (!street && !litStreet) return;
    litStreet = street;
    void scene.ready.then(() => scene.highlightStreet(litStreet));
  }
  const streetCard = new StreetCard($('.stage'), {
    onSearch: (name) => {
      filtersUi.applyStreet(name);
      // the card goes away with the search: focus moves to the results
      if (isMobile()) $('#results').focus();
      else results.focusFirst();
    },
    onClose: () => {
      lightStreet(null);
      (isMobile() ? $('.filters-toggle') : $('#f-bairro-input')).focus();
    },
  });
  function goToStreet(street: StreetEntry, finder: StreetFinder) {
    // the street takes over the camera: no listing or development stays open over it
    closingForSearch = true;
    drawer.close();
    closingForSearch = false;
    const devOpen = devPanel.currentId !== null;
    leavingDevelopment = true;
    devPanel.close();
    leavingDevelopment = false;
    if (devOpen) replaceUrl();
    // only listings that show their street in the address are counted (see publicStreet)
    const count = filterListings(listings, { ...store.getPending(), street: street.name }).length;
    // the card first: on small screens it is a bar at the bottom, and the street is framed above it
    streetCard.show({ street, count, elsewhere: finder.inOtherPlaces(street) });
    const mobile = isMobile();
    if (mobile) {
      // the filters panel and the list would cover the street
      document.body.classList.remove('filters-open');
      $('.filters-toggle').setAttribute('aria-expanded', 'false');
      results.setCollapsed(true);
    }
    // bar height + its 8 px from the bottom edge + some map between the bar and the street
    scene.frameStreet(street.bbox, street.point, mobile ? { bottom: streetCard.height + 24 } : {});
    lightStreet({ name: street.name, bbox: street.bbox });
    // "em", not "na": some names are masculine (Acesso, Calçadão, Elevado)
    announce(`Mapa em ${street.name}, ${street.bairro || street.city}.`);
    // the box that had focus is hidden with the panel
    if (mobile) streetCard.focus();
  }

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
  /**
   * "Desenhar área": the map is cut to the drawn area plus 100 m around it, like a neighbourhood. Returns whether
   * the map is cut.
   */
  async function applyAreaClip(ring: [number, number][], frame: boolean): Promise<boolean> {
    const request = ++clipRequest;
    try {
      const { default: clipping } = await import('polygon-clipping');
      if (request !== clipRequest) return false;
      const area: Polygon = { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
      const [w, s, e, n] = data.meta.boundaryBbox;
      const world: [number, number][][] = [[[w - 1, s - 1], [e + 1, s - 1], [e + 1, n + 1], [w - 1, n + 1], [w - 1, s - 1]]];
      const mask: MultiPolygon = { type: 'MultiPolygon', coordinates: clipping.difference(world, growRing(ring, CLIP_BUFFER_M, clipping.union)) };
      await scene.ready;
      if (request !== clipRequest) return false;
      setClipArea(area, [], mask);
      if (frame) scene.fitToClip();
      return true;
    } catch (err) {
      console.warn(`Recorte da área indisponível: ${(err as Error).message}`);
      return false;
    }
  }
  /** The cut of the applied criteria: the drawn area first, else the neighbourhoods. */
  function applyCut(criteria: { area: [number, number][]; bairros: string[] }, frame: boolean): Promise<boolean> {
    return criteria.area.length >= 3 ? applyAreaClip(criteria.area, frame) : applyBairroClip(criteria.bairros, frame);
  }

  const areaDrawer = new AreaDrawer($('.stage'), scene, {
    onDone: (ring) => {
      filtersUi.applyArea(ring);
      if (isMobile()) $('#results').focus();
      else results.focusFirst();
    },
    onCancel: () => {
      announce('Desenho da área cancelado.');
      $<HTMLElement>('.draw-area-btn').focus();
    },
    announce,
  });
  scene.onDrawArea = () => {
    if (addPanel.opened) return announce('Feche o formulário "Anunciar" para desenhar a área.');
    // the drawing takes over the map: no listing, development or street card stays over it
    closingForSearch = true;
    drawer.close();
    closingForSearch = false;
    const devOpen = devPanel.currentId !== null;
    leavingDevelopment = true;
    devPanel.close();
    leavingDevelopment = false;
    if (devOpen) replaceUrl();
    streetCard.hide();
    lightStreet(null);
    if (isMobile()) {
      document.body.classList.remove('filters-open');
      $('.filters-toggle').setAttribute('aria-expanded', 'false');
      results.setCollapsed(true);
    }
    areaDrawer.start();
  };

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
    // a search ends the visit to a chosen street
    streetCard.hide();
    lightStreet(null);
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
    // with a drawn area or a neighbourhood filter the camera frames it (even without results); otherwise the results
    if (criteria.area.length || criteria.bairros.length) void applyCut(criteria, true);
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
  // ------------------------------------------------------------ services nearby (servicos.json)
  // Loaded in the background: the "perto de" filter and the drawer's "Por perto" read it once it arrives.
  let services: ServiceIndex | null = null;
  const setNearby = (list: Listing[]) => {
    if (services) for (const l of list) l.nearby = nearbyDistances(services, l);
  };
  drawer.nearby = (l) => {
    const p = services && listingPoint(l);
    return p ? services!.nearest(p, NEARBY_MAX_M) : null;
  };
  fetch(new URL(`${import.meta.env.BASE_URL}data/servicos.json`, location.href))
    .then((r) => (r.ok ? (r.json() as Promise<ServicesFile>) : Promise.reject(new Error(`servicos.json: ${r.status}`))))
    .then((file) => {
      services = new ServiceIndex(file);
      setNearby(listings);
      if (store.getApplied().near.length) {
        showResults();
        scene.setMatched(new Set(currentList.map((l) => l.id)));
      }
      const open = drawer.currentId && listings.find((l) => l.id === drawer.currentId);
      if (open) drawer.refresh(open);
    })
    .catch((err: Error) => console.error(err));

  function listingsChanged() {
    listings = [...baseListings, ...remoteListings, ...userListings];
    setNearby(listings);
    known.agencyIds = new Set(agencies.map((a) => a.id));
    known.listingIds = new Set(listings.map((l) => l.id));
    scene.setListings(listings);
    showResults();
    scene.setMatched(new Set(filterListings(listings, store.getApplied()).map((l) => l.id)));
  }

  /** Reloads the back end's listings (after login, logout or a change) and refreshes the map and list. */
  async function reloadRemote() {
    if (!remote) return;
    const r = await remote.loadListings(siteOrg);
    mergeAgencies(r.agencies);
    remoteListings = ofSite(r.listings);
    listingsChanged();
    // logged in or out: the team sees its prices; the units of the towers already drawn take the new view
    if (embed || !developments.some((d) => d.backend)) return;
    const fresh = new Map((await remote.loadDevelopments()).map((d) => [d.id, d]));
    for (const d of developments) {
      const f = fresh.get(d.id);
      if (!d.backend || !f?.backend) continue;
      d.backend = f.backend;
      const units = new Map(f.levels.flatMap((l) => l.units).map((u) => [u.id, u]));
      for (const u of d.levels.flatMap((l) => l.units)) {
        const nu = units.get(u.id);
        if (nu) Object.assign(u, { status: nu.status, price: nu.price });
      }
    }
    devLayer?.unitsChanged();
    showResults();
    const open = devPanel.currentId ? developments.find((d) => d.id === devPanel.currentId) : undefined;
    if (open) {
      // after logging in, the open unit shows the team's actions right away
      const unit = devPanel.selectedUnitId;
      devPanel.open(open);
      if (unit) devPanel.select(unit);
    }
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
  async function saveEditedListing(l: Listing, center: [number, number], doc?: File): Promise<string | null> {
    const before = listings.find((x) => x.id === l.id);
    if (!before) return 'Este anúncio não existe mais.';
    if (remote && l.remote) {
      try {
        await remote.updateListingFull(l, center, doc);
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
    listingsOnBuilding: (osmId) => listings.filter((l) => l.buildingOsmId === osmId),
    // the layout an earlier listing of the building gave: on the map, in this browser, or in the database
    buildingLayout: async (osmId) => {
      const known = listings.find((l) => l.buildingOsmId === osmId && validLayout({ floors: l.floors, unitsPerFloor: l.unitsPerFloor }));
      if (known) return { floors: known.floors!, unitsPerFloor: known.unitsPerFloor! };
      return remote ? remote.buildingLayout(osmId) : savedLayout(osmId);
    },
    // with the back end, saving the listing stores it (building_layouts)
    saveBuildingLayout: (osmId, layout) => (remote ? undefined : saveLayout(osmId, layout)),
    otherLots: (exceptId) => listings.flatMap((l) => (l.lotPolygon && l.id !== exceptId ? [l.lotPolygon] : [])),
    newId: (slug) => newListingId(slug, known.listingIds),
    bairroAt: (p) => scene.bairroAt(p),
    bairroPoint: (name) => {
      const key = name.trim().toLocaleLowerCase('pt-BR');
      const f = data.bairros.features.find((b) => String(b.properties?.name ?? '').toLocaleLowerCase('pt-BR') === key);
      return f?.geometry.type === 'Point' ? (f.geometry.coordinates.slice(0, 2) as [number, number]) : null;
    },
    listingById: (id) => listings.find((l) => l.id === id),
    remoteOrgName: () => (remote ? (account?.currentOrg?.name ?? null) : null),
    onSave: async (l, center, doc) => {
      if (remote) {
        const org = account?.currentOrg;
        if (!org) return 'Entre na sua conta e cadastre a imobiliária para anunciar.';
        try {
          const id = await remote.createListing(l, org.id, center, doc);
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
  const account = Account && remote
    ? new Account($('#account-panel'), $<HTMLButtonElement>('.account-toggle'), remote, () => {
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
    drawer.report = async (l, reason, details) => {
      try {
        await backend.reportListing(l.id, reason, details);
        return null;
      } catch (err) {
        return (err as Error).message.replace(/^Não foi possível enviar a denúncia: /, '');
      }
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
  // The development panel exists before the first wait below: a listing or a street chosen meanwhile closes it
  // (openListing, goToStreet). True while another view (a listing, a street) closes the development panel.
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
    onUnitsChanged: () => {
      devLayer?.unitsChanged();
      devLayer?.selectUnit(devPanel.selectedUnitId);
      showResults();
    },
  });
  if (remote && account) {
    const backend = remote;
    devPanel.team = {
      roleFor: (d) => {
        const role = d.backend ? account.roleIn(d.backend.orgId) : null;
        if (!role) return d.backend && account.sellsAsPartner(d.backend.id) ? 'partner' : null;
        return role === 'owner' || role === 'admin' ? 'admin' : 'member';
      },
      units: (d) => backend.teamUnits(d.backend!.id),
      reserve: async (u, note) => void (await backend.reserveUnit(u.dbId!, { note })),
      release: (u) => backend.releaseUnit(u.dbId!),
      setStatus: (u, st) => backend.updateUnit(u.dbId!, { status: st }),
    };
  }
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

  mountTimeOfDay(
    $('.time-of-day'),
    tod,
    (next) => {
      tod = next;
      scene.setTheme(themeFor(tod, lat, lon).theme);
      document.body.dataset.tod = tod;
      devLayer?.setNight(tod === 'night');
    },
    // the hour-and-season ruler: the sun of that moment, with the colours of the matching button
    (season, minutes) => {
      const at = themeAt(rulerDate(season, minutes), minutes, lat, lon);
      tod = at.tod;
      scene.setTheme(at.theme);
      document.body.dataset.tod = tod;
      devLayer?.setNight(tod === 'night');
      return tod;
    },
  );
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
      isBlocked: () => scene.isPicking || scene.isDrawing || addPanel.opened,
    },
    'listing-pins-dimmed',
  );
  // (the time of day may have changed while the map loaded)
  devLayer.setNight((tod as TimeOfDay) === 'night');
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
    camera: () => scene.camera(),
    get listingIds() {
      return listings.map((l) => l.id);
    },
    project: (id: string) => scene.projectListing(id),
    isHighlighted: (id: string) => scene.isHighlighted(id),
    isMatched: (id: string) => scene.isMatched(id),
    get clipped() {
      return scene.clipped;
    },
    /** The trees (src/map/cityTrees.ts): tiles and trees loaded, trees drawn and how many with every facet. */
    get trees() {
      return scene.trees?.stats ?? null;
    },
    sun: (t: TimeOfDay) => themeFor(t, lat, lon).sun,
    shadows: () => scene.shadowInfo,
    developmentIds: developments.map((d) => d.id),
    /** Windows of the open tower drawn in the last frame (item 48). */
    heroWindows: () => ({ ...devLayer?.windows.stats }),
    /** Name of the street lit by the search box, or null. */
    get highlightedStreet() {
      return litStreet?.name ?? null;
    },
  };
}

main().catch((err: Error) => {
  console.error(err);
  status.textContent = `Erro ao iniciar o mapa: ${err.message}`;
  status.classList.add('error');
});
