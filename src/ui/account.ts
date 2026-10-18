import {
  LEAD_STATUS_LABELS,
  type Invitation,
  type LeadFilter,
  type ListingFilter,
  type ListingTableRow,
  type ListingFeed,
  type ListingStats,
  type ExclusivityItem,
  type Lead,
  type LeadStatus,
  type Member,
  type MfaState,
  type Org,
  type PendingInvitation,
  type RemoteBackend,
  type Role,
  type TotpSetup,
  type TrashItem,
} from '../backend/remote';
import { whatsappLink } from '../data/listingText';
import { captchaBox, formCaptcha } from '../backend/captcha';
import { actorLabel, describeAudit, type AuditEntry } from '../backend/audit';
import { leadsCsv, statsCsv } from '../backend/leadsCsv';
import { parseUnitsCsv, unitsCsv } from '../backend/unitsCsv';
import { AVAILABILITIES, AVAILABILITY_LABELS, HIGHLIGHTS, HIGHLIGHT_LABELS, TYPE_LABELS, type Availability, type Highlight } from '../data/types';
import { escapeHtml, formatBRL } from '../utils/format';

/** "Imobiliária Exemplo Ltda." → "imobiliaria-exemplo-ltda" (address of the client's site). */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
}

/** Invitation link sent by the admin (e-mail, WhatsApp): opens the site with the account panel. */
export const inviteLink = (token: string) => `${location.origin}${location.pathname}?convite=${token}`;

export const ROLE_LABELS: Record<Role, string> = { owner: 'dono', admin: 'administrador', agent: 'corretor' };
const ORG_KEY = 'mapa3d:org';

/** Roles `me` may give to someone: only owners (and the support staff, who act as owners) create owners. */
const assignable = (me: Role): Role[] => (me === 'owner' ? ['agent', 'admin', 'owner'] : me === 'admin' ? ['agent', 'admin'] : []);

/** The management page (painel.html): the account, the listings and the contacts without the 3D map. */
export const panelUrl = () => new URL(`${import.meta.env.BASE_URL}painel.html`, location.href).href;

