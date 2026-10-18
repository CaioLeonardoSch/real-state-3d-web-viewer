// Edge Function: records a visitor's message (listing, contact page, "Anunciar imóvel") after checking the anti-bot
// token (Cloudflare Turnstile) on the server, then with the service key, passing on the visitor's address for the
// per-origin limits. Used when the site is built with VITE_TURNSTILE_SITE_KEY; with private_settings.lead_captcha =
// 'on' the database refuses messages that do not come through here. Secrets: TURNSTILE_SECRET_KEY.
import { cors, json } from '../_shared/resend.ts';
import { clientIp, originHost, verifyTurnstile } from '../_shared/turnstile.ts';

// the arguments each database function takes from the browser (p_client_ip is set here, never by the browser)
const ARGS: Record<string, string[]> = {
  submit_lead: ['p_listing', 'p_source', 'p_name', 'p_email', 'p_phone', 'p_message', 'p_consent', 'p_consent_text', 'p_trap', 'p_visit_on', 'p_visit_period'],
  submit_site_lead: ['p_org', 'p_source', 'p_name', 'p_email', 'p_phone', 'p_message', 'p_details', 'p_consent', 'p_consent_text', 'p_trap'],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405);
  let body: { fn?: string; args?: Record<string, unknown>; captcha_token?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'pedido inválido' }, 400);
  }
  const names = ARGS[String(body.fn)];
  const given = body.args;
  // WhatsApp clicks (no personal data) go straight to the database
  if (!names || !given || typeof given !== 'object' || (body.fn === 'submit_lead' && given.p_source !== 'form')) return json({ error: 'pedido inválido' }, 400);
  const ip = clientIp(req);
  const verdict = await verifyTurnstile(typeof body.captcha_token === 'string' ? body.captcha_token : '', 'lead', ip, originHost(req));
  if (!verdict.ok) return json({ error: verdict.reason }, verdict.status);

  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const args = Object.fromEntries(names.filter((k) => k in given).map((k) => [k, given[k]]));
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${body.fn}`, {
    method: 'POST',
    headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...args, p_client_ip: ip }),
  });
  const out = await r.json().catch(() => null);
  // the database's messages are written for the visitor ("informe seu nome", "muitos envios em pouco tempo"…)
  if (!r.ok) return json({ error: (out as { message?: string } | null)?.message ?? 'não foi possível enviar' }, r.status >= 500 ? 502 : 400);
  return json({ id: out });
});
