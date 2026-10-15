// A window view matched to a listing photo, kept as a record: the landmarks the renter marked, the fit (which way the photo looks,
// its tilt and lens, the camera's eye height) and what was applied to the unit. Pure functions (no DOM) plus small storage helpers
// that take their storage and fetch functions as arguments, so `node --test` covers them.
//
//   record (kind apartmentscout-view-calibration, schema 1)
//     site        listing / site id
//     saved       ISO time
//     photo       {n, path, title, scope, floor, aspect, source}   n = the photo's place in the gallery (1-based), floor = where it was taken
//     eye         {x, y, z}                                        the window point and the model's eye height used as the prior
//     landmarks   [{name, kind: 'named' | 'picked', x, y, z, u, v}]  world point (site metres) and click (fractions of the picture)
//     result      {bearing_deg, tilt_deg, vfov_deg, hfov_deg, eye_height_m, eye_determined, lens_determined, sigma, rms_deg, max_deg, n, dof, quality}
//     applied     {az_deg, floor, facade_offset_deg}
//
// Where it lives: `apartmentscout serve` saves it into the search folder (`view-calibrations/<id>.json`, which `build` copies to the
// page and `apartmentscout site` reads); any other page keeps it in this browser's localStorage. "Export" downloads the same file and
// `apartmentscout viewcal import FILE` takes it into a search folder.
import { normaliseMeasured } from './calibration.js';

