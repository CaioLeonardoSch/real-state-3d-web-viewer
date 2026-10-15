import { describe, expect, it } from 'vitest';
import { addressLabel, formatCep, publicAddress, videoEmbedUrl, whatsappLink } from '../src/data/listingText';
import type { AddressDisplay, Listing } from '../src/data/types';

describe('video embeds', () => {
  it('turns YouTube and Vimeo links into embeddable players', () => {
    const yt = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe(yt);
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(yt);
    expect(videoEmbedUrl('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe(yt);
    expect(videoEmbedUrl('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871');
  });
  it('never embeds other sites or malformed ids', () => {
    expect(videoEmbedUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(videoEmbedUrl('https://youtube.com/watch?v=<script>')).toBeNull();
    expect(videoEmbedUrl('javascript:alert(1)')).toBeNull();
    expect(videoEmbedUrl(undefined)).toBeNull();
  });
});

describe('address and contact', () => {
  const l = (addressDisplay: Listing['addressDisplay']) =>
    ({ address: { street: 'Rua A', number: '10', complement: 'apto 3', bairro: 'Centro', city: 'Joinville' }, addressDisplay }) as Listing;
  it('shows only what the advertiser chose', () => {
    expect(addressLabel(l('full'))).toBe('Rua A, 10 (apto 3) · Centro, Joinville');
    expect(addressLabel(l('street'))).toBe('Rua A · Centro, Joinville');
    expect(addressLabel(l('neighborhood'))).toBe('Centro, Joinville');
  });
  it('publishes only the fields the choice allows, never the CEP (same rule as the public_listings view)', () => {
    const address = { cep: '89201-000', street: 'Rua A', number: '10', complement: 'apto 3', bairro: 'Centro', city: 'Joinville' };
    expect(publicAddress(address, 'full')).toEqual({ street: 'Rua A', number: '10', complement: 'apto 3', bairro: 'Centro', city: 'Joinville' });
    expect(publicAddress(address, 'street')).toEqual({ street: 'Rua A', bairro: 'Centro', city: 'Joinville' });
    expect(publicAddress(address, 'neighborhood')).toEqual({ bairro: 'Centro', city: 'Joinville' });
    // no choice, or one this version does not know: only the neighbourhood, as addressLabel shows it
    expect(publicAddress(address, undefined)).toEqual({ bairro: 'Centro', city: 'Joinville' });
    expect(publicAddress(address, 'everything' as AddressDisplay)).toEqual({ bairro: 'Centro', city: 'Joinville' });
    expect(publicAddress(address, '__proto__' as AddressDisplay)).toEqual({ bairro: 'Centro', city: 'Joinville' });
    // fields it does not know are dropped too; missing ones are not invented; the input is not changed
    expect(publicAddress({ ...address, reference: 'Em frente à padaria' } as typeof address, 'full')).not.toHaveProperty('reference');
    expect(publicAddress({ street: 'Rua A', bairro: 'Centro' }, 'full')).toEqual({ street: 'Rua A', bairro: 'Centro' });
    expect(address.cep).toBe('89201-000');
  });
  it('formats CEP and WhatsApp links', () => {
    expect(formatCep('89201000')).toBe('89201-000');
    expect(whatsappLink('(47) 99999-0000', 'Olá')).toBe('https://wa.me/5547999990000?text=Ol%C3%A1');
    expect(whatsappLink('123', 'x')).toBeNull();
  });
});
