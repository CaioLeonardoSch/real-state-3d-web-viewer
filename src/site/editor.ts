// "Personalizar site": the client's owner or admin changes brand, contacts, menu, texts and layout and sees the
// site change while typing. Saves to the back end (organizations.branding) or, in the demo, to this browser.
import { escapeHtml } from '../utils/format';
import { siteImage } from '../utils/images';
import { SORT_KEYS, SORT_LABELS } from '../state/sort';
import type { SiteApp } from './app';
import {
  FONTS,
  HOME_SECTIONS,
  HOME_SECTION_LABELS,
  MENU_ITEMS,
  MENU_LABELS,
  SOCIALS,
  SOCIAL_LABELS,
  TEMPLATES,
  TEMPLATE_LABELS,
  applyTemplate,
  colorWarnings,
  normalizeSiteConfig,
  themeVars,
  type SiteConfig,
} from './config';
import { demoDraftKey } from './data';
import { ICONS } from './icons';

type Path = string;

const get = (o: unknown, path: Path): unknown => path.split('.').reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);
function set(o: Record<string, unknown>, path: Path, v: unknown): void {
  const keys = path.split('.');
  let cur = o;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[keys.at(-1)!] = v;
}

export class SiteEditor {
  private el: HTMLElement;
  private draft: SiteConfig;
  private saved: string;
  private canSave = false;
  /** Set when the page reloads on purpose ("Voltar ao original"): no "leave the site?" prompt. */
  private leaving = false;

  constructor(private app: SiteApp) {
    this.draft = structuredClone(app.config);
    this.saved = JSON.stringify(app.config);
    this.el = document.createElement('aside');
    this.el.className = 'editor';
    this.el.setAttribute('aria-label', 'Personalizar site');
    document.body.append(this.el);
    window.addEventListener('beforeunload', (e) => {
      if (this.dirty && !this.leaving) e.preventDefault();
    });
  }

  get dirty(): boolean {
    return JSON.stringify(this.draft) !== this.saved;
  }

  async open(): Promise<void> {
    document.body.classList.add('editing');
    const { remote, demo } = this.app.data;
    this.canSave = demo || (!!remote && (await remote.canEditSite(this.app.data.agencyId)));
    this.render();
  }

  close(): void {
    if (this.dirty && !confirm('Descartar as alterações que não foram salvas?')) return;
    this.draft = JSON.parse(this.saved) as SiteConfig;
    this.app.setConfig(normalizeSiteConfig(this.draft, this.app.data.orgName));
    document.body.classList.remove('editing');
    this.el.innerHTML = '';
    const url = new URL(location.href);
    url.searchParams.delete('editar');
    history.replaceState(null, '', url);
  }

