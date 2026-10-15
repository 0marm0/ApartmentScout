// Furniture as proper low-poly models for the Floor plan studio and Unit 3D's Inside view: a sofa with arms, seat and back
// cushions and legs, a bed with an upholstered headboard, mattress, duvet and pillows, a dining set, a desk with a drawer
// unit and a chair, nightstands and dressers with drawers, a coffee table, a wall TV, a rug with a border, and plants. Every
// piece is built at the plan's own size (the item's w, d, h in inches), so what is drawn is what the fit checks measure.
// Soft shapes are rounded pads (an extruded rounded rectangle with a bevelled edge); a few hundred triangles each, so Fast mode
// and phones stay light. Local frame of a piece: inches, origin at the centre of its footprint on the floor, +y up, +z the front.
import * as THREE from 'three';
import { MAT } from './catalog.js';

const TAU = Math.PI * 2;

/** A rounded rectangle in the XY plane, centred, as a three.js Shape. */
function roundedRect(w, d, r) {
  const x = w / 2, y = d / 2, c = Math.max(0.01, Math.min(r, x - 0.01, y - 0.01)), s = new THREE.Shape();
  s.moveTo(-x + c, -y); s.lineTo(x - c, -y); s.quadraticCurveTo(x, -y, x, -y + c); s.lineTo(x, y - c); s.quadraticCurveTo(x, y, x - c, y);
  s.lineTo(-x + c, y); s.quadraticCurveTo(-x, y, -x, y - c); s.lineTo(-x, -y + c); s.quadraticCurveTo(-x, -y, -x + c, -y);
  return s;
}
/**
 * A pad: a w x h x d block (inches) with rounded vertical corners (radius `rc`) and a bevelled top and bottom edge (`bev`).
 * Bottom sits at y = 0, centred in x and z.
 */
export function padGeo(w, h, d, bev = 1.2, rc = bev * 1.6, seg = 2) {
  bev = Math.max(0.05, Math.min(bev, w / 2.2, d / 2.2, h / 2.2));
  const g = new THREE.ExtrudeGeometry(roundedRect(Math.max(0.2, w - 2 * bev), Math.max(0.2, d - 2 * bev), Math.max(0.05, rc - bev * 0.5)), {
    depth: Math.max(0.1, h - 2 * bev), bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: seg, curveSegments: 3,
  });
  g.rotateX(-Math.PI / 2); g.translate(0, bev, 0);
  return g;
}

const cache = new Map();
/** Procedural textures shared between pieces (never disposed with a piece). */
function canvasTex(key, w, h, draw) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.userData.shared = true; cache.set(key, t); return t;
}
const screenTex = () => canvasTex('screen', 256, 144, (g, w, h) => {
  const k = g.createLinearGradient(0, 0, w, h); k.addColorStop(0, '#121a2a'); k.addColorStop(0.45, '#070a10'); k.addColorStop(0.5, '#1b2438'); k.addColorStop(0.56, '#05070b'); k.addColorStop(1, '#0a0f18');
  g.fillStyle = k; g.fillRect(0, 0, w, h);
});
const hex = (c) => `#${new THREE.Color(c).getHexString()}`;
function rugTex(color) {
  return canvasTex(`rug|${hex(color)}`, 256, 256, (g, w, h) => {
    const base = new THREE.Color(color), dark = base.clone().multiplyScalar(0.62), light = base.clone().lerp(new THREE.Color(0xf4efe4), 0.5);
    g.fillStyle = hex(base); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.035)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.strokeStyle = hex(dark); g.lineWidth = 7; g.strokeRect(14, 14, w - 28, h - 28);
    g.strokeStyle = hex(light); g.lineWidth = 3; g.strokeRect(26, 26, w - 52, h - 52);
    g.strokeStyle = hex(light); g.lineWidth = 2; g.globalAlpha = 0.55;
    for (let k = 0; k < 4; k++) { const r = 30 + k * 22; g.beginPath(); g.moveTo(w / 2, h / 2 - r); g.lineTo(w / 2 + r, h / 2); g.lineTo(w / 2, h / 2 + r); g.lineTo(w / 2 - r, h / 2); g.closePath(); g.stroke(); }
    g.globalAlpha = 1;
  });
}

