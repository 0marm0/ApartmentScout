// Lighting model for the Floor plan studio: the daylight inputs (glass, frame, blinds, surface reflectance, each with an
// assumed-or-source label), editable luminaires, the sensor-grid adapters and the artificial-light estimate. Pure
// functions (no DOM, no three.js), so node:test covers them.
//
// Every output is labelled with how it was obtained:
//   modelled        the relative daylight model in features/daylight-core.js (not lux, not calibrated)
//   estimate        a simple physical estimate (lamps: inverse-square and cosine, no bounce, no walls, no shadows)
//   visual preview  what the 3D view shows (brightness, tint and glow are for looking, not for measuring)
import {
  GLAZING_PRESETS, FRAME_PRESETS, SURFACE_PRESETS, SURFACE_DEFAULT, BLINDS_T, SENSOR_HEIGHT_M, roomGrid, gridStats,
  pointInPoly as polyHas, edgeDistance, reflectanceMean,
} from '../features/daylight-core.js';

export const M = 0.0254;
export const KINDS = { modelled: 'Modelled', estimate: 'Estimate', preview: 'Visual preview', assumed: 'Assumed', source: 'From a source' };
export const SOURCES = ['assumed', 'source'];
const clampN = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const str = (v, n = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n) : '');
const src = (v) => (v === 'source' ? 'source' : 'assumed');

// ------------------------------------------------------------------ daylight inputs
export const SURFACE_KEYS = ['floor', 'walls', 'ceiling'];
const presetValue = (list, id) => list.find((p) => p[0] === id)?.[2];

/** The default inputs: every number is an assumption until the renter records a source. */
export function defaultInputs() {
  const s = (k, id) => ({ preset: id, rho: presetValue(SURFACE_PRESETS[k], id), source: 'assumed', note: '' });
  return {
    sky: 'overcast',
    glazing: { preset: 'default', source: 'assumed', note: '' },
    frame: { preset: 'default', glazed: presetValue(FRAME_PRESETS, 'default'), source: 'assumed', note: '' },
    blinds: { source: 'assumed', note: '' },
    surfaces: { floor: s('floor', 'medium'), walls: s('walls', 'typical'), ceiling: s('ceiling', 'off-white') },
  };
}
/** Any stored value -> a complete, clamped inputs object (unknown presets become 'custom', keeping the number). */
export function cleanInputs(raw) {
  const d = defaultInputs(), r = raw && typeof raw === 'object' ? raw : {};
  const out = { sky: r.sky === 'clear' ? 'clear' : 'overcast' };
  const g = r.glazing && typeof r.glazing === 'object' ? r.glazing : {};
  out.glazing = { preset: GLAZING_PRESETS.some((p) => p[0] === g.preset) ? g.preset : g.preset === 'custom' ? 'custom' : d.glazing.preset, source: src(g.source), note: str(g.note) };
  const f = r.frame && typeof r.frame === 'object' ? r.frame : {};
  const fp = FRAME_PRESETS.some((p) => p[0] === f.preset) ? f.preset : f.preset === 'custom' ? 'custom' : 'default';
  out.frame = { preset: fp, glazed: clampN(f.glazed, 0.3, 1, presetValue(FRAME_PRESETS, fp) ?? d.frame.glazed), source: src(f.source), note: str(f.note) };
  const b = r.blinds && typeof r.blinds === 'object' ? r.blinds : {};
  out.blinds = { source: src(b.source), note: str(b.note) };
  out.surfaces = {};
  const sr = r.surfaces && typeof r.surfaces === 'object' ? r.surfaces : {};
  for (const k of SURFACE_KEYS) {
    const s = sr[k] && typeof sr[k] === 'object' ? sr[k] : {};
    const p = SURFACE_PRESETS[k].some((q) => q[0] === s.preset) ? s.preset : s.preset === 'custom' ? 'custom' : d.surfaces[k].preset;
    out.surfaces[k] = { preset: p, rho: clampN(s.rho, 0.02, 0.98, presetValue(SURFACE_PRESETS[k], p) ?? d.surfaces[k].rho), source: src(s.source), note: str(s.note) };
  }
  return out;
}
/** Surface reflectances as plain numbers {floor, walls, ceiling}. */
export const reflectances = (inputs) => Object.fromEntries(SURFACE_KEYS.map((k) => [k, inputs.surfaces[k].rho]));
/** True when every input still is the model default (nothing recorded by the renter). */
export const isDefaultInputs = (inputs, vt) => JSON.stringify({ ...cleanInputs(inputs), sky: 'overcast' }) === JSON.stringify(defaultInputs()) && Math.abs(vt - 0.6) < 1e-9;
/** How many of the inputs the renter has tied to a source. */
export function sourceCount(inputs, blindsSource = inputs.blinds.source) {
  const list = [inputs.glazing.source, inputs.frame.source, blindsSource, ...SURFACE_KEYS.map((k) => inputs.surfaces[k].source)];
  return { source: list.filter((s) => s === 'source').length, total: list.length };
}
/** Preset matching a number within 0.005, else 'custom'. */
export function presetFor(list, value) { const hit = list.find((p) => Math.abs(p[2] - value) < 0.005); return hit ? hit[0] : 'custom'; }

