// The exportable model project: one JSON file (with an optional embedded .glb) that holds everything needed to
// restore a Unit 3D scene on another machine, offline: the city geometry as the site file (with its source receipts
// and checks), the shared window anchor and pin, the vertical calibration, assumed building parts, the plan with its
// furniture and lighting, the saved comparison scenarios, what-if height edits, the view, and version metadata.
// Import is strict (sizes, finite numbers, known shapes, no prototype keys); a bad file is refused with a reason and
// changes nothing. Pure apart from sha256Hex (Web Crypto, optional) and the IndexedDB helpers at the end.
import { validateParts } from './parts.js';
import { normalisePin } from './anchor.js';
import { normaliseMeasured } from './calibration.js';
import { parseProject } from '../plan/project.js';

export const PROJECT_KIND = 'apartmentscout-model-project';
export const PROJECT_SCHEMA = 1;
export const MAX_PROJECT_BYTES = 80 * 1024 * 1024;
export const MAX_BUILDINGS = 20000;
const fin = Number.isFinite;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const text = (v, n = 200) => String(v ?? '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, n);
const bad = (m) => { throw new Error(m); };

/** A plain JSON tree: depth-limited, finite numbers, no prototype keys, no accessors or cycles. */
export function jsonTree(v, depth = 0) {
  if (depth > 16) bad('Project nesting is too deep');
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
  if (typeof v === 'number') { if (!fin(v)) bad('Project numbers must be finite'); return; }
  if (typeof v !== 'object') bad('Project must contain only JSON values');
  if (Array.isArray(v)) { for (const x of v) jsonTree(x, depth + 1); return; }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(v))) bad('Project must contain plain JSON objects');
  for (const k of Object.keys(v)) { if (['__proto__', 'constructor', 'prototype'].includes(k)) bad('Project contains an unsafe key'); jsonTree(v[k], depth + 1); }
}

