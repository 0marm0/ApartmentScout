// Windows for both 3D engines (the Floor plan studio and Unit 3D's Inside camera): the reveal, stool (inside sill board), apron and casings in
// white trim, a slim bronze frame at a realistic size (members 2 in, about 5 cm), vertical posts ONLY where the glass needs them (where the panes of a bay
// meet and at the outer ends), mullions only where the plan says a window has them (`mullions`: fractions along the window), a horizontal rail only
// where the plan says one exists (`transom`: height in inches; none by default, so no bar ever crosses a view), and glass with a faint reflection
// that never hides the view. Pure geometry: no engine state. Plan frame: inches, +y toward the top of the drawing. A VISUAL PREVIEW.
import * as THREE from 'three';
import { FRAME, windowLayout } from './windows-core.js';

const M = 0.0254;
export { FRAME, windowLayout };
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...o });

let sheenTex = null;
/** A faint diagonal highlight, drawn on a plane just inside each pane: a cheap reflection for Fast mode. Shared, never disposed with a scene. */
export function sheenTexture() {
  if (sheenTex) return sheenTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  const k = g.createLinearGradient(0, 0, 256, 256);
  k.addColorStop(0, 'rgba(255,255,255,0.0)'); k.addColorStop(0.3, 'rgba(255,255,255,0.0)'); k.addColorStop(0.36, 'rgba(255,255,255,0.4)'); k.addColorStop(0.43, 'rgba(255,255,255,0.0)');
  k.addColorStop(0.58, 'rgba(255,255,255,0.0)'); k.addColorStop(0.62, 'rgba(255,255,255,0.22)'); k.addColorStop(0.66, 'rgba(255,255,255,0.0)'); k.addColorStop(1, 'rgba(255,255,255,0.0)');
  g.fillStyle = k; g.fillRect(0, 0, 256, 256);
  sheenTex = new THREE.CanvasTexture(c); sheenTex.colorSpace = THREE.SRGBColorSpace; sheenTex.userData.shared = true; return sheenTex;
}

/**
 * The windows of a plan as a group.
 * `opts`: origin [ox, oy] plan inches at the local origin; cut (null = full height, or the height walls are cut to); sheen (default true).
 * @returns {THREE.Group}
 */
export function windowGroup(model, opts = {}) {
  const [ox, oy] = opts.origin || [0, 0], cut = opts.cut ?? null, wallT = model.wallT || 4.8;
  const g = new THREE.Group(); g.name = 'windows';
  const L = (p) => [(p[0] - ox) * M, -(p[1] - oy) * M];
  const up = (h) => h * M;
  const trim = std(0xfbf9f4, { roughness: 0.55 }), frame = std(FRAME.colour, { roughness: 0.42, metalness: 0.5 });
  const bar = (mat, ang, centre, len, thick, z0, z1, cast = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len * M, up(z1 - z0), thick * M), mat);
    const [x, z] = L(centre); m.position.set(x, up((z0 + z1) / 2), z); m.rotation.y = ang;
    m.castShadow = cast; m.receiveShadow = true; g.add(m); return m;
  };
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 4;
  const joined = (w, end) => model.windows.some((o) => o !== w && [o.a, o.b].some((q) => near(q, end)));
  // at an end shared with other panes, the one with the lowest index draws the post, so each post exists once
  const skips = (w, end) => model.windows.some((o) => o !== w && model.windows.indexOf(o) < model.windows.indexOf(w) && [o.a, o.b].some((q) => near(q, end)));
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xeaf3fb, transparent: true, opacity: 0.07, roughness: 0.04, metalness: 0.0, side: THREE.DoubleSide, depthWrite: false });
  glassMat.userData.shared = false;
  const sheenMat = () => new THREE.MeshBasicMaterial({ map: sheenTexture(), transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false, side: THREE.FrontSide });

  for (const w of model.windows) {
    const top = cut == null ? w.head : Math.min(w.head, cut); if (top <= w.sill + 0.5) continue;
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = w.len, ux = dx / len, uy = dy / len, ang = Math.atan2(dy, dx);
    const nin = [-w.normal[0], -w.normal[1]], mid = w.mid;
    const at = (s, d) => [mid[0] + ux * s + nin[0] * d, mid[1] + uy * s + nin[1] * d];   // s along the window from the middle, d inward from its centre line
    const inner = wallT / 2, skipA = skips(w, w.a), skipB = skips(w, w.b);
    // stool: the interior sill board, 1.6 in proud of the wall; apron beneath it. Only as long as the glass (never past a joined neighbour).
    bar(trim, ang, at(0, (inner + 1.6 - 0.6) / 2), len + (joined(w, w.a) || joined(w, w.b) ? 0.6 : 3.4), inner + 1.6 + 0.6, w.sill - 1.2, w.sill, true);
    if (cut == null || w.sill - 5 < cut) bar(trim, ang, at(0, inner + 0.35), len + 0.8, 0.7, w.sill - 5.2, w.sill - 1.2);
    // reveal: the wall's thickness reads as a jamb at each free end
    for (const sgn of [-1, 1]) { const end = sgn < 0 ? w.a : w.b; if (joined(w, end)) continue; bar(trim, ang, at(sgn * (len / 2 + 1.4), inner + 0.35), 2.8, 0.7, w.sill, top); }
    if (cut == null) bar(trim, ang, at(0, inner + 0.35), len + 4.4, 0.7, w.head, w.head + 2.8);
    // frame: the sill and head members and the posts, at their real size
    const lay = windowLayout({ ...w, head: top }, { skipA, skipB });
    for (const r of lay.rails) {
      if (cut != null && r.z + r.h > cut + 0.01) continue;
      bar(frame, ang, at(0, 0), len, FRAME.depth, r.z, r.z + r.h);
    }
    for (const p of lay.posts) bar(frame, ang, at(p.s, 0), p.w, FRAME.depth, w.sill, top);
    // glass and its sheen, one plane per clear pane so a mullion is a real gap in the glass
    for (const q of lay.glass) {
      const gl = new THREE.Mesh(new THREE.PlaneGeometry((q.s1 - q.s0) * M, up(Math.min(q.z1, top) - q.z0)), glassMat);
      const [gx, gz] = L(at((q.s0 + q.s1) / 2, 0)); gl.position.set(gx, up((q.z0 + Math.min(q.z1, top)) / 2), gz); gl.rotation.y = ang; gl.name = 'glass'; g.add(gl);
    }
    if (opts.sheen !== false) {
      const sh = new THREE.Mesh(new THREE.PlaneGeometry((len - 2 * FRAME.member) * M, up(top - w.sill - 2 * FRAME.member)), sheenMat());
      const [sx, sz] = L(at(0, 0.5)); sh.position.set(sx, up((w.sill + top) / 2), sz);
      sh.rotation.y = Math.atan2(nin[0], -nin[1]); sh.userData.sheen = true; sh.name = 'glass-sheen'; g.add(sh);
    }
  }
  g.traverse((o) => { o.userData.interior = true; });
  return g;
}
