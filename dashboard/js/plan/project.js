// Portable complete floor-plan projects. Pure validation; never changes studio state.
// Geometry keeps its source units (ft/m/in); furniture layouts always use inches.
import { normalisePlan, UNIT_IN, ROOM_KINDS, FIXTURE_KINDS } from './model.js';
import { validateLayout, serialiseLayout, MAX_BYTES } from './layout.js';
import { validateExtras } from './lighting-model.js';   // [feature J] daylight inputs and luminaires
import { finishesError } from './finishes.js';   // [finishes]
import { validateInventory } from './inventory.js';   // [furniture] the renter's own pieces travel with the project

export const MAX_PROJECT_BYTES = MAX_BYTES;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const FIELDS = {
  project: 'schema kind plan layout lighting inventory',
  plan: 'schema id title units ceiling wall up_bearing floor floor_finish finishes source provenance rooms walls windows doors open_walls fixtures keepout layouts',
  rooms: 'name kind x y w h poly stated est',
  walls: 'a b t',
  windows: 'room note x1 y1 x2 y2 a b sill head',
  doors: 'room name kind x1 y1 x2 y2 a b head hinge swing leaf',
  open_walls: 'x1 y1 x2 y2 a b',
  fixtures: 'kind label x y w h poly height elev reserve doors front note est',
  keepout: 'name x y w h poly grade',
  layouts: 'id name note items replaces',
  replaced: 'id x y rot',
  provenance: 'match floor_band checked printed estimated bedroom_door_drawn wd_drawn trace',
  trace: 'by tool mode date image page image_px origin_px scale anchors length check confidence bearing label changes',
  trace_check: 'anchors length measured error_pct',
  trace_bearing: 'method faces wall',
  layout: 'schema kind plan units items saved ver removed',
  item: 'id ref x y rot w d h elev variant label hidden placed product attach from',
  lighting: 'directSun ambient glazing blinds daylight luminaires',   // [feature J] daylight, luminaires
  inventory: 'schema kind name source pieces options',   // [furniture]
  piece: 'id ref label room w d h elev variant product look set assumed note source spec spec_basis states product_info candidate',
};
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function fail(message) { throw new Error(message); }
function object(value, type, at = type) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${at} must be a plain object`);
  const allowed = new Set(FIELDS[type].split(' '));
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${at}: unsupported field ${key}`);
}
function text(v, at, max = 600) {
  if (typeof v !== 'string' || v.length > max || /[<>\u0000-\u001f]/.test(v.replace(/[\n\r\t]/g, ''))) fail(`${at} must be plain text up to ${max} characters`);
}
function jsonTree(value, depth = 0, seen = new Set()) {
  if (depth > 12) fail('Project nesting is too deep');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') { if (!fin(value)) fail('Project numbers must be finite'); return; }
  if (!value || typeof value !== 'object') fail('Project must contain only JSON values');
  if (seen.has(value)) fail('Project contains a cycle');
  seen.add(value);
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Project must contain plain JSON objects');
  for (const k of Object.keys(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(k)) fail('Project contains an unsafe key');
    const descriptor = Object.getOwnPropertyDescriptor(value, k);
    if (!descriptor || !own(descriptor, 'value')) fail('Project cannot contain accessors');
    jsonTree(descriptor.value, depth + 1, seen);
  }
  seen.delete(value);
}
function array(v, at, limit = 200) { if (!Array.isArray(v) || v.length > limit) fail(`${at} must be a list of at most ${limit}`); }
function length(v, at, k, positive = false) {
  if (!fin(v) || Math.abs(v * k) > 5000 || (positive && v <= 0)) fail(`${at} must be ${positive ? 'positive and ' : ''}within 5000 inches`);
}
function point(p, at, k) { if (!Array.isArray(p) || p.length !== 2) fail(`${at} must be a two-number point`); p.forEach((n) => length(n, at, k)); }
function geometry(o, at, k, shape) {
  for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) if (own(o, key)) length(o[key], `${at}.${key}`, k);
  for (const key of ['w', 'h', 't', 'head', 'leaf']) if (own(o, key)) length(o[key], `${at}.${key}`, k, true);
  for (const key of ['sill', 'height', 'elev', 'reserve']) if (own(o, key)) { length(o[key], `${at}.${key}`, k); if (o[key] < 0) fail(`${at}.${key} cannot be negative`); }
  for (const key of ['a', 'b']) if (own(o, key)) point(o[key], `${at}.${key}`, k);
  if (own(o, 'poly')) { array(o.poly, `${at}.poly`, 100); if (o.poly.length < 3) fail(`${at} polygon needs 3 points`); o.poly.forEach((p) => point(p, at, k)); }
  if (shape === 'area' && !own(o, 'poly') && !['x', 'y', 'w', 'h'].every((q) => own(o, q))) fail(`${at} needs a rectangle or polygon`);
  if (shape === 'segment') {
    const a = o.a ?? [o.x1, o.y1], b = o.b ?? [o.x2, o.y2];
    point(a, at, k); point(b, at, k);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) * k < 0.5) fail(`${at} segment is too short`);
  }
  for (const [key, v] of Object.entries(o)) {
    if (['name', 'kind', 'room', 'note', 'label', 'stated', 'hinge', 'swing', 'doors', 'front', 'grade'].includes(key)) text(v, `${at}.${key}`);
    if (key === 'est' && typeof v !== 'boolean') fail(`${at}.est must be boolean`);
  }
}
function strictLayout(layout, id) {
  object(layout, 'layout');
  if (layout.kind !== 'apartmentscout-layout' || layout.plan !== id) fail('Layout must identify this exact plan');
  array(layout.items, 'layout.items', 150);
  layout.items.forEach((i) => object(i, 'item'));
  const result = validateLayout(layout, { planId: id });
  if (!result.ok) fail(result.error);
  return result.layout;
}
// provenance.trace: written by the plan tracer (plan/tracer.js). Plain numbers and short strings only.
function traceBlock(t) {
  object(t, 'trace', 'provenance.trace');
  const num = (v, at) => { if (!fin(v) || Math.abs(v) > 1e6) fail(`provenance.trace.${at} must be a finite number`); };
  const pt = (p, at) => { if (!Array.isArray(p) || p.length !== 2) fail(`provenance.trace.${at} must be a two-number point`); p.forEach((n) => num(n, at)); };
  for (const [key, v] of Object.entries(t)) {
    if (['by', 'tool', 'mode', 'date', 'image', 'confidence', 'label'].includes(key)) text(v, `provenance.trace.${key}`, 160);
    else if (['scale', 'length'].includes(key)) num(v, key);
    else if (key === 'page') { if (!Number.isInteger(v) || v < 1 || v > 9999) fail('provenance.trace.page must be a page number'); }
    else if (['image_px', 'origin_px'].includes(key)) pt(v, key);
    else if (key === 'anchors') { array(v, 'provenance.trace.anchors', 2); v.forEach((p) => pt(p, key)); }
    else if (key === 'changes') { array(v, 'provenance.trace.changes', 20); v.forEach((s) => text(s, 'provenance.trace.changes', 160)); }
    else if (key === 'check') {
      object(v, 'trace_check', 'provenance.trace.check');
      for (const [ck, cv] of Object.entries(v)) { if (ck === 'anchors') { array(cv, 'provenance.trace.check.anchors', 2); cv.forEach((p) => pt(p, 'check.anchors')); } else num(cv, `check.${ck}`); }
    } else if (key === 'bearing') {
      object(v, 'trace_bearing', 'provenance.trace.bearing');
      if (own(v, 'method')) text(v.method, 'provenance.trace.bearing.method', 20);
      if (own(v, 'wall')) text(v.wall, 'provenance.trace.bearing.wall', 60);
      if (own(v, 'faces') && (!fin(v.faces) || v.faces < 0 || v.faces >= 360)) fail('provenance.trace.bearing.faces must be 0 to less than 360');
    }
  }
}
function validatePlan(p) {
  object(p, 'plan');
  if (![1, 2].includes(p.schema)) fail('Plan schema must be 1 or 2');
  if (typeof p.id !== 'string' || !ID.test(p.id)) fail('Plan id must be 1-80 letters, digits, - or _');
  const k = UNIT_IN[p.units]; if (!k) fail('Plan units must be ft, m or in');
  for (const key of ['title', 'source']) if (own(p, key)) text(p[key], `plan.${key}`);
  for (const key of ['ceiling', 'wall']) if (own(p, key)) length(p[key], `plan.${key}`, k, true);
  if (own(p, 'up_bearing') && p.up_bearing !== null && (!fin(p.up_bearing) || p.up_bearing < 0 || p.up_bearing >= 360)) fail('Plan bearing must be null or 0 to less than 360');
  if (own(p, 'floor_finish') && p.floor_finish !== null && !['basket', 'parquet', 'oak'].includes(p.floor_finish)) fail('Floor finish must be null, basket, parquet or oak');
  if (own(p, 'finishes')) { const e = finishesError(p.finishes); if (e) fail(e); }
  if (own(p, 'floor') && p.floor !== null && (!Number.isInteger(p.floor) || p.floor < -10 || p.floor > 200)) fail('Plan floor must be null or an integer from -10 to 200');
  array(p.rooms, 'rooms', 100); if (!p.rooms.length) fail('Plan needs rooms');
  for (const type of ['rooms', 'walls', 'windows', 'doors', 'open_walls', 'fixtures', 'keepout']) {
    if (!own(p, type)) continue;
    array(p[type], type);
    for (const [i, o] of p[type].entries()) {
      const at = `${type}[${i}]`; object(o, type, at);
      geometry(o, at, k, ['rooms', 'fixtures', 'keepout'].includes(type) ? 'area' : 'segment');
      if (type === 'rooms' && o.kind && !ROOM_KINDS.includes(o.kind)) fail(`${at}: unknown room kind`);
      if (type === 'fixtures' && o.kind && !FIXTURE_KINDS.includes(o.kind)) fail(`${at}: unknown fixture kind`);
      if (type === 'windows' && (o.head ?? 84 / k) <= (o.sill ?? 24 / k)) fail(`${at}: window head must exceed sill`);
      if (['windows', 'doors'].includes(type) && own(o, 'head') && o.head > (p.ceiling ?? 108 / k)) fail(`${at}: opening head exceeds ceiling`);
      const enums = { hinge: ['a', 'b'], swing: ['+x', '-x', '+y', '-y', 'in', 'slide', 'pocket', 'none'], front: ['+x', '-x', '+y', '-y'], grade: ['tight', 'blocked'], doors: ['hinged', 'bifold', 'sliding', 'none', 'open'] };
      for (const [key, values] of Object.entries(enums)) if (own(o, key) && !values.includes(o[key])) fail(`${at}: unsupported ${key}`);
    }
  }
  if (p.provenance) {
    object(p.provenance, 'provenance');
    for (const [key, v] of Object.entries(p.provenance)) {
      if (['printed', 'estimated'].includes(key)) { array(v, key, 20); v.forEach((s) => text(s, key)); }
      else if (['bedroom_door_drawn', 'wd_drawn'].includes(key)) { if (v !== null && typeof v !== 'boolean') fail(`${key} must be boolean or null`); }
      else if (key === 'trace') traceBlock(v);
      else text(v, key);
    }
  }
  if (own(p, 'layouts')) {
    array(p.layouts, 'layouts', 30);
    p.layouts.forEach((l) => {
      object(l, 'layouts');
      for (const q of ['id', 'name', 'note']) if (own(l, q)) text(l[q], q);
      if (own(l, 'replaces')) {   // [placement] where an earlier default put each piece, in the plan's units: a saved layout still holding those is an untouched copy of it
        array(l.replaces, 'replaces', 20);
        l.replaces.forEach((set) => { array(set, 'replaces set', 150); set.forEach((q) => { object(q, 'replaced'); if (typeof q.id !== 'string' || !ID.test(q.id) || ![q.x, q.y].every(fin) || (own(q, 'rot') && !fin(q.rot))) fail('replaces entries need an id, x and y'); length(q.x, 'replaces.x', k); length(q.y, 'replaces.y', k); }); });
      }
      array(l.items, 'preset items', 150);
      l.items.forEach((i, j) => {
        object(i, 'item');
        // Preset positions use source geometry units; validate before the normaliser can coerce or omit them.
        const item = { ...i, id: i.id ?? `${i.ref}-${j + 1}`, x: fin(i.x) ? i.x * k : i.x, y: fin(i.y) ? i.y * k : i.y };
        strictLayout({ schema: 1, kind: 'apartmentscout-layout', plan: p.id, units: 'in', items: [item] }, p.id);
      });
    });
  }
  const m = normalisePlan(p);
  if (m.warnings.length || !fin(m.area) || m.area <= 0 || m.rooms.some((r) => r.area <= 0)) fail('Plan contains unusable geometry');
  for (const preset of m.layouts) strictLayout({ schema: 1, kind: 'apartmentscout-layout', plan: p.id, units: 'in', items: preset.items }, p.id);
  return m;
}

