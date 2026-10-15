// Component buildings (podium, tower, setback, bulkhead) beyond the site file: strict validation, a podium-and-tower
// preset, and a browser-local "assumed" override that Unit 3D, the Floor plan studio and every obstruction
// calculation read through effectiveComponents(), so the 3D drawing and the sun maths always share one set of parts.
// Pure apart from the optional localStorage helpers. apartmentscout/geo/anchor.py (validate_components, podium_tower)
// is the Python twin; tests/fixtures/model_anchor.json pins both.
//
// Site JSON v2: "components": {"<building index>": [{ring: [[x, y], ...], base_m, top_m, kind, source, confidence, ref?}]},
// metres in the site frame, base_m/top_m above the building's own ground. An override adds source "assumed: ..." and
// confidence "assumed" so nothing built from it can pass for source data.
export const KINDS = ['podium', 'tower', 'setback', 'bulkhead', 'spire'];
export const CONFIDENCE = ['high', 'medium', 'low', 'assumed'];
export const MAX_PARTS = 40, MAX_BUILDINGS = 200, MAX_COORD_M = 5000, MAX_HEIGHT_M = 900;
export const ASSUMED = 'assumed: ';
const fin = Number.isFinite;
const r2 = (v) => Math.round(v * 100) / 100;
const text = (v, n) => String(v ?? '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, n);

/**
 * Check a components map {"<index>": [component, ...]} (a bare list means the target, key "target").
 * Returns {map, problems}: every bad entry is dropped and named; nothing is repaired silently.
 */
export function validateParts(raw, nBuildings = null) {
  const problems = [], map = {};
  if (Array.isArray(raw)) raw = { target: raw };
  if (!raw || typeof raw !== 'object') return { map, problems: ['components must be a list or a map of building index to a list'] };
  const keys = Object.keys(raw);
  if (keys.length > MAX_BUILDINGS) return { map, problems: [`more than ${MAX_BUILDINGS} buildings`] };
  for (const key of keys) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) { problems.push(`building ${key}: unsafe key`); continue; }
    if (key !== 'target') {
      const i = Number(key);
      if (!Number.isInteger(i) || String(i) !== key) { problems.push(`building ${key}: not an index`); continue; }
      if (i < 0 || (nBuildings != null && i >= nBuildings)) { problems.push(`building ${key}: no such building`); continue; }
    }
    const lst = raw[key];
    if (!Array.isArray(lst) || !lst.length) { problems.push(`building ${key}: needs a non-empty list`); continue; }
    if (lst.length > MAX_PARTS) { problems.push(`building ${key}: more than ${MAX_PARTS} parts`); continue; }
    const clean = [];
    lst.forEach((c, j) => {
      const where = `building ${key} part ${j + 1}`;
      if (!c || typeof c !== 'object' || Array.isArray(c)) { problems.push(`${where}: not an object`); return; }
      const ring = Array.isArray(c.ring) ? c.ring : null;
      if (!ring || ring.some((p) => !Array.isArray(p) || p.length < 2 || !fin(p[0]) || !fin(p[1]) || typeof p[0] !== 'number' || typeof p[1] !== 'number')) { problems.push(`${where}: ring must be [[x, y], ...]`); return; }
      if (ring.length < 3 || ring.length > 400 || ring.some((p) => Math.abs(p[0]) > MAX_COORD_M || Math.abs(p[1]) > MAX_COORD_M)) { problems.push(`${where}: ring needs 3+ finite points within ${MAX_COORD_M} m`); return; }
      const base = c.base_m === undefined ? 0 : c.base_m, top = c.top_m;
      if (typeof base !== 'number' || typeof top !== 'number' || !fin(base) || !fin(top)) { problems.push(`${where}: base_m and top_m must be numbers`); return; }
      if (!(base >= 0 && base < top && top <= MAX_HEIGHT_M)) { problems.push(`${where}: needs 0 <= base_m < top_m <= ${MAX_HEIGHT_M}`); return; }
      const source = text(c.source, 200);
      if (!source) { problems.push(`${where}: source is required`); return; }
      const kind = String(c.kind ?? '').toLowerCase(), conf = String(c.confidence ?? 'assumed').toLowerCase();
      const item = { ring: ring.map((p) => [r2(p[0]), r2(p[1])]), base_m: r2(base), top_m: r2(top), kind: KINDS.includes(kind) ? kind : base > 0 ? 'setback' : 'podium', source, confidence: CONFIDENCE.includes(conf) ? conf : 'assumed' };
      if (c.ref) item.ref = text(c.ref, 400);
      clean.push(item);
    });
    if (clean.length) map[key] = clean;
  }
  return { map, problems };
}

/** Keep the part of ring (array of [x, y]) with ax*x + ay*y <= limit (one Sutherland-Hodgman pass). */
export function clipRing(ring, ax, ay, limit) {
  const out = [], n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n], dp = ax * p[0] + ay * p[1] - limit, dq = ax * q[0] + ay * q[1] - limit;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dq < 0 && dp > 0)) { const s = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s]); }
  }
  return out;
}
const area = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length]; a += x1 * y2 - x2 * y1; } return a / 2; };

/**
 * A podium under a tower, assumed for a prepared building b ({p: [x, y, ...], top, g}). The podium is the whole
 * footprint up to podium_m; the tower is the footprint held back setback_m from the facade facing out_deg (and
 * side_m at its two sides), from the podium roof to the building's roof. Throws Error with a reason when the numbers
 * leave no podium or no tower.
 */
