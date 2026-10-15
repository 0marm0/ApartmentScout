// Photo view solver: from a few landmarks that are marked in a listing photo AND known in the 3D model, work out which way the
// photo looks (bearing), how far it is tilted, how wide the lens is, and how high the camera stood. Pure maths, no DOM, no three.js.
//
// Conventions
//   world   site metres: x east, y north, z up from the target's ground (the same datum as the window's eye height)
//   photo   (x, y) in units of the photo's HEIGHT, origin at the picture centre, x to the right, y UP. A click at (u, v) in
//           [0, 1] x [0, 1] from the top-left is photoPoint(u, v, aspect). Square pixels, optical axis through the centre.
//   camera  a level pinhole (no roll): optical axis at `bearing` (compass degrees, 0 north, 90 east) tilted `tilt` degrees up,
//           vertical field of view `vfov`; the lens focal length in photo heights is f = 0.5 / tan(vfov / 2).
//
// Unknowns by landmark count (the eye's x and y are the window's, and are not solved):
//   2 landmarks  bearing, tilt, eye height     (the lens is taken as known: `vfov0`)
//   3 or more    bearing, tilt, eye height, lens
// Both heights and lens are checked against what the clicks can really determine (a one-sigma uncertainty from the fit's
// covariance): when the landmarks cannot separate tilt from eye height (all at about the same distance) the eye height is NOT
// reported as measured and the model's own height is kept; likewise for the lens. The numbers that stay are labelled so.
// Levenberg-Marquardt on the reprojection error with a numeric Jacobian; a handful of parameters, so it is instant.

export const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const fin = Number.isFinite;

export const DEFAULTS = Object.freeze({
  vfov0: 55,           // a typical listing photo (about 24 mm full-frame equivalent at 3:2): vertical field of view, degrees
  sigmaPx: 0.004,      // how closely a click lands, in photo heights (about 3 px of a 667 px tall picture, 0.2 degrees)
  hPriorSigma: 15,     // metres: a weak pull towards the model's eye height so a poorly conditioned fit stays sane
  fPriorSigma: 25,     // degrees: the same for the lens
  eyeMaxSigma: 6,      // the eye height counts as measured only when the data alone fix it to this (metres, 1 sigma)
  fovMaxSigma: 12,     // the lens counts as measured only to this (degrees, 1 sigma)
  maxIter: 80,
});

export const focalOf = (vfovDeg) => 0.5 / Math.tan((vfovDeg * DEG) / 2);
export const vfovFromFocal = (f) => 2 * Math.atan(0.5 / f) * RAD;
/** Horizontal field of view (degrees) of a frame `aspect` = width / height wide. */
export const hfovOf = (vfovDeg, aspect) => 2 * Math.atan(aspect * Math.tan((vfovDeg * DEG) / 2)) * RAD;
/** The vertical field of view that gives a horizontal one on a frame `aspect` wide. */
export const vfovFromHfov = (hfovDeg, aspect) => 2 * Math.atan(Math.tan((hfovDeg * DEG) / 2) / aspect) * RAD;
/** Photo coordinates (height units, y up) of a click at fractions (u, v) of the picture, from the top-left. */
export const photoPoint = (u, v, aspect) => ({ x: (u - 0.5) * aspect, y: 0.5 - v });
/** The inverse: fractions of the picture from the top-left. */
export const photoFraction = (p, aspect) => ({ u: p.x / aspect + 0.5, v: 0.5 - p.y });
export const norm360 = (d) => ((d % 360) + 360) % 360;
/** Smallest signed difference a - b in degrees, in (-180, 180]. */
export const angDiff = (a, b) => { let d = norm360(a - b); if (d > 180) d -= 360; return d; };

