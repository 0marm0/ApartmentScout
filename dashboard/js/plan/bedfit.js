// "Will this bed fit?": the studio's fit checks put into plain words for a bed that is wider than the bed under it, such as the Latitude Run
// storage bed with its 94 in headboard unit, side towers, floating nightstands and side drawers. Pure (no DOM, no three.js), so node:test
// covers it and the studio and Unit 3D print the same sentences.
//
// Each row is one question the renter asked, answered with a number, a grade (clear, tight, blocked) and a sentence like "fits: 22 in to spare on
// the left, 8 in on the right" or "blocks the closet door by 4 in":
//   wall      does the headboard unit fit between the corners, windows and doors of its wall
//   walk      the bed's length against the walkway to the TV wall and the chest
//   drawers   the side drawers' pull-out room, each side
//   doors     the swing of every door of the room and the way in to the closet
//   windows   the window sill and the glass beside the towers
//   heat      radiators and the heating or cooling units
//   other     anything else the studio's checks flag for the piece
// "Left" and "right" are the person's own, lying in the bed with their head on the headboard: the side the windows are on is the right
// (plan/placement.js's rule for the renter's own bed).
import { pointInPoly, segDist } from './model.js';
import { axes, toWorld, partPolys, obstacles, evaluate, measureZone, zoneGeom, swingPoly, doorwayPoly, doorName, rayPoly, satDepth, findSpot, roomOf, worst } from './checks.js';
import { CLEARANCE, resolve } from './catalog.js';
import { applyInventory } from './placement.js';
import { applyChoice } from './choices.js';
import { dimsOf } from './bedspec.js';

const inch = (v) => `${Math.round(v)} in`;
const dotp = (a, b) => a[0] * b[0] + a[1] * b[1];
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const FACE_SAMPLES = 7;
const the = (label) => (/^(a|an|the) /i.test(label) ? label : `the ${label}`);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** Which way (as a person lying in the bed would say it) a world direction `u` lies: 'right' or 'left'. */
export function sideOf(bed, u) {
  const f = axes(bed.rot).b, front = [-f[0], -f[1]], right = [front[1], -front[0]];
  return dotp(u, right) >= 0 ? 'right' : 'left';
}
/** The compass name of a world direction when the plan says which way its drawing faces, else null. */
export function compassOf(model, u) {
  if (model.up_bearing == null) return null;
  const brg = (((model.up_bearing + (Math.atan2(u[0], u[1]) * 180) / Math.PI) % 360) + 360) % 360;
  return COMPASS[Math.round(brg / 45) % 8];
}

/** Shortest distance between two convex polygons (0 when they touch or overlap). */
export function polyGap(A, B) {
  if (satDepth(A, B) > 0) return 0;
  let best = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) for (const p of P) for (let i = 0; i < Q.length; i++) best = Math.min(best, segDist(p, Q[i], Q[(i + 1) % Q.length]));
  return best;
}

