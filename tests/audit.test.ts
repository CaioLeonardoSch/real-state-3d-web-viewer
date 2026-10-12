import { describe, expect, it } from 'vitest';
import { actorLabel, describeAudit, type AuditEntry } from '../src/backend/audit';

const e = (table_name: string, action: AuditEntry['action'], changes: AuditEntry['changes'], extra: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 1, at: '2026-10-13T10:00:00Z', actor_name: 'Ana', actor_email: 'ana@x.com', actor_is_staff: false, table_name, row_id: 'r',
  action, changes, listing_title: 'Casa com quintal', subject: null, ...extra,
});

describe('describeAudit', () => {
  it('listings: create, edit (price, situation and named fields), trash, restore, delete', () => {
    expect(describeAudit(e('listings', 'INSERT', {}))).toBe('criou o anúncio "Casa com quintal"');
    expect(describeAudit(e('listings', 'UPDATE', {
      price: [900000, 850000], availability: ['active', 'reserved'], title: ['a', 'b'], description: ['x', 'y'],
      previous_price: [null, 900000], building_height_m: [6, 9],
    }))).toBe('alterou "Casa com quintal": preço de R$ 900.000 para R$ 850.000, situação para reservado, título, descrição e outros campos');
    expect(describeAudit(e('listings', 'UPDATE', { deleted_at: [null, '2026-10-13'] }))).toBe('moveu "Casa com quintal" para a lixeira');
    expect(describeAudit(e('listings', 'UPDATE', { deleted_at: ['2026-10-13', null] }))).toBe('restaurou "Casa com quintal" da lixeira');
    expect(describeAudit(e('listings', 'DELETE', {}))).toBe('excluiu definitivamente "Casa com quintal"');
  });
  it('team, invitations and photos', () => {
    expect(describeAudit(e('memberships', 'INSERT', { role: [null, 'agent'] }, { subject: 'Bruno' }))).toBe('Bruno entrou na equipe como corretor');
    expect(describeAudit(e('memberships', 'UPDATE', { role: ['agent', 'admin'] }, { subject: 'Bruno' }))).toBe('mudou o papel de Bruno para administrador');
    expect(describeAudit(e('memberships', 'DELETE', {}, { subject: 'Bruno' }))).toBe('removeu Bruno da equipe');
    expect(describeAudit(e('invitations', 'INSERT', { role: [null, 'admin'] }, { subject: 'c@x.com' }))).toBe('convidou c@x.com como administrador');
    expect(describeAudit(e('listing_photos', 'INSERT', { is_floor_plan: [null, false] }))).toBe('adicionou uma foto em "Casa com quintal"');
    expect(describeAudit(e('listing_photos', 'DELETE', { is_floor_plan: [true, null] }))).toBe('removeu a planta de "Casa com quintal"');
  });
  it('who: support staff marked, database jobs as "Sistema"', () => {
    expect(actorLabel(e('listings', 'INSERT', {}, { actor_is_staff: true }))).toBe('Ana (suporte)');
    expect(actorLabel(e('listings', 'DELETE', {}, { actor_name: null, actor_email: null }))).toBe('Sistema');
  });
});
