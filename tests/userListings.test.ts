import { describe, expect, it } from 'vitest';
import type { AddressDisplay, Listing } from '../src/data/types';
import { exportUserListings } from '../src/state/userListings';

const address = { cep: '89201-000', street: 'Rua A', number: '10', complement: 'apto 3', bairro: 'Centro', city: 'Joinville' };
const listing = (id: string, addressDisplay: AddressDisplay | undefined, extra: Partial<Listing> = {}) =>
  ({ id, type: 'house', title: 'Casa', agency: 'a', address: { ...address }, addressDisplay, userAdded: true, ...extra }) as Listing;

describe('export of the listings added in this browser', () => {
  it('keeps only the part of the address the advertiser chose to show, never the CEP', () => {
    const mine = [listing('full', 'full'), listing('street', 'street'), listing('hood', 'neighborhood'), listing('old', undefined)];
    const out = exportUserListings(mine, [{ id: 'a', name: 'A' }]).listings;
    expect(out.map((l) => l.address)).toEqual([
      { street: 'Rua A', number: '10', complement: 'apto 3', bairro: 'Centro', city: 'Joinville' },
      { street: 'Rua A', bairro: 'Centro', city: 'Joinville' },
      { bairro: 'Centro', city: 'Joinville' },
      { bairro: 'Centro', city: 'Joinville' },
    ]);
    const json = JSON.stringify(out.slice(2));
    for (const hidden of ['Rua A', '89201', 'apto 3', '"number"']) expect(json).not.toContain(hidden);
  });
  it('drops the browser-only flag, leaves listings without address alone and the stored copy whole', () => {
    const mine = [listing('hood', 'neighborhood'), listing('none', 'full', { address: undefined })];
    const [hood, none] = exportUserListings(mine, []).listings;
    expect(hood).not.toHaveProperty('userAdded');
    expect(none.address).toBeUndefined();
    expect(none).not.toHaveProperty('userAdded');
    // the form edits from this copy: it still has the whole address
    expect(mine[0].address).toEqual(address);
    expect(mine[0].userAdded).toBe(true);
  });
});
