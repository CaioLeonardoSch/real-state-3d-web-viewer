// Pure e-mail composition for an invitation (shared by the edge function and the unit tests; no Deno APIs).

const ROLES: Record<string, string> = { owner: 'dono(a)', admin: 'administrador(a)', agent: 'corretor(a)' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function inviteEmail(
  inv: { email: string; role: string; token: string; expires_at: string },
  orgName: string,
  inviterName: string | null,
  siteUrl: string,
): { subject: string; text: string; html: string } {
  const link = `${siteUrl.replace(/\/$/, '')}/?convite=${inv.token}`;
  const until = new Date(inv.expires_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const role = ROLES[inv.role] ?? 'membro';
  const who = inviterName ? `${inviterName} convidou você` : 'Você foi convidado(a)';
  const text = [
    `${who} para a equipe da ${orgName}, como ${role}.`,
    '',
    `Para aceitar, abra o link abaixo e entre (ou crie sua conta) com este e-mail, ${inv.email}:`,
    link,
    '',
    `O convite vale até ${until} e só funciona com este e-mail.`,
    'Se você não esperava este convite, pode ignorar esta mensagem.',
  ].join('\n');
  const html = `<p>${esc(who)} para a equipe da <strong>${esc(orgName)}</strong>, como ${esc(role)}.</p>
<p><a href="${esc(link)}" style="display:inline-block;padding:10px 16px;background:#f28c18;color:#fff;border-radius:8px;text-decoration:none">Aceitar o convite</a></p>
<p>Entre (ou crie sua conta) com este e-mail: <strong>${esc(inv.email)}</strong>.</p>
<p style="color:#666">O convite vale até ${esc(until)} e só funciona com este e-mail. Se você não esperava este convite, pode ignorar esta mensagem.</p>`;
  return { subject: `Convite: equipe da ${orgName}`, text, html };
}
