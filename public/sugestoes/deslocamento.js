// Tempo de deslocamento estimado, sem motor de rotas: distância em linha reta × 1,35 (as ruas não são retas) dividida
// pela velocidade média de cada meio, mais a espera do ônibus. Num site real, usar um motor de rotas com trânsito.

export const DESTINOS = [
  { nome: 'Centro', centro: [-48.84519, -26.30331] },
  { nome: 'Zona Industrial Norte', centro: [-48.86739, -26.24232] },
  { nome: 'América', centro: [-48.8543, -26.29251] },
  { nome: 'Boa Vista', centro: [-48.82139, -26.30079] },
  { nome: 'Bom Retiro', centro: [-48.84278, -26.26455] },
  { nome: 'Santo Antônio', centro: [-48.85791, -26.26886] },
  { nome: 'Itaum', centro: [-48.83015, -26.33548] },
  { nome: 'Aventureiro', centro: [-48.80065, -26.24042] },
];

export const MEIOS = {
  carro: { rotulo: 'Carro', kmh: 26, espera: 2 },
  onibus: { rotulo: 'Ônibus', kmh: 16, espera: 8 },
  bicicleta: { rotulo: 'Bicicleta', kmh: 14, espera: 0 },
  pe: { rotulo: 'A pé', kmh: 4.8, espera: 0 },
};
const DESVIO = 1.35;

/** Distância em metros entre dois pontos [lng, lat]. */
export function distancia(a, b) {
  const r = Math.PI / 180;
  const x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r);
  const y = (b[1] - a[1]) * r;
  return Math.hypot(x, y) * 6371000;
}

/** Minutos estimados de `a` até `b`, como faixa [mín, máx]. */
export function minutos(a, b, meio = 'carro') {
  const m = MEIOS[meio];
  const t = (distancia(a, b) * DESVIO) / 1000 / m.kmh * 60 + m.espera;
  return [Math.max(1, Math.round(t * 0.85)), Math.max(2, Math.round(t * 1.2))];
}

/** Raio (m) alcançável em `min` minutos, para desenhar a área no mapa. */
export function raioAlcancavel(min, meio = 'carro') {
  const m = MEIOS[meio];
  return Math.max(0, ((min - m.espera) / 60) * m.kmh * 1000 / DESVIO);
}

/** Polígono (GeoJSON) de um círculo de `raio` metros em volta de `centro`. */
export function circulo(centro, raio, passos = 72) {
  const r = Math.PI / 180;
  const dy = raio / 111320;
  const dx = dy / Math.cos(centro[1] * r);
  const anel = Array.from({ length: passos + 1 }, (_, k) => {
    const a = (k / passos) * 2 * Math.PI;
    return [centro[0] + dx * Math.cos(a), centro[1] + dy * Math.sin(a)];
  });
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [anel] } };
}

/** Desenha (ou troca) uma camada GeoJSON no mapa vivo: área preenchida, contorno e pontos. */
export function camada(map, id, dados, { cor = '#2340d8', opacidade = 0.14, linha = 2.5, tracejado = false } = {}) {
  if (!map) return;
  dados = doMapa(map, dados);
  const fonte = map.getSource(id);
  if (fonte) { fonte.setData(dados); return; }
  map.addSource(id, { type: 'geojson', data: dados });
  map.addLayer({ id: `${id}-area`, type: 'fill', source: id, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': cor, 'fill-opacity': opacidade } });
  map.addLayer({ id: `${id}-linha`, type: 'line', source: id, filter: ['!=', '$type', 'Point'], paint: { 'line-color': cor, 'line-width': linha, ...(tracejado ? { 'line-dasharray': [2, 1.5] } : {}) } });
  map.addLayer({ id: `${id}-ponto`, type: 'circle', source: id, filter: ['==', '$type', 'Point'], paint: { 'circle-color': cor, 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });
}

/**
 * O mapa vive num iframe: um objeto criado nesta página não passa para os workers dele ("unregistered class
 * Object"). Recria os dados com o JSON da janela do mapa.
 */
export function doMapa(map, dados) {
  const w = map.getContainer().ownerDocument.defaultView;
  return w.JSON.parse(JSON.stringify(dados));
}
