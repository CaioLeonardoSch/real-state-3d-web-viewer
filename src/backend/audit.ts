// Entries of the audit log (public.org_audit) as sentences for the account panel. Pure functions, unit-tested.

export interface AuditEntry {
  id: number;
  at: string;
  actor_name: string | null;
  actor_email: string | null;
  actor_is_staff: boolean;
  table_name: string;
  row_id: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  /** Changed columns: { column: [before, after] }. */
  changes: Record<string, [unknown, unknown]>;
  listing_title: string | null;
  subject: string | null;
}

const ROLES: Record<string, string> = { owner: 'dono', admin: 'administrador', agent: 'corretor' };
const AVAILABILITY: Record<string, string> = { active: 'ativo', reserved: 'reservado', sold: 'vendido' };

/** Listing columns as people call them (others are summarised as "outros campos"). */
const FIELDS: Record<string, string> = {
  title: 'título',
  description: 'descrição',
  price: 'preço',
  rent_price: 'aluguel',
  condo_fee: 'condomínio',
  iptu_value: 'IPTU',
  area_m2: 'área',
  total_area_m2: 'área total',
  land_area_m2: 'área do terreno',
  bedrooms: 'quartos',
  suites: 'suítes',
  bathrooms: 'banheiros',
  parking_spots: 'vagas',
  covered_parking: 'vagas cobertas',
  unit_floor: 'andar',
  floors: 'andares',
  year_built: 'ano de construção',
  status: 'obra',
  floors_built: 'andamento da obra',
  construction_month: 'andamento da obra',
  features: 'comodidades',
  transaction: 'tipo de negócio',
  address: 'endereço',
  address_display: 'exibição do endereço',
  building_osm_id: 'local',
  video_url: 'vídeo',
  tour_url: 'tour 360°',
  advertiser: 'contato',
  reference_code: 'código',
  exclusive: 'exclusividade',
  highlight: 'destaque',
  availability: 'situação',
  published: 'publicação',
  type: 'tipo',
};
/** Columns kept by the server, never shown as a change. */
const HIDDEN = new Set(['previous_price', 'price_reduced_at', 'approx_radius_m', 'deleted_by', 'exclusive_verified', 'created_by', 'org_id', 'id', 'construction_source']);

const brl = (v: unknown) => (typeof v === 'number' ? `R$ ${v.toLocaleString('pt-BR')}` : '—');
const q = (s: string | null) => (s ? `"${s}"` : 'um anúncio');

export function actorLabel(e: AuditEntry): string {
  // no actor: the database itself (daily trash clean-up)
  const who = e.actor_name || e.actor_email || 'Sistema';
  return e.actor_is_staff ? `${who} (suporte)` : who;
}

/** What happened, e.g. 'alterou "Casa com quintal": preço de R$ 900.000 para R$ 850.000 e título'. */
export function describeAudit(e: AuditEntry): string {
  const c = e.changes ?? {};
  const after = (k: string) => c[k]?.[1];
  const before = (k: string) => c[k]?.[0];
  switch (e.table_name) {
    case 'listings': {
      if (e.action === 'INSERT') return `criou o anúncio ${q(e.listing_title)}`;
      if (e.action === 'DELETE') return `excluiu definitivamente ${q(e.listing_title)}`;
      if ('deleted_at' in c) return after('deleted_at') ? `moveu ${q(e.listing_title)} para a lixeira` : `restaurou ${q(e.listing_title)} da lixeira`;
      const parts: string[] = [];
      const keys = Object.keys(c).filter((k) => !HIDDEN.has(k));
      if (keys.includes('price')) parts.push(`preço de ${brl(before('price'))} para ${brl(after('price'))}`);
      if (keys.includes('availability'))
        parts.push(`situação para ${AVAILABILITY[String(after('availability'))] ?? String(after('availability'))}`);
      const named = [...new Set(keys.filter((k) => k !== 'price' && k !== 'availability' && FIELDS[k]).map((k) => FIELDS[k]))];
      if (named.length) parts.push(named.join(', '));
      if (keys.some((k) => !FIELDS[k])) parts.push('outros campos');
      return `alterou ${q(e.listing_title)}${parts.length ? `: ${joinPt(parts)}` : ''}`;
    }
    case 'listing_photos':
      return e.action === 'INSERT'
        ? `${after('is_floor_plan') ? 'enviou a planta' : 'adicionou uma foto'} em ${q(e.listing_title)}`
        : `removeu ${before('is_floor_plan') ? 'a planta' : 'uma foto'} de ${q(e.listing_title)}`;
    case 'memberships': {
      const who = e.subject ?? 'uma pessoa';
      if (e.action === 'INSERT') return `${who} entrou na equipe como ${ROLES[String(after('role'))] ?? 'membro'}`;
      if (e.action === 'DELETE') return `removeu ${who} da equipe`;
      return `mudou o papel de ${who} para ${ROLES[String(after('role'))] ?? String(after('role'))}`;
    }
    case 'invitations':
      return e.action === 'INSERT'
        ? `convidou ${e.subject ?? 'alguém'} como ${ROLES[String(after('role'))] ?? 'membro'}`
        : `cancelou o convite de ${e.subject ?? 'alguém'}`;
    case 'organizations':
      return e.action === 'INSERT' ? 'cadastrou a imobiliária' : e.action === 'DELETE' ? 'excluiu a imobiliária' : 'alterou os dados da imobiliária';
    default:
      return `${e.action.toLowerCase()} em ${e.table_name}`;
  }
}

/** ["a", "b", "c"] → "a, b e c". */
function joinPt(items: string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
}
