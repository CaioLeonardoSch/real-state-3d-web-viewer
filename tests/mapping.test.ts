import { describe, expect, it } from 'vitest';
import { dataUrlToBlob, listingToRow, rowToListing, toEwkt, type ListingRow } from '../src/backend/mapping';
import type { Listing } from '../src/data/types';

const row = (extra: Partial<ListingRow> = {}): ListingRow => ({
  id: 'l1', org_id: 'o1', type: 'apartment', title: 'Apto', description: 'd', transaction: 'both', price: 500000,
  rent_price: 2500, previous_price: 550000, price_reduced_at: '2026-10-01', condo_fee: 600, iptu_value: 1200,
  iptu_period: 'year', area_m2: '70.00', total_area_m2: '90.50', land_area_m2: null, bedrooms: 2, suites: 1,
  bathrooms: 2, parking_spots: 1, covered_parking: 1, unit_floor: 7, floors: 12, towers: null, year_built: 2020,
  usage: 'residential', status: 'ready', features: ['pool'], address_display: 'full', building_osm_id: 'way/9',
  building_height_m: '36.00', approx_radius_m: null, address: { street: 'Rua A', number: '1', bairro: 'Centro' },
  video_url: null, tour_url: null, advertiser: { creci: '1-J' }, reference_code: 'R1', exclusive: false,
  availability: 'active', highlight: 'featured', published_at: '2026-09-01T12:00:00+00:00', updated_at: '2026-10-01T09:00:00+00:00',
  location: { type: 'Point', coordinates: [-48.85, -26.3] },
  footprint: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] },
  lot: null,
  ...extra,
});

describe('rowToListing', () => {
  const url = (p: string) => `https://cdn/${p}`;
  it('converts numbers, dates, photos (cover first) and the floor plan', () => {
    const l = rowToListing(row(), [
      { listing_id: 'l1', path: 'b.jpg', caption: null, position: 1, is_floor_plan: false },
      { listing_id: 'l1', path: 'a.jpg', caption: 'Sala', position: 0, is_floor_plan: false },
      { listing_id: 'l1', path: 'p.png', caption: 'Planta', position: 999, is_floor_plan: true },
      { listing_id: 'outro', path: 'x.jpg', caption: null, position: 0, is_floor_plan: false },
    ], url, false);
    expect(l).toMatchObject({
      id: 'l1', agency: 'o1', areaM2: 70, totalAreaM2: 90.5, buildingHeightM: 36, rentPrice: 2500, previousPrice: 550000,
      iptu: { value: 1200, period: 'year' }, publishedAt: '2026-09-01', updatedAt: '2026-10-01', approximateLocation: false,
      remote: true, highlight: 'featured',
    });
    expect(l.photos).toEqual([{ src: 'https://cdn/a.jpg', caption: 'Sala' }, { src: 'https://cdn/b.jpg' }]);
    expect(l.floorPlanImage).toBe('https://cdn/p.png');
    expect(l.userAdded).toBeUndefined();
    expect(l.fictional).toBeUndefined();
  });
  it('public rows without the exact address become approximate circles', () => {
    const l = rowToListing(row({ address_display: 'street', building_osm_id: null, footprint: null, approx_radius_m: 150 }), [], String, false);
    expect(l).toMatchObject({ approximateLocation: true, approxCenter: [-48.85, -26.3], approxRadiusM: 150 });
    expect(l.footprint).toBeUndefined();
  });
  it("the user's own rows are editable and keep the exact geometry", () => {
    const mine = row({ published: false, location: undefined, location_geojson: { type: 'Point', coordinates: [1, 2] },
      footprint: undefined, footprint_geojson: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });
    const l = rowToListing(mine, [], String, true);
    expect(l).toMatchObject({ userAdded: true, draft: true, footprint: { type: 'Polygon' } });
  });
});

describe('writing', () => {
  it('serialises geometries as EWKT (footprints as MULTIPOLYGON)', () => {
    expect(toEwkt({ type: 'Point', coordinates: [-48.8, -26.3] })).toBe('SRID=4326;POINT(-48.8 -26.3)');
    expect(toEwkt({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] })).toBe(
      'SRID=4326;MULTIPOLYGON(((0 0,1 0,1 1,0 0)))',
    );
  });
  it('builds the insert row without server-owned fields', () => {
    const l = { id: 'x', type: 'land', title: 'Terreno', agency: 'o', price: 300000, areaM2: 360, bedrooms: 0, bathrooms: 0,
      parkingSpots: 0, status: 'ready', features: [], approximateLocation: false, description: '',
      lotPolygon: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, previousPrice: 999999 } as Listing;
    const r = listingToRow(l, 'org-1', [-48.8, -26.3]);
    expect(r).toMatchObject({ org_id: 'org-1', lot: 'SRID=4326;POLYGON((0 0,1 0,1 1,0 0))', location: 'SRID=4326;POINT(-48.8 -26.3)', transaction: 'sale' });
    expect(r).not.toHaveProperty('previous_price');
    expect(r).not.toHaveProperty('id');
  });
  it('decodes data URLs for upload', async () => {
    const b = dataUrlToBlob('data:image/png;base64,iVBORw0KGgo=');
    expect(b.type).toBe('image/png');
    expect(new Uint8Array(await b.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });
});
