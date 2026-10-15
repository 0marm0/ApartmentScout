// The architecture of a room in 3D: window reveals with sills, aprons and casings, framed and mullioned glass with a soft
// reflection, door frames with a panelled leaf and a handle, baseboards, recessed ceiling lights, and floor materials by
// room type (herringbone parquet in the living and dining rooms, oak planks in bedrooms, offices and halls, large-format
// tile in the kitchen, small tile in the bath). Shared by the Floor plan studio (plan/scene3d.js) and Unit 3D's Inside
// camera (unit/interior.js), which both feed it the same normalised plan, so a room looks the same in both.
// Plan frame: inches, +x right, +y up the drawing. Local frame: metres, x = (plan x - ox) * M, z = -(plan y - oy) * M, y up.
// A VISUAL PREVIEW: trim, glass and finishes are drawn for looking at; no number depends on them.
import * as THREE from 'three';
import { pointInPoly } from './model.js';
import { windowGroup } from '../room3d/windows.js';   // [room3d]

const M = 0.0254;

// ------------------------------------------------------------------ floors
export const FLOOR_BY_KIND = { living: 'parquet', dining: 'parquet', bedroom: 'oak', office: 'oak', hall: 'oak', other: 'oak', kitchen: 'tile-large', bath: 'tile-small', closet: 'oak', outdoor: 'tile-large' };
/** The floor finish for a room kind: 'parquet' | 'oak' | 'tile-large' | 'tile-small'. */
/** A plan may name the finish of its dry rooms (`floor_finish`: 'basket' | 'parquet' | 'oak'): the real floor of the unit, read from its photos. Kitchens, baths, closets and terraces keep their own. */
export const FLOOR_FINISHES = ['basket', 'parquet', 'oak'];
const OWN_FLOOR = new Set(['kitchen', 'bath', 'closet', 'outdoor']);
export const floorKind = (room, model) => (model && FLOOR_FINISHES.includes(model.floor_finish) && !OWN_FLOOR.has(room?.kind) ? model.floor_finish : FLOOR_BY_KIND[room?.kind] || 'oak');

const texCache = new Map();
const seeded = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const shade = (base, k, a = 1) => { const x = base.clone().multiplyScalar(k).convertLinearToSRGB();   // (a Color holds linear values; the canvas wants sRGB: without this every finish came out darker and more saturated than its colour)
  return `rgba(${Math.min(255, x.r * 255) | 0},${Math.min(255, x.g * 255) | 0},${Math.min(255, x.b * 255) | 0},${a})`; };

/**
 * Tiling canvas texture for a finish, `base` = THREE.Color. Cached; shared between rooms (never disposed by the scene clear).
 * The wood finishes (oak planks, chevron parquet) are drawn at 1024 px twice, from the same random stream: the colour (a tone of its own for every board, long
 * soft grain, knots, dark joints) and a height map in `userData.bump` (raised boards, sunk joints, fine grain), so light catches the boards and the floor
 * is never one flat tone however far away it is.
 */
