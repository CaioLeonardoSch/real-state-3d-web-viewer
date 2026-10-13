// Edge Function: e-mails the broker (or the client's admins) about a new lead.
// Called by the site right after submit_lead. Safe to call by anyone: it only acts on a lead created in the last
// 10 minutes that was not notified yet, and only once.
// Secrets: RESEND_API_KEY and LEAD_EMAIL_FROM (e.g. "Contatos <contatos@seudominio.com.br>"), SITE_URL.
// Without RESEND_API_KEY nothing is sent (the lead still shows up in Minha conta → Contatos).
import { cors, json, rest, sendMail } from '../_shared/resend.ts';
import { leadEmail, type LeadForEmail } from './email.ts';

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

  const db = rest();
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const [lead] = await db.get<LeadForEmail & { org_id: string; assigned_to: string | null }>(
    `leads?id=eq.${leadId}&source=in.(form,contact,owner)&notified_at=is.null&created_at=gt.${encodeURIComponent(since)}` +
      '&select=id,org_id,listing_id,listing_title,assigned_to,source,details,name,email,phone,message,created_at',
  );
  if (!lead) return json({ sent: false, reason: 'nada a avisar' });

  // the broker in charge; without one, the client's owners and admins
  let to: string[] = [];
  if (lead.assigned_to) to = (await db.get<{ email: string | null }>(`profiles?user_id=eq.${lead.assigned_to}&select=email`)).flatMap((p) => (p.email ? [p.email] : []));
  if (!to.length) to = ((await db.rpc<{ email: string }[]>('org_admin_emails', { p_org: lead.org_id })) ?? []).map((x) => x.email).filter(Boolean);
  if (!to.length) return json({ sent: false, reason: 'sem destinatário' });
  const [org] = await db.get<{ name: string }>(`organizations?id=eq.${lead.org_id}&select=name`);
  const mail = leadEmail(lead, org?.name ?? '', Deno.env.get('SITE_URL') ?? '');
  const result = await sendMail({ to, ...mail, replyTo: lead.email });
  if (!result.sent) return json({ ...result, to: to.length }, result.reason.startsWith('envio') ? 502 : 200);
  await db.patch(`leads?id=eq.${lead.id}`, { notified_at: new Date().toISOString() });
  return json({ sent: true, to: to.length });
});