/** Saves a text file the browser builds (the contacts spreadsheet). */
function download(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Login, invitations and the client ("imobiliária") the user works for; the client's listings and contacts; team
 * management for owners and admins; new clients for the platform's support staff. Only shown when a back end is
 * configured. With no toggle button it is the whole page (painel.html): always open, nothing to close.
 */
export class AccountPanel {
  private orgs: Org[] = [];
  private org: Org | null = null;
  private email: string | null = null;
  private userId: string | null = null;
  /** Support powers (on the team, in a session confirmed with the second factor). */
  private staff = false;
  /** On the support team, whether or not this session has the powers. */
  private staffMember = false;
  private mfa: MfaState = { enabled: false, pending: false, factorId: null };
  /** Authenticator app being set up: QR code shown, waiting for its first code. */
  private totpSetup: TotpSetup | null = null;
  /** Collapsible sections the user left open (kept across re-renders). */
  private openSections = new Set<string>();
  private pending: PendingInvitation[] = [];
  /** Token from an invitation link (?convite=…), until it is accepted. */
  private linkToken: string | null = new URLSearchParams(location.search).get('convite');
  private linkInfo: Awaited<ReturnType<RemoteBackend['invitationInfo']>> = null;
  private mode: 'signin' | 'signup' = 'signin';
  /** Form leads waiting for the user (shown on the account button). */
  private newLeads = 0;
  /** The client keeps sales mirrors (developments) in the back end. */
  private hasDevelopments = false;
  private leadTimer: number | null = null;
  /** Opens a listing on the map (from a lead). */
  openListing: (id: string) => void = () => {};
  private note = '';
  private isOpen = false;
  /** Filters of "Contatos" and "Meus anúncios" (kept across re-renders). */
  private leadFilter: LeadFilter = {};
  private listingFilter: ListingFilter = {};
  /** Period of "Desempenho dos anúncios", in days. */
  private statsDays = 30;
  /** The team, for the "Responsável" of the contacts (administrators only). */
  private teamMembers: Member[] = [];
  /** Latest request of each list: an older answer arriving late is dropped. */
  private loads = new Map<string, number>();

  constructor(
    private el: HTMLElement,
    private toggle: HTMLButtonElement | null,
    private backend: RemoteBackend,
    /** Called after login, logout or a change of client: reload what the user may edit. */
    private onChange: () => void,
  ) {
    if (toggle) {
      toggle.hidden = false;
      toggle.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
      document.addEventListener('keydown', (e) => {
        if (this.isOpen && e.key === 'Escape') this.close();
      });
    } else {
      // the page: open from the start, with the day-to-day lists unfolded
      this.isOpen = true;
      el.hidden = false;
      this.openSections = new Set(['listings', 'leads']);
    }
    backend.onAuthChange(() => void this.refresh(true));
  }

  get currentOrg(): Org | null {
    return this.org;
  }
  /** The user's role in a client (null: not in its team). */
  roleIn(orgId: string): Org['role'] | null {
    return this.orgs.find((o) => o.id === orgId)?.role ?? null;
  }
  get loggedIn(): boolean {
    return this.email !== null;
  }

  /** Reads the session, the user's clients and invitations. `notify`: tell the app when something changed. */
  async refresh(notify = false): Promise<void> {
    const session = await this.backend.session();
    const before = `${this.email}|${this.org?.id}`;
    this.email = session?.user.email ?? null;
    this.userId = session?.user.id ?? null;
    this.mfa = this.email ? await this.backend.mfa() : { enabled: false, pending: false, factorId: null };
    if (!this.email) this.totpSetup = null;
    // password only, with two-step verification on: nothing of the account until the code (the database agrees)
    [this.orgs, this.staff, this.pending, this.staffMember] =
      this.email && !this.mfa.pending
        ? await Promise.all([this.backend.myOrgs(), this.backend.isStaff(), this.backend.myInvitations(), this.backend.staffMember()])
        : [[], false, [], false];
    if (this.linkToken && !this.linkInfo) this.linkInfo = await this.backend.invitationInfo(this.linkToken);
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(ORG_KEY);
    } catch {
      // storage blocked: the first client is used
    }
    this.org = this.orgs.find((o) => o.id === saved) ?? this.orgs[0] ?? null;
    this.newLeads = this.org ? await this.backend.newLeadsCount(this.org.id) : 0;
    this.hasDevelopments = this.org ? (await this.backend.teamDevelopments(this.org.id).catch(() => [])).length > 0 : false;
    if (!this.org && this.leadTimer !== null) {
      clearInterval(this.leadTimer);
      this.leadTimer = null;
    }
    this.renderToggle();
    // new leads every minute while logged in
    if (this.org && this.leadTimer === null)
      this.leadTimer = window.setInterval(async () => {
        if (!this.org) return;
        const n = await this.backend.newLeadsCount(this.org.id);
        if (n !== this.newLeads) {
          this.newLeads = n;
          this.renderToggle();
          if (this.isOpen && this.openSections.has('leads')) void this.loadSection('leads');
        }
      }, 60_000);
    // files of listings the daily clean-up removed (the database cannot delete from storage); administrators only
    if (this.org?.role === 'owner' || this.org?.role === 'admin') void this.backend.cleanupOrphans(this.org.id).catch(() => {});
    if (this.isOpen) await this.render();
    if (notify && before !== `${this.email}|${this.org?.id}`) this.onChange();
  }

  private renderToggle(): void {
    if (!this.toggle) return;
    const label = this.email ? (this.org?.name ?? 'Minha conta') : 'Entrar';
    this.toggle.textContent = label;
    if (this.newLeads > 0) {
      const badge = document.createElement('span');
      badge.className = 'lead-badge';
      badge.textContent = String(this.newLeads);
      badge.setAttribute('aria-label', `${this.newLeads} ${this.newLeads === 1 ? 'contato novo' : 'contatos novos'}`);
      this.toggle.append(' ', badge);
    }
  }

  /** Opens the panel by itself when the page was opened from an invitation link. */
  async openFromLink(): Promise<void> {
    if (!this.linkToken) return;
    const i = this.linkInfo;
    if (!i) return this.open('Este link de convite não é válido. Peça um novo a quem convidou você.');
    if (i.accepted) return this.open('Este convite já foi usado.');
    if (i.expired) return this.open('Este convite expirou. Peça um novo a quem convidou você.');
    if (!this.email) {
      this.mode = 'signup';
      this.open(`Convite da ${i.orgName} para ${i.email}, como ${ROLE_LABELS[i.role]}. Crie sua conta com esse e-mail (ou entre, se já tiver uma).`);
      const input = this.el.querySelector<HTMLInputElement>('input[name="email"]');
      if (input) input.value = i.email;
      return;
    }
    this.open();
  }

  open(note = ''): void {
    this.note = note;
    this.isOpen = true;
    this.el.hidden = false;
    this.toggle?.setAttribute('aria-expanded', 'true');
    void this.render().then(() => this.el.querySelector<HTMLElement>('input, select, button.btn-primary')?.focus());
  }

  close(): void {
    if (!this.isOpen || !this.toggle) return;
    this.isOpen = false;
    this.el.hidden = true;
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.focus();
  }

  // ---------------------------------------------------------------- rendering

  private async render(): Promise<void> {
    const head = `<div class="add-head"><h2 id="account-title">${this.email ? (this.toggle ? 'Minha conta' : 'Gestão') : 'Entrar'}</h2>
      ${this.toggle ? '<button type="button" class="icon-btn" data-action="close" aria-label="Fechar">×</button>' : ''}</div>
      ${this.note ? `<p class="account-note" role="status">${escapeHtml(this.note)}</p>` : ''}`;
    if (!this.email) return this.renderLogin(head);
    if (this.mfa.pending) return this.renderCode(head);

    const canManage = this.org?.role === 'owner' || this.org?.role === 'admin';
    const [members, invites] = this.org && canManage
      ? await Promise.all([this.backend.members(this.org.id), this.backend.invitations(this.org.id)])
      : [[], []];
    // the support team's queue; a failure here must not hide the rest of the panel
    const queue = this.staff ? await this.backend.exclusivityQueue().catch(() => null) : [];
    // the invitation from the link, when it is for this account and not in the list yet
    let offers = [...this.pending];
    const link = this.linkInfo;
    if (this.linkToken && link && !link.accepted && !link.expired)
      offers = [
        { token: this.linkToken, orgId: '', orgName: link.orgName, role: link.role },
        ...offers.filter((p) => p.orgName !== link.orgName || p.role !== link.role),
      ];

    this.el.innerHTML = `${head}
      <p class="muted small">Conectado como ${escapeHtml(this.email)}${this.staff ? ' · <strong>suporte da plataforma</strong>' : ''}</p>
      ${
        this.staffMember && !this.staff
          ? '<p class="account-note" role="status">Você é da equipe de suporte da plataforma. Para atender as imobiliárias, ative a verificação em duas etapas abaixo: ela é obrigatória para a equipe.</p>'
          : ''
      }
      ${offers.length ? this.offersHtml(offers) : ''}
      ${this.org ? this.orgHtml() : offers.length ? '' : `<p class="account-empty">Sua conta ainda não está ligada a nenhuma imobiliária.
        Peça o link de convite ao administrador da sua imobiliária.</p>`}
      ${this.org ? this.sectionHtml('listings', 'Meus anúncios') : ''}
      ${this.org ? this.sectionHtml('stats', 'Desempenho dos anúncios') : ''}
      ${this.org ? this.sectionHtml('leads', `Contatos${this.newLeads ? ` <span class="lead-badge">${this.newLeads} ${this.newLeads === 1 ? 'novo' : 'novos'}</span>` : ''}`) : ''}
      ${this.org && this.hasDevelopments ? this.sectionHtml('mirror', 'Espelho de vendas') : ''}
      ${this.org ? this.sectionHtml('trash', 'Lixeira') : ''}
      ${this.org && canManage ? this.teamHtml(members, invites) : ''}
      ${this.org && canManage ? this.sectionHtml('feed', 'Importação automática (XML)') : ''}
      ${this.org && canManage ? this.sectionHtml('audit', 'Histórico de alterações') : ''}
      ${this.staff ? this.staffHtml() + this.exclusivityHtml(queue) : ''}
      ${canManage || this.staffMember || this.mfa.enabled ? this.mfaHtml() : ''}
      <div class="a-actions account-signout"><button type="button" class="btn-secondary" data-action="signout">Sair</button></div>`;
    this.teamMembers = members;
    this.bindClose();
    this.bindLoggedIn(members);
    this.bindExclusivity(queue ?? []);
    this.bindMfa();
    this.bindSections();
  }

  /** Second step of the login, for accounts with two-step verification: the code of the authenticator app. */
  private renderCode(head: string): void {
    // already on screen: the login event refreshes the panel a second time, and the code being typed must stay
    if (this.el.querySelector<HTMLFormElement>('form[data-form="mfa"]')?.dataset.email === this.email) return;
    this.el.innerHTML = `${head}
      <form class="add-form account-form" data-form="mfa" data-email="${escapeHtml(this.email!)}" novalidate>
        <p class="a-hint a-wide">Verificação em duas etapas de ${escapeHtml(this.email!)}: digite o código de 6 dígitos que aparece agora no aplicativo autenticador.</p>
        <label class="a-field a-wide">Código<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
        <p class="a-error a-wide" role="alert" hidden></p>
        <div class="a-actions a-wide">
          <button type="submit" class="btn-primary">Confirmar</button>
          <button type="button" class="link-btn" data-action="signout">Sair</button>
        </div>
      </form>`;
    this.bindClose();
    this.el.querySelector('[data-action="signout"]')!.addEventListener('click', () => void this.signOut());
    this.bindForm('mfa', async (fd) => {
      const code = String(fd.get('code') ?? '').replace(/\D/g, '');
      if (code.length !== 6) throw new Error('O código tem 6 dígitos.');
      await this.backend.verifyMfa(code);
      this.note = '';
      await this.refresh(true);
    });
  }

  /** Two-step verification: required for the support team, optional for owners and admins. */
  private mfaHtml(): string {
    const setup = this.totpSetup;
    const body = this.mfa.enabled
      ? `<p class="a-hint">Ativada: ao entrar, além da senha, a conta pede o código do aplicativo autenticador.</p>
        <button type="button" class="link-btn btn-danger-text" data-action="mfa-off">Desativar</button>`
      : setup
        ? `<p class="a-hint">No aplicativo autenticador do celular (Google Authenticator, Microsoft Authenticator, 1Password…), leia o QR code ou digite a chave. Depois, digite o código de 6 dígitos que ele mostrar.</p>
          <div class="mfa-setup"><img src="${escapeHtml(setup.qrCode)}" alt="QR code para o aplicativo autenticador" width="168" height="168">
            <label class="a-field">Chave<input name="totp-secret" readonly value="${escapeHtml(setup.secret)}" aria-label="Chave para digitar no aplicativo"></label></div>
          <form class="add-form account-form" data-form="mfa-confirm" novalidate>
            <label class="a-field">Código do aplicativo<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
            <p class="a-error a-wide" role="alert" hidden></p>
            <div class="a-actions a-wide">
              <button type="submit" class="btn-primary">Confirmar e ativar</button>
              <button type="button" class="link-btn" data-action="mfa-cancel">Cancelar</button>
            </div>
          </form>`
        : `<p class="a-hint">Protege a conta mesmo se a senha vazar: ao entrar, além dela, a conta pede um código de 6 dígitos de um aplicativo autenticador no celular.</p>
          <button type="button" class="btn-secondary" data-action="mfa-on">Ativar</button>`;
    return `<section class="account-section" data-section-mfa><h3>Verificação em duas etapas</h3>${body}</section>`;
  }

  private bindMfa(): void {
    const el = this.el;
    el.querySelector<HTMLButtonElement>('[data-action="mfa-on"]')?.addEventListener('click', (e) =>
      this.act(e.currentTarget as HTMLButtonElement, async () => {
        this.totpSetup = await this.backend.enrollTotp();
        this.note = '';
        await this.render();
        this.el.querySelector<HTMLInputElement>('form[data-form="mfa-confirm"] input[name="code"]')?.focus();
      }),
    );
    el.querySelector('[data-action="mfa-cancel"]')?.addEventListener('click', () => {
      this.totpSetup = null;
      void this.render();
    });
    this.bindForm('mfa-confirm', async (fd) => {
      const code = String(fd.get('code') ?? '').replace(/\D/g, '');
      if (code.length !== 6) throw new Error('O código tem 6 dígitos.');
      await this.backend.confirmTotp(this.totpSetup!.factorId, code);
      this.totpSetup = null;
      this.note = 'Verificação em duas etapas ativada. Nas próximas vezes, a conta vai pedir o código do aplicativo ao entrar.';
      await this.refresh(true);
    });
    el.querySelector<HTMLButtonElement>('[data-action="mfa-off"]')?.addEventListener('click', (e) => {
      const warn = this.staffMember ? ' Na equipe de suporte, os poderes de suporte deixam de valer.' : '';
      if (!window.confirm(`Desativar a verificação em duas etapas? A conta volta a entrar só com a senha.${warn}`)) return;
      void this.act(e.currentTarget as HTMLButtonElement, async () => {
        await this.backend.removeTotp(this.mfa.factorId!);
        this.note = 'Verificação em duas etapas desativada.';
        await this.refresh(true);
      });
    });
  }

  private async signOut(): Promise<void> {
    await this.backend.signOut();
    this.note = '';
    this.totpSetup = null;
    await this.refresh(true);
  }

  /** Re-reads the trash after a listing was moved there from the listing panel. */
  refreshTrash(): void {
    if (this.isOpen && this.openSections.has('trash')) void this.loadSection('trash');
  }

  private sectionHtml(key: string, title: string): string {
    return `<details class="account-section" data-section="${key}" ${this.openSections.has(key) ? 'open' : ''}>
      <summary>${title}</summary><div class="section-body"><p class="muted small">Carregando…</p></div></details>`;
  }

  private bindSections(): void {
    this.el.querySelectorAll<HTMLDetailsElement>('details[data-section]').forEach((d) => {
      const key = d.dataset.section!;
      d.addEventListener('toggle', () => {
        if (d.open) {
          this.openSections.add(key);
          void this.loadSection(key);
        } else this.openSections.delete(key);
      });
      if (d.open) void this.loadSection(key);
    });
  }

  private async loadSection(key: string, more = false): Promise<void> {
    const body = this.el.querySelector<HTMLElement>(`details[data-section="${key}"] .section-body`);
    if (!body || !this.org) return;
    try {
      if (key === 'trash') this.renderTrash(body, await this.backend.trash(this.org.id));
      else if (key === 'leads') await this.loadLeads(body, more);
      else if (key === 'listings') await this.loadListings(body, more);
      else if (key === 'stats') await this.loadStats(body, more);
      else if (key === 'feed') this.renderFeed(body, await this.backend.listingFeed(this.org.id));
      else if (key === 'mirror') await this.loadMirror(body);
      else {
        const list = body.querySelector<HTMLElement>('.audit-list');
        const last = more && list ? Number(list.dataset.last) : undefined;
        this.renderAudit(body, await this.backend.audit(this.org.id, last), more);
      }
    } catch (ex) {
      body.innerHTML = `<p class="a-error">${escapeHtml((ex as Error).message)}</p>`;
    }
  }

  /** Starts a list request; `current()` says whether it is still the latest one of that list. */
  private ticket(key: string): () => boolean {
    const n = (this.loads.get(key) ?? 0) + 1;
    this.loads.set(key, n);
    return () => this.loads.get(key) === n;
  }

  /** Filter form of a list: changes reload the list from the start (typing waits a moment). */
  private bindFilter(body: HTMLElement, key: string, apply: (fd: FormData) => void): void {
    const form = body.querySelector<HTMLFormElement>(`form[data-filter="${key}"]`)!;
    let timer: number | undefined;
    const reload = () => {
      apply(new FormData(form));
      void this.loadSection(key);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      reload();
    });
    form.addEventListener('change', reload);
    form.querySelector('input[type="search"]')?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(reload, 350);
    });
  }

  /** "Contatos": the messages, a page at a time, with a filter and the spreadsheet of what the filter shows. */
  private async loadLeads(body: HTMLElement, more: boolean): Promise<void> {
    const org = this.org!;
    const admin = org.role === 'owner' || org.role === 'admin';
    const current = this.ticket('leads');
    if (!body.querySelector('form[data-filter="leads"]')) {
      const f = this.leadFilter;
      const statuses = (Object.keys(LEAD_STATUS_LABELS) as LeadStatus[])
        .map((k) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${LEAD_STATUS_LABELS[k]}</option>`)
        .join('');
      body.innerHTML = `${admin ? '<p class="a-hint">Você vê os contatos de todos os corretores. Cada corretor vê os dos próprios anúncios.</p>' : ''}
        <p class="a-hint" data-clicks hidden></p>
        <form class="list-filter" data-filter="leads" role="search" novalidate>
          <label class="a-field">Situação<select name="status"><option value="">Todas</option>
            <option value="open" ${f.status === 'open' ? 'selected' : ''}>Em aberto</option>${statuses}</select></label>
          <label class="a-field">Buscar<input name="q" type="search" value="${escapeHtml(f.q ?? '')}" placeholder="nome, e-mail, telefone, anúncio"></label>
        </form>
        <p class="list-count muted small" role="status"></p>
        <ul class="lead-list"></ul>
        <div class="list-actions">
          <button type="button" class="btn-secondary" data-action="more" hidden>Ver mais</button>
          <button type="button" class="link-btn" data-action="export">Baixar planilha (CSV)</button>
        </div>`;
      this.bindFilter(body, 'leads', (fd) => (this.leadFilter = { status: String(fd.get('status') ?? '') as LeadFilter['status'], q: String(fd.get('q') ?? '') }));
      body.querySelector('[data-action="more"]')!.addEventListener('click', () => void this.loadSection('leads', true));
      const exportBtn = body.querySelector<HTMLButtonElement>('[data-action="export"]')!;
      exportBtn.addEventListener('click', () =>
        this.act(exportBtn, async () => {
          const all = await this.backend.allLeads(org.id, this.leadFilter);
          download(leadsCsv(all, this.teamMembers), `contatos-${org.slug}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
        }),
      );
    }
    const list = body.querySelector<HTMLElement>('.lead-list')!;
    const offset = more ? list.children.length : 0;
    const [page, clicks] = await Promise.all([this.backend.leads(org.id, this.leadFilter, offset), more ? null : this.backend.whatsappClicks(org.id)]);
    if (!current()) return;
    if (clicks !== null) {
      const p = body.querySelector<HTMLElement>('[data-clicks]')!;
      p.hidden = !clicks;
      p.textContent = `${clicks} ${clicks === 1 ? 'clique' : 'cliques'} no WhatsApp dos anúncios (a conversa segue no WhatsApp).`;
    }
    const html = page.leads.map((l) => this.leadHtml(l, this.teamMembers, admin)).join('');
    if (more) list.insertAdjacentHTML('beforeend', html);
    else list.innerHTML = html;
    list.querySelectorAll<HTMLElement>('li[data-lead]:not([data-bound])').forEach((li) => this.bindLead(li));
    const filtered = !!(this.leadFilter.status || this.leadFilter.q?.trim());
    body.querySelector('.list-count')!.textContent = page.total
      ? `${page.total} ${page.total === 1 ? 'contato' : 'contatos'}${filtered ? ' com esse filtro' : ''}${list.children.length < page.total ? `, mostrando ${list.children.length}` : ''}.`
      : filtered
        ? 'Nenhum contato com esse filtro.'
        : 'Nenhuma mensagem ainda. Os contatos enviados pelos anúncios e pelo site aparecem aqui e chegam por e-mail.';
    body.querySelector<HTMLElement>('[data-action="more"]')!.hidden = list.children.length >= page.total;
    body.querySelector<HTMLElement>('[data-action="export"]')!.hidden = !page.total;
  }

  private leadHtml(l: Lead, members: Member[], admin: boolean): string {
    const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const DETAIL_LABELS: Record<string, string> = { finalidade: 'Quer', tipo: 'Tipo', bairro: 'Bairro', valor: 'Valor pretendido', area: 'Área', quartos: 'Quartos', assunto: 'Assunto', visita: 'Visita pedida', horario: 'Horário' };
    const origin = (l: Lead) =>
      l.source === 'owner'
        ? '<span class="lead-origin">Quer anunciar um imóvel (pelo site)</span>'
        : l.source === 'contact'
          ? '<span class="lead-origin">Contato pelo site</span>'
          : `<button type="button" class="link-btn lead-listing" data-open="${l.listingId ?? ''}" ${l.listingId ? '' : 'disabled'}>${escapeHtml(l.listingTitle ?? 'anúncio removido')}</button>`;
    const statusOptions = (cur: LeadStatus) =>
      (Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((k) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${LEAD_STATUS_LABELS[k]}</option>`).join('');
    const wa = l.phone ? whatsappLink(l.phone, `Olá, ${l.name?.split(' ')[0] ?? ''}! Aqui é da ${this.org!.name}, sobre ${
                  l.source === 'owner' ? 'o imóvel que você quer anunciar' : l.source === 'contact' ? 'sua mensagem pelo site' : `"${l.listingTitle ?? 'o imóvel'}"`
                }.`) : null;
                return `<li class="lead-item status-${l.status}" data-lead="${l.id}">
                  <div class="lead-head"><strong>${escapeHtml(l.name ?? 'Sem nome')}</strong><time>${when(l.createdAt)}</time></div>
                  ${origin(l)}
                  ${
                    l.details && Object.keys(l.details).length
                      ? `<dl class="lead-details">${Object.entries(l.details)
                          .map(([k, v]) => `<div><dt>${escapeHtml(DETAIL_LABELS[k] ?? k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`)
                          .join('')}</dl>`
                      : ''
                  }
                  ${l.message ? `<p class="lead-msg">${escapeHtml(l.message)}</p>` : ''}
                  <p class="lead-contact">
                    ${wa ? `<a href="${escapeHtml(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
                    ${l.phone ? `<a href="tel:${escapeHtml(l.phone)}">${escapeHtml(l.phone)}</a>` : ''}
                    ${l.email ? `<a href="mailto:${escapeHtml(l.email)}">${escapeHtml(l.email)}</a>` : ''}
                  </p>
                  <div class="lead-controls">
                    <label class="a-field">Situação<select name="status">${statusOptions(l.status)}</select></label>
                    ${
                      admin
                        ? `<label class="a-field">Responsável<select name="assigned"><option value="">—</option>${members
                            .map((m) => `<option value="${m.userId}" ${m.userId === l.assignedTo ? 'selected' : ''}>${escapeHtml(m.name || m.email || '')}</option>`)
                            .join('')}</select></label>`
                        : ''
                    }
                  </div>
                  <label class="a-field">Anotações<textarea name="notes" rows="2" maxlength="4000" placeholder="Retornar, visita marcada…">${escapeHtml(l.notes ?? '')}</textarea></label>
                  ${admin ? `<button type="button" class="link-btn btn-danger-text" data-delete-lead="${l.id}">Excluir (pedido do cliente, LGPD)</button>` : ''}
                </li>`;
  }

  private bindLead(li: HTMLElement): void {
    li.dataset.bound = '';
    const save = async (patch: Parameters<RemoteBackend['updateLead']>[1]) => {
      try {
        await this.backend.updateLead(li.dataset.lead!, patch);
        li.classList.add('saved');
        setTimeout(() => li.classList.remove('saved'), 1200);
        if (patch.status) {
          li.className = li.className.replace(/status-\w+/, `status-${patch.status}`);
          this.newLeads = await this.backend.newLeadsCount(this.org!.id);
          this.renderToggle();
        }
      } catch (ex) {
        window.alert((ex as Error).message);
      }
    };
    li.querySelector<HTMLSelectElement>('select[name="status"]')!.addEventListener('change', (e) =>
      save({ status: (e.target as HTMLSelectElement).value as LeadStatus }),
    );
    li.querySelector<HTMLSelectElement>('select[name="assigned"]')?.addEventListener('change', (e) =>
      save({ assignedTo: (e.target as HTMLSelectElement).value || null }),
    );
    const notes = li.querySelector<HTMLTextAreaElement>('textarea[name="notes"]')!;
    notes.addEventListener('change', () => save({ notes: notes.value }));
    li.querySelector<HTMLButtonElement>('[data-open]')?.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLButtonElement).dataset.open;
      if (id) {
        this.close();
        this.openListing(id);
      }
    });
    li.querySelector<HTMLButtonElement>('[data-delete-lead]')?.addEventListener('click', async () => {
      if (!window.confirm('Excluir este contato e os dados do cliente? Use quando a pessoa pedir a exclusão (LGPD).')) return;
      try {
        await this.backend.deleteLead(li.dataset.lead!);
        li.remove();
      } catch (ex) {
        window.alert((ex as Error).message);
      }
    });
  }

  /** "Meus anúncios": the client's listings with their state, published or draft, and the quick actions. */
  /** "Desempenho dos anúncios": views (map and site), WhatsApp clicks and messages of each listing in the period. */
  private async loadStats(body: HTMLElement, more: boolean): Promise<void> {
    const org = this.org!;
    const current = this.ticket('stats');
    if (!body.querySelector('form[data-filter="stats"]')) {
      body.innerHTML = `<form class="list-filter stats-filter" data-filter="stats" novalidate>
          <label class="a-field">Período<select name="days">${[7, 30, 90, 365]
            .map((d) => `<option value="${d}" ${d === this.statsDays ? 'selected' : ''}>${d === 365 ? 'Último ano' : `Últimos ${d} dias`}</option>`)
            .join('')}</select></label>
        </form>
        <p class="stats-total" role="status"></p>
        <div class="stats-wrap"><table class="stats-table">
          <thead><tr><th scope="col">Anúncio</th><th scope="col" title="Mapa + site da imobiliária">Visualizações</th><th scope="col">WhatsApp</th><th scope="col">Mensagens</th></tr></thead>
          <tbody></tbody></table></div>
        <p class="a-hint">Cada navegador conta uma vez por dia em cada anúncio; as visitas da própria equipe não contam.${
          org.role === 'owner' || org.role === 'admin' ? '' : ' Você vê os seus anúncios.'
        }</p>
        <div class="list-actions">
          <button type="button" class="btn-secondary" data-action="more" hidden>Ver todos</button>
          <button type="button" class="link-btn" data-action="export">Baixar planilha (CSV)</button>
        </div>`;
      this.bindFilter(body, 'stats', (fd) => (this.statsDays = Number(fd.get('days')) || 30));
      body.querySelector('[data-action="more"]')!.addEventListener('click', () => void this.loadSection('stats', true));
      const exportBtn = body.querySelector<HTMLButtonElement>('[data-action="export"]')!;
      exportBtn.addEventListener('click', () =>
        this.act(exportBtn, async () => {
          const rows = await this.backend.listingStats(org.id, this.statsDays);
          download(statsCsv(rows, this.statsDays), `desempenho-${org.slug}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
        }),
      );
    }
    const rows = await this.backend.listingStats(org.id, this.statsDays);
    if (!current()) return;
    const n = (x: number) => x.toLocaleString('pt-BR');
    const sum = (f: (r: ListingStats) => number) => rows.reduce((a, r) => a + f(r), 0);
    const [map, site, wa, msg] = [sum((r) => r.viewsMap), sum((r) => r.viewsSite), sum((r) => r.whatsapp), sum((r) => r.messages)];
    body.querySelector('.stats-total')!.textContent = rows.length
      ? `${n(map + site)} ${map + site === 1 ? 'visualização' : 'visualizações'} (${n(map)} no mapa, ${n(site)} no site), ${n(wa)} ${
          wa === 1 ? 'clique' : 'cliques'
        } no WhatsApp e ${n(msg)} ${msg === 1 ? 'mensagem' : 'mensagens'}${map + site ? `: ${n(Math.round(((wa + msg) / (map + site)) * 1000) / 10)} contatos a cada 100 visualizações` : ''}.`
      : 'Nenhum anúncio ainda.';
    const shown = more ? rows : rows.slice(0, 20);
    body.querySelector('.stats-table tbody')!.innerHTML = shown
      .map(
        (r) => `<tr${r.published ? '' : ' class="is-draft"'}><th scope="row"><button type="button" class="link-btn" data-open="${escapeHtml(r.id)}">${escapeHtml(r.title)}</button>${
          r.referenceCode ? ` <small class="muted">${escapeHtml(r.referenceCode)}</small>` : ''
        }${r.published ? '' : ' <span class="draft-badge">Rascunho</span>'}</th>
          <td title="${n(r.viewsMap)} no mapa, ${n(r.viewsSite)} no site">${n(r.viewsMap + r.viewsSite)}</td><td>${n(r.whatsapp)}</td><td>${n(r.messages)}</td></tr>`,
      )
      .join('');
    body.querySelectorAll<HTMLButtonElement>('.stats-table [data-open]').forEach((b) => b.addEventListener('click', () => this.openListing(b.dataset.open!)));
    body.querySelector<HTMLElement>('[data-action="more"]')!.hidden = shown.length >= rows.length;
    body.querySelector<HTMLElement>('[data-action="export"]')!.hidden = !rows.length;
  }

  private async loadListings(body: HTMLElement, more: boolean): Promise<void> {
    const org = this.org!;
    const admin = org.role === 'owner' || org.role === 'admin';
    const current = this.ticket('listings');
    if (!body.querySelector('form[data-filter="listings"]')) {
      const f = this.listingFilter;
      const states: [NonNullable<ListingFilter['state']>, string][] = [
        ['', 'Todos'],
        ['published', 'Publicados'],
        ['draft', 'Rascunhos'],
        ['reserved', 'Reservados'],
        ['sold', 'Vendidos'],
      ];
      body.innerHTML = `<form class="list-filter" data-filter="listings" role="search" novalidate>
          <label class="a-field">Mostrar<select name="state">${states
            .map(([v, label]) => `<option value="${v}" ${(f.state ?? '') === v ? 'selected' : ''}>${label}</option>`)
            .join('')}</select></label>
          <label class="a-field">Buscar<input name="q" type="search" value="${escapeHtml(f.q ?? '')}" placeholder="título ou código"></label>
        </form>
        <p class="list-count muted small" role="status"></p>
        <ul class="listing-rows"></ul>
        <div class="list-actions"><button type="button" class="btn-secondary" data-action="more" hidden>Ver mais</button></div>`;
      this.bindFilter(body, 'listings', (fd) => (this.listingFilter = { state: String(fd.get('state') ?? '') as ListingFilter['state'], q: String(fd.get('q') ?? '') }));
      body.querySelector('[data-action="more"]')!.addEventListener('click', () => void this.loadSection('listings', true));
    }
    const list = body.querySelector<HTMLElement>('.listing-rows')!;
    const offset = more ? list.children.length : 0;
    const page = await this.backend.listingsTable(org.id, this.listingFilter, offset);
    if (!current()) return;
    const html = page.rows.map((r) => this.listingRowHtml(r, admin || r.createdBy === this.userId)).join('');
    if (more) list.insertAdjacentHTML('beforeend', html);
    else list.innerHTML = html;
    list.querySelectorAll<HTMLElement>('li[data-listing]:not([data-bound])').forEach((li) => this.bindListingRow(li, page.rows.find((r) => r.id === li.dataset.listing)));
    const filtered = !!(this.listingFilter.state || this.listingFilter.q?.trim());
    body.querySelector('.list-count')!.textContent = page.total
      ? `${page.total} ${page.total === 1 ? 'anúncio' : 'anúncios'}${filtered ? ' com esse filtro' : ''}${list.children.length < page.total ? `, mostrando ${list.children.length}` : ''}.`
      : filtered
        ? 'Nenhum anúncio com esse filtro.'
        : `Nenhum anúncio ainda. Para anunciar, abra o mapa e use "+ Anunciar".`;
    body.querySelector<HTMLElement>('[data-action="more"]')!.hidden = list.children.length >= page.total;
  }

  private listingRowHtml(r: ListingTableRow, canEdit: boolean): string {
    const price = r.transaction === 'rent' ? `${formatBRL(r.rentPrice ?? r.price)}/mês` : formatBRL(r.price);
    const day = new Date(r.updatedAt).toLocaleDateString('pt-BR');
    const facts = [r.referenceCode, TYPE_LABELS[r.type], r.bairro, price, `alterado em ${day}`].filter(Boolean).map((x) => escapeHtml(String(x)));
    const select = <T extends string>(name: string, label: string, values: readonly T[], labels: Record<T, string>, cur: T) =>
      `<label class="a-field">${label}<select name="${name}" ${canEdit ? '' : 'disabled'}>${values
        .map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${labels[v]}</option>`)
        .join('')}</select></label>`;
    return `<li class="listing-row${r.published ? '' : ' is-draft'}" data-listing="${escapeHtml(r.id)}">
      <div class="lead-head"><strong>${escapeHtml(r.title)}</strong>${r.published ? '' : '<span class="draft-badge">Rascunho</span>'}</div>
      <small class="muted">${facts.join(' · ')}</small>
      <div class="lead-controls">
        ${select('availability', 'Situação', AVAILABILITIES, AVAILABILITY_LABELS, r.availability)}
        ${select('highlight', 'Destaque', HIGHLIGHTS, HIGHLIGHT_LABELS, r.highlight)}
      </div>
      <div class="list-actions">
        ${canEdit ? `<button type="button" class="btn-secondary" data-action="publish">${r.published ? 'Despublicar' : 'Publicar'}</button>` : ''}
        <button type="button" class="link-btn" data-action="open">Ver no mapa</button>
        ${canEdit ? '<button type="button" class="link-btn btn-danger-text" data-action="trash">Excluir</button>' : '<small class="muted">Só quem criou o anúncio ou um administrador altera.</small>'}
      </div>
    </li>`;
  }

  private bindListingRow(li: HTMLElement, row: ListingTableRow | undefined): void {
    li.dataset.bound = '';
    if (!row) return;
    const id = row.id;
    const saved = () => {
      li.classList.add('saved');
      setTimeout(() => li.classList.remove('saved'), 1200);
      this.onChange();
    };
    const fail = (ex: unknown) => window.alert((ex as Error).message);
    for (const name of ['availability', 'highlight'] as const) {
      const sel = li.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
      sel.addEventListener('change', async () => {
        sel.disabled = true;
        try {
          await this.backend.updateListing(id, name === 'availability' ? { availability: sel.value as Availability } : { highlight: sel.value as Highlight });
          saved();
        } catch (ex) {
          sel.value = row[name];
          fail(ex);
        } finally {
          sel.disabled = false;
        }
      });
    }
    const publish = li.querySelector<HTMLButtonElement>('[data-action="publish"]');
    publish?.addEventListener('click', async () => {
      const next = !row.published;
      if (!next && !window.confirm(`Despublicar "${row.title}"? Ele sai do site e do mapa e fica como rascunho, só para a equipe.`)) return;
      publish.disabled = true;
      try {
        await this.backend.updateListing(id, { published: next });
        row.published = next;
        publish.textContent = next ? 'Despublicar' : 'Publicar';
        li.classList.toggle('is-draft', !next);
        const head = li.querySelector('.lead-head')!;
        head.querySelector('.draft-badge')?.remove();
        if (!next) head.insertAdjacentHTML('beforeend', '<span class="draft-badge">Rascunho</span>');
        saved();
      } catch (ex) {
        fail(ex);
      } finally {
        publish.disabled = false;
      }
    });
    li.querySelector('[data-action="open"]')!.addEventListener('click', () => {
      this.close();
      this.openListing(id);
    });
    const trash = li.querySelector<HTMLButtonElement>('[data-action="trash"]');
    trash?.addEventListener('click', () => {
      if (!window.confirm(`Excluir "${row.title}"? Ele vai para a lixeira e pode ser restaurado por 30 dias.`)) return;
      void this.act(trash, async () => {
        await this.backend.trashListing(id);
        this.note = 'Anúncio movido para a lixeira.';
        this.onChange();
        await this.render();
      });
    });
  }

  /** "Importação automática (XML)": the address of the CRM's feed, read every 6 hours, and how the last reading went. */
  private renderFeed(body: HTMLElement, feed: ListingFeed | null): void {
    const org = this.org!;
    const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const s = feed?.lastSummary;
    const items = (list: { referenceCode: string; text: string }[], total: number) =>
      `<ul class="feed-msgs">${list.map((m) => `<li><strong>${escapeHtml(m.referenceCode)}</strong> ${escapeHtml(m.text)}</li>`).join('')}${
        total > list.length ? `<li class="muted">e mais ${total - list.length}</li>` : ''
      }</ul>`;
    const last = !feed?.lastRunAt
      ? `<p class="a-hint">${feed ? 'Ainda não foi lido.' : ''}</p>`
      : `<div class="feed-last feed-${feed.lastStatus}" role="status">
          <p><strong>Última leitura: ${when(feed.lastRunAt)}</strong> · ${
            feed.lastStatus === 'erro'
              ? `não importou: ${escapeHtml(feed.lastError ?? 'falha na leitura')}`
              : `${s!.created} novos, ${s!.updated} atualizados, ${s!.trashed} para a lixeira${s!.skipped ? `, ${s!.skipped} ignorados` : ''}`
          }</p>
          ${s?.errorCount ? `<details><summary>${s.errorCount} com erro</summary>${items(s.errors, s.errorCount)}</details>` : ''}
          ${s?.skipped ? `<details><summary>${s.skipped} ignorados</summary>${items(s.skippedList, s.skipped)}</details>` : ''}
          ${s?.warningCount ? `<details><summary>${s.warningCount} avisos</summary>${items(s.warnings, s.warningCount)}</details>` : ''}
        </div>`;
    const waiting = feed?.requestedAt && (!feed.lastRunAt || feed.requestedAt > feed.lastRunAt);
    body.innerHTML = `<p class="a-hint">Informe o endereço do XML que o seu sistema (CRM) já gera para o ZAP, VivaReal ou OLX
        (formato VRSync). Os anúncios são lidos a cada 6 horas: novos entram publicados, os existentes são atualizados
        pelo código de referência. O que a equipe fizer pela tela fica: anúncio despublicado continua despublicado, o
        que foi para a lixeira não volta e o local ajustado não muda.</p>
      <form class="add-form account-form" data-form="feed" novalidate>
        <label class="a-field a-wide">Endereço do XML<input name="url" type="url" inputmode="url" maxlength="500" placeholder="https://…/feed.xml" value="${escapeHtml(feed?.url ?? '')}" required></label>
        <label class="a-check a-wide"><input type="checkbox" name="enabled" ${!feed || feed.enabled ? 'checked' : ''}> <span>Importação ativa</span></label>
        <label class="a-check a-wide"><input type="checkbox" name="sync" ${!feed || feed.sync ? 'checked' : ''}> <span>Mandar para a lixeira o que sair do XML (dá para restaurar por 30 dias)</span></label>
        <p class="a-error a-wide" role="alert" hidden></p>
        <div class="a-actions a-wide">
          <button type="submit" class="btn-primary">Salvar</button>
          <button type="button" class="btn-secondary" data-action="import-now" ${feed?.enabled === false ? 'disabled' : ''}>Importar agora</button>
          ${feed ? '<button type="button" class="link-btn" data-action="remove-feed">Remover</button>' : ''}
        </div>
      </form>
      ${waiting ? '<p class="account-note" role="status">Importação pedida: começa em até 1 hora.</p>' : ''}
      ${last}`;
    const form = body.querySelector<HTMLFormElement>('form[data-form="feed"]')!;
    const errorEl = form.querySelector<HTMLElement>('.a-error')!;
    const save = async (importNow: boolean, control: HTMLButtonElement) => {
      const fd = new FormData(form);
      const url = String(fd.get('url') ?? '').trim();
      errorEl.hidden = true;
      if (!/^https?:\/\/\S+$/.test(url)) {
        errorEl.textContent = 'Informe o endereço completo do XML, começando por https://';
        errorEl.hidden = false;
        return;
      }
      control.disabled = true;
      try {
        await this.backend.saveListingFeed(org.id, { url, enabled: !!fd.get('enabled'), sync: !!fd.get('sync') }, importNow);
        await this.loadSection('feed');
      } catch (ex) {
        errorEl.textContent = (ex as Error).message;
        errorEl.hidden = false;
        control.disabled = false;
      }
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void save(false, form.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    });
    const now = form.querySelector<HTMLButtonElement>('[data-action="import-now"]')!;
    now.addEventListener('click', () => void save(true, now));
    const remove = form.querySelector<HTMLButtonElement>('[data-action="remove-feed"]');
    remove?.addEventListener('click', () => {
      if (!window.confirm('Parar a importação automática? Os anúncios já importados continuam como estão.')) return;
      void this.act(remove, async () => {
        await this.backend.removeListingFeed(org.id);
        await this.loadSection('feed');
      });
    });
  }

  /**
   * "Espelho de vendas": each development with its counts and active reservations; administrators publish, choose
   * whether the public sees prices and the reservation deadline, and send the spreadsheet of units.
   */
  private async loadMirror(body: HTMLElement): Promise<void> {
    const org = this.org!;
    const admin = org.role === 'owner' || org.role === 'admin';
    const devs = await this.backend.teamDevelopments(org.id);
    const units = await Promise.all(devs.map((d) => this.backend.teamUnits(d.id)));
    const when = (iso: string) =>
      new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
    const mapUrl = (slug: string) => `${new URL(`${import.meta.env.BASE_URL}`, location.href).href}?empreendimento=${encodeURIComponent(slug)}`;
    body.innerHTML = `<p class="a-hint">A situação de cada unidade aparece no mapa na hora, para todos. Qualquer pessoa da equipe
        reserva uma unidade pelo espelho (no mapa, clique no prédio); a reserva vence sozinha no prazo. O desenho da torre
        (andares e posição das unidades) é feito pelo suporte.</p>
      ${devs
        .map((d, i) => {
          const list = units[i];
          const n = (st: string, one: string, many: string) => {
            const c = list.filter((u) => u.status === st).length;
            return `${c} ${c === 1 ? one : many}`;
          };
          const reserved = list.filter((u) => u.status === 'reserved').sort((a, b) => (a.reservedUntil ?? '').localeCompare(b.reservedUntil ?? ''));
          return `<div class="mirror-dev" data-dev="${escapeHtml(d.id)}">
            <h4>${escapeHtml(d.name)} <span class="muted small">${d.published ? 'publicado' : 'só a equipe vê'}</span></h4>
            <p class="small">${list.length} unidades: <span class="st st-available">${n('available', 'disponível', 'disponíveis')}</span>
              <span class="st st-reserved">${n('reserved', 'reservada', 'reservadas')}</span> <span class="st st-sold">${n('sold', 'vendida', 'vendidas')}</span>
              · <a href="${escapeHtml(mapUrl(d.slug))}">abrir no mapa</a></p>
            ${
              reserved.length
                ? `<details class="mirror-res"><summary>Reservas ativas (${reserved.length})</summary><ul>${reserved
                    .map(
                      (u) => `<li><span><strong>${escapeHtml(`${u.tower ? `${u.tower} ` : ''}${u.number}`)}</strong> até ${escapeHtml(when(u.reservedUntil!))}${
                        u.reservedByName ? ` · ${escapeHtml(u.reservedByName)}` : ''
                      }${u.reservedNote ? ` · ${escapeHtml(u.reservedNote)}` : ''}</span>${
                        admin || u.reservedBy === this.userId
                          ? ` <button type="button" class="link-btn" data-release="${escapeHtml(u.id)}">Desfazer</button>`
                          : ''
                      }</li>`,
                    )
                    .join('')}</ul></details>`
                : ''
            }
            ${
              admin
                ? `<form class="add-form account-form mirror-form" novalidate>
                    <label class="a-check a-wide"><input type="checkbox" name="published" ${d.published ? 'checked' : ''}> <span>Publicado no mapa</span></label>
                    <label class="a-check a-wide"><input type="checkbox" name="showPrices" ${d.showPrices ? 'checked' : ''}> <span>Mostrar os preços ao público (a equipe sempre vê)</span></label>
                    <label class="a-field">Prazo da reserva (horas)<input name="hours" type="number" min="1" max="168" step="1" value="${d.reservationHours}" required></label>
                    <div class="a-actions a-wide"><button type="submit" class="btn-primary">Salvar</button></div>
                  </form>
                  <div class="mirror-sheet">
                    <p class="small"><b>Planilha:</b> baixe, mude situação e preços no Excel ou no Google Planilhas e envie de volta.
                      As unidades são achadas pela torre e pelo número; preço em branco fica "sob consulta".</p>
                    <div class="a-actions">
                      <button type="button" class="btn-secondary" data-action="csv-out">Baixar planilha</button>
                      <label class="btn-secondary file-btn">Enviar planilha<input type="file" accept=".csv,text/csv" data-action="csv-in" hidden></label>
                    </div>
                  </div>`
                : `<div class="a-actions"><button type="button" class="btn-secondary" data-action="csv-out">Baixar planilha</button></div>`
            }
            <p class="a-error a-wide" role="alert" hidden></p>
            <p class="account-note mirror-done" role="status" hidden></p>
          </div>`;
        })
        .join('')}`;
    body.querySelectorAll<HTMLElement>('.mirror-dev').forEach((box, i) => {
      const d = devs[i];
      const errorEl = box.querySelector<HTMLElement>('.a-error')!;
      const done = box.querySelector<HTMLElement>('.mirror-done')!;
      const show = (el: HTMLElement, text: string) => {
        el.textContent = text;
        el.hidden = !text;
      };
      box.querySelector('[data-action="csv-out"]')!.addEventListener('click', () =>
        download(unitsCsv(units[i]), `espelho-${d.slug}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8'),
      );
      box.querySelectorAll<HTMLButtonElement>('button[data-release]').forEach((b) =>
        b.addEventListener('click', () =>
          void this.act(b, async () => {
            await this.backend.releaseUnit(b.dataset.release!);
            await this.loadSection('mirror');
            this.onChange();
          }),
        ),
      );
      const form = box.querySelector<HTMLFormElement>('form.mirror-form');
      form?.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const hours = Number(fd.get('hours'));
        show(errorEl, '');
        if (!Number.isInteger(hours) || hours < 1 || hours > 168) return show(errorEl, 'O prazo da reserva vai de 1 a 168 horas (7 dias).');
        const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
        btn.disabled = true;
        this.backend
          .updateDevelopment(d.id, { published: !!fd.get('published'), showPrices: !!fd.get('showPrices'), reservationHours: hours })
          .then(async () => {
            await this.loadSection('mirror');
            this.onChange();
          })
          .catch((ex: Error) => {
            show(errorEl, ex.message);
            btn.disabled = false;
          });
      });
      const input = box.querySelector<HTMLInputElement>('input[data-action="csv-in"]');
      input?.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        show(errorEl, '');
        show(done, '');
        if (file.size > 2_000_000) return show(errorEl, 'Planilha grande demais (até 2 MB).');
        const parsed = parseUnitsCsv(await file.text());
        if (parsed.errors.length)
          return show(errorEl, `Nada foi alterado. ${parsed.errors.slice(0, 5).join(' · ')}${parsed.errors.length > 5 ? ` (e mais ${parsed.errors.length - 5})` : ''}`);
        try {
          const r = await this.backend.importUnits(d.id, parsed.rows);
          await this.loadSection('mirror');
          const again = this.el.querySelector<HTMLElement>(`.mirror-dev[data-dev="${CSS.escape(d.id)}"] .mirror-done`);
          if (again)
            show(again, `${r.updated} ${r.updated === 1 ? 'unidade atualizada' : 'unidades atualizadas'}.${
              r.unknown.length ? ` Não existem no desenho (ficaram de fora): ${r.unknown.slice(0, 10).join(', ')}${r.unknown.length > 10 ? '…' : ''}.` : ''
            }`);
          this.onChange();
        } catch (ex) {
          show(errorEl, (ex as Error).message);
        }
      });
    });
  }

  private renderTrash(body: HTMLElement, items: TrashItem[]): void {
    const admin = this.org!.role === 'owner' || this.org!.role === 'admin';
    const day = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
    body.innerHTML = items.length
      ? `<p class="a-hint">Anúncios excluídos ficam aqui por 30 dias e depois são apagados de vez.</p>
        <ul class="account-list">${items
          .map((t) => {
            const mine = admin || t.createdBy === this.userId;
            return `<li><span>${escapeHtml(t.title)}<small>excluído${t.deletedByName ? ` por ${escapeHtml(t.deletedByName)}` : ''} em ${day(t.deletedAt)} · apagado em ${day(t.purgeAt)}</small></span>
              ${
                mine
                  ? `<button type="button" class="link-btn" data-restore="${t.id}">Restaurar</button>
                     <button type="button" class="link-btn btn-danger-text" data-purge="${t.id}">Excluir de vez</button>`
                  : ''
              }</li>`;
          })
          .join('')}</ul>`
      : '<p class="muted small">A lixeira está vazia.</p>';
    body.querySelectorAll<HTMLButtonElement>('[data-restore]').forEach((b) =>
      b.addEventListener('click', () =>
        this.act(b, async () => {
          await this.backend.restoreListing(b.dataset.restore!);
          this.note = 'Anúncio restaurado: está de volta no site.';
          this.onChange();
          await this.render();
        }),
      ),
    );
    body.querySelectorAll<HTMLButtonElement>('[data-purge]').forEach((b) =>
      b.addEventListener('click', () => {
        const t = items.find((x) => x.id === b.dataset.purge);
        if (!window.confirm(`Excluir "${t?.title}" de vez? Não dá para desfazer.`)) return;
        void this.act(b, async () => {
          await this.backend.purgeListing(b.dataset.purge!, this.org!.id);
          this.note = 'Anúncio excluído de vez.';
          await this.render();
        });
      }),
    );
  }

  private renderAudit(body: HTMLElement, entries: AuditEntry[], append: boolean): void {
    const when = (iso: string) =>
      new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const items = entries
      .map((e) => `<li><time datetime="${e.at}">${when(e.at)}</time> <span><b>${escapeHtml(actorLabel(e))}</b> ${escapeHtml(describeAudit(e))}</span></li>`)
      .join('');
    let list = body.querySelector<HTMLElement>('.audit-list');
    if (!append || !list) {
      body.innerHTML = entries.length
        ? `<ul class="audit-list"></ul><button type="button" class="link-btn" data-action="audit-more">Ver mais</button>`
        : '<p class="muted small">Nada registrado ainda.</p>';
      list = body.querySelector<HTMLElement>('.audit-list');
      body.querySelector('[data-action="audit-more"]')?.addEventListener('click', () => void this.loadSection('audit', true));
    }
    if (!list) return;
    list.insertAdjacentHTML('beforeend', items);
    if (entries.length) list.dataset.last = String(entries.at(-1)!.id);
    if (entries.length < 30) body.querySelector<HTMLElement>('[data-action="audit-more"]')?.remove();
  }

  private renderLogin(head: string): void {
    const signup = this.mode === 'signup';
    this.el.innerHTML = `${head}
      <form class="add-form account-form" data-form="login" novalidate>
        ${signup ? '<label class="a-field a-wide">Seu nome<input name="name" autocomplete="name" required></label>' : ''}
        <label class="a-field a-wide">E-mail<input name="email" type="email" autocomplete="email" required></label>
        <label class="a-field a-wide">Senha<input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" required></label>
        ${captchaBox('a-wide')}
        <p class="a-error a-wide" role="alert" hidden></p>
        <div class="a-actions a-wide">
          <button type="submit" class="btn-primary">${signup ? 'Criar conta' : 'Entrar'}</button>
          <button type="button" class="link-btn" data-action="switch">${signup ? 'Já tenho conta' : 'Criar uma conta'}</button>
        </div>
      </form>`;
    this.bindClose();
    if (this.linkInfo) this.el.querySelector<HTMLInputElement>('input[name="email"]')!.value = this.linkInfo.email;
    const captcha = formCaptcha(this.el.querySelector<HTMLElement>('form[data-form="login"]')!, signup ? 'signup' : 'login');
    this.bindForm('login', async (fd) => {
      const email = String(fd.get('email')).trim();
      const password = String(fd.get('password'));
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Informe um e-mail válido.');
      if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
      const name = String(fd.get('name') ?? '').trim();
      if (signup && !name) throw new Error('Informe seu nome.');
      // anti-bot token (only when the check is on); single use, so the widget is reset after each attempt
      const token = captcha ? await captcha.getToken() : undefined;
      try {
        if (signup) {
          const needsConfirm = await this.backend.signUp(email, password, name, token);
          this.mode = 'signin';
          this.note = needsConfirm ? `Enviamos um link de confirmação para ${email}. Depois de confirmar, entre aqui.` : '';
        } else {
          // with two-step verification on, refresh() shows the step of the code next
          await this.backend.signIn(email, password, token);
          this.note = '';
        }
      } finally {
        captcha?.reset();
      }
      await this.refresh(true);
      if (this.isOpen) await this.render();
    });
    this.el.querySelector('[data-action="switch"]')!.addEventListener('click', () => {
      this.mode = signup ? 'signin' : 'signup';
      this.note = '';
      void this.render();
    });
  }

  private offersHtml(offers: PendingInvitation[]): string {
    return `<section class="account-section"><h3>Convites</h3><ul class="account-list">${offers
      .map(
        (o) => `<li><span><strong>${escapeHtml(o.orgName)}</strong> · ${ROLE_LABELS[o.role]}</span>
          ${
            o.token
              ? `<button type="button" class="btn-primary" data-accept="${escapeHtml(o.token)}">Aceitar</button>`
              : '<span class="muted small">Para aceitar, abra o link do convite que você recebeu.</span>'
          }</li>`,
      )
      .join('')}</ul></section>`;
  }

  private orgHtml(): string {
    const org = this.org!;
    const label = this.staff && !this.pending.length ? 'Atendendo' : 'Imobiliária';
    return `<section class="account-section">
      <label class="a-field">${label}
        ${
          this.orgs.length > 1
            ? `<select name="org">${this.orgs
                .map((o) => `<option value="${o.id}" ${o.id === org.id ? 'selected' : ''}>${escapeHtml(o.name)}</option>`)
                .join('')}</select>`
            : `<strong>${escapeHtml(org.name)}</strong>`
        }</label>
      <p class="a-hint">${
        this.staff ? 'Você está no modo suporte: as alterações ficam registradas como feitas pelo suporte.' : `Você é ${ROLE_LABELS[org.role]}.`
      } Os anúncios criados ficam no nome desta imobiliária.</p>
      <p class="a-hint"><a href="${escapeHtml(this.siteUrl(org.slug, false))}" target="_blank" rel="noopener">Ver o site da imobiliária ↗</a>${
        org.role === 'owner' || org.role === 'admin'
          ? ` · <a href="${escapeHtml(this.siteUrl(org.slug, true))}" target="_blank" rel="noopener" data-action="customize">Personalizar o site ↗</a>`
          : ''
      }${this.toggle ? ` · <a href="${escapeHtml(panelUrl())}" target="_blank" rel="noopener">Gestão em página inteira ↗</a>` : ''}</p></section>`;
  }

  /** The client's site (site.html), optionally with the "Personalizar site" editor open. */
  private siteUrl(slug: string, edit: boolean): string {
    const u = new URL(`${import.meta.env.BASE_URL}site.html`, location.href);
    u.searchParams.set('imobiliaria', slug);
    if (edit) u.searchParams.set('editar', '1');
    return u.href;
  }

  private teamHtml(members: Member[], invites: Invitation[]): string {
    const me = this.org!.role;
    const roles = assignable(me);
    const editable = (m: Member) => m.email !== this.email && (m.role !== 'owner' || me === 'owner');
    return `<section class="account-section"><h3>Equipe</h3>
      <ul class="account-list">${members
        .map(
          (m) => `<li data-user="${m.userId}">
            <span>${escapeHtml(m.name || m.email || 'sem nome')}<small>${escapeHtml(m.email ?? '')}</small></span>
            ${
              editable(m)
                ? `<select name="role" aria-label="Papel de ${escapeHtml(m.name || m.email || '')}">${roles
                    .map((r) => `<option value="${r}" ${r === m.role ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`)
                    .join('')}</select>
                   <button type="button" class="link-btn" data-remove="${m.userId}">Remover</button>`
                : `<em>${ROLE_LABELS[m.role]}${m.email === this.email ? ' (você)' : ''}</em>`
            }
          </li>`,
        )
        .join('')}</ul>
      ${
        invites.length
          ? `<h4>Convites pendentes</h4><ul class="account-list">${invites
              .map(
                (i) => `<li><span>${escapeHtml(i.email)}<small>${ROLE_LABELS[i.role]} · vale até ${new Date(i.expiresAt).toLocaleDateString('pt-BR')}</small></span>
                  <button type="button" class="link-btn" data-copy="${escapeHtml(i.token)}">Copiar link</button>
                  <button type="button" class="link-btn" data-cancel="${i.id}">Cancelar</button></li>`,
              )
              .join('')}</ul>`
          : ''
      }
      <form class="add-form account-form" data-form="invite" novalidate>
        <label class="a-field">E-mail do corretor<input name="email" type="email" required></label>
        <label class="a-field">Papel<select name="role">${roles.map((r) => `<option value="${r}">${ROLE_LABELS[r]}</option>`).join('')}</select></label>
        <p class="a-error a-wide" role="alert" hidden></p>
        <div class="a-actions a-wide"><button type="submit" class="btn-primary">Convidar</button></div>
      </form>
      <div class="invite-result" hidden></div>
    </section>`;
  }

  private staffHtml(): string {
    return `<section class="account-section"><h3>Suporte: nova imobiliária</h3>
      <form class="add-form account-form" data-form="org" novalidate>
        <label class="a-field a-wide">Nome da imobiliária<input name="orgName" maxlength="120"></label>
        <label class="a-field">Endereço do site<input name="orgSlug" maxlength="50" placeholder="minha-imobiliaria"></label>
        <label class="a-field">E-mail do dono<input name="ownerEmail" type="email"></label>
        <p class="a-error a-wide" role="alert" hidden></p>
        <div class="a-actions a-wide"><button type="submit" class="btn-primary">Cadastrar imobiliária</button></div>
      </form>
      <div class="org-result" hidden></div></section>`;
  }

  /** Support: exclusive listings whose authorisation document waits to be checked. */
  private exclusivityHtml(queue: ExclusivityItem[] | null): string {
    const when = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
    const body = !queue
      ? '<p class="a-error">Não foi possível ler a fila agora.</p>'
      : !queue.length
        ? '<p class="muted small">Nenhum documento esperando conferência.</p>'
        : `<ul class="exclusivity-queue">${queue
            .map(
              (q) => `<li data-listing="${escapeHtml(q.id)}">
          <p><strong>${escapeHtml(q.title)}</strong>${q.referenceCode ? ` · cód. ${escapeHtml(q.referenceCode)}` : ''}<br>
            <span class="muted small">${escapeHtml(q.orgName)} · enviado em ${when(q.sentAt)}</span></p>
          <div class="a-actions">
            <button type="button" class="btn-secondary" data-doc="${escapeHtml(q.doc)}">Ver documento</button>
            <button type="button" class="btn-primary" data-review="ok">Confirmar</button>
            <button type="button" class="btn-secondary" data-review="no">Recusar com motivo</button>
          </div></li>`,
            )
            .join('')}</ul>`;
    return `<section class="account-section"><h3>Suporte: exclusividades a conferir${queue?.length ? ` (${queue.length})` : ''}</h3>
      <p class="a-hint">Confira se o documento autoriza a venda com exclusividade deste imóvel. O selo “Exclusivo” só aparece no público depois de confirmado.</p>
      ${body}</section>`;
  }

  private bindExclusivity(queue: ExclusivityItem[]): void {
    this.el.querySelectorAll<HTMLLIElement>('.exclusivity-queue li').forEach((li) => {
      const item = queue.find((q) => q.id === li.dataset.listing);
      if (!item) return;
      const docBtn = li.querySelector<HTMLButtonElement>('[data-doc]')!;
      docBtn.addEventListener('click', () => {
        // opened now (inside the click) so the browser does not block it; the address comes after
        const win = window.open('', '_blank');
        if (win) win.opener = null;
        void this.act(docBtn, async () => {
          try {
            const url = await this.backend.exclusivityDocUrl(item.doc);
            if (win) win.location.href = url;
            else window.location.href = url;
          } catch (ex) {
            win?.close();
            throw ex;
          }
        });
      });
      li.querySelectorAll<HTMLButtonElement>('[data-review]').forEach((b) =>
        b.addEventListener('click', () => {
          const ok = b.dataset.review === 'ok';
          let note = '';
          if (!ok) {
            note = window.prompt(`Motivo da recusa de "${item.title}" (a imobiliária vai ler):`)?.trim() ?? '';
            if (!note) return;
          } else if (!window.confirm(`Confirmar a exclusividade de "${item.title}"? O selo aparece no público.`)) return;
          void this.act(b, async () => {
            await this.backend.reviewExclusivity(item.id, ok, note);
            this.note = ok ? 'Exclusividade confirmada.' : 'Exclusividade recusada; a imobiliária vê o motivo ao editar o anúncio.';
            this.onChange();
            await this.render();
          });
        }),
      );
    });
  }

  /** Link box with copy and WhatsApp buttons, shown after creating an invitation. */
  private showLink(box: HTMLElement, token: string, intro: string): void {
    const link = inviteLink(token);
    box.hidden = false;
    box.innerHTML = `<p class="a-hint">${escapeHtml(intro)}</p>
      <div class="invite-link"><input readonly value="${escapeHtml(link)}" aria-label="Link do convite">
        <button type="button" class="btn-secondary" data-copy="${escapeHtml(token)}">Copiar</button>
        <a class="btn-secondary" target="_blank" rel="noopener"
          href="https://wa.me/?text=${encodeURIComponent(`Seu convite para anunciar: ${link}`)}">WhatsApp</a></div>`;
    this.bindCopy(box);
  }

  // ---------------------------------------------------------------- actions

  private bindLoggedIn(members: Member[]): void {
    const el = this.el;
    el.querySelector('[data-action="signout"]')!.addEventListener('click', () => void this.signOut());
    el.querySelector<HTMLSelectElement>('select[name="org"]')?.addEventListener('change', (e) => {
      try {
        localStorage.setItem(ORG_KEY, (e.target as HTMLSelectElement).value);
      } catch {
        // not remembered
      }
      this.note = '';
      void this.refresh(true);
    });
    el.querySelectorAll<HTMLButtonElement>('[data-accept]').forEach((b) =>
      b.addEventListener('click', () =>
        this.act(b, async () => {
          const orgId = await this.backend.acceptInvitation(b.dataset.accept!);
          if (b.dataset.accept === this.linkToken) this.forgetLink();
          try {
            localStorage.setItem(ORG_KEY, orgId);
          } catch {
            // not remembered
          }
          this.note = 'Convite aceito. Você já pode anunciar.';
          await this.refresh(true);
        }),
      ),
    );
    el.querySelectorAll<HTMLSelectElement>('li[data-user] select[name="role"]').forEach((sel) =>
      sel.addEventListener('change', () => {
        const userId = sel.closest<HTMLElement>('li')!.dataset.user!;
        void this.act(sel, async () => {
          await this.backend.setRole(this.org!.id, userId, sel.value as Role);
          this.note = 'Papel alterado.';
          await this.render();
        });
      }),
    );
    el.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) =>
      b.addEventListener('click', () => {
        const m = members.find((x) => x.userId === b.dataset.remove);
        if (!window.confirm(`Remover ${m?.name || m?.email} da imobiliária? Os anúncios dele continuam, e o administrador passa a cuidar deles.`)) return;
        void this.act(b, async () => {
          await this.backend.removeMember(this.org!.id, b.dataset.remove!);
          this.note = 'Removido da equipe.';
          await this.render();
        });
      }),
    );
    el.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((b) =>
      b.addEventListener('click', () =>
        this.act(b, async () => {
          await this.backend.cancelInvitation(b.dataset.cancel!);
          this.note = 'Convite cancelado.';
          await this.render();
        }),
      ),
    );
    this.bindCopy(el);
    this.bindForm('invite', async (fd) => {
      const email = String(fd.get('email') ?? '').trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Informe um e-mail válido.');
      const token = await this.backend.invite(this.org!.id, email, fd.get('role') as Role);
      const emailed = await this.backend.emailInvitation(token);
      this.note = '';
      await this.render();
      this.showLink(
        this.el.querySelector<HTMLElement>('.invite-result')!,
        token,
        emailed
          ? `Convite enviado por e-mail para ${email} (vale por 14 dias). Se quiser, mande também o link pelo WhatsApp.`
          : `Convite criado para ${email}. Envie este link (vale por 14 dias); a pessoa entra com esse e-mail e aceita.`,
      );
    });
    const name = el.querySelector<HTMLInputElement>('input[name="orgName"]');
    const slug = el.querySelector<HTMLInputElement>('input[name="orgSlug"]');
    name?.addEventListener('input', () => {
      if (!slug!.dataset.touched) slug!.value = slugify(name.value);
    });
    slug?.addEventListener('input', () => (slug.dataset.touched = '1'));
    this.bindForm('org', async (fd) => {
      const n = String(fd.get('orgName') ?? '').trim();
      const s = slugify(String(fd.get('orgSlug') ?? '') || n);
      const owner = String(fd.get('ownerEmail') ?? '').trim().toLowerCase();
      if (n.length < 2) throw new Error('Informe o nome da imobiliária.');
      if (!s) throw new Error('Informe o endereço do site (letras, números e hífen).');
      if (!/^\S+@\S+\.\S+$/.test(owner)) throw new Error('Informe o e-mail do dono da imobiliária.');
      const { org, inviteToken } = await this.backend.createOrg(n, s, owner);
      const emailed = inviteToken ? await this.backend.emailInvitation(inviteToken) : false;
      this.note = '';
      await this.refresh(false);
      await this.render();
      if (inviteToken)
        this.showLink(
          this.el.querySelector<HTMLElement>('.org-result')!,
          inviteToken,
          emailed
            ? `"${org.name}" cadastrada. O convite foi enviado por e-mail para ${owner}; o link também está aqui.`
            : `"${org.name}" cadastrada. Envie este link para ${owner}: ao entrar com esse e-mail, a pessoa vira dona da imobiliária.`,
        );
    });
  }

  private bindCopy(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) =>
      b.addEventListener('click', async () => {
        const link = inviteLink(b.dataset.copy!);
        try {
          await navigator.clipboard.writeText(link);
          b.textContent = 'Copiado ✓';
        } catch {
          window.prompt('Copie o link do convite:', link);
        }
      }),
    );
  }

  private forgetLink(): void {
    this.linkToken = null;
    this.linkInfo = null;
    const url = new URL(location.href);
    url.searchParams.delete('convite');
    history.replaceState(history.state, '', url);
  }

  private bindClose(): void {
    this.el.querySelector('[data-action="close"]')?.addEventListener('click', () => this.close());
  }

  /** A button/select action with a busy state; errors go to the panel's note. */
  private async act(control: HTMLButtonElement | HTMLSelectElement, action: () => Promise<void>): Promise<void> {
    control.disabled = true;
    try {
      await action();
    } catch (ex) {
      this.note = (ex as Error).message;
      await this.render();
    } finally {
      control.disabled = false;
    }
  }

  /** Form submit with a busy state and errors shown in the form. */
  private bindForm(name: string, action: (fd: FormData) => Promise<void>): void {
    const form = this.el.querySelector<HTMLFormElement>(`form[data-form="${name}"]`);
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      const err = form.querySelector<HTMLElement>('.a-error')!;
      btn.disabled = true;
      err.hidden = true;
      try {
        await action(new FormData(form));
      } catch (ex) {
        err.hidden = false;
        err.textContent = (ex as Error).message;
      } finally {
        if (btn.isConnected) btn.disabled = false;
      }
    });
  }
}
