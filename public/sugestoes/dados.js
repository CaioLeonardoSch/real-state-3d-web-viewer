// Imóveis de exemplo (os mesmos da base de exemplo do site) e cálculos usados pelas páginas de sugestão.
// As imagens são o próprio mapa 3D da cidade no fim da tarde; num site real, ficam as fotos do imóvel.

export const IMOVEIS = [
  { id: 'apt-09', centro: [-48.816185, -26.319925], tipo: 'Apartamento', titulo: 'Apartamento com sacada', quartos: 4, banheiros: 3, vagas: 3, area: 129, bairro: 'Fátima', preco: 1480000, historico: [['2026-07-18', 1735000], ['2026-10-05', 1480000]], condominio: 1180, iptuAno: 2760, andares: 4, codigo: 'EXB-1009', comodidades: ['Sacada', 'Churrasqueira', 'Elevador'] },
  { id: 'apt-03', centro: [-48.907663, -26.206390], tipo: 'Apartamento', titulo: 'Apartamento amplo', quartos: 4, banheiros: 3, vagas: 3, area: 121, bairro: 'Pirabeiraba', preco: 1300000, historico: [['2026-07-18', 1395000], ['2026-09-10', 1300000]], condominio: 800, iptuAno: 2560, andares: 6, codigo: 'EXB-1003', comodidades: ['Piscina', 'Aceita pet', 'Em obras'] },
  { id: 'apt-17', centro: [-48.842927, -26.324290], tipo: 'Apartamento', titulo: 'Apartamento compacto', quartos: 1, banheiros: 1, vagas: 1, area: 53, bairro: 'Floresta', preco: 425000, historico: [['2026-03-06', 470000], ['2026-09-22', 425000]], condominio: 330, iptuAno: 990, andares: 4, codigo: 'EXB-1017', comodidades: ['Perto do parque', 'Elevador'] },
  { id: 'apt-22', centro: [-48.820145, -26.219079], tipo: 'Apartamento', titulo: 'Apartamento garden', quartos: 2, banheiros: 2, vagas: 1, area: 85, bairro: 'Jardim Paraíso', preco: 870000, historico: [['2026-06-08', 990000], ['2026-10-07', 870000]], condominio: 640, iptuAno: 1810, andares: 4, codigo: 'EXB-1022', comodidades: ['Quintal privativo', 'Aceita pet', 'Beira do rio'] },
  { id: 'house-47', centro: [-48.861773, -26.297924], tipo: 'Sobrado', titulo: 'Sobrado familiar', quartos: 5, banheiros: 4, vagas: 2, area: 380, bairro: 'Glória', preco: 2655000, historico: [['2026-03-25', 2955000], ['2026-08-23', 2655000]], condominio: 0, iptuAno: 5150, andares: 2, codigo: 'EXB-1047', comodidades: ['Piscina', 'Escritório', 'Rua tranquila'] },
  { id: 'house-39', centro: [-48.874588, -26.344470], tipo: 'Sobrado', titulo: 'Sobrado entre o verde', quartos: 2, banheiros: 1, vagas: 3, area: 153, bairro: 'Nova Brasília', preco: 1445000, historico: [['2026-05-19', 1610000], ['2026-08-13', 1445000]], condominio: 0, iptuAno: 2770, andares: 2, codigo: 'EXB-1039', comodidades: ['Perto do verde', 'Quintal', 'Aceita pet'] },
  { id: 'apt-04', centro: [-48.778662, -26.288960], tipo: 'Apartamento', titulo: 'Apartamento com vista', quartos: 4, banheiros: 4, vagas: 3, area: 125, bairro: 'Espinheiros', preco: 1070000, historico: [['2026-04-22', 1225000], ['2026-08-21', 1070000]], condominio: 1210, iptuAno: 2480, andares: 4, codigo: 'EXB-1004', comodidades: ['Vista para a baía', 'Sacada', 'Elevador'] },
  { id: 'apt-01', centro: [-48.846068, -26.267002], tipo: 'Apartamento', titulo: 'Apartamento com vista', quartos: 4, banheiros: 4, vagas: 3, area: 135, bairro: 'Bom Retiro', preco: 1115000, historico: [['2026-03-18', 1115000]], condominio: 1170, iptuAno: 1890, andares: 8, codigo: 'EXB-1001', comodidades: ['Churrasqueira', 'Sacada', 'Aceita pet'] },
];

export const BAIRROS = ['América', 'Atiradores', 'Bom Retiro', 'Centro', 'Costa e Silva', 'Espinheiros', 'Floresta', 'Fátima', 'Glória', 'Itaum', 'Jardim Paraíso', 'Nova Brasília', 'Pirabeiraba', 'Saguaçu', 'Santo Antônio', 'Vila Nova'];

