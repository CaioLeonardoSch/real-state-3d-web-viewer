// Edge Function: e-mails an invitation link to the invited person.
// Called by the site right after an owner/admin (or the support staff) creates an invitation. The caller's own token
// is used to read the invitation, so row-level security guarantees they may manage it; each invitation is e-mailed once.
import { cors, json, rest, sendMail } from '../_shared/resend.ts';
import { inviteEmail } from './email.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405);
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'login necessário' }, 401);
  let token: string | undefined;
  try {
    token = (await req.json()).token;
  } catch {
    return json({ error: 'corpo inválido' }, 400);
  }
  if (!token || !/^[0-9a-f-]{36}$/.test(token)) return json({ error: 'token inválido' }, 400);

  // as the caller: only an admin of the client (or support) sees the invitation
  const [inv] = await rest(auth).get<{ id: string; org_id: string; email: string; role: string; token: string; expires_at: string; invited_by: string | null; emailed_at: string | null; accepted_at: string | null }>(
    `invitations?token=eq.${token}&select=id,org_id,email,role,token,expires_at,invited_by,emailed_at,accepted_at`,
  );
  if (!inv) return json({ sent: false, reason: 'convite não encontrado' }, 404);
  if (inv.emailed_at || inv.accepted_at) return json({ sent: false, reason: 'já enviado' });

  const db = rest();
  const [org] = await db.get<{ name: string }>(`organizations?id=eq.${inv.org_id}&select=name`);
  const [inviter] = inv.invited_by ? await db.get<{ full_name: string | null }>(`profiles?user_id=eq.${inv.invited_by}&select=full_name`) : [];
  const mail = inviteEmail(inv, org?.name ?? '', inviter?.full_name ?? null, Deno.env.get('SITE_URL') ?? '');
  const result = await sendMail({ to: [inv.email], ...mail });
  if (!result.sent) return json(result, result.reason.startsWith('envio') ? 502 : 200);
  await db.patch(`invitations?id=eq.${inv.id}`, { emailed_at: new Date().toISOString() });
  return json({ sent: true });
});
