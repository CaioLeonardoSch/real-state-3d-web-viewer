import { describe, expect, it } from 'vitest';
import { buildAddressIndex, locateAddress, parseCoordinates, streetKey, type AddressFile } from '../src/data/addresses';
import raw from '../public/data/enderecos.json';

const file = raw as unknown as AddressFile;
const ix = buildAddressIndex(file);

describe('endereço → lote do cadastro', () => {
  it('normaliza o nome da rua como o cadastro escreve', () => {
    expect(streetKey('Rua XV de Novembro')).toBe(streetKey('QUINZE DE NOVEMBRO'));
    expect(streetKey('R. 15 de Novembro')).toBe('QUINZE NOVEMBRO');
    expect(streetKey('Av. Dr. João Colin')).toBe(streetKey('DOUTOR JOÃO COLIN'));
    expect(streetKey('Rua Vinte e Nove de Novembro')).toBe(streetKey('VINTE NOVE NOVEMBRO'));
    expect(streetKey('Rua 29 de Novembro')).toBe(streetKey('VINTE NOVE NOVEMBRO'));
  });

  it('acha o lote pelo número, ou o vizinho do mesmo lado da rua', () => {
    const [name, rows] = file.streets.find(([n]) => n === 'QUINZE DE NOVEMBRO')!;
    const row = rows.find((r) => r[0] > 1000)!;
    const r = locateAddress(ix, 'Rua XV de Novembro', row[0]);
    expect(r).toMatchObject({ kind: 'found', exact: true, number: row[0], street: 'Quinze de Novembro' });
    if (r.kind !== 'found') return;
    expect(r.point[0]).toBeCloseTo(file.origin[0] + row[1] / 1e5, 4);
    expect(name).toBe('QUINZE DE NOVEMBRO');
    // a number missing from the cadastre: the nearest one on the same side
    const missing = Array.from({ length: 30 }, (_, i) => row[0] + 2 * (i + 1)).find((n) => !rows.some((x) => x[0] === n))!;
    const near = locateAddress(ix, 'XV de Novembro', missing);
    expect(near).toMatchObject({ kind: 'found', exact: false });
    if (near.kind === 'found') expect(near.number % 2).toBe(missing % 2);
  });

  it('completa o nome pelas palavras quando só uma rua as tem', () => {
    expect(locateAddress(ix, 'Rua João Colin', 1500)).toMatchObject({ kind: 'found', street: 'Doutor João Colin' });
  });

  it('diz o que faltou', () => {
    expect(locateAddress(ix, 'Rua Que Não Existe Aqui', 10)).toEqual({ kind: 'no-street' });
    expect(locateAddress(ix, 'XV de Novembro', 99999)).toMatchObject({ kind: 'no-number', street: 'Quinze de Novembro' });
  });
});

describe('coordenadas coladas do Google Maps', () => {
  it('lê os formatos comuns', () => {
    expect(parseCoordinates('-26.30442, -48.84612')).toEqual([-48.84612, -26.30442]);
    expect(parseCoordinates('https://www.google.com/maps/@-26.3044,-48.8461,3a,75y,90t/data=!3m6')).toEqual([-48.8461, -26.3044]);
    expect(parseCoordinates('https://www.google.com/maps/place/X/@-26.30,-48.84,17z/data=!3m1!4b1!4m6!3m5!8m2!3d-26.3051!4d-48.8472')).toEqual([-48.8472, -26.3051]);
    expect(parseCoordinates('https://maps.google.com/?q=-26.31%2C-48.85')).toEqual([-48.85, -26.31]);
  });
  it('recusa o que não traz coordenadas', () => {
    expect(parseCoordinates('https://maps.app.goo.gl/abc123')).toBeNull();
    expect(parseCoordinates('Rua XV de Novembro, 100')).toBeNull();
    expect(parseCoordinates('200, 300')).toBeNull();
  });
});
