// The architecture of a room in 3D: window reveals with sills, aprons and casings, framed and mullioned glass with a soft
// reflection, door frames with a panelled leaf and a handle, baseboards, recessed ceiling lights, and floor materials by
// room type (herringbone parquet in the living and dining rooms, oak planks in bedrooms, offices and halls, large-format
// tile in the kitchen, small tile in the bath). Shared by the Floor plan studio (plan/scene3d.js) and Unit 3D's Inside
// camera (unit/interior.js), which both feed it the same normalised plan, so a room looks the same in both.
// Plan frame: inches, +x right, +y up the drawing. Local frame: metres, x = (plan x - ox) * M, z = -(plan y - oy) * M, y up.
// A VISUAL PREVIEW: trim, glass and finishes are drawn for looking at; no number depends on them.
import * as THREE from 'three';
import { pointInPoly } from './model.js';

const M = 0.0254;

// ------------------------------------------------------------------ floors
export const FLOOR_BY_KIND = { living: 'parquet', dining: 'parquet', bedroom: 'oak', office: 'oak', hall: 'oak', other: 'oak', kitchen: 'tile-large', bath: 'tile-small', closet: 'oak', outdoor: 'tile-large' };
/** The floor finish for a room kind: 'parquet' | 'oak' | 'tile-large' | 'tile-small'. */
export const floorKind = (room) => FLOOR_BY_KIND[room?.kind] || 'oak';

const texCache = new Map();
const seeded = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const shade = (base, k, a = 1) => { const x = base.clone().multiplyScalar(k); return `rgba(${Math.min(255, x.r * 255) | 0},${Math.min(255, x.g * 255) | 0},${Math.min(255, x.b * 255) | 0},${a})`; };

/** Tiling canvas texture for a finish, `base` = THREE.Color. Cached; shared between rooms (never disposed by the scene clear). */
export function floorTexture(kind, base) {
  const key = `${kind}|${base.getHexString()}`; if (texCache.has(key)) return texCache.get(key);
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), rnd = seeded(kind.length * 4099 + 17);
  let size = 1.2;
  if (kind === 'oak') {            // 7 in planks, staggered joints, long soft grain, a darker edge line
    const rows = 7, h = N / rows;
    g.fillStyle = shade(base, 1); g.fillRect(0, 0, N, N);
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * N * 0.7;
      while (x < N) {
        const L = N * (0.55 + rnd() * 0.45), tone = 0.9 + rnd() * 0.16;
        g.fillStyle = shade(base, tone); g.fillRect(x, r * h, L, h);
        for (let k = 0; k < 9; k++) { g.strokeStyle = shade(base, 0.8 + rnd() * 0.12, 0.16 + rnd() * 0.1); g.lineWidth = 0.7 + rnd() * 1.2; g.beginPath(); const y = r * h + rnd() * h; g.moveTo(x, y); g.bezierCurveTo(x + L * 0.3, y + (rnd() - 0.5) * 5, x + L * 0.65, y + (rnd() - 0.5) * 5, x + L, y + (rnd() - 0.5) * 3); g.stroke(); }
        if (rnd() > 0.82) { g.fillStyle = shade(base, 0.7, 0.35); g.beginPath(); g.ellipse(x + L * rnd(), r * h + h * (0.3 + rnd() * 0.4), 3 + rnd() * 3, 1.5 + rnd(), 0, 0, 6.28); g.fill(); }
        g.fillStyle = shade(base, 0.55, 0.5); g.fillRect(x, r * h, 1.2, h); x += L;
      }
      g.fillStyle = shade(base, 0.55, 0.55); g.fillRect(0, r * h, N, 1.3);
    }
    size = 1.27;                   // 7 boards of about 7 in make 1.27 m
  } else if (kind === 'parquet') { // chevron parquet: boards cut at 45 degrees, mirrored about a centre line, seamless when tiled
    const m = 8, per = N / m, s = per / Math.SQRT2;           // stripe pitch across the board, so N is a whole number of periods
    g.fillStyle = shade(base, 0.8); g.fillRect(0, 0, N, N);
    g.save(); g.beginPath(); g.rect(0, 0, N / 2, N); g.clip(); g.translate(N / 4, N / 2); g.rotate(-Math.PI / 4);
    for (let k = -2 * m; k < 2 * m; k++) {
      const tone = 0.9 + rnd() * 0.18; g.fillStyle = shade(base, tone); g.fillRect(k * s + 0.8, -N * 2, s - 1.6, N * 4);
      for (let q = 0; q < 3; q++) { g.strokeStyle = shade(base, 0.8, 0.1); g.lineWidth = 0.8; const y = (rnd() - 0.5) * N; g.beginPath(); g.moveTo(k * s + 1, y); g.lineTo(k * s + s - 1, y + (rnd() - 0.5) * 4); g.stroke(); }
      // butt joints along each board
      for (let y = -N * 2 + rnd() * 90; y < N * 2; y += 90 + rnd() * 40) { g.fillStyle = shade(base, 0.62, 0.55); g.fillRect(k * s + 0.8, y, s - 1.6, 1.3); }
    }
    g.restore();
    g.save(); g.translate(N, 0); g.scale(-1, 1); g.drawImage(c, 0, 0, N / 2, N, 0, 0, N / 2, N); g.restore();
    size = 1.15;
  } else if (kind === 'tile-large') { // 24 in porcelain, soft veining
    g.fillStyle = shade(base, 1); g.fillRect(0, 0, N, N); const n = 2, s = N / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = shade(base, 0.96 + rnd() * 0.08); g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
      for (let k = 0; k < 5; k++) { g.strokeStyle = shade(base, 0.8, 0.12); g.lineWidth = 1 + rnd() * 2; g.beginPath(); const x = i * s + rnd() * s, y = j * s + rnd() * s; g.moveTo(x, y); g.bezierCurveTo(x + 40, y + 20, x + 80, y - 30, x + 130 * rnd(), y + 60 * (rnd() - 0.5)); g.stroke(); }
    }
    g.strokeStyle = shade(base, 0.62); g.lineWidth = 3; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, N); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(N, i * s); g.stroke(); }
    size = 1.22;
  } else {                         // tile-small: 3 in square mosaic
    g.fillStyle = shade(base, 0.7); g.fillRect(0, 0, N, N); const n = 16, s = N / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = shade(base, 0.94 + rnd() * 0.1); g.fillRect(i * s + 1.2, j * s + 1.2, s - 2.4, s - 2.4); }
    size = 0.6;
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / size, 1 / size); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.userData.shared = true; texCache.set(key, t); return t;
}
export const clearFloorTextures = () => { for (const t of texCache.values()) t.dispose(); texCache.clear(); };
/** Roughness for a finish (varnished wood, polished tile). */
export const floorRoughness = (kind) => (kind === 'parquet' ? 0.5 : kind === 'oak' ? 0.58 : 0.34);
/** The theme-tinted base colour for a finish out of the studio's colour set `C` (wood, tile). */
export function floorBase(kind, C) {
  const wood = C.wood || new THREE.Color(0xc2a27c), tile = C.tile || new THREE.Color(0xc4c6c6);
  if (kind === 'parquet') return wood.clone().multiplyScalar(0.92).lerp(new THREE.Color(0x8a5a35), 0.12);
  if (kind === 'oak') return wood.clone().lerp(new THREE.Color(0xe0c9a2), 0.18);
  if (kind === 'tile-large') return tile.clone().lerp(new THREE.Color(0xdcd8d0), 0.5);
  return tile.clone().lerp(new THREE.Color(0xcfd6d8), 0.4);
}

