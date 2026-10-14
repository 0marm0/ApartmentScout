// The apartment inside the city: the floor plan's shell (floors, walls cut around the windows, glass and a
// ceiling, no furniture) as a three.js group that Unit 3D places at the real slab height, turned to the
// facade's bearing, so the city is seen through the glass and its shadows fall on the floor.
// Plan frame: inches, +x right, +y toward the facade (the plan's `up_bearing`). Group frame: metres,
// x = plan x, z = -plan y, origin at the centre of the facade windows on the window-wall line.
import * as THREE from 'three';
import { normalisePlan, pointInPoly } from '../plan/model.js';
import { planFrame } from '../plan/city.js';

export { planFrame };
import { css } from '../util.js';

const M = 0.0254;
const col = (name, fb) => { const v = css(name); return new THREE.Color(/^#[0-9a-f]{3,8}$/i.test(v) ? v.slice(0, 7) : fb); };

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
  const light = document.documentElement.dataset.theme === 'light';
  const ink = col('--ink', '#eef1f6'), s1 = col('--surface-1', '#0e1015'), s3 = col('--surface-3', '#1a1e27');
  const wallC = light ? s1.clone().lerp(ink, 0.04) : ink.clone().lerp(s3, 0.28);
  const wood = new THREE.Color(light ? 0xcfb08a : 0x9c8064), tile = new THREE.Color(light ? 0xdedfdc : 0xa9adb2);
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.86, metalness: 0, ...o });
  const L = (p) => toLocal(fr, p);
  const H = model.ceiling * M, b = model.bounds;
  // slab under the whole unit, so the apartment reads as a floor of the building from outside
  const [bx0, bz1] = L([b.x0 - 6, b.y0 - 6]), [bx1, bz0] = L([b.x1 + 6, b.y1 + 6]);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(bx1 - bx0, 0.3, bz1 - bz0), std(wallC.clone().lerp(s3, 0.35)));
  slab.position.set((bx0 + bx1) / 2, -0.16, (bz0 + bz1) / 2); slab.receiveShadow = true; slab.castShadow = true; slab.name = 'slab'; g.add(slab);
  for (const r of model.rooms) {
    const shape = new THREE.Shape(r.poly.map((p) => { const [x, z] = L(p); return new THREE.Vector2(x, -z); }));
    const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, std(['bath', 'kitchen', 'outdoor'].includes(r.kind) ? tile : wood, { roughness: 0.74 }));
    m.position.y = 0.004; m.receiveShadow = true; m.name = `floor: ${r.name}`; g.add(m);
  }
  // shadowSide FrontSide: the slab and walls cast from their sun-facing faces, so the full thickness separates
  // occluder from receiver and no sun leaks along the wall-ceiling junction
  const wallMat = std(wallC, { roughness: 0.92, shadowSide: THREE.FrontSide });
  for (const p of model.pieces) {
    const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], len = Math.hypot(dx, dy); if (len < 0.3) continue;
    const ux = dx / len, uy = dy / len, h = p.t / 2, s0 = p.capA ? -h : 0, s1 = len + (p.capB ? h : 0);
    const mid = L([p.a[0] + ux * (s0 + s1) / 2, p.a[1] + uy * (s0 + s1) / 2]);
    const m = new THREE.Mesh(new THREE.BoxGeometry((s1 - s0) * M, (p.z1 - p.z0) * M, p.t * M), wallMat);
    m.position.set(mid[0], ((p.z0 + p.z1) / 2) * M, mid[1]); m.rotation.y = Math.atan2(dy, dx);
    m.castShadow = true; m.receiveShadow = true; m.name = 'wall'; g.add(m);
  }
  // ceiling: casts the shadow that makes the sun come in through the windows only
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(bx1 - bx0, 0.2, bz1 - bz0), std(wallC.clone().lerp(ink, light ? 0 : 0.05), { shadowSide: THREE.FrontSide }));
  // the slab overlaps the wall tops by 3 cm so no sun leaks in at the junction
  ceil.position.set((bx0 + bx1) / 2, H + 0.07, (bz0 + bz1) / 2); ceil.castShadow = true; ceil.receiveShadow = true; ceil.name = 'ceiling'; g.add(ceil);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fc6e8, transparent: true, opacity: light ? 0.16 : 0.12, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const frameMat = std(wallC.clone().lerp(s3, 0.5), { roughness: 0.6 });
  const windows = [];
  for (const w of model.windows) {
    const [mx, mz] = L(w.mid), rot = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(w.len * M, (w.head - w.sill) * M), glassMat);
    gl.position.set(mx, ((w.sill + w.head) / 2) * M, mz); gl.rotation.y = rot; gl.name = 'glass'; g.add(gl);
    // mullions: thin frame at the ends and every ~1.2 m
    const n = Math.max(1, Math.round((w.len * M) / 1.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = L([w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t]);
      const mu = new THREE.Mesh(new THREE.BoxGeometry(0.05, (w.head - w.sill) * M, 0.07), frameMat);
      mu.position.set(p[0], ((w.sill + w.head) / 2) * M, p[1]); mu.rotation.y = rot; mu.castShadow = true; g.add(mu);
    }
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
  g.traverse((o) => { o.userData.interior = true; });
  return { group: g, frame: fr, windows, height: H, generic: !!opts.generic };
}