// ------------------------------------------------------------------ daylight on the plan's rooms
/**
 * The relative daylight grid for every room that has at least one window with a known skyline.
 * `skies[i]` = window i's {prof} (or null). Coordinates of the grid are returned in plan INCHES (x0, y0, stepIn) for
 * drawing, while the maths runs in metres. Rooms without a usable window are listed in `skipped` with a reason.
 */
export function daylightGrids(model, skies, o) {
  const { vt, inputs, blinds, sky = null, stepM = 0.3 } = o;
  const out = [], skipped = [];
  if (model.up_bearing == null || !Number.isFinite(model.up_bearing)) return { rooms: out, skipped: model.rooms.map((r) => ({ room: r.name, reason: 'orientation unknown' })) };
  const H = (model.ceiling || 108) * M;
  for (const r of model.rooms) {
    if (r.kind === 'closet' || r.kind === 'outdoor') continue;
    const ws = [];
    model.windows.forEach((w, i) => { if (w.room === r.name && skies?.[i]?.prof) ws.push({ a: [w.a[0] * M, w.a[1] * M], b: [w.b[0] * M, w.b[1] * M], normal: w.normal, sill: w.sill * M, head: w.head * M, prof: skies[i].prof, index: i }); });
    if (!ws.length) { skipped.push({ room: r.name, reason: model.windows.some((w) => w.room === r.name) ? 'no skyline for its windows' : 'no window' }); continue; }
    const g = roomGrid(r.poly.map((p) => [p[0] * M, p[1] * M]), H, ws, model.up_bearing, {
      vt, glazed: inputs.frame.glazed, blinds, surfaces: reflectances(inputs), sky, stepM,
    });
    out.push({ room: r.name, kind: r.kind, windows: ws.map((w) => w.index), x0In: g.x0 / M, y0In: g.y0 / M, stepIn: g.step / M, nx: g.nx, ny: g.ny, values: g.values, stats: g.stats, rho: g.rho, reflected: g.reflected, skyComponentMean: g.skyComponentMean, t: g.t });
  }
  return { rooms: out, skipped };
}

/** Worst-to-best share of a room above a relative daylight threshold (percent), for the summary line. */
export function shareAbove(values, threshold) {
  const v = values.filter((x) => x != null);
  return v.length ? v.filter((x) => x >= threshold).length / v.length : null;
}

