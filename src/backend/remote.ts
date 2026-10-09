// Supabase back end: login, clients ("organizations"), listings and photos. Loaded only when configured
// (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY), so the static demo does not download the client library.
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Agency, Listing } from '../data/types';
import { dataUrlToBlob, listingToRow, rowToListing, type ListingRow, type PhotoRow } from './mapping';

export interface Org {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'admin' | 'agent';
}

export interface PricePoint {
  date: string;
  price: number;
}

const PHOTOS = 'listing-photos';

/** Message for the user from a Supabase/PostgREST error. */
function fail(error: { message: string; code?: string } | null, what: string): void {
  if (!error) return;
  const msg =
    error.code === '23505'
      ? 'já existe um registro com esse identificador'
      : error.code === '42501' || /row-level security/i.test(error.message)
        ? 'sem permissão para isso'
        : error.message;
  throw new Error(`${what}: ${msg}`);
}

export class RemoteBackend {
  private constructor(private sb: SupabaseClient) {}

  static async connect(url: string, anonKey: string): Promise<RemoteBackend> {
    const { createClient } = await import('@supabase/supabase-js');
    return new RemoteBackend(createClient(url, anonKey, { auth: { persistSession: true, storageKey: 'mapa3d-auth' } }));
  }

  // ---------------------------------------------------------------- account

  async session(): Promise<Session | null> {
    return (await this.sb.auth.getSession()).data.session;
  }

  onAuthChange(fn: (session: Session | null) => void): void {
    this.sb.auth.onAuthStateChange((_event, session) => fn(session));
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(/invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : error.message);
  }

