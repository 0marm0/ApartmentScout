// Place geometry for plain-language search, pure (no DOM, no app imports) so node can test every rule.
//
// `dashboard/data/places.json` (apartmentscout/geo/places.py) holds street polylines and park / neighbourhood polygons.
// This module indexes that file and answers the questions the search box asks of it:
//
//   sideOf(geo, street, dir, pt)      "east of 3rd Ave": is the point on that side of the street, measured against the
//                                     street's OWN direction at the nearest stretch, not the compass
//   inArea(geo, area, pt)             "in Murray Hill": inside the polygon (holes respected)
//   distToArea / distToStreet         "within 5 min walk of Bryant Park": metres to the polygon edge (0 inside) or the line
//   evalClause(geo, clause, listing)  true / false for a stored filter clause; null when the home has no coordinates
//
// A point is { lat, lon }. Everything is measured in a local flat metre frame (east, north) around the file's own
// centre, accurate to centimetres across a city. "North" in a clause is the street grid's north (Manhattan: 29 degrees
// east of true north, `grid.north_bearing`), so "north of 14th Street" means the uptown side.

export const STREET_TYPES = {
  st: 'street', str: 'street', street: 'street', ave: 'avenue', av: 'avenue', avenue: 'avenue', blvd: 'boulevard', boulevard: 'boulevard',
  rd: 'road', road: 'road', dr: 'drive', drive: 'drive', pl: 'place', place: 'place', pkwy: 'parkway', parkway: 'parkway', ln: 'lane', lane: 'lane',
  ct: 'court', court: 'court', ter: 'terrace', terrace: 'terrace', hwy: 'highway', highway: 'highway', sq: 'square', square: 'square',
  expy: 'expressway', expressway: 'expressway',
};
export const TYPE_WORDS = new Set(Object.values(STREET_TYPES));
export const ORD_WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
const DIRS = new Set(['e', 'w', 'n', 's', 'east', 'west', 'north', 'south']);
const ascii = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export const ordinal = (n) => `${n}${n % 100 >= 10 && n % 100 <= 20 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
const isNum = (t) => /^\d+(?:st|nd|rd|th)?$/.test(t) || t in ORD_WORDS;

/** "Hell's Kitchen" -> "hells kitchen" (python: places.area_key). */
export const areaKey = (s) => (ascii(s).replace(/['’‘`´]/g, '').match(/[a-z0-9]+/g) || []).join(' ');

