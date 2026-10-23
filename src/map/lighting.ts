import { getPosition } from 'suncalc';
import { REGION } from '../config/region';

export type TimeOfDay = 'morning' | 'afternoon' | 'night';

/** Fixed reference date (March equinox 2026), in the region's local time (Joinville: UTC−03:00, no DST since 2019). */
export const REFERENCE_TIMES: Record<TimeOfDay, string> = {
  morning: `2026-03-20T09:00:00${REGION.utcOffset}`,
  afternoon: `2026-03-20T15:00:00${REGION.utcOffset}`,
  night: `2026-03-20T21:00:00${REGION.utcOffset}`,
};

export interface SunInfo {
  /** Degrees clockwise from north (suncalc v2 convention). */
  azimuth: number;
  /** Degrees above horizon. */
  altitude: number;
}

export function sunPosition(tod: TimeOfDay, lat: number, lon: number): SunInfo {
  const { azimuth, altitude } = getPosition(new Date(REFERENCE_TIMES[tod]), lat, lon);
  return { azimuth, altitude };
}

/**
 * MapLibre `light.position` = [radial, azimuthal°, polar°]. With anchor "map", azimuthal 0° = north,
 * clockwise; polar 0° = directly above, 90° = horizon. So the sun maps to [r, azimuth, 90 − altitude].
 * Polar is clamped to keep faces readable when the sun is low.
 */
export function sunToLightPosition(sun: SunInfo): [number, number, number] {
  const polar = Math.min(80, Math.max(10, 90 - sun.altitude));
  return [1.5, ((sun.azimuth % 360) + 360) % 360, polar];
}

export interface Theme {
  background: string;
  context: string;
  roads: string;
  water: string;
  green: string;
  boundary: string;
  accent: string;
  accentHover: string;
  /** Ring around listing pins. */
  pinStroke: string;
  /** Outline colour of highlighted listings. */
  accentStrong: string;
  land: string;
  dimmed: string;
  light: { color: string; intensity: number; position: [number, number, number] };
  sky: { sky: string; horizon: string };
  scenery: Scenery;
  /** Street names up close (drawn over the 3D city): text with a wide halo that keeps it readable over roofs and trees. */
  streetName: { text: string; halo: string };
  /** The street chosen in the search, lit along its length (translucent). */
  streetHighlight: string;
  /** Where the sun is (building shadows); themes made by hand may leave it out. */
  sun?: SunInfo;
  /** Shading of the slopes (relief): colours and the direction the light comes from (degrees from north). */
  relief: { shadow: string; highlight: string; accent: string; direction: number };
}

export type GreenKind = 'park' | 'grass' | 'wood' | 'scrub' | 'wetland' | 'farm';

/** Colours of the low-poly scenery: pavement, green areas, water, trees and street lamps. */
export interface Scenery {
  asphalt: string;
  /** Paving stones ("calçamento"): stone and joint colours of the texture. */
  paving: string;
  pavingJoint: string;
  /** Other paved surfaces (concrete). */
  paved: string;
  /** Dirt roads ("estrada de chão"): ground and specks of the texture. */
  unpaved: string;
  unpavedSpot: string;
  sidewalk: string;
  laneMark: string;
  greens: Record<GreenKind, string>;
  /** Canopy mass of woods (faceted texture in three greens). */
  canopy: string;
  canopyLight: string;
  canopyDark: string;
  waterLight: string;
  waterDeep: string;
  waterShore: string;
  /** Three shades of tree crowns, and of their lighter tops. */
  crowns: [string, string, string];
  tops: [string, string, string];
  trunk: string;
  bush: string;
  pole: string;
  /** Luminaire of the street lamps (bright at night). */
  lum: string;
  /** Tower cranes of buildings under construction. */
  crane: string;
  /** Roofs (scripts/lib/roofs.mjs): clay tiles, fibre cement, dark tiles, concrete (water tank and lift room). */
  roofs: [string, string, string, string];
  /** Pool of light under each lamp (night only), by kind of lamp: warm white LED, neutral white LED, sodium. */
  glow: string;
  glowNeutral: string;
  glowSodium: string;
  glowOpacity: number;
  /** Luminaire of the sodium lamps (orange at night). */
  lumSodium: string;
}

const DAY_SCENERY: Scenery = {
  asphalt: '#b8bbbf',
  paving: '#d6cab6',
  pavingJoint: '#bdb09a',
  paved: '#cacac6',
  unpaved: '#ddcaa4',
  unpavedSpot: '#c2ab7e',
  sidewalk: '#f2f1ec',
  laneMark: '#f7f6f0',
  greens: { park: '#cde0bc', grass: '#d6e3c5', wood: '#b4cca1', scrub: '#c8d7ae', wetland: '#c2dad1', farm: '#e3e4c3' },
  canopy: '#86ab72',
  canopyLight: '#98bd83',
  canopyDark: '#74995f',
  waterLight: '#c4d9e2',
  waterDeep: '#adc6d2',
  waterShore: '#e4eef2',
  crowns: ['#8cb679', '#7ba96b', '#9bc285'],
  tops: ['#a2c98e', '#91bd7f', '#aed098'],
  trunk: '#8b6c52',
  bush: '#9fbf83',
  pole: '#7c838d',
  lum: '#dfe3e8',
  crane: '#f0b429',
  roofs: ['#c48d72', '#a7acb2', '#8f6f62', '#c6c6c1'],
  glow: '#ffd27a',
  glowNeutral: '#fff4dc',
  glowSodium: '#ffb257',
  glowOpacity: 0,
  lumSodium: '#dfe3e8',
};