  /** Returns true when the account still needs e-mail confirmation. */
  async signUp(email: string, password: string, fullName: string): Promise<boolean> {
    const { data, error } = await this.sb.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName }, emailRedirectTo: location.href.split('?')[0] },
    });
    if (error) throw new Error(error.message);
    return !data.session;
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut();
  }

  async myOrgs(): Promise<Org[]> {
    const user = (await this.session())?.user;
    if (!user) return [];
    const { data, error } = await this.sb
      .from('memberships')
      .select('role, organizations(id, name, slug)')
      .eq('user_id', user.id);
    fail(error, 'Não foi possível ler seus clientes');
    return (data ?? []).map((m) => {
      const o = m.organizations as unknown as { id: string; name: string; slug: string };
      return { id: o.id, name: o.name, slug: o.slug, role: m.role as Org['role'] };
    });
  }

  async createOrg(name: string, slug: string): Promise<Org> {
    const { data, error } = await this.sb.rpc('create_organization', { p_name: name, p_slug: slug });
    fail(error, 'Não foi possível criar a imobiliária');
    return { id: data.id, name: data.name, slug: data.slug, role: 'owner' };
  }

  // ---------------------------------------------------------------- listings

  private photoUrl = (path: string) => this.sb.storage.from(PHOTOS).getPublicUrl(path).data.publicUrl;

  private async photosFor(ids: string[]): Promise<PhotoRow[]> {
    if (!ids.length) return [];
    const { data, error } = await this.sb
      .from('listing_photos')
      .select('listing_id, path, caption, position, is_floor_plan')
      .in('listing_id', ids);
    fail(error, 'Não foi possível ler as fotos');
    return data ?? [];
  }

  /**
   * Published listings for everyone, plus the current user's clients' listings (drafts included, exact location,
   * editable). Also returns the clients as agencies, for names in the UI.
   */
  async loadListings(): Promise<{ listings: Listing[]; agencies: Agency[] }> {
    const [pub, mine] = await Promise.all([
      this.sb.from('public_listings').select('*'),
      (async () => ((await this.session()) ? this.sb.from('my_listings').select('*') : { data: [], error: null }))(),
    ]);
    fail(pub.error, 'Não foi possível carregar os anúncios');
    fail(mine.error, 'Não foi possível carregar seus anúncios');
    const mineRows = (mine.data ?? []) as ListingRow[];
    const mineIds = new Set(mineRows.map((r) => r.id));
    const pubRows = ((pub.data ?? []) as ListingRow[]).filter((r) => !mineIds.has(r.id));
    const [photos, history] = await Promise.all([
      this.photosFor([...mineRows, ...pubRows].map((r) => r.id)),
      this.historyFor(mineRows.map((r) => r.id)),
    ]);
    const listings = [
      ...pubRows.map((r) => rowToListing(r, photos, this.photoUrl, false)),
      ...mineRows.map((r) => ({ ...rowToListing(r, photos, this.photoUrl, true), priceHistory: history.get(r.id) ?? [] })),
    ];
    const orgIds = [...new Set(listings.map((l) => l.agency))];
    let agencies: Agency[] = [];
    if (orgIds.length) {
      const { data, error } = await this.sb.from('organizations').select('id, name').in('id', orgIds);
      fail(error, 'Não foi possível ler as imobiliárias');
      agencies = (data ?? []).map((o) => ({ id: o.id, name: o.name }));
    }
    return { listings, agencies };
  }

  /** Saves a new listing and uploads its photos (data URLs prepared by the form). Returns the new id. */
  async createListing(l: Listing, orgId: string, location: [number, number]): Promise<string> {
    const { data, error } = await this.sb.from('listings').insert(listingToRow(l, orgId, location)).select('id').single();
    fail(error, 'Não foi possível salvar o anúncio');
    const id = data!.id as string;
    try {
      const files = [
        ...(l.photos ?? []).map((p, i) => ({ src: p.src, caption: p.caption ?? null, position: i, plan: false })),
        ...(l.floorPlanImage ? [{ src: l.floorPlanImage, caption: 'Planta', position: 999, plan: true }] : []),
      ];
      const rows = [];
      for (const f of files) {
        const blob = dataUrlToBlob(f.src);
        const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
        const path = `${orgId}/${id}/${f.plan ? 'planta' : String(f.position).padStart(2, '0')}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
        const up = await this.sb.storage.from(PHOTOS).upload(path, blob, { contentType: blob.type });
        fail(up.error, 'Não foi possível enviar uma foto');
        rows.push({ listing_id: id, org_id: orgId, path, caption: f.caption, position: f.position, is_floor_plan: f.plan });
      }
      if (rows.length) fail((await this.sb.from('listing_photos').insert(rows)).error, 'Não foi possível registrar as fotos');
    } catch (err) {
      // no half-saved listing: remove it (its photo rows go with it)
      await this.sb.from('listings').delete().eq('id', id);
      throw err;
    }
    return id;
  }

  /** Status and price changes from "Gerenciar anúncio" (the server records the history and the reduction). */
  async updateListing(id: string, patch: { price?: number; rentPrice?: number; availability?: Listing['availability'] }): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.price !== undefined) row.price = patch.price;
    if (patch.rentPrice !== undefined) row.rent_price = patch.rentPrice;
    if (patch.availability !== undefined) row.availability = patch.availability;
    const { data, error } = await this.sb.from('listings').update(row).eq('id', id).select('id');
    fail(error, 'Não foi possível salvar');
    if (!data?.length) throw new Error('Não foi possível salvar: sem permissão para editar este anúncio.');
  }

  async deleteListing(id: string, orgId: string): Promise<void> {
    const { data: files } = await this.sb.storage.from(PHOTOS).list(`${orgId}/${id}`);
    if (files?.length) await this.sb.storage.from(PHOTOS).remove(files.map((f) => `${orgId}/${id}/${f.name}`));
    const { data, error } = await this.sb.from('listings').delete().eq('id', id).select('id');
    fail(error, 'Não foi possível excluir');
    if (!data?.length) throw new Error('Não foi possível excluir: sem permissão.');
  }

  /** Price histories (visible to the listing's client only), oldest first. */
  private async historyFor(ids: string[]): Promise<Map<string, PricePoint[]>> {
    const out = new Map<string, PricePoint[]>();
    if (!ids.length) return out;
    const { data, error } = await this.sb
      .from('price_history')
      .select('listing_id, price, changed_at')
      .in('listing_id', ids)
      .order('changed_at');
    fail(error, 'Não foi possível ler o histórico de preços');
    for (const h of data ?? []) {
      const list = out.get(h.listing_id as string) ?? [];
      list.push({ date: (h.changed_at as string).slice(0, 10), price: h.price as number });
      out.set(h.listing_id as string, list);
    }
    return out;
  }
}

/** Back end configured for this build (environment variables at build time). */
export const backendConfig = (() => {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && key ? { url, key } : null;
})();