/** "East 30th Street" -> "30th street", "Third Ave." -> "3rd avenue" (python: places.street_key). */
export function streetKey(s) {
  let toks = ascii(s).replace(/['’‘`´]/g, '').match(/[a-z0-9]+/g) || [];
  if (toks.length >= 2 && DIRS.has(toks[0]) && isNum(toks[1])) toks = toks.slice(1);
  return toks.map((t, i) => {
    if (t in ORD_WORDS) return ordinal(ORD_WORDS[t]);
    if (/^\d+$/.test(t)) return ordinal(+t);
    if (t === 'st' && i === 0 && toks.length > 1 && !(toks[1] in STREET_TYPES)) return 'saint';
    return STREET_TYPES[t] || t;
  }).join(' ');
}
export const endsWithType = (key) => TYPE_WORDS.has(key.split(' ').pop());

/** Decode places.py's "e5-delta" line: [lon0, lat0, dlon, dlat, ...] in 1e-5 degrees. */
export function decodeLine(flat) {
  const out = []; let x = 0, y = 0;
  for (let i = 0; i < flat.length; i += 2) { x = i ? x + flat[i] : flat[i]; y = i ? y + flat[i + 1] : flat[i + 1]; out.push([x / 1e5, y / 1e5]); }
  return out;
}

// ------------------------------------------------------------------ the index
/**
 * Index a places.json document. Returns null for anything that is not one.
 *   geo.streets[]      { name, keys, axis, parts: [Float64Array [x0,y0,x1,y1,...]], cls: 'avenue' | 'street' }
 *   geo.areas[]        { id, name, kind, keys, polys: [{ rings: [Float64Array...], box }] }
 *   geo.streetByKey    key -> street        geo.areaByKey  key -> { type: 'area' | 'group', ids: [area id], name }
 */
export function indexPlaces(doc) {
  if (!doc || !Array.isArray(doc.streets) || !Array.isArray(doc.areas)) return null;
  const bb = doc.bbox || [-180, -90, 180, 90];
  const lat0 = (bb[1] + bb[3]) / 2, lon0 = (bb[0] + bb[2]) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  const north = +(doc.grid?.north_bearing ?? 0);
  const xy = (pts) => { const a = new Float64Array(pts.length * 2); pts.forEach(([lo, la], i) => { a[2 * i] = (lo - lon0) * kx; a[2 * i + 1] = (la - lat0) * ky; }); return a; };
  const geo = { doc, lat0, lon0, kx, ky, north, grid: doc.grid || {}, streets: [], areas: [], streetByKey: new Map(), areaByKey: new Map(), byAreaId: new Map() };
  const nv = [Math.sin((north * Math.PI) / 180), Math.cos((north * Math.PI) / 180)];
  for (const s of doc.streets) {
    const parts = (s.lines || []).map((l) => xy(decodeLine(l)));
    const ax = ((s.axis ?? 0) * Math.PI) / 180;
    const along = Math.abs(Math.sin(ax) * nv[0] + Math.cos(ax) * nv[1]);   // 1 = runs along the grid's north-south
    const st = { name: s.name, keys: s.keys || [], axis: s.axis ?? null, parts, cls: along >= 0.5 ? 'avenue' : 'street' };
    geo.streets.push(st);
    for (const k of st.keys) if (!geo.streetByKey.has(k)) geo.streetByKey.set(k, st);
  }
  for (const a of doc.areas) {
    const polys = (a.polys || []).map((p) => {
      const rings = p.map((r) => xy(decodeLine(r)));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const o = rings[0] || [];
      for (let i = 0; i < o.length; i += 2) { x0 = Math.min(x0, o[i]); x1 = Math.max(x1, o[i]); y0 = Math.min(y0, o[i + 1]); y1 = Math.max(y1, o[i + 1]); }
      return { rings, box: [x0, y0, x1, y1] };
    });
    const ar = { id: a.id, name: a.name, kind: a.kind, keys: a.keys || [], polys };
    geo.areas.push(ar); geo.byAreaId.set(ar.id, ar);
    for (const k of ar.keys) if (!geo.areaByKey.has(k)) geo.areaByKey.set(k, { type: 'area', ids: [ar.id], name: ar.name });
  }
  for (const g of doc.groups || []) for (const k of g.keys || []) geo.areaByKey.set(k, { type: 'group', ids: g.members || [], name: g.name });
  return geo;
}

export const toXY = (geo, p) => [(p.lon - geo.lon0) * geo.kx, (p.lat - geo.lat0) * geo.ky];
const DIR_BEARING = { north: 0, east: 90, south: 180, west: 270 };
/** Unit vector (east, north metres) of a compass word on the city's own grid. */
export function dirVector(geo, dir) {
  const b = (((geo.north || 0) + DIR_BEARING[dir]) * Math.PI) / 180;
  return [Math.sin(b), Math.cos(b)];
}

// ------------------------------------------------------------------ streets
/** Nearest segment of a street to (x, y): { d, ax, ay, ux, uy } with (ux, uy) the unit direction of that segment. */
function nearestSegment(street, x, y) {
  let best = null;
  for (const a of street.parts) {
    for (let i = 0; i + 3 < a.length; i += 2) {
      const ax = a[i], ay = a[i + 1], dx = a[i + 2] - ax, dy = a[i + 3] - ay, L2 = dx * dx + dy * dy;
      if (L2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (!best || d < best.d) { const L = Math.sqrt(L2); best = { d, ax, ay, ux: dx / L, uy: dy / L }; }
    }
  }
  return best;
}
/**
 * Which side of `street` a point is on. `dir` is a grid compass word. The street's normal at the nearest stretch is
 * turned towards `dir`; the point is on that side when it lies ahead of the street along that normal. Returns
 *   +1  on the `dir` side   -1  on the other side   0  the street does not separate east from west (or north from
 *   south) there: its direction is within ~17 degrees of `dir` itself, so "north of 3rd Avenue" has no meaning.
 */
export function sideOf(geo, street, dir, pt) {
  const [x, y] = Array.isArray(pt) ? pt : toXY(geo, pt);
  const seg = nearestSegment(street, x, y);
  if (!seg) return 0;
  const u = dirVector(geo, dir);
  let nx = -seg.uy, ny = seg.ux;                       // the segment's left-hand normal
  const c = nx * u[0] + ny * u[1];
  if (Math.abs(c) < 0.3) return 0;
  if (c < 0) { nx = -nx; ny = -ny; }
  return (x - seg.ax) * nx + (y - seg.ay) * ny > 0 ? 1 : -1;
}
/** Can this street separate the given direction at all (near its middle)? */
export function separates(geo, street, dir) {
  const a = street.parts[0]; if (!a || a.length < 4) return false;
  const m = Math.floor(a.length / 4) * 2 - 2;
  const dx = a[m + 2] - a[m], dy = a[m + 3] - a[m + 1], L = Math.hypot(dx, dy) || 1, u = dirVector(geo, dir);
  return Math.abs((-dy / L) * u[0] + (dx / L) * u[1]) >= 0.3;
}
export function distToStreet(street, x, y) {
  let d = Infinity;
  for (const a of street.parts) for (let i = 0; i + 3 < a.length; i += 2) d = Math.min(d, segDist(x, y, a[i], a[i + 1], a[i + 2], a[i + 3]));
  return d;
}
function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}
/** Where a street sits along a direction, for ordering "between" streets: the mean coordinate of its vertices along `dir`. */
export function offsetAlong(geo, street, dir) {
  const u = dirVector(geo, dir); let s = 0, n = 0;
  for (const a of street.parts) for (let i = 0; i < a.length; i += 2) { s += a[i] * u[0] + a[i + 1] * u[1]; n++; }
  return n ? s / n : 0;
}

// ------------------------------------------------------------------ areas
function inRing(a, x, y) {
  let ins = false;
  for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) {
    const xi = a[i], yi = a[i + 1], xj = a[j], yj = a[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
export function inArea(area, x, y) {
  for (const p of area.polys) {
    const b = p.box;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    if (inRing(p.rings[0], x, y) && !p.rings.slice(1).some((h) => inRing(h, x, y))) return true;
  }
  return false;
}
/** Metres from a point to the nearest edge of an area (0 when inside). */
export function distToArea(area, x, y) {
  if (inArea(area, x, y)) return 0;
  let d = Infinity;
  for (const p of area.polys) {
    const b = p.box, bd = Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));
    if (bd >= d) continue;
    const a = p.rings[0];
    for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) d = Math.min(d, segDist(x, y, a[j], a[j + 1], a[i], a[i + 1]));
  }
  return d;
}

// ------------------------------------------------------------------ clauses
const DEFAULT_KMH = 4.8, DETOUR = 1.25;   // the dashboard's walking estimate (criteria.js walkRingMetres)
export const walkMetres = (minutes, kmh = DEFAULT_KMH) => (minutes * kmh * 1000) / 60 / DETOUR;
const hasPoint = (L) => Number.isFinite(L?.lat) && Number.isFinite(L?.lon);

/**
 * Evaluate a stored clause for one home. null = the home has no coordinates (the caller decides; the dashboard drops it,
 * like any other unknown fact). Clauses (all JSON, carried in S.filters.nl as `w:<id>`):
 *   { op: 'side', dir, street }                         street = the street's primary key
 *   { op: 'between', a: {dir, street}, b: {dir, street} }
 *   { op: 'in', areas: [area id] }
 *   { op: 'near', areas?: [area id], street?: key, minutes }
 */
export function evalClause(geo, c, L, { kmh = DEFAULT_KMH } = {}) {
  if (!geo || !c) return true;
  if (!hasPoint(L)) return null;
  const pt = toXY(geo, L);
  const side = (s) => { const st = geo.streetByKey.get(s.street); return st ? sideOf(geo, st, s.dir, pt) === 1 : true; };
  if (c.op === 'side') return side(c);
  if (c.op === 'between') return side(c.a) && side(c.b);
  if (c.op === 'in') return c.areas.some((id) => { const a = geo.byAreaId.get(id); return a ? inArea(a, pt[0], pt[1]) : false; });
  if (c.op === 'near') {
    const r = walkMetres(c.minutes, kmh);
    if (c.areas) return c.areas.some((id) => { const a = geo.byAreaId.get(id); return a ? distToArea(a, pt[0], pt[1]) <= r : false; });
    const st = geo.streetByKey.get(c.street); return st ? distToStreet(st, pt[0], pt[1]) <= r : true;
  }
  return true;
}

// ------------------------------------------------------------------ drawing
const toLL = (geo, a) => { const out = []; for (let i = 0; i < a.length; i += 2) out.push([+(geo.lon0 + a[i] / geo.kx).toFixed(6), +(geo.lat0 + a[i + 1] / geo.ky).toFixed(6)]); return out; };
const closed = (r) => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);