/**
 * Build the piece into `s` when this module draws its kind; returns false otherwise (the studio's own simple model is used).
 * `ctx` = {s: THREE.Group (inches), std(color, opts), fabric(color, opts), texture(kind, color)} from plan/scene3d.js.
 */
export function build(it, ctx) {
  const fn = BUILD[it.kind];
  if (!fn) return false;
  const { s, std, fabric } = ctx, P = {
    pad(w, h, d, mat, x, y, z, bev, rc) { const m = new THREE.Mesh(padGeo(w, h, d, bev, rc), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; s.add(m); return m; },
    box(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; s.add(m); return m; },
    cyl(r0, r1, h, mat, x, y, z, seg = 14) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, seg), mat); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; s.add(m); return m; },
    sph(r, mat, x, y, z, sx = 1, sy = 1, sz = 1) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; s.add(m); return m; },
    std, fabric, s, MAT, ctx,
  };
  fn(it, P);
  return true;
}

const leg = (P, mat, x, z, h, r0 = 0.9, r1 = 1.4) => P.cyl(r0, r1, h, mat, x, 0, z, 10);
const tone = (c, k) => new THREE.Color(c).multiplyScalar(k);
const accentWarm = 0xb7774f, accentOchre = 0xd2a14a;

// ------------------------------------------------------------------ sofa, sleeper, loveseat, armchair
function sofa(it, P) {
  const { w, d, h } = it, hw = w / 2, hd = d / 2, chair = it.kind === 'chair', flat = it.variant === 'bed';
  const col = it.base?.color ?? MAT.fabric, fab = P.fabric(col), fabDark = P.fabric(tone(col, 0.78)), wood = P.std(MAT.woodDark, { roughness: 0.55 });
  const legH = 5.5, arm = chair ? 5 : 6, armH = flat ? 14 : Math.min(h * 0.68, 24);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(P, wood, sx * (hw - 3), sz * (hd - 3), legH);
  if (flat) {   // opened as a bed: one long cushion between low arms
    P.pad(w, armH - legH, d, fabDark, 0, legH, 0, 1.6);
    P.pad(w - 2 * arm, 5, d - 1, fab, 0, armH - 1, 0.2, 1.6);
    P.pad(w - 2 * arm, 12, 7, fab, 0, armH + 2, -hd + 4, 2.4);
    return;
  }
  P.pad(w - 2 * arm, 8, d - 2, fabDark, 0, legH, 0, 1.2);                       // seat base between the arms
  for (const sx of [-1, 1]) P.pad(arm, armH - legH, d, fab, sx * (hw - arm / 2), legH, 0, 2, 2.6);   // arms, rolled top
  const inner = w - 2 * arm, n = Math.max(1, Math.round(inner / 26)), cw = inner / n;
  const seatTop = legH + 8;
  for (let i = 0; i < n; i++) {   // seat cushions and back cushions, a hair apart
    const x = -inner / 2 + cw * (i + 0.5);
    P.pad(cw - 0.8, 5.6, d - 10.5, fab, x, seatTop, 4.2, 1.8, 2.4);
    const back = P.pad(cw - 0.8, h - seatTop - 6.5, 6.4, fab, x, seatTop + 4.6, -hd + 10.6, 2, 2.4); back.rotation.x = -0.16;
  }
  P.pad(inner + 2, h - legH - 2, 6.2, fabDark, 0, legH, -hd + 3.2, 1.4, 2);       // the frame behind the back cushions
  const throwPillow = P.pad(Math.min(17, cw - 6), 16, 4.6, P.fabric(chair ? accentOchre : accentWarm), -inner / 2 + 8, seatTop + 5.2, -hd + 12.6, 2, 2.4);
  throwPillow.rotation.set(-0.32, 0.4, 0.04);
}

