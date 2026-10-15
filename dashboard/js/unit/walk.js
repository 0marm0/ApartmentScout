// Walking around inside Unit 3D's Inside camera: click the floor to glide there (around the furniture, through the doors), drag to
// look around in any direction, hold W S / arrow keys to walk with A D to turn and Q E to sidestep, a ring on the floor where a click
// will take you, and one click to stand at the nearest window looking out. The collisions, the paths and the nearest-window rule are
// plan/walkcore.js, the same ones the Floor plan studio's Walk uses; this file only moves the Inside camera (scene.js `inEye` and
// `look`) and draws the marker, in the apartment's frame (metres, +x right, -z up the plan, origin as unit/interior.js toLocal).
import * as THREE from 'three';
import { walkSpace, nearestWindow, windowStands, windowHit, groupOfWindow, pathLength, pointAlong, ease, EYE_IN } from '../plan/walkcore.js';
import { pointInPoly } from '../plan/model.js';

const M = 0.0254, DEG = Math.PI / 180;
const norm = (a) => ((a % 360) + 360) % 360;
const turnBetween = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;
export const WALK_KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

/**
 * @param {{stage: object, plan: object, items: object[], frame: {xc: number, yw: number}, onChange?: Function, onArrive?: Function}} o
 *   `stage` = unit/scene.js UnitScene (its `inEye`, `look`, interior group and cameras), `items` = the resolved furniture.
 */
