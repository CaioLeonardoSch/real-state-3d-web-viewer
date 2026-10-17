import type { Address, AddressDisplay, Listing } from './types';

/** Address fields the public may see for each choice. The CEP is never shown (same rule as the public_listings view). */
const PUBLIC_ADDRESS_FIELDS: Record<AddressDisplay, readonly (keyof Address)[]> = {
  full: ['street', 'number', 'complement', 'bairro', 'city'],
  street: ['street', 'bairro', 'city'],
  neighborhood: ['bairro', 'city'],
};

/**
 * The part of an address that may be published for the advertiser's choice; a missing (or unknown) choice counts as
 * `neighborhood`, as in `addressLabel`. Any field not listed above is dropped.
 */
export function publicAddress(address: Address, display: AddressDisplay | undefined): Address {
  const fields = display && Object.hasOwn(PUBLIC_ADDRESS_FIELDS, display) ? PUBLIC_ADDRESS_FIELDS[display] : PUBLIC_ADDRESS_FIELDS.neighborhood;
  const out: Address = {};
  for (const k of fields) if (address[k] != null) out[k] = address[k];
  return out;
}

/** Address as the advertiser chose to show it (full, street only, or neighbourhood only); null when unknown. */
export function addressLabel(l: Listing): string | null {
  const a = l.address;
  if (!a) return null;
  const place = [a.bairro, a.city].filter(Boolean).join(', ');
  const display = l.addressDisplay ?? 'neighborhood';
  if (display === 'neighborhood' || !a.street) return place || null;
  const street = display === 'full' ? [a.street, a.number].filter(Boolean).join(', ') : a.street;
  const complement = display === 'full' && a.complement ? ` (${a.complement})` : '';
  return [street + complement, place].filter(Boolean).join(' · ');
}

/** "8 dígitos" → "89201-000". */
export function formatCep(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Brazilian phone to a wa.me link ("(47) 99999-0000" → https://wa.me/5547999990000); null when too short. */
export function whatsappLink(phone: string, text: string): string | null {
  let d = phone.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (!d.startsWith('55')) d = `55${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

/** Only http(s) links are shown (a typed "javascript:" must never become a link). */
export const safeUrl = (u: string | undefined): string | null => (u && /^https?:\/\//i.test(u) ? u : null);

export const today = () => new Date().toISOString().slice(0, 10);
export const formatDate = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Embeddable player for a YouTube or Vimeo link (privacy-enhanced YouTube domain), or null for anything else:
 * other links are shown as plain links, never put in an iframe.
 */
export function videoEmbedUrl(url: string | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com')
    id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] ?? null;
  if (id && /^[\w-]{11}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
  const vimeo = host === 'vimeo.com' || host === 'player.vimeo.com' ? u.pathname.match(/(\d{6,})/)?.[1] : undefined;
  return vimeo ? `https://player.vimeo.com/video/${vimeo}` : null;
}
