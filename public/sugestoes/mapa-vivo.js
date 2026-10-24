// Mapa 3D de verdade (mapa.html?embed=1) dentro das páginas de sugestão. A página e o mapa têm a mesma origem, então
// a página controla o mapa direto: a régua de hora e época (sol e sombras), a câmera e um giro lento.
// Primeiro aparece uma imagem estática; o mapa entra por cima quando fica pronto.

const TZ = 'America/Sao_Paulo';

/** Hora de Joinville agora, em minutos depois da meia-noite, e a época do ano mais próxima para a régua. */
export function joinvilleAgora() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', month: 'numeric', hour12: false })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const minutos = Number(parts.hour) * 60 + Number(parts.minute);
  const mes = Number(parts.month);
  const epoca = [11, 12, 1, 2].includes(mes) ? 'summer' : [5, 6, 7, 8].includes(mes) ? 'winter' : 'equinox';
  const noite = minutos < 5 * 60 + 30 || minutos > 19 * 60 + 30;
  return { minutos, epoca, noite, rotulo: `${parts.hour}h${parts.minute}` };
}

/** Ponto do olho na vista da janela: do lado de fora da fachada, raio do prédio + 2 m na direção `rumo`. */
function olhoEm(centro, raio, rumo) {
  const r = Math.PI / 180;
  const d = raio + 2;
  return [centro[0] + (d * Math.sin(rumo * r)) / (111320 * Math.cos(centro[1] * r)), centro[1] + (d * Math.cos(rumo * r)) / 111320];
}

export const animacoesPausadas = () =>
  document.documentElement.classList.contains('paused') || matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Monta o mapa vivo em `el` (que já tem a imagem estática). Opções: foco (id do imóvel), interativo (deixa arrastar),
 * giro (graus por segundo). Devolve um controle com as ações e uma promessa `pronto`.
 */
export function montarMapa(el, { foco = null, interativo = false, giro = 1.2 } = {}) {
  const iframe = document.createElement('iframe');
  iframe.className = 'mapa-vivo';
  iframe.title = 'Mapa 3D de Joinville';
  iframe.loading = 'lazy';
  iframe.tabIndex = interativo ? 0 : -1;
  if (!interativo) iframe.setAttribute('aria-hidden', 'true');
  iframe.src = `mapa.html?embed=1${foco ? `&foco=${encodeURIComponent(foco)}` : ''}`;
  el.appendChild(iframe);

  let map = null;
  let doc = null;
  let girando = giro > 0;
  let limites = null;
  let naVista = false;
  let ultimo = 0;

  const pronto = new Promise((resolve) => {
    const tentar = () => {
      try {
        const w = iframe.contentWindow;
        if (w?.__demo?.map) {
          map = w.__demo.map;
          doc = iframe.contentDocument;
          const s = doc.createElement('style');
          // só o mapa: sem controles, sem painel do imóvel, sem a régua (a página tem os próprios controles)
          s.textContent = `.maplibregl-control-container,.drawer,.time-of-day,.sun-ruler,.map-hint,.skip-link{display:none!important}
            body{background:transparent}`;
          doc.head.appendChild(s);
          const esperar = () => (map.isMoving() ? setTimeout(esperar, 300) : resolve());
          esperar();
          return;
        }
      } catch {
        /* outra origem: fica a imagem estática */
      }
      setTimeout(tentar, 400);
    };
    iframe.addEventListener('load', tentar, { once: true });
  });

  pronto.then(() => {
    el.classList.add('vivo');
    const passo = (t) => {
      if (map && girando && !naVista && !animacoesPausadas() && document.visibilityState === 'visible' && !map.isMoving()) {
        const dt = ultimo ? Math.min(t - ultimo, 100) : 16;
        map.setBearing(map.getBearing() + (giro * dt) / 1000);
      }
      ultimo = t;
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  });

  const controle = {
    pronto,
    get map() {
      return map;
    },
    /** Sol e sombras de um horário (minutos depois da meia-noite) numa época ('summer', 'equinox', 'winter'). */
    hora(minutos, epoca = 'equinox') {
      if (!doc) return;
      const s = doc.querySelector('[data-season]');
      const r = doc.querySelector('[data-hour]');
      if (s && s.value !== epoca) {
        s.value = epoca;
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (r) {
        r.value = String(Math.max(Number(r.min), Math.min(Number(r.max), minutos)));
        r.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    noite() {
      doc?.querySelector('[data-tod="night"]')?.click();
    },
    /** Hora real de Joinville. */
    agora() {
      const a = joinvilleAgora();
      if (a.noite) controle.noite();
      else controle.hora(a.minutos, a.epoca);
      return a;
    },
    camera(opcoes, duracao = 2200) {
      if (!map) return;
      controle.sairDaVista();
      if (animacoesPausadas()) map.jumpTo(opcoes);
      else map.easeTo({ ...opcoes, duration: duracao, essential: false });
    },
    girar(sim) {
      girando = sim;
    },
    /**
     * Câmera na janela: do lado de fora da fachada (raio do prédio + 2 m), na altura do andar, olhando para `rumo`
     * (graus a partir do norte). Como a "vista da janela" dos empreendimentos (src/map/developmentLayer.ts).
     */
    vista(centro, raio, alturaOlho, rumo) {
      if (!map) return;
      if (!limites) limites = { zoom: map.getMaxZoom(), pitch: map.getMaxPitch() };
      // acima de 75° a trava da câmera (src/map/scene.ts) entende que a câmera está na janela de propósito
      map.setMaxZoom(23);
      map.setMaxPitch(85);
      const olho = olhoEm(centro, raio, rumo);
      const chao = map.queryTerrainElevation?.(centro) ?? 0;
      const cam = map.calculateCameraOptionsFromCameraLngLatAltRotation(olho, chao + alturaOlho, rumo, 82);
      if (animacoesPausadas()) map.jumpTo(cam);
      else map.flyTo({ ...cam, duration: 1800, essential: false });
      naVista = true;
    },
    /** Se a janela que olha para `rumo` dá para a parede de um vizinho mais alto que o olho (prédio colado). */
    bloqueado(centro, raio, alturaOlho, rumo) {
      if (!map) return false;
      const [x, y] = olhoEm(centro, raio, rumo);
      const dentro = (anel) => {
        let c = false;
        for (let k = 0, j = anel.length - 1; k < anel.length; j = k++) {
          const [xi, yi] = anel[k], [xj, yj] = anel[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
        }
        return c;
      };
      return map.querySourceFeatures('osm', { sourceLayer: 'buildings' }).some((f) => {
        if (!(Number(f.properties?.height) > alturaOlho - 1.6)) return false;
        const g = f.geometry;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        return polys.some((p) => dentro(p[0]));
      });
    },
    sairDaVista() {
      if (!map || !naVista) return;
      naVista = false;
      map.jumpTo({ elevation: 0, roll: 0 });
      if (limites) { map.setMaxPitch(limites.pitch); map.setMaxZoom(limites.zoom); limites = null; }
    },
    get naVista() {
      return naVista;
    },
  };
  return controle;
}