/** Return a detached project and model, or a failure, before the caller changes state. */
export function parseProject(input, { planId = null } = {}) {
  try {
    if (typeof input === 'string' && new TextEncoder().encode(input).length > MAX_PROJECT_BYTES) fail('Project is larger than 1 MB');
    const obj = typeof input === 'string' ? JSON.parse(input) : input;
    jsonTree(obj);
    const encoded = JSON.stringify(obj);
    if (new TextEncoder().encode(encoded).length > MAX_PROJECT_BYTES) fail('Project is larger than 1 MB');
    const project = JSON.parse(encoded); object(project, 'project');
    if (project.schema !== 1 || project.kind !== 'apartmentscout-project') fail('Unsupported project format (expected apartmentscout-project schema 1)');
    const model = validatePlan(project.plan);
    if (planId && project.plan.id !== planId) fail(`Project is for plan ${project.plan.id}, not ${planId}`);
    const layout = strictLayout(project.layout, project.plan.id);
    project.layout = layout;
    if (own(project, 'lighting')) {
      object(project.lighting, 'lighting');
      const l = project.lighting;
      if (own(l, 'directSun') && typeof l.directSun !== 'boolean') fail('lighting.directSun must be boolean');
      if (own(l, 'ambient') && (!fin(l.ambient) || l.ambient < 0 || l.ambient > 2)) fail('lighting.ambient must be from 0 to 2 (display only)');
      if (own(l, 'glazing') && (!fin(l.glazing) || l.glazing < 0.05 || l.glazing > 1)) fail('lighting.glazing must be a transmittance from 0.05 to 1 (preview only)');
      if (own(l, 'blinds') && !['open', 'sheer', 'half', 'closed'].includes(l.blinds)) fail('lighting.blinds must be open, sheer, half or closed');
      try { validateExtras(l); } catch (e) { fail(e.message); }   // [feature J]
    }
    if (own(project, 'inventory')) {   // [furniture] strict like the layout: plain objects, known fields, then the inventory's own checks
      object(project.inventory, 'inventory'); array(project.inventory.pieces, 'inventory.pieces', 60);
      project.inventory.pieces.forEach((q, i) => object(q, 'piece', `inventory.pieces[${i}]`));
      const inv = validateInventory(project.inventory);
      if (!inv.ok) fail(inv.error);
      project.inventory = inv.inventory;
    }
    return { ok: true, project, model, layout, inventory: project.inventory || null };
  } catch (e) { return { ok: false, error: e.message || 'Invalid project' }; }
}

/** Build a validated portable object; throws on invalid geometry or layout. */
export function serialiseProject(rawPlan, items, lighting = {}, inventory = null, { removed = [] } = {}) {
  // Validate original numbers before serialiseLayout rounds them (NaN must never become null).
  jsonTree({ plan: rawPlan, items, lighting, inventory });
  const r = parseProject({ schema: 1, kind: 'apartmentscout-project', plan: rawPlan, layout: serialiseLayout(rawPlan.id, items, { removed }), lighting, ...(inventory?.pieces?.length ? { inventory } : {}) });
  if (!r.ok) fail(r.error);
  return r.project;
}