  private render(): void {
    const d = this.draft;
    const { demo } = this.app.data;
    if (!this.canSave) {
      this.el.innerHTML = `<div class="ed-head"><h2>Personalizar site</h2><button type="button" class="icon-btn" data-close aria-label="Fechar">${ICONS.close}</button></div>
        <form class="ed-login">
          <p>Entre com a conta de dono ou administrador da ${escapeHtml(this.app.data.orgName)} para editar o site.</p>
          <label class="fld"><span>E-mail</span><input name="email" type="email" autocomplete="username" required></label>
          <label class="fld"><span>Senha</span><input name="password" type="password" autocomplete="current-password" required></label>
          <p class="form-msg" role="status"></p>
          <button class="btn btn-primary btn-block">Entrar</button>
        </form>`;
      this.el.querySelector('[data-close]')!.addEventListener('click', () => this.close());
      const form = this.el.querySelector<HTMLFormElement>('form')!;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = form.querySelector('.form-msg')!;
        const fd = new FormData(form);
        try {
          await this.app.data.remote!.signIn(String(fd.get('email')), String(fd.get('password')));
          this.canSave = await this.app.data.remote!.canEditSite(this.app.data.agencyId);
          if (!this.canSave) msg.textContent = 'Esta conta não é dona nem administradora desta imobiliária.';
          else this.render();
        } catch (err) {
          msg.textContent = (err as Error).message;
        }
      });
      return;
    }
    const text = (path: Path, label: string, opts: { max?: number; placeholder?: string; area?: boolean; hint?: string } = {}) => {
      const v = escapeHtml(String(get(d, path) ?? ''));
      const input = opts.area
        ? `<textarea data-k="${path}" rows="5" maxlength="${opts.max ?? 4000}">${v}</textarea>`
        : `<input data-k="${path}" value="${v}" maxlength="${opts.max ?? 200}" placeholder="${escapeHtml(opts.placeholder ?? '')}">`;
      return `<label class="fld"><span>${label}</span>${input}${opts.hint ? `<small>${opts.hint}</small>` : ''}</label>`;
    };
    const select = (path: Path, label: string, options: [string, string][]) =>
      `<label class="fld"><span>${label}</span><select data-k="${path}">${options
        .map(([v, t]) => `<option value="${escapeHtml(v)}"${String(get(d, path)) === v ? ' selected' : ''}>${escapeHtml(t)}</option>`)
        .join('')}</select></label>`;
    const color = (path: Path, label: string) =>
      `<label class="fld color"><span>${label}</span><input type="color" data-k="${path}" value="${escapeHtml(String(get(d, path)))}"><code>${escapeHtml(String(get(d, path)))}</code></label>`;
    const check = (path: Path, label: string) =>
      `<label class="check"><input type="checkbox" data-k="${path}"${get(d, path) ? ' checked' : ''}> ${label}</label>`;
    const image = (path: Path, label: string, kind: 'logo' | 'capa' | 'sobre') =>
      `<div class="fld"><span>${label}</span><div class="ed-img">${get(d, path) ? `<img src="${escapeHtml(String(get(d, path)))}" alt="">` : '<em>Nenhuma</em>'}
        <label class="btn btn-ghost">Escolher…<input type="file" accept="image/*" data-img="${path}" data-kind="${kind}" hidden></label>
        ${get(d, path) ? `<button type="button" class="link-btn" data-noimg="${path}">Remover</button>` : ''}</div></div>`;
    const ordered = (path: 'menu' | 'home.sections', all: readonly string[], labels: Record<string, string>) => {
      const on = get(d, path) as string[];
      const rest = all.filter((x) => !on.includes(x));
      return `<ul class="ed-order" data-list="${path}">${[...on, ...rest]
        .map(
          (x) => `<li><label class="check"><input type="checkbox" data-item="${x}"${on.includes(x) ? ' checked' : ''}> ${escapeHtml(labels[x])}</label>
          <span><button type="button" class="icon-btn" data-move="-1" data-of="${x}" aria-label="Subir ${escapeHtml(labels[x])}"${on.includes(x) ? '' : ' disabled'}>↑</button><button type="button" class="icon-btn" data-move="1" data-of="${x}" aria-label="Descer ${escapeHtml(labels[x])}"${on.includes(x) ? '' : ' disabled'}>↓</button></span></li>`,
        )
        .join('')}</ul>`;
    };
    const warnings = colorWarnings(d);
    const fonts = Object.entries(FONTS).map(([k, f]) => [k, f.label] as [string, string]);
    this.el.innerHTML = `
      <div class="ed-head"><h2>Personalizar site</h2><button type="button" class="icon-btn" data-close aria-label="Fechar o editor">${ICONS.close}</button></div>
      <div class="ed-body">
        <details open><summary>Modelo</summary>
          <div class="ed-templates">${TEMPLATES.map((t) => {
            const v = themeVars(applyTemplate(d, t));
            return `<button type="button" data-template="${t}" aria-pressed="${d.template === t}"><span class="sw" style="background:${v['--s-header']}"></span><span class="sw" style="background:${v['--s-primary']}"></span><span class="sw" style="background:${v['--s-bg']}"></span> ${escapeHtml(TEMPLATE_LABELS[t])}</button>`;
          }).join('')}</div>
          <p class="hint">Trocar o modelo muda cores, fontes e o jeito da busca; textos, contatos e logo continuam.</p>
        </details>
        <details open><summary>Marca</summary>
          ${text('name', 'Nome no site', { max: 80 })}
          ${text('creci', 'CRECI', { max: 30 })}
          ${image('logo', 'Logo (PNG com fundo transparente fica melhor)', 'logo')}
          <label class="fld"><span>Altura do logo: ${d.logoHeight}px</span><input type="range" min="24" max="80" data-k="logoHeight" value="${d.logoHeight}"></label>
          ${color('colors.primary', 'Cor principal (botões, preços)')}
          ${color('colors.accent', 'Cor de destaque (selos)')}
          ${color('colors.header', 'Cor do cabeçalho')}
          ${warnings.length ? `<ul class="ed-warn" role="status">${warnings.map((w) => `<li>${escapeHtml(w.message)}</li>`).join('')}</ul>` : '<p class="hint ok" role="status">Contraste das cores: ok para leitura (WCAG AA).</p>'}
          ${select('theme', 'Fundo', [['light', 'Claro'], ['dark', 'Escuro']])}
          ${select('font', 'Fonte do texto', fonts)}
          ${select('headingFont', 'Fonte dos títulos', fonts)}
          ${select('corners', 'Cantos', [['retos', 'Retos'], ['suaves', 'Suaves'], ['redondos', 'Arredondados']])}
        </details>
        <details><summary>Contatos e redes</summary>
          ${text('contacts.whatsapp', 'WhatsApp (com DDD)', { placeholder: '47 99999-9999' })}
          ${text('contacts.phone', 'Telefone', { placeholder: '47 3333-3333' })}
          ${text('contacts.email', 'E-mail')}
          ${text('contacts.address', 'Endereço')}
          ${text('contacts.hours', 'Horário de atendimento')}
          ${SOCIALS.map((s) => text(`social.${s}`, SOCIAL_LABELS[s], { placeholder: '@perfil ou link' })).join('')}
          ${check('whatsappButton.enabled', 'Botão flutuante de WhatsApp')}
          ${text('whatsappButton.message', 'Mensagem inicial do WhatsApp', { max: 300 })}
        </details>
        <details><summary>Menu</summary>${ordered('menu', MENU_ITEMS, MENU_LABELS)}</details>
        <details><summary>Página inicial</summary>
          ${text('home.title', 'Título da capa', { max: 120 })}
          ${text('home.subtitle', 'Subtítulo', { max: 240, area: true })}
          ${image('home.heroImage', 'Foto da capa (opcional)', 'capa')}
          <p class="hint">Seções, na ordem em que aparecem:</p>
          ${ordered('home.sections', HOME_SECTIONS, HOME_SECTION_LABELS)}
        </details>
        <details><summary>Sobre nós</summary>
          ${text('about.title', 'Título', { max: 80 })}
          ${text('about.text', 'Texto', { area: true, hint: 'Deixe uma linha em branco entre os parágrafos.' })}
          ${image('about.image', 'Foto (equipe, fachada)', 'sobre')}
        </details>
        <details><summary>Busca e cards</summary>
          ${select('search.filters', 'Filtros', [['topo', 'No topo, abrindo em "Filtros"'], ['lateral', 'Na lateral, sempre à mostra']])}
          ${select('search.view', 'Exibição inicial', [['grade', 'Grade'], ['lista', 'Lista'], ['mapa', 'Mapa 3D']])}
          ${select('search.sort', 'Ordem inicial', SORT_KEYS.map((k) => [k, SORT_LABELS[k]]))}
          ${select('search.perPage', 'Imóveis por página', [['12', '12'], ['24', '24'], ['36', '36']])}
          ${select('search.cardPrice', 'Preço no card', [['abaixo', 'Abaixo da foto'], ['foto', 'Sobre a foto']])}
          ${check('search.showCode', 'Mostrar o código do imóvel')}
        </details>
        <details><summary>Google</summary>
          ${text('seo.description', 'Descrição do site no Google', { max: 300, area: true, hint: 'Até 160 caracteres aparecem no resultado da busca.' })}
        </details>
      </div>
      <div class="ed-foot">
        <p class="ed-state" role="status">${this.dirty ? 'Alterações não salvas.' : 'Tudo salvo.'}</p>
        <button type="button" class="btn btn-primary" data-save${this.dirty ? '' : ' disabled'}>${demo ? 'Salvar neste navegador' : 'Publicar alterações'}</button>
        <button type="button" class="btn btn-ghost" data-undo${this.dirty ? '' : ' disabled'}>Desfazer</button>
        ${demo ? '<button type="button" class="link-btn" data-export>Baixar configuração (JSON)</button> <button type="button" class="link-btn" data-reset>Voltar ao original</button>' : ''}
      </div>`;
    this.wire();
  }

  /** Applies the draft to the preview (normalized, as the published site would read it). */
  private preview(rerenderPanel: boolean): void {
    // the draft keeps what is typed (a half-typed e-mail stays in its field); the preview shows what will be saved
    this.app.setConfig(normalizeSiteConfig(this.draft, this.app.data.orgName));
    if (rerenderPanel) {
      const open = [...this.el.querySelectorAll('details')].map((x) => x.open);
      const scroll = this.el.querySelector('.ed-body')?.scrollTop ?? 0;
      this.render();
      this.el.querySelectorAll('details').forEach((x, i) => (x.open = open[i] ?? false));
      this.el.querySelector('.ed-body')!.scrollTop = scroll;
    } else {
      const st = this.el.querySelector('.ed-state');
      if (st) st.textContent = this.dirty ? 'Alterações não salvas.' : 'Tudo salvo.';
      this.el.querySelectorAll<HTMLButtonElement>('[data-save], [data-undo]').forEach((b) => (b.disabled = !this.dirty));
    }
  }

  private wire(): void {
    const el = this.el;
    el.querySelector('[data-close]')!.addEventListener('click', () => this.close());
    let timer = 0;
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-k]').forEach((input) => {
      const path = input.dataset.k!;
      const apply = () => {
        let v: unknown = input.value;
        if (input instanceof HTMLInputElement && input.type === 'checkbox') v = input.checked;
        if (path === 'logoHeight' || path === 'search.perPage') v = Number(input.value);
        set(this.draft as unknown as Record<string, unknown>, path, v);
        clearTimeout(timer);
        if (input.type === 'color') {
          // live while dragging; warnings are redrawn on "change"
          input.nextElementSibling!.textContent = input.value;
          timer = window.setTimeout(() => this.preview(false), 60);
          return;
        }
        // selects, sliders and checkboxes change labels and warnings: redraw the panel; text fields keep the focus
        const redraw = input instanceof HTMLSelectElement || input.type === 'checkbox';
        timer = window.setTimeout(() => this.preview(redraw), redraw ? 0 : 250);
      };
      input.addEventListener(input instanceof HTMLSelectElement || input.type === 'checkbox' ? 'change' : 'input', apply);
      if (input.type === 'color' || input.type === 'range') input.addEventListener('change', () => this.preview(true));
    });
    el.querySelectorAll<HTMLButtonElement>('[data-template]').forEach((b) =>
      b.addEventListener('click', () => {
        this.draft = applyTemplate(this.draft, b.dataset.template as SiteConfig['template']);
        this.preview(true);
      }),
    );
    el.querySelectorAll<HTMLElement>('[data-list]').forEach((ul) => {
      const path = ul.dataset.list as 'menu' | 'home.sections';
      const read = () => [...ul.querySelectorAll<HTMLInputElement>('[data-item]')].filter((x) => x.checked).map((x) => x.dataset.item!);
      ul.addEventListener('change', () => {
        set(this.draft as unknown as Record<string, unknown>, path, read());
        this.preview(true);
      });
      ul.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-move]');
        if (!b) return;
        const list = read();
        const i = list.indexOf(b.dataset.of!);
        const j = i + Number(b.dataset.move);
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        set(this.draft as unknown as Record<string, unknown>, path, list);
        this.preview(true);
        this.el.querySelector<HTMLButtonElement>(`[data-list="${path}"] [data-of="${b.dataset.of}"][data-move="${b.dataset.move}"]`)?.focus();
      });
    });
    el.querySelectorAll<HTMLInputElement>('[data-img]').forEach((input) =>
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        const kind = input.dataset.kind as 'logo' | 'capa' | 'sobre';
        try {
          const dataUrl = await siteImage(file, kind === 'logo' ? 600 : kind === 'capa' ? 1920 : 1200, kind === 'logo' ? 'png' : 'jpeg');
          const { remote, demo } = this.app.data;
          const url = demo || !remote ? dataUrl : await remote.uploadSiteImage(this.app.data.agencyId, dataUrl, kind);
          set(this.draft as unknown as Record<string, unknown>, input.dataset.img!, url);
          this.preview(true);
        } catch (err) {
          this.app.toast((err as Error).message);
        }
      }),
    );
    el.querySelectorAll<HTMLButtonElement>('[data-noimg]').forEach((b) =>
      b.addEventListener('click', () => {
        set(this.draft as unknown as Record<string, unknown>, b.dataset.noimg!, '');
        this.preview(true);
      }),
    );
    el.querySelector('[data-undo]')?.addEventListener('click', () => {
      this.draft = JSON.parse(this.saved) as SiteConfig;
      this.preview(true);
    });
    el.querySelector('[data-save]')?.addEventListener('click', () => void this.save());
    el.querySelector('[data-export]')?.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(this.draft, null, 2) + '\n'], { type: 'application/json' }));
      a.download = `site-${this.app.data.slug}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    el.querySelector('[data-reset]')?.addEventListener('click', () => {
      if (!confirm('Apagar a personalização salva neste navegador e voltar ao site original da demonstração?')) return;
      try {
        localStorage.removeItem(demoDraftKey(this.app.data.slug));
      } catch {
        /* blocked */
      }
      this.leaving = true;
      location.reload();
    });
  }

  private async save(): Promise<void> {
    const { remote, demo, slug, agencyId } = this.app.data;
    this.draft = normalizeSiteConfig(this.draft, this.app.data.orgName);
    const btn = this.el.querySelector<HTMLButtonElement>('[data-save]')!;
    btn.disabled = true;
    try {
      if (demo || !remote) {
        try {
          localStorage.setItem(demoDraftKey(slug), JSON.stringify(this.draft));
        } catch {
          throw new Error('O navegador não deixou salvar (armazenamento cheio ou bloqueado). Tente uma imagem menor.');
        }
      } else await remote.saveSiteConfig(agencyId, this.draft);
      this.saved = JSON.stringify(this.draft);
      this.app.toast(demo ? 'Salvo neste navegador (demonstração).' : 'Site atualizado. Os visitantes já veem as mudanças.');
    } catch (err) {
      this.app.toast((err as Error).message);
    }
    this.preview(true);
  }
}
