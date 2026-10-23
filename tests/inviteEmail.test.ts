import { describe, expect, it } from 'vitest';
import { inviteEmail } from '../supabase/functions/send-invite/email';

describe('invitation e-mail', () => {
  it('link with the token, role, inviter, validity and escaped names', () => {
    const m = inviteEmail(
      { email: 'bruno@x.com', role: 'agent', token: 'abc-123', expires_at: '2026-10-27T12:00:00Z' },
      'Imobiliária <A>',
      'Ana',
      'https://site.com.br/app/',
    );
    expect(m.subject).toBe('Convite: equipe da Imobiliária <A>');
    expect(m.text).toMatch(/^Ana convidou você para a equipe da Imobiliária <A>, como corretor\(a\)\./);
    expect(m.text).toMatch(/https:\/\/site\.com\.br\/app\/painel\.html\?convite=abc-123/);
    expect(m.text).toMatch(/27\/10\/2026/);
    expect(m.html).toMatch(/Imobiliária &lt;A&gt;/);
    expect(inviteEmail({ email: 'x@y.z', role: 'owner', token: 't', expires_at: '2026-10-27T12:00:00Z' }, 'B', null, 'https://s/').text).toMatch(
      /^Você foi convidado\(a\) para a equipe da B, como dono\(a\)/,
    );
  });
});
