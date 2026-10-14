// Architectural scenario edits. UI inputs are inches; saved geometry retains its original units.
// These are user assumptions, never newly verified measurements. Source objects are not changed.
import { parseProject, serialiseProject } from './project.js';

const NOTE = 'User scenario: architecture adjusted in the studio; dimensions are unverified.';
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function amount(v, key, zero = false, coordinate = false) {
  if (!finite(v) || Math.abs(v) > 5000 || (!coordinate && (zero ? v < 0 : v <= 0))) throw new Error(`${key} must be ${coordinate ? 'a coordinate within ±5000' : zero ? 'from 0 to 5000' : 'positive and at most 5000'} inches`);
}
function patch(p, allowed) {
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.getPrototypeOf(p) !== Object.prototype) throw new Error('Edit must be a plain object');
  for (const key of Object.keys(p)) {
    if (!allowed.includes(key)) throw new Error(`Unsupported edit field ${key}`);
    const d = Object.getOwnPropertyDescriptor(p, key);
    if (!d || !own(d, 'value')) throw new Error('Edit cannot contain accessors');
    amount(d.value, key, ['reserve', 'sill'].includes(key), ['x', 'y'].includes(key));
  }
}
function begin(raw) {
  const project = serialiseProject(raw, []);
  const parsed = parseProject(project);
  if (!parsed.ok) throw new Error(parsed.error);
  return { raw: parsed.project.plan, model: parsed.model, k: parsed.model.k };
}
function at(list, index, kind) {
  if (!Number.isInteger(index) || index < 0 || !Array.isArray(list) || index >= list.length) throw new Error(`No ${kind} at that index`);
  return list[index];
}
function finish(raw, descriptor) {
  const provenance = raw.provenance ?? {};
  const estimated = [...(provenance.estimated ?? [])];
  const note = `${descriptor}: user scenario, not measured`;
  if (!estimated.includes(note)) {
    if (estimated.length >= 20) throw new Error('Provenance already has 20 assumptions; preserve them before adding an edit');
    estimated.push(note);
  }
  raw.provenance = { ...provenance, estimated };
  // Keep source, provenance.match, source dates and original notes unchanged.
  const parsed = parseProject(serialiseProject(raw, []));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.project.plan;
}

/** Edit a rectangle or polygon fixture; x/y refer to its lower bounding-box corner, in inches. */
export function editFixture(source, index, changes) {
  patch(changes, ['width', 'depth', 'height', 'reserve', 'x', 'y']);
  const { raw, model, k } = begin(source);
  const f = at(raw.fixtures, index, 'fixture'), normalized = at(model.fixtures, index, 'fixture');
  const xs = normalized.poly.map((p) => p[0]), ys = normalized.poly.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), width = Math.max(...xs) - x0, depth = Math.max(...ys) - y0;
  if (width <= 0 || depth <= 0) throw new Error('Fixture needs nonzero width and depth');
  const w = changes.width ?? width, d = changes.depth ?? depth, x = changes.x ?? x0, y = changes.y ?? y0;
  if (f.poly) f.poly = normalized.poly.map(([px, py]) => [(x + (px - x0) * w / width) / k, (y + (py - y0) * d / depth) / k]);
  else Object.assign(f, { x: x / k, y: y / k, w: w / k, h: d / k });
  if (own(changes, 'height')) {
    if (changes.height > model.ceiling) throw new Error('Fixture height exceeds the ceiling');
    f.height = changes.height / k;
  }
  if (own(changes, 'reserve')) f.reserve = changes.reserve / k;
  f.est = true;
  return finish(raw, `Fixture ${index + 1}`);
}

/** Change opening width from its existing first endpoint along its existing direction. */
export function editWindow(source, index, changes) {
  patch(changes, ['width', 'sill', 'head']);
  const { raw, model, k } = begin(source), w = at(raw.windows, index, 'window');
  const old = at(model.windows, index, 'window');
  if (own(changes, 'width')) {
    const dx = old.b[0] - old.a[0], dy = old.b[1] - old.a[1], length = Math.hypot(dx, dy);
    const end = [(old.a[0] + dx / length * changes.width) / k, (old.a[1] + dy / length * changes.width) / k];
    if (w.a && w.b) w.b = end;
    else Object.assign(w, { x2: end[0], y2: end[1] });
  }
  const sill = changes.sill ?? old.sill, head = changes.head ?? old.head;
  if (sill >= head || head > model.ceiling) throw new Error('Window must have sill < head <= ceiling');
  if (own(changes, 'sill')) w.sill = sill / k;
  if (own(changes, 'head')) w.head = head / k;
  return finish(raw, `Window ${index + 1}`);
}

/** Compass direction of drawing +y, degrees clockwise from north. */
export function editOrientation(source, bearing) {
  if (!finite(bearing) || bearing < 0 || bearing >= 360) throw new Error('Orientation must be from 0 to less than 360 degrees');
  const { raw } = begin(source);
  raw.up_bearing = bearing;
  return finish(raw, 'Orientation');
}

export const ARCHITECTURE_SCENARIO_NOTE = NOTE;