// ------------------------------------------------------------------ glass sheen (a soft reflection without an environment map)
let sheenTex = null;
/** A faint diagonal highlight, drawn on a plane just inside each pane of glass: a cheap reflection for Fast mode. */
export function sheenTexture() {
  if (sheenTex) return sheenTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  const k = g.createLinearGradient(0, 0, 256, 256);
  k.addColorStop(0, 'rgba(255,255,255,0.0)'); k.addColorStop(0.28, 'rgba(255,255,255,0.0)'); k.addColorStop(0.34, 'rgba(255,255,255,0.55)'); k.addColorStop(0.41, 'rgba(255,255,255,0.0)');
  k.addColorStop(0.55, 'rgba(255,255,255,0.0)'); k.addColorStop(0.60, 'rgba(255,255,255,0.32)'); k.addColorStop(0.64, 'rgba(255,255,255,0.0)'); k.addColorStop(1, 'rgba(255,255,255,0.0)');
  g.fillStyle = k; g.fillRect(0, 0, 256, 256);
  const v = g.createLinearGradient(0, 0, 0, 256); v.addColorStop(0, 'rgba(255,255,255,0.18)'); v.addColorStop(0.5, 'rgba(255,255,255,0)'); g.fillStyle = v; g.fillRect(0, 0, 256, 256);
  sheenTex = new THREE.CanvasTexture(c); sheenTex.colorSpace = THREE.SRGBColorSpace; sheenTex.userData.shared = true; return sheenTex;
}

// ------------------------------------------------------------------ the detail group
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...o });

/**
 * Build the architecture of a plan as a group. `opts`:
 *   origin [ox, oy]  plan inches that sit at the local origin (default 0, 0)
 *   cut              null for full-height walls, or the height walls are cut to (details above it are left out)
 *   dark             the dashboard theme is dark (trim a little dimmer)
 *   sheen            put the soft reflection on the glass (Fast mode; default true)
 *   skipCans         do not draw the ceiling cans (the renter placed their own recessed lights)
 * @returns {THREE.Group & {userData: {shared: boolean}}}
 */
