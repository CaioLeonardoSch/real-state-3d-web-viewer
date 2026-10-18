import { describe, expect, it } from 'vitest';
import { developmentRow, hasDrawing, rowsToDevelopment, unitAppId, unitFinal, unitRows, type DevelopmentRow, type UnitRow } from '../src/backend/developments';
import { parseBrDate, parseBrNumber, parseUnitsCsv, splitCsv, unitsCsv, type TeamUnit } from '../src/backend/unitsCsv';
import { validateDevelopmentsFile } from '../src/data/developments';
import raw from '../public/data/developments.json';

const cora = validateDevelopmentsFile(raw).developments.find((d) => d.id === 'cora')!;

describe('espelho de vendas: banco ↔ mapa', () => {
  it('ids das unidades: o mesmo do arquivo de demonstração; a torre entra quando há', () => {
    expect(unitAppId('cora', '', '1502')).toBe('cora-1502');
    expect(unitAppId('vista', 'Torre B', '1502')).toBe('vista-torre-b-1502');
    expect(unitFinal('1502', 15)).toBe(2);
    expect(unitFinal('B12', 1)).toBe(12);
  });

  it('ida e volta: o desenho enviado volta igual; venda e preço vêm do banco', () => {
    const dev = developmentRow(cora);
    const units = unitRows(cora, false);
    expect(units.every((u) => u.status === 'available' && u.price === null && u.reserved_until === null)).toBe(true);
    const row: DevelopmentRow = { id: 'uuid-dev', org_id: 'uuid-org', show_prices: true, ...dev };
    const unitRowsDb: UnitRow[] = units.map((u, i) => ({ ...u, id: `u${i}`, development_id: 'uuid-dev', price: i === 0 ? '650000.00' : null }));
    const back = rowsToDevelopment(row, unitRowsDb);
    expect(back.id).toBe('cora');
    expect(back.backend).toEqual({ id: 'uuid-dev', orgId: 'uuid-org', showPrices: true });
    expect(back.levels.map((l) => l.level)).toEqual(cora.levels.map((l) => l.level));
    const ids = (d: typeof cora) => d.levels.flatMap((l) => l.units.map((u) => u.id));
    expect(ids(back)).toEqual(ids(cora));
    const first = back.levels.flatMap((l) => l.units)[0];
    expect(first.price).toBe(650000);
    expect(first.dbId).toBe('u0');
    expect(back.levels.flatMap((l) => l.units)[1].price).toBeNull();
  });

  it('desenho incompleto no banco fica de fora do mapa em vez de quebrá-lo', () => {
    const L = developmentRow(cora).layout;
    expect(hasDrawing(JSON.parse(JSON.stringify(L)))).toBe(true);
    expect(hasDrawing({ levels: [], shapes: [] })).toBe(false);
    expect(hasDrawing({ ...L, location: ['x', 1] })).toBe(false);
    expect(hasDrawing(null)).toBe(false);
  });

  it('com --with-sales: reserva ganha o prazo do empreendimento', () => {
    const now = new Date('2026-10-17T12:00:00Z');
    const r = unitRows(cora, true, 48, now).find((u) => u.status === 'reserved');
    expect(r?.reserved_until).toBe('2026-10-19T12:00:00.000Z');
  });

  it('unidade fora do desenho (andar ou forma que não existem) fica de fora do mapa', () => {
    const row: DevelopmentRow = { id: 'd', org_id: 'o', show_prices: true, ...developmentRow(cora) };
    const base = { id: 'x', development_id: 'd', tower: '', plan: 'A', area_m2: 50, bedrooms: 1, suites: 0, parking_spots: 1, cells: 1, price: null, status: 'available' as const };
    const back = rowsToDevelopment(row, [
      { ...base, floor: 99, number: '9901', shape: 0 },
      { ...base, floor: 5, number: '599', shape: 999 },
    ]);
    expect(back.levels.flatMap((l) => l.units)).toHaveLength(0);
  });
});

const unit = (extra: Partial<TeamUnit> = {}): TeamUnit => ({
  tower: '', floor: 15, number: '1502', plan: 'Apto B', areaM2: 86.5, bedrooms: 3, suites: 1, parkingSpots: 2, price: 990000,
  status: 'available', reservedUntil: null, reservedByName: null, reservedNote: null, ...extra,
});

