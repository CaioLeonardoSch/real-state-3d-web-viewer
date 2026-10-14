// Anti-bot check (Cloudflare Turnstile) on login, sign-up and the contact forms. Inert unless VITE_TURNSTILE_SITE_KEY
// is set at build time; then each form gets a widget, and Cloudflare's script is loaded the first time a form is
// used (not on every page view). The token is checked by Supabase Auth (login) or by the submit-lead edge function.

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '';
export const captchaEnabled = SITE_KEY !== '';

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const UNAVAILABLE = 'A verificação anti-robô não carregou. Confira a conexão e tente de novo.';

interface Turnstile {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
}

let loading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.addEventListener('load', () => {
      const api = (window as unknown as { turnstile?: Turnstile }).turnstile;
      if (api) resolve(api);
      else reject(new Error(UNAVAILABLE));
    });
    script.addEventListener('error', () => {
      // a later attempt may work (connection back)
      loading = null;
      script.remove();
      reject(new Error(UNAVAILABLE));
    });
    document.head.append(script);
  });
  return loading;
}

/** The widget of one form: a fresh single-use token for each submission. */
export class Captcha {
  private api: Turnstile | null = null;
  private widget: string | null = null;
  private mounting: Promise<void> | null = null;
  private token: string | null = null;
  private waiting: { resolve: (token: string) => void; reject: (err: Error) => void }[] = [];

  constructor(
    private box: HTMLElement,
    /** Name of the form for Cloudflare's reports and the server check ("login", "lead"). */
    private action: string,
  ) {}

  /** Loads Turnstile (once per page) and renders the widget; visible only when Cloudflare asks for a click. */
  mount(): Promise<void> {
    this.mounting ??= loadTurnstile().then(
      (api) => {
        this.api = api;
        this.widget = api.render(this.box, {
          sitekey: SITE_KEY,
          action: this.action,
          language: 'pt-br',
          appearance: 'interaction-only',
          callback: (token: string) => {
            this.token = token;
            for (const w of this.waiting.splice(0)) w.resolve(token);
          },
          'expired-callback': () => (this.token = null),
          'error-callback': () => {
            for (const w of this.waiting.splice(0)) w.reject(new Error('A verificação anti-robô falhou. Tente de novo.'));
          },
        });
      },
      (err: Error) => {
        this.mounting = null;
        throw err;
      },
    );
    return this.mounting;
  }

  /** Token for one submission: the one ready, or the next one (at most 30 s). */
  async getToken(): Promise<string> {
    await this.mount();
    const ready = this.token;
    if (ready) {
      this.token = null;
      return ready;
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('A verificação anti-robô demorou demais. Tente de novo.')), 30_000);
      this.waiting.push({
        resolve: (token) => {
          clearTimeout(timer);
          this.token = null;
          resolve(token);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  /** After a submission (the token is spent, even on failure): a new check for the next one. */
  reset(): void {
    this.token = null;
    if (this.api && this.widget !== null) this.api.reset(this.widget);
  }
}

/** Placeholder of the widget inside a form (empty string when the check is off). */
export const captchaBox = (extraClass = '') => (captchaEnabled ? `<div class="captcha-box ${extraClass}"></div>` : '');

/** The widget of a form that has a captchaBox, loaded on the first interaction with the form; null when off. */
export function formCaptcha(form: HTMLElement, action: string): Captcha | null {
  const box = form.querySelector<HTMLElement>('.captcha-box');
  if (!captchaEnabled || !box) return null;
  const captcha = new Captcha(box, action);
  form.addEventListener('focusin', () => void captcha.mount().catch(() => {}), { once: true });
  return captcha;
}
