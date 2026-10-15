// Pure, same-site scenario and facade rules. Source geometry is never modified.
import { calToParam, calFromParam } from './calibration.js';   // [model project] measured height in the page address
export function canonicalFaces(faces, records = [], version = 1) {
  return faces.map((face) => {
    const f = { ...face }, r = records.find((x) => x.i === f.i);
    if (!r) return f;
    if (r.shared === true) f.shared = true;
    else if (+version >= 2) f.shared = false;
    if (Object.hasOwn(r, 'open')) {
      const a = r.open;
      if (Array.isArray(a) && a.length === 2 && a.every(Number.isFinite) && a[0] >= 0 && a[1] <= 1 && a[0] < a[1]) {
        f.clearInterval = [...a];
      } else { f.shared = true; } // malformed or empty canonical span is not an exposed wall
    }
    return f;
  });
}

export function snapPosition(face, t, fallback) {
  if (!face || face.shared) return null;
  if (face.clearInterval) {
    const [lo, hi] = face.clearInterval, margin = Math.min(0.001, (hi - lo) / 4);
    return Math.max(lo + margin, Math.min(hi - margin, t));
  }
  return fallback(face, t);
}

export function baselineStudyMatches(site, state, face) {
  const w = site.window, year = site.study?.year ?? Number(String(site.generated || '').slice(0, 4));
  return !!w && !state.moved && !Object.values(state.manual || {}).some(Boolean)
    && face?.i === w.face && state.floor === w.floor
    && Math.abs(state.t - (w.t ?? 0.5)) < 1e-6 && Math.abs(state.az - w.bearing) <= 0.05 // exported bearings are rounded to 0.1°
    && Number.isInteger(year) && year > 0 && Number(state.date.slice(0, 4)) === year;
}

const KEYS = ['sv', 'site', 'face', 'pos', 'az', 'cmp', 'future', 'fov', 'yaw', 'pitch', 'bay', 'src', 'lm', 'slab', 'inWin', 'cal'];
export function clearScenario(qs) { for (const k of KEYS) qs.delete(k); return qs; }

// Optional v1 additions: absence keeps older links working. Invalid additions reject the scenario.
export function readScenarioExtras(qs) {
  const out = {};
  if (qs.has('bay')) { if (!['0', '1'].includes(qs.get('bay'))) return null; out.bay = qs.get('bay') === '1'; }
  if (qs.has('src')) { if (qs.get('src') !== 'photo') return null; out.src = 'photo-landmarks'; }
  if (qs.has('slab')) {
    const n = qs.get('slab').trim() === '' ? NaN : Number(qs.get('slab'));
    if (!Number.isFinite(n) || Math.abs(n) >= 60) return null;
    out.slabOff = n;
  }
  if (qs.has('cal')) { const m = calFromParam(qs.get('cal')); if (!m) return null; out.cal = m; }   // kind:value:floor:spread
  if (qs.has('inWin')) {
    const n = qs.get('inWin').trim() === '' ? NaN : Number(qs.get('inWin'));
    if (!Number.isInteger(n) || n < -1 || n > 63) return null;
    out.inWin = n;
  }
  if (qs.has('lm')) {
    const names = qs.get('lm').split('|');
    if (names.length > 40 || names.some((s) => !s.trim() || s.length > 120 || /[<>\u0000-\u001f]/.test(s))) return null;
    out.landmarks = [...new Set(names)];
  }
  return out;
}

export function writeScenario(qs, state, face, look, future) {
  clearScenario(qs);
  if (!face || face.shared) return qs;
  for (const [k, v] of Object.entries({ sv: 1, site: state.id, face: face.i, pos: state.t, az: state.az,
    cmp: state.cmp, future: future ? 1 : 0, fov: look.fov, yaw: look.yaw, pitch: look.pitch })) qs.set(k, String(v));
  if (typeof state.bay === 'boolean') qs.set('bay', state.bay ? '1' : '0');
  if (state.src === 'photo-landmarks') qs.set('src', 'photo');
  if (state.slabOff != null) qs.set('slab', String(state.slabOff));
  if (state.cal) qs.set('cal', calToParam(state.cal));
  if (Number.isInteger(state.inWin)) qs.set('inWin', String(state.inWin));
  if (state.lmSel?.size) qs.set('lm', [...state.lmSel].join('|'));
  return qs;
}

export function readScenario(qs, id, faces, maxFloor) {
  if (!qs.has('sv')) return null;
  if (qs.get('sv') !== '1' || qs.get('site') !== id) return null;
  const n = (k) => qs.has(k) && qs.get(k).trim() !== '' ? Number(qs.get(k)) : NaN;
  const face = n('face'), pos = n('pos'), az = n('az'), cmp = n('cmp'), future = n('future');
  const fov = n('fov'), yaw = n('yaw'), pitch = n('pitch');
  const index = faces.findIndex((f) => f.i === face && !f.shared);
  if (index < 0 || ![pos, az, cmp, future, fov, yaw, pitch].every(Number.isFinite)
    || pos < 0 || pos > 1 || az < 0 || az >= 360 || !Number.isInteger(cmp) || cmp < 1 || cmp > maxFloor
    || ![0, 1].includes(future) || fov < 35 || fov > 110 || yaw < -90 || yaw > 90 || pitch < -15 || pitch > 60) return null;
  const span = faces[index].clearInterval;
  if (span && (pos <= span[0] || pos >= span[1])) return null;
  const extras = readScenarioExtras(qs);
  if (!extras) return null;
  return { face: index, t: pos, az, cmp, future: !!future, look: { fov, yaw, pitch }, ...extras };
}
