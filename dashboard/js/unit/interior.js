// The apartment inside the city: the floor plan's shell (floors, walls cut around the windows, glass and a
// ceiling, no furniture) as a three.js group that Unit 3D places at the real slab height, turned to the
// facade's bearing, so the city is seen through the glass and its shadows fall on the floor.
// Plan frame: inches, +x right, +y toward the facade (the plan's `up_bearing`). Group frame: metres,
// x = plan x, z = -plan y, origin at the centre of the facade windows on the window-wall line.
import * as THREE from 'three';
import { normalisePlan, pointInPoly } from '../plan/model.js';
import { planFrame } from '../plan/city.js';
import { roomShell } from '../room3d/shell.js';   // [room3d] the shared room: floors, walls, ceilings, doors, fixtures, windows

export { planFrame };
import { roomColors } from '../room3d/palette.js';   // [room3d] the room's paint and floor, one definition for both engines
import { windowGlowLights } from '../room3d/lighting.js';
import { roomLamps } from '../room3d/roomlamps.js';   // [daycycle] the assumed evening light of a room with no lamp placed   // [room3d] the sky glow each window lets in

const M = 0.0254;

/** A generic one-room shell (5.5 m wide, 7 m deep, a 4 m window band) for units without a floor plan. */
export function genericPlan() {
  return normalisePlan({
    units: 'm', ceiling: 2.7, wall: 0.2, title: 'Generic room',
    rooms: [{ name: 'Room', kind: 'living', x: 0, y: 0, w: 5.5, h: 7 }],
    windows: [{ room: 'Room', x1: 0.75, y1: 7, x2: 4.75, y2: 7, sill: 0.6, head: 2.4 }],
  });
}

/** Plan point (inches) -> group-local metres [x, z]. */
export const toLocal = (fr, p) => [(p[0] - fr.xc) * M, -(p[1] - fr.yw) * M];

/**
 * Build the shell. Returns {group, frame, windows:[{room, note, bearingOff, local:[x,z], eye:[x,z], yaw}], ceiling}
 * where bearingOff is the window's outward direction relative to the facade (degrees, clockwise) and eye is a
 * standing point inside its room, back from the glass, looking out.
 */
export function buildInterior(model, opts = {}) {
  const fr = planFrame(model), g = new THREE.Group(); g.name = 'apartment';
  // [room3d] the room itself is built by the shared shell (room3d/shell.js: the studio's own builder): bright white walls and ceiling, a light oak
  // floor, doors, fixtures (the AC and radiators), baseboards, casings and framed glass, the same room as in the Floor plan studio
  const RC = roomColors();
  const L = (p) => toLocal(fr, p);
  const H = model.ceiling * M, b = model.bounds;
  const [bx0, bz1] = L([b.x0 - 6, b.y0 - 6]), [bx1, bz0] = L([b.x1 + 6, b.y1 + 6]);
  // slab under the whole unit, so the apartment reads as a floor of the building from outside
  const slab = new THREE.Mesh(new THREE.BoxGeometry(bx1 - bx0, 0.3, bz1 - bz0), new THREE.MeshStandardMaterial({ color: RC.slab, roughness: 0.9 }));
  slab.position.set((bx0 + bx1) / 2, -0.16, (bz0 + bz1) / 2); slab.receiveShadow = true; slab.castShadow = true; slab.name = 'slab'; g.add(slab);
  const shell = roomShell(model, { origin: [fr.xc, fr.yw], castShadows: false });
  g.add(shell.group);
  // invisible shadow casters, as direct children of the apartment: a box per wall piece (shadowSide FrontSide, so the full thickness separates occluder
  // from receiver) and a thick ceiling that overlaps the wall tops by 3 cm so no sun leaks in at the junction (the city's shadows fall through the windows only)
  const casterMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, shadowSide: THREE.FrontSide });
  for (const p of model.pieces) {
    const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], len = Math.hypot(dx, dy); if (len < 0.3) continue;
    const ux = dx / len, uy = dy / len, h = p.t / 2, s0 = p.capA ? -h : 0, s1 = len + (p.capB ? h : 0);
    const mid = L([p.a[0] + ux * (s0 + s1) / 2, p.a[1] + uy * (s0 + s1) / 2]);
    const m = new THREE.Mesh(new THREE.BoxGeometry((s1 - s0) * M, (p.z1 - p.z0) * M, p.t * M), casterMat);
    m.position.set(mid[0], ((p.z0 + p.z1) / 2) * M, mid[1]); m.rotation.y = Math.atan2(dy, dx);
    m.castShadow = true; m.name = 'wall'; m.userData.blocks = true; g.add(m); shell.blockers.push(m);
  }
  const caster = new THREE.Mesh(new THREE.BoxGeometry(bx1 - bx0, 0.2, bz1 - bz0), casterMat);
  caster.position.set((bx0 + bx1) / 2, H + 0.07, (bz0 + bz1) / 2); caster.castShadow = true; caster.userData.blocks = true; caster.name = 'ceiling'; g.add(caster);
  shell.blockers.push(caster);
  const windows = [];
  for (const w of model.windows) {
    const [mx, mz] = L(w.mid);
    const room = model.rooms.find((r) => r.name === w.room) || model.rooms.find((r) => pointInPoly([w.mid[0] - w.normal[0] * 12, w.mid[1] - w.normal[1] * 12], r.poly));
    // stand back from the glass, inside the room
    let eye = null;
    for (const back of [150, 120, 96, 72, 48, 30]) {
      const q = [w.mid[0] - w.normal[0] * back, w.mid[1] - w.normal[1] * back];
      if (!room || pointInPoly(q, room.poly)) { eye = q; break; }
    }
    eye = eye || room?.label || w.mid;
    const off = (Math.atan2(w.normal[0], w.normal[1]) * 180) / Math.PI;
    windows.push({ room: w.room || room?.name || 'Window', note: w.note || '', bearingOff: off, local: [mx, mz], eye: L(eye), facade: w.normal[1] > 0.7 });
  }
  // [room3d] the sky glow each window lets in (soft area lights, off until the room's light state sets them), like the studio's
  const glow = new THREE.Group(); glow.name = 'window glow';
  for (const Lt of windowGlowLights(model, (p) => model.rooms.some((r) => pointInPoly(p, r.poly)), [fr.xc, fr.yw])) glow.add(Lt);
  g.add(glow);
  // [daycycle] a warm ceiling light in each main room for the evening when the renter has placed no lamp (room3d/roomlamps.js; Fast keeps three)
  const lamps = roomLamps(model, (p) => toLocal(fr, p), { limit: opts.lampLimit ?? 4 }); g.add(lamps.group);
  g.traverse((o) => { o.userData.interior = true; });
  return { group: g, frame: fr, windows, height: H, generic: !!opts.generic, glow, lamps, blockers: shell.blockers };
}
