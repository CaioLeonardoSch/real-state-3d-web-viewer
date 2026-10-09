import type { Org, RemoteBackend } from '../backend/remote';
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

const ROLE_LABELS: Record<Org['role'], string> = { owner: 'dono', admin: 'administrador', agent: 'corretor' };
const ORG_KEY = 'mapa3d:org';

/**
 * Login, sign-up and the client ("imobiliária") the user is working for. Only shown when a back end is configured.
 */
export class AccountPanel {
  private orgs: Org[] = [];
  private org: Org | null = null;
  private email: string | null = null;
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

  /** Reads the session and the user's clients. `notify`: tell the app when something changed. */
  async refresh(notify = false): Promise<void> {
    const session = await this.backend.session();
    const before = `${this.email}|${this.org?.id}`;
    this.email = session?.user.email ?? null;
    this.orgs = this.email ? await this.backend.myOrgs() : [];
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(ORG_KEY);
    } catch {
      // storage blocked: the first client is used
    }
    this.org = this.orgs.find((o) => o.id === saved) ?? this.orgs[0] ?? null;
    this.toggle.textContent = this.email ? (this.org?.name ?? 'Minha conta') : 'Entrar';
    if (this.isOpen) this.render();
    if (notify && before !== `${this.email}|${this.org?.id}`) this.onChange();
  }

  open(note = ''): void {
    this.note = note;
    this.isOpen = true;
    this.el.hidden = false;
    this.toggle.setAttribute('aria-expanded', 'true');
    this.render();
    this.el.querySelector<HTMLElement>('input, select, button.btn-primary')?.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.focus();
  }

  private render(): void {
    const head = `<div class="add-head"><h2 id="account-title">${this.email ? 'Minha conta' : 'Entrar'}</h2>
      <button type="button" class="icon-btn" data-action="close" aria-label="Fechar">×</button></div>
      ${this.note ? `<p class="account-note">${escapeHtml(this.note)}</p>` : ''}`;
    if (!this.email) {
      const signup = this.mode === 'signup';
      this.el.innerHTML = `${head}
        <form class="add-form account-form" novalidate>
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
      this.bind(async (fd) => {
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
        if (!this.isOpen) return;
        this.render();
      });
      this.el.querySelector('[data-action="switch"]')!.addEventListener('click', () => {
        this.mode = signup ? 'signin' : 'signup';
        this.note = '';
        this.render();
      });
      return;
    }
    const orgPart = this.org
      ? `<label class="a-field a-wide">Imobiliária
          ${
            this.orgs.length > 1
              ? `<select name="org">${this.orgs
                  .map((o) => `<option value="${o.id}" ${o.id === this.org!.id ? 'selected' : ''}>${escapeHtml(o.name)}</option>`)
                  .join('')}</select>`
              : `<strong>${escapeHtml(this.org.name)}</strong>`
          }</label>
        <p class="a-hint a-wide">Você é ${ROLE_LABELS[this.org.role]}. Os anúncios que você criar ficam no nome desta imobiliária.</p>`
      : `<p class="a-wide">Para anunciar, cadastre a sua imobiliária (ou peça a quem já cadastrou que inclua você).</p>
        <label class="a-field a-wide">Nome da imobiliária<input name="orgName" maxlength="120"></label>
        <label class="a-field a-wide">Endereço do site<span class="a-slug"><input name="orgSlug" maxlength="50" placeholder="minha-imobiliaria"></span></label>
        <p class="a-error a-wide" role="alert" hidden></p>
        <div class="a-actions a-wide"><button type="submit" class="btn-primary">Cadastrar imobiliária</button></div>`;
    this.el.innerHTML = `${head}
      <p class="muted small">Conectado como ${escapeHtml(this.email)}</p>
      <form class="add-form account-form" novalidate>${orgPart}</form>
      <div class="a-actions"><button type="button" class="btn-secondary" data-action="signout">Sair</button></div>`;
    this.bindClose();
    const name = this.el.querySelector<HTMLInputElement>('input[name="orgName"]');
    const slug = this.el.querySelector<HTMLInputElement>('input[name="orgSlug"]');
    name?.addEventListener('input', () => {
      if (!slug!.dataset.touched) slug!.value = slugify(name.value);
    });
    slug?.addEventListener('input', () => (slug.dataset.touched = '1'));
    this.el.querySelector<HTMLSelectElement>('select[name="org"]')?.addEventListener('change', (e) => {
      try {
        localStorage.setItem(ORG_KEY, (e.target as HTMLSelectElement).value);
      } catch {
        // not remembered
      }
      void this.refresh(true);
    });
    this.el.querySelector('[data-action="signout"]')!.addEventListener('click', async () => {
      await this.backend.signOut();
      await this.refresh(true);
    });
    if (!this.org)
      this.bind(async (fd) => {
        const n = String(fd.get('orgName') ?? '').trim();
        const s = slugify(String(fd.get('orgSlug') ?? '') || n);
        if (n.length < 2) throw new Error('Informe o nome da imobiliária.');
        if (!s) throw new Error('Informe o endereço do site (letras, números e hífen).');
        const org = await this.backend.createOrg(n, s);
        try {
          localStorage.setItem(ORG_KEY, org.id);
        } catch {
          // not remembered
        }
        this.note = `Imobiliária "${org.name}" cadastrada. Já pode anunciar.`;
        await this.refresh(true);
      });
  }

  private bindClose(): void {
    this.el.querySelector('[data-action="close"]')!.addEventListener('click', () => this.close());
  }

  /** Form submit with a busy state and errors shown in the form. */
  private bind(action: (fd: FormData) => Promise<void>): void {
    const form = this.el.querySelector<HTMLFormElement>('.account-form');
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
        btn.disabled = false;
      }
    });
  }
}
