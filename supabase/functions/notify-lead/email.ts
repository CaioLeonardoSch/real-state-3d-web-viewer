// Pure e-mail composition for a new lead (shared by the edge function and the unit tests; no Deno APIs).

export interface LeadForEmail {
  id: string;
  listing_id: string | null;
  listing_title: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  /** form (listing), contact (site contact page) or owner ("Anunciar imóvel"). */
  source?: string;
  details?: Record<string, string> | null;
  created_at: string;
}

/** Labels of the answers of the site forms (src/site/pages.ts). */
const DETAIL_LABELS: Record<string, string> = {
  finalidade: 'Finalidade',
  tipo: 'Tipo do imóvel',
  bairro: 'Bairro',
  endereco: 'Endereço',
  valor: 'Valor pretendido',
  area: 'Área',
  quartos: 'Quartos',
  assunto: 'Assunto',
  procura: 'Procura',
  visita: 'Visita pedida',
  horario: 'Horário',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Brazilian phone to a wa.me number ("(47) 99999-0000" → 5547999990000); null when too short. */
export function waNumber(phone: string | null): string | null {
  let d = (phone ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  if (!d.startsWith('55')) d = `55${d}`;
  return d;
}

export function leadEmail(lead: LeadForEmail, orgName: string, siteUrl: string): { subject: string; text: string; html: string } {
  const owner = lead.source === 'owner';
  const title = owner ? 'oferta de imóvel para anunciar' : (lead.listing_title ?? (lead.source === 'contact' ? 'contato pelo site' : 'um imóvel'));
  const about = owner || (!lead.listing_title && lead.source === 'contact') ? title : `"${title}"`;
  const link = lead.listing_id ? `${siteUrl.replace(/\/$/, '')}/mapa.html?imovel=${lead.listing_id}` : siteUrl;
  const details = Object.entries(lead.details ?? {}).filter(([, v]) => v);
  const label = (k: string) => DETAIL_LABELS[k] ?? k;
  const when = new Date(lead.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const wa = waNumber(lead.phone);
  const lines = [
    `Novo contato: ${about} (${orgName}), em ${when}.`,
    '',
    `Nome: ${lead.name ?? '—'}`,
    `E-mail: ${lead.email ?? '—'}`,
    `Telefone: ${lead.phone ?? '—'}`,
    ...details.map(([k, v]) => `${label(k)}: ${v}`),
    '',
    lead.message ? `Mensagem:\n${lead.message}` : 'Sem mensagem.',
    '',
    wa ? `Responder no WhatsApp: https://wa.me/${wa}` : '',
    lead.listing_id ? `Ver o anúncio: ${link}` : '',
    '',
    'Atenda e registre o andamento em Minha conta → Contatos.',
  ].filter((l, i, all) => l !== '' || all[i - 1] !== '');
  const html = `<p>Novo contato: <strong>${esc(about)}</strong> (${esc(orgName)}), em ${esc(when)}.</p>
<table cellpadding="4">
<tr><td>Nome</td><td><strong>${esc(lead.name ?? '—')}</strong></td></tr>
<tr><td>E-mail</td><td>${lead.email ? `<a href="mailto:${esc(lead.email)}">${esc(lead.email)}</a>` : '—'}</td></tr>
<tr><td>Telefone</td><td>${esc(lead.phone ?? '—')}</td></tr>
${details.map(([k, v]) => `<tr><td>${esc(label(k))}</td><td>${esc(v)}</td></tr>`).join('\n')}
</table>
${lead.message ? `<p style="white-space:pre-wrap">${esc(lead.message)}</p>` : ''}
<p>${[wa ? `<a href="https://wa.me/${wa}">Responder no WhatsApp</a>` : '', lead.listing_id ? `<a href="${esc(link)}">Ver o anúncio</a>` : ''].filter(Boolean).join(' · ')}</p>
<p style="color:#666">Atenda e registre o andamento em Minha conta → Contatos.</p>`;
  const subject = owner ? 'Novo imóvel oferecido pelo site' : lead.details?.visita ? `Pedido de visita: ${title} (${lead.details.visita})` : `Novo contato: ${title}`;
  return { subject, text: lines.join('\n'), html };
}