// ------------------------------------------------------------------ beds
function bed(it, P) {
  const { w, d, h } = it, hw = w / 2, hd = d / 2, storage = !!it.base?.storage;
  const [mw0, md0] = it.productInfo?.mattress || it.base?.mattress || [w - 4, d - 4], mw = Math.min(mw0, w - 2), md = Math.min(md0, d - 3);
  const head = P.fabric(it.base?.color ?? MAT.fabric), woodDark = P.std(MAT.woodDark, { roughness: 0.55 });
  const deck = storage ? 14 : 11, linen = P.std(MAT.linen, { roughness: 0.92 }), duvetM = P.fabric(MAT.duvet), pil = P.std(MAT.pillow, { roughness: 0.94 });
  // headboard: upholstered panel with channels, on two posts
  P.pad(w + 2, h - 3, 4.6, head, 0, 3, -hd + 2.3, 1.6, 2.2);
  for (let i = 1; i < 5; i++) { const ch = P.box(0.5, h - 10, 0.5, P.std(tone(it.base?.color ?? MAT.fabric, 0.7)), -w / 2 + (w * i) / 5 + 1, 6, -hd + 4.9); ch.castShadow = false; }
  // base: a platform with a shadow gap, or a drawered box
  P.pad(w - 1.5, deck - 3, d - 4, storage ? P.fabric(MAT.fabric) : woodDark, 0, 3, 2.2, 0.8, 1.2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(2.2, 3, 2.2, woodDark, sx * (hw - 4), 0, sz * (hd - 5) + 1);
  if (storage) {
    const sides = it.variant === 'foot' ? ['foot'] : it.variant === 'left' ? ['left'] : it.variant === 'right' ? ['right'] : ['left', 'right'], oak = P.std(MAT.oak, { roughness: 0.6 }), brass = P.std(MAT.brass, { roughness: 0.3, metalness: 0.8 });
    for (const sd of sides) {
      if (sd === 'foot') { for (const sx of [-1, 1]) { P.pad(w / 2 - 4, deck - 5, 0.8, oak, sx * w / 4, 3.5, hd - 1.2, 0.3, 0.5); P.box(6, 0.8, 0.8, brass, sx * w / 4, deck / 2 + 1.6, hd - 0.6); } continue; }
      const sx = sd === 'left' ? -1 : 1;
      for (const k of [-1, 1]) { P.pad(0.8, deck - 5, d / 2 - 8, oak, sx * (hw - 0.8), 3.5, 6 + k * (d / 4 - 1), 0.3, 0.5); P.box(0.8, 0.8, 6, brass, sx * (hw - 0.4), deck / 2 + 1.6, 6 + k * (d / 4 - 1)); }
    }
  }
  // mattress, duvet with a turned-down top, pillows, a throw at the foot
  const mz = (-hd + 5 + hd - 1) / 2 + 0.5;
  P.pad(mw, 9.5, md, linen, 0, deck, mz, 2.4, 3);
  const dl = md * 0.74, dz = hd - 1 - dl / 2 - 0.2;
  P.pad(mw + 3.6, 4.6, dl, duvetM, 0, deck + 8.4, dz, 1.9, 2.6);
  for (const sx of [-1, 1]) P.pad(2.4, 9, dl - 4, duvetM, sx * (mw / 2 + 1.6), deck + 2.2, dz, 1, 1.4);   // the duvet hangs down both sides
  const fold = P.cyl(2.4, 2.4, mw + 2.4, P.fabric(tone(MAT.duvet, 1.12)), 0, deck + 10.5, dz - dl / 2 + 2); fold.rotation.z = Math.PI / 2; fold.position.y = deck + 11.2;
  const pw = Math.min(26, mw / 2 - 2);
  for (const sx of [-1, 1]) { const p = P.pad(pw, 5.4, 16, pil, sx * (mw / 4 + 0.5), deck + 9.4, -hd + 12.5, 2.4, 3); p.rotation.x = -0.2; }
  const throwM = P.pad(mw * 0.96, 1.6, 15, P.fabric(accentWarm), 0, deck + 11.4, hd - 11, 0.7, 1); throwM.rotation.x = 0.02;
}

// ------------------------------------------------------------------ nightstand, dresser, wardrobe-like storage
function drawers(it, P, rows, { legH = 4, top = 1.3, pulls = 'bar' } = {}) {
  const { w, d, h } = it, hd = d / 2, col = it.base?.color ?? MAT.wood, body = P.std(col, { roughness: 0.6 }), front = P.std(tone(col, 1.08), { roughness: 0.55 }), dark = P.std(0x2a2724, { roughness: 0.5 });
  const brass = P.std(MAT.brass, { roughness: 0.3, metalness: 0.85 }), wood = P.std(MAT.woodDark, { roughness: 0.55 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(P, wood, sx * (w / 2 - 2.2), sz * (hd - 2.2), legH, 0.8, 1.2);
  P.pad(w - 0.6, h - legH - top, d - 0.6, body, 0, legH, 0, 0.5, 0.9);
  P.pad(w + 0.8, top, d + 0.8, P.std(tone(col, 0.88), { roughness: 0.5 }), 0, h - top, 0, 0.35, 0.6);   // top slab, a lip proud of the carcase
  const innerH = h - legH - top - 2, rh = innerH / rows;
  for (let i = 0; i < rows; i++) {
    const y = legH + 1 + rh * i;
    P.pad(w - 2.4, rh - 0.9, 0.8, front, 0, y, hd - 0.1, 0.25, 0.5);
    if (pulls === 'bar') P.box(Math.min(7, w * 0.3), 0.7, 0.7, brass, 0, y + rh * 0.62, hd + 0.7);
    else P.box(Math.min(10, w * 0.4), 0.5, 0.3, dark, 0, y + rh - 1.6, hd + 0.5);
  }
}
const nightstand = (it, P) => drawers(it, P, 2, { legH: 5, pulls: 'bar' });
const dresser = (it, P) => drawers(it, P, Math.max(3, Math.round(it.h / 10)), { legH: 4, pulls: 'bar' });

// ------------------------------------------------------------------ tables and chairs
function chairAt(P, x, z, a, scale = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = a; g.scale.setScalar(scale); P.s.add(g);
  const wood = P.std(MAT.woodDark, { roughness: 0.55 }), seat = P.fabric(MAT.fabricWarm);
  const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  add(padGeo(17, 2.4, 17, 0.9, 2), seat, 0, 16.4, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.6, 0.95, 16.4, 8), wood, sx * 7.4, 8.2, sz * 7.4);
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(1.3, 16, 1.3), wood, sx * 7.4, 26, -7.6);     // back posts
  add(padGeo(16.4, 6.4, 1.8, 0.7, 1.4), seat, 0, 24.5, -7.8).rotation.x = -0.08;                   // back pad
  add(new THREE.BoxGeometry(16, 1.2, 1.4), wood, 0, 33.2, -7.8);
  return g;
}
function table(it, P) {
  const { w, d, h } = it, hw = w / 2, hd = d / 2, col = it.base?.color ?? MAT.wood, top = P.std(col, { roughness: 0.5 }), wood = P.std(MAT.woodDark, { roughness: 0.55 });
  if (it.base?.round) {
    P.pad(w, 1.6, d, top, 0, h - 1.6, 0, 0.5, w / 2);
    P.cyl(2, 2.6, h - 4, wood, 0, 2, 0, 16); P.cyl(10, 10, 1.6, wood, 0, 0.4, 0, 28);
  } else {
    P.pad(w, 1.6, d, top, 0, h - 1.6, 0, 0.55, 1.4);
    P.pad(w - 4, 3.2, d - 4, wood, 0, h - 4.8, 0, 0.3, 0.6);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(P, wood, sx * (hw - 3), sz * (hd - 3), h - 1.6, 0.8, 1.5);
  }
  for (const [x, z, a] of ctx_chairs(it)) chairAt(P, x, z, a);
}
let chairSpotsFn = null;
export const setChairSpots = (fn) => { chairSpotsFn = fn; };   // scene3d.chairSpots, handed over to avoid a module cycle
const ctx_chairs = (it) => (chairSpotsFn ? chairSpotsFn(it) : []);

function coffeeTable(it, P) {
  const { w, d, h } = it, hw = w / 2, hd = d / 2, col = it.base?.color ?? MAT.wood, top = P.std(col, { roughness: 0.5 }), wood = P.std(MAT.woodDark, { roughness: 0.55 });
  P.pad(w, 1.8, d, top, 0, h - 1.8, 0, 0.6, 2);
  P.pad(w - 6, 0.9, d - 6, wood, 0, 4.4, 0, 0.3, 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(P, wood, sx * (hw - 3), sz * (hd - 3), h - 1.8, 0.8, 1.3);
}

function desk(it, P) {
  const { w, d, h } = it, hw = w / 2, hd = d / 2, col = it.base?.color ?? MAT.oak, top = P.std(col, { roughness: 0.5 }), wood = P.std(MAT.woodDark, { roughness: 0.55 }), white = P.std(MAT.white, { roughness: 0.5 });
  const brass = P.std(MAT.brass, { roughness: 0.3, metalness: 0.85 });
  P.pad(w, 1.4, d, top, 0, h - 1.4, 0, 0.5, 1.2);
  const drawerW = Math.min(16, w * 0.3);
  P.pad(1.4, h - 1.4, d - 1.5, wood, -hw + 1.2, 0, 0, 0.3, 0.5);                                       // left panel leg
  P.pad(drawerW, h - 1.4, d - 1.5, wood, hw - drawerW / 2 - 0.6, 0, 0, 0.3, 0.6);                      // right: a drawer unit
  for (let i = 0; i < 3; i++) { P.pad(drawerW - 1.8, (h - 4) / 3 - 1, 0.6, P.std(tone(col, 1.1)), hw - drawerW / 2 - 0.6, 1.6 + i * ((h - 4) / 3), hd - 0.6, 0.2, 0.4); P.box(3.4, 0.6, 0.6, brass, hw - drawerW / 2 - 0.6, 1.6 + i * ((h - 4) / 3) + (h - 4) / 6, hd - 0.1); }
  P.box(w - drawerW - 4, 9, 0.8, wood, -(drawerW) / 2, h - 11, -hd + 2);                                // modesty panel
  // laptop and a mug, so a desk reads as a desk
  P.pad(13, 0.7, 9, P.std(0xbdbdbd, { roughness: 0.4, metalness: 0.6 }), -hw / 3, h, 1, 0.25, 0.8);
  const lid = P.pad(13, 8.5, 0.5, P.std(0x1c1f24, { roughness: 0.3, metalness: 0.4 }), -hw / 3, h + 0.5, -3.6, 0.2, 0.5); lid.rotation.x = -0.25;
  P.cyl(1.6, 1.6, 3.6, white, hw / 3 + 6, h, -2, 14);
  // chair
  const cz = hd + 12, fab = P.fabric(MAT.fabric), metal = P.std(MAT.metal, { roughness: 0.4, metalness: 0.5 });
  P.cyl(1, 1, 14, metal, 0, 1.6, cz, 8);
  for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU, sp = P.box(9, 1.1, 1.4, metal, Math.cos(a) * 4.5, 1.2, cz + Math.sin(a) * 4.5); sp.rotation.y = -a; P.sph(1.1, metal, Math.cos(a) * 9, 1, cz + Math.sin(a) * 9); }
  P.pad(18, 3.4, 17.5, fab, 0, 16, cz, 1.2, 2.4);
  const back = P.pad(17, 17, 3.2, fab, 0, 19, cz + 9, 1.4, 2.4); back.rotation.x = 0.12;
  for (const sx of [-1, 1]) P.pad(2, 1.4, 11, metal, sx * 9.4, 24, cz + 1, 0.4, 0.8);
}

// ------------------------------------------------------------------ TV
function tv(it, P) {
  const { w, d, h } = it, scrW = it.screen || w, scrH = it.mount === 'wall' ? h : scrW * 0.574;
  const body = P.std(MAT.screen, { roughness: 0.4, metalness: 0.2 }), glass = new THREE.MeshStandardMaterial({ map: screenTex(), roughness: 0.12, metalness: 0.35, color: 0xffffff });
  if (it.mount === 'wall') {
    const e = it.elev || 0, hd = d / 2, cy = e + scrH / 2;
    P.pad(14, scrH * 0.45, 1.3, P.std(MAT.metal, { roughness: 0.5, metalness: 0.4 }), 0, cy - scrH * 0.22, -hd + 0.65, 0.2, 0.4);   // the bracket, behind the screen
    P.pad(scrW - 6, scrH - 4, 1.4, body, 0, e + 2, -hd + 1.9, 0.3, 0.6);                                                              // the set's slim back
    P.pad(scrW, scrH, 0.9, body, 0, e, -hd + 2.5, 0.25, 0.4);                                                                          // bezel
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(scrW - 0.9, scrH - 0.9), glass); scr.position.set(0, cy, -hd + 3.0); P.s.add(scr);
  } else {
    const hd = d / 2, wood = P.std(it.base?.color ?? MAT.woodDark, { roughness: 0.55 });
    P.pad(w, h - 2, d, wood, 0, 2, 0, 0.6, 1.2);
    for (const sx of [-1, 1]) P.box(1.6, 2, d - 2, P.std(MAT.metal), sx * (w / 2 - 3), 0, 0);
    for (const sx of [-1, 1]) P.pad(w / 2 - 2, h - 5, 0.6, P.std(tone(it.base?.color ?? MAT.woodDark, 1.12)), sx * (w / 4), 3, hd - 0.1, 0.2, 0.4);
    P.box(10, 1, 7, P.std(MAT.metal), 0, h, 0); P.box(2, 3, 1, P.std(MAT.metal), 0, h + 1, 0);
    P.pad(scrW, scrH, 1.6, body, 0, h + 3.4, 0, 0.25, 0.4);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(scrW - 0.9, scrH - 0.9), glass); scr.position.set(0, h + 3.4 + scrH / 2 + 0.2, 0.9); P.s.add(scr);
  }
}