/** The nearest obstacle in front of a point along a direction: {t, label}. */
function nearestAhead(from, u, obs, max = 240) {
  let best = { t: max, label: null };
  for (const o of obs) { const t = rayPoly(from, u, o.poly, best.t); if (t < best.t) best = { t, label: o.label }; }
  return best;
}
function distToRoom(p, poly) {
  if (pointInPoly(p, poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

/**
 * The questions about a bed with towers, answered for where it stands now. `items` are resolved items with the bed visible (and the pieces
 * it replaces hidden); the bed is the one called `id`.
 * @returns {{id: string, fits: boolean, grade: 'clear'|'tight'|'blocked', rows: {key: string, label: string, grade: string, text: string}[], summary: string, wall: object}|null}
 */
export function bedFit(model, items, id = 'bed-latitude') {
  const bed = items.find((x) => x.id === id && !x.hidden), g = bed && dimsOf(bed.spec);
  if (!bed || !g) return null;
  const others = items.filter((x) => x.id !== id && !x.hidden), obs = obstacles(model, others), ev = evaluate(model, [...others, bed]);
  const { r, b } = axes(bed.rot), front = [-b[0], -b[1]], right = [front[1], -front[0]], left = [-right[0], -right[1]], rows = [];
  const hw = bed.w / 2, hd = bed.d / 2, parts = partPolys(bed), room = roomOf(model, [bed.x, bed.y]), back0 = toWorld(bed, 0, hd);

  // ---- the wall: from each end of the headboard unit along the wall to the nearest corner, piece or window
  const solid = obs.filter((o) => (o.type !== 'item' ? o.z0 < g.H && o.z1 > 1 : o.z1 > g.stand.bottom && o.z0 < g.H));
  const along = (dir) => {   // the person's side `dir` (a unit vector along the wall): free distance past the end of the unit
    const end = dotp(dir, r) > 0 ? hw : -hw, hit = { t: 400, label: null };
    for (const s of [2.5, g.head.towerDepth * 0.6, 10]) {
      const n = nearestAhead(toWorld(bed, end + (end > 0 ? 0.05 : -0.05), hd - s), dir, solid, 400);
      if (n.t < hit.t) { hit.t = n.t; hit.label = n.label; }
    }
    let win = null;
    for (const w of model.windows) {
      if (Math.abs(dotp([w.mid[0] - back0[0], w.mid[1] - back0[1]], b)) > model.wallT + 3) continue;   // not on the headboard's wall
      const u0 = dotp([w.a[0] - bed.x, w.a[1] - bed.y], dir), u1 = dotp([w.b[0] - bed.x, w.b[1] - bed.y], dir);
      if (Math.max(u0, u1) < hw - 0.01) continue;                                // the glass ends behind this end of the unit
      const gap = Math.min(u0, u1) - hw;                                          // negative: the tower stands in front of the glass
      if (g.H > w.sill && (!win || gap < win.gap)) win = { gap, sill: w.sill };
    }
    const byWindow = win && win.gap < hit.t;
    return { gap: byWindow ? win.gap : hit.t, what: byWindow ? 'the window' : hit.t >= 400 ? 'open space' : /wall/i.test(hit.label || '') ? 'the wall' : the(hit.label || 'the wall'), win };
  };
  const L = along(left), Rt = along(right), spare = (l) => (l.gap >= 0 ? `${inch(l.gap)} to spare` : `${inch(-l.gap)} short`);
  const wallGrade = L.gap < -0.5 || Rt.gap < -0.5 ? 'blocked' : L.gap < 2 || Rt.gap < 2 ? 'tight' : 'clear';
  const tooShort = L.gap < Rt.gap ? ['left', L] : ['right', Rt];
  rows.push({
    key: 'wall', label: 'Wall for the headboard', short: 'the wall', grade: wallGrade, left: L.gap, right: Rt.gap,
    text: wallGrade === 'blocked' ? `Does not fit this wall: the ${inch(bed.w)} headboard unit is ${spare(tooShort[1])} on the ${tooShort[0]}, where ${tooShort[1].what} is in the way.`
      : `${wallGrade === 'tight' ? 'Fits, tightly' : 'Fits'}: the ${inch(bed.w)} headboard unit has ${spare(L)} on the left (to ${L.what}) and ${spare(Rt)} on the right (to ${Rt.what}).`,
  });

  // ---- length: from the foot to whatever stands in front of it (a chest, the TV wall)
  const lowObs = obs.filter((o) => o.z0 < 30 && o.z1 > 0.5);
  const foot = [...Array(FACE_SAMPLES)].map((_, i) => nearestAhead(toWorld(bed, -g.frame.w / 2 + 2 + ((g.frame.w - 4) * i) / (FACE_SAMPLES - 1), -hd - 0.05), front, lowObs)).sort((a, c) => a.t - c.t)[0];
  const wMin = CLEARANCE.walkway.min, wPref = CLEARANCE.walkway.preferred, wg = foot.t >= wPref - 0.5 ? 'clear' : foot.t >= wMin - 0.5 ? 'tight' : 'blocked';
  const ahead = foot.label ? the(foot.label) : 'the far wall';
  rows.push({
    key: 'walk', label: 'Length and the walk to the TV wall', short: 'the walk to the TV wall', grade: wg, free: foot.t,
    text: `The bed runs ${inch(bed.d)} out from the wall, which leaves ${inch(foot.t)} from its foot to ${ahead}: ${wg === 'clear' ? `fits (a main walkway needs ${wMin} in and is comfortable at ${wPref})` : wg === 'tight' ? `fits, but under the ${wPref} in that is comfortable (${wMin} in is the minimum)` : `blocks the walkway, which needs ${wMin} in`}.`,
  });

  // ---- drawers on each side: measured out to 90 in, then judged against what they need
  const dr = bed.zones.filter((z) => z.key === 'drawer_pull').map((z) => {
    const m = measureZone(bed, { ...z, preferred: 90 }, obs, { ignoreKinds: bed.ignore });
    return { side: sideOf(bed, zoneGeom(bed, z).u), free: m.free, need: z.preferred, min: z.min, grade: m.free >= z.preferred - 0.5 ? 'clear' : m.free >= z.min - 0.5 ? 'tight' : 'blocked', blocker: m.blocker?.label || null, poly: zoneGeom(bed, z, g.drawers.pull).poly };
  }).sort((a, c) => (a.side === 'left' ? -1 : 1) - (c.side === 'left' ? -1 : 1));
  const dGrade = dr.reduce((a, x) => worst(a, x.grade), 'clear'), shown = (x) => (x.free >= 60 ? '60+ in' : inch(x.free));
  rows.push({
    key: 'drawers', label: 'Side drawers pull out', short: 'the side drawers', grade: dGrade, sides: Object.fromEntries(dr.map((x) => [x.side, x.free])), need: dr[0]?.need,
    text: `The four drawers pull out ${inch(g.drawers.pull)} and want about ${dr[0]?.need ?? g.drawers.pull + 14} in to open and stand at: ${dr.map((x) => `${x.side} side ${shown(x)} free${x.free < 60 && x.blocker ? ` to ${the(x.blocker)}` : ''}`).join(', ')}. ${dGrade === 'clear' ? 'Both sides open fully.' : dGrade === 'tight' ? 'They open, but there is little room to stand.' : `${dr.filter((x) => x.grade === 'blocked').map((x) => `the ${x.side} drawers cannot open fully`).join(' and ')}.`}`,
  });

  // ---- doors: the swing of each door of the room against the bed, and the way in to a closet, also with a drawer pulled out
  const doorRows = [];
  for (const d of model.doorways) {
    const here = model.rooms.some((rm) => rm.name === room && [d.a, d.b, d.mid].some((p) => distToRoom(p, rm.poly) <= model.wallT + 2));
    if (!here) continue;
    const name = doorName(d, model), sw = swingPoly(d), approach = doorwayPoly(d, 30), low = parts.filter((p) => p.z0 < 80);
    const closet = /closet/i.test(name) || /closet/i.test(d.room || '');
    const pen = sw ? Math.max(0, ...low.map((p) => satDepth(p.poly, sw))) : 0, apGap = Math.min(...low.map((p) => polyGap(p.poly, approach))), swGap = sw ? Math.min(...low.map((p) => polyGap(p.poly, sw))) : Infinity;
    const gap = closet ? apGap : Math.min(swGap, apGap);
    const open = dr.map((x) => ({ side: x.side, hit: satDepth(x.poly, approach) })).filter((x) => x.hit > 0.5);
    const grade = pen > 0.5 ? 'blocked' : gap < 6 ? 'tight' : 'clear';
    let text = pen > 0.5 ? `blocks the ${name} by ${inch(pen)}` : `${closet ? 'the way in to' : 'the swing of'} the ${name} clears the bed by ${inch(gap)}`;
    if (closet && open.length && pen <= 0.5) text += `; a ${open.map((x) => x.side).join(' or ')} drawer pulled right out reaches ${inch(Math.max(...open.map((x) => x.hit)))} into its 30 in approach, so keep it shut when you go in`;
    doorRows.push({ name, grade, gap, pen, closet, text });
  }
  const dg = doorRows.reduce((a, x) => worst(a, x.grade), 'clear');
  rows.push({ key: 'doors', label: 'Doors and the closet', short: 'the doors', grade: dg, doors: doorRows, text: doorRows.length ? `${doorRows.map((x) => x.text).join('; ')}.` : 'No door of this room is near the bed.' });

  // ---- windows on the headboard's wall
  const wins = [['left', L], ['right', Rt]].filter(([, l]) => l.win);
  const winGrade = wins.reduce((a, [, l]) => worst(a, l.gap < -0.5 ? 'blocked' : l.gap < 2 ? 'tight' : 'clear'), 'clear');
  rows.push({
    key: 'windows', label: 'Window sill and glass', short: 'the window', grade: winGrade,
    text: wins.length ? `${wins.map(([sd, l]) => `the window on the ${sd} starts ${l.gap >= 0 ? `${inch(l.gap)} past the ${sd} tower` : `${inch(-l.gap)} in from the end of the ${sd} tower, so the tower would stand in front of the glass`} (sill ${inch(l.win.sill)}; the towers rise ${inch(g.H)})`).join('; ')}.`.replace(/^t/, 'T') : `No window on the headboard's wall: the towers rise ${inch(g.H)} without covering any glass.`,
  });

  // ---- radiators and heating or cooling units of this room
  const heat = model.fixtures.filter((f) => ['ac', 'ptac', 'radiator'].includes(f.kind) && (!f.room || f.room === room)).map((f) => {
    const hi = parts.filter((p) => p.z0 < f.elev + f.height + 12), gapUnit = Math.min(...hi.map((p) => polyGap(p.poly, f.poly))), gapZone = f.reservePoly ? Math.min(...hi.map((p) => polyGap(p.poly, f.reservePoly))) : Infinity;
    return { label: f.label || f.kind, kind: f.kind, gap: gapUnit, zone: gapZone, reserve: f.reserve, est: f.est, grade: f.reservePoly && gapZone <= 0.5 ? (f.kind === 'radiator' ? 'blocked' : 'tight') : gapUnit < 4 ? 'tight' : 'clear' };
  }).sort((a, c) => a.gap - c.gap);
  const hg = heat.reduce((a, x) => worst(a, x.grade), 'clear'), hasRad = model.fixtures.some((f) => f.kind === 'radiator');
  rows.push({
    key: 'heat', label: 'Radiator and HVAC', short: 'the heating', grade: hg, heat,
    text: `${heat.length ? `The ${heat.map((x) => `${x.label} is ${inch(x.gap)} from the bed${x.reserve ? (x.zone <= 0.5 ? ' and the bed stands in its clearance' : `, and the ${x.reserve} in in front of it is clear`) : ''}${x.est ? ' (its size and place are estimated on the plan)' : ''}`).join('; ')}` : 'No heating or cooling unit in this room on the plan'}${hasRad ? '' : '; the plan has no radiator'}.`,
  });

  // ---- whatever else the studio's checks flag for the piece (an overlap, a run-in with a wall), once
  const seen = new Set(), other = (ev.items[id]?.issues || []).filter((i) => !['zone', 'door', 'doorway'].includes(i.code)).filter((i) => !seen.has(i.text) && seen.add(i.text));
  if (other.length) rows.push({ key: 'other', label: 'Other checks', short: 'other checks', grade: other.reduce((a, i) => worst(a, i.grade), 'clear'), text: `${other.map((i) => i.text).join('; ')}.` });

  const grade = rows.reduce((a, x) => worst(a, x.grade), 'clear'), fits = grade !== 'blocked', tight = rows.filter((x) => x.grade === 'tight');
  const summary = !fits ? `Does not fit as placed: ${rows.filter((x) => x.grade === 'blocked').map((x) => x.short).join(', ')}.`
    : `Fits: the ${inch(bed.w)} headboard unit has ${spare(L)} on the left and ${spare(Rt)} on the right${tight.length ? `; tight: ${tight.map((x) => x.short).join(', ')}` : ''}.`;
  const name = compassOf(model, b);
  for (const x of rows) x.text = cap(x.text);
  return { id, fits, grade, rows, summary, wall: { name: name ? `the ${name} wall` : 'its wall', left: L.gap, right: Rt.gap } };
}

/**
 * Where else could the bed go when it does not fit as placed? Two answers, both only suggestions (the renter's own orientation, headboard on the side
 * wall with the windows on their right, stays the default and nothing is moved):
 *   slide   the smallest slide along the same wall that fits, with the side it slides toward (null when no slide fits);
 *   wall    the best spot on a different wall of the room (the three other turns), with the same questions answered there (null when none fits).
 */
export function bestAlternative(model, items, id = 'bed-latitude') {
  const bed = items.find((x) => x.id === id);
  if (!bed) return null;
  const room = roomOf(model, [bed.x, bed.y]), others = items.filter((x) => x.id !== id && !x.hidden), visible = { ...bed, hidden: false };
  const { r } = axes(bed.rot);
  let slide = null;
  for (let k = 1; k <= 60 && !slide; k++) for (const sgn of [-1, 1]) {
    const moved = { ...visible, x: bed.x + r[0] * sgn * k, y: bed.y + r[1] * sgn * k }, rep = bedFit(model, [...others, moved], id);
    if (rep?.fits && ['wall', 'windows'].every((key) => rep.rows.find((q) => q.key === key)?.grade === 'clear')) { slide = { by: k, toward: sideOf(bed, [r[0] * sgn, r[1] * sgn]), item: moved, report: rep }; break; }
  }
  let wall = null;
  for (const rot of [0, 90, 180, 270].filter((q) => Math.abs((((q - bed.rot) % 360) + 540) % 360 - 180) <= 180 && ((q - bed.rot + 360) % 360) !== 0)) {
    const spot = findSpot(model, [...others, visible], id, room, 6, [rot]);
    if (!spot) continue;
    const moved = { ...visible, x: spot.x, y: spot.y, rot: spot.rot }, report = bedFit(model, [...others, moved], id);
    if (report?.fits && (!wall || (report.grade === 'clear' && wall.report.grade !== 'clear'))) wall = { spot, item: moved, report };
  }
  return { slide, wall };
}

/**
 * The report for the bed as the layout holds it, whatever the renter is looking at: the storage bed is shown (the pieces it replaces hidden), every
 * other piece stays where it is, and the questions are answered for where the layout puts it. When it does not fit, the alternatives come with their own
 * answers; the default orientation is never changed and nothing is moved.
 * @param {object} model normalised plan
 * @param {object[]} items the layout's items (not yet joined to the inventory)
 * @param {object} inv the inventory
 */
export function reportFor(model, items, inv, { group = 'bed', choice = 'storage', id = 'bed-latitude' } = {}) {
  const shown = applyInventory(applyChoice(items, inv, group, choice), inv).map((x) => resolve(x)).filter(Boolean), rep = bedFit(model, shown, id);
  if (!rep) return null;
  if (rep.fits) return { ...rep, alternative: null };
  const alt = bestAlternative(model, shown, id), parts = [];
  if (alt?.slide) parts.push(`Sliding it ${Math.round(alt.slide.by)} in toward your ${alt.slide.toward} along the same wall fits: ${alt.slide.report.summary}`);
  if (alt?.wall) parts.push(`The best other wall in this room is ${alt.wall.report.wall.name}: ${alt.wall.report.summary}`);
  if (!parts.length) parts.push('No other place in this room takes it either, so it would not fit this room as drawn.');
  return { ...rep, alternative: { text: parts.join(' '), slide: alt?.slide || null, wall: alt?.wall || null } };
}