describe('espelho de vendas: planilha', () => {
  it('baixar: ; entre colunas, BOM, números com vírgula, situação em português, sem fórmulas', () => {
    const csv = unitsCsv([
      unit(),
      unit({ number: '1503', price: null, status: 'reserved', reservedUntil: '2026-10-18T17:30:00Z', reservedByName: 'Bruno', reservedNote: '=cmd' }),
    ]);
    expect(csv.startsWith('﻿Torre;Andar;Unidade;Planta;Área (m²)')).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[1]).toBe(';15;1502;Apto B;86,5;3;1;2;990000;Disponível;;;');
    expect(lines[2]).toBe(";15;1503;Apto B;86,5;3;1;2;;Reservada;18/10/2026 14:30;Bruno;'=cmd");
  });

  it('o que se baixa volta igual ao enviar', () => {
    const { rows, errors } = parseUnitsCsv(unitsCsv([unit(), unit({ tower: 'B', number: '101', floor: 1, price: null, status: 'sold' })]));
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { tower: '', number: '1502', plan: 'Apto B', areaM2: 86.5, bedrooms: 3, suites: 1, parkingSpots: 2, price: 990000, status: 'available' },
      { tower: 'B', number: '101', plan: 'Apto B', areaM2: 86.5, bedrooms: 3, suites: 1, parkingSpots: 2, price: null, status: 'sold' },
    ]);
  });

  it('aceita a planilha do próprio cliente: vírgula, nomes sem acento, R$ e só as colunas que quer mudar', () => {
    const { rows, errors } = parseUnitsCsv('Apto,Valor,Status\n1502,"R$ 1.234.567,89",vendido\n1503,,livre\n1504,1.200.000,\n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { tower: '', number: '1502', price: 1234567.89, status: 'sold' },
      { tower: '', number: '1503', price: null, status: 'available' },
      { tower: '', number: '1504', price: 1200000 },
    ]);
  });

  it('erros com o número da linha; nada é enviado se houver algum', () => {
    const r = parseUnitsCsv('Unidade;Preço;Situação;Reservada até\n1502;abc;;\n1502;;;\n;100;;\n1601;;talvez;\n1701;;Reservada;01/01/2020\n1801;;Reservada;31/02/x\n');
    expect(r.errors).toEqual([
      'Linha 2: preço "abc" inválido',
      'Linha 3: unidade 1502 repetida',
      'Linha 4: falta o número da unidade',
      'Linha 5: situação "talvez" desconhecida (use Disponível, Reservada ou Vendida)',
      'Linha 6: a reserva já venceu (mude a data ou a situação)',
      'Linha 7: data "31/02/x" inválida (use dd/mm/aaaa ou dd/mm/aaaa hh:mm)',
    ]);
    expect(parseUnitsCsv('Preço\n100\n').errors).toEqual(['Falta a coluna "Unidade" (o número do apartamento).']);
    expect(parseUnitsCsv('').errors).toHaveLength(1);
  });

  it('a data da reserva só vale com a situação "Reservada"', () => {
    const { rows } = parseUnitsCsv('Unidade;Situação;Reservada até\n1502;Vendida;20/10/2099\n1503;Reservada;20/10/2099 10:00\n');
    expect(rows[0]).toEqual({ tower: '', number: '1502', status: 'sold' });
    expect(rows[1].reservedUntil).toBe('2099-10-20T13:00:00.000Z');
  });

  it('números, datas e células', () => {
    expect(parseBrNumber('86,5 m²')).toBe(86.5);
    expect(parseBrNumber('1.200')).toBe(1200);
    expect(parseBrNumber('1200.5')).toBe(1200.5);
    expect(parseBrNumber('')).toBeNull();
    expect(parseBrNumber('x')).toBeNaN();
    expect(parseBrDate('5/1/2027')).toBe('2027-01-06T02:59:00.000Z');
    expect(parseBrDate('')).toBeNull();
    expect(parseBrDate('ontem')).toBe('');
    expect(splitCsv('a;"b;c";"d ""e"""\r\n\r\n"f\ng";h')).toEqual([['a', 'b;c', 'd "e"'], ['f\ng', 'h']]);
  });
});
