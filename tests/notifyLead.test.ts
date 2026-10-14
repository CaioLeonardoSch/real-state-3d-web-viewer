import { describe, expect, it } from 'vitest';
import { notifyLead, type ClaimedLead, type NotifyDeps } from '../supabase/functions/notify-lead/notify';

const NOW = Date.parse('2026-10-14T12:05:00Z');
const LEAD: ClaimedLead = {
  id: 'l1', org_id: 'o1', assigned_to: 'u1', listing_id: 'a1', listing_title: 'Casa', source: 'form', details: null,
  name: 'Maria', email: 'maria@x.com', phone: '47999990000', message: 'Posso visitar?', created_at: '2026-10-14T12:00:00.000Z',
};

/** In-memory leads table with the database's semantics: the claim is one conditional update, atomic per row. */
function fakeDb(opts: { createdAt?: string; send?: () => { sent: true } | { sent: false; reason: string }; recipients?: string[] } = {}) {
  const row = { ...LEAD, created_at: opts.createdAt ?? LEAD.created_at, notified_at: null as string | null };
  const sent: { to: string[]; subject: string; replyTo?: string | null }[] = [];
  const deps: NotifyDeps = {
    async claim(id, since, stamp) {
      await Promise.resolve(); // simultaneous calls interleave here
      if (id !== row.id || row.notified_at !== null || row.created_at <= since) return null;
      row.notified_at = stamp;
      return { ...LEAD };
    },
    async release(id, stamp) {
      if (id === row.id && row.notified_at === stamp) row.notified_at = null;
    },
    recipients: async () => opts.recipients ?? ['corretor@x.com'],
    orgName: async () => 'Imobiliária A',
    async send(m) {
      await new Promise((r) => setTimeout(r, 5)); // the e-mail provider takes a while
      const r = opts.send?.() ?? { sent: true as const };
      if (r.sent) sent.push(m);
      return r;
    },
    siteUrl: 'https://site.com/',
  };
  return { row, sent, deps };
}

describe('aviso de contato por e-mail (notify-lead)', () => {
  it('chamadas simultâneas: um e-mail só', async () => {
    const { row, sent, deps } = fakeDb();
    const results = await Promise.all(Array.from({ length: 5 }, () => notifyLead(deps, 'l1', NOW)));
    expect(results.filter((r) => r.body.sent)).toHaveLength(1);
    expect(results.filter((r) => !r.body.sent).every((r) => r.body.reason === 'nada a avisar')).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ['corretor@x.com'], subject: 'Novo contato: Casa', replyTo: 'maria@x.com' });
    expect(row.notified_at).toBe(new Date(NOW).toISOString());
    expect((await notifyLead(deps, 'l1', NOW + 1000)).body).toEqual({ sent: false, reason: 'nada a avisar' });
  });

  it('contato antigo (mais de 10 minutos) não é avisado', async () => {
    const { sent, deps } = fakeDb({ createdAt: '2026-10-14T11:50:00.000Z' });
    expect((await notifyLead(deps, 'l1', NOW)).body.sent).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('envio recusado devolve o contato, e a próxima chamada tenta de novo', async () => {
    let fail = true;
    const { row, sent, deps } = fakeDb({ send: () => (fail ? { sent: false, reason: 'envio recusado (500)' } : { sent: true }) });
    const first = await notifyLead(deps, 'l1', NOW);
    expect(first.status).toBe(502);
    expect(row.notified_at).toBeNull();
    fail = false;
    expect((await notifyLead(deps, 'l1', NOW + 1000)).body).toEqual({ sent: true, to: 1 });
    expect(sent).toHaveLength(1);
  });

  it('sem chave do provedor ou sem destinatário: nada sai e o contato fica para depois', async () => {
    const noKey = fakeDb({ send: () => ({ sent: false, reason: 'RESEND_API_KEY não configurada' }) });
    expect(await notifyLead(noKey.deps, 'l1', NOW)).toMatchObject({ status: 200, body: { sent: false, reason: 'RESEND_API_KEY não configurada' } });
    expect(noKey.row.notified_at).toBeNull();
    const nobody = fakeDb({ recipients: [] });
    expect((await notifyLead(nobody.deps, 'l1', NOW)).body).toEqual({ sent: false, reason: 'sem destinatário' });
    expect(nobody.row.notified_at).toBeNull();
  });
});