export function themeFor(tod: TimeOfDay, lat: number, lon: number): { theme: Theme; sun: SunInfo } {
  const sun = sunPosition(tod, lat, lon);
  if (tod === 'night' || sun.altitude <= 0) {
    return {
      sun,
      theme: {
        sun,
        background: '#141b2d',
        context: '#3a4152',
        roads: '#2a3245',
        water: '#1d2b44',
        green: '#1c2a26',
        boundary: '#8090b0',
        accent: '#ffad42',
        accentHover: '#ffd08a',
        accentStrong: '#ffcf8a',
        pinStroke: '#141b2d',
        land: '#f0a050',
        dimmed: '#4a5060',
        // Sun is below the horizon: a dim, cool, top-down "moonlight" so volumes stay legible.
        light: { color: '#9fb4ff', intensity: 0.35, position: [1.5, 210, 30] },
        sky: { sky: '#0b1020', horizon: '#1d2740' },
        // light text on a dark halo, as the neighbourhood labels at night
        streetName: { text: '#dde3ee', halo: '#10162a' },
        streetHighlight: '#ffad42',
        // slopes barely shaded, lit from above (no sun)
        relief: { shadow: '#05080f', highlight: '#2c3652', accent: '#0b1020', direction: 335 },
        // street lamps light up: luminaires bright, warm pools of light on the street
        scenery: {
          asphalt: '#262d3d',
          paving: '#363744',
          pavingJoint: '#2a2b37',
          paved: '#2b3242',
          unpaved: '#3b3529',
          unpavedSpot: '#2f2a21',
          sidewalk: '#20283a',
          laneMark: '#4c556b',
          greens: { park: '#1d2c27', grass: '#1f2d27', wood: '#1a2a24', scrub: '#1e2b25', wetland: '#1b2b2e', farm: '#232a22' },
          canopy: '#1f3529',
          canopyLight: '#25402f',
          canopyDark: '#192c22',
          waterLight: '#253755',
          waterDeep: '#17233a',
          waterShore: '#2d3f5e',
          crowns: ['#24402f', '#203a2b', '#2a4734'],
          tops: ['#2c4b38', '#284534', '#315240'],
          trunk: '#2c2622',
          bush: '#253f2f',
          pole: '#3e4555',
          lum: '#fff6dc',
          lumSodium: '#ffb44d',
          crane: '#b98a2a',
          roofs: ['#4c3c48', '#3f4659', '#3b3242', '#454b5d'],
          glow: '#ffd99a',
          glowNeutral: '#fff0d4',
          glowSodium: '#ffa640',
          glowOpacity: 1,
        },
      },
    };
  }
  const warm = tod === 'afternoon';
  return {
    sun,
    theme: {
      sun,
      background: warm ? '#e9e4da' : '#e6eaee',
      context: '#d9d9d6',
      roads: '#c4c4bf',
      water: '#b9cfd9',
      green: '#cfd8c6',
      boundary: '#7d8590',
      accent: '#f28c18',
      accentHover: '#ffb35c',
      accentStrong: '#b85a00',
      pinStroke: '#ffffff',
      land: '#f6a94f',
      dimmed: '#9a9a9a',
      light: {
        color: warm ? '#fff1dc' : '#f4f8ff',
        intensity: 0.4,
        position: sunToLightPosition(sun),
      },
      sky: warm ? { sky: '#a9c9e8', horizon: '#f2dcc0' } : { sky: '#9cc8f0', horizon: '#e4eef6' },
      // dark grey text on a light halo: readable over roofs, trees, asphalt and the tan dirt roads
      streetName: { text: '#3f4652', halo: warm ? '#f8f3ea' : '#f7f6f2' },
      streetHighlight: '#f28c18',
      // the slopes facing away from the sun in shade, the ones facing it lit
      relief: { shadow: warm ? '#6b5f55' : '#56606e', highlight: '#ffffff', accent: warm ? '#8c8073' : '#7c8794', direction: sun.azimuth },
      scenery: warm ? { ...DAY_SCENERY, sidewalk: '#f4efe6', asphalt: '#b9b8b6' } : DAY_SCENERY,
    },
  };
}

/** Days of the hour-and-season ruler (southern hemisphere: December is summer). */
export const RULER_DAYS = { summer: '2026-12-21', equinox: '2026-03-20', winter: '2026-06-21' } as const;
export type RulerSeason = keyof typeof RULER_DAYS;

/** Moment of the ruler: `minutes` after midnight, local time of the region, on the season's day. */
export function rulerDate(season: RulerSeason, minutes: number): Date {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return new Date(`${RULER_DAYS[season]}T${hh}:${mm}:00${REGION.utcOffset}`);
}

/**
 * Theme for any moment (the ruler): the morning or afternoon colours lit by the sun of that moment, or the night
 * when the sun is down. Returns the matching button too.
 */
export function themeAt(date: Date, minutes: number, lat: number, lon: number): { theme: Theme; tod: TimeOfDay } {
  const { azimuth, altitude } = getPosition(date, lat, lon);
  if (altitude <= 0) return { tod: 'night', theme: themeFor('night', lat, lon).theme };
  const tod: TimeOfDay = minutes < 12 * 60 ? 'morning' : 'afternoon';
  const sun = { azimuth, altitude };
  const base = themeFor(tod, lat, lon).theme;
  return { tod, theme: { ...base, sun, light: { ...base.light, position: sunToLightPosition(sun) } } };
}