export const img = (id) => `sugestoes/img/${id}.jpg`;
export const porId = (id) => IMOVEIS.find((i) => i.id === id) ?? IMOVEIS[0];

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export const brl = (v) => fmt.format(v);
/** "R$ 1,48 mi" / "R$ 425 mil". */
export const brlCurto = (v) =>
  v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi` : `R$ ${Math.round(v / 1e3)} mil`;
export const data = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });

export function desconto(i) {
  const antes = i.historico[0][1];
  if (antes <= i.preco) return null;
  return { antes, diferenca: antes - i.preco, pct: (antes - i.preco) / antes, desde: i.historico[0][0] };
}

/** Parcela pela tabela Price: entrada (fração), anos e juros ao ano. */
export function parcela(preco, entrada = 0.2, anos = 30, jurosAno = 0.115) {
  const i = (1 + jurosAno) ** (1 / 12) - 1;
  const n = anos * 12;
  const pv = preco * (1 - entrada);
  return (pv * i) / (1 - (1 + i) ** -n);
}

export function custoMes(i, entrada = 0.2) {
  const p = parcela(i.preco, entrada);
  const iptu = i.iptuAno / 12;
  return { parcela: p, condominio: i.condominio, iptu, total: p + i.condominio + iptu };
}

/** Gráfico pequeno do preço (degrau no dia da baixa), em SVG. */
export function sparkline(i, { w = 120, h = 36, cor = 'currentColor' } = {}) {
  const pts = [...i.historico];
  const max = Math.max(...pts.map((p) => p[1]));
  const min = Math.min(...pts.map((p) => p[1]));
  const y = (v) => (max === min ? h / 2 : 4 + ((max - v) / (max - min)) * (h - 8));
  const t0 = new Date(pts[0][0]).getTime();
  const t1 = Date.now();
  const x = (d) => ((new Date(d).getTime() - t0) / (t1 - t0 || 1)) * (w - 6) + 3;
  let d = `M3 ${y(pts[0][1])}`;
  for (let k = 1; k < pts.length; k++) d += ` H${x(pts[k][0])} V${y(pts[k][1])}`;
  d += ` H${w - 3}`;
  const fim = y(pts.at(-1)[1]);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" pathLength="1"/>
    <circle cx="${w - 3}" cy="${fim}" r="3" fill="${cor}"/></svg>`;
}

/**
 * Busca por frase, com regras simples: "3 quartos no América até 900 mil com sacada" vira filtros.
 * Devolve as etiquetas entendidas e a função que testa um imóvel.
 */
export function entenderFrase(texto) {
  const t = texto.toLowerCase();
  const etiquetas = [];
  const testes = [];
  const q = t.match(/(\d+)\s*(quartos?|dorm)/);
  if (q) {
    etiquetas.push({ k: 'quartos', v: `${q[1]}+ quartos` });
    testes.push((i) => i.quartos >= Number(q[1]));
  }
  const tipo = /\b(casa|sobrado)/.test(t) ? 'Sobrado' : /\b(ap|apto|apartamento)/.test(t) ? 'Apartamento' : null;
  if (tipo) {
    etiquetas.push({ k: 'tipo', v: tipo === 'Sobrado' ? 'Casa ou sobrado' : 'Apartamento' });
    testes.push((i) => i.tipo === tipo);
  }
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const b = BAIRROS.find((b) => norm(t).includes(norm(b.toLowerCase())));
  if (b) {
    etiquetas.push({ k: 'bairro', v: b });
    testes.push((i) => i.bairro === b);
  }
  const p = t.match(/at[eé]\s*(r\$\s*)?([\d.,]+)\s*(mil|mi|milh[aãõo]+)?/);
  if (p) {
    let v = Number(p[2].replace(/\./g, '').replace(',', '.'));
    if (p[3]?.startsWith('mil') && !p[3].startsWith('milh')) v *= 1e3;
    else if (p[3]) v *= 1e6;
    else if (v < 1e4) v *= 1e3;
    etiquetas.push({ k: 'preco', v: `até ${brlCurto(v)}` });
    testes.push((i) => i.preco <= v);
  }
  for (const [palavra, rotulo] of [['sacada', 'Sacada'], ['piscina', 'Piscina'], ['pet', 'Aceita pet'], ['cachorro', 'Aceita pet'], ['verde', 'Perto do verde'], ['vista', 'Vista']]) {
    if (t.includes(palavra) && !etiquetas.some((e) => e.v === rotulo)) {
      etiquetas.push({ k: 'comodidade', v: rotulo });
      testes.push((i) => i.comodidades.some((c) => c.includes(rotulo.split(' ')[0])) || i.titulo.toLowerCase().includes(palavra));
    }
  }
  if (/baix|desconto|redu/.test(t)) {
    etiquetas.push({ k: 'desconto', v: 'Baixou de preço' });
    testes.push((i) => !!desconto(i));
  }
  return { etiquetas, combina: (i) => testes.every((f) => f(i)) };
}

/** Botão "Pausar animações" (também respeita o "reduzir movimento" do sistema). */
export function botaoPausa(btn, aoMudar) {
  const raiz = document.documentElement;
  const atualizar = () => {
    const p = raiz.classList.contains('paused');
    btn.setAttribute('aria-pressed', String(p));
    btn.querySelector('span').textContent = p ? 'Retomar animações' : 'Pausar animações';
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) raiz.classList.add('paused');
  btn.addEventListener('click', () => {
    raiz.classList.toggle('paused');
    atualizar();
    aoMudar?.(raiz.classList.contains('paused'));
  });
  atualizar();
}

/** Números que contam até o valor quando aparecem na tela. */
export function contarAoVer(els) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const alvo = Number(e.target.dataset.contar);
      const fmtN = (v) => (e.target.dataset.formato === 'brl' ? brl(v) : Math.round(v).toLocaleString('pt-BR'));
      if (document.documentElement.classList.contains('paused')) {
        e.target.textContent = fmtN(alvo);
        continue;
      }
      const t0 = performance.now();
      const passo = (t) => {
        const k = Math.min(1, (t - t0) / 1100);
        e.target.textContent = fmtN(alvo * (1 - (1 - k) ** 3));
        if (k < 1) requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    }
  });
  els.forEach((el) => io.observe(el));
}
