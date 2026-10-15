// The shared model anchor: one record that ties the floor plan, the window and the city together, so Unit 3D's
// Inside camera and the Floor plan studio put the same plan, on the same facade, at the same height.
//
// Two things live here. The anchor RECORD describes the placement (origin, rotation, slab datum, host facade, window
// position, which plan window sits where, whether each is in open air, and what is assumed); it is shown in both
// viewers and exported with a model project. The anchor PIN is the small piece of state the renter chooses on purpose
// ("Use this window in the Floor plan"): facade, position along it, facing, floor and measured height, saved in this
// browser per site so the studio places the plan exactly where Unit 3D does. Pure apart from the pin's localStorage.
// apartmentscout/geo/anchor.py (window_anchor) is the Python twin for the site-file part.
import { DEG, angDiff } from '../sun.js';
import { windowOpenAir, facadePoint, airReason } from './openair.js';
import { normaliseMeasured, describeCal } from './calibration.js';

const M = 0.0254;
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;

// ------------------------------------------------------------------ plan windows in the world

/**
 * Where each plan window lands in the city under a placement (plan/city.js placePlan): its plan position (inches),
 * site position (metres), outward bearing, sill and head heights (metres above the target's ground), length, and
 * whether the air just outside it is open. This is the window correspondence both viewers share.
 */
export function planWindows(ctx, model) {
  return model.windows.map((w, i) => {
    const [mx, my] = ctx.toSite(w.mid), nx = ctx.rx * w.normal[0] + ctx.ux * w.normal[1], ny = ctx.ry * w.normal[0] + ctx.uy * w.normal[1];
    const faces = (Math.atan2(nx, ny) / DEG + 360) % 360, zLo = ctx.slab + w.sill * M, zHi = ctx.slab + w.head * M;
    return {
      i, room: w.room || '', note: w.note || '', plan_in: [r1(w.mid[0]), r1(w.mid[1])], world_m: [r2(mx), r2(my)], faces_deg: r1(faces),
      sill_m: r2(zLo), head_m: r2(zHi), length_m: r2(w.len * M), air: windowOpenAir(ctx.B, ctx.ti, mx, my, faces, zLo, zHi),
    };
  });
}

// ------------------------------------------------------------------ the anchor record

/**
 * The record for the current window. Inputs (all already resolved by the caller):
 *   site, siteId, B (prepared buildings), T (target), face (a facesOf face), t, az (the way the window faces), floor,
 *   cal (calibration.resolveCal), panes (array or null), prov ({exposure, position, floor} source labels),
 *   plan ({model, source: 'file' | 'local scenario', label, saved} or null), ctx (placePlan result for the plan) or null.
 */
