import type { Listing } from '../data/types';

interface Room {
  label: string;
  w: number; // relative weight within its row
}

/**
 * Generic, illustrative floor plan as an SVG string. Rooms are plain rectangles whose total
 * footprint is proportional to the listing area. NOT a real plan.
 */
export function floorPlanSvg(l: Listing): string {
  const W = 320;
  const H = 220;
  const pad = 10;
  if (l.type === 'land') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Terreno ilustrativo">
  <rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="6 4"/>
  <text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="14" fill="currentColor">Terreno · ${Math.round(l.areaM2)} m²</text>
</svg>`;
  }

  // Footprint: area scaled to the drawing; aspect ~1.5:1
  const area = Math.max(30, l.areaM2);
  const scale = Math.min(1, Math.sqrt(area / 220)); // 220 m² fills the box
  const fw = (W - 2 * pad) * scale;
  const fh = (H - 2 * pad) * scale;
  const ox = (W - fw) / 2;
  const oy = (H - fh) / 2;

  const bedrooms = Math.max(1, l.bedrooms);
  const top: Room[] = [
    { label: 'Sala', w: 2 },
    { label: 'Cozinha', w: 1.2 },
  ];
  if (l.type !== 'apartment') top.push({ label: 'Serviço', w: 0.7 });
  const bottom: Room[] = [];
  for (let i = 0; i < bedrooms; i++) bottom.push({ label: i === 0 && bedrooms > 1 ? 'Suíte' : 'Quarto', w: 1.2 });
  for (let i = 0; i < Math.max(1, l.bathrooms - (bedrooms > 1 ? 1 : 0)); i++) bottom.push({ label: 'Banho', w: 0.6 });

  const rows: [Room[], number][] = [
    [top, 0.48],
    [bottom, 0.52],
  ];
  let y = oy;
  const rects: string[] = [];
  for (const [rooms, hFrac] of rows) {
    const rh = fh * hFrac;
    const total = rooms.reduce((s, r) => s + r.w, 0);
    let x = ox;
    for (const r of rooms) {
      const rw = (fw * r.w) / total;
      const fontSize = Math.max(8, Math.min(12, rw / 5));
      rects.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
          `<text x="${(x + rw / 2).toFixed(1)}" y="${(y + rh / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="${fontSize.toFixed(1)}" fill="currentColor">${r.label}</text>`,
      );
      x += rw;
    }
    y += rh;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Planta ilustrativa">
  <rect x="${ox.toFixed(1)}" y="${oy.toFixed(1)}" width="${fw.toFixed(1)}" height="${fh.toFixed(1)}" fill="none" stroke="currentColor" stroke-width="3"/>
  ${rects.join('\n  ')}
</svg>`;
}
