import { describe, expect, it } from 'vitest';
import { todayInBrazil, visitDays } from '../src/ui/visitRequest';

describe('pedido de visita', () => {
  it('o dia é o de Joinville, não o do relógio do visitante', () => {
    expect(todayInBrazil(new Date('2026-10-18T02:00:00Z'))).toBe('2026-10-17');
    expect(todayInBrazil(new Date('2026-10-18T12:00:00Z'))).toBe('2026-10-18');
  });

  it('oferece 14 dias a partir de amanhã, com o dia da semana, virando mês e ano', () => {
    const days = visitDays('2026-12-25');
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ value: '2026-12-26', label: 'sáb, 26/12' });
    expect(days[6]).toEqual({ value: '2027-01-01', label: 'sex, 01/01' });
  });
});
