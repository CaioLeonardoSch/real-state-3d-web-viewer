// Contact forms of the site (listing, contact page, "Anunciar imóvel"): same fields, consent (LGPD) and the
// honeypot field of the back end (submit_lead / submit_site_lead).
import type { LeadInput } from '../backend/remote';
import { escapeHtml } from '../utils/format';

export interface ExtraField {
  name: string;
  label: string;
  type?: 'text' | 'select';
  options?: string[];
  placeholder?: string;
  inputmode?: 'numeric' | 'text';
}

let seq = 0;

export function leadFormHtml(opts: { orgName: string; message?: string; submitLabel: string; extra?: ExtraField[]; messageLabel?: string }): string {
  const id = `lf${++seq}`;
  const field = (f: ExtraField) =>
    f.type === 'select'
      ? `<label class="fld"><span>${escapeHtml(f.label)}</span><select name="x-${escapeHtml(f.name)}"><option value="">Selecione</option>${(f.options ?? [])
          .map((o) => `<option>${escapeHtml(o)}</option>`)
          .join('')}</select></label>`
      : `<label class="fld"><span>${escapeHtml(f.label)}</span><input name="x-${escapeHtml(f.name)}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} placeholder="${escapeHtml(f.placeholder ?? '')}" maxlength="200"></label>`;
  return `<form class="lead" novalidate>
    ${opts.extra?.length ? `<div class="fld-grid">${opts.extra.map(field).join('')}</div>` : ''}
    <label class="fld"><span>Nome</span><input name="name" autocomplete="name" required maxlength="120"></label>
    <div class="fld-grid">
      <label class="fld"><span>Telefone / WhatsApp</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="30" placeholder="(47) 99999-9999"></label>
      <label class="fld"><span>E-mail</span><input name="email" type="email" autocomplete="email" maxlength="120"></label>
    </div>
    <label class="fld"><span>${escapeHtml(opts.messageLabel ?? 'Mensagem')}</span><textarea name="message" rows="3" maxlength="2000">${escapeHtml(opts.message ?? '')}</textarea></label>
    <label class="hp" aria-hidden="true">Não preencha<input name="website" tabindex="-1" autocomplete="off"></label>
    <label class="consent"><input type="checkbox" name="consent" id="${id}-c"> <span>Concordo em compartilhar meus dados com ${escapeHtml(opts.orgName)} para receber o atendimento.</span></label>
    <p class="form-msg" role="status" aria-live="polite"></p>
    <button type="submit" class="btn btn-primary btn-block">${escapeHtml(opts.submitLabel)}</button>
  </form>`;
}

/** Validates in the browser (the server validates again) and calls `send`; null = sent. */
export function wireLeadForm(
  form: HTMLFormElement,
  send: (input: LeadInput, details: Record<string, string>) => Promise<string | null>,
  done: string,
): void {
  const msg = form.querySelector<HTMLElement>('.form-msg')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const get = (k: string) => String(fd.get(k) ?? '').trim();
    const consent = form.querySelector<HTMLInputElement>('[name=consent]')!;
    const phone = get('phone').replace(/\D/g, '');
    const email = get('email');
    let error = '';
    if (!get('name')) error = 'Informe seu nome.';
    else if (!email && phone.length < 10) error = 'Informe um telefone com DDD ou um e-mail.';
    else if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) error = 'O e-mail parece incompleto.';
    else if (!consent.checked) error = 'Marque a concordância para enviarmos seus dados à imobiliária.';
    msg.className = 'form-msg';
    if (error) {
      msg.textContent = error;
      msg.classList.add('err');
      return;
    }
    const details: Record<string, string> = {};
    for (const [k, v] of fd) if (k.startsWith('x-') && String(v).trim()) details[k.slice(2)] = String(v).trim().slice(0, 200);
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    btn.disabled = true;
    msg.textContent = 'Enviando…';
    const result = await send(
      {
        name: get('name'),
        email,
        phone: get('phone'),
        message: get('message'),
        consentText: consent.nextElementSibling!.textContent!.trim(),
        trap: get('website'),
      },
      details,
    ).catch((err: Error) => err.message);
    btn.disabled = false;
    if (result) {
      msg.textContent = result;
      msg.classList.add('err');
      return;
    }
    form.reset();
    msg.textContent = done;
    msg.classList.add('ok');
  });
}
