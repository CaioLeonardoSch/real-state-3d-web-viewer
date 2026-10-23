// Edge Function: creates a team member's account with a temporary password, shown once to whoever created it.
// The support staff creates the agency's administrator (one per agency); the administrator, or the support staff,
// creates the brokers. Who may create what is decided by the database with the caller's own token
// (can_create_member); the account itself needs the service key (Auth admin API). The person changes the password
// on the first login (password_change_required).
import { cors, json } from '../_shared/resend.ts';

const ROLES = new Set(['owner', 'agent']);
// no look-alike characters (0/O, 1/l/I): the password is read on the screen and typed by someone else
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function tempPassword(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405);
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'login necessário' }, 401);
  let body: { org_id?: string; email?: string; name?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'corpo inválido' }, 400);
  }
  const org = body.org_id ?? '';
  const email = (body.email ?? '').trim().toLowerCase();
  const name = (body.name ?? '').trim().slice(0, 120);
  const role = body.role ?? '';
  if (!/^[0-9a-f-]{36}$/.test(org)) return json({ error: 'imobiliária inválida' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return json({ error: 'e-mail inválido' }, 400);
  if (!ROLES.has(role)) return json({ error: 'papel inválido' }, 400);

  // as the caller: support staff (with the second factor) or the agency's administrator
  // (not rest().rpc: there a failed call is null too, which here means "allowed")
  const check = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/can_create_member`, {
    method: 'POST',
    headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY')!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_org: org, p_role: role }),
  });
  const denied = check.ok ? ((await check.json()) as string | null) : 'sem permissão';
  if (denied !== null) return json({ error: denied }, 403);
  const me = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY')! } });
  const by = me.ok ? ((await me.json()) as { id: string }).id : null;

  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const password = tempPassword();
  const created = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${service}`, apikey: service, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } }),
  });
  if (!created.ok) {
    const text = await created.text();
    return /already|exists|registered/i.test(text)
      ? json({ error: 'este e-mail já tem conta: peça ao suporte para ligar a conta à imobiliária' }, 409)
      : json({ error: 'não foi possível criar a conta' }, 502);
  }
  const user = (await created.json()) as { id: string };
  const attached = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/attach_created_member`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${service}`, apikey: service, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_org: org, p_user: user.id, p_role: role, p_name: name, p_by: by }),
  });
  if (!attached.ok) {
    // no half-made account left behind: without the membership the person could not do anything with it
    await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${service}`, apikey: service },
    });
    const text = await attached.text();
    return json({ error: /administrador/.test(text) ? 'esta imobiliária já tem administrador' : 'não foi possível ligar a conta à imobiliária' }, 409);
  }
  return json({ user_id: user.id, email, password });
});
