// Supabase back end: login, clients ("organizations"), listings and photos. Loaded only when configured
// (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY), so the static demo does not download the client library.
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Agency, Listing, Photo } from '../data/types';
import type { AuditEntry } from './audit';
import { dataUrlToBlob, listingToRow, rowToListing, type ListingRow, type PhotoRow } from './mapping';

export type Role = 'owner' | 'admin' | 'agent';

export interface Org {
  id: string;
  name: string;
  slug: string;
  /** Effective role; the platform's support staff act as owner of every client. */
  role: Role;
}

export interface Member {
  userId: string;
  name: string | null;
  email: string | null;
  role: Role;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  token: string;
  expiresAt: string;
}

export type LeadStatus = 'new' | 'contacted' | 'visit' | 'proposal' | 'won' | 'lost';
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Novo',
  contacted: 'Em atendimento',
  visit: 'Visita agendada',
  proposal: 'Proposta',
  won: 'Fechado',
  lost: 'Perdido',
};

export interface Lead {
  id: string;
  listingId: string | null;
  listingTitle: string | null;
  assignedTo: string | null;
  /** form: message on a listing; contact: the site's contact page; owner: "Anunciar imóvel" (an owner offering one). */
  source: 'form' | 'whatsapp' | 'contact' | 'owner';
  /** Extra answers of the site forms (e.g. type and neighbourhood of the property offered). */
  details: Record<string, string> | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  status: LeadStatus;
  notes: string | null;
  createdAt: string;
}

export interface LeadInput {
  name: string;
  email: string;
  phone: string;
  message: string;
  /** Consent sentence shown next to the checkbox (stored with the lead, LGPD). */
  consentText: string;
  /** Honeypot field: filled only by bots. */
  trap: string;
}

export interface TrashItem {
  id: string;
  title: string;
  createdBy: string | null;
  deletedAt: string;
  deletedByName: string | null;
  purgeAt: string;
}

export interface PendingInvitation {
  token: string;
  orgId: string;
  orgName: string;
  role: Role;
}

export interface PricePoint {
  date: string;
  price: number;
}

const PHOTOS = 'listing-photos';
const SITE_ASSETS = 'site-assets';

/** A client as its public site sees it. */
export interface SiteOrg {
  id: string;
  name: string;
  slug: string;
  creci: string | null;
  customDomain: string | null;
  /** Site configuration, unchecked (see src/site/config.ts). */
  branding: unknown;
}

