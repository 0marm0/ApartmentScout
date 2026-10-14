// Portable complete floor-plan projects. Pure validation; never changes studio state.
// Geometry keeps its source units (ft/m/in); furniture layouts always use inches.
import { normalisePlan, UNIT_IN, ROOM_KINDS, FIXTURE_KINDS } from './model.js';
import { validateLayout, serialiseLayout, MAX_BYTES } from './layout.js';

export const MAX_PROJECT_BYTES = MAX_BYTES;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const FIELDS = {
  project: 'schema kind plan layout lighting',
  plan: 'schema id title units ceiling wall up_bearing floor source provenance rooms walls windows doors open_walls fixtures keepout layouts',
  rooms: 'name kind x y w h poly stated est',
  walls: 'a b t',
  windows: 'room note x1 y1 x2 y2 a b sill head',
  doors: 'room name kind x1 y1 x2 y2 a b head hinge swing leaf',
  open_walls: 'x1 y1 x2 y2 a b',
  fixtures: 'kind label x y w h poly height elev reserve doors front note est',
  keepout: 'name x y w h poly grade',
  layouts: 'id name note items',
  provenance: 'match floor_band checked printed estimated bedroom_door_drawn wd_drawn',
  layout: 'schema kind plan units items saved',
  item: 'id ref x y rot w d h elev variant label hidden',
  lighting: 'directSun ambient',
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
function validatePlan(p) {
  object(p, 'plan');
  if (![1, 2].includes(p.schema)) fail('Plan schema must be 1 or 2');
  if (typeof p.id !== 'string' || !ID.test(p.id)) fail('Plan id must be 1-80 letters, digits, - or _');
  const k = UNIT_IN[p.units]; if (!k) fail('Plan units must be ft, m or in');
  for (const key of ['title', 'source']) if (own(p, key)) text(p[key], `plan.${key}`);
  for (const key of ['ceiling', 'wall']) if (own(p, key)) length(p[key], `plan.${key}`, k, true);
  if (own(p, 'up_bearing') && p.up_bearing !== null && (!fin(p.up_bearing) || p.up_bearing < 0 || p.up_bearing >= 360)) fail('Plan bearing must be null or 0 to less than 360');
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
      else text(v, key);
    }
  }
  if (own(p, 'layouts')) {
    array(p.layouts, 'layouts', 30);
    p.layouts.forEach((l) => {
      object(l, 'layouts');
      for (const q of ['id', 'name', 'note']) if (own(l, q)) text(l[q], q);
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
    }
    return { ok: true, project, model, layout };
  } catch (e) { return { ok: false, error: e.message || 'Invalid project' }; }
}

/** Build a validated portable object; throws on invalid geometry or layout. */
export function serialiseProject(rawPlan, items, lighting = {}) {
  // Validate original numbers before serialiseLayout rounds them (NaN must never become null).
  jsonTree({ plan: rawPlan, items, lighting });
  const r = parseProject({ schema: 1, kind: 'apartmentscout-project', plan: rawPlan, layout: serialiseLayout(rawPlan.id, items), lighting });
  if (!r.ok) fail(r.error);
  return r.project;
}
