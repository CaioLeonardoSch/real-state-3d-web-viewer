// The browser of the end-to-end checks (scripts/e2e-*.mjs).
//
// By default Chromium draws with SwiftShader (WebGL in software, as in the CI, which has no GPU) and the 3D map opens
// without the relief: there each frame with the relief is several times slower, enough to stall the checks. The relief
// has checks of its own (e2e-check.mjs, "relief"), which open the map with it through `reliefContext`.
//
//   E2E_GPU=1     draw with the computer's GPU (a local run on a machine that has one); the relief stays on
//   E2E_RELEVO=1  keep the relief on everywhere, also in software
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

/** Use a pre-installed Chromium when the Playwright-bundled one is not downloaded. */
const EXEC = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
export const E2E_GPU = !!process.env.E2E_GPU;
export const E2E_RELIEF = E2E_GPU || !!process.env.E2E_RELEVO;

/** Turns the relief off in every page of the context, frames included (src/data/load.ts reads it at start). */
const flat = (target) => target.addInitScript(() => {
  window.__semRelevo = true;
});

/**
 * Launches Chromium. Unless the relief is on (E2E_GPU, E2E_RELEVO), its contexts and pages open the map without it;
 * `reliefContext(options)` opens a context with the relief, for the checks of the relief itself.
 */
export async function launchBrowser() {
  const args = E2E_GPU ? ['--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ executablePath: EXEC, args });
  const newContext = browser.newContext.bind(browser);
  const newPage = browser.newPage.bind(browser);
  browser.reliefContext = (opts) => newContext(opts);
  if (!E2E_RELIEF) {
    browser.newContext = async (opts) => {
      const ctx = await newContext(opts);
      await flat(ctx);
      return ctx;
    };
    browser.newPage = async (opts) => {
      const page = await newPage(opts);
      await flat(page);
      return page;
    };
  }
  console.log(`navegador: ${E2E_GPU ? 'GPU' : 'WebGL por software'}; mapa ${E2E_RELIEF ? 'com' : 'sem'} relevo (o relevo tem checagens próprias)`);
  return browser;
}
