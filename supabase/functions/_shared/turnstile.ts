// Server-side check of a Cloudflare Turnstile token (the anti-bot widget of the site's forms). No npm imports.
// Secrets: TURNSTILE_SECRET_KEY; TURNSTILE_VERIFY_URL only to point the tests at a fake verifier.

export type Verdict = { ok: true } | { ok: false; status: number; reason: string };

/** Address of the visitor as the platform's proxies report it (Cloudflare first). */
export function clientIp(req: Request): string | null {
  const h = req.headers;
  return h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0].trim() ?? h.get('x-real-ip') ?? null;
}

/** Host name of the page that sent the request (the Origin header), or null when it is missing or malformed. */
export function originHost(req: Request): string | null {
  try {
    return new URL(req.headers.get('origin') ?? '').hostname || null;
  } catch {
    return null;
  }
}

/**
 * Asks Cloudflare whether the token is valid, unused, was issued for this action and, when `host` is known, on the
 * same site that sent it (a token solved on another site does not serve here).
 */
export async function verifyTurnstile(token: string, action: string, ip: string | null, host: string | null = null): Promise<Verdict> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return { ok: false, status: 500, reason: 'a verificação anti-robô não está configurada no servidor' };
  if (!token || token.length > 2048) return { ok: false, status: 403, reason: 'faça a verificação anti-robô e envie de novo' };
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set('remoteip', ip);
  try {
    const r = await fetch(Deno.env.get('TURNSTILE_VERIFY_URL') ?? 'https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const out = (await r.json()) as { success?: boolean; action?: string; hostname?: string; metadata?: { result_with_testing_key?: boolean } };
    // a token of another form (login, for example) does not serve here; test keys report no action and a fixed host
    const testing = out.metadata?.result_with_testing_key === true;
    const sameSite = testing || !host || !out.hostname || out.hostname === host;
    if (out.success === true && (!out.action || out.action === action) && sameSite) return { ok: true };
    return { ok: false, status: 403, reason: 'a verificação anti-robô não foi aceita; recarregue a página e envie de novo' };
  } catch {
    return { ok: false, status: 502, reason: 'não foi possível conferir a verificação anti-robô; tente de novo' };
  }
}
