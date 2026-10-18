// Favourites, the comparison list and the saved searches of a visitor, kept in this browser (no login needed). Each
// client's site has its own lists. Storage may be blocked (private mode): the lists then live only while the page is
// open.
export const MAX_COMPARE = 4;
export const MAX_SEARCHES = 10;

/** A saved search: its address query (src/site/search.ts alertQuery) and the listings it had when last seen. */
export interface SavedSearch {
  query: string;
  label: string;
  savedAt: string;
  seen: string[];
}

/** Matches of a saved search the visitor has not seen yet. */
export const unseen = (s: SavedSearch, matchIds: readonly string[]) => matchIds.filter((id) => !s.seen.includes(id));

export class SavedLists {
  private favs: string[];
  private cmp: string[];
  private srch: SavedSearch[];
  private listeners = new Set<() => void>();
  constructor(private siteKey: string) {
    this.favs = this.read('favoritos');
    this.cmp = this.read('comparar').slice(0, MAX_COMPARE);
    this.srch = this.readSearches();
  }
  private readSearches(): SavedSearch[] {
    try {
      const v = JSON.parse(localStorage.getItem(`site:${this.siteKey}:buscas`) ?? '[]');
      return (Array.isArray(v) ? v : [])
        .filter((x): x is SavedSearch => !!x && typeof x.query === 'string' && typeof x.label === 'string' && Array.isArray(x.seen))
        .map((x) => ({ query: x.query, label: x.label, savedAt: String(x.savedAt ?? ''), seen: x.seen.filter((id): id is string => typeof id === 'string').slice(0, 500) }))
        .slice(0, MAX_SEARCHES);
    } catch {
      return [];
    }
  }
  private read(kind: string): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(`site:${this.siteKey}:${kind}`) ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 200) : [];
    } catch {
      return [];
    }
  }
  private write(kind: string, ids: string[] | SavedSearch[]) {
    try {
      localStorage.setItem(`site:${this.siteKey}:${kind}`, JSON.stringify(ids));
    } catch {
      /* storage blocked: keep in memory */
    }
    this.listeners.forEach((fn) => fn());
  }
  onChange(fn: () => void) {
    this.listeners.add(fn);
  }
  get favorites(): readonly string[] {
    return this.favs;
  }
  get compared(): readonly string[] {
    return this.cmp;
  }
  get searches(): readonly SavedSearch[] {
    return this.srch;
  }
  isFavorite = (id: string) => this.favs.includes(id);
  savedSearch = (query: string) => this.srch.find((s) => s.query === query) ?? null;
  /** Saves (with the listings it has now, so only later ones count as new) or forgets a search; false when full. */
  toggleSearch(query: string, label: string, matchIds: readonly string[]): boolean {
    if (this.savedSearch(query)) this.srch = this.srch.filter((s) => s.query !== query);
    else if (this.srch.length >= MAX_SEARCHES) return false;
    else this.srch = [{ query, label, savedAt: new Date().toISOString(), seen: matchIds.slice(0, 500) }, ...this.srch];
    this.write('buscas', this.srch);
    return true;
  }
  /** The visitor opened the search: what it shows now is no longer new. */
  markSeen(query: string, matchIds: readonly string[]) {
    const s = this.savedSearch(query);
    if (!s || unseen(s, matchIds).length === 0) return;
    this.srch = this.srch.map((x) => (x === s ? { ...x, seen: [...new Set([...matchIds, ...x.seen])].slice(0, 500) } : x));
    this.write('buscas', this.srch);
  }
  isCompared = (id: string) => this.cmp.includes(id);
  toggleFavorite(id: string): boolean {
    this.favs = this.isFavorite(id) ? this.favs.filter((x) => x !== id) : [id, ...this.favs];
    this.write('favoritos', this.favs);
    return this.isFavorite(id);
  }
  /** False when the list is already full. */
  toggleCompare(id: string): boolean {
    if (this.isCompared(id)) this.cmp = this.cmp.filter((x) => x !== id);
    else if (this.cmp.length >= MAX_COMPARE) return false;
    else this.cmp = [...this.cmp, id];
    this.write('comparar', this.cmp);
    return true;
  }
  clearCompare() {
    this.cmp = [];
    this.write('comparar', this.cmp);
  }
  /** Drops ids of listings that no longer exist. */
  prune(existing: Set<string>) {
    const f = this.favs.filter((x) => existing.has(x));
    const c = this.cmp.filter((x) => existing.has(x));
    if (f.length !== this.favs.length) this.write('favoritos', (this.favs = f));
    if (c.length !== this.cmp.length) this.write('comparar', (this.cmp = c));
  }
}
