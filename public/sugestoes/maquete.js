// Estilo "maquete de arquiteto" para o mapa vivo: cidade branca e fosca, árvores em verde-acinzentado, ruas em cinza
// claro e só os imóveis à venda na cor da imobiliária. Muda as cores das camadas do estilo do mapa, sem tocar no código
// do mapa; a régua de hora (setTheme) devolve as cores originais, então reaplicar depois de mudar a hora.

export function estiloMaquete(map, cor = '#2f4bff') {
  const pinta = (id, prop, valor) => {
    if (map.getLayer(id)) map.setPaintProperty(id, prop, valor);
  };
  pinta('background', 'background-color', '#f3f2ef');
  pinta('green', 'fill-color', '#e6e9df');
  pinta('water-area', 'fill-color', '#dfe4e8');
  if (map.getLayer('water-pattern')) map.setLayoutProperty('water-pattern', 'visibility', 'none');
  pinta('water-shore', 'line-color', '#cfd6dc');
  pinta('water-line', 'line-color', '#d6dde3');
  for (const id of ['roads-sidewalk', 'roads', 'roads-paving', 'roads-dirt']) pinta(id, 'line-color', '#e3e1dc');
  pinta('roads-lanes', 'line-opacity', 0);
  pinta('bairros-line', 'line-color', '#c9c5bd');
  pinta('building-shadows', 'fill-extrusion-color', '#d9d6cf');
  pinta('buildings-flat', 'fill-color', '#f7f6f3');
  pinta('context-buildings', 'fill-extrusion-color', '#fbfaf7');
  pinta('roofs', 'fill-extrusion-color', '#f6f5f1');
  // a mata usa uma textura de facetas verdes: sem ela, fica na cor lisa da maquete
  pinta('wood-canopy', 'fill-extrusion-pattern', undefined);
  pinta('wood-canopy', 'fill-extrusion-color', '#d3d9cb');
  pinta('trees', 'fill-extrusion-color', '#c7d0bd');
  pinta('lamps', 'fill-extrusion-color', '#e9e7e2');
  for (const id of ['listing-dimmed', 'listing-shell-dimmed']) pinta(id, 'fill-extrusion-color', '#f4f3ef');
  for (const id of ['listing-buildings', 'listing-land', 'listing-unbuilt']) pinta(id, 'fill-extrusion-color', cor);
  pinta('listing-outline', 'line-color', cor);
  pinta('listing-pins', 'circle-color', cor);
  pinta('listing-pins', 'circle-stroke-color', '#ffffff');
  pinta('listing-clusters', 'circle-color', cor);
  pinta('construction-cranes', 'fill-extrusion-color', '#d4d1ca');
  pinta('road-names', 'text-color', '#9a958b');
  pinta('road-names', 'text-halo-color', '#f7f6f3');
  map.setSky?.({ 'sky-color': '#eef0f2', 'horizon-color': '#f6f5f2', 'fog-color': '#f6f5f2' });
  map.setLight?.({ anchor: 'map', color: '#ffffff', intensity: 0.32, position: [1.5, 300, 35] });
}