/** Right-handed camera basis in world axes (east, north, up): forward, right, up. */
export function basis(bearingDeg, tiltDeg) {
  const a = bearingDeg * DEG, t = tiltDeg * DEG, sa = Math.sin(a), ca = Math.cos(a), st = Math.sin(t), ct = Math.cos(t);
  return { f: [sa * ct, ca * ct, st], r: [ca, -sa, 0], u: [-sa * st, -ca * st, ct] };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Where a world point lands in the photo for a camera: {x, y, depth} in photo heights (y up), or null when it is behind the camera.
 * cam: {bearing, tilt, vfov, x, y, z}; pt: {x, y, z}.
 */
export function project(cam, pt) {
  const d = [pt.x - cam.x, pt.y - cam.y, pt.z - cam.z], B = basis(cam.bearing, cam.tilt), c = dot(d, B.f);
  if (!(c > 1e-9)) return null;
  const f = focalOf(cam.vfov);
  return { x: (f * dot(d, B.r)) / c, y: (f * dot(d, B.u)) / c, depth: c };
}

/** The world direction a photo point looks along: {bearing, elevation} in degrees. */
export function rayAt(cam, x, y) {
  const f = focalOf(cam.vfov), B = basis(cam.bearing, cam.tilt);
  const v = [0, 1, 2].map((i) => f * B.f[i] + x * B.r[i] + y * B.u[i]);
  return { bearing: norm360(Math.atan2(v[0], v[1]) * RAD), elevation: Math.atan2(v[2], Math.hypot(v[0], v[1])) * RAD };
}

/** The world direction to a point from an eye: {bearing, elevation, dist} (degrees, metres; dist is horizontal). */
export function directionTo(eye, pt) {
  const dx = pt.x - eye.x, dy = pt.y - eye.y, dist = Math.hypot(dx, dy);
  return { bearing: norm360(Math.atan2(dx, dy) * RAD), elevation: Math.atan2(pt.z - eye.z, dist) * RAD, dist };
}

// ------------------------------------------------------------------ small linear algebra (n <= 4)

/** Solve A x = b for a small dense system by Gaussian elimination with partial pivoting; null when singular. */
function solveLinear(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j]; x[r] = s / M[r][r]; }
  return x;
}
/** Inverse of a small symmetric matrix; null when singular. */
function invert(A) {
  const n = A.length, cols = [];
  for (let j = 0; j < n; j++) { const e = new Array(n).fill(0); e[j] = 1; const x = solveLinear(A, e); if (!x) return null; cols.push(x); }
  return A.map((_, i) => cols.map((c) => c[i]));
}

// ------------------------------------------------------------------ the fit

/**
 * @param {object} inp
 *   landmarks  [{x, y, z, px: {x, y}, name?}]  world point (site metres) and its place in the photo (photo heights, y up)
 *   eye        {x, y, z}                       the window's point; z is the model's eye height for the photo's floor (the prior)
 *   aspect     picture width / height (only for the reported horizontal field of view)
 *   vfov0      the lens to assume when it cannot be solved (default DEFAULTS.vfov0)
 *   fixed      {vfov?, h?, tilt?}              hold any of these (lens in degrees, eye height in metres, tilt in degrees)
 *   sigmaPx    click uncertainty in photo heights
 * @returns {object} {ok, reason?, ...} see the end of the function
 */
