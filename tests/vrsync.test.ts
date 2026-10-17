import { describe, expect, it } from 'vitest';
import { mapPropertyType, parseVrsync } from '../src/import/vrsync';

import sample from './fixtures/vrsync-exemplo.xml?raw';

const xml = sample.replace(/__FOTOS__/g, 'https://fotos.teste');

describe('VRSync feed', () => {
  const feed = parseVrsync(xml);
  it('reads the supported listings and explains the skipped ones', () => {
    expect(feed.listings.map((l) => l.referenceCode)).toEqual(['AP-1001', 'CA-2002', 'TE-3003']);
    expect(feed.skipped).toEqual([
      { referenceCode: 'SL-4004', title: 'Quarto de hotel', reason: 'tipo não suportado: Commercial / Hotel' },
      { referenceCode: 'AP-5005', title: 'Apartamento sem preço', reason: 'sem preço de venda' },
    ]);
    expect(feed.warnings).toEqual([{ referenceCode: 'TE-3003', message: 'sem fotos' }]);
    expect(feed.provider).toMatchObject({ name: 'Imobiliária Exemplo', email: 'contato@imobiliaria-exemplo.com.br' });
  });
  it('apartment: prices, areas, features, cover first, floor plan apart, address and coordinates', () => {
    const ap = feed.listings[0];
    expect(ap).toMatchObject({
      type: 'apartment', transaction: 'sale', price: 780000, condoFee: 650, iptu: { value: 1800, period: 'year' }, areaM2: 92, totalAreaM2: 120,
      bedrooms: 3, suites: 1, bathrooms: 2, parkingSpots: 2, unitFloor: 6, floors: 12, yearBuilt: 2018, highlight: 'featured',
      addressDisplay: 'full', point: [-48.846063, -26.267007], videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      address: { cep: '89223-000', street: 'Rua Exemplo', number: '100', complement: 'Apto 601', bairro: 'Bom Retiro', city: 'Joinville' },
    });
    expect(ap.features.sort()).toEqual(['barbecue', 'elevator', 'pool']);
    expect(ap.photos.map((p) => p.caption)).toEqual(['Fachada', 'Sala']);
    expect(ap.photos[0].url).toBe('https://fotos.teste/ap-fachada.jpg');
    expect(ap.floorPlans).toEqual(['https://fotos.teste/ap-planta.jpg']);
    expect(ap.description).toBe('Apartamento amplo, sol da manhã.\nAceita financiamento.');
  });
  it('house for sale and rent (Brazilian number format), no coordinates; land', () => {
    expect(feed.listings[1]).toMatchObject({ type: 'house', transaction: 'both', price: 650000, rentPrice: 3200, landAreaM2: 360, point: null, addressDisplay: 'neighborhood', features: ['pets'] });
    expect(feed.listings[2]).toMatchObject({ type: 'land', areaM2: 360, bedrooms: 0, addressDisplay: 'street', point: [-48.840821, -26.274791] });
  });
  it('property types', () => {
    expect(mapPropertyType('Residential / Apartment')?.type).toBe('apartment');
    expect(mapPropertyType('Residential / Duplex')?.type).toBe('apartment');
    expect(mapPropertyType('Residential / Penthouse')?.type).toBe('penthouse');
    expect(mapPropertyType('Residential / Kitnet')?.type).toBe('studio');
    expect(mapPropertyType('Residential / Flat')?.type).toBe('studio');
    expect(mapPropertyType('Residential / Sobrado')?.type).toBe('semi_detached');
    expect(mapPropertyType('Residential / Condo')?.type).toBe('house');
    expect(mapPropertyType('Residential / Farm Ranch')).toEqual({ type: 'farm', usage: 'residential' });
    expect(mapPropertyType('Residential / Agricultural')).toBeNull();
    expect(mapPropertyType('Commercial / Land Lot')).toEqual({ type: 'land', usage: 'commercial' });
    expect(mapPropertyType('Commercial / Office')).toEqual({ type: 'office', usage: 'commercial' });
    expect(mapPropertyType('Commercial / Business')?.type).toBe('office');
    expect(mapPropertyType('Commercial / Loja')?.type).toBe('store');
    expect(mapPropertyType('Commercial / Retail')?.type).toBe('store');
    expect(mapPropertyType('Commercial / Industrial')?.type).toBe('warehouse');
    expect(mapPropertyType('Commercial / Warehouse')?.type).toBe('warehouse');
    expect(mapPropertyType('Commercial / Hotel')).toBeNull();
    expect(() => parseVrsync('<rss/>')).toThrow(/VRSync/);
  });
  it('new types: floors only for units in a building, bedrooms not for commercial spaces', () => {
    const item = (ref: string, type: string) => `<Listing><ListingID>${ref}</ListingID><Title>${ref}</Title><TransactionType>For Sale</TransactionType>
      <Details><PropertyType>${type}</PropertyType><ListPrice>500000</ListPrice><LivingArea>80</LivingArea><Bedrooms>2</Bedrooms>
      <UnitFloor>9</UnitFloor><Floors>12</Floors></Details><Location><City>Joinville</City></Location></Listing>`;
    const f = parseVrsync(
      `<ListingDataFeed><Listings>${item('CO-1', 'Residential / Penthouse')}${item('SA-1', 'Commercial / Office')}${item('GA-1', 'Commercial / Industrial')}</Listings></ListingDataFeed>`,
    );
    expect(f.skipped).toEqual([]);
    expect(f.listings.map((l) => [l.type, l.usage, l.unitFloor, l.floors])).toEqual([
      ['penthouse', 'residential', 9, 12],
      ['office', 'commercial', 9, 12],
      ['warehouse', 'commercial', null, null],
    ]);
  });
});
