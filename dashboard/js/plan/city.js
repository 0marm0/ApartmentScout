// The floor plan in its city: where each plan window sits on the real facade, the skyline seen from each
// window (so only the windows a neighbour actually blocks lose their sun), and the nearby buildings as an
// optional "City outside" layer around the apartment (built by plan/citymesh.js). Pure geometry: no DOM, no three.js.
// Frames: plan inches (+x right, +y toward the facade / up_bearing); site metres (x east, y north);
// plan-metre three.js frame (x = plan x, z = -plan y, y up from the apartment floor).
import { DEG, prepBuildings, facesOf, horizonProfile, angDiff, hAt, snapOpen, litInfo, dayTable, insideBuilding } from '../sun.js';
import { canonicalFaces, snapPosition } from '../unit/scenario.js';
import { effectiveComponents } from '../unit/parts.js';           // [model project] components + the assumed override
import { resolveCal, geoFromSite, measuredFromSite } from '../unit/calibration.js';   // [model project] measured vs estimated height
import { windowOpenAir } from '../unit/openair.js';              // [model project] open-air check, no silent host bypass

const M = 0.0254;

/**
 * Where the plan meets the facade: the windows that face the plan's "up" (the facade), the centre of
 * their span and the window-wall line. Everything else is placed relative to that point.
 */
export function planFrame(model) {
  const front = model.windows.filter((w) => w.normal && w.normal[1] > 0.7);
  const ws = front.length ? front : model.windows;
  const b = model.bounds;
  if (!ws.length) return { xc: (b.x0 + b.x1) / 2, yw: b.y1, front: [] };
  const xs = ws.flatMap((w) => [w.a[0], w.b[0]]);
  return { xc: (Math.min(...xs) + Math.max(...xs)) / 2, yw: ws.reduce((s, w) => s + w.mid[1], 0) / ws.length, front: ws };
}

/**
 * Place the plan on its site: the open facade nearest the plan's up bearing, the window position along it,
 * the slab height of the plan's floor. Returns null when the site has no usable open facade.
 * ctx: {B, T, ti, face, az, anchor:[x,y] (window-wall line), slab, fh, frame, toSite(p), toPlanM([x,y]), green, water, streets (site.green / site.water / site.streets or null)}
 * `opts.anchor` ({face, t, az, cal}) is the pinned window from Unit 3D (unit/anchor.js): the same facade, position,
 * facing and measured height, so both viewers put the plan in the same place. `opts.parts` overrides the assumed parts.
 */