/** Message for the user from a Supabase/PostgREST error. */
function fail(error: { message: string; code?: string } | null, what: string): void {
  if (!error) return;
  // messages raised by our database functions are already in Portuguese and meant for the user
  const msg =
    error.code === '23505'
      ? 'já existe um registro com esse identificador'
      : /row-level security|permission denied/i.test(error.message)
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

  /** Clients the user works for (all of them for the support staff), with the effective role. */
  async myOrgs(): Promise<Org[]> {
    if (!(await this.session())) return [];
    const { data, error } = await this.sb.rpc('my_organizations');
    fail(error, 'Não foi possível ler suas imobiliárias');
    return (data ?? []) as Org[];
  }

  async isStaff(): Promise<boolean> {
    if (!(await this.session())) return false;
    const { data } = await this.sb.rpc('is_staff');
    return data === true;
  }

  /** Support staff only: new client, with an invitation for its first owner. Returns the invitation token. */
  async createOrg(name: string, slug: string, ownerEmail: string): Promise<{ org: Org; inviteToken: string | null }> {
    const { data, error } = await this.sb.rpc('create_organization', { p_name: name, p_slug: slug, p_owner_email: ownerEmail });
    fail(error, 'Não foi possível cadastrar a imobiliária');
    const row = data[0];
    return { org: { id: row.id, name: row.name, slug: row.slug, role: 'owner' }, inviteToken: row.invite_token };
  }

  // ---------------------------------------------------------------- team and invitations

  async members(orgId: string): Promise<Member[]> {
    const { data, error } = await this.sb.rpc('org_members', { p_org: orgId });
    fail(error, 'Não foi possível ler a equipe');
    return (data ?? []).map((m: { user_id: string; full_name: string | null; email: string | null; role: Role }) => ({
      userId: m.user_id,
      name: m.full_name,
      email: m.email,
      role: m.role,
    }));
  }

  async setRole(orgId: string, userId: string, role: Role): Promise<void> {
    const { data, error } = await this.sb.from('memberships').update({ role }).eq('org_id', orgId).eq('user_id', userId).select('user_id');
    fail(error, 'Não foi possível alterar o papel');
    if (!data?.length) throw new Error('Não foi possível alterar o papel: sem permissão.');
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    const { data, error } = await this.sb.from('memberships').delete().eq('org_id', orgId).eq('user_id', userId).select('user_id');
    fail(error, 'Não foi possível remover');
    if (!data?.length) throw new Error('Não foi possível remover: sem permissão.');
  }

  /** Pending invitations of a client (admins). */
  async invitations(orgId: string): Promise<Invitation[]> {
    const { data, error } = await this.sb
      .from('invitations')
      .select('id, email, role, token, expires_at')
      .eq('org_id', orgId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at');
    fail(error, 'Não foi possível ler os convites');
    return (data ?? []).map((i) => ({ id: i.id, email: i.email, role: i.role, token: i.token, expiresAt: i.expires_at }));
  }

  /** Creates an invitation; returns its token (the link is sent by the admin, by e-mail or WhatsApp). */
  async invite(orgId: string, email: string, role: Role): Promise<string> {
    const { data, error } = await this.sb.from('invitations').insert({ org_id: orgId, email, role }).select('token').single();
    fail(error, 'Não foi possível criar o convite');
    return data!.token as string;
  }

  /** E-mails the invitation link (edge function send-invite); false when e-mail is not configured or failed. */
  async emailInvitation(token: string): Promise<boolean> {
    try {
      const { data } = await this.sb.functions.invoke('send-invite', { body: { token } });
      return data?.sent === true;
    } catch {
      return false;
    }
  }

  async cancelInvitation(id: string): Promise<void> {
    fail((await this.sb.from('invitations').delete().eq('id', id)).error, 'Não foi possível cancelar o convite');
  }

  /** What an invitation link points to (works before login). */
  async invitationInfo(token: string): Promise<{ orgName: string; email: string; role: Role; expired: boolean; accepted: boolean } | null> {
    const { data, error } = await this.sb.rpc('invitation_info', { p_token: token });
    if (error || !data?.length) return null;
    const i = data[0];
    return { orgName: i.org_name, email: i.email, role: i.role, expired: i.expired, accepted: i.accepted };
  }

  /** Invitations waiting for the logged-in user's e-mail. */
  async myInvitations(): Promise<PendingInvitation[]> {
    if (!(await this.session())) return [];
    const { data, error } = await this.sb.rpc('my_invitations');
    fail(error, 'Não foi possível ler seus convites');
    return (data ?? []).map((i: { token: string; org_id: string; org_name: string; role: Role }) => ({
      token: i.token,
      orgId: i.org_id,
      orgName: i.org_name,
      role: i.role,
    }));
  }

  /** Joins the client of the invitation; returns its id. */
  async acceptInvitation(token: string): Promise<string> {
    const { data, error } = await this.sb.rpc('accept_invitation', { p_token: token });
    fail(error, 'Não foi possível aceitar o convite');
    return data as string;
  }

  // ---------------------------------------------------------------- listings

  private photoUrl = (path: string) => this.sb.storage.from(PHOTOS).getPublicUrl(path).data.publicUrl;

  private async photosFor(ids: string[]): Promise<PhotoRow[]> {
    if (!ids.length) return [];
    const { data, error } = await this.sb
      .from('listing_photos')
      .select('listing_id, path, thumb_path, large_path, caption, position, is_floor_plan')
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
      await this.syncPhotos(id, orgId, l.photos ?? [], l.floorPlanImage ?? null);
    } catch (err) {
      // no half-saved listing: remove it (its photo rows go with it)
      await this.removeFiles(orgId, id);
      await this.sb.from('listings').delete().eq('id', id);
      throw err;
    }
    return id;
  }

  /**
   * Saves every field of an edited listing (its client and id stay) and brings the photos in line with the form:
   * kept photos get the new order and captions, new ones are uploaded, removed ones are deleted.
   * The database records the price history and the reduction.
   */
  async updateListingFull(l: Listing, location: [number, number]): Promise<void> {
    const { org_id: orgId, ...row } = listingToRow(l, l.agency, location);
    const { data, error } = await this.sb.from('listings').update(row).eq('id', l.id).select('id');
    fail(error, 'Não foi possível salvar');
    if (!data?.length) throw new Error('Não foi possível salvar: sem permissão para editar este anúncio.');
    await this.syncPhotos(l.id, orgId as string, l.photos ?? [], l.floorPlanImage ?? null);
  }

  private async upload(dataUrl: string, path: string): Promise<string> {
    const blob = dataUrlToBlob(dataUrl);
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const full = `${path}.${ext}`;
    const up = await this.sb.storage.from(PHOTOS).upload(full, blob, { contentType: blob.type });
    fail(up.error, 'Não foi possível enviar uma foto');
    return full;
  }

  /** Photos of a listing as the form left them (photos already stored are recognised by their public URL). */
  private async syncPhotos(id: string, orgId: string, photos: Photo[], floorPlan: string | null): Promise<void> {
    const { data: rows, error } = await this.sb.from('listing_photos').select('id, path, thumb_path, large_path, is_floor_plan').eq('listing_id', id);
    fail(error, 'Não foi possível ler as fotos');
    const byUrl = new Map((rows ?? []).map((r) => [this.photoUrl(r.path), r]));
    const kept = new Set<string>();
    const inserts: Record<string, unknown>[] = [];
    const name = () => `${orgId}/${id}/${crypto.randomUUID().slice(0, 8)}`;
    for (const [i, p] of photos.entries()) {
      const row = byUrl.get(p.src);
      if (row && !row.is_floor_plan) {
        kept.add(row.id);
        fail((await this.sb.from('listing_photos').update({ position: i, caption: p.caption ?? null }).eq('id', row.id)).error, 'Não foi possível atualizar as fotos');
      } else if (p.src.startsWith('data:')) {
        const base = name();
        const path = await this.upload(p.src, base);
        const thumb = p.thumb?.startsWith('data:') ? await this.upload(p.thumb, `${base}-mini`) : null;
        const large = p.large?.startsWith('data:') ? await this.upload(p.large, `${base}-grande`) : null;
        inserts.push({ listing_id: id, org_id: orgId, path, thumb_path: thumb, large_path: large, caption: p.caption ?? null, position: i, is_floor_plan: false });
      }
    }
    if (floorPlan) {
      const row = byUrl.get(floorPlan);
      if (row?.is_floor_plan) kept.add(row.id);
      else if (floorPlan.startsWith('data:'))
        inserts.push({ listing_id: id, org_id: orgId, path: await this.upload(floorPlan, `${name()}-planta`), caption: 'Planta', position: 999, is_floor_plan: true });
    }
    if (inserts.length) fail((await this.sb.from('listing_photos').insert(inserts)).error, 'Não foi possível registrar as fotos');
    const gone = (rows ?? []).filter((r) => !kept.has(r.id));
    if (gone.length) {
      fail((await this.sb.from('listing_photos').delete().in('id', gone.map((r) => r.id))).error, 'Não foi possível remover as fotos');
      const rm = await this.sb.storage.from(PHOTOS).remove(gone.flatMap((r) => [r.path, r.thumb_path, r.large_path].filter((x): x is string => !!x)));
      // the listing is already right; a file left behind is only storage to clean up later
      if (rm.error) console.warn('Fotos removidas do anúncio, mas não do storage:', rm.error.message);
    }
  }

  private async removeFiles(orgId: string, id: string): Promise<void> {
    const { data: files, error } = await this.sb.storage.from(PHOTOS).list(`${orgId}/${id}`);
    if (error) return console.warn('Não foi possível listar as fotos para apagar:', error.message);
    if (files?.length) {
      const rm = await this.sb.storage.from(PHOTOS).remove(files.map((f) => `${orgId}/${id}/${f.name}`));
      if (rm.error) console.warn('Não foi possível apagar as fotos do storage:', rm.error.message);
    }
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

  /** "Excluir": to the trash (out of the site at once; restorable for 30 days). */
  async trashListing(id: string): Promise<void> {
    const { data, error } = await this.sb.from('listings').update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id');
    fail(error, 'Não foi possível excluir');
    if (!data?.length) throw new Error('Não foi possível excluir: sem permissão.');
  }

  async restoreListing(id: string): Promise<void> {
    const { data, error } = await this.sb.from('listings').update({ deleted_at: null }).eq('id', id).select('id');
    fail(error, 'Não foi possível restaurar');
    if (!data?.length) throw new Error('Não foi possível restaurar: sem permissão.');
  }

  /** Deletes for good: photos from storage, then the listing. */
  async purgeListing(id: string, orgId: string): Promise<void> {
    await this.removeFiles(orgId, id);
    const { data, error } = await this.sb.from('listings').delete().eq('id', id).select('id');
    fail(error, 'Não foi possível excluir');
    if (!data?.length) throw new Error('Não foi possível excluir: sem permissão.');
  }

  async trash(orgId: string): Promise<TrashItem[]> {
    const { data, error } = await this.sb.from('listing_trash').select('*').eq('org_id', orgId).order('deleted_at', { ascending: false });
    fail(error, 'Não foi possível ler a lixeira');
    return (data ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      createdBy: r.created_by,
      deletedAt: r.deleted_at,
      deletedByName: r.deleted_by_name,
      purgeAt: r.purge_at,
    }));
  }

  /** Files of listings removed by the daily clean-up (the database cannot delete from storage). */
  async cleanupOrphans(orgId: string): Promise<number> {
    const { data } = await this.sb.from('storage_orphans').select('id, path').eq('org_id', orgId).limit(500);
    if (!data?.length) return 0;
    const rm = await this.sb.storage.from(PHOTOS).remove(data.map((o) => o.path));
    if (rm.error) return 0;
    await this.sb.from('storage_orphans').delete().in('id', data.map((o) => o.id));
    return data.length;
  }

  /** A page of the client's audit log, newest first (admins and support). */
  async audit(orgId: string, before?: number): Promise<AuditEntry[]> {
    const { data, error } = await this.sb.rpc('org_audit', { p_org: orgId, p_before: before ?? null, p_limit: 30 });
    fail(error, 'Não foi possível ler o histórico');
    return (data ?? []) as AuditEntry[];
  }

  // ---------------------------------------------------------------- leads

  /** Visitor's message from the listing panel; the broker is told by e-mail (edge function notify-lead). */
  async submitLead(listingId: string, l: LeadInput): Promise<void> {
    const { data, error } = await this.sb.rpc('submit_lead', {
      p_listing: listingId,
      p_source: 'form',
      p_name: l.name,
      p_email: l.email || null,
      p_phone: l.phone || null,
      p_message: l.message,
      p_consent: true,
      p_consent_text: l.consentText,
      p_trap: l.trap || null,
    });
    fail(error, 'Não foi possível enviar');
    // the e-mail is a bonus: the lead is already saved and shows up in Minha conta → Contatos
    void this.sb.functions.invoke('notify-lead', { body: { lead_id: data } }).catch(() => {});
  }

  /** Records a click on "Conversar no WhatsApp" (no personal data: the conversation happens in WhatsApp). */
  whatsappClick(listingId: string): void {
    void this.sb.rpc('submit_lead', { p_listing: listingId, p_source: 'whatsapp' }).then(() => {}, () => {});
  }

  async leads(orgId: string): Promise<Lead[]> {
    const { data, error } = await this.sb.from('leads').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200);
    fail(error, 'Não foi possível ler os contatos');
    return (data ?? []).map((r) => ({
      id: r.id,
      listingId: r.listing_id,
      listingTitle: r.listing_title,
      assignedTo: r.assigned_to,
      source: r.source,
      details: r.details ?? null,
      name: r.name,
      email: r.email,
      phone: r.phone,
      message: r.message,
      status: r.status,
      notes: r.notes,
      createdAt: r.created_at,
    }));
  }

  async updateLead(id: string, patch: { status?: LeadStatus; notes?: string; assignedTo?: string | null }): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.status) row.status = patch.status;
    if (patch.notes !== undefined) row.notes = patch.notes;
    if (patch.assignedTo !== undefined) row.assigned_to = patch.assignedTo;
    const { data, error } = await this.sb.from('leads').update(row).eq('id', id).select('id');
    fail(error, 'Não foi possível salvar o contato');
    if (!data?.length) throw new Error('Não foi possível salvar o contato: sem permissão.');
  }

  /** Deletes a lead for good (a visitor's request to erase their data, LGPD); administrators only. */
  async deleteLead(id: string): Promise<void> {
    const { data, error } = await this.sb.from('leads').delete().eq('id', id).select('id');
    fail(error, 'Não foi possível excluir o contato');
    if (!data?.length) throw new Error('Só administradores excluem contatos.');
  }

  /** Form leads waiting for the user (theirs, or unassigned for admins). */
  async newLeadsCount(orgId: string): Promise<number> {
    const { data } = await this.sb.rpc('my_new_leads', { p_org: orgId });
    return typeof data === 'number' ? data : 0;
  }

  async userId(): Promise<string | null> {
    return (await this.session())?.user.id ?? null;
  }

  /** Price histories (visible to the listing's client only), oldest first. */
  // ---------------------------------------------------------------- client's site

  /** The client whose site is open: by its own domain, or by slug (?imobiliaria=). */
  async siteOrg(by: { slug?: string; host?: string }): Promise<SiteOrg | null> {
    let q = this.sb.from('organizations').select('id, name, slug, creci, custom_domain, branding');
    if (by.slug) q = q.eq('slug', by.slug.toLowerCase());
    else if (by.host) q = q.eq('custom_domain', by.host.toLowerCase().replace(/^www\./, ''));
    else return null;
    const { data, error } = await q.maybeSingle();
    fail(error, 'Não foi possível ler a imobiliária');
    return data ? { id: data.id, name: data.name, slug: data.slug, creci: data.creci, customDomain: data.custom_domain, branding: data.branding } : null;
  }

  /** Published listings of one client (what its site shows). */
  async publicListingsOf(orgId: string): Promise<Listing[]> {
    const { data, error } = await this.sb.from('public_listings').select('*').eq('org_id', orgId);
    fail(error, 'Não foi possível carregar os anúncios');
    const rows = (data ?? []) as ListingRow[];
    const photos = await this.photosFor(rows.map((r) => r.id));
    return rows.map((r) => rowToListing(r, photos, this.photoUrl, false));
  }

  /** Saves the site configuration (owners and admins; the database checks the size and the fields). */
  async saveSiteConfig(orgId: string, config: unknown): Promise<void> {
    const { error } = await this.sb.from('organizations').update({ branding: config }).eq('id', orgId);
    fail(error, 'Não foi possível salvar o site');
  }

  /** Uploads a logo or banner (data URL prepared by the editor); returns its public URL. */
  async uploadSiteImage(orgId: string, dataUrl: string, kind: 'logo' | 'capa' | 'sobre'): Promise<string> {
    const blob = dataUrlToBlob(dataUrl);
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${orgId}/${kind}-${Date.now().toString(36)}.${ext}`;
    const up = await this.sb.storage.from(SITE_ASSETS).upload(path, blob, { contentType: blob.type });
    fail(up.error, 'Não foi possível enviar a imagem');
    return this.sb.storage.from(SITE_ASSETS).getPublicUrl(path).data.publicUrl;
  }

  /** Contact page or "Anunciar imóvel" form of the site (no listing). */
  async submitSiteLead(orgId: string, source: 'contact' | 'owner', l: LeadInput, details: Record<string, string> = {}): Promise<void> {
    const { data, error } = await this.sb.rpc('submit_site_lead', {
      p_org: orgId,
      p_source: source,
      p_name: l.name,
      p_email: l.email || null,
      p_phone: l.phone || null,
      p_message: l.message,
      p_details: details,
      p_consent: true,
      p_consent_text: l.consentText,
      p_trap: l.trap || null,
    });
    fail(error, 'Não foi possível enviar');
    void this.sb.functions.invoke('notify-lead', { body: { lead_id: data } }).catch(() => {});
  }

  /** Whether the logged-in user may edit this client's site (owner, admin or platform support). */
  async canEditSite(orgId: string): Promise<boolean> {
    if (!(await this.session())) return false;
    return (await this.myOrgs()).some((o) => o.id === orgId && (o.role === 'owner' || o.role === 'admin'));
  }

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
export { backendConfig } from './config';
