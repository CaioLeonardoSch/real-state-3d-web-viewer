/**
 * Demonstration build: fictional listings, agencies and agency sites, the sales mirror of demo developments, and the
 * "demonstração" texts. A production build (VITE_DEMO_LISTINGS=false) has none of them: its content comes from the
 * back end (and the build leaves the demo files out, see vite.config.ts).
 * Write each demonstration text under `DEMO && ...`: the constant drops it from that build, which fails if one is left.
 */
export const DEMO = import.meta.env.VITE_DEMO_LISTINGS !== 'false';
