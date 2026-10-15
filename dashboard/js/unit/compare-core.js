// Scenario comparison board, the numbers: 2-4 scenarios of one window, each a small set of changes against a shared
// base state (winter vs summer, floors, facade hypotheses, proposed buildings on or off, assumed building parts,
// a measured height), evaluated with identical assumptions everywhere else, with the deltas against the first scenario
// and a JSON receipt. Pure (no DOM, no three.js); the board's drawing lives in compare-board.js.
import { sunPos, zonedMs, dayTable, horizonProfile, litInfo, skyView, daylightFactor, hAt, expectedSun, DAYS_IN_MONTH, compass, angDiff } from '../sun.js';
import { windowPoint, windowOpenAir, airReason } from './openair.js';
import { resolveCal, describeCal, normaliseMeasured } from './calibration.js';

export const MIN_SCENARIOS = 2, MAX_SCENARIOS = 4;
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
const cut = (s, n) => String(s ?? '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, n);

/** The state fields a scenario may change; anything else in a spec is ignored. */
export const FIELDS = ['date', 'min', 'floor', 'face', 't', 'az', 'bay', 'future', 'parts', 'cal'];

/**
 * A scenario spec cleaned against the environment, or null: {label, date?, min?, floor?, face?, t?, az?, bay?, future?,
 * parts?: 'source' | 'assumed', cal?: measured | null}. `face` is an index into env.faces (an open facade).
 */
export function normaliseSpec(s, env) {
  if (!s || typeof s !== 'object') return null;
  const o = { label: cut(s.label, 60) };
  if (s.date !== undefined) { if (!DATE.test(s.date) || Number.isNaN(Date.parse(s.date))) return null; o.date = s.date; }
  if (s.min !== undefined) { const m = Number(s.min); if (!(m >= 0 && m < 1440)) return null; o.min = Math.round(m); }
  if (s.floor !== undefined) { const f = Math.round(Number(s.floor)); if (!(f >= 1 && f <= env.maxFloor)) return null; o.floor = f; }
  if (s.face !== undefined) { const f = env.faces[Number(s.face)]; if (!f || f.shared) return null; o.face = Number(s.face); }
  if (s.t !== undefined) { const t = Number(s.t); if (!(t >= 0 && t <= 1)) return null; o.t = t; }
  if (s.az !== undefined) { const a = Number(s.az); if (!(a >= 0 && a < 360)) return null; o.az = a; }
  if (s.bay !== undefined) o.bay = !!s.bay;
  if (s.future !== undefined) o.future = !!s.future;
  if (s.parts !== undefined) { if (!['source', 'assumed'].includes(s.parts)) return null; if (s.parts === 'assumed' && !env.B.assumed) return null; o.parts = s.parts; }
  if (s.cal !== undefined) { if (s.cal === null) o.cal = null; else { const m = normaliseMeasured(s.cal); if (!m) return null; o.cal = m; } }
  return o;
}

/** Base state + a spec = the full state of one scenario. Everything the spec does not name is the base's. */
export function resolveState(base, spec) {
  const st = { ...base };
  for (const k of FIELDS) if (spec[k] !== undefined) st[k] = spec[k];
  if (spec.face !== undefined && spec.az === undefined) st.az = base.faceBearings?.[spec.face] ?? st.az;   // a facade hypothesis turns the window with it
  return st;
}

/** Which fields a spec really changes (a field equal to the base is not a difference). */
export function changedFields(base, spec) {
  return FIELDS.filter((k) => spec[k] !== undefined && JSON.stringify(spec[k]) !== JSON.stringify(base[k]));
}

/** A short name for a spec: "Dec 21", "Floor 34", "ESE facade, 41%", "Proposed off". */
export function autoLabel(base, spec, env) {
  const ch = changedFields(base, spec), bits = [];
  if (ch.includes('date')) { const [, m, d] = spec.date.split('-').map(Number); bits.push(`${MONTHS[m - 1]} ${d}`); }
  if (ch.includes('min')) bits.push(`${String(Math.floor(spec.min / 60)).padStart(2, '0')}:${String(spec.min % 60).padStart(2, '0')}`);
  if (ch.includes('floor')) bits.push(`Floor ${spec.floor}`);
  if (ch.includes('face')) { const f = env.faces[spec.face]; bits.push(`${compass(f.bearing)} facade ${Math.round(f.bearing)}°`); }
  if (ch.includes('t')) bits.push(`${Math.round(spec.t * 100)}% along`);
  if (ch.includes('az') && !ch.includes('face')) bits.push(`faces ${Math.round(spec.az)}°`);
  if (ch.includes('bay')) bits.push(spec.bay ? 'Bay' : 'Flat window');
  if (ch.includes('future')) bits.push(spec.future ? 'With proposed' : 'Without proposed');
  if (ch.includes('parts')) bits.push(spec.parts === 'assumed' ? 'Assumed building parts' : 'Source geometry');
  if (ch.includes('cal')) bits.push(spec.cal ? `${spec.cal.kind === 'eye' ? 'Eye' : 'Slab'} ${spec.cal.value} m` : 'Floor-count height');
  return bits.join(', ') || 'As now';
}

/**
 * Preset scenario sets for the board. Each returns 2-4 specs against the base state.
 * kind: 'seasons2' | 'seasons4' | 'floors' | 'facades' | 'proposed' | 'parts'.
 */
export function presetSpecs(kind, base, env) {
  const y = base.date.slice(0, 4);
  if (kind === 'seasons2') return [{ date: `${y}-12-21` }, { date: `${y}-06-21` }];
  if (kind === 'seasons4') return [{ date: `${y}-03-20` }, { date: `${y}-06-21` }, { date: `${y}-09-22` }, { date: `${y}-12-21` }];
  if (kind === 'floors') {
    const mf = env.maxFloor, want = [base.floor, Math.min(mf, base.floor + 6), Math.min(mf, base.floor + 14), Math.max(1, base.floor - 6)];
    return [...new Set(want)].slice(0, 4).sort((a, b) => a - b).map((floor) => ({ floor }));
  }
  if (kind === 'facades') {
    const open = env.faces.map((f, i) => [f, i]).filter(([f]) => !f.shared).sort((a, b) => b[0].length - a[0].length);
    const pick = [open.find(([, i]) => i === base.face), ...open.filter(([, i]) => i !== base.face)].filter(Boolean).slice(0, 4);
    return pick.map(([, i]) => ({ face: i }));
  }
  if (kind === 'proposed') return [{ future: false }, { future: true }];
  if (kind === 'parts') return [{ parts: 'source' }, { parts: 'assumed' }];
  return [];
}

// ------------------------------------------------------------------ evaluation

/**
 * Evaluate one state. env: {site, faces, B: {source, assumed}, FUTB (prepared proposed buildings), ti, geo, baseCal (a
 * measured height or null), panes (bay offsets), lat, lon, tz, fraction (sunshine by month or null), maxFloor}.
 * Returns the metrics, or {withheld: true, reason} when the window is not in open air (nothing is computed then).
 */
export function evaluate(state, env) {
  const face = env.faces[state.face], cal = resolveCal(env.geo, state.cal === undefined ? env.baseCal : state.cal);
  const Bb = (state.parts === 'assumed' && env.B.assumed) || env.B.source, ti = env.ti;
  const slab = cal.slabAt(state.floor), w = windowPoint(face, state.t, slab);
  const air = windowOpenAir(Bb, ti, w.fx, w.fy, state.az, slab + 0.6, slab + 2.2);
  const info = { slab_m: r2(slab), eye_m: r2(slab + 1.6), datum: cal.state, floor_height_m: r3(cal.fh) };
  if (!air.ok) return { withheld: true, reason: airReason(air), ...info };
  const blockers = state.future && env.FUTB?.length ? Bb.concat(env.FUTB) : Bb;
  const prof = horizonProfile(blockers, w.x, w.y, w.z), P = state.bay ? env.panes : null;
  const [y, m, d] = state.date.split('-').map(Number);
  const day = litInfo(dayTable(y, m - 1, d, env.lat, env.lon, env.tz, 6), prof, state.az, 6, P);
  const hours = Array.from({ length: 12 }, (_, mo) => litInfo(dayTable(y, mo, 15, env.lat, env.lon, env.tz, 6), prof, state.az, 6, P).min / 60);
  const sv = skyView(prof, state.az, P), s = sunPos(zonedMs(y, m - 1, d, state.min, env.tz), env.lat, env.lon);
  const yr = expectedSun(hours, env.fraction);
  return {
    withheld: false, ...info,
    day_min: Math.round(day.min), segments: day.segs.map(([a, b]) => [a, Math.min(b, 1439)]),
    dec_h: r2(hours[11]), jun_h: r2(hours[5]), month_h: hours.map(r2), year_possible_h: yr.possible, year_expected_h: yr.expected,
    sky_view: r3(sv), daylight_factor_pct: r2(daylightFactor(sv)), skyline_ahead_deg: r1(hAt(prof, state.az)),
    sun_now: { az: r1(s.az), alt: r1(s.alt), up: s.alt > 0 },
  };
}

/** One result per scenario, each with the state it used. specs[0] is the reference the deltas are taken against. */
export function evaluateAll(base, specs, env) {
  return specs.map((spec, i) => {
    const state = resolveState(base, spec);
    return { index: i, id: `s${i + 1}`, label: spec.label || autoLabel(base, spec, env), changes: changedFields(base, spec), state, metrics: evaluate(state, env) };
  });
}

const DELTA_KEYS = [['day_min', 'Direct sun that day', 'min', 0], ['dec_h', 'Dec 15, hours of sun', 'h', 2], ['jun_h', 'Jun 15, hours of sun', 'h', 2], ['year_possible_h', 'A year, possible sun', 'h', 0], ['sky_view', 'Sky view', 'pts', 1], ['daylight_factor_pct', 'Daylight factor (est.)', 'pts', 2], ['skyline_ahead_deg', 'Skyline straight ahead', '°', 1]];
/** Rows for the board's table: each metric per scenario and the change from scenario 1. sky_view is shown in percent points. */
export function deltaRows(results) {
  const ref = results[0]?.metrics;
  return DELTA_KEYS.map(([key, label, unit, dp]) => ({
    key, label, unit,
    cells: results.map((r, i) => {
      const m = r.metrics;
      if (!m || m.withheld) return { value: null, delta: null, withheld: true };
      const v = key === 'sky_view' ? m.sky_view * 100 : m[key], ref0 = !ref || ref.withheld ? null : key === 'sky_view' ? ref.sky_view * 100 : ref[key];
      return { value: Number(v.toFixed(dp)), delta: i === 0 || ref0 == null ? null : Number((v - ref0).toFixed(dp)) };
    }),
  }));
}

/** What every scenario shares, in words: the base state's fields that no scenario changes. */
export function sharedAssumptions(base, results, env) {
  const varied = new Set(results.flatMap((r) => r.changes));
  const cal = resolveCal(env.geo, base.cal === undefined ? env.baseCal : base.cal);
  const rows = [];
  if (!varied.has('date')) rows.push(['Date', base.date]);
  if (!varied.has('min')) rows.push(['Time', `${String(Math.floor(base.min / 60)).padStart(2, '0')}:${String(base.min % 60).padStart(2, '0')}`]);
  if (!varied.has('floor')) rows.push(['Floor', String(base.floor)]);
  if (!varied.has('face')) rows.push(['Facade', `${compass(env.faces[base.face].bearing)} ${Math.round(env.faces[base.face].bearing)}°`]);
  if (!varied.has('t')) rows.push(['Position along the facade', `${Math.round(base.t * 100)}%`]);
  if (!varied.has('az') && !varied.has('face')) rows.push(['Window faces', `${Math.round(base.az)}°`]);
  if (!varied.has('bay')) rows.push(['Window', base.bay ? 'bay (3 panes)' : 'flat']);
  if (!varied.has('future')) rows.push(['Proposed buildings', base.future ? 'included' : 'not included']);
  if (!varied.has('parts')) rows.push(['Building parts', base.parts === 'assumed' ? 'assumed parts' : 'source geometry']);
  if (!varied.has('cal')) rows.push(['Height', cal.state === 'measured' ? 'measured' : cal.state === 'assumed' ? 'assumed offset' : 'floor-count estimate']);
  return rows;
}

/** The JSON receipt for an export: inputs, shared assumptions, every scenario's state and metrics, the deltas, the method. */
export function buildReceipt({ siteId, site, base, results, env, camera, created = new Date().toISOString(), assumedParts = null }) {
  return {
    schema: 1, kind: 'apartmentscout-compare-receipt', site: siteId, created,
    reference: results[0]?.id,
    camera: camera ? { kind: camera.kind, yaw_deg: camera.yaw ?? null, pitch_deg: camera.pitch ?? null, fov_deg: camera.fov ?? null, note: 'one fixed camera for every panel' } : null,
    shared: Object.fromEntries(sharedAssumptions(base, results, env)),
    base: { date: base.date, min: base.min, floor: base.floor, facade: base.face, facade_bearing_deg: env.faces[base.face]?.bearing ?? null, t: r3(base.t), faces_deg: r1(base.az), bay: !!base.bay, future: !!base.future, parts: base.parts },
    scenarios: results.map((r) => ({ id: r.id, label: r.label, changes: r.changes, state: { date: r.state.date, min: r.state.min, floor: r.state.floor, facade: r.state.face, t: r3(r.state.t), faces_deg: r1(r.state.az), bay: !!r.state.bay, future: !!r.state.future, parts: r.state.parts, cal: r.state.cal === undefined ? 'base' : r.state.cal }, metrics: r.metrics })),
    deltas: deltaRows(results).map((row) => ({ metric: row.label, unit: row.unit, values: row.cells.map((c) => c.value), delta_vs_first: row.cells.map((c) => c.delta) })),
    datum: describeCal(resolveCal(env.geo, base.cal === undefined ? env.baseCal : base.cal), base.floor),
    assumed_parts: assumedParts ? { buildings: Object.keys(assumedParts), sources: [...new Set(Object.values(assumedParts).flat().map((c) => c.source))] } : null,
    method: 'Direct sun on the 15th of each month and on the chosen date, 6-minute slots, clear sky, straight prisms or building parts; sky view is the relative CIE overcast model; not lux. Identical assumptions in every panel except the fields listed under changes.',
    site_generated: site?.generated ?? null, site_source: site?.source ?? null,
  };
}

/** Faces ordered for pickers: open facades first, longest first. */
export const openFaces = (faces) => faces.map((f, i) => [f, i]).filter(([f]) => !f.shared).sort((a, b) => b[0].length - a[0].length);
export { DAYS_IN_MONTH, angDiff };
