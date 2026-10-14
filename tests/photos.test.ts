import { describe, expect, it } from 'vitest';
import type { Listing } from '../src/data/types';
import { renderListingPage } from '../src/seo/listingPage';
import { cardHtml } from '../src/site/cards';
import { normalizeSiteConfig } from '../src/site/config';
import { PHOTO_SIZES, photoSrcset } from '../src/utils/images';

const three = { src: 'https://cdn/a.jpg', thumb: 'https://cdn/a-mini.jpg', large: 'https://cdn/a-grande.jpg' };
const old = { src: 'https://cdn/b.jpg', thumb: 'https://cdn/b-mini.jpg' };

describe('fotos em três tamanhos', () => {
  it('srcset só para fotos guardadas nos três tamanhos; cards e painéis vão até a média', () => {
    expect(PHOTO_SIZES.thumb[0] < PHOTO_SIZES.src[0] && PHOTO_SIZES.src[0] < PHOTO_SIZES.large[0]).toBe(true);
    expect(photoSrcset(three)).toBe('https://cdn/a-mini.jpg 480w, https://cdn/a.jpg 1024w, https://cdn/a-grande.jpg 1920w');
    expect(photoSrcset(three, 'src')).toBe('https://cdn/a-mini.jpg 480w, https://cdn/a.jpg 1024w');
    // photos from before (960/320 px) or from elsewhere: the one they have
    expect(photoSrcset(old)).toBeNull();
    expect(photoSrcset({ src: 'https://cdn/c.jpg' })).toBeNull();
  });

  const listing = {
    id: 'l1', type: 'house', title: 'Casa', agency: 'a', price: 500000, areaM2: 100, bedrooms: 3, bathrooms: 2, parkingSpots: 1,
    status: 'ready', features: [], approximateLocation: false, transaction: 'sale', description: 'Casa.', photos: [three, old],
  } as unknown as Listing;

  it('card: a miniatura ou a média, conforme a tela; o carrossel leva os dois tamanhos de cada foto', () => {
    const ctx = { config: normalizeSiteConfig({}, 'Imob'), href: () => '#', isFavorite: () => false, isCompared: () => false, rent: false };
    const html = cardHtml(listing, ctx);
    expect(html).toContain('src="https://cdn/a-mini.jpg" srcset="https://cdn/a-mini.jpg 480w, https://cdn/a.jpg 1024w" sizes="(max-width: 600px) 100vw, 400px"');
    const photos = JSON.parse(html.match(/data-photos="([^"]*)"/)![1].replace(/&quot;/g, '"'));
    expect(photos).toEqual([['https://cdn/a-mini.jpg', 'https://cdn/a-mini.jpg 480w, https://cdn/a.jpg 1024w'], ['https://cdn/b-mini.jpg', null]]);
  });

  it('página estática do imóvel: srcset nas fotos novas', () => {
    const html = renderListingPage(listing, { siteUrl: 'https://site.com/', agencyName: 'A', siteName: 'A' });
    expect(html).toContain('<img src="https://cdn/a.jpg" srcset="https://cdn/a-mini.jpg 480w, https://cdn/a.jpg 1024w"');
    expect(html).toContain('<img src="https://cdn/b.jpg" alt=');
  });
});
