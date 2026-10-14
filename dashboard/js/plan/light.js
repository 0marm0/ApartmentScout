// Pure lighting-state logic. Rendering brightness is a preview, never photometry.
export function lightState({ bearing, altitude, blocked = false, directSun = true, ambient = 1 }) {
  const known = typeof bearing === 'number' && Number.isFinite(bearing);
  const day = Number.isFinite(altitude) && altitude > 0;
  return {
    orientationKnown: known, day,
    directional: known && day && !blocked && directSun,
    ambient: typeof ambient === 'number' && Number.isFinite(ambient) ? Math.max(0, Math.min(2, ambient)) : 1,
    verdict: !known ? 'orientation-unknown' : !day ? 'night' : blocked ? 'site-blocked' : 'candidate-sun',
  };
}

// Unoccluded floor-reach estimate from the window head. Not actual room penetration.
export function windowReach({ bearing, sunAzimuth, altitude, head, orientationKnown, blocked = false }) {
  if (!orientationKnown) return { state: 'orientation-unknown', inches: null };
  if (!Number.isFinite(altitude) || altitude <= 0) return { state: 'night', inches: null };
  if (blocked) return { state: 'site-blocked', inches: null };
  const delta = Math.abs(((sunAzimuth - bearing + 540) % 360) - 180);
  if (delta >= 90) return { state: 'behind', inches: null };
  if (![head, bearing, sunAzimuth].every(Number.isFinite) || head <= 0) return { state: 'unresolved', inches: null };
  return { state: 'unoccluded', inches: head * Math.cos(delta * Math.PI / 180) / Math.tan(altitude * Math.PI / 180) };
}
