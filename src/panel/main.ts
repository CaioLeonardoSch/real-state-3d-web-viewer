// Gestão em página inteira (painel.html): the account panel without the map, for the day-to-day work of the team
// (listings, contacts, trash, team) on any computer or phone, WebGL or not.
import '../styles.css';
import { backendConfig } from '../backend/config';

const el = document.querySelector<HTMLElement>('#account-panel')!;
const mapUrl = (id?: string) => {
  const u = new URL(`${import.meta.env.BASE_URL}mapa.html`, location.href);
  if (id) u.searchParams.set('imovel', id);
  return u.href;
};

async function start(): Promise<void> {
  if (!backendConfig) {
    el.innerHTML = `<div class="panel-empty">
      <h2>Gestão de anúncios</h2>
      <p>Esta versão do mapa não tem contas: os anúncios ficam só no navegador. Volte ao mapa para anunciar.</p>
      <a class="btn-primary" href="${mapUrl()}">Abrir o mapa</a>
    </div>`;
    return;
  }
  const [{ RemoteBackend }, { AccountPanel }] = await Promise.all([import('../backend/remote'), import('../ui/account')]);
  const remote = await RemoteBackend.connect(backendConfig.url, backendConfig.key);
  const account = new AccountPanel(el, null, remote, () => {});
  account.openListing = (id) => location.assign(mapUrl(id));
  await account.refresh();
  await account.openFromLink();
}

start()
  .catch((ex: unknown) => {
    el.innerHTML = `<p class="a-error" role="alert">Não foi possível abrir a gestão: ${(ex as Error).message}. Recarregue a página.</p>`;
  })
  .finally(() => el.removeAttribute('aria-busy'));