/** SHA-256 (hex) of a string or bytes, or null where Web Crypto is not available (a file:// page, an old browser). */
export async function sha256Hex(data) {
  try {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const d = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

/** Check a site file's shape: numeric buildings, a valid target, components that validate. Returns the site or throws. */
export function checkSite(site) {
  if (!site || typeof site !== 'object' || Array.isArray(site)) bad('The project has no site model');
  const b = site.b;
  if (!Array.isArray(b) || !b.length || b.length > MAX_BUILDINGS) bad('The site model has no buildings (or too many)');
  for (const r of b) {
    if (!Array.isArray(r) || r.length < 4 || !fin(r[0]) || !fin(r[1]) || !Array.isArray(r[3]) || r[3].length < 6 || r[3].length % 2 || r[3].length > 4000 || !r[3].every(fin)) bad('A building in the site model is malformed');
  }
  if (!Number.isInteger(site.target) || site.target < 0 || site.target >= b.length) bad('The site model has no valid target building');
  const o = site.origin;
  if (!o || !(Math.abs(o.lat) <= 90) || !(Math.abs(o.lon) <= 180)) bad('The site model has no valid origin');
  if (site.components != null) {
    const { problems } = validateParts(site.components, b.length);
    if (problems.length) bad(`The site model's components are invalid: ${problems.slice(0, 2).join('; ')}`);
  }
  if (site.faces != null && !Array.isArray(site.faces)) bad('The site model faces are malformed');
  const id = site.listing?.id;
  if (id != null && !ID.test(String(id))) bad('The site model has an unusable listing id');
  return site;
}

/**
 * Assemble a project object. Pass what the page holds; empty sections are written as null so the file says what it lacks.
 *   site (the loaded site JSON, which carries geometry, receipts and checks), anchor (anchor.js record), pin, cal (exportCalibration),
 *   parts (assumed parts map or null), plan ({id, source, label, saved, project} or null), scenarios (specs), results (compare
 *   results or null), edits ([{index, h}]), view, glb ({data, bytes, sha256} or null), app ({name, version}).
 */
export function buildModelProject({ siteId, base = 'data', site, anchor = null, pin = null, cal = null, parts = null, plan = null, scenarios = [], results = null, edits = [], view = null, glb = null, siteHash = null, app = {}, created = new Date().toISOString() }) {
  checkSite(site);
  return {
    schema: PROJECT_SCHEMA, kind: PROJECT_KIND, created,
    app: { name: 'ApartmentScout', version: text(app.version, 40) || null, note: 'Restores offline in Unit 3D (Model project ▸ Import). Not a survey.' },
    site: { id: siteId, base: text(base, 80), generated: site.generated ?? null, source: site.source ?? null, sha256: siteHash, data: site },
    receipts: { datasets: Array.isArray(site.receipts) ? site.receipts : [], checks: Array.isArray(site.checks) ? site.checks : [] },
    anchor, pin, calibration: cal, assumed_parts: parts,
    plan: plan ? { id: plan.id, source: plan.source, label: text(plan.label, 80), saved: plan.saved || null, project: plan.project } : null,
    scenarios: Array.isArray(scenarios) ? scenarios.slice(0, 4) : [], comparison: results,
    edits: edits.map((e) => ({ index: e.index, h: e.h })), view,
    glb: glb ? { name: `${siteId}.glb`, encoding: 'base64', bytes: glb.bytes, sha256: glb.sha256 ?? null, data: glb.data } : null,
  };
}

/**
 * Validate a project (text or object). Returns {ok: true, project, warnings} with detached, cleaned parts:
 * {siteId, site, anchor, pin, cal, parts, plan: {id, source, label, saved, project} | null, scenarios, edits, view, glb},
 * or {ok: false, error}. Nothing outside the returned object is touched.
 */
export function parseModelProject(input) {
  try {
    if (typeof input === 'string' && input.length > MAX_PROJECT_BYTES) bad('The project is larger than 80 MB');
    const obj = typeof input === 'string' ? JSON.parse(input) : input;
    jsonTree(obj);
    if (obj.kind !== PROJECT_KIND) bad('This is not an ApartmentScout model project');
    if (obj.schema !== PROJECT_SCHEMA) bad(`Unsupported project version ${text(obj.schema, 12)} (this app reads version ${PROJECT_SCHEMA})`);
    const warnings = [];
    const siteId = obj.site?.id;
    if (!ID.test(String(siteId || ''))) bad('The project names no usable site id');
    const site = checkSite(obj.site?.data);
    if (site.listing?.id && site.listing.id !== siteId) bad('The project\'s site id does not match its site model');
    const out = { siteId, base: text(obj.site.base, 80) || 'data', site, siteHash: typeof obj.site.sha256 === 'string' ? obj.site.sha256 : null, created: text(obj.created, 40) };
    out.pin = obj.pin ? normalisePin(obj.pin) : null;
    if (obj.pin && !out.pin) warnings.push('The saved window pin was invalid and was ignored.');
    out.cal = obj.calibration?.measured ? normaliseMeasured({ kind: obj.calibration.measured.kind, value: obj.calibration.measured.value_m ?? obj.calibration.measured.value, floor: obj.calibration.measured.floor, spread: obj.calibration.measured.spread, src: obj.calibration.measured.src }) : null;
    if (obj.calibration?.measured && !out.cal) warnings.push('The saved measured height was invalid and was ignored.');
    out.parts = null;
    if (obj.assumed_parts) {
      const { map, problems } = validateParts(obj.assumed_parts, site.b.length);
      if (problems.length) warnings.push(`Some assumed building parts were invalid and were ignored: ${problems.slice(0, 2).join('; ')}`);
      out.parts = Object.keys(map).length ? map : null;
    }
    out.plan = null;
    if (obj.plan) {
      const r = parseProject(obj.plan.project);
      if (!r.ok) warnings.push(`The plan in this project could not be read (${r.error}) and was left out.`);
      else out.plan = { id: r.project.plan.id, source: obj.plan.source === 'local scenario' ? 'local scenario' : 'file', label: text(obj.plan.label, 80), saved: text(obj.plan.saved, 40) || null, project: r.project };
    }
    out.scenarios = (Array.isArray(obj.scenarios) ? obj.scenarios : []).slice(0, 4).filter((s) => s && typeof s === 'object' && !Array.isArray(s)).map((s) => ({ ...s }));
    out.edits = (Array.isArray(obj.edits) ? obj.edits : []).filter((e) => Number.isInteger(e?.index) && e.index >= 0 && e.index < site.b.length && e.index !== site.target && fin(e.h) && e.h >= 0 && e.h <= 900).map((e) => ({ index: e.index, h: e.h }));
    out.view = obj.view && typeof obj.view === 'object' ? obj.view : null;
    out.glb = obj.glb && typeof obj.glb.data === 'string' && /^[A-Za-z0-9+/=]*$/.test(obj.glb.data) ? { bytes: +obj.glb.bytes || 0, sha256: obj.glb.sha256 ?? null, data: obj.glb.data } : null;
    out.receipts = obj.receipts && typeof obj.receipts === 'object' ? { datasets: Array.isArray(obj.receipts.datasets) ? obj.receipts.datasets.length : 0 } : null;
    return { ok: true, project: out, warnings };
  } catch (e) { return { ok: false, error: e.message || 'Invalid project' }; }
}

/** base64 <-> bytes without a stack overflow on multi-megabyte buffers. */
export function bytesToBase64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBytes(b64) {
  const s = atob(b64), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

// ------------------------------------------------------------------ imported projects survive a reload (IndexedDB)

const DB = 'as-model-projects', STORE = 'projects';
function idb() {
  return new Promise((res, rej) => {
    if (!globalThis.indexedDB) { rej(new Error('IndexedDB is not available')); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = async (mode, fn) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode), out = fn(t.objectStore(STORE)); t.oncomplete = () => { db.close(); res(out?.result); }; t.onerror = () => { db.close(); rej(t.error); }; }); };
/** Keep an imported project's text in this browser so the scene is still there after a reload. Never throws. */
export async function rememberProject(base, siteId, textJson) { try { await tx('readwrite', (s) => s.put({ key: `${base}|${siteId}`, base, siteId, saved: new Date().toISOString(), text: textJson })); return true; } catch { return false; } }
export async function recalledProjects(base) { try { const all = await tx('readonly', (s) => s.getAll()); return (all || []).filter((r) => r.base === base && typeof r.text === 'string'); } catch { return []; } }
export async function forgetProject(base, siteId) { try { await tx('readwrite', (s) => s.delete(`${base}|${siteId}`)); } catch { /* nothing stored */ } }
