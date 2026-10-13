// Illustration for listings without photos (the demo listings have none): a simple drawing of the property type
// in the site's colours, clearly not a photo. Deterministic per listing, so the page does not flicker.
import type { Listing } from '../data/types';
import { mix } from './config';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function placeholderPhoto(l: Pick<Listing, 'id' | 'type' | 'floors'>, primary: string, dark: boolean): string {
  const h = hash(l.id);
  const sky = dark ? mix(primary, '#0b0d10', 0.78) : mix(primary, '#ffffff', 0.82);
  const ground = dark ? mix(primary, '#000000', 0.55) : mix(primary, '#ffffff', 0.55);
  const body = dark ? mix(primary, '#ffffff', 0.12) : primary;
  const light = mix(body, '#ffffff', 0.55);
  const shift = (h % 60) - 30;
  let shape = '';
  if (l.type === 'apartment') {
    const floors = Math.min(14, Math.max(5, l.floors ?? 6 + (h % 7)));
    const top = 200 - floors * 11;
    shape = `<rect x="${150 + shift}" y="${top}" width="100" height="${floors * 11 + 20}" fill="${body}"/>`;
    for (let f = 0; f < floors; f++)
      for (let c = 0; c < 4; c++)
        shape += `<rect x="${158 + shift + c * 23}" y="${top + 6 + f * 11}" width="14" height="6" fill="${light}" opacity="${(h >> (f + c)) & 1 ? 0.95 : 0.55}"/>`;
    shape += `<rect x="${60 + shift / 2}" y="140" width="70" height="80" fill="${mix(body, sky, 0.45)}"/><rect x="${270 + shift / 3}" y="120" width="60" height="100" fill="${mix(body, sky, 0.6)}"/>`;
  } else if (l.type === 'land') {
    shape = `<path d="M40 215 L120 175 L320 180 L370 215 Z" fill="${mix(ground, body, 0.25)}"/><path d="M120 175 L320 180" stroke="${light}" stroke-dasharray="6 6" stroke-width="2"/><rect x="${215 + shift}" y="160" width="3" height="30" fill="${body}"/><path d="M${218 + shift} 160 l22 7 -22 7z" fill="${light}"/>`;
  } else {
    const w = l.type === 'semi_detached' ? 180 : 140;
    const x = 200 - w / 2 + shift;
    shape = `<rect x="${x}" y="140" width="${w}" height="80" fill="${body}"/><path d="M${x - 14} 142 L${x + w / 2} 92 L${x + w + 14} 142 Z" fill="${mix(body, '#000000', 0.25)}"/>`;
    shape += `<rect x="${x + w / 2 - 12}" y="180" width="24" height="40" fill="${light}"/>`;
    shape += `<rect x="${x + 16}" y="160" width="26" height="20" fill="${light}"/><rect x="${x + w - 42}" y="160" width="26" height="20" fill="${light}"/>`;
    if (l.type === 'semi_detached') shape += `<rect x="${x + w / 2 - 1}" y="118" width="2" height="102" fill="${sky}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect width="400" height="260" fill="${sky}"/><circle cx="${330 - shift}" cy="60" r="22" fill="${light}" opacity=".7"/><rect y="215" width="400" height="45" fill="${ground}"/>${shape}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
