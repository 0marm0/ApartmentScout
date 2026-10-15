// [room3d] The shared furniture models for both 3D engines. build(it, ctx) draws a piece into ctx.s (inches, origin at the centre of
// the footprint on the floor, +y up, +z the front) and returns true, or returns false so plan/furniture3d.js draws it.
//
// Refined low-poly pieces: soft boxes (rounded on every edge, optionally puffed like a cushion, pinched like a pillow or dimpled
// by buttons), a draped-cloth sheet for duvets and throws, lathed pots and tops, tapered legs, and merged meshes for the small
// repeated parts (buttons, books, leaves, pulls) so a piece stays a few dozen draw calls. Every piece is drawn at the item's own
// w x d x h, the size the fit checks measure. Quality: 'fast' (the default) uses one bevel step, plain boards and no clutter;
// 'visual' adds bevels, cushion crowns, piping, tufts, duvet folds, pillows, books and desk things. Budgets: about 1,500
// triangles a piece in Fast and 6,000 in Visual. Canvas textures (wood grain, weave, rugs, screens, keys) are made once per page,
// marked userData.shared so the studio's disposal keeps them, and never at import time (the module loads in Node too).
import * as THREE from 'three';
import { MAT } from '../plan/catalog.js';
import { lookOf, partLook } from '../plan/looks.js';   // the renter's colour, material and finish for each piece (furniture.json `look`)

const TAU = Math.PI * 2, IN = 0.0254, COLOR_CHAIR = 0x35383d;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sat = (v) => clamp(v, 0, 1);
const lum = (c) => { const [r, g, b] = [0, 1, 2].map((i) => srgb(c)[i] / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const tone = (c, k) => new THREE.Color(c).multiplyScalar(k);
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
const hexOf = (c) => new THREE.Color(c).getHexString();
function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const hashStr = (str) => [...String(str)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
/** sRGB 0..255 components of a colour (THREE.Color keeps linear values). */
function srgb(c, k = 1) { const o = { r: 0, g: 0, b: 0 }; new THREE.Color(c).getRGB(o, THREE.SRGBColorSpace); return [o.r, o.g, o.b].map((v) => clamp(Math.round(v * k * 255), 0, 255)); }
const css = (c, k = 1, a = 1) => { const [r, g, b] = srgb(c, k); return `rgba(${r},${g},${b},${a})`; };
/** Roughness by material and finish (a matte paint scatters, a gloss one shows the room in it). */
const ROUGH = {
  leather: { matte: 0.62, satin: 0.5, sheen: 0.4, gloss: 0.28 }, wood: { matte: 0.72, satin: 0.5, sheen: 0.4, gloss: 0.26 },
  metal: { matte: 0.55, satin: 0.38, sheen: 0.3, gloss: 0.18 }, paint: { matte: 0.78, satin: 0.5, sheen: 0.38, gloss: 0.22 },
  fabric: { matte: 0.93, satin: 0.9, sheen: 0.85, gloss: 0.8 },
};
/** A copy of a look with its colour scaled (a darker leg, a lighter drawer front). */
const shade = (spec, k) => ({ ...spec, color: tone(spec.color, k).getHex() });
const isLight = (c) => { const [r, g, b] = srgb(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.72; };

// Accent colours for pillows, throws and books (data, not UI chrome).
const ACC = { rust: 0xb7774f, ochre: 0xd2a14a, sage: 0x93a88f, cream: 0xe9e1d0, ink: 0x34404f, clay: 0xc98f6d, plum: 0x6e5470 };
const BOOKS = [0x7b3b2f, 0x2f4b5e, 0xc9a35a, 0x5d6e57, 0xa9b8c7, 0x3c3a36, 0xb56a4a, 0xe4dccb, 0x6b5b7b, 0x8a2e2e, 0x40566b, 0xd8cfb8];

// ------------------------------------------------------------------ shared canvas textures (made lazily, once per page)
const TEX = new Map();
function canvasTex(key, w, h, draw, { repeat = null, wrap = true } = {}) {
  if (TEX.has(key)) return TEX.get(key);
  if (typeof document === 'undefined' || !document.createElement) { TEX.set(key, null); return null; }
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.userData.shared = true; TEX.set(key, t); return t;
}
/** Wood grain, near white so it multiplies the material colour; UVs are metres, one tile is 1 m along the grain and 0.5 m across it.
 *  Grain runs along u. Plain-sawn figure (nested arcs), long fine grain lines, tonal drift between growth bands and open pores; every
 *  stroke is periodic in x and wrapped in y, so the tile repeats without a seam. Also the bump map of a wood material in Visual. */
const grainTex = () => canvasTex('r3-grain2', 1024, 512, (g, W, H) => {
  const r = rng(11); g.fillStyle = '#f4eee4'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 16; i++) { const y = r() * H, hh = 10 + r() * 64, a = 0.03 + r() * 0.06; g.fillStyle = r() < 0.6 ? `rgba(128,90,56,${a})` : `rgba(255,251,242,${a})`; for (const o of [-H, 0, H]) g.fillRect(0, y + o, W, hh); }
  const wave = (y0, amp, k, ph, k2, a2, ph2) => (x) => y0 + amp * Math.sin((x / W) * TAU * k + ph) + a2 * Math.sin((x / W) * TAU * k2 + ph2);
  const stroke = (fn, col, lw) => { g.strokeStyle = col; g.lineWidth = lw; for (const o of [-H, 0, H]) { g.beginPath(); for (let x = 0; x <= W; x += 6) { const y = fn(x) + o; if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); } };
  for (let c = 0; c < 5; c++) {   // plain-sawn figure: a family of nested arcs around a few centres
    const cy = r() * H, w0 = 8 + r() * 14;
    for (let j = 0; j < 9; j++) stroke(wave(cy + (j - 4) * (w0 + j * 1.2), 6 + j * 3.2, 1, r() * TAU, 6 + (r() * 3 | 0), 0.7, r() * TAU), `rgba(96,64,38,${0.05 + r() * 0.07})`, 0.9 + r() * 1.3);
  }
  for (let i = 0; i < 300; i++) stroke(wave(r() * H, 0.6 + r() * 4.5, 1 + (r() * 3 | 0), r() * TAU, 5 + (r() * 6 | 0), 0.3 + r() * 0.5, r() * TAU), `rgba(${r() < 0.88 ? '92,62,38' : '255,250,240'},${0.04 + r() * 0.15})`, 0.4 + r() * 1.5);
  for (let i = 0; i < 2600; i++) { const x = r() * W, y = r() * H, L = 2 + r() * 10; g.fillStyle = `rgba(66,42,24,${0.08 + r() * 0.2})`; g.fillRect(x, y, L, 0.8 + r() * 0.7); if (x + L > W) g.fillRect(x - W, y, L, 1); }
}, { repeat: [1, 2] });
/** A printed wood-grain foil (a laminate such as IKEA's black-brown): a dark base with a low-contrast, mostly vertical grain; near white
 *  in the light parts so it multiplies the colour, with the streaks pulled down to about 60 %. One tile is 0.4 m. */
const foilTex = () => canvasTex('r3-foil', 512, 512, (g, W, H) => {
  const r = rng(29); g.fillStyle = '#e9e4de'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 12; i++) { const y = r() * H, hh = 8 + r() * 50; g.fillStyle = `rgba(70,50,36,${0.05 + r() * 0.1})`; for (const o of [-H, 0, H]) g.fillRect(0, y + o, W, hh); }
  for (let i = 0; i < 360; i++) {
    const y0 = r() * H, amp = 0.5 + r() * 3, k = 1 + (r() * 2 | 0), ph = r() * TAU, k2 = 6 + (r() * 5 | 0), ph2 = r() * TAU; g.strokeStyle = `rgba(${r() < 0.8 ? '40,28,20' : '255,245,235'},${0.06 + r() * 0.18})`; g.lineWidth = 0.4 + r() * 1.5;
    for (const o of [-H, 0, H]) { g.beginPath(); for (let x = 0; x <= W; x += 6) { const y = y0 + o + amp * Math.sin((x / W) * TAU * k + ph) + 0.4 * Math.sin((x / W) * TAU * k2 + ph2); if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
  }
  for (let i = 0; i < 1100; i++) { const x = r() * W, y = r() * H; g.fillStyle = `rgba(30,20,14,${0.05 + r() * 0.12})`; g.fillRect(x, y, 2 + r() * 7, 0.7 + r() * 0.6); }
}, { repeat: [2.5, 2.5] });
/** Upholstery weave: a basket weave with fine noise and slubs; one tile is 20 cm. */
const weaveTex = () => canvasTex('r3-weave', 256, 256, (g, W, H) => {
  const r = rng(5), im = g.createImageData(W, H), D = im.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, v = clamp(234 + ((((x >> 1) ^ (y >> 1)) & 1) ? 6 : -6) + (r() - 0.5) * 22, 0, 255);
    D[i] = D[i + 1] = D[i + 2] = v; D[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  for (let k = 0; k < 170; k++) { const x = r() * W, y = r() * H, L = 4 + r() * 16; g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.05 + r() * 0.07})` : `rgba(0,0,0,${0.04 + r() * 0.05})`; g.fillRect(x, y, L, 1.5); g.fillRect(x - W, y, L, 1.5); }
}, { repeat: [5, 5] });
/** Pebbled leather as a grey height map (a bump map: it adds grain to the light, not a colour); one tile is 16 cm. */
const leatherTex = () => canvasTex('r3-leather', 256, 256, (g, W, H) => {
  const r = rng(23); g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, W, H);
  // a jittered grid of soft pebbles with darker creases between them, wrapped so the tile repeats cleanly
  const n = 22, cw = W / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const cx = (i + 0.5 + (r() - 0.5) * 0.7) * cw, cy = (j + 0.5 + (r() - 0.5) * 0.7) * cw, rad = cw * (0.5 + r() * 0.16), v = 150 + r() * 70;
    for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
      const x = cx + ox, y = cy + oy; if (x < -rad || y < -rad || x > W + rad || y > H + rad) continue;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgb(${v},${v},${v})`); gr.addColorStop(0.7, `rgb(${v * 0.78 | 0},${v * 0.78 | 0},${v * 0.78 | 0})`); gr.addColorStop(1, 'rgba(60,60,60,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    }
  }
}, { repeat: [6.25, 6.25] });
/** A box-quilted duvet cover, near white: soft squares (20 cm) with a faint stitched seam between them, puffed in the middle. One tile is 40 cm. */
const quiltTex = () => canvasTex('r3-quilt', 256, 256, (g, W, H) => {
  const q = W / 2, r = rng(41); g.fillStyle = '#efece6'; g.fillRect(0, 0, W, H);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const gr = g.createRadialGradient(q * (i + 0.5), q * (j + 0.5), 2, q * (i + 0.5), q * (j + 0.5), q * 0.78); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(120,112,100,0.20)'); g.fillStyle = gr; g.fillRect(i * q, j * q, q, q); }
  g.strokeStyle = 'rgba(95,88,78,0.5)'; g.lineWidth = 1.4; g.setLineDash([5, 3]);
  for (const t of [0, q]) { g.beginPath(); g.moveTo(t, 0); g.lineTo(t, H); g.stroke(); g.beginPath(); g.moveTo(0, t); g.lineTo(W, t); g.stroke(); }
  g.setLineDash([]); const im = g.getImageData(0, 0, W, H), D = im.data;
  for (let i = 0; i < W * H; i++) { const k = 1 + (r() - 0.5) * 0.05; D[i * 4] *= k; D[i * 4 + 1] *= k; D[i * 4 + 2] *= k; }
  g.putImageData(im, 0, 0);
}, { repeat: [2.5, 2.5] });
/** Chunky knit for a throw: columns of V stitches, near white, so it multiplies the yarn colour; one tile is 25 cm (10 stitches across). */
const knitTex = () => canvasTex('r3-knit', 256, 256, (g, W, H) => {
  const r = rng(77); g.fillStyle = '#d9d6d0'; g.fillRect(0, 0, W, H);
  const cw = W / 10, rh = H / 12; g.lineCap = 'round';
  for (let c = 0; c < 10; c++) for (let j = 0; j < 12; j++) {
    const x = c * cw + cw / 2, y = j * rh + rh / 2, v = 0.8 + r() * 0.2;
    g.strokeStyle = `rgba(${(255 * v) | 0},${(252 * v) | 0},${(246 * v) | 0},1)`; g.lineWidth = cw * 0.34;
    g.beginPath(); g.moveTo(x - cw * 0.32, y - rh * 0.42); g.lineTo(x, y + rh * 0.38); g.lineTo(x + cw * 0.32, y - rh * 0.42); g.stroke();
    g.strokeStyle = 'rgba(60,56,50,0.55)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x - cw * 0.32, y - rh * 0.1); g.lineTo(x, y + rh * 0.62); g.lineTo(x + cw * 0.32, y - rh * 0.1); g.stroke();
  }
}, { repeat: [3.2, 3.2] });
/** A switched-off screen: dark glass with a soft diagonal reflection and a vignette. */
const screenTex = () => canvasTex('r3-screen', 256, 160, (g, W, H) => {
  const k = g.createLinearGradient(0, 0, W * 0.35, H); k.addColorStop(0, '#202938'); k.addColorStop(1, '#06080b'); g.fillStyle = k; g.fillRect(0, 0, W, H);
  const s = g.createLinearGradient(W * 0.1, 0, W * 0.75, H); s.addColorStop(0, 'rgba(170,190,220,0)'); s.addColorStop(0.42, 'rgba(170,190,220,0.12)'); s.addColorStop(0.5, 'rgba(170,190,220,0.03)'); s.addColorStop(0.62, 'rgba(170,190,220,0.07)'); s.addColorStop(1, 'rgba(170,190,220,0)');
  g.fillStyle = s; g.fillRect(0, 0, W, H);
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, W * 0.7); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.4)'); g.fillStyle = v; g.fillRect(0, 0, W, H);
}, { wrap: false });
/** Keyboard keys on an aluminium deck. */
const keysTex = () => canvasTex('r3-keys', 256, 96, (g, W, H) => {
  g.fillStyle = '#b9bdc2'; g.fillRect(0, 0, W, H);
  const rows = 5, cols = 15, kw = (W - 8) / cols, kh = (H - 8) / rows; g.fillStyle = '#f2f3f4';
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (j === rows - 1 && i > 3 && i < 10) { if (i === 4) g.fillRect(4 + i * kw + 1, 4 + j * kh + 1, kw * 6 - 2, kh - 2); continue; }
    g.fillRect(4 + i * kw + 1, 4 + j * kh + 1, kw - 2, kh - 2);
  }
}, { wrap: false });
/** Rug: wool pile noise, a trellis field and a border with a diamond chain, drawn at the rug's own proportions. */
function rugTex(color, wIn, dIn, round) {
  const key = `r3-rug|${hexOf(color)}|${Math.round(wIn)}x${Math.round(dIn)}|${round ? 1 : 0}`;
  const W = 512, H = round ? 512 : clamp(Math.round((512 * dIn) / wIn), 128, 1024);
  return canvasTex(key, W, H, (g) => {
    const r = rng(hashStr(key)), ppi = W / wIn, light = mix(color, 0xf4efe4, 0.55), dark = tone(color, 0.55);
    g.fillStyle = css(color); g.fillRect(0, 0, W, H);
    // field: a soft trellis a shade lighter
    g.save();
    if (round) { g.beginPath(); g.arc(W / 2, H / 2, W / 2, 0, TAU); g.clip(); }
    g.strokeStyle = css(light, 1, 0.16); g.lineWidth = 1.6 * ppi * 0.6;
    const cell = 9 * ppi;
    for (let x = -H; x < W + H; x += cell) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + H, H); g.stroke(); g.beginPath(); g.moveTo(x, H); g.lineTo(x + H, 0); g.stroke(); }
    g.restore();
    // border bands
    const band = (inset, width, col, a = 1) => {
      g.strokeStyle = css(col, 1, a); g.lineWidth = width * ppi;
      if (round) { g.beginPath(); g.arc(W / 2, H / 2, W / 2 - (inset + width / 2) * ppi, 0, TAU); g.stroke(); }
      else { const o = (inset + width / 2) * ppi; g.strokeRect(o, o, W - 2 * o, H - 2 * o); }
    };
    band(0, 1.2, dark, 0.9); band(2.4, 5.2, dark, 0.85); band(8.2, 0.7, light, 0.75); band(1.6, 0.45, light, 0.6);
    // a diamond chain in the wide band
    g.fillStyle = css(light, 1, 0.55); const mid = (2.4 + 2.6) * ppi, step = 5 * ppi, dm = 1.5 * ppi;
    const diamond = (x, y) => { g.beginPath(); g.moveTo(x, y - dm); g.lineTo(x + dm, y); g.lineTo(x, y + dm); g.lineTo(x - dm, y); g.closePath(); g.fill(); };
    if (round) { const R = W / 2 - mid, n = Math.max(12, Math.round((TAU * R) / step)); for (let i = 0; i < n; i++) { const a = (i / n) * TAU; diamond(W / 2 + Math.cos(a) * R, H / 2 + Math.sin(a) * R); } }
    else { for (let x = mid + step / 2; x < W - mid; x += step) { diamond(x, mid); diamond(x, H - mid); } for (let y = mid + step / 2; y < H - mid; y += step) { diamond(mid, y); diamond(W - mid, y); } }
    // pile: fine per-pixel noise, rows of tufts and a soft mottle
    const im = g.getImageData(0, 0, W, H), D = im.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, k = 1 + (r() - 0.5) * 0.17 + ((y & 1) ? 0.02 : -0.02) + 0.045 * Math.sin(x * 0.045 + 1.7) * Math.sin(y * 0.037 + 0.4);
      D[i] = clamp(D[i] * k, 0, 255); D[i + 1] = clamp(D[i + 1] * k, 0, 255); D[i + 2] = clamp(D[i + 2] * k, 0, 255);
    }
    g.putImageData(im, 0, 0);
  }, { wrap: false });
}