export function podiumTower(b, { podium_m, setback_m, out_deg, side_m = 0 }) {
  const ring = []; for (let i = 0; i < b.p.length; i += 2) ring.push([b.p[i], b.p[i + 1]]);
  const roof = b.top - b.g;
  if (!(podium_m > 0 && podium_m < roof)) throw new Error(`Podium height must be between 0 and the ${roof.toFixed(0)} m roof`);
  if (!(setback_m >= 0 && side_m >= 0)) throw new Error('Setbacks cannot be negative');
  const rad = (out_deg * Math.PI) / 180, u = [Math.sin(rad), Math.cos(rad)], r = [u[1], -u[0]];
  let tower = clipRing(ring, u[0], u[1], Math.max(...ring.map((p) => u[0] * p[0] + u[1] * p[1])) - setback_m);
  if (side_m > 0 && tower.length >= 3) {
    tower = clipRing(tower, r[0], r[1], Math.max(...tower.map((p) => r[0] * p[0] + r[1] * p[1])) - side_m);
    if (tower.length >= 3) tower = clipRing(tower, -r[0], -r[1], Math.max(...tower.map((p) => -r[0] * p[0] - r[1] * p[1])) - side_m);
  }
  if (tower.length < 3 || Math.abs(area(tower)) < 20) throw new Error('That setback leaves no tower on the lot');
  const g = (v) => String(+v.toFixed(2)).replace(/^-0$/, '0');
  const label = `podium ${g(podium_m)} m, tower set back ${g(setback_m)} m${side_m ? ` and ${g(side_m)} m at the sides` : ''} from the ${Math.round(out_deg)}° facade`;
  const base = { source: ASSUMED + label, confidence: 'assumed' };
  return [
    { ring: ring.map((p) => [...p]), base_m: 0, top_m: podium_m, kind: 'podium', ...base },
    { ring: tower.map((p) => [r2(p[0]), r2(p[1])]), base_m: podium_m, top_m: r2(roof), kind: 'tower', ...base },
  ];
}

/** The site's component map with an override laid over it ("target" resolves to site.target). The inputs are not changed. */
export function mergeParts(siteComps, override, targetIndex) {
  const out = { ...(siteComps && typeof siteComps === 'object' ? siteComps : {}) };
  for (const [k, lst] of Object.entries(override || {})) out[k === 'target' ? String(targetIndex) : k] = lst;
  return out;
}
/** Is a part list one of ours (assumed)? */
export const isAssumed = (lst) => Array.isArray(lst) && lst.some((c) => c?.confidence === 'assumed' || /^assumed:/i.test(c?.source || ''));
/** Buildings (by index) whose parts in `comps` are assumed. */
export const assumedBuildings = (comps) => Object.entries(comps || {}).filter(([, l]) => isAssumed(l)).map(([k]) => Number(k));

// ------------------------------------------------------------------ the browser-local override

export const PARTS_PREFIX = 'as:parts-assumed:';
const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const sid = (id) => (/^[A-Za-z0-9_-]{1,80}$/.test(String(id || '')) ? String(id) : null);

/** Save an assumed override for a site. `parts` must validate (throws Error with the first problems otherwise). */
export function saveAssumedParts(siteId, parts, { nBuildings = null, targetIndex = null, preset = null, base = 'data', storage = defaultStorage() } = {}) {
  if (!sid(siteId)) throw new Error('Unknown site');
  const raw = JSON.parse(JSON.stringify(parts)), { map, problems } = validateParts(raw, nBuildings);
  if (problems.length || !Object.keys(map).length) throw new Error(problems.slice(0, 3).join('; ') || 'No parts to save');
  if (targetIndex != null && map.target) { map[String(targetIndex)] = map.target; delete map.target; }
  const rec = { schema: 1, kind: 'apartmentscout-assumed-parts', site: siteId, base: String(base).slice(0, 80), saved: new Date().toISOString(), parts: map, preset: preset && typeof preset === 'object' ? preset : null };
  if (!storage) throw new Error('Browser storage is not available');
  storage.setItem(PARTS_PREFIX + siteId, JSON.stringify(rec));
  return rec;
}
/** The assumed override saved for a site, validated again on the way out, or null. */
export function getAssumedParts(siteId, { nBuildings = null, base = null, storage = defaultStorage() } = {}) {
  if (!sid(siteId) || !storage) return null;
  let rec; try { const t = storage.getItem(PARTS_PREFIX + siteId); if (!t || t.length > 2_000_000) return null; rec = JSON.parse(t); } catch { return null; }
  if (!rec || rec.schema !== 1 || rec.kind !== 'apartmentscout-assumed-parts' || rec.site !== siteId) return null;
  if (base != null && rec.base !== base) return null;
  const { map, problems } = validateParts(rec.parts, nBuildings);
  return problems.length || !Object.keys(map).length ? null : { ...rec, parts: map };
}
export function clearAssumedParts(siteId, { storage = defaultStorage() } = {}) { try { storage?.removeItem(PARTS_PREFIX + siteId); } catch { /* storage unavailable */ } }

/**
 * The component map every consumer should use for `site`: its own components with this browser's assumed override
 * laid over them. Returns null when there are none. Pass `override` to use one explicitly (a project import, a scenario).
 */
export function effectiveComponents(site, { override, storage } = {}) {
  const own = site?.components && typeof site.components === 'object' ? site.components : null;
  let parts = override;
  if (parts === undefined) { const rec = site?.listing?.id ? getAssumedParts(site.listing.id, { nBuildings: site.b?.length ?? null, ...(storage ? { storage } : {}) }) : null; parts = rec?.parts; }
  if (!parts || !Object.keys(parts).length) return own;
  return mergeParts(own, parts, site.target);
}