export function placePlan(site, model, floor, opts = {}) {
  if (!site?.b?.length || !site.b[site.target]) return null;
  const B = prepBuildings(site.b, site.holes && typeof site.holes === 'object' ? site.holes : null, effectiveComponents(site, opts.parts !== undefined ? { override: opts.parts } : {})), T = B[site.target] || B[0];
  const F = canonicalFaces(facesOf(T, 8, B), site.faces || [], site.version), pool = F.filter((f) => !f.shared);
  if (!pool.length) return null;
  const want = model.up_bearing ?? site.window?.bearing ?? 180;
  // the site file's own window facade wins when it points the way the plan does (two facades can share a bearing:
  // a long wall with a step in it), so Unit 3D and the Floor plan put the window on the same wall
  const own = pool.find((f) => f.i === site.window?.face);
  const pin = opts.anchor && typeof opts.anchor === 'object' ? opts.anchor : null, pinned = pin ? pool.find((f) => f.i === pin.face) : null;
  const face = pinned || (own && Math.abs(angDiff(own.bearing, want)) <= 15 ? own : pool.reduce((best, f) => (Math.abs(angDiff(f.bearing, want)) < Math.abs(angDiff(best.bearing, want)) - 0.5 || (Math.abs(Math.abs(angDiff(f.bearing, want)) - Math.abs(angDiff(best.bearing, want))) <= 0.5 && f.length > best.length) ? f : best), pool[0]));
  const t = snapPosition(face, pinned && Number.isFinite(pin.t) ? pin.t : face.i === site.window?.face ? site.window?.t ?? 0.5 : 0.5, snapOpen) ?? 0.5;
  const az = pinned && Number.isFinite(pin.az) ? pin.az : face.bearing, ux = Math.sin(az * DEG), uy = Math.cos(az * DEG); // outward (plan +y)
  const rx = Math.cos(az * DEG), ry = -Math.sin(az * DEG); // plan +x (to the right looking out)
  const fx = face.a[0] + (face.b[0] - face.a[0]) * t, fy = face.a[1] + (face.b[1] - face.a[1]) * t;
  const anchor = [fx - ux * 0.15, fy - uy * 0.15];
  // the vertical datum: a measurement (the pinned one, else the site file's) replaces the floor-count estimate
  const cal = resolveCal(geoFromSite(site, T.g), pin && Object.hasOwn(pin, 'cal') ? pin.cal : measuredFromSite(site)), fh = cal.fh;
  const slab = cal.slabAt(floor || 5);
  const frame = planFrame(model);
  const toSite = (p) => { const dx = (p[0] - frame.xc) * M, dy = (p[1] - frame.yw) * M; return [anchor[0] + rx * dx + ux * dy, anchor[1] + ry * dx + uy * dy]; };
  const toPlanM = (q) => { const dx = q[0] - anchor[0], dy = q[1] - anchor[1]; return [dx * rx + dy * ry + frame.xc * M, dx * ux + dy * uy + frame.yw * M]; };
  return { B, T, ti: B.indexOf(T), face, t, az, ux, uy, rx, ry, anchor, slab, fh, cal, pinned: !!pinned, floor: floor || 5, frame, toSite, toPlanM, green: site.green || null, water: site.water || null, streets: Array.isArray(site.streets) ? site.streets : null };   // [city context] water and streets for unit/context3d.js
}

/**
 * One skyline per plan window: the window centre mapped onto the facade, 0.4 m outside the glass, at eye
 * level (1.6 m) on the plan's floor. Returns [{i, x, y, z, prof, inside}] aligned with model.windows.
 */
export function windowSkylines(ctx, model) {
  return model.windows.map((w, i) => {
    const [mx, my] = ctx.toSite(w.mid);
    const nx = ctx.rx * w.normal[0] + ctx.ux * w.normal[1], ny = ctx.ry * w.normal[0] + ctx.uy * w.normal[1];
    const x = mx + nx * 0.4, y = my + ny * 0.4, z = ctx.slab + 1.6;
    const inside = insideBuilding(ctx.T, x, y); // a window mapped past the end of the facade
    // [model project] the air outside the glass must be open at the window's own heights. A window that maps into its
    // host (or a neighbour) is not a window: its skyline keeps the host's walls (no silent bypass) and sun is withheld.
    const air = windowOpenAir(ctx.B, ctx.ti, mx, my, (Math.atan2(nx, ny) / DEG + 360) % 360, ctx.slab + w.sill * M, ctx.slab + w.head * M);
    return { i, x, y, z, inside, air, prof: horizonProfile(ctx.B, x, y, z, -1) };
  });
}
/** True when window k has no valid observation point (its outside is not open air): no sun or sky conclusion may be drawn from it. */
export const windowWithheld = (sk, k) => !!sk?.[k] && sk[k].air?.ok === false;

/** True when the sun at (az, alt) is below window k's skyline. */
export const windowBlocked = (sk, k, s) => !!sk?.[k] && s.alt > 0 && (windowWithheld(sk, k) || s.alt <= hAt(sk[k].prof, s.az));

/** Direct-sun minutes today for each window (its own skyline and bearing). */
export function windowMinutes(sk, model, y, mo, d, lat, lon, tz) {
  const tab = dayTable(y, mo, d, lat, lon, tz, 6);
  return model.windows.map((w, i) => (sk?.[i] && !windowWithheld(sk, i) ? litInfo(tab, sk[i].prof, w.bearing, 6).min : null));
}