export function floorTexture(kind, base) {
  const key = `${kind}|${base.getHexString()}`; if (texCache.has(key)) return texCache.get(key);
  const wood = kind === 'oak' || kind === 'parquet' || kind === 'basket', N = wood ? 1024 : 512, mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const c = mk(); const g = c.getContext('2d');
  let size = 1.2, bump = null;
  if (wood) {
    const draw = (g, bumpMode) => {
      const rnd = seeded(kind.length * 4099 + 17), S = N / 512;
      // colour: the base tone times k; height: a grey level (boards high, joints and grain low)
      const grey = (k, a) => { const v = (Math.max(0, Math.min(1, k * 0.95)) * 255) | 0; return `rgba(${v},${v},${v},${a})`; };
      const sh = (k, a = 1) => (bumpMode ? grey(k, a) : shade(base, k, a));
      const grain = (x0, y0, len, wid, ang) => {   // long soft grain lines along a board, one tone darker, a few of them lighter
        for (let k = 0; k < 14; k++) {
          const dark = rnd() > 0.28; g.strokeStyle = dark ? sh(0.78 + rnd() * 0.12, 0.14 + rnd() * 0.16) : sh(1.12, 0.12);
          g.lineWidth = (0.5 + rnd() * 1.3) * S; g.beginPath(); const o = (rnd() - 0.5) * wid, w1 = (rnd() - 0.5) * 3 * S, w2 = (rnd() - 0.5) * 3 * S;
          g.save(); g.translate(x0, y0); g.rotate(ang); g.moveTo(0, o); g.bezierCurveTo(len * 0.3, o + w1, len * 0.65, o + w2, len, o + (rnd() - 0.5) * 2 * S); g.stroke(); g.restore();
        }
      };
      if (kind === 'oak') {            // 7 in planks, staggered joints, long soft grain, knots, a dark bevelled joint
        const rows = 7, h = N / rows;
        g.fillStyle = sh(1); g.fillRect(0, 0, N, N);
        for (let r = 0; r < rows; r++) {
          let x = -rnd() * N * 0.7;
          while (x < N) {
            const L = N * (0.55 + rnd() * 0.45), tone = 0.86 + rnd() * 0.26;
            g.fillStyle = sh(tone); g.fillRect(x, r * h, L, h);
            const lg = g.createLinearGradient(0, r * h, 0, r * h + h); lg.addColorStop(0, sh(1.08, 0.18)); lg.addColorStop(0.5, sh(1, 0)); lg.addColorStop(1, sh(0.84, 0.2)); g.fillStyle = lg; g.fillRect(x, r * h, L, h);   // a board is a little darker along one edge
            grain(x, r * h + h / 2, L, h, 0);
            if (rnd() > 0.78) { g.fillStyle = sh(0.66, 0.4); g.beginPath(); g.ellipse(x + L * rnd(), r * h + h * (0.3 + rnd() * 0.4), (3 + rnd() * 3) * S, (1.5 + rnd()) * S, 0, 0, 6.28); g.fill(); }
            g.fillStyle = sh(0.5, 0.7); g.fillRect(x, r * h, 1.6 * S, h); x += L;
          }
          g.fillStyle = sh(0.5, 0.7); g.fillRect(0, r * h, N, 1.6 * S);
        }
      } else if (kind === 'basket') {  // basket-weave block parquet (the classic New York apartment floor): 8 in squares of four slats, the slats of neighbouring squares at right angles
        const nb = 4, B = N / nb, ns = 4, sw = B / ns;   // 4 x 4 squares to the tile, four slats to a square
        g.fillStyle = sh(0.5); g.fillRect(0, 0, N, N);
        for (let by = 0; by < nb; by++) for (let bx = 0; bx < nb; bx++) {
          const horiz = (bx + by) % 2 === 0, blockTone = 0.88 + rnd() * 0.2;
          for (let k = 0; k < ns; k++) {
            const x = bx * B + (horiz ? 0 : k * sw), y = by * B + (horiz ? k * sw : 0), w = horiz ? B : sw, h = horiz ? sw : B, tone = blockTone * (0.94 + rnd() * 0.12);
            g.fillStyle = sh(tone); g.fillRect(x + S, y + S, w - 2 * S, h - 2 * S);
            const lg = horiz ? g.createLinearGradient(0, y, 0, y + h) : g.createLinearGradient(x, 0, x + w, 0);   // each slat is a little rounded: lighter on one edge, darker on the other
            lg.addColorStop(0, sh(1.1, 0.22)); lg.addColorStop(0.5, sh(1, 0)); lg.addColorStop(1, sh(0.8, 0.26)); g.fillStyle = lg; g.fillRect(x + S, y + S, w - 2 * S, h - 2 * S);
            for (let q = 0; q < 6; q++) {   // grain along the slat
              g.strokeStyle = rnd() > 0.3 ? sh(0.72 + rnd() * 0.14, 0.14 + rnd() * 0.16) : sh(1.14, 0.14); g.lineWidth = (0.5 + rnd() * 0.9) * S; g.beginPath();
              if (horiz) { const yy = y + S + rnd() * (h - 2 * S); g.moveTo(x + S, yy); g.bezierCurveTo(x + w * 0.3, yy + (rnd() - 0.5) * 2 * S, x + w * 0.7, yy + (rnd() - 0.5) * 2 * S, x + w - S, yy + (rnd() - 0.5) * S); }
              else { const xx = x + S + rnd() * (w - 2 * S); g.moveTo(xx, y + S); g.bezierCurveTo(xx + (rnd() - 0.5) * 2 * S, y + h * 0.3, xx + (rnd() - 0.5) * 2 * S, y + h * 0.7, xx + (rnd() - 0.5) * S, y + h - S); }
              g.stroke();
            }
          }
        }
      } else {                         // chevron parquet: boards cut at 45 degrees, mirrored about a centre line, seamless when tiled
        const m = 8, per = N / m, s = per / Math.SQRT2;           // stripe pitch across the board, so N is a whole number of periods
        g.fillStyle = sh(0.62); g.fillRect(0, 0, N, N);
        g.save(); g.beginPath(); g.rect(0, 0, N / 2, N); g.clip(); g.translate(N / 4, N / 2); g.rotate(-Math.PI / 4);
        for (let k = -2 * m; k < 2 * m; k++) {
          const tone = 0.84 + rnd() * 0.3, w = s - 2 * S;
          g.fillStyle = sh(tone); g.fillRect(k * s + S, -N * 2, w, N * 4);
          const lg = g.createLinearGradient(k * s, 0, k * s + s, 0); lg.addColorStop(0, sh(1.08, 0.2)); lg.addColorStop(0.5, sh(1, 0)); lg.addColorStop(1, sh(0.82, 0.22)); g.fillStyle = lg; g.fillRect(k * s + S, -N * 2, w, N * 4);
          // grain runs along the board (here: down the stripe); butt joints (one every ~25 cm) break it into blocks of a slightly different tone
          for (let y = -N * 2 + rnd() * 160 * S; y < N * 2; y += (150 + rnd() * 80) * S) {
            const bl = (150 + rnd() * 80) * S; g.fillStyle = sh(0.9 + rnd() * 0.2, 0.55); g.fillRect(k * s + S, y, w, bl);
            for (let q = 0; q < 5; q++) { g.strokeStyle = sh(0.74 + rnd() * 0.14, 0.12 + rnd() * 0.14); g.lineWidth = (0.5 + rnd()) * S; const x = k * s + S + rnd() * w; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + (rnd() - 0.5) * 3 * S, y + bl * 0.3, x + (rnd() - 0.5) * 3 * S, y + bl * 0.7, x + (rnd() - 0.5) * 2 * S, y + bl); g.stroke(); }
            g.fillStyle = sh(0.5, 0.7); g.fillRect(k * s + S, y, w, 1.5 * S);
          }
        }
        g.restore();
        g.save(); g.translate(N, 0); g.scale(-1, 1); g.drawImage(g.canvas, 0, 0, N / 2, N, 0, 0, N / 2, N); g.restore();
      }
    };
    draw(g, false);
    const b = mk(); draw(b.getContext('2d'), true); bump = b;
    size = kind === 'oak' ? 1.27 : kind === 'basket' ? 0.8128 : 1.15;   // 7 boards of about 7 in make 1.27 m; 4 basket squares of 8 in make 0.81 m
  } else {
    const rnd = seeded(kind.length * 4099 + 17);
    if (kind === 'tile-large') { // 24 in porcelain, soft veining
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
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / size, 1 / size); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.userData.shared = true;
  if (bump) { const bt = new THREE.CanvasTexture(bump); bt.wrapS = bt.wrapT = THREE.RepeatWrapping; bt.repeat.copy(t.repeat); bt.anisotropy = 8; bt.userData.shared = true; t.userData.bump = bt; }
  texCache.set(key, t); return t;
}
export const clearFloorTextures = () => { for (const t of texCache.values()) { t.userData.bump?.dispose(); t.dispose(); } texCache.clear(); };
/** Roughness for a finish (varnished wood, polished tile). */
export const floorRoughness = (kind) => (kind === 'basket' ? 0.44 : kind === 'parquet' ? 0.5 : kind === 'oak' ? 0.58 : 0.34);
/** The theme-tinted base colour for a finish out of the studio's colour set `C` (wood, tile). */
export function floorBase(kind, C) {
  const wood = C.wood || new THREE.Color(0xc2a27c), tile = C.tile || new THREE.Color(0xc4c6c6);
  if (kind === 'basket') return new THREE.Color(0xbf8847);   // honey oak, as in the listing photos (a golden mid-tone, not brown or orange)
  if (kind === 'parquet') return wood.clone().multiplyScalar(0.92).lerp(new THREE.Color(0x8a5a35), 0.12);
  if (kind === 'oak') return wood.clone().lerp(new THREE.Color(0xe0c9a2), 0.18);
  if (kind === 'tile-large') return tile.clone().lerp(new THREE.Color(0xdcd8d0), 0.5);
  return tile.clone().lerp(new THREE.Color(0xcfd6d8), 0.4);
}

export { sheenTexture } from '../room3d/windows.js';   // [room3d] moved with the windows

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
  const [ox, oy] = opts.origin || [0, 0], cut = opts.cut ?? null, dark = false /* [room3d] the room is bright white trim in both UI themes: the dark-room look is gone */, H = model.ceiling;
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

  // [room3d] windows: reveal, stool, apron, casings, a slim frame with posts only where panes meet, glass with a faint reflection (room3d/windows.js, shared by both engines)
  for (const c of [...windowGroup(model, { origin: [ox, oy], cut, sheen: opts.sheen }).children]) g.add(c);   // (flat, so glass panes stay children of the detail group)

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
