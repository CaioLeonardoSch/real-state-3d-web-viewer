// Shared by the edge functions: e-mail through Resend (https://resend.com), and small helpers.
// No npm imports, so the functions boot without downloading anything.

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export interface Mail {
  to: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string | null;
}

/** Sends through Resend. Without RESEND_API_KEY nothing is sent and the reason is returned. */
export async function sendMail(m: Mail): Promise<{ sent: true } | { sent: false; reason: string }> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { sent: false, reason: 'RESEND_API_KEY não configurada' };
  const r = await fetch(Deno.env.get('RESEND_API_URL') ?? 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('LEAD_EMAIL_FROM') ?? 'Contatos <onboarding@resend.dev>',
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
      ...(m.replyTo ? { reply_to: m.replyTo } : {}),
    }),
  });
  return r.ok ? { sent: true } : { sent: false, reason: `envio recusado (${r.status})` };
}

/** Database API (PostgREST) with the service key, or with the caller's token (then row-level security applies). */
export function rest(authorization?: string) {
  const base = `${Deno.env.get('SUPABASE_URL')}/rest/v1`;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const headers = {
    apikey: authorization ? Deno.env.get('SUPABASE_ANON_KEY')! : service,
    Authorization: authorization ?? `Bearer ${service}`,
    'Content-Type': 'application/json',
  };
  return {
    async get<T>(path: string): Promise<T[]> {
      const r = await fetch(`${base}/${path}`, { headers });
      return r.ok ? ((await r.json()) as T[]) : [];
    },
    async rpc<T>(fn: string, args: unknown): Promise<T | null> {
      const r = await fetch(`${base}/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
      return r.ok ? ((await r.json()) as T) : null;
    },
    patch: (path: string, body: unknown) => fetch(`${base}/${path}`, { method: 'PATCH', headers, body: JSON.stringify(body) }),
    /** PATCH returning the rows it changed: none when the filters no longer match (one atomic UPDATE … WHERE). */
    async update<T>(path: string, body: unknown): Promise<T[]> {
      const r = await fetch(`${base}/${path}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(body) });
      return r.ok ? ((await r.json()) as T[]) : [];
    },
  };
}
