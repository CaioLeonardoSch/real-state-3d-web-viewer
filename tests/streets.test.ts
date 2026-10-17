import { describe, expect, it } from 'vitest';
import {
  StreetFinder,
  findBairros,
  hasStreetType,
  parseStreetsFile,
  publicStreet,
  sameStreet,
  streetKey,
  type StreetEntry,
} from '../src/data/streets';

describe('streetKey', () => {
  it('a mesma rua escrita de vários jeitos dá a mesma chave', () => {
    const xv = streetKey('Rua XV de Novembro');
    for (const n of ['R. XV de Novembro', 'RUA 15 DE NOVEMBRO, 1208', 'Rua Quinze de Novembro', 'rua xv de novembro'])
      expect(streetKey(n), n).toBe(xv);
    expect(streetKey('Av. Dr. Albano Schulz')).toBe(streetKey('Avenida Doutor Albano Schulz'));
    expect(streetKey('Rua Dr João Colin nº 1234')).toBe(streetKey('Rua Doutor João Colin'));
    expect(streetKey('R. João Colin, s/n')).toBe(streetKey('Rua João Colin'));
    expect(streetKey('Rua Visconde de Mauá, 1297 (esquina) – América')).toBe(streetKey('Rua Visconde de Mauá'));
    expect(streetKey('Rua Max Colin, 100 - Centro')).toBe(streetKey('Rua Max Colin'));
    expect(streetKey('Rua Sete de Setembro')).toBe(streetKey('Rua 7 de Setembro'));
    expect(streetKey('Rua Vinte e Cinco de Julho')).toBe(streetKey('Rua 25 de Julho'));
    expect(streetKey('Rua Prof.ª Maria')).toBe(streetKey('Rua Professora Maria'));
  });
  it('nomes diferentes continuam diferentes', () => {
    expect(streetKey('Rua Blumenau')).not.toBe(streetKey('Estrada Blumenau'));
    expect(streetKey('Rua Monsenhor Gercino')).not.toBe(streetKey('Rua Major Gercino'));
    expect(streetKey('Rua XV de Novembro')).not.toBe(streetKey('Rua Quinze de Outubro'));
    // a road number is part of the name, a house number is not
    expect(streetKey('Rodovia BR-101')).toBe('rodovia br 101');
    // a name that is only a letter or a number keeps it
    expect(streetKey('Rua E')).toBe('rua e');
    expect(streetKey('Rua 15')).toBe('rua 15');
    expect(streetKey('Rua das Flores')).toBe('rua flores');
  });
  it('sabe se o nome começa pelo tipo', () => {
    expect(hasStreetType('Av. Getúlio Vargas')).toBe(true);
    expect(hasStreetType('Servidão Santos')).toBe(true);
    expect(hasStreetType('Gen. Andrade Neves')).toBe(false);
  });
});

describe('sameStreet', () => {
  it('compara a rua do anúncio com o nome do mapa', () => {
    expect(sameStreet('R. XV de Novembro, 1208', 'Rua XV de Novembro')).toBe(true);
    expect(sameStreet('rua quinze de novembro', 'Rua XV de Novembro')).toBe(true);
    // without the type, the listing still names the street
    expect(sameStreet('Gen. Andrade Neves', 'Rua General Andrade Neves')).toBe(true);
  });
  it('não confunde ruas parecidas', () => {
    expect(sameStreet('Rua Blumenau', 'Estrada Blumenau')).toBe(false);
    expect(sameStreet('Rua Monsenhor Gercino', 'Rua Major Gercino')).toBe(false);
    expect(sameStreet('Rua XV', 'Rua XV de Novembro')).toBe(false);
    expect(sameStreet('', 'Rua XV de Novembro')).toBe(false);
  });
});

describe('publicStreet', () => {
  const address = { street: 'Rua das Palmeiras', number: '10', bairro: 'Centro', city: 'Joinville' };
  it('só a rua que o anúncio mostra ao público', () => {
    expect(publicStreet({ address, addressDisplay: 'full' })).toBe('Rua das Palmeiras');
    expect(publicStreet({ address, addressDisplay: 'street' })).toBe('Rua das Palmeiras');
    expect(publicStreet({ address, addressDisplay: 'neighborhood' })).toBeNull();
    // missing display = neighbourhood only (as in addressLabel)
    expect(publicStreet({ address })).toBeNull();
    expect(publicStreet({ addressDisplay: 'full' })).toBeNull();
    expect(publicStreet({ address: { ...address, street: '  ' }, addressDisplay: 'full' })).toBeNull();
  });
});