// ------------------------------------------------------------------ rug
function rug(it, P) {
  const { w, d } = it, round = it.variant === 'round6', col = it.base?.color ?? MAT.rug, tex = rugTex(col);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const mat = P.std(0xffffff, { map: tex, roughness: 1 });
  const m = round ? P.cyl(w / 2, w / 2, 0.5, mat, 0, 0, 0, 48) : P.pad(w, 0.5, d, mat, 0, 0, 0, 0.2, 0.6);
  m.castShadow = false;
}

// ------------------------------------------------------------------ plants
function plant(it, P) {
  const { w, h } = it, e = it.elev || 0, small = h <= 24, green = [0x4f7a5a, 0x5d8a62, 0x41694d, 0x6b9468];
  const pot = P.std(0xe8e2d6, { roughness: 0.6 }), soil = P.std(0x3b2f27, { roughness: 1 });
  const potH = small ? 5.5 : 12, potR = small ? 3.4 : 7.2;
  P.cyl(potR * 0.72, potR, potH, pot, 0, e, 0, 20);
  P.cyl(potR * 0.9, potR * 0.9, 0.4, soil, 0, e + potH - 0.2, 0, 16);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stem = P.std(0x5b4a36, { roughness: 0.9 });
  if (small) {   // a snake plant: upright blades
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU + rnd(), r = 0.8 + rnd() * 1.4, bh = h - potH + 3 + rnd() * 3; const b = P.cyl(0.1, 1.5, bh, P.std(green[i % 4], { roughness: 0.55 }), Math.cos(a) * r, e + potH - 0.5, Math.sin(a) * r, 5); b.scale.z = 0.35; b.rotation.set(Math.sin(a) * 0.12, a, Math.cos(a) * 0.12); }
    return;
  }
  // a fiddle-leaf fig: a trunk and rings of broad leaves
  const trunkH = h - potH - 14;
  P.cyl(0.5, 0.9, trunkH + 10, stem, 0, e + potH, 0, 8);
  const leaves = 26;
  for (let i = 0; i < leaves; i++) {
    const t = i / leaves, a = i * 2.4 + rnd() * 0.5, y = e + potH + trunkH * 0.35 + t * (h - potH - trunkH * 0.35 - 3), r = 2.5 + (1 - Math.abs(t - 0.45)) * 4.6;
    const leaf = P.sph(1, P.std(green[i % 4], { roughness: 0.5, side: THREE.DoubleSide }), Math.cos(a) * r, y, Math.sin(a) * r, 3.6, 0.5, 5.2);
    leaf.rotation.set(0.5 + rnd() * 0.3, -a + Math.PI / 2, 0.25 * (rnd() - 0.5)); leaf.castShadow = true;
  }
  void w;
}

const BUILD = { sofa, chair: sofa, bed, nightstand, dresser, 'table-low': coffeeTable, table, desk, tv, rug, plant };
