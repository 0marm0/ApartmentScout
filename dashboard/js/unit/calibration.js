// Vertical calibration for Unit 3D and the Floor plan studio: a measured slab (or window-eye) height kept apart
// from the floor-count estimate. Pure functions, no DOM; apartmentscout/geo/anchor.py (vertical_calibration,
// slab_at) is the Python twin and tests/fixtures/model_anchor.json pins both to the same numbers.
//
//   geo      {base, fhEst, lobby}  target ground (>= 0 m), the floor-count storey height (roof / floors, else 3.2 m)
//                                  and a legacy assumed ground-storey offset (site.calibration.lobby_m)
//   measured {kind: 'slab' | 'eye', value, floor, spread: 'scale' | 'offset', src?}  one measurement, or null
//
// A measurement at one floor reaches the others one of two ways: `scale` (every storey is taller or shorter;
// floor 1 stays at the street) or `offset` (a constant shift, for example a tall lobby). The estimate is never
// overwritten, so the app can always show "measured 36.0 m, floor count says 28.8 m".
export const EYE_M = 1.6;
export const SPREADS = ['scale', 'offset'];
export const KINDS = ['slab', 'eye'];
export const MAX_SLAB_M = 700;
const fin = Number.isFinite;
const r2 = (v) => Math.round(v * 100) / 100;

/** A clean measurement or null. Heights of 0-700 m (the slab) and floors of 1-200 are accepted; nothing is repaired. */
export function normaliseMeasured(m) {
  if (!m || typeof m !== 'object') return null;
  const kind = KINDS.includes(m.kind) ? m.kind : null, value = typeof m.value === 'number' ? m.value : NaN, floor = Math.round(+m.floor);
  if (!kind || !fin(value) || !Number.isInteger(floor) || floor < 1 || floor > 200) return null;
  const slab = kind === 'eye' ? value - EYE_M : value;
  if (slab < 0 || slab > MAX_SLAB_M) return null;
  const out = { kind, value: r2(value), floor, spread: SPREADS.includes(m.spread) ? m.spread : 'scale' };
  if (typeof m.src === 'string' && m.src.trim()) out.src = m.src.replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, 200);
  return out;
}

/** Resolve a calibration: {state, base, fhEst, fh, floor, measured, s0, k, slabAt(f), estimateAt(f), eyeAt(f), maxFloor(top)}. */
export function resolveCal(geo, measured = null) {
  const base = Math.max(0, +geo.base || 0), fhEst = fin(+geo.fhEst) && +geo.fhEst > 0 ? +geo.fhEst : 3.2, lobby = +geo.lobby || 0;
  const m = normaliseMeasured(measured);
  let s0 = base + lobby, k = fhEst;
  if (m) {
    const slab = m.kind === 'eye' ? m.value - EYE_M : m.value;
    if (m.spread === 'scale' && m.floor > 1) { k = (slab - base) / (m.floor - 1); s0 = base; }
    else { s0 = base + (slab - (base + (m.floor - 1) * fhEst)); k = fhEst; }
  }
  const c = {
    state: m ? 'measured' : lobby ? 'assumed' : 'estimated', base, fhEst, fh: k, measured: m, s0, k,
    slabAt: (f) => s0 + (f - 1) * k,
    estimateAt: (f) => base + (f - 1) * fhEst,
    eyeAt: (f) => s0 + (f - 1) * k + EYE_M,
    /** Highest floor with a storey above its slab under `top` (a roof height above the street), at least 2. */
    maxFloor: (top) => Math.max(2, Math.floor((top - s0) / k)),
  };
  return c;
}

/** The record Python's vertical_calibration() writes (site.calibration), for one floor. */
export function describeCal(cal, floor) {
  const slab = cal.slabAt(floor), est = cal.estimateAt(floor);
  return {
    state: cal.state, floor, ground_m: r2(cal.base), slab_m: r2(slab), eye_m: r2(slab + EYE_M), estimated_slab_m: r2(est),
    delta_m: r2(slab - est), floor_height_m: Math.round(cal.fh * 1000) / 1000, estimated_floor_height_m: Math.round(cal.fhEst * 1000) / 1000,
    measured: cal.measured ? { kind: cal.measured.kind, value_m: cal.measured.value, floor: cal.measured.floor, spread: cal.measured.spread, ...(cal.measured.src ? { src: cal.measured.src } : {}) } : null,
  };
}