/**
 * What a clause refers to on the map, as GeoJSON features in lon/lat: the street line(s) a side or "between" clause is
 * measured against, the outline of the area(s) a neighbourhood or "near" clause means, each with a label (a Point
 * feature carries the text). Pure, so the overlay in places-map.js has nothing to decide.
 */
export function clauseGeometry(geo, c) {
  const out = [];
  const street = (key) => {
    const st = geo.streetByKey.get(key); if (!st) return;
    st.parts.forEach((p) => out.push({ type: 'Feature', properties: { kind: 'street' }, geometry: { type: 'LineString', coordinates: toLL(geo, p) } }));
    const big = st.parts.reduce((a, b) => (b.length > a.length ? b : a), st.parts[0] || []);
    if (big.length >= 4) { const m = Math.floor(big.length / 4) * 2; out.push({ type: 'Feature', properties: { kind: 'label', label: st.name }, geometry: { type: 'Point', coordinates: toLL(geo, [big[m], big[m + 1]])[0] } }); }
  };
  const area = (id) => {
    const a = geo.byAreaId.get(id); if (!a) return;
    for (const p of a.polys) out.push({ type: 'Feature', properties: { kind: 'area' }, geometry: { type: 'Polygon', coordinates: p.rings.map((r) => closed(toLL(geo, r))) } });
    const big = a.polys.reduce((x, y) => ((y.box[2] - y.box[0]) * (y.box[3] - y.box[1]) > (x.box[2] - x.box[0]) * (x.box[3] - x.box[1]) ? y : x), a.polys[0]);
    if (big) out.push({ type: 'Feature', properties: { kind: 'label', label: a.name }, geometry: { type: 'Point', coordinates: toLL(geo, [(big.box[0] + big.box[2]) / 2, (big.box[1] + big.box[3]) / 2])[0] } });
  };
  if (c.op === 'side') street(c.street);
  else if (c.op === 'between') { street(c.a.street); street(c.b.street); }
  else if (c.op === 'in') c.areas.forEach(area);
  else if (c.op === 'near') { if (c.areas) c.areas.forEach(area); else street(c.street); }
  return out;
}
