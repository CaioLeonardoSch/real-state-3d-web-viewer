// Contacts as a spreadsheet (CSV opened by Excel and Google Sheets in Portuguese): ";" between columns, a BOM so the
// accents come out right, and no cell that a spreadsheet would run as a formula.
import { LEAD_STATUS_LABELS, type Lead, type ListingStats, type Member } from './remote';

const SOURCE_LABELS: Record<Lead['source'], string> = {
  form: 'Anúncio',
  contact: 'Contato pelo site',
  owner: 'Quer anunciar (pelo site)',
  whatsapp: 'WhatsApp',
};

/** One cell: quoted when needed; text starting with = + - @ gets a ' so it is not read as a formula (CSV injection). */
export function csvCell(v: string | null | undefined): string {
  let s = (v ?? '').replace(/\r\n?/g, '\n');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function leadsCsv(leads: Lead[], members: Member[] = []): string {
  const who = new Map(members.map((m) => [m.userId, m.name || m.email || '']));
  const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const head = ['Data', 'Nome', 'E-mail', 'Telefone', 'Origem', 'Anúncio', 'Mensagem', 'Detalhes', 'Situação', 'Responsável', 'Anotações'];
  const rows = leads.map((l) => [
    when(l.createdAt),
    l.name,
    l.email,
    l.phone,
    SOURCE_LABELS[l.source],
    l.listingTitle,
    l.message,
    l.details ? Object.entries(l.details).map(([k, v]) => `${k}: ${v}`).join('; ') : '',
    LEAD_STATUS_LABELS[l.status],
    l.assignedTo ? (who.get(l.assignedTo) ?? '') : '',
    l.notes,
  ]);
  return `﻿${[head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

/** "Desempenho dos anúncios" as a spreadsheet: one row per listing, numbers as plain digits. */
export function statsCsv(rows: ListingStats[], days: number): string {
  const head = ['Anúncio', 'Código', 'Situação', `Visualizações no mapa (${days} dias)`, 'Visualizações no site', 'Cliques no WhatsApp', 'Mensagens'];
  const body = rows.map((r) => [
    r.title,
    r.referenceCode,
    r.published ? 'Publicado' : 'Rascunho',
    String(r.viewsMap),
    String(r.viewsSite),
    String(r.whatsapp),
    String(r.messages),
  ]);
  return `\uFEFF${[head, ...body].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