export function createWalk({ stage, plan, items, frame, onChange = () => {}, onArrive = () => {} }) {
  const space = walkSpace(plan, items), keys = new Set();
  let anim = null, marker = null, last = 0, markerAt = 0;
  const toPlan = (v) => [v.x / M + frame.xc, -v.z / M + frame.yw];
  const toLocal = (p, y = 0) => new THREE.Vector3((p[0] - frame.xc) * M, y, -(p[1] - frame.yw) * M);
  const eye = () => stage.inEye;
  const pos = () => toPlan(eye().local);
  const heading = () => norm(eye().off + stage.look.yaw);
  const setHeading = (deg) => { eye().off = norm(deg); stage.look.yaw = 0; };
  const setPitch = (p) => { stage.look.pitch = Math.max(-15, Math.min(60, p)); };
  const roomAt = (p) => plan.rooms.find((r) => pointInPoly(p, r.poly))?.name || '';
  const changed = () => { stage.dirty = true; onChange(); };

  /** The ray under a client point, in the plan frame (inches, a third component up) and in the apartment's own frame (metres). */
  function rays(clientX, clientY) {
    const g = stage.interior?.group; if (!g) return null;
    const r = stage.cv.getBoundingClientRect(), cam = stage.activeCam();
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), cam);
    g.updateMatrixWorld(true);
    const inv = g.matrixWorld.clone().invert(), o = rc.ray.origin.clone().applyMatrix4(inv), d = rc.ray.direction.clone().transformDirection(inv);
    return { o, d, plan: { o: [o.x / M + frame.xc, -o.z / M + frame.yw, o.y / M], d: [d.x, -d.z, d.y] } };
  }
  /** The standable floor point under a client point (snapped to the nearest standable floor within 30 in), or null. */
  function floorAt(clientX, clientY) {
    const q = rays(clientX, clientY); if (!q || q.d.y > -1e-4) return null;
    const t = -q.o.y / q.d.y; if (t <= 0) return null;
    const p = toPlan(q.o.clone().addScaledVector(q.d, t));
    return space.snap(p[0], p[1], 30);
  }
  /** The window group under a client point (a click on its glass), or -1. */
  function windowAt(clientX, clientY) {
    const q = rays(clientX, clientY); if (!q) return -1;
    const h = windowHit(plan, q.plan.o, q.plan.d); return h ? groupOfWindow(plan, h.index) : -1;
  }

  function showMarker(p) {
    const g = stage.interior?.group; if (!g) return;
    if (!marker || marker.parent !== g) {
      marker?.removeFromParent();
      marker = new THREE.Group(); marker.name = 'walk-marker'; marker.renderOrder = 9; marker.userData.noBlock = true;
      const mat = (o) => new THREE.MeshBasicMaterial({ color: 0x8b93ff, transparent: true, opacity: o, depthTest: false, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(6 * M, 8 * M, 40), mat(0.6)), dot = new THREE.Mesh(new THREE.CircleGeometry(1.6 * M, 16), mat(0.75));
      for (const m of [ring, dot]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 9; marker.add(m); }
      g.add(marker);
    }
    marker.visible = !!p;
    if (p) marker.position.set((p[0] - frame.xc) * M, 0.012, -(p[1] - frame.yw) * M);
    stage.dirty = true;
  }

  /** Glide along a route (plan points) at about 6 ft a second, easing in and out; face the way of travel, and on arrival `dir` (a plan bearing in degrees). */
  function glide(route, { dir = null, pitch = null, speed = 72 } = {}) {
    if (!route || route.length < 2) return false;
    stage.endInTween?.(false);
    const total = pathLength(route), e = eye();
    anim = { route, total, t0: performance.now(), dur: total / speed + 0.7, dir, pitch, h0: e.local.y, pitch0: stage.look.pitch, yaw0: heading() };
    setHeading(anim.yaw0); showMarker(route[route.length - 1]);
    changed(); return true;
  }
  /** Walk to a plan point (snapped to standable floor). */
  function goTo(p, o) {
    const route = space.route(pos(), p, { maxGoal: o?.dir != null ? 8 : 36 });
    return route ? glide(route, o) : false;
  }
  /** Stand at the nearest window looking out; `group` names a window group instead (a double-clicked window). */
  function goToWindow(group = null) {
    const from = pos();
    const spot = group != null && group >= 0 ? (() => { const s0 = windowStands(plan, space).find((q) => q.group === group); const r = s0 && space.route(from, s0.at, { maxGoal: 6 }); return s0 && r ? { ...s0, route: r } : null; })() : nearestWindow(plan, space, from);
    if (!spot) return null;
    const bearing = (Math.atan2(spot.dir[0], spot.dir[1]) / DEG + 360) % 360;
    glide(spot.route, { dir: bearing, pitch: 6 - 2 });   // pitch is scene.look.pitch: 6 is level
    return spot;
  }

  /** A drag of (dx, dy) pixels turns and tilts the view; any direction, not just near where it started. */
  function drag(dx, dy) {
    anim = null; showMarker(null);
    const k = 70 / (stage.cv.clientHeight || 500) * (stage.look.fov / 70);
    setHeading(heading() - dx * k); setPitch(stage.look.pitch + dy * k); changed();
  }
  function hover(clientX, clientY) {
    const now = performance.now(); if (now - markerAt < 40 || anim) return; markerAt = now;
    showMarker(floorAt(clientX, clientY));
  }
  const hold = (key, on) => { const k = key.toLowerCase(); if (k !== 'shift' && !WALK_KEYS.includes(k)) return false; if (on) keys.add(k); else keys.delete(k); return true; };
  const release = () => keys.clear();
  const walking = () => !!anim;
  const stop = () => { if (anim) { anim = null; showMarker(null); } };

  /** One frame: advances a glide or held keys. Returns true when the camera moved (the scene must redraw). */
  function update(now = performance.now()) {
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    const e = eye(); if (!e) return false;
    if (anim) {
      const a = anim, u = Math.min(1, (now - a.t0) / 1000 / a.dur), d = a.total * ease(u), at = pointAlong(a.route, d), ahead = pointAlong(a.route, d + 36);
      e.local.set((at.at[0] - frame.xc) * M, a.h0 + (EYE_IN * M - a.h0) * ease(Math.min(1, u * 2)), -(at.at[1] - frame.yw) * M);
      let want = Math.atan2(ahead.at[0] - at.at[0], ahead.at[1] - at.at[1]) / DEG;
      if (Math.hypot(ahead.at[0] - at.at[0], ahead.at[1] - at.at[1]) < 1) want = heading();
      if (a.dir != null) { const w = Math.max(0, Math.min(1, (u - 0.55) / 0.4)); want += turnBetween(want, a.dir) * (w * w * (3 - 2 * w)); }
      setHeading(heading() + turnBetween(heading(), want) * 0.16);
      const pt = a.pitch != null ? a.pitch : 6;
      setPitch(stage.look.pitch + (pt - stage.look.pitch) * 0.1);
      if (u >= 1) { if (a.dir != null) setHeading(a.dir); anim = null; showMarker(null); changed(); onArrive(); }
      stage.dirty = true; return true;
    }
    if (!keys.size || (keys.size === 1 && keys.has('shift'))) return false;
    const h = (k) => keys.has(k), v = (h('shift') ? 72 : 36) * dt;
    const fwd = (h('w') || h('arrowup') ? v : 0) - (h('s') || h('arrowdown') ? v : 0);
    const turn = ((h('d') || h('arrowright') ? 1 : 0) - (h('a') || h('arrowleft') ? 1 : 0)) * 90 * dt, side = ((h('e') ? 1 : 0) - (h('q') ? 1 : 0)) * v;
    if (!fwd && !turn && !side) return false;
    if (turn) setHeading(heading() + turn);
    if (fwd || side) {
      const t = heading() * DEG, f = [Math.sin(t), Math.cos(t)], r = [f[1], -f[0]], p = space.step(pos(), f[0] * fwd + r[0] * side, f[1] * fwd + r[1] * side);
      const y = e.local.y; e.local.copy(toLocal(p, y + (EYE_IN * M - y) * Math.min(1, dt * 4)));
    }
    changed(); return true;
  }
  return { space, pos, heading, setHeading, floorAt, windowAt, goTo, goToWindow, glide, drag, hover, hold, release, walking, stop, update, roomAt, marker: () => marker, showMarker };
}
