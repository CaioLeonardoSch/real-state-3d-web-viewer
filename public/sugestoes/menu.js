// Menu do celular das páginas de sugestão: uma gaveta com os links da página e, embaixo, as outras sugestões, para
// comparar pulando de uma para outra. `botao` é o ☰ da página (ou um criado aqui, dentro de `onde`).

const SUGESTOES = [
  ['sugestao1.html', 'Cidade viva'],
  ['sugestao2.html', 'Editorial'],
  ['sugestao3.html', 'Transparência'],
  ['sugestao-imovel.html?id=apt-09', 'Página do imóvel'],
];

export function menuCelular({ links, botao = null, onde = null, cta = null }) {
  if (!botao) {
    botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'menu-celular';
    botao.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h14M3 14h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    onde.appendChild(botao);
  }
  botao.setAttribute('aria-label', 'Abrir menu');
  botao.setAttribute('aria-expanded', 'false');
  botao.setAttribute('aria-controls', 'gaveta');

  const atual = location.pathname.split('/').pop();
  const gaveta = document.createElement('div');
  gaveta.className = 'gaveta';
  gaveta.id = 'gaveta';
  gaveta.hidden = true;
  gaveta.innerHTML = `<div class="gaveta-fundo" data-fechar></div>
    <nav class="gaveta-painel" aria-label="Menu">
      <button type="button" class="gaveta-fechar" data-fechar aria-label="Fechar menu">×</button>
      <ul class="gaveta-links">${links.map(([href, rotulo]) => `<li><a href="${href}" data-fechar>${rotulo}</a></li>`).join('')}</ul>
      ${cta ? `<a class="gaveta-cta" href="${cta[0]}" data-fechar>${cta[1]}</a>` : ''}
      <div class="gaveta-sugestoes"><span>Comparar com outra sugestão</span>
        ${SUGESTOES.map(([href, rotulo]) => `<a href="${href}"${href.startsWith(atual) ? ' aria-current="page"' : ''}>${rotulo}</a>`).join('')}
        <a href="sugestoes.html">Todas as sugestões</a>
      </div>
    </nav>`;
  document.body.appendChild(gaveta);

  const abrir = () => {
    gaveta.hidden = false;
    requestAnimationFrame(() => gaveta.classList.add('aberta'));
    botao.setAttribute('aria-expanded', 'true');
    document.documentElement.style.overflow = 'hidden';
    gaveta.querySelector('.gaveta-links a')?.focus();
  };
  const fechar = () => {
    gaveta.classList.remove('aberta');
    botao.setAttribute('aria-expanded', 'false');
    document.documentElement.style.overflow = '';
    setTimeout(() => (gaveta.hidden = true), 300);
  };
  botao.addEventListener('click', abrir);
  gaveta.addEventListener('click', (e) => e.target.closest('[data-fechar]') && fechar());
  addEventListener('keydown', (e) => e.key === 'Escape' && !gaveta.hidden && (fechar(), botao.focus()));
}