export const VIEWCAL_KIND = 'apartmentscout-view-calibration';
export const VIEWCAL_SCHEMA = 1;
export const VC_PREFIX = 'as:view-cal:';
const SID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const fin = Number.isFinite;
const clean = (v, n = 200) => String(v ?? '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, n);
const num = (v, lo, hi) => (typeof v === 'number' && fin(v) && v >= lo && v <= hi ? v : null);
const r = (v, k) => Math.round(v * k) / k;
const round3 = (v) => (fin(v) ? Math.round(v * 1000) / 1000 : null);

/** Build a record from the wizard's state and a solveView result. */
export function buildViewCal({ site, photo, eye, landmarks, result, applied = null, saved = new Date().toISOString() }) {
  return normaliseViewCal({
    schema: VIEWCAL_SCHEMA, kind: VIEWCAL_KIND, site, saved, photo, eye,
    landmarks: landmarks.map((l) => ({ name: l.name, kind: l.kind || 'picked', x: l.x, y: l.y, z: l.z, u: l.u, v: l.v })),
    result: {
      bearing_deg: result.bearing_deg, tilt_deg: result.tilt_deg, vfov_deg: result.vfov_deg, hfov_deg: result.hfov_deg,
      eye_height_m: result.eye_height_m, eye_determined: !!result.eye_determined, lens_determined: !!result.lens_determined,
      sigma: { bearing: result.sigma?.bearing ?? null, tilt: result.sigma?.tilt ?? null, vfov: result.sigma?.vfov ?? null, eye: result.sigma?.eye ?? null },
      rms_deg: result.rms_deg, max_deg: result.max_deg, n: result.n, dof: result.dof, quality: result.quality,
    },
    applied,
  });
}

/** A clean record or null. Nothing is repaired: a record with a missing or out-of-range number is refused as a whole. */
export function normaliseViewCal(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (o.kind !== VIEWCAL_KIND || o.schema !== VIEWCAL_SCHEMA || !SID.test(String(o.site || ''))) return null;
  const p = o.photo, e = o.eye, R = o.result;
  if (!p || !e || !R || !Array.isArray(o.landmarks)) return null;
  const photo = { n: Math.round(+p.n), path: p.path ? clean(p.path, 300) : null, title: clean(p.title, 160), scope: clean(p.scope, 40), source: p.source === 'file' ? 'file' : 'listing', floor: Math.round(+p.floor), aspect: num(+p.aspect, 0.2, 5) };
  if (!(photo.n >= 0 && photo.n <= 500) || !(photo.floor >= 1 && photo.floor <= 200) || photo.aspect == null) return null;
  const eye = { x: num(+e.x, -1e5, 1e5), y: num(+e.y, -1e5, 1e5), z: num(+e.z, -50, 1500) };
  if (eye.x == null || eye.y == null || eye.z == null) return null;
  const lms = o.landmarks.slice(0, 12).map((l) => ({
    name: clean(l?.name, 80) || 'Landmark', kind: l?.kind === 'named' ? 'named' : 'picked',
    x: num(+l?.x, -1e5, 1e5), y: num(+l?.y, -1e5, 1e5), z: num(+l?.z, -50, 2000), u: num(+l?.u, -0.5, 1.5), v: num(+l?.v, -0.5, 1.5),
  }));
  if (lms.length < 2 || lms.some((l) => Object.values(l).some((x) => x == null))) return null;
  const res = {
    bearing_deg: num(+R.bearing_deg, 0, 360), tilt_deg: num(+R.tilt_deg, -89, 89), vfov_deg: num(+R.vfov_deg, 5, 170), hfov_deg: num(+R.hfov_deg, 5, 179),
    eye_height_m: num(+R.eye_height_m, -50, 1500), eye_determined: !!R.eye_determined, lens_determined: !!R.lens_determined,
    rms_deg: num(+R.rms_deg, 0, 90), max_deg: num(+R.max_deg, 0, 90), n: Math.round(+R.n), dof: Math.round(+R.dof), quality: ['good', 'fair', 'poor'].includes(R.quality) ? R.quality : 'poor',
  };
  if (Object.values(res).some((x) => x == null || (typeof x === 'number' && !fin(x)))) return null;
  const sg = R.sigma || {}, sigma = {};
  for (const k of ['bearing', 'tilt', 'vfov', 'eye']) sigma[k] = sg[k] == null ? null : num(+sg[k], 0, 1e4);
  const A = o.applied && typeof o.applied === 'object' ? { az_deg: num(+o.applied.az_deg, 0, 360), floor: Math.round(+o.applied.floor), facade_offset_deg: num(+o.applied.facade_offset_deg, -180, 180) } : null;
  return {
    schema: VIEWCAL_SCHEMA, kind: VIEWCAL_KIND, site: String(o.site), saved: clean(o.saved, 40) || new Date(0).toISOString(), photo, eye: { x: r(eye.x, 100), y: r(eye.y, 100), z: r(eye.z, 100) },
    landmarks: lms.map((l) => ({ ...l, x: r(l.x, 100), y: r(l.y, 100), z: r(l.z, 100), u: round3(l.u), v: round3(l.v) })),
    result: { ...res, bearing_deg: r(res.bearing_deg, 100), tilt_deg: r(res.tilt_deg, 100), vfov_deg: r(res.vfov_deg, 100), hfov_deg: r(res.hfov_deg, 100), eye_height_m: r(res.eye_height_m, 100), rms_deg: r(res.rms_deg, 1000), max_deg: r(res.max_deg, 1000),
      sigma: Object.fromEntries(Object.entries(sigma).map(([k, v]) => [k, v == null ? null : r(v, 100)])) },
    applied: A && A.az_deg != null && A.floor >= 1 ? { az_deg: r(A.az_deg, 100), floor: A.floor, facade_offset_deg: A.facade_offset_deg == null ? null : r(A.facade_offset_deg, 10) } : null,
  };
}

/** Read a record from text or an object (a saved file, an import): {ok, record} or {ok: false, error}. */
export function parseViewCal(input) {
  try {
    if (typeof input === 'string' && input.length > 200000) return { ok: false, error: 'This file is too large to be a view calibration.' };
    const obj = typeof input === 'string' ? JSON.parse(input) : input;
    const rec = normaliseViewCal(obj);
    return rec ? { ok: true, record: rec } : { ok: false, error: 'This is not an ApartmentScout view calibration (or a number in it is out of range).' };
  } catch { return { ok: false, error: 'This file is not valid JSON.' }; }
}

/** The vertical measurement a record stands for ({kind: 'eye', ...} for unit/calibration.js), or null when the photo could not fix the height. */
export function measuredFromViewCal(rec) {
  const R = rec?.result;
  if (!R || !R.eye_determined) return null;
  const sg = R.sigma?.eye;
  return normaliseMeasured({ kind: 'eye', value: R.eye_height_m, floor: rec.photo.floor, spread: 'scale', src: `photo ${rec.photo.n}${sg != null ? `, ±${sg.toFixed(1)} m` : ''}` });
}

/** How a record reads in the panels: "photo 1 (32E living/dining)". */
export const photoLabel = (rec) => `photo ${rec.photo.n}${rec.photo.title ? ` (${rec.photo.title.replace(/\s*\(virtually staged\)\s*$/i, '')})` : ''}`;
/** "fits within 0.6° on 3 landmarks" */
export const fitLabel = (rec) => `fits within ${rec.result.rms_deg < 0.1 ? rec.result.rms_deg.toFixed(2) : rec.result.rms_deg.toFixed(1)}° on ${rec.result.n} landmarks`;

/** The newer of two records (or the one that exists). */
export const newer = (a, b) => (!a ? b || null : !b ? a : String(b.saved) > String(a.saved) ? b : a);

// ------------------------------------------------------------------ storage

const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export function saveLocal(rec, { storage = defaultStorage() } = {}) {
  const c = normaliseViewCal(rec);
  if (!c || !storage) return null;
  try { storage.setItem(VC_PREFIX + c.site, JSON.stringify(c)); return c; } catch { return null; }
}
export function loadLocal(siteId, { storage = defaultStorage() } = {}) {
  if (!SID.test(String(siteId || '')) || !storage) return null;
  try { const t = storage.getItem(VC_PREFIX + siteId); if (!t || t.length > 200000) return null; const rec = normaliseViewCal(JSON.parse(t)); return rec && rec.site === siteId ? rec : null; } catch { return null; }
}
export function clearLocal(siteId, { storage = defaultStorage() } = {}) { try { storage?.removeItem(VC_PREFIX + siteId); } catch { /* storage unavailable */ } }

/**
 * Save a record where the page can: the search folder through the local API (`api.available()` and `api.saveViewCal(record)`), else this browser.
 * Returns {where: 'search folder' | 'this browser', record, path?} or throws only when nothing could store it.
 */
export async function saveViewCal(rec, { api = null, storage = defaultStorage() } = {}) {
  const c = normaliseViewCal(rec);
  if (!c) throw new Error('The view calibration is not valid and was not saved.');
  if (api && (await api.available().catch(() => false))) {
    try { const out = await api.saveViewCal(c); saveLocal(c, { storage }); return { where: 'search folder', record: c, path: out?.path || null, warnings: out?.warnings || [] }; }
    catch (e) { if (!e || (e.status !== 403 && e.status !== 409 && e.status !== 404)) throw e; /* a read-only example, or no search open: keep it in this browser */ }
  }
  if (!saveLocal(c, { storage })) throw new Error('Browser storage is not available: use Export instead.');
  return { where: 'this browser', record: c };
}

/**
 * The record for a site: the search folder's copy (listed in the manifest's `view_calibrations`) and this browser's copy, the newer one.
 * `fetchJSON(url)` resolves the parsed JSON or null.
 */
export async function loadViewCal(siteId, { base = 'data', manifest = null, fetchJSON, storage = defaultStorage() } = {}) {
  let file = null;
  if (fetchJSON && Array.isArray(manifest?.view_calibrations) && manifest.view_calibrations.includes(siteId)) {
    const rec = normaliseViewCal(await fetchJSON(`${base}/view-calibrations/${encodeURIComponent(siteId)}.json`).catch(() => null));
    if (rec && rec.site === siteId) file = rec;
  }
  return newer(file, loadLocal(siteId, { storage }));
}

/** The download: {filename, text, type}. */
export function exportViewCal(rec) {
  const c = normaliseViewCal(rec);
  if (!c) throw new Error('The view calibration is not valid.');
  return { filename: `${c.site}.view-calibration.json`, text: JSON.stringify(c, null, 2) + '\n', type: 'application/json' };
}

/** What a saved record says about the unit, for Unit 3D to apply: {az, tilt, vfov, measured, floor}. */
export function stateFromViewCal(rec) {
  const R = rec.result, A = rec.applied;
  return { az: A?.az_deg ?? null, bearing: R.bearing_deg, tilt: R.tilt_deg, vfov: R.vfov_deg, measured: measuredFromViewCal(rec), floor: rec.photo.floor, photoN: rec.photo.n };
}