/** Plain-language state for panels: ["Measured", "pill class", "text"]. */
export function calSummary(cal, floor) {
  const d = describeCal(cal, floor);
  if (cal.state === 'measured') {
    const what = cal.measured.kind === 'eye' ? `window eye ${cal.measured.value.toFixed(1)} m` : `slab ${cal.measured.value.toFixed(1)} m`;
    return ['Measured', 'good', `${what} at floor ${cal.measured.floor} (${cal.measured.spread === 'scale' ? 'every storey scaled' : 'shifted by a constant'}). The floor count alone would put floor ${floor}'s slab at ${d.estimated_slab_m.toFixed(1)} m.`];
  }
  if (cal.state === 'assumed') return ['Assumed', 'warn', `A ground-storey offset of ${(cal.s0 - cal.base).toFixed(1)} m from the site file, plus ${cal.fhEst.toFixed(2)} m per floor.`];
  return ['Estimated', 'warn', `Floor count × ${cal.fhEst.toFixed(2)} m (roof height ÷ floors, or the 3.2 m default). Type a measured height to replace it.`];
}

// ------------------------------------------------------------------ site file, page address, export

/** The measurement a site file already carries: site.calibration.measured (apartmentscout site --slab-height / --eye-height), else the legacy slab_m. */
export function measuredFromSite(site) {
  const m = site?.calibration?.measured;
  if (m) return normaliseMeasured({ kind: m.kind, value: m.value_m ?? m.value, floor: m.floor, spread: m.spread, src: m.src });
  const sm = +site?.slab_m, wf = +site?.window?.floor;
  return fin(sm) && sm > 0 && wf >= 1 ? normaliseMeasured({ kind: 'slab', value: sm, floor: wf, spread: 'scale', src: 'site file (slab_m)' }) : null;
}
/** geo for a site file: ground of the target, the floor-count storey height (the estimate, not the measured one). */
export function geoFromSite(site, ground) {
  const est = +site?.calibration?.estimated_floor_height_m;
  const fh = fin(est) && est > 0 ? est : +site?.floor_height_m || 3.2;
  const m = measuredFromSite(site);
  return { base: Math.max(0, +ground || 0), fhEst: fh, lobby: m ? 0 : +site?.calibration?.lobby_m || +site?.lobby_m || 0 };
}

/** `kind:value:floor:spread` for the page address. */
export const calToParam = (m) => (m ? `${m.kind}:${m.value}:${m.floor}:${m.spread}` : '');
/** The inverse; null for anything malformed (an invalid address never half-applies). */
export function calFromParam(s) {
  const p = String(s ?? '').split(':');
  if (p.length !== 4 || p.some((x) => x.trim() === '')) return null;
  return normaliseMeasured({ kind: p[0], value: Number(p[1]), floor: Number(p[2]), spread: p[3] });
}

/** The exportable calibration: what was measured, what the floor count says, and every place it is used. */
export function exportCalibration(cal, { site = '', floor = 1, generated = new Date().toISOString() } = {}) {
  const d = describeCal(cal, floor);
  return {
    schema: 1, kind: 'apartmentscout-vertical-calibration', site, generated, ...d,
    table: Object.fromEntries([1, 2, 5, 10, 20, 30, 40, 50].filter((f) => f <= 60).map((f) => [String(f), r2(cal.slabAt(f))])),
    drives: ['window eye height', 'skyline and sun hours', 'sky view', 'city shadows on the apartment', 'Inside camera and plan placement'],
    note: 'A measured height replaces the floor-count estimate everywhere above; the estimate is kept for comparison. Not a survey.',
  };
}
/** Read a calibration export (or a bare measurement) back: a measurement or null. */
export function parseCalibration(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.kind === 'apartmentscout-vertical-calibration') return obj.measured ? normaliseMeasured({ kind: obj.measured.kind, value: obj.measured.value_m ?? obj.measured.value, floor: obj.measured.floor, spread: obj.measured.spread, src: obj.measured.src }) : null;
  return normaliseMeasured(obj);
}
