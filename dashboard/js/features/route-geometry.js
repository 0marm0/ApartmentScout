// Route preview geometry (pure: no DOM, no map). Turns one listing's commute legs
// (L.commute[dest].modes[mode].legs) into drawable pieces on the transit layer the map already loads:
//   - station names resolve to coordinates (a name like "50 St" exists on many lines, so the leg's route and the
//     previous point pick the right one),
//   - a subway ride follows the line's own geometry between its two stations, in the official colour,
//   - walks and transfers are straight dashed segments (the data has no street geometry),
//   - bus stops are not in the layers, so a bus journey is drawn as one honest, dotted, approximate chord.
// Coordinates are [lon, lat]. Everything here is deterministic so node tests can pin it.

export const BUS_COLOR = '#1f5fae';        // the same blue as the bus route pill on the cards
const FALLBACK_LINE = '#7c858c';
const R = 6371008.8;
const rad = Math.PI / 180;

/** Great-circle distance in metres. */
export function distM(a, b) {
  const dl = (b[1] - a[1]) * rad, dn = (b[0] - a[0]) * rad;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const pathLength = (c) => { let s = 0; for (let i = 1; i < c.length; i++) s += distM(c[i - 1], c[i]); return s; };

/** The point half way along a path (by length), plus the heading there in degrees clockwise from north. */
export function midpoint(c) {
  if (!c.length) return null;
  if (c.length === 1) return { coord: c[0], heading: 0 };
  const half = pathLength(c) / 2;
  let run = 0;
  for (let i = 1; i < c.length; i++) {
    const d = distM(c[i - 1], c[i]);
    if (run + d >= half || i === c.length - 1) {
      const t = d ? Math.min(1, Math.max(0, (half - run) / d)) : 0;
      const coord = [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t];
      const heading = (Math.atan2((c[i][0] - c[i - 1][0]) * Math.cos(c[i][1] * rad), c[i][1] - c[i - 1][1]) / rad + 360) % 360;
      return { coord, heading };
    }
    run += d;
  }
  return { coord: c[c.length - 1], heading: 0 };
}

// ------------------------------------------------------------------ the network (stations and lines)
/** Index the transit layer's features once: stations by name, and the line groups (one colour, several routes,
 *  each a MultiLineString whose parts are separate paths). */
export function buildNetwork(features = []) {
  const byName = new Map(), lines = [], color = new Map();
  for (const f of features) {
    const p = f.properties || {};
    if (p.kind === 'station' && f.geometry?.type === 'Point') {
      const s = { name: p.name, routes: p.routes || [], color: p.color, c: f.geometry.coordinates };
      (byName.get(p.name) || byName.set(p.name, []).get(p.name)).push(s);
    } else if (p.kind === 'line' && f.geometry) {
      const paths = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : f.geometry.type === 'LineString' ? [f.geometry.coordinates] : [];
      lines.push({ color: p.color, routes: p.routes || [], paths });
      for (const r of p.routes || []) color.set(r, p.color);
    }
  }
  return { byName, lines, color };
}

/** The station called `name`. When the name is shared (every "50 St"), prefer the ones that serve `route`, then the
 *  one nearest `near`. null when the name is unknown to the layer (bus stops, ferry terminals). */
export function pickStation(net, name, { route, near } = {}) {
  let c = net.byName.get(name);
  if (!c?.length) return null;
  if (route) { const r = c.filter((s) => s.routes.includes(route)); if (r.length) c = r; }
  if (c.length === 1 || !near) return c[0];
  return c.reduce((best, s) => (distM(s.c, near) < distM(best.c, near) ? s : best));
}

/** The nearest point on a path to `pt`: segment index, position along it (0..1), the point and its distance in metres.
 *  Planar maths around the path's latitude is exact enough at city scale. */
export function snapToPath(path, pt) {
  const k = Math.cos(pt[1] * rad);
  let best = null;
  for (let i = 0; i + 1 < path.length; i++) {
    const ax = path[i][0] * k, ay = path[i][1], bx = path[i + 1][0] * k, by = path[i + 1][1], px = pt[0] * k, py = pt[1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const q = [path[i][0] + (path[i + 1][0] - path[i][0]) * t, path[i][1] + (path[i + 1][1] - path[i][1]) * t];
    const d = distM(q, pt);
    if (!best || d < best.d) best = { seg: i, t, pos: i + t, point: q, d };
  }
  return best;
}

/** The stretch of `path` between two snapped points, in the direction a -> b. */
export function slicePath(path, a, b) {
  const fwd = a.pos <= b.pos, [p, q] = fwd ? [a, b] : [b, a];
  const out = [p.point, ...path.slice(p.seg + 1, q.seg + 1), q.point];
  return fwd ? out : out.reverse();
}

/** The line geometry for a ride from `a` to `b` on `route`, or null when no line of that route passes near both
 *  (the caller then draws a straight chord). A slice far longer than the straight line is a wrong branch: rejected. */
export function ridePath(net, route, a, b) {
  const groups = net.lines.filter((g) => g.routes.includes(route));
  let best = null;
  for (const g of (groups.length ? groups : net.lines)) for (const path of g.paths) {
    if (path.length < 2) continue;
    const sa = snapToPath(path, a), sb = snapToPath(path, b);
    if (!sa || !sb) continue;
    const cost = sa.d + sb.d;
    if (!best || cost < best.cost) best = { cost, path, sa, sb, g };
  }
  if (!best || best.sa.d > 350 || best.sb.d > 350) return null;
  const out = slicePath(best.path, best.sa, best.sb), straight = distM(a, b);
  if (pathLength(out) > straight * 3 + 600) return null;
  return [a, ...out.slice(1, -1), b];
}

// ------------------------------------------------------------------ one listing's route
const nextRoute = (legs, i) => { for (let j = i + 1; j < legs.length; j++) if (legs[j].route) return legs[j].route; return undefined; };
const lineColor = (net, route) => net.color.get(route) || FALLBACK_LINE;
const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

/**
 * Drawable pieces for a listing's commute.
 * @param {object} o
 * @param {Array}  o.legs     leg objects: {mode: walk|subway|bus|transfer, route, from, to, at, min, m}
 * @param {number[]} o.origin the listing [lon, lat]
 * @param {number[]|null} o.dest the destination [lon, lat]
 * @param {object} o.net      buildNetwork(...)
 * @param {number|null} o.minutes door-to-door minutes for the selected mode
 * @param {string} o.mode     'best' | 'subway' | 'bus' | 'walk'
 */
export function buildRoute({ legs, origin, dest, net, minutes = null, mode = 'best' }) {
  const lines = [], dots = [], badges = [], walks = [];
  let approx = false, transfers = 0;
  const rides = [];
  const addLine = (kind, coords, extra = {}) => { if (coords.length > 1) lines.push({ kind, coords, ...extra }); };

  if (!origin) return null;
  if (!Array.isArray(legs) || !legs.length) {
    // walking (no timetable) or a mode without legs: one straight, dashed line to the destination
    if (!dest) return null;
    addLine(mode === 'walk' ? 'walk' : 'approx', [origin, dest], { color: BUS_COLOR });
    if (mode === 'walk') walks.push({ coord: midpoint([origin, dest]).coord, min: minutes, span: [origin, dest] });
    approx = mode !== 'walk';
    return finish({ lines, dots, badges, walks, rides, transfers, approx, straight: mode === 'walk' }, { minutes, mode, origin, dest });
  }

  // 1. end point of every leg, where the layers know it (null for bus stops)
  let cur = origin;                         // last known position
  const ends = [], starts = [];
  legs.forEach((leg, i) => {
    const prevEnd = i ? ends[i - 1] : origin, near = prevEnd || cur;
    let a = prevEnd, b = null;
    if (leg.mode === 'subway') {
      const from = pickStation(net, leg.from, { route: leg.route, near }), to = from && pickStation(net, leg.to, { route: leg.route, near: from.c });
      a = from ? from.c : null; b = to ? to.c : null;
    } else if (leg.mode === 'transfer') {
      const at = pickStation(net, leg.at, { route: legs[i - 1]?.route, near }), to = leg.to ? pickStation(net, leg.to, { route: nextRoute(legs, i), near: at?.c || near }) : at;   // no `to`: changing platforms inside one station
      a = at ? at.c : prevEnd; b = to ? to.c : null;
    } else if (leg.mode === 'walk') {
      if (leg.to === 'destination' || (!leg.to && i === legs.length - 1)) b = dest || null;
      else { const s = pickStation(net, leg.to, { route: nextRoute(legs, i), near }); b = s ? s.c : null; }
      if (leg.from && leg.from !== 'destination') { const s = pickStation(net, leg.from, { route: legs[i - 1]?.route, near }); if (s) a = s.c; }
    } else { a = null; b = null; }          // bus (or anything else): unlocated
    starts[i] = a; ends[i] = b;
    if (b) cur = b;
  });

  // 2. draw: located legs as they are, unlocated runs as one dotted chord between the known points either side
  let gap = null;                          // { from, routes: [], min }
  const flush = (to) => {
    if (!gap) return;
    if (to && gap.from) {
      addLine('approx', [gap.from, to], { color: BUS_COLOR, route: gap.routes.join(' ') });
      const m = midpoint([gap.from, to]);
      badges.push({ coord: m.coord, route: gap.routes[0] || '', mode: 'bus', min: gap.min, approx: true, heading: m.heading, span: [gap.from, to] });
      approx = true;
      for (const r of gap.routes) rides.push({ route: r, mode: 'bus' });
    }
    gap = null;
  };
  legs.forEach((leg, i) => {
    const a = starts[i], b = ends[i];
    if (!a || !b) {
      const prevEnd = i ? ends[i - 1] : origin;
      if (!gap) gap = { from: a || prevEnd || origin, routes: [], min: 0 };
      if (leg.mode === 'bus' && leg.route) gap.routes.push(leg.route);
      gap.min += leg.min || 0;
      if (b) flush(b);                       // the run ends at the first leg with a known end
      return;
    }
    flush(a);
    if (leg.mode === 'subway') {
      const path = ridePath(net, leg.route, a, b);
      addLine('ride', path || [a, b], { color: lineColor(net, leg.route), route: leg.route, straight: !path });
      if (!path) approx = true;
      const m = midpoint(path || [a, b]);
      badges.push({ coord: m.coord, route: leg.route, mode: 'subway', min: leg.min, heading: m.heading, span: [a, b] });
      dots.push({ role: 'board', coord: a, color: lineColor(net, leg.route) }, { role: 'alight', coord: b, color: lineColor(net, leg.route) });
      rides.push({ route: leg.route, mode: 'subway' });
    } else if (leg.mode === 'transfer') {
      transfers++;
      if (!same(a, b)) addLine('walk', [a, b]);
      dots.push({ role: 'transfer', coord: a });
      if (!same(a, b)) dots.push({ role: 'transfer', coord: b });
    } else {                                 // walk between known points
      addLine('walk', [a, b]);
      const mid = midpoint([a, b]);
      if (leg.min != null && mid) walks.push({ coord: mid.coord, min: leg.min, lenM: distM(a, b), span: [a, b] });
    }
  });
  flush(dest || cur);
  return finish({ lines, dots, badges, walks, rides, transfers, approx, straight: false }, { minutes, mode, origin, dest });
}

function finish(r, { minutes, mode, origin, dest }) {
  const all = r.lines.flatMap((l) => l.coords);
  if (!all.length) return null;
  let w = 180, s = 90, e = -180, n = -90;
  for (const [x, y] of [...all, origin, dest].filter(Boolean)) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  // the pill sits half way along the longest connected route
  const chain = r.lines.flatMap((l, i) => (i && same(r.lines[i - 1].coords.at(-1), l.coords[0]) ? l.coords.slice(1) : l.coords));
  const mid = midpoint(chain);
  const routes = [...new Set(r.rides.map((x) => x.route).filter(Boolean))];
  const kinds = new Set(r.rides.map((x) => x.mode));
  const straight = r.straight || (!r.rides.length && r.lines.every((l) => l.kind === 'walk'));   // walking only: the line is not the street path
  return { ...r, straight, bounds: [[w, s], [e, n]],
    pill: { coord: mid?.coord || origin, minutes, mode, routes, rides: r.rides, transfers: r.transfers, approx: r.approx, straight,
      by: straight ? 'walk' : kinds.size === 1 ? [...kinds][0] : kinds.size ? 'transit' : '' } };
}

/** GeoJSON for the route source: one FeatureCollection with line pieces and station dots. Labels are DOM markers. */
export function routeGeoJSON(route) {
  const f = [];
  if (!route) return { type: 'FeatureCollection', features: f };
  route.lines.forEach((l, i) => f.push({ type: 'Feature', id: i, properties: { kind: l.kind, color: l.color || '', route: l.route || '' }, geometry: { type: 'LineString', coordinates: l.coords } }));
  route.dots.forEach((d, i) => f.push({ type: 'Feature', id: 1000 + i, properties: { kind: 'dot', role: d.role, color: d.color || '' }, geometry: { type: 'Point', coordinates: d.coord } }));
  return { type: 'FeatureCollection', features: f };
}

/** The pill's secondary line: "E → S · 1 transfer", "walk, straight line", "bus M42 · path approximate". */
export function pillDetail(p) {
  if (!p) return '';
  const parts = [];
  if (p.straight) parts.push('walk, straight line');
  else if (p.routes.length) parts.push(`${p.by === 'bus' ? 'bus ' : ''}${p.routes.join(' → ')}`);
  else if (p.by) parts.push(p.by);
  if (p.transfers) parts.push(`${p.transfers} transfer${p.transfers > 1 ? 's' : ''}`);
  if (p.approx && !p.straight) parts.push('path approximate');
  return parts.join(' · ');
}
