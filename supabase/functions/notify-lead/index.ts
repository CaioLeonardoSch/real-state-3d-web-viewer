// Edge Function: e-mails the broker (or the client's admins) about a new lead.
// Called by the site right after recording a lead. Safe to call by anyone: it only acts on a lead created in the last
// 10 minutes that was not notified yet, and claims it in one atomic update before sending (notify.ts), so the e-mail
// goes once even when several calls arrive together.
// Secrets: RESEND_API_KEY and LEAD_EMAIL_FROM (e.g. "Contatos <contatos@seudominio.com.br>"), SITE_URL.
// Without RESEND_API_KEY nothing is sent (the lead still shows up in Minha conta → Contatos).
import { cors, json, rest, sendMail } from '../_shared/resend.ts';
import { notifyLead, type ClaimedLead } from './notify.ts';

const FIELDS = 'id,org_id,listing_id,listing_title,assigned_to,source,details,name,email,phone,message,created_at';

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
  const { status, body } = await notifyLead(
    {
      // UPDATE leads SET notified_at = stamp WHERE id = … AND notified_at IS NULL AND … RETURNING …
      claim: async (id, since, stamp) =>
        (
          await db.update<ClaimedLead>(
            `leads?id=eq.${id}&notified_at=is.null&source=in.(form,contact,owner)&created_at=gt.${encodeURIComponent(since)}&select=${FIELDS}`,
            { notified_at: stamp },
          )
        )[0] ?? null,
      release: async (id, stamp) => {
        await db.patch(`leads?id=eq.${id}&notified_at=eq.${encodeURIComponent(stamp)}`, { notified_at: null });
      },
      recipients: async (lead) => {
        const broker = lead.assigned_to
          ? (await db.get<{ email: string | null }>(`profiles?user_id=eq.${lead.assigned_to}&select=email`)).flatMap((p) => (p.email ? [p.email] : []))
          : [];
        if (broker.length) return broker;
        return ((await db.rpc<{ email: string }[]>('org_admin_emails', { p_org: lead.org_id })) ?? []).map((x) => x.email).filter(Boolean);
      },
      orgName: async (orgId) => (await db.get<{ name: string }>(`organizations?id=eq.${orgId}&select=name`))[0]?.name ?? '',
      send: sendMail,
      siteUrl: Deno.env.get('SITE_URL') ?? '',
    },
    leadId,
  );
  return json(body, status);
});