export function buildAnchor({ site, siteId, B, T, face, t, az, floor, cal, panes = null, prov = {}, plan = null, ctx = null, nameOf = (i) => `building ${i}` }) {
  const ti = B.indexOf(T), meta = site.bmeta?.[ti] || {}, slab = cal.slabAt(floor), [fx, fy] = facadePoint(face, t);
  const air = windowOpenAir(B, ti, fx, fy, az, slab + 0.6, slab + 2.2);
  const up = plan?.model?.up_bearing;
  const sources = { exposure: prov.exposure || 'assumed', position: prov.position || 'assumed', floor: prov.floor || 'assumed', datum: cal.state, plan_north: Number.isFinite(up) ? 'stated' : 'unknown' };
  const assumed = Object.entries(sources).filter(([, v]) => ['assumed', 'inferred', 'estimated', 'unknown', 'manual'].includes(v)).map(([k]) => k);
  const rec = {
    schema: 1, kind: 'apartmentscout-model-anchor', site: siteId,
    frame: "site metres: x east, y north, origin at the geocoded address point; z up from the target's ground",
    origin: { lat: site.origin.lat, lon: site.origin.lon },
    host: { index: ti, name: meta.name || meta.address || null, model: T.parts ? 'components' : 'prism', parts: T.parts ? T.parts.length : 1, assumed_parts: !!T.parts?.some((q) => q.confidence === 'assumed'), height_m: r1(T.top - T.g), ground_m: r2(T.g) },
    facade: { index: face.i, bearing_deg: face.bearing, length_m: face.length, shared: !!face.shared, clear: face.clearInterval ? [...face.clearInterval] : face.open ? [...face.open] : null, a: [r2(face.a[0]), r2(face.a[1])], b: [r2(face.b[0]), r2(face.b[1])] },
    window: { t: Math.round(t * 1000) / 1000, point_m: [r2(fx), r2(fy)], faces_deg: r1(az), panes: panes?.length ? panes.map(Number) : null, floor },
    north: { facade_normal_deg: face.bearing, rotation_deg: r1(az), plan_up_bearing_deg: Number.isFinite(up) ? up : null, mismatch_deg: Number.isFinite(up) ? r1(Math.abs(angDiff(az, up))) : null },
    datum: (({ state, ground_m, slab_m, eye_m, estimated_slab_m, delta_m, floor_height_m, estimated_floor_height_m, measured }) => ({ state, ground_m, slab_m, eye_m, estimated_slab_m, delta_m, floor_height_m, estimated_floor_height_m, measured }))(describeCal(cal, floor)),
    air: { ok: air.ok, reason: air.reason, building: air.building, out_m: [0.4, 1.0] },
    sources, assumed, plan: null,
  };
  if (plan?.model && ctx) {
    const wins = planWindows(ctx, plan.model);
    rec.plan = {
      id: plan.model.id || siteId, title: plan.model.title || '', source: plan.source || 'file', label: plan.label || '', saved: plan.saved || null,
      up_bearing_deg: Number.isFinite(up) ? up : null, ceiling_m: r2(plan.model.ceiling * M), placed_on_facade: ctx.face.i, pinned: !!ctx.pinned,
      windows: wins, front_windows: wins.filter((w) => Math.abs(angDiff(w.faces_deg, az)) <= 30).length,
      open_air: wins.every((w) => w.air.ok), withheld: wins.filter((w) => !w.air.ok).map((w) => w.i),
    };
  }
  rec.air.message = air.ok ? '' : airReason(air, nameOf);
  return rec;
}

/** Sections for panels: [{title, rows: [{k, v, state: 'source' | 'measured' | 'assumed' | 'warn', hint?}]}]. */
export function describeAnchor(rec) {
  const st = (s) => (['assumed', 'inferred', 'estimated', 'unknown', 'manual'].includes(s) ? 'assumed' : s === 'measured' ? 'measured' : 'source');
  const d = rec.datum, f = rec.facade, w = rec.window, n = rec.north;
  const sec = [
    { title: 'Origin', rows: [{ k: 'Site origin', v: `${rec.origin.lat.toFixed(5)}, ${rec.origin.lon.toFixed(5)} (geocoded address point)`, state: 'source' }, { k: 'Window point', v: `${w.point_m[0]} m E, ${w.point_m[1]} m N of the origin`, state: st(rec.sources.position), hint: 'where along the facade the unit sits is rarely published' }] },
    { title: 'North and rotation', rows: [
      { k: 'Window faces', v: `${w.faces_deg}°`, state: st(rec.sources.exposure) },
      { k: 'Plan top points to', v: `${n.rotation_deg}° (facade normal ${n.facade_normal_deg}°)`, state: 'source' },
      { k: 'Plan north', v: n.plan_up_bearing_deg == null ? 'not stated on the plan' : `plan declares ${n.plan_up_bearing_deg}° (${n.mismatch_deg}° from the placement)`, state: n.plan_up_bearing_deg == null ? 'assumed' : n.mismatch_deg > 15 ? 'warn' : 'source' }] },
    { title: 'Slab datum', rows: [
      { k: 'Floor ' + w.floor + ' slab', v: `${d.slab_m} m above the street (eye ${d.eye_m} m)`, state: st(d.state) },
      { k: 'Floor-count estimate', v: `${d.estimated_slab_m} m (${d.estimated_floor_height_m} m per floor)${d.state === 'measured' ? `, ${d.delta_m >= 0 ? '+' : '−'}${Math.abs(d.delta_m)} m measured` : ''}`, state: 'assumed' }] },
    { title: 'Host facade', rows: [
      { k: 'Building', v: `${rec.host.name || 'target'}: ${rec.host.model === 'components' ? `${rec.host.parts} parts${rec.host.assumed_parts ? ' (assumed)' : ''}` : 'one footprint prism'}, ${rec.host.height_m} m`, state: rec.host.assumed_parts ? 'assumed' : 'source' },
      { k: 'Facade', v: `edge ${f.index}, faces ${f.bearing_deg}°, ${f.length_m} m long${f.shared ? ', party wall' : ''}`, state: f.shared ? 'warn' : 'source' },
      { k: 'Open air outside', v: rec.air.ok ? 'yes, at the window height' : rec.air.message || 'no', state: rec.air.ok ? 'source' : 'warn' }] },
  ];
  if (rec.plan) {
    sec.push({ title: 'Plan and window correspondence', rows: [
      { k: 'Plan', v: `${rec.plan.title || rec.plan.id}${rec.plan.source === 'local scenario' ? ` · local scenario${rec.plan.label ? ` “${rec.plan.label}”` : ''}` : ' · source plan file'}`, state: rec.plan.source === 'local scenario' ? 'assumed' : 'source' },
      ...rec.plan.windows.map((x) => ({ k: x.room || `Window ${x.i + 1}`, v: `${x.length_m} m wide, sill ${x.sill_m} m, head ${x.head_m} m, faces ${x.faces_deg}°${x.air.ok ? '' : ' · not in open air, sun withheld'}`, state: x.air.ok ? 'source' : 'warn' })),
    ] });
  }
  return sec;
}

