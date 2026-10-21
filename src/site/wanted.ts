// "Não achou? Conte o que procura": a short form where the visitor describes the property they want, so the agency calls
// back when one comes in (it may have it off the site, too). On the search with no results, filled in with that search,
// and as a section of the home page. It goes in as a contact (source 'contact') with the search in its details: the
// panel and the e-mail already show it, with no new kind of lead in the back end.
import { DEMO } from '../data/demo';
import { escapeHtml } from '../utils/format';
import type { SiteApp } from './app';
import { leadFormHtml, wireLeadForm } from './forms';

/** The section; `search` is the label of the search that found nothing ("Venda · Apartamento · Glória"), or null. */
export function wantedHtml(app: SiteApp, search: string | null): string {
  const c = app.config;
  return `<section class="wanted" aria-labelledby="wanted-title">
    <h2 id="wanted-title">Não achou o imóvel certo?</h2>
    <p>Conte o que você procura. A ${escapeHtml(c.name)} avisa quando entrar um imóvel assim, inclusive os que ainda não estão no site.</p>
    ${leadFormHtml({
      orgName: c.name,
      submitLabel: 'Me avise quando entrar',
      captcha: !app.data.demo,
      messageLabel: 'O que você procura (tipo, bairro, quartos, valor)',
      message: search ? `Procuro: ${search}.` : '',
    })}
  </section>`;
}

export function wireWanted(app: SiteApp, root: HTMLElement, search: string | null): void {
  const form = root.querySelector<HTMLFormElement>('.wanted form.lead');
  if (!form) return;
  wireLeadForm(
    form,
    async (input, details) => {
      if (app.data.demo || !app.data.remote) return null;
      await app.data.remote.submitSiteLead(app.data.agencyId, 'contact', input, {
        ...details,
        assunto: 'Procuro um imóvel',
        ...(search ? { procura: search } : {}),
      });
      return null;
    },
    DEMO && app.data.demo
      ? 'Demonstração: nada foi enviado. No site real, o pedido chega aos administradores e em Minha conta → Contatos.'
      : 'Recebemos o que você procura. Vamos avisar quando entrar um imóvel assim.',
  );
}
