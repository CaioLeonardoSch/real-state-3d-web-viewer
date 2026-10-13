// Entry of a client's site (site.html). Loads the client's configuration and listings, renders the site and,
// for its owners and admins (or anyone in the demo), the "Personalizar site" editor.
import './site.css';
import { backendConfig } from '../backend/remote';
import { SiteApp } from './app';
import { loadSite } from './data';

async function main() {
  const root = document.getElementById('site')!;
  const params = new URLSearchParams(location.search);
  const data = await loadSite(params, backendConfig);
  // pages built at publish time (scripts/prerender.mjs): canonical address of each listing for search engines
  try {
    const r = await fetch(new URL(`${import.meta.env.BASE_URL}data/pages.json`, location.href));
    if (r.ok) (window as unknown as { __sitePages: Record<string, string> }).__sitePages = await r.json();
  } catch {
    /* optional */
  }
  // the demo sites are fictional: keep them out of search results
  if (data.demo) document.head.insertAdjacentHTML('beforeend', '<meta name="robots" content="noindex">');
  const app = new SiteApp(root, data);
  app.load(false);
  root.removeAttribute('aria-busy');

  // "Personalizar site": ?editar=1, or the button shown to whoever can edit
  let editor: import('./editor').SiteEditor | null = null;
  const openEditor = async () => {
    const { SiteEditor } = await import('./editor');
    editor ??= new SiteEditor(app);
    await editor.open();
  };
  let editing = params.get('editar') === '1';
  if (editing) await openEditor();
  const canEdit = data.demo || (await data.remote?.canEditSite(data.agencyId));
  if (canEdit) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'edit-fab';
    btn.textContent = 'Personalizar site';
    btn.hidden = editing;
    btn.addEventListener('click', async () => {
      editing = true;
      btn.hidden = true;
      const url = new URL(location.href);
      url.searchParams.set('editar', '1');
      history.replaceState(null, '', url);
      await openEditor();
    });
    new MutationObserver(() => (btn.hidden = document.body.classList.contains('editing'))).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.body.append(btn);
  }
  document.body.dataset.ready = 'true';
  // hook for the browser checks (scripts/e2e-site.mjs)
  (window as unknown as { __site: unknown }).__site = { app, data };
}

main().catch((err: Error) => {
  console.error(err);
  const root = document.getElementById('site')!;
  root.removeAttribute('aria-busy');
  root.innerHTML = `<div class="site-error"><h1>Não foi possível abrir o site</h1><p></p></div>`;
  root.querySelector('p')!.textContent = err.message;
});
