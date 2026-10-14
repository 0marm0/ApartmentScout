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

// ------------------------------------------------------------------ glazing and blinds (preview, not photometry)
export const GLAZING_DEFAULT = 0.6;
export const BLINDS = { open: 1, half: 0.5, closed: 0.1 };
export const BLINDS_LABEL = { open: 'Open', half: 'Half', closed: 'Closed' };
const IN2M = 0.0254;
export const clampGlazing = (t) => (typeof t === 'number' && Number.isFinite(t) ? Math.max(0.05, Math.min(1, t)) : GLAZING_DEFAULT);
export const blindsOf = (b) => (Object.hasOwn(BLINDS, b) ? b : 'open');

/**
 * How much of the light the glass and blinds let through, relative to the default 0.6 glazing with open blinds:
 * the sun patches' intensity and the daylight estimate are scaled by it. A preview multiplier, never photometry.
 */
export function glazingScale({ transmittance = GLAZING_DEFAULT, blinds = 'open' } = {}) {
  const t = clampGlazing(transmittance), b = BLINDS[blindsOf(blinds)];
  return { transmittance: t, blinds: blindsOf(blinds), through: t * b, sun: (t / GLAZING_DEFAULT) * b };
}

function perimeter(poly) { let p = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; p += Math.hypot(b[0] - a[0], b[1] - a[1]); } return p; }

/**
 * Estimated average daylight factor (%) per room: the BRE formula T·Aw·θ / (A·(1 − R²)) with the plan's own
 * room and window sizes (inches), θ = 90° × the glazed-area-weighted sky view of the room's windows, T = glazing
 * transmittance × blinds, R = 0.5 and 80% of each opening glazed (frames). `sky[i]` is window i's sky view (0–1)
 * or null when unknown. Rooms without a known window are left out. An indicative estimate, not lux.
 */
export function roomDaylight(model, sky, { transmittance = GLAZING_DEFAULT, blinds = 'open', reflectance = 0.5, glazed = 0.8 } = {}) {
  const g = glazingScale({ transmittance, blinds }), H = (model.ceiling || 108) * IN2M, out = [];
  for (const r of model.rooms || []) {
    const ws = (model.windows || []).map((w, i) => [w, i]).filter(([w, i]) => w.room === r.name && Number.isFinite(sky?.[i]));
    if (!ws.length) continue;
    let aw = 0, th = 0;
    for (const [w, i] of ws) { const a = (w.len || 0) * Math.max(0, (w.head || 0) - (w.sill || 0)) * IN2M * IN2M * glazed; aw += a; th += a * 90 * Math.max(0, Math.min(1, sky[i])); }
    const floor = (r.area || 0) * IN2M * IN2M, A = 2 * floor + perimeter(r.poly || []) * IN2M * H;
    if (!(aw > 0) || !(A > 0)) continue;
    const theta = th / aw;
    out.push({ room: r.name, windows: ws.map(([, i]) => i), glazed_m2: aw, surface_m2: A, theta, df: (g.through * aw * theta) / (A * (1 - reflectance * reflectance)) });
  }
  return out;
}