export function detailGroup(model, opts = {}) {
  const [ox, oy] = opts.origin || [0, 0], cut = opts.cut ?? null, dark = !!opts.dark, H = model.ceiling;
  const g = new THREE.Group(); g.name = 'interior detail';
  const L = (p) => [(p[0] - ox) * M, -(p[1] - oy) * M];
  const trim = std(dark ? 0xe4e0d8 : 0xfbf9f4, { roughness: 0.55 }), frame = std(0x2b2d31, { roughness: 0.38, metalness: 0.55 }), leaf = std(dark ? 0xd9d4ca : 0xf4f1ea, { roughness: 0.5 });
  const brass = std(0xc3a56a, { roughness: 0.28, metalness: 0.85 });
  const up = (h) => h * M;
  /** A box along a wall line: `centre` plan inches, `len` along the wall, `thick` across it, from z0 to z1 inches. */
  const bar = (mat, ang, centre, len, thick, z0, z1, off = [0, 0], cast = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len * M, up(z1 - z0), thick * M), mat);
    const [x, z] = L([centre[0] + off[0], centre[1] + off[1]]); m.position.set(x, up((z0 + z1) / 2), z); m.rotation.y = ang;
    m.castShadow = cast; m.receiveShadow = true; g.add(m); return m;
  };
  const wallT = model.wallT || 4.8;

  // baseboards: every wall piece that reaches the floor, both faces (a 5 in board with a cap line)
  if (cut == null || cut >= 5) {
    for (const p of model.pieces) {
      if (p.z0 > 0.5 || p.t < 1) continue;
      const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], len = Math.hypot(dx, dy); if (len < 2) continue;
      const ang = Math.atan2(dy, dx), mid = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2];
      bar(trim, ang, mid, len, p.t + 1.3, 0, 5);
      bar(trim, ang, mid, len, p.t + 1.9, 4.6, 5.4);
    }
  }

  // windows: reveal, stool (sill board), apron, casings, frame with mullions, glass with a soft reflection
  const joined = (w, end) => model.windows.some((o) => o !== w && [o.a, o.b].some((q) => Math.hypot(q[0] - end[0], q[1] - end[1]) < 4));
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xa9cbe6, transparent: true, opacity: dark ? 0.2 : 0.26, roughness: 0.03, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
  glassMat.userData.shared = false;
  for (const w of model.windows) {
    const top = cut == null ? w.head : Math.min(w.head, cut); if (top <= w.sill + 0.5) continue;
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = w.len, ux = dx / len, uy = dy / len, ang = Math.atan2(dy, dx);
    const nin = [-w.normal[0], -w.normal[1]], mid = w.mid;
    const at = (s, d) => [mid[0] + ux * s + nin[0] * d, mid[1] + uy * s + nin[1] * d];   // s along the wall from the middle, d inward from the centre line
    const inner = wallT / 2;
    // stool: the interior sill board, standing 1.6 in proud of the wall; apron beneath it
    bar(trim, ang, at(0, (inner + 1.6 - 0.6) / 2), len + 4.4, inner + 1.6 + 0.6, w.sill - 1.2, w.sill, [0, 0], true);
    if (cut == null || w.sill - 5 < cut) bar(trim, ang, at(0, inner + 0.35), len + 1.6, 0.7, w.sill - 5.2, w.sill - 1.2);
    // reveal: the thickness of the wall reads as a jamb, lit differently from the glass plane
    for (const sgn of [-1, 1]) {
      const end = sgn < 0 ? w.a : w.b;
      if (joined(w, end)) continue;
      bar(trim, ang, at(sgn * (len / 2 + 1.5), inner + 0.35), 3, 0.7, w.sill, top, [0, 0]);
    }
    if (cut == null) bar(trim, ang, at(0, inner + 0.35), len + 6, 0.7, w.head, w.head + 3);
    // frame: perimeter and mullions every ~40 in, slim and dark, set into the reveal
    const n = Math.max(1, Math.round(len / 40)), fd = 2.6, fw = 1.5;
    bar(frame, ang, at(0, 0), len, fd, w.sill, w.sill + fw);
    if (cut == null) bar(frame, ang, at(0, 0), len, fd, w.head - fw, w.head);
    for (let k = 0; k <= n; k++) {
      const s = -len / 2 + (len * k) / n; if ((k === 0 && joined(w, w.a)) || (k === n && joined(w, w.b))) { /* the neighbour pane draws this post */ }
      bar(frame, ang, at(s, 0), k === 0 || k === n ? fw * 1.4 : fw, fd, w.sill, top);
    }
    if (cut == null && w.head - w.sill > 66) bar(frame, ang, at(0, 0), len, fd, w.sill + (w.head - w.sill) * 0.68, w.sill + (w.head - w.sill) * 0.68 + 1.2);   // a transom rail on tall glass
    // glass and its sheen
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(len * M, up(top - w.sill)), glassMat);
    const [gx, gz] = L(mid); gl.position.set(gx, up((w.sill + top) / 2), gz); gl.rotation.y = ang; gl.name = 'glass'; g.add(gl);
    if (opts.sheen !== false) {
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(len * M, up(top - w.sill)), new THREE.MeshBasicMaterial({ map: sheenTexture(), transparent: true, opacity: dark ? 0.42 : 0.32, depthWrite: false, toneMapped: false, side: THREE.FrontSide }));
      const [sx, sz] = L(at(0, 0.5)); sh.position.set(sx, up((w.sill + top) / 2), sz);
      // the plane faces +z in its own frame; turn it to face into the room
      sh.rotation.y = Math.atan2(nin[0], -nin[1]); sh.userData.sheen = true; g.add(sh);
    }
  }

  // doors: jambs and head casing on both faces, a panelled leaf with a lever handle where the swing is known
  for (const d of model.doorways) {
    const dx = d.b[0] - d.a[0], dy = d.b[1] - d.a[1], len = Math.hypot(dx, dy); if (len < 10) continue;
    const ux = dx / len, uy = dy / len, ang = Math.atan2(dy, dx), head = Math.min(d.head, H);
    const nrm = [-uy, ux];
    for (const side of [-1, 1]) {
      const off = side * (wallT / 2 + 0.35), c = [d.mid[0] + nrm[0] * off, d.mid[1] + nrm[1] * off];
      for (const sgn of [-1, 1]) bar(trim, ang, [c[0] + ux * sgn * (len / 2 + 1.4), c[1] + uy * sgn * (len / 2 + 1.4)], 2.8, 0.7, 0, Math.min(head, cut ?? head));
      if (cut == null) bar(trim, ang, c, len + 5.6, 0.7, head, head + 2.8);
    }
    if (d.swingDir && cut == null) {   // a lever on each face of the open leaf, near its free end
      const hinge = d.hingePt, sd = d.swingDir, perp = [-sd[1], sd[0]];
      for (const side of [-1, 1]) {
        const knob = new THREE.Mesh(new THREE.SphereGeometry(1.1 * M, 12, 8), brass);
        const [hx, hz] = L([hinge[0] + sd[0] * (d.leaf - 3.4) + perp[0] * side * 1.5, hinge[1] + sd[1] * (d.leaf - 3.4) + perp[1] * side * 1.5]); knob.position.set(hx, up(36), hz); g.add(knob);
      }
    }
  }

  // recessed ceiling lights: trim rings on a loose grid in each room (architecture, not luminaires: the Light tab owns lamps)
  if (cut == null && !opts.skipCans) {
    const pts = [];
    for (const r of model.rooms) {
      if (['closet', 'outdoor'].includes(r.kind) || r.area < 60 * 60) continue;
      const xs = r.poly.map((p) => p[0]), ys = r.poly.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const nx = Math.max(1, Math.round((x1 - x0) / 66)), ny = Math.max(1, Math.round((y1 - y0) / 66));
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const p = [x0 + ((i + 0.5) * (x1 - x0)) / nx, y0 + ((j + 0.5) * (y1 - y0)) / ny];
        if (pointInPoly(p, r.poly) && [[24, 0], [-24, 0], [0, 24], [0, -24]].every(([a, b]) => pointInPoly([p[0] + a, p[1] + b], r.poly))) pts.push(p);
        if (pts.length > 60) break;
      }
    }
    if (pts.length) {
      const ring = new THREE.InstancedMesh(new THREE.CylinderGeometry(3.4 * M, 3.4 * M, 0.4 * M, 24), trim, pts.length);
      const lens = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.5 * M, 2.5 * M, 0.2 * M, 24), std(0xfff4dc, { roughness: 0.4, emissive: new THREE.Color(0xfff0d0), emissiveIntensity: 0.0 }), pts.length);
      const m4 = new THREE.Matrix4();
      pts.forEach((p, i) => { const [x, z] = L(p); m4.makeTranslation(x, up(H - 0.25), z); ring.setMatrixAt(i, m4); m4.makeTranslation(x, up(H - 0.45), z); lens.setMatrixAt(i, m4); });
      ring.name = 'ceiling-trims'; lens.name = 'ceiling-lenses'; g.add(ring, lens);
    }
  }
  g.traverse((o) => { o.userData.interior = true; });
  return g;
}
