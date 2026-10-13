// Edge Function: e-mails the broker (or the client's admins) about a new lead.
// Called by the site right after submit_lead. Safe to call by anyone: it only acts on a lead created in the last
// 10 minutes that was not notified yet, and only once.
// Secrets: RESEND_API_KEY and LEAD_EMAIL_FROM (e.g. "Contatos <contatos@seudominio.com.br>"), SITE_URL.
// Without RESEND_API_KEY nothing is sent (the lead still shows up in Minha conta → Contatos).
// No npm imports: plain fetch to the database API (PostgREST) with the service key, so the function boots without
// downloading anything.
import { leadEmail, type LeadForEmail } from './email.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405);
  let leadId: string | undefined;
  try {
    leadId = (await req.json()).lead_id;
  } catch {
    return json({ error: 'corpo inválido' }, 400);
  }
  if (!leadId || !/^[0-9a-f-]{36}$/.test(leadId)) return json({ error: 'lead_id inválido' }, 400);

  const base = `${Deno.env.get('SUPABASE_URL')}/rest/v1`;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const headers = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' };
  const get = async <T>(path: string): Promise<T[]> => {
    const r = await fetch(`${base}/${path}`, { headers });
    return r.ok ? ((await r.json()) as T[]) : [];
  };
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const [lead] = await get<LeadForEmail & { org_id: string; assigned_to: string | null }>(
    `leads?id=eq.${leadId}&source=eq.form&notified_at=is.null&created_at=gt.${encodeURIComponent(since)}` +
      '&select=id,org_id,listing_id,listing_title,assigned_to,name,email,phone,message,created_at',
  );
  if (!lead) return json({ sent: false, reason: 'nada a avisar' });

  // the broker in charge; without one, the client's owners and admins
  let to: string[] = [];
  if (lead.assigned_to) to = (await get<{ email: string | null }>(`profiles?user_id=eq.${lead.assigned_to}&select=email`)).flatMap((p) => (p.email ? [p.email] : []));
  if (!to.length) {
    const r = await fetch(`${base}/rpc/org_admin_emails`, { method: 'POST', headers, body: JSON.stringify({ p_org: lead.org_id }) });
    to = r.ok ? ((await r.json()) as { email: string }[]).map((x) => x.email).filter(Boolean) : [];
  }
  const [org] = await get<{ name: string }>(`organizations?id=eq.${lead.org_id}&select=name`);
  const mail = leadEmail(lead, org?.name ?? '', Deno.env.get('SITE_URL') ?? '');
  const key = Deno.env.get('RESEND_API_KEY');
  if (!to.length) return json({ sent: false, reason: 'sem destinatário' });
  if (!key) return json({ sent: false, reason: 'RESEND_API_KEY não configurada', to, subject: mail.subject });

  const r = await fetch(Deno.env.get('RESEND_API_URL') ?? 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('LEAD_EMAIL_FROM') ?? 'Contatos <onboarding@resend.dev>',
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      ...(lead.email ? { reply_to: lead.email } : {}),
    }),
  });
  if (!r.ok) return json({ sent: false, reason: `envio recusado (${r.status})` }, 502);
  await fetch(`${base}/leads?id=eq.${lead.id}`, { method: 'PATCH', headers, body: JSON.stringify({ notified_at: new Date().toISOString() }) });
  return json({ sent: true, to: to.length });
});
