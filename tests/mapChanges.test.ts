import { describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import { HEIGHT_STEP_M, bairroLocator, compareBuildings, listingsAffected, readBuildings, report, type MapBuilding } from '../scripts/map-changes.mjs';
import { frame } from '../scripts/lib/scenery.mjs';
import meta from '../public/data/meta.json';

const LAT = -26.3;
const f = frame(LAT);
/** A point `east`/`north` metres from a reference corner in Joinville. */
const at = (east: number, north: number): [number, number] => [-48.85 + f.dx(east), LAT + f.dy(north)];
const b = (height: number, center: [number, number]): MapBuilding => ({ height, residential: true, center, size: 100 });

describe('relatório mensal do mapa', () => {
  const before = new Map([
    ['way/1', b(6, at(0, 0))],
    ['way/2', b(6, at(50, 0))],
    ['way/3', b(9, at(100, 0))],
    ['way/4', b(30, at(150, 0))],
  ]);
  const after = new Map([
    ['way/1', b(7, at(0, 0))], // +1 m: noise (an estimate of the same floors)
    ['way/2', b(6 + HEIGHT_STEP_M * 2, at(50, 0))], // two floors more
    ['way/30', b(15, at(101, 1))], // way/3 redrawn under a new id, now taller
    ['way/9', b(12, at(400, 400))], // new
    // way/4 removed
  ]);
  const diffs = compareBuildings(before, after, LAT);

  it('separa prédios novos, removidos, redesenhados e alturas alteradas', () => {
    expect(diffs.added.map((x) => x.id)).toEqual(['way/9']);
    expect(diffs.removed.map((x) => x.id)).toEqual(['way/4']);
    expect(diffs.redrawn).toEqual([expect.objectContaining({ from: 'way/3', to: 'way/30', heightFrom: 9, heightTo: 15 })]);
    expect(diffs.changed.map((c) => [c.id, c.from, c.to])).toEqual([
      ['way/2', 6, 12],
      ['way/30', 9, 15],
    ]);
  });

  it('localiza o bairro e lista os anúncios afetados', () => {
    const square = (x0: number, y0: number, side: number): Polygon => ({
      type: 'Polygon',
      coordinates: [[at(x0, y0), at(x0 + side, y0), at(x0 + side, y0 + side), at(x0, y0 + side), at(x0, y0)]],
    });
    const bairroOf = bairroLocator({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { name: 'Glória' }, geometry: square(-10, -10, 200) }],
    });
    expect(bairroOf(at(50, 0))).toBe('Glória');
    expect(bairroOf(at(400, 400))).toBeNull();

    const listings = [
      { id: 'a', title: 'Apto', referenceCode: 'AP1', buildingOsmId: 'way/2' },
      { id: 'b', title: 'Sala', buildingOsmId: 'way/4' },
      { id: 'c', title: 'Casa', buildingOsmId: 'way/3' },
      { id: 'd', title: 'Terreno' },
    ];
    const affected = listingsAffected(listings, [{ id: 'dev', name: 'Torre', hiddenBuildingIds: ['way/4'] }], diffs);
    expect(affected.map((x) => x.id)).toEqual(['a', 'b', 'c', 'dev']);
    expect(affected[0].what).toContain('de 6 m para 12 m');
    expect(affected[1].what).toContain('saiu do mapa');
    expect(affected[2].what).toContain('redesenhado');

    const md = report({
      diffs,
      beforeMeta: { osmTimestamp: '2026-09-02T01:00:00Z', counts: { buildings: 4, roadKmBySurface: { a: 10, u: 5 } } },
      afterMeta: { osmTimestamp: '2026-10-02T01:00:00Z', regionName: 'Joinville', counts: { buildings: 4, roadKmBySurface: { a: 12, u: 3 } } },
      bairroOf,
      listings,
    });
    expect(md).toContain('# Mapa: mudanças de 02/09/2026 para 02/10/2026');
    expect(md).toContain('- **Prédios novos:** 1');
    expect(md).toContain('| Glória | 0 | 1 | 2 |');
    expect(md).toContain('| Asfalto | 10 | 12 | +2 |');
    expect(md).toContain('| Sem pavimento (estrada de chão) | 5 | 3 | −2 |');
    expect(md).toContain('## Anúncios afetados');
  });

  it('lê todos os prédios do mapa publicado, e o mapa comparado com ele mesmo não muda', async () => {
    const map = await readBuildings(new URL(`../public/data/${meta.tiles}`, import.meta.url));
    expect(map.size).toBe(meta.counts.buildings);
    const same = compareBuildings(map, map);
    expect([same.added.length, same.removed.length, same.redrawn.length, same.changed.length]).toEqual([0, 0, 0, 0]);
  }, 30_000);
});