// ------------------------------------------------------------------ luminaires
/** Typical specifications, ASSUMED. beam = full angle at half intensity (360 = all directions). z = height of the light centre, inches. */
export const LUM_TYPES = {
  recessed: { name: 'Recessed downlight', lm: 800, k: 3000, beam: 70, mount: 'ceiling', note: 'A typical 6 in LED downlight, 800 lm, 3000 K, 70 degree beam.' },
  pendant: { name: 'Pendant', lm: 1600, k: 2700, beam: 130, mount: 'hung', drop: 30, note: 'A typical shaded pendant, 1600 lm, 2700 K, light mostly downward.' },
  floor: { name: 'Floor lamp', lm: 1100, k: 2700, beam: 360, mount: 'floor', z: 55, note: 'A typical floor lamp with a 1100 lm bulb, 2700 K, light in all directions.' },
  strip: { name: 'Light strip', lm: 900, k: 3000, beam: 120, mount: 'strip', z: 36, note: 'A typical LED strip run, 900 lm in total, 3000 K, 120 degree beam; z = under-cabinet height by default.' },
};
export const LUM_ORDER = ['recessed', 'pendant', 'floor', 'strip'];
export const LUM_LIMITS = { count: 24, lm: [20, 12000], k: [1800, 6500], beam: [20, 360], z: [0, 240] };

/** Tanner Helland's blackbody approximation: a CSS rgb() colour for a correlated colour temperature in kelvin. */
export function kelvinRgb(k) {
  const t = clampN(k, 1000, 12000, 3000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.max(0, Math.min(255, v)));
  return [c(r), c(g), c(b)];
}
export const kelvinCss = (k) => `rgb(${kelvinRgb(k).join(',')})`;
export const kelvinHex = (k) => kelvinRgb(k).reduce((a, v) => a * 256 + v, 0);

