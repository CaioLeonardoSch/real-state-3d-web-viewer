import type { Invitation, Member, Org, PendingInvitation, RemoteBackend, Role } from '../backend/remote';
import { escapeHtml } from '../utils/format';

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

/**
 * Login, invitations and the client ("imobiliária") the user works for; team management for owners and admins;
 * new clients for the platform's support staff. Only shown when a back end is configured.
 */
export class AccountPanel {
  private orgs: Org[] = [];
  private org: Org | null = null;
  private email: string | null = null;
  private staff = false;
  private pending: PendingInvitation[] = [];
  /** Token from an invitation link (?convite=…), until it is accepted. */
  private linkToken: string | null = new URLSearchParams(location.search).get('convite');
  private linkInfo: Awaited<ReturnType<RemoteBackend['invitationInfo']>> = null;
  private mode: 'signin' | 'signup' = 'signin';
  private note = '';
  private isOpen = false;

  constructor(
    private el: HTMLElement,
    private toggle: HTMLButtonElement,
    private backend: RemoteBackend,
    /** Called after login, logout or a change of client: reload what the user may edit. */
    private onChange: () => void,
  ) {
    toggle.hidden = false;
    toggle.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    document.addEventListener('keydown', (e) => {
      if (this.isOpen && e.key === 'Escape') this.close();
    });
    backend.onAuthChange(() => void this.refresh(true));
  }

  get currentOrg(): Org | null {
    return this.org;
  }
  get loggedIn(): boolean {
    return this.email !== null;
  }

  /** Reads the session, the user's clients and invitations. `notify`: tell the app when something changed. */
  async refresh(notify = false): Promise<void> {
    const session = await this.backend.session();
    const before = `${this.email}|${this.org?.id}`;
    this.email = session?.user.email ?? null;
    [this.orgs, this.staff, this.pending] = this.email
      ? await Promise.all([this.backend.myOrgs(), this.backend.isStaff(), this.backend.myInvitations()])
      : [[], false, []];
    if (this.linkToken && !this.linkInfo) this.linkInfo = await this.backend.invitationInfo(this.linkToken);
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(ORG_KEY);
    } catch {
      // storage blocked: the first client is used
    }
    this.org = this.orgs.find((o) => o.id === saved) ?? this.orgs[0] ?? null;
    this.toggle.textContent = this.email ? (this.org?.name ?? 'Minha conta') : 'Entrar';
    if (this.isOpen) await this.render();
    if (notify && before !== `${this.email}|${this.org?.id}`) this.onChange();
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
    this.toggle.setAttribute('aria-expanded', 'true');
    void this.render().then(() => this.el.querySelector<HTMLElement>('input, select, button.btn-primary')?.focus());
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.focus();
  }

  // ---------------------------------------------------------------- rendering

  private async render(): Promise<void> {
    const head = `<div class="add-head"><h2 id="account-title">${this.email ? 'Minha conta' : 'Entrar'}</h2>
      <button type="button" class="icon-btn" data-action="close" aria-label="Fechar">×</button></div>
      ${this.note ? `<p class="account-note" role="status">${escapeHtml(this.note)}</p>` : ''}`;
    if (!this.email) return this.renderLogin(head);

    const canManage = this.org?.role === 'owner' || this.org?.role === 'admin';
    const [members, invites] = this.org && canManage
      ? await Promise.all([this.backend.members(this.org.id), this.backend.invitations(this.org.id)])
      : [[], []];
    // the invitation from the link, when it is for this account and not in the list yet
    const offers = [...this.pending];
    if (this.linkToken && this.linkInfo && !this.linkInfo.accepted && !this.linkInfo.expired && !offers.some((p) => p.token === this.linkToken))
      offers.push({ token: this.linkToken, orgId: '', orgName: this.linkInfo.orgName, role: this.linkInfo.role });

    this.el.innerHTML = `${head}
      <p class="muted small">Conectado como ${escapeHtml(this.email)}${this.staff ? ' · <strong>suporte da plataforma</strong>' : ''}</p>
      ${offers.length ? this.offersHtml(offers) : ''}
      ${this.org ? this.orgHtml() : offers.length ? '' : `<p class="account-empty">Sua conta ainda não está ligada a nenhuma imobiliária.
        Peça o link de convite ao administrador da sua imobiliária.</p>`}
      ${this.org && canManage ? this.teamHtml(members, invites) : ''}
      ${this.staff ? this.staffHtml() : ''}
      <div class="a-actions account-signout"><button type="button" class="btn-secondary" data-action="signout">Sair</button></div>`;
    this.bindClose();
    this.bindLoggedIn(members);
  }

  private renderLogin(head: string): void {
    const signup = this.mode === 'signup';
    this.el.innerHTML = `${head}
      <form class="add-form account-form" data-form="login" novalidate>
        ${signup ? '<label class="a-field a-wide">Seu nome<input name="name" autocomplete="name" required></label>' : ''}
        <label class="a-field a-wide">E-mail<input name="email" type="email" autocomplete="email" required></label>
        <label class="a-field a-wide">Senha<input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" required></label>
        <p class="a-error a-wide" role="alert" hidden></p>
        <div class="a-actions a-wide">
          <button type="submit" class="btn-primary">${signup ? 'Criar conta' : 'Entrar'}</button>
          <button type="button" class="link-btn" data-action="switch">${signup ? 'Já tenho conta' : 'Criar uma conta'}</button>
        </div>
      </form>`;
    this.bindClose();
    if (this.linkInfo) this.el.querySelector<HTMLInputElement>('input[name="email"]')!.value = this.linkInfo.email;
    this.bindForm('login', async (fd) => {
      const email = String(fd.get('email')).trim();
      const password = String(fd.get('password'));
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Informe um e-mail válido.');
      if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
      if (signup) {
        const name = String(fd.get('name') ?? '').trim();
        if (!name) throw new Error('Informe seu nome.');
        const needsConfirm = await this.backend.signUp(email, password, name);
        this.mode = 'signin';
        this.note = needsConfirm ? `Enviamos um link de confirmação para ${email}. Depois de confirmar, entre aqui.` : '';
      } else {
        await this.backend.signIn(email, password);
        this.note = '';
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
          <button type="button" class="btn-primary" data-accept="${escapeHtml(o.token)}">Aceitar</button></li>`,
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
      } Os anúncios criados ficam no nome desta imobiliária.</p></section>`;
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
    el.querySelector('[data-action="signout"]')!.addEventListener('click', async () => {
      await this.backend.signOut();
      this.note = '';
      await this.refresh(true);
    });
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
      this.note = '';
      await this.render();
      this.showLink(
        this.el.querySelector<HTMLElement>('.invite-result')!,
        token,
        `Convite criado para ${email}. Envie este link (vale por 14 dias); a pessoa entra com esse e-mail e aceita.`,
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
      this.note = '';
      await this.refresh(false);
      await this.render();
      if (inviteToken)
        this.showLink(
          this.el.querySelector<HTMLElement>('.org-result')!,
          inviteToken,
          `"${org.name}" cadastrada. Envie este link para ${owner}: ao entrar com esse e-mail, a pessoa vira dona da imobiliária.`,
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
    this.el.querySelector('[data-action="close"]')!.addEventListener('click', () => this.close());
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
