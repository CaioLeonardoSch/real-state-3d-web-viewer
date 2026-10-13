// Favourites and the comparison list of a visitor, kept in this browser (no login needed). Each client's site has
// its own lists. Storage may be blocked (private mode): the lists then live only while the page is open.
export const MAX_COMPARE = 4;

export class SavedLists {
  private favs: string[];
  private cmp: string[];
  private listeners = new Set<() => void>();
  constructor(private siteKey: string) {
    this.favs = this.read('favoritos');
    this.cmp = this.read('comparar').slice(0, MAX_COMPARE);
  }
  private read(kind: string): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(`site:${this.siteKey}:${kind}`) ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 200) : [];
    } catch {
      return [];
    }
  }
  private write(kind: string, ids: string[]) {
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
  isFavorite = (id: string) => this.favs.includes(id);
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
