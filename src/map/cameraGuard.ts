// Keeps the camera above the roofs. The map is flat (no terrain yet: the State's DTM licence is pending), so the
// camera's height above the ground is distance-to-centre × cos(pitch). Close in and tilted at 75°, it gets to about
// 30 m and would go inside the towers. After each move the tallest building under the camera is checked and,
// when needed, the camera tilts up (same distance) or, when even looking straight down is not enough, zooms out.

/** Space kept between the camera and the roof below it (m). */
export const ROOF_CLEARANCE_M = 12;
/** Checked only below this camera height: no building in the region is taller. */
export const GUARD_MAX_ALTITUDE_M = 200;

/**
 * New pitch (degrees) and zoom change for a camera at `altitudeM` with `pitchDeg`, over a roof `roofM` high, or
 * null when it is already high enough.
 */
export function cameraFix(altitudeM: number, pitchDeg: number, roofM: number, clearanceM = ROOF_CLEARANCE_M): { pitch: number; zoomBy: number } | null {
  const need = roofM + clearanceM;
  if (!(roofM > 0) || altitudeM >= need) return null;
  const distance = altitudeM / Math.cos((pitchDeg * Math.PI) / 180);
  if (distance >= need) return { pitch: (Math.acos(need / distance) * 180) / Math.PI, zoomBy: 0 };
  // straight down and still too low: move away (each zoom level halves the distance)
  return { pitch: 0, zoomBy: -Math.log2(need / distance) };
}

/**
 * Where the camera is, on a flat map: its point on the ground and its height (m), from the centre, zoom, pitch,
 * bearing, vertical field of view (degrees) and map height (CSS px), as MapLibre places it (512 px tiles).
 */
export function cameraPosition(
  center: [number, number],
  zoom: number,
  pitchDeg: number,
  bearingDeg: number,
  fovDeg: number,
  heightPx: number,
): { lngLat: [number, number]; altitudeM: number } {
  const rad = Math.PI / 180;
  const metresPerPx = (40_075_016.686 * Math.cos(center[1] * rad)) / (512 * 2 ** zoom);
  const distance = (heightPx / 2 / Math.tan((fovDeg / 2) * rad)) * metresPerPx;
  const back = distance * Math.sin(pitchDeg * rad); // on the ground, behind the centre
  const dx = -back * Math.sin(bearingDeg * rad);
  const dy = -back * Math.cos(bearingDeg * rad);
  return {
    lngLat: [center[0] + dx / (111_320 * Math.cos(center[1] * rad)), center[1] + dy / 110_540],
    altitudeM: distance * Math.cos(pitchDeg * rad),
  };
}
