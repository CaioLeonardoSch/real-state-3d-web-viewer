// Which client's site is open, its configuration and its listings: from the back end (by own domain or
// ?imobiliaria=slug) or, without one, from the demo files (public/data/sites.json + listings.json).
import { validateListingsFile, type Listing } from '../data/types';
import type { RemoteBackend } from '../backend/remote';
import { normalizeSiteConfig, type SiteConfig } from './config';

export interface SiteData {
  /** Agency id of the listings (org id in the back end). */
  agencyId: string;
  slug: string;
  orgName: string;
  config: SiteConfig;
  listings: Listing[];
  /** Back end of a real client; null in the demo. */
  remote: RemoteBackend | null;
  demo: boolean;
}

interface DemoSite {
  agency: string;
  slug: string;
  config: unknown;
}

const dataUrl = (name: string) => new URL(`${import.meta.env.BASE_URL}data/${name}`, location.href).href;

/** Saved by the editor in the demo (there is no server to save to). */
export const demoDraftKey = (slug: string) => `site:${slug}:rascunho`;

export function readDemoDraft(slug: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(demoDraftKey(slug)) ?? 'null');
  } catch {
    return null;
  }
}

async function loadDemo(slug: string | null): Promise<SiteData> {
  const [sitesRes, listingsRes] = await Promise.all([fetch(dataUrl('sites.json')), fetch(dataUrl('listings.json'))]);
  if (!sitesRes.ok || !listingsRes.ok) throw new Error('Não foi possível carregar os dados do site.');
  const sites = ((await sitesRes.json()) as { sites: DemoSite[] }).sites;
  const file = validateListingsFile(await listingsRes.json());
  const site = sites.find((s) => s.slug === slug) ?? sites[0];
  const agency = file.agencies.find((a) => a.id === site.agency);
  const orgName = agency?.name ?? 'Imobiliária';
  const draft = readDemoDraft(site.slug);
  return {
    agencyId: site.agency,
    slug: site.slug,
    orgName,
    config: normalizeSiteConfig(draft ?? site.config, orgName),
    listings: file.listings.filter((l) => l.agency === site.agency),
    remote: null,
    demo: true,
  };
}

/** Slug of the demo sites (to tell them apart from real clients' slugs). */
async function demoSlugs(): Promise<string[]> {
  try {
    const r = await fetch(dataUrl('sites.json'));
    return r.ok ? ((await r.json()) as { sites: DemoSite[] }).sites.map((s) => s.slug) : [];
  } catch {
    return [];
  }
}

export async function loadSite(params: URLSearchParams, backend: { url: string; key: string } | null): Promise<SiteData> {
  const slug = params.get('imobiliaria')?.trim().toLowerCase() || null;
  if (backend && !(slug && (await demoSlugs()).includes(slug))) {
    const { RemoteBackend } = await import('../backend/remote');
    const remote = await RemoteBackend.connect(backend.url, backend.key);
    const org = await remote.siteOrg(slug ? { slug } : { host: location.hostname });
    if (org) {
      const listings = await remote.publicListingsOf(org.id);
      const config = normalizeSiteConfig(org.branding, org.name);
      if (!config.creci && org.creci) config.creci = org.creci;
      return { agencyId: org.id, slug: org.slug, orgName: org.name, config, listings, remote, demo: false };
    }
    if (slug) throw new Error(`Imobiliária "${slug}" não encontrada.`);
  }
  return loadDemo(slug);
}
