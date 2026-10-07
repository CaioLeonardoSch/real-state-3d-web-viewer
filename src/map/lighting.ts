import { getPosition } from 'suncalc';

export type TimeOfDay = 'morning' | 'afternoon' | 'night';

/** Fixed reference date (March equinox 2026). Joinville uses UTC−03:00 (no DST since 2019). */
export const REFERENCE_TIMES: Record<TimeOfDay, string> = {
  morning: '2026-03-20T09:00:00-03:00',
  afternoon: '2026-03-20T15:00:00-03:00',
  night: '2026-03-20T21:00:00-03:00',
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
  /** Outline colour of highlighted listings. */
  accentStrong: string;
  land: string;
  dimmed: string;
  light: { color: string; intensity: number; position: [number, number, number] };
  sky: { sky: string; horizon: string };
}

export function themeFor(tod: TimeOfDay, lat: number, lon: number): { theme: Theme; sun: SunInfo } {
  const sun = sunPosition(tod, lat, lon);
  if (tod === 'night' || sun.altitude <= 0) {
    return {
      sun,
      theme: {
        background: '#141b2d',
        context: '#3a4152',
        roads: '#2a3245',
        water: '#1d2b44',
        green: '#1c2a26',
        boundary: '#8090b0',
        accent: '#ffad42',
        accentHover: '#ffd08a',
        accentStrong: '#ffcf8a',
        land: '#f0a050',
        dimmed: '#4a5060',
        // Sun is below the horizon: a dim, cool, top-down "moonlight" so volumes stay legible.
        light: { color: '#9fb4ff', intensity: 0.35, position: [1.5, 210, 30] },
        sky: { sky: '#0b1020', horizon: '#1d2740' },
      },
    };
  }
  const warm = tod === 'afternoon';
  return {
    sun,
    theme: {
      background: warm ? '#e9e4da' : '#e6eaee',
      context: '#d9d9d6',
      roads: '#c4c4bf',
      water: '#b9cfd9',
      green: '#cfd8c6',
      boundary: '#7d8590',
      accent: '#f28c18',
      accentHover: '#ffb35c',
      accentStrong: '#b85a00',
      land: '#f6a94f',
      dimmed: '#b5b5b5',
      light: {
        color: warm ? '#fff1dc' : '#f4f8ff',
        intensity: 0.4,
        position: sunToLightPosition(sun),
      },
      sky: warm ? { sky: '#a9c9e8', horizon: '#f2dcc0' } : { sky: '#9cc8f0', horizon: '#e4eef6' },
    },
  };
}