describe('parseStreetsFile', () => {
  const good = {
    v: 1,
    places: [
      ['Centro', 'Joinville'],
      ['', 'Araquari'],
    ],
    streets: [
      ['Rua XV de Novembro', 0, -48.9, -26.31, -48.84, -26.28, -48.85, -26.3],
      ['Rua das Oliveiras', 1, -48.7, -26.4, -48.69, -26.39, -48.695, -26.395],
    ],
  };
  it('lê os lugares e as ruas', () => {
    expect(parseStreetsFile(good)).toEqual([
      { name: 'Rua XV de Novembro', bairro: 'Centro', city: 'Joinville', bbox: [-48.9, -26.31, -48.84, -26.28], point: [-48.85, -26.3] },
      { name: 'Rua das Oliveiras', bairro: '', city: 'Araquari', bbox: [-48.7, -26.4, -48.69, -26.39], point: [-48.695, -26.395] },
    ]);
  });
  it('recusa arquivos estragados', () => {
    const row = good.streets[0];
    for (const raw of [
      null,
      [],
      { ...good, v: 2 },
      { v: 1, places: good.places },
      { ...good, places: [['Centro']] },
      { ...good, streets: [row.slice(0, 7)] },
      { ...good, streets: [['', ...row.slice(1)]] },
      { ...good, streets: [[row[0], 5, ...row.slice(2)]] },
      { ...good, streets: [[...row.slice(0, 2), 'x', ...row.slice(3)]] },
      { ...good, streets: [[...row.slice(0, 2), -48.84, -26.31, -48.9, -26.28, -48.85, -26.3]] },
    ])
      expect(() => parseStreetsFile(raw), JSON.stringify(raw)).toThrow(/Lista de ruas inválida/);
  });
});

describe('sugestões da caixa "Bairro ou rua"', () => {
  const at = (name: string, bairro: string, city = 'Joinville'): StreetEntry => ({ name, bairro, city, bbox: [0, 0, 1, 1], point: [0.5, 0.5] });
  const finder = new StreetFinder([
    at('Rua Quinze de Outubro', 'Itinga'),
    at('Rua XV de Novembro', 'Centro'),
    at('Rua XV de Novembro', 'Centro'),
    at('Rua das Oliveiras', 'Glória'),
    at('Rua das Oliveiras', '', 'Araquari'),
    at('Rua Monte das Oliveiras', 'Guanabara'),
    at('Avenida Getúlio Vargas', 'Bucarein'),
    at('Rua Sete Lagoas', 'Centro'),
    at('Rua Três de Setembro', 'Centro'),
    at('Rua Sete de Setembro', 'Centro'),
    at('Rua Doutor João Colin', 'América'),
  ]);
  const names = (q: string, cut: string[] = []) => finder.find(q, 8, cut).map((s) => `${s.name} (${s.bairro || s.city})`);
  it('acha pelo começo das palavras, sem o tipo da rua', () => {
    // the same name in the same place is one suggestion
    expect(names('xv')).toEqual(['Rua XV de Novembro (Centro)', 'Rua Quinze de Outubro (Itinga)']);
    expect(names('oliveiras')).toEqual(['Rua das Oliveiras (Glória)', 'Rua das Oliveiras (Araquari)', 'Rua Monte das Oliveiras (Guanabara)']);
    expect(names('av get')).toEqual(['Avenida Getúlio Vargas (Bucarein)']);
    expect(names('rua get')).toEqual([]);
    expect(names('dr joao')).toEqual(['Rua Doutor João Colin (América)']);
    expect(names('15 nov')).toEqual(['Rua XV de Novembro (Centro)']);
    // each word typed is a different word of the name
    expect(names('sete set')).toEqual(['Rua Sete de Setembro (Centro)']);
  });
  it('com bairros escolhidos, só as ruas deles', () => {
    expect(names('oliveiras', ['gloria'])).toEqual(['Rua das Oliveiras (Glória)']);
    expect(names('xv', ['Itinga'])).toEqual(['Rua Quinze de Outubro (Itinga)']);
  });
  it('avisa quando o nome existe em outro lugar', () => {
    const [gloria] = finder.find('oliveiras', 1);
    expect(finder.inOtherPlaces(gloria)).toBe(true);
    expect(finder.inOtherPlaces(finder.find('xv de nov', 1)[0])).toBe(false);
  });
  it('uma rua que atravessa bairros: uma sugestão por bairro, nunca juntadas', () => {
    const box = (w: number): StreetEntry['bbox'] => [w, 0, w + 1, 1];
    const xv = new StreetFinder([
      { ...at('Rua XV de Novembro', 'Centro'), bbox: box(0) },
      { ...at('Rua XV de Novembro', 'América'), bbox: box(2) },
      { ...at('Rua XV de Novembro', 'Centro', 'Araquari'), bbox: box(4) },
      { ...at('Rua XV de Novembro', 'Glória'), bbox: box(6) },
      // the same name and place twice (a bad file): one option covering both
      { ...at('Rua XV de Novembro', 'Glória'), bbox: box(8) },
    ]);
    const found = xv.find('xv', 8);
    expect(found.map((s) => `${s.bairro}, ${s.city}`)).toEqual(['Centro, Joinville', 'América, Joinville', 'Centro, Araquari', 'Glória, Joinville']);
    expect(found.map((s) => s.bbox)).toEqual([box(0), box(2), box(4), [6, 0, 9, 1]]);
    expect(found.every((s) => xv.inOtherPlaces(s))).toBe(true);
    // a cut by name keeps the Centro of both cities, as the map's cut does (bairros-areas has both)
    expect(xv.find('xv', 8, ['Centro']).map((s) => s.city)).toEqual(['Joinville', 'Araquari']);
  });
  it('bairros: começos de palavra, sem acento', () => {
    const bairros = ['Glória', 'Centro', 'Vila Nova', 'Nova Brasília', 'América'];
    expect(findBairros(bairros, 'glo', 6)).toEqual(['Glória']);
    expect(findBairros(bairros, 'NOVA', 6)).toEqual(['Nova Brasília', 'Vila Nova']);
    expect(findBairros(bairros, 'xv', 6)).toEqual([]);
  });
});