let seq = 0;
/** A new luminaire of `type` at plan point (x, y) inches in a plan with the given ceiling height. */
export function newLuminaire(type, x, y, ceiling = 108, existing = []) {
  const T = LUM_TYPES[type] || LUM_TYPES.recessed;
  const ids = new Set(existing.map((l) => l.id));
  let id; do { id = `lum-${type}-${(++seq).toString(36)}`; } while (ids.has(id));
  const z = T.mount === 'ceiling' ? ceiling - 1 : T.mount === 'hung' ? ceiling - T.drop : T.z;
  const l = { id, type: LUM_TYPES[type] ? type : 'recessed', label: T.name, x: Math.round(x), y: Math.round(y), z, lm: T.lm, k: T.k, beam: T.beam, on: true, source: 'assumed' };
  if (l.type === 'strip') { l.x2 = Math.round(x + 48); l.y2 = Math.round(y); }
  return l;
}
/** Validate and clamp stored luminaires; invalid entries are dropped, the rest are copied (never the input objects). */
export function cleanLuminaires(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [], seen = new Set();
  for (const l of raw.slice(0, LUM_LIMITS.count)) {
    if (!l || typeof l !== 'object' || !LUM_TYPES[l.type]) continue;
    const n = (v) => typeof v === 'number' && Number.isFinite(v);
    if (!n(l.x) || !n(l.y) || Math.abs(l.x) > 20000 || Math.abs(l.y) > 20000) continue;
    let id = str(l.id, 60).replace(/[^A-Za-z0-9_-]/g, '') || `lum-${out.length + 1}`;
    while (seen.has(id)) id += '_';
    seen.add(id);
    const c = { id, type: l.type, label: str(l.label, 60) || LUM_TYPES[l.type].name, x: l.x, y: l.y, z: clampN(l.z, ...LUM_LIMITS.z, LUM_TYPES[l.type].z ?? 96), lm: clampN(l.lm, ...LUM_LIMITS.lm, LUM_TYPES[l.type].lm), k: clampN(l.k, ...LUM_LIMITS.k, LUM_TYPES[l.type].k), beam: clampN(l.beam, ...LUM_LIMITS.beam, LUM_TYPES[l.type].beam), on: l.on !== false, source: src(l.source) };
    if (l.type === 'strip') { c.x2 = n(l.x2) ? l.x2 : l.x + 48; c.y2 = n(l.y2) ? l.y2 : l.y; }
    if (typeof l.note === 'string') c.note = str(l.note);
    out.push(c);
  }
  return out;
}
/** Throw on a malformed lighting extras object (project import). */
export function validateExtras(l) {
  const bad = (m) => { throw new Error(m); };
  if (Object.prototype.hasOwnProperty.call(l, 'daylight')) {
    const d = l.daylight;
    if (!d || typeof d !== 'object' || Array.isArray(d)) bad('lighting.daylight must be an object');
    if (d.sky !== undefined && !['overcast', 'clear'].includes(d.sky)) bad('lighting.daylight.sky must be overcast or clear');
    for (const k of ['glazing', 'frame', 'blinds']) if (d[k] !== undefined && (!d[k] || typeof d[k] !== 'object')) bad(`lighting.daylight.${k} must be an object`);
    if (d.frame && d.frame.glazed !== undefined && !(typeof d.frame.glazed === 'number' && d.frame.glazed >= 0.3 && d.frame.glazed <= 1)) bad('lighting.daylight.frame.glazed must be from 0.3 to 1');
    for (const k of SURFACE_KEYS) {
      const s = d.surfaces?.[k];
      if (s !== undefined && (typeof s !== 'object' || (s.rho !== undefined && !(typeof s.rho === 'number' && s.rho >= 0.02 && s.rho <= 0.98)))) bad(`lighting.daylight.surfaces.${k}.rho must be a reflectance from 0.02 to 0.98`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(l, 'luminaires')) {
    if (!Array.isArray(l.luminaires) || l.luminaires.length > LUM_LIMITS.count) bad(`lighting.luminaires must be a list of at most ${LUM_LIMITS.count}`);
    for (const x of l.luminaires) {
      if (!x || typeof x !== 'object' || !LUM_TYPES[x.type]) bad('lighting.luminaires: unknown luminaire type');
      for (const k of ['x', 'y']) if (!(typeof x[k] === 'number' && Number.isFinite(x[k]))) bad(`lighting.luminaires.${k} must be a number`);
      for (const [k, [lo, hi]] of [['lm', LUM_LIMITS.lm], ['k', LUM_LIMITS.k], ['beam', LUM_LIMITS.beam], ['z', LUM_LIMITS.z]]) if (x[k] !== undefined && !(typeof x[k] === 'number' && x[k] >= lo && x[k] <= hi)) bad(`lighting.luminaires.${k} must be from ${lo} to ${hi}`);
    }
  }
}

// ------------------------------------------------------------------ the artificial-light estimate
/**
 * Point sources for one luminaire (inches): a strip is split into `pieces` equal sources along its run. Directional
 * sources have a cos^n distribution about straight down, with n set by the beam angle (full angle at half intensity);
 * a beam of 360 means all directions (isotropic). Peak intensity I0 = lm (n + 1) / 2π so the lumens integrate to lm.
 */
export function sourcesOf(l, pieces = 5) {
  if (!l || l.on === false) return [];
  const iso = l.beam >= 355, half = (Math.min(l.beam, 170) / 2) * (Math.PI / 180);
  const n = iso ? 0 : Math.log(0.5) / Math.log(Math.cos(half));
  const flux = (f) => (iso ? { iso: true, cd: f / (4 * Math.PI) } : { iso: false, n, cd: (f * (n + 1)) / (2 * Math.PI) });
  if (l.type === 'strip' && Number.isFinite(l.x2)) {
    return Array.from({ length: pieces }, (_, i) => { const t = (i + 0.5) / pieces; return { x: l.x + (l.x2 - l.x) * t, y: l.y + (l.y2 - l.y) * t, z: l.z, ...flux(l.lm / pieces) }; });
  }
  return [{ x: l.x, y: l.y, z: l.z, ...flux(l.lm) }];
}
/** Illuminance (lux) on a horizontal plane at (px, py, pz) metres from sources given in inches. No bounce, no shadows. */
export function luxAt(px, py, pz, sources) {
  let e = 0;
  for (const s of sources) {
    const vx = s.x * M - px, vy = s.y * M - py, vz = s.z * M - pz;
    if (vz <= 0.01) continue;
    const r2 = vx * vx + vy * vy + vz * vz, r = Math.sqrt(r2), cos = vz / r;
    const i = s.iso ? s.cd : s.cd * cos ** s.n;
    e += (i * cos) / r2;
  }
  return e;
}
/** Furniture lamps (Furniture tab, with real products in Shop) as luminaires for the estimate: isotropic, catalogue lumens. */
export function furnitureLuminaires(items) {
  const out = [];
  for (const it of items || []) {
    if (it.hidden || it.kind !== 'lamp' || !it.base?.light) continue;
    const e = it.elev || 0, type = it.base.lamp;
    const z = type === 'floor' ? it.h - 7 : type === 'table' ? e + 13 : type === 'pendant' ? e + 2 : e - 1;
    out.push({ id: `furn-${it.id}`, type: type === 'ceiling' ? 'recessed' : type === 'pendant' ? 'pendant' : 'floor', label: it.name, x: it.x, y: it.y, z, lm: it.base.light.lm, k: it.base.light.k, beam: 360, on: true, source: 'assumed', fromFurniture: true });
  }
  return out;
}
/**
 * Lux estimate on a sensor grid per room. A lamp lights the room its centre (or a strip's centre) stands in.
 * `plane`: 'floor' (height 0) or 'work' (0.76 m). Returns the same shape as daylightGrids (plus lux stats).
 */
export function lampGrids(model, luminaires, { plane = 'floor', stepM = 0.3 } = {}) {
  const pz = plane === 'work' ? SENSOR_HEIGHT_M : 0, out = [];
  const lamps = luminaires.filter((l) => l.on !== false);
  for (const r of model.rooms) {
    if (r.kind === 'closet' || r.kind === 'outdoor') continue;
    const here = lamps.filter((l) => { const cx = l.type === 'strip' && Number.isFinite(l.x2) ? (l.x + l.x2) / 2 : l.x, cy = l.type === 'strip' && Number.isFinite(l.y2) ? (l.y + l.y2) / 2 : l.y; return polyHas(r.poly, cx, cy); });
    const poly = r.poly.map((p) => [p[0] * M, p[1] * M]), xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), nx = Math.ceil((Math.max(...xs) - x0) / stepM), ny = Math.ceil((Math.max(...ys) - y0) / stepM);
    const sources = here.flatMap((l) => sourcesOf(l)), values = [], inside = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * stepM, y = y0 + (j + 0.5) * stepM;
      if (!polyHas(poly, x, y) || edgeDistance(poly, x, y) < 0.15) { values.push(null); continue; }
      const v = luxAt(x, y, pz, sources); values.push(v); inside.push(v);
    }
    out.push({ room: r.name, kind: r.kind, lamps: here.map((l) => l.id), lm: here.reduce((a, l) => a + l.lm, 0), x0In: x0 / M, y0In: y0 / M, stepIn: stepM / M, nx, ny, values, stats: gridStats(inside) });
  }
  return { rooms: out, plane };
}
/** Lumens per square metre of floor for a room (a common rule of thumb to sanity-check a lamp plan). */
export function lumensPerM2(room, areaIn2) { const a = areaIn2 * M * M; return a > 0 ? room.lm / a : null; }

/** Rule-of-thumb illuminance ranges for the notes (lux on the work plane). Guidance only, not a standard to certify against. */
export const LUX_GUIDE = [['Relaxed living and bedroom', 50, 150], ['Dining and general', 100, 200], ['Kitchen, desk or reading', 300, 500]];

export { SURFACE_DEFAULT, BLINDS_T, reflectanceMean };