export function solveView(inp) {
  const o = { ...DEFAULTS, ...(inp.options || {}) };
  const lms = (inp.landmarks || []).filter((l) => l && fin(l.x) && fin(l.y) && fin(l.z) && l.px && fin(l.px.x) && fin(l.px.y));
  const eye = inp.eye || { x: 0, y: 0, z: 0 }, aspect = fin(inp.aspect) && inp.aspect > 0 ? inp.aspect : 1.5, sig = inp.sigmaPx > 0 ? inp.sigmaPx : o.sigmaPx;
  const vfov0 = fin(inp.vfov0) ? inp.vfov0 : o.vfov0, h0 = eye.z, fixed = inp.fixed || {};
  if (!fin(eye.x) || !fin(eye.y) || !fin(eye.z)) return { ok: false, reason: 'The window position is unknown.' };
  if (lms.length < 2) return { ok: false, reason: lms.length ? 'Mark one more landmark: two are the least that fix the direction and height.' : 'Mark at least two landmarks.' };
  for (const l of lms) if (Math.hypot(l.x - eye.x, l.y - eye.y) < 1) return { ok: false, reason: `${l.name || 'A landmark'} is at the window itself.` };

  const n = lms.length, dirs = lms.map((l) => directionTo(eye, l));
  // ---- start values: the bearing that puts each landmark's azimuth at its horizontal offset, the tilt that does the same vertically
  const startFor = (vf) => {
    const f = focalOf(vf);
    let sx = 0, sy = 0, tilt = 0;
    lms.forEach((l, i) => { const b = (dirs[i].bearing - Math.atan(l.px.x / f) * RAD) * DEG; sx += Math.sin(b); sy += Math.cos(b); tilt += dirs[i].elevation - Math.atan(l.px.y / f) * RAD; });
    return { bearing: norm360(Math.atan2(sx, sy) * RAD), tilt: tilt / n, vfov: vf, h: h0 };
  };
  const build = (free) => {
    const priorRows = (p) => {
      const rows = [];
      if (free.includes('h')) rows.push((p.h - h0) / o.hPriorSigma);
      if (free.includes('vfov')) rows.push((p.vfov - vfov0) / o.fPriorSigma);
      if (free.includes('tilt')) rows.push(p.tilt / 60);
      return rows;
    };
    const dataRows = (p) => {
      const cam = { bearing: p.bearing, tilt: p.tilt, vfov: p.vfov, x: eye.x, y: eye.y, z: p.h }, out = [];
      for (const l of lms) {
        const q = project(cam, l);
        if (!q) { out.push(1e3, 1e3); continue; }
        out.push((q.x - l.px.x) / sig, (q.y - l.px.y) / sig);
      }
      return out;
    };
    return { priorRows, dataRows, all: (p) => [...dataRows(p), ...priorRows(p)] };
  };
  const apply = (base, free, v) => { const p = { ...base }; free.forEach((k, i) => { p[k] = v[i]; }); return p; };
  const jac = (fn, base, free) => free.map((k) => {
    const v = base[k], step = k === 'h' ? 1e-3 : 1e-4, hi = fn({ ...base, [k]: v + step }), lo = fn({ ...base, [k]: v - step });
    return hi.map((x, i) => (x - lo[i]) / (2 * step));
  });   // free.length x rows
  const normal = (Jt) => Jt.map((a) => Jt.map((b) => a.reduce((s, x, i) => s + x * b[i], 0)));
  const lm = (start, free) => {
    const R = build(free), cost = (p) => { const r = R.all(p); return r.reduce((s, x) => s + x * x, 0); };
    let p = { ...start }, c = cost(p), lam = 1e-3;
    for (let it = 0; it < o.maxIter; it++) {
      const Jt = jac(R.all, p, free), r = R.all(p), A = normal(Jt), g = Jt.map((row) => row.reduce((s, x, i) => s + x * r[i], 0));
      let improved = false;
      for (let tries = 0; tries < 12; tries++) {
        const D = A.map((row, i) => row.map((x, j) => (i === j ? x * (1 + lam) + 1e-12 : x)));
        const d = solveLinear(D, g.map((x) => -x));
        if (!d) { lam *= 10; continue; }
        const q = apply(p, free, free.map((k, i) => p[k] + d[i])), cq = cost(q);
        if (cq < c) { const dmax = Math.max(...d.map(Math.abs)); p = q; c = cq; lam = Math.max(1e-9, lam / 4); improved = true; if (dmax < 1e-7) it = o.maxIter; break; }
        lam *= 4;
      }
      if (!improved) break;
    }
    return { p, cost: c };
  };
  // ---- covariance from the Jacobian: with the weak priors (stable), and from the data alone (what the clicks can really say)
  const covOf = (p, free, withPriors) => {
    const R = build(free), fn = withPriors ? R.all : R.dataRows;
    const Jt = jac(fn, p, free), A = normal(Jt);
    A.forEach((row, i) => { row[i] += 1e-9; });
    const inv = invert(A);
    return inv ? free.map((_, i) => Math.sqrt(Math.max(0, inv[i][i]))) : free.map(() => Infinity);
  };
  const sigmaOf = (p, free, withPriors) => { const s = covOf(p, free, withPriors); return Object.fromEntries(free.map((k, i) => [k, s[i]])); };

  const run = (free) => {
    const starts = free.includes('vfov') ? [vfov0, 35, 80] : [fixed.vfov ?? vfov0];
    let best = null;
    for (const vf of starts) {
      const s0 = startFor(vf); if (fixed.h != null) s0.h = fixed.h; if (fixed.tilt != null) s0.tilt = fixed.tilt;
      const r = lm(s0, free);
      if (!best || r.cost < best.cost) best = r;
    }
    return best;
  };
  const withFixed = (p) => ({ ...p, ...(fixed.vfov != null ? { vfov: fixed.vfov } : {}), ...(fixed.h != null ? { h: fixed.h } : {}), ...(fixed.tilt != null ? { tilt: fixed.tilt } : {}) });

  let free = (n >= 3 ? ['bearing', 'tilt', 'vfov', 'h'] : ['bearing', 'tilt', 'h']).filter((k) => fixed[k] == null);
  let eyeDetermined = fixed.h != null, lensDetermined = fixed.vfov != null;
  let fit = run(free); fit.p = withFixed(fit.p);
  if (free.includes('h')) {
    if (sigmaOf(fit.p, free, false).h <= o.eyeMaxSigma) eyeDetermined = true;
    else {   // the clicks cannot separate tilt from eye height: keep the model's height and refit the rest
      free = free.filter((k) => k !== 'h');
      fit = lm({ ...fit.p, h: h0 }, free); fit.p = withFixed({ ...fit.p, h: h0 });
    }
  }
  if (free.includes('vfov')) {
    if (sigmaOf(fit.p, free, false).vfov <= o.fovMaxSigma) lensDetermined = true;
    else {
      free = free.filter((k) => k !== 'vfov');
      fit = lm({ ...fit.p, vfov: vfov0 }, free); fit.p = withFixed({ ...fit.p, vfov: vfov0 });
    }
  }
  const p = fit.p;
  // ---- report
  const cam = { bearing: p.bearing, tilt: p.tilt, vfov: p.vfov, x: eye.x, y: eye.y, z: p.h }, f = focalOf(p.vfov);
  const residuals = lms.map((l, i) => {
    const q = project(cam, l), obs = [l.px.x, l.px.y, f], nO = Math.hypot(...obs);
    let deg = 90, dx = 0, dy = 0;
    if (q) {
      const pr = [q.x, q.y, f], nP = Math.hypot(...pr);
      deg = Math.acos(Math.max(-1, Math.min(1, (obs[0] * pr[0] + obs[1] * pr[1] + obs[2] * pr[2]) / (nO * nP)))) * RAD; dx = q.x - l.px.x; dy = q.y - l.px.y;
    }
    return { name: l.name || `Landmark ${i + 1}`, deg, dx, dy, obs: l.px, pred: q ? { x: q.x, y: q.y } : null, dist: dirs[i].dist, bearing: dirs[i].bearing, elevation: dirs[i].elevation };
  });
  const rms = Math.sqrt(residuals.reduce((s, r) => s + r.deg * r.deg, 0) / n), max = Math.max(...residuals.map((r) => r.deg));
  const dof = 2 * n - free.length;
  let sg = sigmaOf(p, free, true);
  if (dof >= 1) { const infl = Math.sqrt(Math.max(1, fit.cost / Math.max(1, dof))); for (const k of free) sg[k] *= infl; }
  const warnings = [];
  if (!eyeDetermined) warnings.push('These landmarks sit at about the same distance, so the photo cannot separate tilt from height: the model\'s eye height is kept. Add a landmark much nearer or farther.');
  if (n >= 3 && !lensDetermined && fixed.vfov == null) warnings.push(`The lens could not be pinned down from these landmarks: ${vfov0.toFixed(0)}° (vertical) is assumed.`);
  if (n === 2) warnings.push('Two landmarks fit with almost nothing to check against: add a third to see whether they agree.');
  const span = Math.max(...lms.map((l, i) => angDiff(dirs[i].bearing, dirs[0].bearing))) - Math.min(...lms.map((l, i) => angDiff(dirs[i].bearing, dirs[0].bearing)));
  if (span < 6) warnings.push('The landmarks are close together in direction: the bearing is better with some spread across the photo.');
  const quality = n < 2 ? 'poor' : rms <= 0.8 && max <= 1.6 ? 'good' : rms <= 1.8 && max <= 3.5 ? 'fair' : 'poor';
  return {
    ok: true, n, dof, free, quality, warnings,
    bearing_deg: norm360(p.bearing), tilt_deg: p.tilt, vfov_deg: p.vfov, hfov_deg: hfovOf(p.vfov, aspect), eye_height_m: p.h, model_eye_m: h0,
    eye_determined: eyeDetermined, lens_determined: lensDetermined,
    sigma: { bearing: sg.bearing ?? 0, tilt: sg.tilt ?? 0, vfov: sg.vfov ?? 0, eye: eyeDetermined && sg.h != null ? sg.h : null },
    rms_deg: rms, max_deg: max, residuals,
    camera: cam, aspect,
  };
}