// ------------------------------------------------------------------ geometry
/** Metre UVs by box projection along the dominant normal (wood grain and weave then keep their scale on every face). */
function boxUV(g, mode, w, d) {
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  let tall = false;   // a tall member (a table leg, a post): the grain runs up it, so the side faces swap u and v
  if (!mode) { g.computeBoundingBox(); const b = g.boundingBox; tall = b.max.y - b.min.y > 2.2 * Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 1e-3); }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (mode === 'top') { uv.setXY(i, x / w + 0.5, 0.5 - z / d); continue; }
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, x * IN, z * IN); else if (az >= ax) tall ? uv.setXY(i, y * IN, x * IN) : uv.setXY(i, x * IN, y * IN); else tall ? uv.setXY(i, y * IN, z * IN) : uv.setXY(i, z * IN, y * IN);
  }
}
/** Recompute smooth normals and average them across coincident vertices (BoxGeometry faces do not share vertices). */
function weldNormals(g) {
  g.computeVertexNormals();
  const pos = g.attributes.position, nor = g.attributes.normal, acc = new Map(), keys = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 400)},${Math.round(pos.getY(i) * 400)},${Math.round(pos.getZ(i) * 400)}`; keys[i] = k;
    let a = acc.get(k); if (!a) acc.set(k, (a = [0, 0, 0])); a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i);
  }
  for (let i = 0; i < pos.count; i++) { const a = acc.get(keys[i]), l = Math.hypot(a[0], a[1], a[2]) || 1; nor.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); }
}
/**
 * A soft box: w x h x d inches, bottom at y = 0, centred in x and z, every edge rounded with radius `r` in `s` steps, `k` flat
 * segments per axis. Options: puff {px,nx,py,ny,pz,nz} crowns a face like a cushion (pinched at the edges, pow < 1 fuller),
 * tufts {axis, side, pts:[[u,v]], depth, rad} dimples a face, bendZ curves it (z += bendZ * (x/hx)^2), uv 'top' maps the top 0..1.
 */
function softGeo(w, h, d, o = {}) {
  const s = Math.max(1, o.s ?? 2), k = o.k || [1, 1, 1], half = [w / 2, h / 2, d / 2];
  const r = clamp(o.r ?? 1, 0.02, Math.min(...half) - 0.005), n = k.map((ki) => 2 * s + ki), inner = half.map((v) => v - r);
  const g = new THREE.BoxGeometry(1, 1, 1, n[0], n[1], n[2]), pos = g.attributes.position, nor = g.attributes.normal;
  const puff = o.puff, pow = o.pow ?? 1, tufts = o.tufts, smooth = !!(puff || tufts || o.bendZ);
  const AX = ['x', 'y', 'z'], c = [0, 0, 0], q = [0, 0, 0], p = [0, 0, 0], dp = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const t = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    for (let a = 0; a < 3; a++) {
      const idx = Math.round((t[a] + 0.5) * n[a]);
      if (idx < s) { c[a] = -(s - idx) / s; q[a] = -inner[a]; } else if (idx > s + k[a]) { c[a] = (idx - s - k[a]) / s; q[a] = inner[a]; } else { c[a] = 0; q[a] = -inner[a] + (2 * inner[a] * (idx - s)) / k[a]; }
    }
    const L = Math.hypot(c[0], c[1], c[2]) || 1;
    for (let a = 0; a < 3; a++) { c[a] /= L; p[a] = q[a] + c[a] * r; dp[a] = 0; }
    if (puff) for (let a = 0; a < 3; a++) {
      const sg = p[a] >= 0 ? 1 : -1, amt = puff[(sg > 0 ? 'p' : 'n') + AX[a]]; if (!amt) continue;
      const wgt = Math.max(0, c[a] * sg); if (!wgt) continue;
      let fall = 1; for (let b = 0; b < 3; b++) if (b !== a) fall *= Math.max(0, 1 - (p[b] / half[b]) ** 2);
      dp[a] += sg * amt * wgt * fall ** pow;
    }
    if (tufts) {
      const a = tufts.axis, sg = tufts.side, wgt = Math.max(0, c[a] * sg);
      if (wgt > 0) { const [u, v] = [0, 1, 2].filter((b) => b !== a); let dip = 0; for (const [pu, pv] of tufts.pts) dip += Math.exp(-(((p[u] - pu) ** 2 + (p[v] - pv) ** 2) / (tufts.rad * tufts.rad))); dp[a] -= sg * tufts.depth * Math.min(1, dip) * wgt; }
    }
    for (let a = 0; a < 3; a++) p[a] += dp[a];
    if (o.bendZ) p[2] += o.bendZ * (p[0] / half[0]) ** 2;
    pos.setXYZ(i, p[0], p[1] + h / 2, p[2]);
    if (!smooth) nor.setXYZ(i, c[0], c[1], c[2]);
  }
  if (smooth) weldNormals(g);
  boxUV(g, o.uv, w, d);
  if (o.drop) {   // faces nobody sees (the underside on a slatted deck, the back against a rail): 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
    const idx = g.index.array, keep = []; for (const gr of g.groups) if (!o.drop.includes(gr.materialIndex)) for (let i = gr.start; i < gr.start + gr.count; i++) keep.push(idx[i]);
    g.setIndex(keep); g.clearGroups();
  }
  return g;
}
/** A plain box, bottom at y = 0, with metre UVs (Fast mode's boards). */
function boxGeo(w, h, d) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); boxUV(g, null, w, d); return g; }
/** A tapered leg, bottom at y = 0; square legs are 4-sided cylinders turned 45 degrees. */
function legGeo(rTop, rBot, h, seg, square = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, square ? 4 : seg, 1); g.translate(0, h / 2, 0); if (square) g.rotateY(Math.PI / 4);
  const p = g.attributes.position, uv = g.attributes.uv, r = (rTop + rBot) / 2;   // wood grain runs up a leg: u along the height, v round it (metres)
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getY(i) * IN, Math.atan2(p.getZ(i), p.getX(i)) * r * IN);
  return g;
}
/** A rod along x, centred (piping, pull bars, rails). */
function rodGeo(r, len, seg = 8, open = false) { const g = new THREE.CylinderGeometry(r, r, len, seg, 1, open); g.rotateZ(Math.PI / 2); return g; }
/** A lathed solid (pots, tops, vases) with metre UVs projected like a box, so wood grain runs straight across a round top. */
const lathe = (pts, seg) => { const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg); boxUV(g); return g; };
const mtx = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
/** Merge [{g, m, c}] into one non-indexed geometry (with vertex colours when any part has `c`). */
function mergeParts(parts) {
  const list = parts.map(({ g, m, c }) => { const x = g.index ? g.toNonIndexed() : g.clone(); if (m) x.applyMatrix4(m); return [x, c]; });
  const count = list.reduce((a, [x]) => a + x.attributes.position.count, 0), colors = parts.some((p) => p.c != null);
  const P = new Float32Array(count * 3), N = new Float32Array(count * 3), U = new Float32Array(count * 2), C = colors ? new Float32Array(count * 3) : null;
  let o = 0;
  for (const [x, c] of list) {
    const nv = x.attributes.position.count; P.set(x.attributes.position.array, o * 3); N.set(x.attributes.normal.array, o * 3);
    if (x.attributes.uv) U.set(x.attributes.uv.array, o * 2);
    if (C) { const cc = new THREE.Color(c ?? 0xffffff); for (let j = 0; j < nv; j++) C.set([cc.r, cc.g, cc.b], (o + j) * 3); }
    o += nv; x.dispose();
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  if (C) g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  for (const p of parts) if (p.tmp) p.g.dispose();
  return g;
}
/**
 * Cloth draped over a box top: flat at y = top for |x| <= ax, z0 <= z <= z1, rolling over both x edges (and the z1 edge when
 * dropZ > 0) with radius R and hanging `drop` down, flaring out a little, with vertical folds; `ridges` [[cx, cz, angle, width,
 * amplitude, length]] lift soft wrinkles on the top. One indexed grid, smooth normals, metre UVs.
 */
function drapeGeo(o) {
  const Larc = (Math.PI / 2) * o.R, line = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const join = (...ps) => ps.reduce((acc, p) => acc.concat(acc.length ? p.slice(1) : p), []);
  const xr = o.ax + Larc + o.dropX;
  const xs = join(line(-xr, -o.ax - Larc, o.nDrop), line(-o.ax - Larc, -o.ax, o.nArc), line(-o.ax, o.ax, o.nTopX), line(o.ax, o.ax + Larc, o.nArc), line(o.ax + Larc, xr, o.nDrop));
  const zs = o.dropZ > 0 ? join(line(o.z0, o.z1, o.nTopZ), line(o.z1, o.z1 + Larc, o.nArc), line(o.z1 + Larc, o.z1 + Larc + o.dropZ, o.nDrop)) : line(o.z0, o.z1, o.nTopZ);
  const edge = (e, drop, flare) => {   // [outward, down, depth 0..1 in the drop]
    if (e <= 0) return [e, 0, 0];
    if (e <= Larc) { const th = e / o.R; return [o.R * Math.sin(th), o.R * (1 - Math.cos(th)), 0]; }
    const t = drop > 0 ? sat((e - Larc) / drop) : 0; return [o.R + flare * t * t, o.R + (e - Larc), t];
  };
  const cols = xs.length, rows = zs.length, P = new Float32Array(cols * rows * 3), U = new Float32Array(cols * rows * 2), idx = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const sx = xs[i], sz = zs[j], sg = sx < 0 ? -1 : 1;
    const [ox, dx, tx] = edge(Math.abs(sx) - o.ax, o.dropX, o.flareX ?? 0.5), [oz, dz, tz] = o.dropZ > 0 ? edge(sz - o.z1, o.dropZ, o.flareZ ?? 0.3) : [sz - o.z1, 0, 0];
    let x = sg * (o.ax + ox), z = o.z1 + oz, y = o.top - Math.max(dx, dz);
    if (tx > 0) x += sg * o.fold * tx ** 0.8 * Math.sin((sz / o.period) * TAU + (sg > 0 ? 1.3 : 0.2));
    if (tz > 0) z += o.fold * tz ** 0.8 * Math.sin((sx / o.period) * TAU + 0.7);
    const wEdge = sat((o.ax - Math.abs(sx)) / 5) * (o.dropZ > 0 ? sat((o.z1 - sz) / 5) : 1) * sat((sz - o.z0) / 3);
    if (wEdge > 0) {
      let lift = o.lumps ? o.lumps * Math.sin(sx * 0.19 + 1.3) * Math.sin(sz * 0.15 + 0.4) : 0;
      for (const [cx, cz, ang, wid, amp, len] of o.ridges || []) {
        const ca = Math.cos(ang), sa = Math.sin(ang), along = (sx - cx) * ca + (sz - cz) * sa, perp = -(sx - cx) * sa + (sz - cz) * ca;
        lift += amp * Math.exp(-((perp / wid) ** 2)) * Math.exp(-((along / len) ** 2));
      }
      y += lift * wEdge;
    }
    const v = j * cols + i; P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z; U[v * 2] = sx * IN; U[v * 2 + 1] = sz * IN;
  }
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) { const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/**
 * One leaf along +z with its face up (+y): a rounded width profile, a cupped blade either side of the midrib and a droop toward
 * the tip. `across` columns each side of the midrib (1 in Fast, 2 in Visual).
 */
function leafGeo(len, wid, segs, shape = 'oval', cup = 0.25, droop = 0.2, across = 2) {
  const P = [], U = [], idx = [], C = 2 * across + 1;
  const prof = (t) => (shape === 'fiddle' ? Math.sin(Math.PI * t ** 0.72) ** 0.5 * (0.78 + 0.32 * t)
    : shape === 'heart' ? Math.sin(Math.PI * Math.min(1, 0.14 + t * 0.86)) ** 0.6 * (1.2 - 0.55 * t) : Math.sin(Math.PI * t) ** 0.7);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, hw = (wid / 2) * prof(t), z = t * len, y0 = -droop * len * t * t;
    for (let c = 0; c < C; c++) { const u = (c - across) / across; P.push(u * hw, y0 + cup * hw * u * u, z); U.push((u + 1) / 2, t); }
  }
  for (let i = 0; i < segs; i++) for (let c = 0; c < C - 1; c++) { const a = i * C + c, b = a + 1, a2 = a + C, b2 = b + C; idx.push(a, a2, b, b, a2, b2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ the per-build kit: geometry and material caches, mesh helper
function kit(it, ctx) {
  const fast = ctx.quality !== 'visual', s = ctx.s, geos = new Map(), mats = new Map();
  const once = (map, key, fn) => { let v = map.get(key); if (v === undefined) { v = fn(); map.set(key, v); } return v; };
  const K = {
    fast, s, ctx, it, look: lookOf(it),
    geo: (key, fn) => once(geos, key, fn),
    mat: (key, fn) => once(mats, key, fn),
    /** Soft box; Fast drops to one bevel step and its own k (`kf`, default 1 x 1 x 1). */
    soft(w, h, d, o = {}) {
      const oo = { ...o, s: fast ? 1 : (o.s ?? 2), k: fast ? (o.kf || [1, 1, 1]) : (o.k || [1, 1, 1]) };
      if (fast && !o.keepPuff) { delete oo.tufts; if (oo.puff && !o.kf) delete oo.puff; }
      const key = o.key || `soft|${w.toFixed(2)}|${h.toFixed(2)}|${d.toFixed(2)}|${JSON.stringify(oo)}`;
      return K.geo(key, () => softGeo(w, h, d, oo));
    },
    /** A wooden member: eased edges in Visual, a plain box in Fast. */
    board(w, h, d, r = 0.18, plain = false) { return fast || plain ? K.geo(`box|${w}|${h}|${d}`, () => boxGeo(w, h, d)) : K.soft(w, h, d, { r: Math.min(r, w / 2.2, h / 2.2, d / 2.2), s: 1 }); },
    wood(col, rough = 0.58, grain = true) {
      return K.mat(`wood|${hexOf(col)}|${rough}|${grain}|${fast ? 1 : 2}`, () => {
        const t = grain ? grainTex() : null, c = mix(col, 0x7f7a74, 0.1).multiplyScalar(0.94);   // a hair less orange: the light warms every brown
        return ctx.std(c, { roughness: rough, ...(t ? { map: t, ...(fast ? {} : { bumpMap: t, bumpScale: 0.3 }) } : {}) });
      });
    },
    /** A printed laminate (wood-grain foil on a board): dark and nearly matt, with a faint grain. */
    foil(col, rough = 0.62) {
      return K.mat(`foil|${hexOf(col)}|${rough}|${fast ? 1 : 2}`, () => { const t = foilTex(); return ctx.std(tone(col, 1.3), { roughness: rough, ...(t ? { map: t, ...(fast ? {} : { bumpMap: t, bumpScale: 0.25 }) } : {}) }); });
    },
    paint(col, rough = 0.45) { return K.mat(`paint|${hexOf(col)}|${rough}`, () => ctx.std(col, { roughness: rough })); },
    fabric(col, o = {}) { return K.mat(`fab|${hexOf(col)}|${o.side ? 2 : 1}|${fast ? 1 : 2}`, () => { const t = weaveTex(); return (ctx.fabric || ctx.std)(col, { roughness: 0.93, ...(t ? { map: t, ...(fast ? {} : { bumpMap: t, bumpScale: 0.6 }) } : {}), ...o }); }); },
    metal(col, rough = 0.35, metal = 0.55) { return K.mat(`metal|${hexOf(col)}|${rough}|${metal}`, () => { const m = ctx.std(col, { roughness: rough, metalness: metal }); m.userData.arMetalness = Math.max(metal, 0.6); return m; }); },   // AR: a phone's camera feed lights the room, so metal is metal there
    /** The duvet: a quilted cover (a map and a bump from the same stitched squares), two-sided because the cloth drapes. */
    quilted(col) {
      return K.mat(`quilt|${hexOf(col)}|${fast ? 1 : 2}`, () => { const t = quiltTex(); return (ctx.fabric || ctx.std)(col, { roughness: 0.92, side: THREE.DoubleSide, ...(t ? { map: t, ...(fast ? {} : { bumpMap: t, bumpScale: 0.9 }) } : {}) }); });
    },
    /** A chunky knit throw (a stitch map and bump), two-sided. */
    knit(col) { return K.mat(`knit|${hexOf(col)}|${fast ? 1 : 2}`, () => { const t = knitTex(); return (ctx.fabric || ctx.std)(col, { roughness: 1, side: THREE.DoubleSide, ...(t ? { map: t, ...(fast ? {} : { bumpMap: t, bumpScale: 1.4 }) } : {}) }); }); },
    /** Leather: a pebbled grain and a soft sheen. Visual adds a velvety rim (sheen) and a thin clear coat; Fast keeps the grain and the specular only. */
    leather(col, finish = 'sheen') {
      return K.mat(`leather|${hexOf(col)}|${finish}|${fast ? 1 : 2}`, () => {
        const t = leatherTex(), rough = ROUGH.leather[finish] ?? 0.42, o = { roughness: rough, ...(t ? { bumpMap: t, bumpScale: fast ? 0.6 : 0.7 } : {}) };
        if (fast) return ctx.std(col, o);
        const m = new THREE.MeshPhysicalMaterial({ color: tone(col, 0.7), ...o, sheen: 0.4, sheenRoughness: 0.5, sheenColor: mix(col, 0xffffff, 0.22), clearcoat: finish === 'matte' ? 0 : 0.18, clearcoatRoughness: 0.5 });
        return m;
      });
    },
    /** The material for a look `{color, material, finish}`: the piece's own, over `def` (the model's default, always an assumption). */
    skin(spec, def = {}) {
      const s = { color: MAT.wood, material: 'paint', finish: 'satin', ...def, ...spec }, fin = s.finish, rough = (ROUGH[s.material] || ROUGH.paint)[fin] ?? 0.5;
      switch (s.material) {
        case 'leather': return K.leather(s.color, fin);
        case 'fabric': return K.fabric(s.color);
        case 'wood': return K.wood(s.color, rough);
        case 'laminate': return s.foil !== false && !isLight(s.color) ? K.foil(s.color, rough) : K.paint(s.color, rough);
        case 'metal': return K.metal(s.color, rough, fast ? 0.15 : 0.6);   // Fast has no environment light, so a full metal would render near black
        case 'glass': return K.mat(`glass|${hexOf(s.color)}`, () => ctx.std(s.color, { roughness: 0.08, metalness: 0.2 }));
        default: return K.paint(s.color, rough);   // paint, laminate, plastic
      }
    },
    /** The piece's own look over the model's default. */
    spec(def = {}) { return { ...def, ...K.look }; },
    /** A named part's look (the futon's frame, the desk's chair, ...) over the model's default for that part. */
    part(name, def = {}) { return { ...def, ...partLook(it, name) }; },
    add(geo, mat, x = 0, y = 0, z = 0, o = {}) {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
      if (o.rx || o.ry || o.rz) m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
      if (o.scale) { if (Array.isArray(o.scale)) m.scale.set(...o.scale); else m.scale.setScalar(o.scale); }
      m.castShadow = o.cast !== false; m.receiveShadow = true; (o.parent || s).add(m); return m;
    },
    group(x = 0, y = 0, z = 0, ry = 0, parent = s) { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g); return g; },
  };
  return K;
}
/** Height of a puffed face at (u, v) on it, matching softGeo's crown (for buttons and objects resting on cushions). */
const crownAt = (amt, u, v, hu, hv, pow = 1) => amt * (Math.max(0, 1 - (u / hu) ** 2) * Math.max(0, 1 - (v / hv) ** 2)) ** pow;

// ------------------------------------------------------------------ sofas, loveseats, armchairs
function seating(it, K) {
  const name = `${it.name || ''} ${it.label || ''}`;
  if (it.kind === 'sofa' && (it.variant === 'bed' || it.ref === 'futon' || /futon/i.test(name))) return futon(it, K);
  return sofa(it, K);
}
function sofa(it, K) {
  const { w, d, h } = it, hw = w / 2, hd = d / 2, chair = it.kind === 'chair', f = K.fast, spec = K.spec({ color: it.base?.color ?? MAT.fabric, material: 'fabric', finish: 'matte' });
  const fab = K.skin(spec), frameM = K.skin(shade(spec, 0.84)), armM = K.skin(shade(spec, 0.94)), weltM = K.skin(shade(spec, 0.55)), legM = K.wood(MAT.woodDark, 0.5);
  const legH = clamp(h * 0.13, 3.5, 5), armW = chair ? clamp(w * 0.17, 4.5, 6.5) : clamp(w * 0.08, 5, 7.5), armH = clamp(h * 0.66, 17, 25);
  const backT = clamp(d * 0.17, 4.5, 7), baseTop = legH + clamp(h * 0.2, 5.5, 7.5), inner = w - 2 * armW;
  const n = chair ? 1 : clamp(Math.round(inner / 24), 1, 4), cw = inner / n, seatT = clamp(h * 0.17, 4.8, 6.2), seatTop = baseTop + seatT, seatD = d - backT - 0.3;
  const legG = K.geo('sofa-leg', () => legGeo(1.1, 0.62, legH, f ? 6 : 10));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.add(legG, legM, sx * (hw - 2.6), 0, sz * (hd - 2.6), { rz: sx * 0.07, rx: -sz * 0.07 });
  K.add(K.soft(w - 0.6, baseTop - legH, d - 0.8, { r: 1.1 }), frameM, 0, legH, 0);
  const armG = K.soft(armW, armH - legH, d - 0.2, { r: Math.min(armW * 0.42, 2.8), k: [1, 1, 2], puff: { py: 0.5, px: 0.25, nx: 0.25 } });
  for (const sx of [-1, 1]) K.add(armG, armM, sx * (hw - armW / 2), legH, 0);
  K.add(K.soft(inner + 0.6, h - 3.2 - legH, backT, { r: 1.8 }), frameM, 0, legH, -hd + backT / 2 + 0.1);
  const seatG = K.soft(cw - 0.45, seatT, seatD, { r: 2.1, k: [3, 1, 3], puff: { py: 0.9, pz: 0.35 }, pow: 0.8 });
  const backCT = clamp(d * 0.2, 5.5, 7.5), backH = h - 0.5 - (seatTop - 1.2);
  const backG = K.soft(cw - 0.45, backH, backCT, { r: 2.5, k: [3, 3, 1], puff: { pz: 1.2, nz: 0.3, py: 0.3 }, pow: 0.8 });
  const weltG = f ? null : K.geo(`welt|${cw}`, () => rodGeo(0.24, cw - 0.45 - 2 * 2.1 * 0.75, 6, true));
  for (let i = 0; i < n; i++) {
    const x = -inner / 2 + cw * (i + 0.5);
    K.add(seatG, fab, x, baseTop, -hd + backT + seatD / 2);
    K.add(backG, fab, x, seatTop - 1.2, -hd + backT + backCT / 2 - 0.4, { rx: -0.13 });
    if (weltG) K.add(weltG, weltM, x, seatTop - 0.62, hd - 0.3 - 0.62, { cast: false });
  }
  if (!f) {   // throw pillows, angled into the corners
    const pg = K.soft(15, 15, 4.6, { r: 1, k: [2, 2, 1], puff: { pz: 1.7, nz: 1.5 }, pow: 0.6 }), spots = chair ? [0] : [-1, 1], cols = [ACC.rust, ACC.ochre];
    spots.forEach((sx, i) => K.add(pg, K.fabric(cols[i]), chair ? 0 : sx * (inner / 2 - 8.5), seatTop - 0.6, -hd + backT + backCT + 4.6, { rx: -0.2, ry: -sx * 0.32, rz: sx * 0.05 }));
  }
}
// A futon: a thick mattress (leather, fabric ...) folded into a seat and a back, built as rows of padded channels so the seams are real
// grooves, on a tubular frame (black metal unless the renter says otherwise: rail arms, raked back stiles, a slatted deck). Opened
// (variant 'bed') the mattress lies flat across a low deck. The renter's `look` colours the mattress; its `frame` part colours the metal.
function futon(it, K) {
  const { w, d, h } = it, hw = w / 2, hd = d / 2, f = K.fast, flat = it.variant === 'bed' || d > 48;
  const spec = K.spec({ color: it.base?.color ?? MAT.green, material: 'fabric', finish: 'matte' }), mat = K.skin(spec);
  const fm = K.skin(K.part('frame', { color: 0x1e1f22, material: 'metal', finish: 'satin' })), cap = K.paint(0x0b0b0c, 0.7);
  const seg = f ? 6 : 10, rr = 0.85, hx = hw - 1.5, mW = 2 * hx - 0.8;
  const armTop = flat ? 14 : clamp(h * 0.7, 20, 25), deckY = flat ? 7 : 12.5, mt = flat ? 6 : 6.5;
  const UP = new THREE.Vector3(0, 1, 0), tubeG = K.geo(`tube|${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1)), ballG = K.geo(`ball|${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(4, seg >> 1)));
  const tube = (a, b, r, m = fm) => {   // a rod between two points [x, y, z]
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), dir = B.clone().sub(A), L = dir.length();
    const mesh = K.add(tubeG, m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, { scale: [r, L, r] }); mesh.quaternion.setFromUnitVectors(UP, dir.normalize()); return mesh;
  };
  const ball = (p, r) => K.add(ballG, fm, p[0], p[1], p[2], { scale: r });
  const zf = hd - 1.8, zr = -hd + 1.8;
  for (const sx of [-1, 1]) {   // each side: two posts that are the legs, an arm rail with rounded ends, a lower rail
    const x = sx * hx;
    tube([x, 0.5, zf], [x, armTop, zf], rr); tube([x, 0.5, zr], [x, armTop, zr], rr);
    tube([x, armTop, zr], [x, armTop, zf], rr * 1.2); ball([x, armTop, zr], rr * 1.2); ball([x, armTop, zf], rr * 1.2);
    tube([x, deckY - 2.2, zr], [x, deckY - 2.2, zf], rr * 0.75);
    if (!f) for (const t of [0.34, 0.67]) tube([x, deckY - 2.2, zr + (zf - zr) * t], [x, armTop, zr + (zf - zr) * t], rr * 0.5);
    for (const z of [zr, zf]) K.add(K.geo('cap', () => legGeo(1.0, 1.0, 0.6, seg)), cap, x, 0, z);
  }
  tube([-hx, deckY - 2.2, zf], [hx, deckY - 2.2, zf], rr * 0.75); tube([-hx, deckY - 2.2, zr], [hx, deckY - 2.2, zr], rr * 0.75);
  const slatN = f ? 3 : 6, slatG = K.board(2 * hx, 0.5, 2.0, 0, true);   // the slatted deck under the mattress
  for (let i = 0; i < slatN; i++) K.add(slatG, fm, 0, deckY - 1.1, zr + ((zf - zr) * (i + 0.5)) / slatN);
  // The mattress: one thick leather pad for the seat and one for the back, each crowned like a pillow, deep-buttoned on the sitting face
  // (a grid of dimples with a covered button in each), with a piped seam round the face and a thread of top-stitching beside it.
  const thread = K.paint(0x57595e, 0.5), seam = K.skin(shade(spec, 0.8));
  const pad = (w0, h0, d0, axis, nc, nr, crown) => {   // axis 1: the top face of a seat (x by z); axis 2: the front face of a back (x by y)
    const hu = w0 / 2, hv = (axis === 1 ? d0 : h0) / 2, inset = 5, pts = [];
    for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) pts.push([-hu + inset + ((2 * hu - 2 * inset) * (nc === 1 ? 0.5 : i / (nc - 1))), -hv + inset + ((2 * hv - 2 * inset) * (nr === 1 ? 0.5 : j / (nr - 1)))]);
    const dep = 0.8, rad = 2.3, kx = Math.round(w0 / 3.4), kv = Math.round((axis === 1 ? d0 : h0) / 3.4);
    const geo = K.soft(w0, h0, d0, { r: 1.5, s: 2, drop: axis === 1 ? [3] : [5, 3], k: axis === 1 ? [kx, 1, kv] : [kx, kv, 1], kf: axis === 1 ? [8, 1, 4] : [8, 4, 1], puff: axis === 1 ? { py: crown } : { pz: crown }, pow: 0.7, keepPuff: true,
      ...(f ? {} : { tufts: { axis, side: 1, pts, depth: dep, rad } }) });
    return { geo, pts, hu, hv, crown, dep };
  };
  const dress = (P, axis, par, y0, zc, thick, depthAxis) => {   // buttons and seams on a pad placed with its bottom at y0, centre z = zc
    if (f) return;
    const bp = [], ball = K.geo('btn', () => new THREE.SphereGeometry(0.62, 6, 4));
    for (const [u, v] of P.pts) {
      const top = axis === 1 ? thick + crownAt(P.crown, u, v, P.hu, P.hv, 0.7) - P.dep + 0.28 : depthAxis / 2 + crownAt(P.crown, u, v, P.hu, P.hv, 0.7) - P.dep + 0.28;
      bp.push({ g: ball, m: axis === 1 ? mtx(u, top, v, 0, 0, 0, 1, 0.55, 1) : mtx(u, v + P.hv, top, 0, 0, 0, 1, 1, 0.55) });
    }
    K.add(mergeParts(bp), mat, 0, axis === 1 ? y0 : 0, axis === 1 ? zc : 0, { parent: par, cast: false });
    // the seam and the top-stitching: along the front edge and both sides of the face
    const sp = [], tp = [], rod = K.geo('seamrod', () => rodGeo(0.2, 1, 6)), thr = K.geo('thread', () => rodGeo(0.07, 1, 4));
    const W = 2 * P.hu, E = 1.5 * 0.29, line = (list, g, len, x, y, z, ry, rx) => list.push({ g, m: mtx(x, y, z, rx || 0, ry || 0, 0, len, 1, 1) });
    if (axis === 1) {
      const zf = P.hv - E, yy = thick - E, yt = thick + 0.02;
      line(sp, rod, W - 3, 0, yy, zf); line(sp, rod, 2 * P.hv - 3, -P.hu + E, yy, 0, Math.PI / 2); line(sp, rod, 2 * P.hv - 3, P.hu - E, yy, 0, Math.PI / 2);
      line(tp, thr, W - 7, 0, yt + crownAt(P.crown, 0, P.hv - 1.1, P.hu, P.hv, 0.7), P.hv - 1.1); line(tp, thr, 2 * P.hv - 7, -P.hu + 1.1, yt + crownAt(P.crown, P.hu - 1.1, 0, P.hu, P.hv, 0.7), 0, Math.PI / 2); line(tp, thr, 2 * P.hv - 7, P.hu - 1.1, yt + crownAt(P.crown, P.hu - 1.1, 0, P.hu, P.hv, 0.7), 0, Math.PI / 2);
      K.add(mergeParts(sp), seam, 0, y0, zc, { parent: par, cast: false }); K.add(mergeParts(tp), thread, 0, y0, zc, { parent: par, cast: false });
    } else {
      const zt = depthAxis / 2 - E, yt = 2 * P.hv - E, vrod = K.geo('seamrodv', () => new THREE.CylinderGeometry(0.2, 0.2, 1, 6, 1, true));
      line(sp, rod, W - 3, 0, yt, zt);
      for (const sx of [-1, 1]) sp.push({ g: vrod, m: mtx(sx * (P.hu - E), P.hv, zt, 0, 0, 0, 1, 2 * P.hv - 3, 1) });
      K.add(mergeParts(sp), seam, 0, 0, 0, { parent: par, cast: false });
    }
  };
  if (flat) {   // opened as a bed: the mattress lies flat across the deck, buttoned all over
    const md = d - 2.4, P = pad(mW, mt, md, 1, 6, 4, 0.9);
    K.add(P.geo, mat, 0, deckY, 0); dress(P, 1, K.s, deckY, 0, mt, md);
    return;
  }
  // the back: two raked stiles and rails carrying the back cushion
  const by0 = deckY - 1, bz0 = -hd + 5.5, by1 = h - 1.2, bz1 = -hd + 1.4, lean = Math.atan2(bz0 - bz1, by1 - by0), bx = hx - 2.5;
  for (const sx of [-1, 1]) tube([sx * bx, by0, bz0], [sx * bx, by1, bz1], rr * 0.9);
  tube([-bx, by1, bz1], [bx, by1, bz1], rr); if (!f) { ball([-bx, by1, bz1], rr); ball([bx, by1, bz1], rr); }
  tube([-bx, by0 + (by1 - by0) * 0.5, bz0 + (bz1 - bz0) * 0.5], [bx, by0 + (by1 - by0) * 0.5, bz0 + (bz1 - bz0) * 0.5], rr * 0.7);
  // the seat: from the back stiles to the front rail
  const zb = bz0 - 0.5, seatD = hd - 0.6 - zb, SP = pad(mW, mt, seatD, 1, 5, 3, 0.9), seatZ = zb + seatD / 2;
  K.add(SP.geo, mat, 0, deckY, seatZ); dress(SP, 1, K.s, deckY, seatZ, mt, seatD);
  // the back cushion leans on the stiles
  const baseY = deckY + mt - 1.4, backLen = (h - 2.4 - baseY) / Math.cos(lean), BP = pad(mW, backLen, mt, 2, 5, 3, 0.9);
  const bg = K.group(0, baseY, bz0 + mt / 2 + 1.0, 0); bg.rotation.x = -lean;
  K.add(BP.geo, mat, 0, 0, 0, { parent: bg }); dress(BP, 2, bg, 0, 0, backLen, mt);
}

// ------------------------------------------------------------------ beds
function bed(it, K) {
  const { w, d, h } = it, hw = w / 2, hd = d / 2, f = K.fast, storage = !!it.base?.storage, spec = K.spec({ color: it.base?.color ?? MAT.fabric, material: 'fabric', finish: 'matte' });
  const [mw0, md0] = it.productInfo?.mattress || it.base?.mattress || [w - 4, d - 4];
  const hbT = clamp(d * 0.04, 2.6, 3.6), mw = Math.min(mw0, w - 3), md = Math.min(md0, d - hbT - 1.5);
  const upM = K.skin(spec), upDark = K.skin(shade(spec, 0.62)), legM = K.skin(K.part('legs', { color: MAT.woodDark, material: 'wood', finish: 'satin' }));
  // bedding is generic decor, not the renter's: plain whites, no colour accents
  const tick = K.fabric(0xe2ddd3), sheet = K.fabric(0xe6e2da), duvetM = K.quilted(0xd3d0c9), foldM = K.fabric(0xd9d6cf), throwM = K.knit(0x8c867d), euroM = K.fabric(0xc9c2b6);
  const legH = storage ? 2 : 4.5, deck = storage ? 14 : 11, mT = 10, headZ = -hd + hbT, footZ = headZ + md, mz = (headZ + footZ) / 2;
  const mBot = deck - 1.5, mTop = mBot + mT;
  // headboard: a panel with rounded shoulders, bevelled edges and (Visual) puffed vertical channels
  const hbH = h - 1, bev = 0.9, bs = bev * 0.85, hbG = K.geo('headboard', () => {   // the bevel grows the outline by bs: draw it inset
    const rr = Math.min(5, w / 6), x = w / 2 - bs, y1 = hbH - 2 * bs, sh = new THREE.Shape();
    sh.moveTo(-x, 0); sh.lineTo(x, 0); sh.lineTo(x, y1 - rr); sh.quadraticCurveTo(x, y1, x - rr, y1); sh.lineTo(-x + rr, y1); sh.quadraticCurveTo(-x, y1, -x, y1 - rr); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.2, hbT - 2 * bev), bevelEnabled: true, bevelThickness: bev, bevelSize: bs, bevelSegments: f ? 1 : 3, curveSegments: f ? 3 : 6 });
    g.translate(0, bs, bev); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * IN, uv.getY(i) * IN);
    return g;
  });
  K.add(hbG, upM, 0, 1, -hd);
  if (!f) {
    const nCh = clamp(Math.round((w - 6) / 10.5), 4, 9), chW = (w - 6) / nCh, chY0 = deck + 1, chH = hbH - 4.5 - chY0;
    const chG = K.soft(chW - 0.45, chH, 2.0, { r: 0.8, s: 1, k: [1, 4, 1], drop: [5, 3], puff: { pz: 1.3 }, pow: 0.55, keepPuff: true });
    for (let i = 0; i < nCh; i++) K.add(chG, upM, -w / 2 + 3 + chW * (i + 0.5), chY0, headZ + 0.35);
  }
  // frame: upholstered rails on tapered legs, or drawer boxes for a storage bed
  // a storage bed's rails step in under the drawer fronts so the fronts and pulls stay inside the footprint
  const sides = !storage ? [] : it.variant === 'foot' ? ['foot'] : it.variant === 'left' ? ['left'] : it.variant === 'right' ? ['right'] : ['left', 'right'];
  const inL = sides.includes('left') ? 0.9 : 0, inR = sides.includes('right') ? 0.9 : 0, inF = sides.includes('foot') ? 0.9 : 0;
  const railH = deck - legH, sideG = K.soft(2.2, railH, d - hbT - 0.2 - inF, { r: 0.8 }), footG = K.soft(w - 4.2 - inL - inR, railH, 2.2, { r: 0.8 });
  for (const sx of [-1, 1]) K.add(sideG, upM, sx * (hw - 1.1 - (sx < 0 ? inL : inR)), legH, hbT / 2 - inF / 2);
  K.add(footG, upM, (inL - inR) / 2, legH, hd - 1.1 - inF);
  K.add(K.board(w - 4.4, 1, d - hbT - 2.4), legM, 0, deck - 2.5, hbT / 2 - 1.1);
  if (!storage) { const lg = K.geo('bed-leg', () => legGeo(1.15, 0.7, legH, f ? 6 : 10)); for (const sx of [-1, 1]) for (const z of [headZ + 2, hd - 2]) K.add(lg, legM, sx * (hw - 2), 0, z); }
  else {
    const oak = K.wood(MAT.oak, 0.55), pull = K.metal(MAT.brass, 0.3, 0.6), fh = railH - 2.4;
    K.add(K.board(w - 2.5, legH, d - hbT - 2, 0, true), K.paint(0x2a2622, 0.9), 0, 0, hbT / 2);
    for (const sd of sides) {
      if (sd === 'foot') { for (const sx of [-1, 1]) { K.add(K.board(w / 2 - 3.5, fh, 0.8, 0.25), oak, sx * (w / 4 - 0.4), legH + 1.2, hd - 0.5); K.add(K.board(6, 0.6, 0.45, 0, true), pull, sx * (w / 4 - 0.4), legH + 1.2 + fh * 0.6, hd - 0.12, { cast: false }); } continue; }
      const sx = sd === 'left' ? -1 : 1, dl = (d - hbT) / 2 - 3;
      for (const k of [-1, 1]) { const z = hbT / 2 + k * ((d - hbT) / 4); K.add(K.board(0.8, fh, dl, 0.25), oak, sx * (hw - 0.5), legH + 1.2, z); K.add(K.board(0.45, 0.6, 6, 0, true), pull, sx * (hw - 0.12), legH + 1.2 + fh * 0.6, z, { cast: false }); }
    }
  }
  // mattress with a piped top edge, the fitted sheet showing under the pillows
  K.add(K.soft(mw, mT, md, { r: 2.2 }), tick, 0, mBot, mz);
  if (!f) K.add(K.soft(mw + 0.4, 0.5, md + 0.4, { r: 2.4, s: 1 }), K.fabric(0xc9c3b8), 0, mTop - 2.45, mz, { cast: false });
  K.add(K.soft(mw - 0.6, 0.3, md * 0.34, { r: 0.15, s: 1 }), sheet, 0, mTop - 0.05, headZ + md * 0.17 + 0.4, { cast: false });
  // duvet: draped over the sides and the foot with folds, a few ridges on top, the top turned down
  const R = 1.7, loft = 1.8, ax = mw / 2 - 1, top = mTop + loft - 0.1, z0 = headZ + clamp(md * 0.27, 16, 24), z1 = footZ - 1;
  const r = rng(hashStr(it.id || 'bed')), dropX = Math.min(8.5, top - R - deck - 0.4);
  // three soft ridges across the bed, kept clear of the throw near the foot
  const zr = Math.max(z0 + 14, z1 - 27);
  const ridges = f ? [] : [0, 1, 2, 3].map((i) => [(r() - 0.5) * mw * 0.4, z0 + 6 + (i * (zr - z0 - 6)) / 3, -0.35 + r() * 0.7, 1.8 + r(), 0.75 + r() * 0.3, mw * (0.2 + r() * 0.16)]);
  const dg = K.geo('duvet', () => drapeGeo({ ax, z0, z1, top, R, dropX, dropZ: dropX, flareX: 0.5, flareZ: 0.25, fold: f ? 0.25 : 0.45, period: 11, ridges, lumps: f ? 0 : 0.35,
    nTopX: f ? 3 : 8, nTopZ: f ? 3 : 22, nArc: 2 + (f ? 0 : 1), nDrop: f ? 1 : 4 }));
  K.add(dg, duvetM, 0, 0, 0);
  K.add(K.soft(2 * (ax + R) + 0.3, 2.4, 11, { r: 1.1, k: [3, 1, 1], puff: { py: 0.5, pz: 0.3 }, pow: 0.8 }), foldM, 0, top - 0.95, z0 + 4.6);
  // a knitted throw folded across the foot third, hanging a little over each side
  const tz1 = z1 - 0.5, tz0 = tz1 - 24, ttop = top + 0.85;
  K.add(K.geo('throw', () => drapeGeo({ ax: ax + 0.9, z0: tz0, z1: tz1, top: ttop, R: 1.3, dropX: Math.min(9, ttop - 1.3 - deck - 0.6), dropZ: Math.min(8, ttop - 1.3 - deck - 0.6), flareX: 0.3, flareZ: 0.2, fold: f ? 0.15 : 0.3, period: 9,
    ridges: [], lumps: f ? 0 : 0.25, nTopX: f ? 3 : 6, nTopZ: f ? 3 : 6, nArc: 2 + (f ? 0 : 1), nDrop: f ? 1 : 3 })), throwM, 0, 0, 0);
  // pillows: two sleeping pillows propped on the headboard
  const pw = Math.min(26, mw / 2 - 2.5), pd = 17, pillowG = K.soft(pw, 6, pd, { r: 1.2, k: [2, 1, 2], puff: { py: 1.7, ny: 0.9 }, pow: 0.6 });
  for (const sx of [-1, 1]) K.add(pillowG, sheet, sx * (pw / 2 + 0.6), mTop + 1.4, headZ + pd / 2 + 1.6, { rx: 0.42, ry: sx * 0.03 });
  if (!f) {   // two square euro pillows leaning in front of them
    const eg = K.soft(19, 5.6, 19, { r: 1.2, s: 1, k: [3, 1, 3], puff: { py: 1.6, ny: 0.8 }, pow: 0.6, drop: [3] });
    for (const sx of [-1, 1]) K.add(eg, euroM, sx * 13.5, mTop + 3.1, headZ + 17.5, { rx: 1.0, ry: -sx * 0.14 });
  }
}

// ------------------------------------------------------------------ nightstands, dressers, wardrobes (case goods)
function pullGeo(K, len, vertical = false) {
  return K.geo(`pull|${len}|${vertical}`, () => {
    if (K.fast) return vertical ? boxGeo(0.45, len, 0.45) : boxGeo(len, 0.45, 0.45);
    const bar = rodGeo(0.22, len, 8), post = new THREE.CylinderGeometry(0.14, 0.14, 0.6, 6, 1); post.rotateX(Math.PI / 2);
    const g = mergeParts([{ g: bar, m: mtx(0, 0, 0.55), tmp: true }, { g: post, m: mtx(-len / 2 + 0.5, 0, 0.25) }, { g: post, m: mtx(len / 2 - 0.5, 0, 0.25), tmp: true }]);
    if (vertical) g.rotateZ(Math.PI / 2);
    return g;
  });
}
function decorBooks(K, x, y, z, n = 2, ry = 0.15, seed = 3, k = 1) {
  if (K.fast) return;
  const r = rng(seed); let yy = y;
  for (let i = 0; i < n; i++) {
    const bw = (7 + r() * 2.2) * k, bt = 0.9 + r() * 0.6, bd = (5.2 + r() * 1.2) * k;
    K.add(K.soft(bw, bt, bd, { r: 0.12, s: 1 }), K.paint(BOOKS[Math.floor(r() * BOOKS.length)], 0.7), x + (r() - 0.5) * 0.6, yy, z + (r() - 0.5) * 0.6, { ry: ry + (r() - 0.5) * 0.3 });
    yy += bt;
  }
  return yy;
}
function vase(K, x, y, z, ht = 7, col = 0xd9d2c3) {
  if (K.fast) return;
  const g = K.geo(`vase|${ht}`, () => lathe([[0, 0], [1.4, 0], [1.9, ht * 0.15], [2.1, ht * 0.45], [1.2, ht * 0.8], [0.9, ht * 0.92], [1.1, ht], [0.85, ht]], 16));
  K.add(g, K.paint(col, 0.35), x, y, z);
  const stem = K.geo(`stems|${ht}`, () => { const s = new THREE.CylinderGeometry(0.06, 0.08, ht * 1.1, 4, 1); s.translate(0, ht * 0.55, 0); return mergeParts([{ g: s, m: mtx(0, 0, 0, 0.12, 0, 0.1) }, { g: s, m: mtx(0, 0, 0, -0.15, 0, -0.08) }, { g: s, m: mtx(0, 0, 0, 0.05, 0, -0.2), tmp: true }]); });
  K.add(stem, K.paint(0x6f7a52, 0.8), x, y + ht * 0.7, z, { cast: false });
}
function caseGood(it, K, o) {
  const { w, d, h } = it, hw = w / 2, hd = d / 2, f = K.fast, col0 = it.base?.color ?? MAT.wood;
  const spec = K.spec({ color: col0, material: isLight(col0) ? 'paint' : 'wood', finish: 'satin' }), onWood = spec.material === 'wood', dark = !isLight(spec.color) && lum(spec.color) < 0.12;
  const body = K.skin(shade(spec, onWood ? 1 : 1)), front = K.skin(shade(spec, onWood ? 1.07 : 1.03)), topM = K.skin(shade(spec, onWood ? 0.9 : 0.97));
  const legM = K.skin(K.part('legs', onWood ? { color: MAT.woodDark, material: 'wood', finish: 'satin' } : { ...shade(spec, 0.9), material: spec.material, finish: spec.finish }));
  const gapM = K.paint(0x221e1a, 0.95), pullM = K.skin(K.part('pulls', { color: onWood ? MAT.brass : dark ? 0x74787e : 0x2c2e33, material: 'metal', finish: 'satin' }));
  const legH = o.legH, topT = o.topT ?? 1.0, cd = d - 1.6, fz = hd - 1.6;
  if (o.plinth) K.add(K.board(w - 2, legH, d - 2.4), K.skin(shade(spec, onWood ? 0.7 : 0.78)), 0, 0, -0.4);
  else if (legH > 0) { const lg = K.geo(`cg-leg|${legH}`, () => legGeo(0.85, 0.55, legH, 4, true)); for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.add(lg, legM, sx * (hw - 1.7), 0, sz * (hd - 1.7), { rz: sx * 0.04, rx: -sz * 0.04 }); }
  K.add(K.soft(w - 0.5, h - legH - topT + 0.2, cd, { r: 0.35 }), body, 0, legH, -0.8);
  K.add(K.soft(w, topT, d, { r: Math.min(0.45, topT / 2.2) }), topM, 0, h - topT, 0);
  // fronts: a dark reveal behind the gaps, then each drawer or door slightly proud of the carcase
  const ox = (w - 0.5) / 2 - 0.65, oy0 = legH + 0.6, oy1 = h - topT - 0.35, gap = 0.28, rows = o.rows, cols = o.cols || 1;
  const reveal = new THREE.Mesh(K.geo(`reveal|${ox}|${oy1 - oy0}`, () => new THREE.PlaneGeometry(2 * ox, oy1 - oy0)), gapM); reveal.position.set(0, (oy0 + oy1) / 2, fz + 0.02); K.s.add(reveal);
  const cw = (2 * ox) / cols, rh = (oy1 - oy0) / rows, frontG = K.soft(cw - gap, rh - gap, 0.75, { r: 0.16, s: 1 });
  const pl = o.doors ? Math.min(14, rh * 0.25) : Math.min(7, cw * 0.36), pg = pullGeo(K, pl, !!o.doors);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = -ox + cw * (i + 0.5), y = oy0 + rh * j + gap / 2;
    K.add(frontG, front, x, y, fz + 0.02);
    const px = o.doors ? x + (i === 0 ? 1 : -1) * (cw / 2 - 2.2) : x, py = o.doors ? y + rh * 0.55 : y + (rh - gap) * (rows > 2 ? 0.55 : 0.6);
    K.add(pg, pullM, px, py, fz + 0.77, { cast: false });
  }
}
const nightstand = (it, K) => caseGood(it, K, { rows: 2, legH: clamp(it.h * 0.2, 3.5, 6) });
// a flat-front chest of drawers (IKEA Storklinta-style: plain drawer fronts, short legs, a simple bar handle on each)
const dresser = (it, K) => (it.base?.style === 'malm' ? malm(it, K) : caseGood(it, K, { rows: clamp(Math.round((it.h - 4) / 9), 3, 6), cols: it.w > 44 ? 2 : 1, legH: clamp(it.h * 0.1, 3, 4.5) }));
/** A drawer front, W wide, H high, T thick, with its top edge cut back into a thumb recess (MALM's pull); centred in x, back at z = 0. */
function malmFrontGeo(W, H, T) {
  const n = 1.15, nd = 0.45, e = 0.05, sh = new THREE.Shape();   // the recess: a 45-degree ramp up to a ledge set back by nd
  sh.moveTo(0, 0); sh.lineTo(T - e, 0); sh.lineTo(T, e); sh.lineTo(T, H - n - nd); sh.lineTo(T - nd, H - n); sh.lineTo(T - nd, H); sh.lineTo(0, H); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: false }); g.rotateY(-Math.PI / 2); g.translate(W / 2, 0, 0); boxUV(g);
  return g;
}
/**
 * IKEA MALM 6-drawer chest (160 x 48 x 78 cm, black-brown): two full-height side panels and a top, on a recessed plinth, with two
 * columns of three flat drawer fronts that fill the face (a 3 mm gap between them) and no knobs: the top edge of every front is cut
 * back into a finger recess, the pull. The finish is a printed wood-grain foil, dark and nearly matt. Inside w x d x h to the hair.
 */
function malm(it, K) {
  const { w, d, h } = it, hw = w / 2, hd = d / 2;
  const spec = K.spec({ color: it.base?.color ?? 0x2b221d, material: 'laminate', finish: 'matte' });
  const body = K.skin(shade(spec, 0.95)), front = K.skin(spec), top = K.skin(shade(spec, 0.9)), dark = K.paint(0x090706, 0.95);
  const plinthH = 2.4, topT = 0.85, cols = 2, rows = 3, gap = 0.18, fT = 0.75, side = 0.62;
  K.add(K.board(w - 2.6, plinthH + 0.3, d - 3.2, 0.1, true), dark, 0, 0, -0.5);   // the recessed plinth, in shadow
  K.add(K.soft(w - 2 * side, h - plinthH - topT + 0.1, d - fT - 0.4, { r: 0.1, s: 1 }), body, 0, plinthH, -fT / 2 - 0.2);   // the carcase behind the drawers
  for (const sx of [-1, 1]) K.add(K.soft(side, h - plinthH - topT + 0.1, d, { r: 0.12, s: 1 }), body, sx * (hw - side / 2), plinthH, 0);   // full-depth side panels
  K.add(K.soft(w, topT, d, { r: 0.28 }), top, 0, h - topT, 0);
  const x0 = -hw + side + 0.06, x1 = hw - side - 0.06, y0 = plinthH + 0.32, y1 = h - topT - 0.12, cw = (x1 - x0) / cols, rh = (y1 - y0) / rows;
  const rv = new THREE.Mesh(K.geo(`mrev|${w}|${h}`, () => new THREE.PlaneGeometry(x1 - x0 + 0.2, y1 - y0 + 0.2)), dark); rv.position.set(0, (y0 + y1) / 2, hd - fT + 0.02); K.s.add(rv);
  const fg = K.geo(`mfront|${cw.toFixed(3)}|${rh.toFixed(3)}`, () => malmFrontGeo(cw - gap, rh - gap, fT));
  const slot = K.geo(`mslot|${cw.toFixed(3)}`, () => boxGeo(cw - gap, 0.95, 0.06)), rec = 1.15, Hf = rh - gap;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = x0 + cw * (i + 0.5), y = y0 + rh * j + gap / 2;
    K.add(fg, front, x, y, hd - fT);
    K.add(slot, dark, x, y + Hf - rec + 0.08, hd - 0.45 - 0.01, { cast: false });   // the dark of the finger recess, at the back of the cut
  }
}
const wardrobe = (it, K) => caseGood(it, K, { rows: 1, cols: it.w > 26 ? 2 : 1, doors: true, legH: 3, plinth: true, topT: 1.4 });

function bookcase(it, K) {
  const { w, d, h } = it, hw = w / 2, hd = d / 2, f = K.fast, col = it.base?.color ?? MAT.oak, painted = isLight(col);
  const body = painted ? K.paint(col, 0.45) : K.wood(col, 0.58), back = painted ? K.paint(tone(col, 0.9), 0.6) : K.wood(tone(col, 0.82), 0.65), t = 0.9;
  for (const sx of [-1, 1]) K.add(K.board(t, h, d, 0.15), body, sx * (hw - t / 2), 0, 0);
  K.add(K.board(w, t, d, 0.2), body, 0, h - t, 0);
  K.add(K.board(w - 2 * t, 2.6, 0.8), body, 0, 0, hd - 1.2);
  K.add(K.board(w - 2 * t, h - t, 0.3, 0.1), back, 0, 0, -hd + 0.15);
  const n = clamp(Math.round((h - 4) / 12.5), 2, 7), y0 = 2.6, step = (h - t - y0) / n, shelfG = K.board(w - 2 * t, 0.75, d - 0.6, 0.12);
  const bookParts = [], r = rng(hashStr(it.id || 'bc')), bookG = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const y = y0 + step * i; K.add(shelfG, body, 0, y, 0.25);
    const ch = step - 0.75 - 0.6, top = y + 0.75, dpt = d - 1.6;
    if (f && i % 2) continue;
    let x = -hw + t + 0.3 + (r() < 0.4 ? r() * 6 : 0); const end = hw - t - 0.3 - (r() < 0.5 ? 6 + r() * 4 : 0.5);
    while (x < end - 1) {
      if (f) { const bw = Math.min(end - x, 4 + r() * 5), bh = ch * (0.7 + r() * 0.18); bookParts.push({ g: bookG, m: mtx(x + bw / 2, top + bh / 2, -0.2, 0, 0, 0, bw, bh, dpt * 0.86), c: BOOKS[Math.floor(r() * BOOKS.length)] }); x += bw + 0.2; continue; }
      if (r() < 0.12 && end - x > 9) {   // a short horizontal stack
        let yy = top; const sw = 7 + r() * 2; for (let k = 0; k < 3; k++) { const bt = 0.9 + r() * 0.5; bookParts.push({ g: bookG, m: mtx(x + sw / 2, yy + bt / 2, -0.2, 0, (r() - 0.5) * 0.2, 0, sw - k * 0.4, bt, dpt * 0.8), c: BOOKS[Math.floor(r() * BOOKS.length)] }); yy += bt; }
        x += sw + 0.6; continue;
      }
      const bw = 0.7 + r() * 1.1, bh = Math.min(ch - 0.3, ch * (0.62 + r() * 0.3)), bd = dpt * (0.75 + r() * 0.2);
      bookParts.push({ g: bookG, m: mtx(x + bw / 2, top + bh / 2, -hd + 1 + bd / 2, 0, 0, 0, bw, bh, bd), c: BOOKS[Math.floor(r() * BOOKS.length)] });
      x += bw + 0.05;
    }
    if (!f && i % 2 === 1 && hw - t - end > 5.5) vase(K, end + (hw - t - end) / 2, top, 0, Math.min(6, ch * 0.5), [0xd9d2c3, 0x8a9a8b, 0xc98f6d][i % 3]);
  }
  if (bookParts.length) K.add(mergeParts(bookParts), K.mat('books', () => K.ctx.std(0xffffff, { vertexColors: true, roughness: 0.75 })), 0, 0, 0);
  bookG.dispose();
}

// ------------------------------------------------------------------ tables and chairs
/** Chair positions [x, z, angle] in the table's local frame (inches, +z = front); the same spots as plan/scene3d.js. */
function chairSpots(it) {
  const hw = it.w / 2, hd = it.d / 2, off = 7, out = [];
  if (it.base?.round) return [[0, hd + off, Math.PI], [0, -hd - off, 0], [hw + off, 0, -Math.PI / 2], [-hw - off, 0, Math.PI / 2]];
  const n = Math.max(1, Math.floor(it.w / 24));
  for (let i = 0; i < n; i++) { const x = -hw + (it.w * (i + 0.5)) / n; out.push([x, hd + off, Math.PI], [x, -hd - off, 0]); }
  if (it.base?.chairs === 'all') out.push([hw + off, 0, -Math.PI / 2], [-hw - off, 0, Math.PI / 2]);
  return out;
}
/** A dining chair (back at local -z): upholstered seat, tapered legs, raked back posts and a curved back rail. */
function diningChair(K, x, z, a, wood, seatM) {
  const g = K.group(x, 0, z, a), f = K.fast;
  const legG = K.geo('dc-leg', () => legGeo(0.62, 0.45, 15.6, 4, true)), postG = K.geo('dc-post', () => legGeo(0.55, 0.62, 33.5, 4, true));
  for (const sx of [-1, 1]) { K.add(legG, wood, sx * 7.1, 0, 6.8, { parent: g }); K.add(postG, wood, sx * 7.1, 0, -6.9, { parent: g, rx: -0.07 }); }
  if (!f) K.add(K.board(16.4, 1.3, 16.2, 0.35), wood, 0, 15.5, 0, { parent: g });
  K.add(K.soft(16, 2.2, 15.4, { r: 0.9, k: [2, 1, 2], puff: { py: 0.5 }, pow: 0.8 }), seatM, 0, f ? 15.6 : 16.6, 0.3, { parent: g });
  // the back rail curves round the sitter; in Fast a plain board
  K.add(f ? K.board(15.4, 5.6, 1.1) : K.soft(15.4, 5.6, 1.1, { r: 0.45, s: 1, k: [4, 1, 1], bendZ: 0.9 }), wood, 0, 26.5, -8.85, { parent: g, rx: -0.07 });
  if (!f) { K.add(K.board(14.2, 1.1, 0.9, 0, true), wood, 0, 20.5, -8.4, { parent: g, rx: -0.07 }); const st = K.board(0.7, 0.7, 13.2, 0, true); for (const sx of [-1, 1]) K.add(st, wood, sx * 7.1, 5.5, -0.1, { parent: g }); }
}
function table(it, K) {
  const { w, d, h } = it, hw = w / 2, hd = d / 2, f = K.fast, spec = K.spec({ color: it.base?.color ?? MAT.wood, material: 'wood', finish: 'satin' }), top = K.skin(spec), wood = K.skin(shade(spec, 0.86));
  const chairWood = K.skin(K.part('chairs', { color: MAT.woodDark, material: 'wood', finish: 'satin' })), chairSeat = K.fabric(MAT.fabricWarm);
  if (it.base?.round) {
    const R = Math.min(w, d) / 2, t = 1.5;
    K.add(K.geo('rtop', () => lathe([[0, 0], [R - 0.7, 0], [R - 0.2, 0.15], [R, t * 0.5], [R - 0.2, t - 0.15], [R - 0.7, t], [0, t]], f ? 20 : 48)), top, 0, h - t, 0);
    K.add(K.geo('rped', () => lathe([[0, 0], [R * 0.42, 0], [R * 0.42, 0.6], [R * 0.3, 1.4], [2.6, 3.2], [1.9, 6], [1.7, h - t - 4], [2.4, h - t - 1.2], [4.5, h - t - 0.4], [4.5, h - t], [0, h - t]], f ? 10 : 24)), wood, 0, 0, 0);
  } else {
    K.add(K.soft(w, 1.5, d, { r: 0.55, s: 2 }), top, 0, h - 1.5, 0);
    K.add(K.board(w - 5.2, 3, d - 5.2, 0.2), wood, 0, h - 4.5, 0);
    const lg = K.geo(`tleg|${h}`, () => legGeo(1.3, 0.85, h - 1.5, 4, true));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.add(lg, wood, sx * (hw - 2.6), 0, sz * (hd - 2.6));
  }
  for (const [x, z, a] of chairSpots(it)) diningChair(K, x, z, a, chairWood, chairSeat);
}
function coffeeTable(it, K) {
  const { w, d, h } = it, hw = w / 2, hd = d / 2, f = K.fast, spec = K.spec({ color: it.base?.color ?? MAT.wood, material: 'wood', finish: 'satin' }), top = K.skin(spec), wood = K.skin(shade(spec, 0.86));
  K.add(K.soft(w, 1.6, d, { r: 0.65 }), top, 0, h - 1.6, 0);
  K.add(K.board(w - 5, 1.8, d - 5, 0.2), wood, 0, h - 3.4, 0);
  K.add(K.board(w - 6.5, 0.8, d - 6.5, 0.2), top, 0, 4.2, 0);
  const lg = K.geo(`ctleg|${h}`, () => legGeo(1.05, 0.62, h - 1.6, f ? 6 : 10));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.add(lg, wood, sx * (hw - 2.6), 0, sz * (hd - 2.6), { rz: sx * 0.05, rx: -sz * 0.05 });
}

// ------------------------------------------------------------------ desk, monitor, task chair
// Triangle budget for the whole desk set (desk, monitor, keyboard, chair): about 1,000 in Fast (plain boards, no clutter) and 5,000 in Visual.
/** A black mesh for the back of a task chair: a fine diamond lattice, near white so it multiplies the chair's colour. */
const meshTex = () => canvasTex('r3-mesh', 128, 128, (g, W, H) => {
  g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(205,205,205,0.28)'; g.fillRect(0, 0, W, H);   // the gaps let the room show through
  g.strokeStyle = 'rgba(235,235,235,1)'; g.lineWidth = 2.2;
  for (let i = -H; i <= W + H; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + H, H); g.stroke(); g.beginPath(); g.moveTo(i, H); g.lineTo(i + H, 0); g.stroke(); }
}, { repeat: [6, 6] });
/**
 * A rolling task chair: a five-star base on twin-wheel casters, a gas-lift column with its bellows, a tilt mechanism, a waterfall seat,
 * a curved back (mesh in Visual) on a post, and two armrests. Back at local -z, seat top about 19 in, overall about 42 in. `a` turns it.
 */
function taskChair(K, x, z, a) {
  const g = K.group(x, 0, z, a), f = K.fast, seatY = 16.2;
  const frame = K.metal(0x1b1c1f, 0.45, f ? 0.2 : 0.4), plastic = K.paint(0x151618, 0.55), lift = K.metal(0x9aa0a8, 0.25, f ? 0.3 : 0.8);
  const fab = K.skin(K.part('chair', { color: COLOR_CHAIR, material: 'fabric', finish: 'matte' }));   // the chair's look is an assumption until the renter says
  // the five-star base: a hub, five spokes that rise to the hub, and a twin-wheel caster at each tip (each turned its own way)
  K.add(K.geo(`tc-base|${f ? 1 : 2}`, () => {
    const parts = [], tmp = [], T = (o) => { tmp.push(o); return o; };
    const spoke = T(f ? new THREE.BoxGeometry(12.6, 1.5, 2.2) : (() => {   // a tapered spoke with a rounded tip, bevelled all round
      const sh = new THREE.Shape(); sh.moveTo(-6.3, -1.55); sh.lineTo(5.2, -0.95); sh.quadraticCurveTo(6.5, 0, 5.2, 0.95); sh.lineTo(-6.3, 1.55); sh.closePath();
      const sp = new THREE.ExtrudeGeometry(sh, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.28, bevelSize: 0.28, bevelSegments: 1, curveSegments: 5 }); sp.rotateX(-Math.PI / 2); sp.translate(0, -0.4, 0); return sp;
    })());
    const hub = T(new THREE.CylinderGeometry(1.9, 2.3, 2.4, f ? 8 : 12)), fork = T(new THREE.BoxGeometry(1.0, 1.9, 1.3));
    const wheel = T(f ? new THREE.BoxGeometry(2.3, 2.3, 0.8) : (() => {   // a twin caster: two soft wheels on one axle, a hood between them
      const w1 = new THREE.CylinderGeometry(1.15, 1.15, 0.62, 10); w1.rotateX(Math.PI / 2);
      const wl = w1.clone(); wl.translate(0, 0, -0.7); const wr = w1.clone(); wr.translate(0, 0, 0.7); const hood = new THREE.CylinderGeometry(0.55, 0.55, 0.9, 6); hood.rotateX(Math.PI / 2);
      const m = mergeParts([{ g: wl, tmp: true }, { g: wr, tmp: true }, { g: hood, tmp: true }]); w1.dispose(); return m;
    })());
    parts.push({ g: hub, m: mtx(0, 3.6, 0) });
    for (let k = 0; k < 5; k++) {
      const t = (k / 5) * TAU + 0.31, tx = Math.cos(t), tz = Math.sin(t), turn = -t + 0.5 + k * 1.3, cx = tx * 12.4, cz = tz * 12.4;
      parts.push({ g: spoke, m: mtx(tx * 6.6, 3.5, tz * 6.6, 0, -t, -0.07) }, { g: fork, m: mtx(cx, 2.4, cz, 0, turn) }, { g: wheel, m: mtx(cx, 1.15, cz, 0, turn) });
    }
    const m = mergeParts(parts); for (const o of tmp) o.dispose(); return m;
  }), frame, 0, 0, 0, { parent: g });
  // gas lift: a chrome piston inside a black bellows, then the tilt mechanism under the seat
  K.add(K.geo('tc-lift', () => legGeo(0.95, 0.95, 8, f ? 5 : 8)), lift, 0, 4.6, 0, { parent: g });
  K.add(K.geo('tc-bellows', () => (f ? legGeo(1.7, 1.4, 6.4, 6) : lathe([[0, 0], [1.4, 0], ...[0, 1, 2, 3, 4, 5].flatMap((i) => [[1.7, 0.45 + i * 1.05], [1.42, 0.95 + i * 1.05]]), [1.45, 6.4], [0, 6.4]], 14))), plastic, 0, 8.2, 0, { parent: g });
  K.add(K.board(9.5, 2.4, 11, 0.6), plastic, 0, seatY - 2.3, 0.6, { parent: g });
  // the seat: a padded pan with a waterfall front edge
  K.add(K.soft(20.4, 3.4, 19.6, { r: 1.5, s: 1, k: [2, 1, 2], kf: [2, 1, 2], puff: { py: 0.9 }, pow: 0.8, keepPuff: true }), fab, 0, seatY, 0.6, { parent: g });
  // the back: a post up from the mechanism, a frame and a curved panel that leans back a touch
  const lean = -0.1;
  K.add(K.board(1.8, 14.5, 1.2, 0.3), frame, 0, seatY + 1.2, -9.6, { parent: g, rx: lean });
  if (f) K.add(K.soft(18.6, 19.5, 2.6, { r: 1.2, k: [3, 2, 1], puff: { pz: 0.7 }, bendZ: 1.4, pow: 0.8, kf: [3, 2, 1], keepPuff: true }), fab, 0, seatY + 6.2, -10.4, { parent: g, rx: lean });
  else {
    const mesh = K.mat('tc-mesh', () => { const t = meshTex(), m = K.ctx.std(K.part('chair', { color: COLOR_CHAIR }).color, { roughness: 0.85, ...(t ? { map: t } : {}) }); m.transparent = !!t; m.side = THREE.DoubleSide; return m; });
    const bk = (geo, mat, x0, y, zz) => K.add(geo, mat, x0, y, zz, { parent: g, rx: lean });
    bk(K.soft(16.8, 17.6, 0.7, { r: 0.3, s: 1, k: [3, 3, 1], bendZ: 1.2 }), mesh, 0, seatY + 7.4, -10.3);
    bk(K.soft(18.8, 1.9, 2.3, { r: 0.8, s: 1, k: [3, 1, 1], bendZ: 1.2 }), plastic, 0, seatY + 24.4, -11.2);
    bk(K.soft(18.8, 1.6, 2.3, { r: 0.7, s: 1, k: [3, 1, 1], bendZ: 1.2 }), plastic, 0, seatY + 6.1, -10.3);
    for (const sx of [-1, 1]) bk(K.board(1.5, 19.6, 2.3, 0.5), plastic, sx * 9.2, seatY + 6.2, -10.4);
    bk(K.soft(9.5, 4.4, 1.5, { r: 0.6, s: 1, puff: { pz: 0.5 } }), fab, 0, seatY + 10.6, -9.1);   // a lumbar pad on the front of the mesh
  }
  // armrests: a post up from each side of the seat and a padded pad on top, about 7 in above the seat
  const post = K.board(1.3, 6.2, 1.9, 0.3), pad = K.board(2.8, 1.1, 10.8, 0.5);
  for (const sx of [-1, 1]) { K.add(post, frame, sx * 10.9, seatY + 1.2, -1.2, { parent: g }); K.add(pad, plastic, sx * 10.9, seatY + 7.1, 0.9, { parent: g }); }
  if (!f) K.add(K.geo('tc-lever', () => rodGeo(0.22, 4.6, 6)), lift, 5.4, seatY - 1.5, 1.4, { parent: g, ry: 0.4 });
}
/**
 * A monitor on a flat-footed stand: the screen's diagonal `diag` in inches at 16:9 (a 32-inch one is 27.9 x 15.7 in), thin bezels,
 * a slim casing with a bulge behind the electronics, a stand neck and a flat base. Stands on y, its stand at z, screen facing +z.
 */
function monitor(K, x, y, z, diag) {
  const f = K.fast, sw = diag * 0.8716, sh = diag * 0.4903, casing = K.skin(K.part('monitor', { color: 0x15171a, material: 'plastic', finish: 'satin' })), stand = K.metal(0x2a2c30, 0.35, f ? 0.3 : 0.6);
  const screen = K.mat('screen', () => { const t = screenTex(); return K.ctx.std(t ? 0xffffff : 0x0e1014, { roughness: 0.1, metalness: 0.15, ...(t ? { map: t } : {}) }); });
  const lift = clamp(sh * 0.2, 2.6, 4), bez = 0.3, tilt = -0.05, py = y + lift;
  K.add(K.board(clamp(sw * 0.34, 8.5, 11.5), 0.6, clamp(sw * 0.25, 6, 8.5), 1.2), stand, x, y, z + 0.8);   // the base plate
  K.add(K.board(2.6, lift + sh * 0.5, 0.9, 0.35), stand, x, y + 0.5, z - 2.1, { rx: -0.03 });   // the neck
  const pivot = K.group(x, py, z - 2.0, 0); pivot.rotation.x = tilt;
  K.add(K.board(sw + 0.5, sh + 0.5, 0.55, 0.22), casing, 0, 0, 0.35, { parent: pivot });   // thin front casing, slim all round
  if (!f) K.add(K.board(sw * 0.5, sh * 0.62, 1.1, 0.6), casing, 0, sh * 0.2, -0.4, { parent: pivot });   // the bulge behind the electronics
  const sc = new THREE.Mesh(K.geo(`scr|${diag}`, () => new THREE.PlaneGeometry(sw - 2 * bez, sh - 2 * bez)), screen); sc.position.set(0, sh / 2 + 0.25, 0.64); pivot.add(sc);
}
/**
 * A work desk with a solid top, four square legs, an apron with a shallow centre drawer, a low stretcher each side, a modesty panel
 * behind and a steel cable tray under the top. A monitor (`it.set.monitor`, a diagonal in inches, default 24; false for none) and a
 * keyboard and mouse on a desk mat stand on it, and a rolling task chair (`it.set.chair`, 'task' by default; false for none) at
 * the front. The back (the wall side) is -z.
 */
function desk(it, K) {
  const { w, d, h } = it, hw = w / 2, hd = d / 2, f = K.fast, spec = K.spec({ color: it.base?.color ?? MAT.oak, material: 'wood', finish: 'satin' });
  const topM = K.skin(spec), legM = K.skin(K.part('legs', shade(spec, 0.9))), apronM = K.skin(shade(spec, 0.93)), dark = K.metal(0x1d1f22, 0.45, f ? 0.2 : 0.5);
  const tT = 1.5, under = h - tT, leg = 3, lx = hw - 2.6 - leg / 2, lz = hd - 2.2 - leg / 2, apH = 4, set = it.set || {};
  K.add(f ? K.board(w, tT, d, 0, true) : K.soft(w, tT, d, { r: 0.55 }), topM, 0, under, 0);   // a solid top, eased all round
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.add(K.board(leg, under, leg, 0.35), legM, sx * lx, 0, sz * lz);
  K.add(K.board(2 * lx - leg, apH, 1, 0.2), apronM, 0, under - apH, lz);                                  // front apron
  K.add(K.board(24, apH - 0.7, 0.5, 0.12), K.skin(shade(spec, 1.06)), 0, under - apH + 0.25, lz + 0.62);   // a shallow centre drawer in it
  K.add(K.geo('dk-pull', () => boxGeo(5, 0.4, 0.5)), dark, 0, under - apH * 0.45, lz + 1.05, { cast: false });
  K.add(K.board(2 * lx - leg, 12, 0.8, 0.2), apronM, 0, under - 12 - 0.2, -lz + 0.1);                       // modesty panel: hides the cables behind
  for (const sx of [-1, 1]) {
    K.add(K.board(1, apH, 2 * lz - leg, 0.2), apronM, sx * lx, under - apH, 0);                           // side aprons
    K.add(K.board(1, 2, 2 * lz - leg, 0.2), apronM, sx * lx, 8.5, 0);                                      // low stretchers
  }
  // a steel cable tray under the back of the top, with a power strip and the cables down behind the panel
  K.add(K.board(w * 0.5, 2.6, 4.6, 0.2, true), dark, 0, under - 2.9, -hd + 5.4);
  if (!f) {
    K.add(K.board(w * 0.5 - 1, 0.5, 4, 0.1, true), K.paint(0xe9eaea, 0.5), 0, under - 2.2 - 0.9, -hd + 5.4);
    for (const dx of [-0.18, 0, 0.2]) K.add(K.geo('dk-cable', () => legGeo(0.22, 0.22, 11, 5)), K.paint(0x0c0c0d, 0.8), w * 0.31 + dx * 3, under - 12.2, -hd + 2.8, { cast: false });
    K.add(K.geo('dk-grommet', () => legGeo(1.25, 1.25, 0.1, 12)), dark, w * 0.31, h, -hd + 4.2, { cast: false });
  }
  // on the desk: the monitor in front of the chair, a keyboard and mouse on a mat
  const mon = set.monitor === false ? null : (set.monitor || 24);
  if (mon) monitor(K, 0, h, -hd + 8.2, mon);
  const keys = K.mat('keys', () => { const t = keysTex(); return K.ctx.std(t ? 0xffffff : 0xd0d3d6, { roughness: 0.5, metalness: 0.2, ...(t ? { map: t } : {}) }); });
  const kz = Math.min(hd - 7, -hd + 18);
  K.add(K.board(Math.min(32, w * 0.46), 0.16, 12.5, 0.07), K.fabric(0x1f2124), 0, h, kz + 0.4, { cast: false });   // desk mat
  K.add(K.soft(15.5, 0.55, 5, { r: 0.22, s: 1, uv: 'top' }), keys, -1.5, h + 0.16, kz);
  K.add(f ? K.board(2.4, 1.1, 4, 0.5) : K.soft(2.4, 1.1, 4, { r: 1.0, s: 1, puff: { py: 0.3 } }), K.paint(0xe6e7e8, 0.35), 11.2, h + 0.16, kz, { cast: false });
  if (!f) {   // a mug and a notebook: a desk someone works at
    K.add(K.geo('dk-mug', () => lathe([[0, 0], [1.55, 0], [1.7, 0.2], [1.7, 3.6], [1.55, 3.7], [1.4, 3.6], [0, 3.1]], 10)), K.paint(0xd9d4c8, 0.4), w * 0.36 - 10, h, -hd + 11, { cast: true });
    K.add(K.board(7.5, 0.7, 10, 0.18), K.paint(0x2a3a52, 0.6), -w * 0.33, h, -hd + 12, { ry: 0.25 });
  }
  if (set.chair !== false) taskChair(K, 0, hd + 12, Math.PI + 0.1);
}

// ------------------------------------------------------------------ TVs
/**
 * A TV: a thin panel (about 0.95 in at the rim, a bulge behind the electronics), a glass front with slim bezels and a slightly deeper
 * chin, vents and a standby light, and, on a wall, a low-profile mount: a wall plate, a VESA rail on the set and four spacer arms.
 * `it.screen` is the panel's width; a wall TV hangs `elev` inches off the floor with its back `d` from the wall.
 */
function tv(it, K) {
  const { w, d, h } = it, hd = d / 2, f = K.fast, scrW = it.screen || w, scrH = it.mount === 'wall' ? h : scrW * 0.574, bez = 0.3, chin = 0.55;
  const body = K.skin(K.spec({ color: 0x16181b, material: 'plastic', finish: 'satin' })), metal = K.metal(0x3a3d42, 0.4, 0.5), steel = K.metal(0x2a2d31, 0.38, 0.7);
  const glass = K.mat('tvglass', () => { const t = screenTex(); return K.ctx.std(t ? 0xffffff : 0x0d0f12, { roughness: 0.06, metalness: 0.2, ...(t ? { map: t } : {}) }); });
  const rim = K.metal(0x0d0e10, 0.3, f ? 0.2 : 0.45), led = K.mat('tvled', () => K.ctx.std(0xffffff, { roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.7 }));
  const panel = (y0, zBack) => {
    const zf = zBack + 0.95;
    K.add(K.soft(scrW, scrH, 0.95, { r: 0.28, s: 1 }), body, 0, y0, zBack + 0.48);   // the slab, rounded at the rim
    K.add(K.soft(scrW * 0.64, scrH * 0.5, 1.15, { r: 0.55, s: 1 }), body, 0, y0 + scrH * 0.14, zBack - 0.5);   // the bulge behind the electronics
    if (!f) {   // a satin metal rim round the glass, thin at the sides and top, a little deeper below
      K.add(K.board(scrW - 0.1, bez, 0.06, 0.02, true), rim, 0, y0 + scrH - bez - 0.03, zf, { cast: false });
      K.add(K.board(scrW - 0.1, chin, 0.06, 0.02, true), rim, 0, y0 + 0.03, zf, { cast: false });
      for (const sx of [-1, 1]) K.add(K.board(bez, scrH - 0.1, 0.06, 0.02, true), rim, sx * (scrW / 2 - bez / 2 - 0.02), y0 + 0.05, zf, { cast: false });
      const vents = K.geo(`tv-vents|${scrW}|${scrH}`, () => { const vp = [], bx = new THREE.BoxGeometry(scrW * 0.4, 0.12, 0.08); for (let r = 0; r < 7; r++) vp.push({ g: bx, m: mtx(0, scrH * 0.14 + 2 + r * 0.95, 0) }); return mergeParts(vp); });
      K.add(vents, K.paint(0x08090a, 0.9), 0, y0, zBack - 1.07, { cast: false });
      K.add(K.board(0.6, 0.18, 0.1, 0.04, true), led, 0, y0 + 0.17, zf + 0.03, { cast: false });   // the standby light
    }
    const gw = scrW - 2 * bez, gh = scrH - bez - chin, sc = new THREE.Mesh(K.geo(`tvscr|${gw.toFixed(2)}|${gh.toFixed(2)}`, () => new THREE.PlaneGeometry(gw, gh)), glass);
    sc.position.set(0, y0 + chin + gh / 2, zf + 0.012); K.s.add(sc);
  };
  if (it.mount === 'wall') {
    const e = it.elev || 0, back = -hd, cy = e + scrH / 2, zBack = back + 2.45, vx = 7.9, rail = Math.min(17, scrH * 0.62);
    K.add(K.board(2 * vx + 1.4, 1.3, 0.28, 0.1, true), steel, 0, cy + rail * 0.38, back + 0.14);   // the wall plate: two crossbars ...
    K.add(K.board(2 * vx + 1.4, 1.3, 0.28, 0.1, true), steel, 0, cy - rail * 0.38 - 1.3, back + 0.14);
    for (const sx of [-1, 1]) {
      K.add(K.board(1.3, rail + 1.3, 0.28, 0.1, true), steel, sx * vx, cy - rail / 2 - 0.65, back + 0.14);   // ... joined by two rails
      K.add(K.board(1.3, rail, 0.3, 0.1, true), steel, sx * vx, cy - rail / 2, zBack - 0.5 - 0.62);   // the VESA rails bolted to the set
      for (const sy of [-1, 1]) K.add(K.geo('mnt-arm', () => legGeo(0.34, 0.34, 1.12, f ? 5 : 8)), metal, sx * vx, cy + sy * rail * 0.3, back + 0.28 + 0.56, { rx: Math.PI / 2 });   // the spacer arms, wall to set
    }
    panel(e, zBack);
    return;
  }
  // on a media console
  const hw = w / 2, col = it.base?.color ?? MAT.woodDark, wood = K.wood(col, 0.55), front = K.wood(tone(col, 1.12), 0.52), legH = 3.5;
  const lg = K.geo('mc-leg', () => legGeo(0.8, 0.55, legH, 4, true)); for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.add(lg, K.wood(MAT.woodDark, 0.5), sx * (hw - 2), 0, sz * (hd - 1.8));
  K.add(K.soft(w, h - legH, d - 1.6, { r: 0.4 }), wood, 0, legH, -0.8);
  const n = w > 48 ? 3 : 2, cw = (w - 1.6) / n, fg = K.soft(cw - 0.3, h - legH - 1.8, 0.6, { r: 0.15, s: 1 }), pull = pullGeo(K, 4), dark = K.paint(0x221e1a, 0.95);
  const rv = new THREE.Mesh(K.geo('mc-rev', () => new THREE.PlaneGeometry(w - 1.4, h - legH - 1.2)), dark); rv.position.set(0, legH + (h - legH) / 2, hd - 1.58); K.s.add(rv);
  for (let i = 0; i < n; i++) { const x = -hw + 0.8 + cw * (i + 0.5); K.add(fg, front, x, legH + 0.9, hd - 1.6); K.add(pull, metal, x, legH + (h - legH) * 0.62, hd - 1.0, { cast: false }); }
  K.add(K.soft(14, 0.6, 8, { r: 0.6, s: 1 }), metal, 0, h, 0); K.add(K.board(2.6, 3.6, 1, 0.2), metal, 0, h + 0.4, -0.9);
  panel(h + 3.4, -0.5);
}

// ------------------------------------------------------------------ rugs
function rug(it, K) {
  const { w, d } = it, round = it.variant === 'round6' || !!it.base?.round, col = it.base?.color ?? MAT.rug, t = 0.32;
  const tex = rugTex(col, w, d, round);
  const m = K.mat('rug', () => K.ctx.std(tex ? 0xffffff : col, { roughness: 1, ...(tex ? { map: tex } : {}), ...(tex && !K.fast ? { bumpMap: tex, bumpScale: 0.8 } : {}) }));
  const g = round ? K.geo('rug-r', () => { const c = new THREE.CylinderGeometry(w / 2, w / 2, t, K.fast ? 40 : 72, 1); c.translate(0, t / 2, 0); return c; }) : K.soft(w, t, d, { r: 0.15, s: 1, uv: 'top' });
  K.add(g, m, 0, 0.01, 0, { cast: false });
}

// ------------------------------------------------------------------ plants
function plant(it, K) {
  const { w, h } = it, e = it.elev || 0, f = K.fast, small = h <= 26, r = rng(hashStr(it.id || 'plant') + (small ? 1 : 2));
  const potH = small ? clamp(h * 0.27, 4, 6) : clamp(h * 0.24, 9, 14), potR = small ? clamp(w * 0.4, 2.6, 3.8) : clamp(w * 0.38, 5, 7.5), seg = f ? 12 : 22;
  const potM = K.paint(small ? 0xc98f6d : 0xe8e2d6, 0.55), soilM = K.paint(0x3b2f27, 1);
  K.add(K.geo('pot', () => lathe([[0, 0.02], [potR * 0.7, 0], [potR * 0.76, 0.35], [potR * 0.97, potH - 1.2], [potR + 0.35, potH - 1.0], [potR + 0.35, potH], [potR - 0.25, potH], [potR - 0.35, potH - 0.9], [0, potH - 0.9]], seg)), potM, 0, e, 0);
  K.add(K.geo('soil', () => { const c = new THREE.CircleGeometry(potR - 0.3, seg); c.rotateX(-Math.PI / 2); return c; }), soilM, 0, e + potH - 0.6, 0, { cast: false });
  const greens = [0x48774f, 0x5e8d5a, 0x7aa36a], buckets = greens.map(() => []), stem = K.paint(0x6b5440, 0.9);
  const UP = new THREE.Vector3(0, 1, 0), stemParts = [], stemG = new THREE.CylinderGeometry(0.5, 1, 1, f ? 4 : 6, 1, true);
  stemG.translate(0, 0.5, 0);
  const stemTo = (a, b, rad) => { const d = new THREE.Vector3().subVectors(b, a), L = d.length(); stemParts.push({ g: stemG, m: new THREE.Matrix4().compose(a, new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new THREE.Vector3(rad, L, rad)) }); };
  if (small) {   // a tabletop pothos: a mound of heart-shaped leaves on thin stems, the outer ones spilling over the rim
    const leaf = leafGeo(3.9, 3.4, f ? 2 : 5, 'heart', 0.16, 0.12, f ? 1 : 2), n = f ? 10 : 32, rise = (h - potH - 4) * 0.8, soil = new THREE.Vector3(0, e + potH - 0.6, 0);
    for (let i = 0; i < n; i++) {
      const t = Math.sqrt((i + 0.5) / n), a = i * 2.39996 + r() * 0.3, rr = 0.3 + t * (potR - 0.2), y = potH + 0.6 + (1 - t * t) * rise * (0.8 + r() * 0.2);
      const pitch = -0.75 + t * 1.2 + (r() - 0.5) * 0.25;   // the centre stands up, the rim droops outward over the pot
      buckets[i % 3].push({ g: leaf, m: mtx(Math.cos(a) * rr, e + y, Math.sin(a) * rr, pitch, Math.PI / 2 - a, (r() - 0.5) * 0.4, 0.85 + r() * 0.3) });
      if (!f && i % 2 === 0) stemTo(soil, new THREE.Vector3(Math.cos(a) * rr, e + y, Math.sin(a) * rr), 0.06);
    }
  } else {   // a floor fiddle-leaf fig: a trunk, three side branches and broad leaves along the top of each
    const base = new THREE.Vector3(0, e + potH - 0.6, 0), trunkH = h - potH - 5.5, top = new THREE.Vector3(0.6, e + potH + trunkH, 0.3);
    stemTo(base, top, 0.9);
    const leaf = leafGeo(9, 7.2, f ? 2 : 5, 'fiddle', 0.1, 0.14, f ? 1 : 2);
    const stems = [[base, top, 0, f ? 8 : 24, 0.5]], branchSpec = [[0.36, 0.5, 0.8, 7.5], [0.5, 2.6, 0.72, 7], [0.64, 4.5, 0.66, 6.5]];
    for (const [at, az, tilt, len] of branchSpec) {
      const p0 = new THREE.Vector3().lerpVectors(base, top, at), p1 = p0.clone().add(new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)).multiplyScalar(len));
      stemTo(p0, p1, 0.42); stems.push([p0, p1, az, f ? 3 : 11, 0.25]);
    }
    stems.forEach(([p0, p1, az, n, from], si) => {
      for (let i = 0; i < n; i++) {
        const s = from + ((1 - from) * (i + 0.5)) / n, at = new THREE.Vector3().lerpVectors(p0, p1, s), a = si ? az + (r() - 0.5) * 2.8 : i * 2.39996 + r() * 0.4;
        const pitch = -0.12 - (si ? 0 : s * 0.5) + (r() - 0.5) * 0.5;   // out and a little up, the crown more upright
        buckets[(i + si) % 3].push({ g: leaf, m: mtx(at.x + Math.cos(a) * 0.4, at.y, at.z + Math.sin(a) * 0.4, pitch, Math.PI / 2 - a, (r() - 0.5) * 0.6, 0.75 + r() * 0.3) });
      }
    });
  }
  // the canopy is drawn freely, then narrowed about the trunk so it stays within the footprint (plus half an inch)
  const canopy = [];
  if (stemParts.length) canopy.push(K.add(mergeParts(stemParts), stem, 0, 0, 0, { cast: !small }));
  stemG.dispose();
  buckets.forEach((parts, i) => { if (parts.length) canopy.push(K.add(mergeParts(parts), K.mat(`leaf${i}`, () => K.ctx.std(greens[i], { roughness: 0.55, side: THREE.DoubleSide })), 0, 0, 0)); });
  let rx = 1e-3, rz = 1e-3;
  for (const m of canopy) { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) { rx = Math.max(rx, Math.abs(p.getX(i))); rz = Math.max(rz, Math.abs(p.getZ(i))); } }
  const kx = Math.min(1, (w / 2 + 0.5) / rx), kz = Math.min(1, ((it.d || w) / 2 + 0.5) / rz);
  for (const m of canopy) m.scale.set(kx, 1, kz);
}

// ------------------------------------------------------------------ entry
const BUILD = { sofa: seating, chair: seating, bed, nightstand, dresser, wardrobe, bookcase, table, 'table-low': coffeeTable, desk, tv, rug, plant };

/**
 * Draw the resolved item `it` into ctx.s and return true, or return false for kinds this module leaves to plan/furniture3d.js
 * (lamps, art, AC units, radiators). `ctx` = {s, std(color, opts), fabric(color, opts), quality: 'fast' | 'visual', texture}.
 * A piece that throws is cleared and handed back (false) so the older model draws it instead.
 */
export function build(it, ctx) {
  const fn = it && BUILD[it.kind];
  if (!fn || !ctx?.s || !(it.w > 0) || !(it.d > 0) || !(it.h > 0)) return false;
  const before = ctx.s.children.length;
  try { fn(it, kit(it, ctx)); return true; } catch (err) {
    while (ctx.s.children.length > before) { const o = ctx.s.children[ctx.s.children.length - 1]; ctx.s.remove(o); o.traverse((x) => x.geometry?.dispose()); }
    if (typeof console !== 'undefined') console.warn('[room3d] furniture model failed; using the simple one', it.kind, err);
    return false;
  }
}
