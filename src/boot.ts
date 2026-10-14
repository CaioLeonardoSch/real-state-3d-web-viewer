// Entry of the map page: the page shell (header, filters bar, styles) paints first, then the 3D map's code
// (MapLibre and the app, about 1 MB) is loaded and evaluated. Loading it first left phones on a blank screen for
// seconds (Lighthouse on a phone: first content 3.1 s → 1 s). Preloading it was worse: it competes with the shell.
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

let started = false;
const start = () => {
  if (started) return;
  started = true;
  void import('./main');
};
// once the shell's text is on screen (first contentful paint)
try {
  new PerformanceObserver((list, observer) => {
    if (!list.getEntriesByName('first-contentful-paint').length) return;
    observer.disconnect();
    setTimeout(start, 0);
  }).observe({ type: 'paint', buffered: true });
} catch {
  /* no paint timing: the fallback below */
}
// background tabs do not paint; browsers without paint timing
setTimeout(start, 1000);