/**
 * The vertical field of view the 3D canvas needs so that a photo shown "contained" in it (the whole picture visible, letterboxed)
 * lines up with the model: the canvas's focal length in canvas pixels must equal the photo's in displayed pixels.
 * Returns {vfov, rect: {x, y, w, h}} where rect is where the picture sits in the canvas, in canvas pixels.
 */
export function containedPhoto(photoVfovDeg, aspect, cw, ch) {
  const s = Math.min(cw / aspect, ch), w = s * aspect, h = s, rect = { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  const fpx = focalOf(photoVfovDeg) * h;   // focal length in displayed pixels
  return { vfov: 2 * Math.atan(ch / 2 / fpx) * RAD, rect };
}

/** A short plain-language description of a fit, for the panel. */
export function describeFit(r) {
  if (!r?.ok) return r?.reason || 'Not enough to fit yet.';
  const dir = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(r.bearing_deg / 22.5) % 16];
  const t = r.tilt_deg;
  return `Looks toward ${Math.round(r.bearing_deg)}° ${dir}, ${Math.abs(t) < 0.5 ? 'level' : `${Math.abs(t).toFixed(1)}° ${t > 0 ? 'up' : 'down'}`}, lens ${r.vfov_deg.toFixed(0)}° tall (${r.hfov_deg.toFixed(0)}° wide)${r.eye_determined ? `, camera at ${r.eye_height_m.toFixed(1)} m` : ''}; fits within ${r.rms_deg < 0.1 ? r.rms_deg.toFixed(2) : r.rms_deg.toFixed(1)}°.`;
}
