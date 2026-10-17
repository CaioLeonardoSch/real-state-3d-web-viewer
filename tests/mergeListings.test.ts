import { describe, expect, it } from 'vitest';
import type { AddressDisplay, Listing } from '../src/data/types';
import { mergeListings } from '../scripts/lib/merge-listings.mjs';

const address = { cep: '89201-000', street: 'Rua A', number: '10', complement: 'apto 3', bairro: 'Centro', city: 'Joinville' };
const listing = (id: string, addressDisplay: AddressDisplay | undefined, extra: Partial<Listing> = {}) =>
  ({ id, type: 'house', title: `Casa ${id}`, agency: 'a', address: { ...address }, addressDisplay, ...extra }) as Listing;
const published = () => ({
  agencies: [{ id: 'a', name: 'A' }],
  listings: [listing('house-1', 'neighborhood', { buildingOsmId: 'way/1', address: { bairro: 'Centro', city: 'Joinville' } })],
});

describe('npm run listings:add (merge into the public listings.json)', () => {
  it('drops the hidden parts of the address, even from an export made before the fix', () => {
    const target = published();
    // an older export: the whole address whatever the choice, and the browser-only flag
    const incoming = {
      agencies: [],
      listings: [
        listing('user-hood', 'neighborhood', { userAdded: true }),
        listing('user-street', 'street'),
        listing('user-full', 'full'),
        listing('user-old', undefined),
      ],
    };
    const { added } = mergeListings(target, incoming);
    const byId = Object.fromEntries(target.listings.map((l) => [l.id, l]));
    expect(byId['user-hood'].address).toEqual({ bairro: 'Centro', city: 'Joinville' });
    expect(byId['user-hood']).not.toHaveProperty('userAdded');
    expect(byId['user-street'].address).toEqual({ street: 'Rua A', bairro: 'Centro', city: 'Joinville' });
    expect(byId['user-full'].address).toEqual({ street: 'Rua A', number: '10', complement: 'apto 3', bairro: 'Centro', city: 'Joinville' });
    expect(byId['user-old'].address).toEqual({ bairro: 'Centro', city: 'Joinville' });
    expect(added).toHaveLength(4);
    // what would be written to public/data/listings.json
    const file = JSON.stringify(target);
    expect(file).not.toContain('89201');
    for (const l of [byId['user-hood'], byId['user-old']]) for (const k of ['street', 'number', 'complement', 'cep']) expect(l.address).not.toHaveProperty(k);
    // the export itself is not changed
    expect(incoming.listings[0].address).toEqual(address);
  });

  it('renames taken ids, adds the agencies it needs and refuses a building that already has a listing', () => {
    const target = published();
    const { renamed } = mergeListings(target, {
      agencies: [{ id: 'b', name: 'B' }, { id: 'c', name: 'C (sem anúncio)' }],
      listings: [listing('house-1', 'neighborhood', { agency: 'b' })],
    });
    expect(renamed).toEqual([['house-1', 'house-1-2']]);
    expect(target.agencies.map((a) => a.id)).toEqual(['a', 'b']);

    const before = JSON.stringify(target);
    expect(() => mergeListings(target, { listings: [listing('other', 'full', { buildingOsmId: 'way/1' })] })).toThrow(/way\/1.*house-1/);
    expect(JSON.stringify(target)).toBe(before);
  });
});
