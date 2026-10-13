import { describe, expect, it } from 'vitest';
import { leadEmail, waNumber } from '../supabase/functions/notify-lead/email';

describe('lead e-mail', () => {
  const lead = {
    id: 'l', listing_id: 'abc', listing_title: 'Casa <com> quintal', name: 'Maria', email: 'maria@x.com',
    phone: '(47) 98888-7777', message: 'Posso visitar?', created_at: '2026-10-13T15:00:00Z',
  };
  it('subject, WhatsApp reply link, listing link and escaped HTML', () => {
    const m = leadEmail(lead, 'Imobiliária A', 'https://site.com.br/');
    expect(m.subject).toBe('Novo contato: Casa <com> quintal');
    expect(m.text).toMatch(/Nome: Maria/);
    expect(m.text).toMatch(/https:\/\/wa\.me\/5547988887777/);
    expect(m.text).toMatch(/https:\/\/site\.com\.br\/\?imovel=abc/);
    expect(m.html).toMatch(/Casa &lt;com&gt; quintal/);
    expect(m.html).not.toMatch(/<com>/);
  });
  it('phone numbers for wa.me', () => {
    expect(waNumber('47 98888-7777')).toBe('5547988887777');
    expect(waNumber('+55 47 98888-7777')).toBe('5547988887777');
    expect(waNumber('123')).toBeNull();
  });
});
