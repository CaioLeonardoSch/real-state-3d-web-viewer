import { describe, expect, it } from 'vitest';
import { csvCell, leadsCsv, statsCsv } from '../src/backend/leadsCsv';
import { searchTerm, type Lead } from '../src/backend/remote';

const lead = (extra: Partial<Lead> = {}): Lead => ({
  id: '1', listingId: 'l1', listingTitle: 'Apartamento no Centro', assignedTo: 'u1', source: 'form', details: null,
  name: 'Maria', email: 'maria@x.com', phone: '47999990000', message: 'Tenho interesse', status: 'new', notes: null,
  createdAt: '2026-10-17T13:05:00Z', ...extra,
});

describe('planilha de contatos', () => {
  it('células: aspas quando há ; " ou quebra de linha; fórmulas viram texto', () => {
    expect(csvCell('simples')).toBe('simples');
    expect(csvCell(null)).toBe('');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell('linha 1\r\nlinha 2')).toBe('"linha 1\nlinha 2"');
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+5547')).toBe("'+5547");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@soma')).toBe("'@soma");
  });

  it('cabeçalho, BOM, horário de Brasília, origem, situação e responsável pelo nome', () => {
    const csv = leadsCsv([lead(), lead({ id: '2', source: 'owner', details: { tipo: 'Casa', bairro: 'Glória' }, status: 'won', assignedTo: null, notes: 'Fechou' })], [
      { userId: 'u1', name: 'Bruno', email: 'bruno@x.com' } as never,
    ]);
    expect(csv.startsWith('﻿Data;Nome;E-mail;Telefone;Origem;Anúncio;Mensagem;Detalhes;Situação;Responsável;Anotações\r\n')).toBe(true);
    const [, first, second] = csv.split('\r\n');
    expect(first).toBe('17/10/2026, 10:05:00;Maria;maria@x.com;47999990000;Anúncio;Apartamento no Centro;Tenho interesse;;Novo;Bruno;');
    expect(second).toContain(';Quer anunciar (pelo site);');
    expect(second).toContain(';"tipo: Casa; bairro: Glória";');
    expect(second.endsWith(';;Fechou')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('busca: tira o que quebraria o filtro do servidor, mantém e-mail e telefone', () => {
    expect(searchTerm(' maria@x.com ')).toBe('maria@x.com');
    expect(searchTerm('a,b) or (c*%')).toBe('a b or c');
    expect(searchTerm('(47) 99999-0000')).toBe('47 99999-0000');
    expect(searchTerm(undefined)).toBe('');
    expect(searchTerm('x'.repeat(100))).toHaveLength(60);
  });

  it('planilha de desempenho: uma linha por anúncio, números puros', () => {
    const csv = statsCsv([{ id: 'a', title: '=Casa; nova', referenceCode: 'C-1', published: false, createdBy: null, viewsMap: 12, viewsSite: 3, whatsapp: 2, messages: 1 }], 30);
    expect(csv.split('\r\n')).toEqual([
      '\uFEFFAnúncio;Código;Situação;Visualizações no mapa (30 dias);Visualizações no site;Cliques no WhatsApp;Mensagens',
      `"'=Casa; nova";C-1;Rascunho;12;3;2;1`,
      '',
    ]);
  });
});