// ------------------------------------------------------------------ the pin (browser-local)

export const PIN_PREFIX = 'as:model-anchor:';
const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const SID = /^[A-Za-z0-9_-]{1,80}$/;

/** The validated pin fields, or null: face edge index, t in [0, 1], az in [0, 360), floor, bay flag, measured height. */
export function normalisePin(p) {
  if (!p || typeof p !== 'object') return null;
  const face = Number(p.face), t = Number(p.t), az = Number(p.az), floor = Math.round(Number(p.floor));
  if (!Number.isInteger(face) || face < 0 || face > 5000 || !(t >= 0 && t <= 1) || !(az >= 0 && az < 360) || !Number.isInteger(floor) || floor < 1 || floor > 200) return null;
  const cal = p.cal == null ? null : normaliseMeasured(p.cal);
  if (p.cal != null && !cal) return null;
  return { face, t, az, floor, bay: !!p.bay, cal };
}
/** Pin the window Unit 3D is showing so the Floor plan studio places the plan there too. Returns the record. */
export function savePin(siteId, pin, { base = 'data', storage = defaultStorage() } = {}) {
  const clean = normalisePin(pin);
  if (!SID.test(String(siteId || '')) || !clean) throw new Error('The window cannot be pinned (unknown site or invalid values)');
  if (!storage) throw new Error('Browser storage is not available');
  const rec = { schema: 1, kind: 'apartmentscout-anchor-pin', site: siteId, base: String(base).slice(0, 80), saved: new Date().toISOString(), ...clean };
  storage.setItem(PIN_PREFIX + siteId, JSON.stringify(rec));
  return rec;
}
/** The pin saved for a site (and search folder), or null. */
export function getPin(siteId, { base = null, storage = defaultStorage() } = {}) {
  if (!SID.test(String(siteId || '')) || !storage) return null;
  let rec; try { const t = storage.getItem(PIN_PREFIX + siteId); if (!t || t.length > 20000) return null; rec = JSON.parse(t); } catch { return null; }
  if (!rec || rec.schema !== 1 || rec.kind !== 'apartmentscout-anchor-pin' || rec.site !== siteId || (base != null && rec.base !== base)) return null;
  const clean = normalisePin(rec);
  return clean ? { ...clean, saved: String(rec.saved || '') } : null;
}
export function clearPin(siteId, { storage = defaultStorage() } = {}) { try { storage?.removeItem(PIN_PREFIX + siteId); } catch { /* storage unavailable */ } }
/** The placePlan option for a pin ({face, t, az, cal}) or undefined. */
export const pinOption = (pin) => (pin ? { face: pin.face, t: pin.t, az: pin.az, cal: pin.cal } : undefined);
