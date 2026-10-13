// Pure e-mail composition for a new lead (shared by the edge function and the unit tests; no Deno APIs).

export interface LeadForEmail {
  id: string;
  listing_id: string | null;
  listing_title: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  created_at: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Brazilian phone to a wa.me number ("(47) 99999-0000" → 5547999990000); null when too short. */
export function waNumber(phone: string | null): string | null {
  let d = (phone ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  if (!d.startsWith('55')) d = `55${d}`;
  return d;
}

export function leadEmail(lead: LeadForEmail, orgName: string, siteUrl: string): { subject: string; text: string; html: string } {
  const title = lead.listing_title ?? 'um imóvel';
  const link = lead.listing_id ? `${siteUrl.replace(/\/$/, '')}/?imovel=${lead.listing_id}` : siteUrl;
  const when = new Date(lead.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const wa = waNumber(lead.phone);
  const lines = [
    `Novo contato sobre "${title}" (${orgName}), em ${when}.`,
    '',
    `Nome: ${lead.name ?? '—'}`,
    `E-mail: ${lead.email ?? '—'}`,
    `Telefone: ${lead.phone ?? '—'}`,
    '',
    lead.message ? `Mensagem:\n${lead.message}` : 'Sem mensagem.',
    '',
    wa ? `Responder no WhatsApp: https://wa.me/${wa}` : '',
    `Ver o anúncio: ${link}`,
    '',
    'Atenda e registre o andamento em Minha conta → Contatos.',
  ].filter((l, i, all) => l !== '' || all[i - 1] !== '');
  const html = `<p>Novo contato sobre <strong>${esc(title)}</strong> (${esc(orgName)}), em ${esc(when)}.</p>
<table cellpadding="4">
<tr><td>Nome</td><td><strong>${esc(lead.name ?? '—')}</strong></td></tr>
<tr><td>E-mail</td><td>${lead.email ? `<a href="mailto:${esc(lead.email)}">${esc(lead.email)}</a>` : '—'}</td></tr>
<tr><td>Telefone</td><td>${esc(lead.phone ?? '—')}</td></tr>
</table>
${lead.message ? `<p style="white-space:pre-wrap">${esc(lead.message)}</p>` : ''}
<p>${wa ? `<a href="https://wa.me/${wa}">Responder no WhatsApp</a> · ` : ''}<a href="${esc(link)}">Ver o anúncio</a></p>
<p style="color:#666">Atenda e registre o andamento em Minha conta → Contatos.</p>`;
  return { subject: `Novo contato: ${title}`, text: lines.join('\n'), html };
}
