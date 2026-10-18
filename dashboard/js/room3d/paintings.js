// [room3d] The renter's paintings, hung in both 3D views as gallery-wrapped stretched canvases (furniture.json pieces with ref
// "canvas-painting" and an `art` key). One piece is one canvas or a row of canvases (a triptych: `spec.canvas.panels` and `gap`);
// the image runs across the face and wraps round the 1.5 in edges (a mirror wrap: the edge shows the strip next to it), with a matte
// varnish, a weave-and-brush-stroke normal map made from the picture's own luminance, and a soft shadow line on the wall.
//
// The photos of the paintings are the renter's own and the works may be under copyright, so they are never in the repository: the
// local `apartmentscout serve` lists what is in dashboard/data-private/art/ (git-ignored) in its session answer (`art`), and the page
// loads `data-private/art/<key>-hq.jpg` (a high-quality scan), `<key>-2x.jpg` (an upscaled copy) or `<key>.jpg` (or .jpeg, .png, .webp) from there. A triptych is best as one
// file per panel, left to right, `<key>-1` ... `<key>-3` (central-park-1.jpg ...); one image of all three side by side, cropped tightly to
// their outer edges, also works (the builder crops it to the row's shape and cuts out the gaps). Without a file, a public-domain painting uses its published scan (PUBLIC_ART) and any other piece gets a painterly placeholder in the same palette, drawn here.
// Pure helpers (panelLayout, coverCrop, artSources) run in Node; textures are made only in a browser.
import * as THREE from 'three';
import { getSession } from '../local-api.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const ART_DIR = 'data-private/art';
/** Public-domain paintings published with the dashboard (museum scans, colour-matched to the renter's prints): Van Gogh's Seascape near
 *  Les Saintes-Maries-de-la-Mer (Van Gogh Museum, 1888) and Monet's Red Boats, Argenteuil (Harvard Art Museums, 1875). A private file still wins. */
export const PUBLIC_ART = { seascape: 'assets/art/seascape.jpg', 'monet-red-boats': 'assets/art/monet-red-boats.jpg' };
const EXT = /\.(jpe?g|png|webp)$/i;
const phone = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 820;
/** A browser driven by a script (the test suite, the render budget): never seen close up, and on software GL a 4096 px picture costs minutes. */
const automated = () => typeof navigator !== 'undefined' && navigator.webdriver === true;
export const artTextureCap = (gpuMax, isPhone) => Math.min(isPhone ? 2048 : 4096, gpuMax > 0 ? gpuMax : 4096);
const FAST_MAX = 1024;   // Fast quality draws a picture at most this many px on its long side (5.6 MB with its mipmaps instead of 89 MB at 4096); Visual keeps the full size
const LIMITS = { maxTexture: 4096, anisotropy: 16 };
/** The renderer's own limits: a picture is drawn at most 4096 px on its long side (2048 on a phone, never past the GPU's max texture
 *  size), with the GPU's full anisotropy (three.js clamps it too). */
export function setArtLimits({ maxTexture, anisotropy } = {}) {
  LIMITS.maxTexture = artTextureCap(maxTexture, phone() || automated());
  if (anisotropy > 0) LIMITS.anisotropy = anisotropy;
}

/** The paintings the placeholders know (the key is also the private file's name). */
export const PAINTINGS = {
  seascape: { title: 'Seascape with a sailboat', paint: (g, W, H, r) => seascape(g, W, H, r) },
  'central-park': { title: 'Central Park from above, a triptych', paint: (g, W, H, r) => park(g, W, H, r) },
  'monet-red-boats': { title: 'Red Boats, Argenteuil (after Monet)', paint: (g, W, H, r) => redBoats(g, W, H, r) },
};

/**
 * The canvases of a painting piece `w` x `h` inches: one, or `spec.canvas.panels` side by side with `gap` inches between them.
 * Each has its centre `x` (inches from the piece's centre), its width, and the slice of the whole picture it shows (`u0`..`u1`, 0..1
 * across; the gaps are cut out of a one-image triptych).
 */
export function panelLayout(spec, w, h) {
  const c = spec?.canvas || {}, n = clamp(Math.round(c.panels || 1), 1, 6), gap = n > 1 ? clamp(c.gap ?? 2, 0, w / (n * 2)) : 0;
  const pw = (w - gap * (n - 1)) / n, out = [];
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + i * (pw + gap);
    out.push({ i, x: x0 + pw / 2, w: pw, h, u0: (x0 + w / 2) / w, u1: (x0 + pw + w / 2) / w });
  }
  return out;
}
/** The centred crop of an `iw` x `ih` image with the shape `aspect` (width / height): it fills the canvas without stretching. */
export function coverCrop(iw, ih, aspect) {
  if (iw / ih > aspect) { const sw = ih * aspect; return { sx: (iw - sw) / 2, sy: 0, sw, sh: ih }; }
  const sh = iw / aspect; return { sx: 0, sy: (ih - sh) / 2, sw: iw, sh };
}
/** Which private files serve painting `key`, from the names the local server lists: one whole image, or one per panel. */
export function artSources(key, names, panels = 1) {
  const files = (names || []).filter((n) => typeof n === 'string' && EXT.test(n) && !/[\\/]/.test(n));
  const stem = (n) => n.replace(EXT, '').toLowerCase();
  const pick = (base) => ['-hq', '-2x', ''].map((sfx) => files.find((n) => stem(n) === `${base}${sfx}`)).find(Boolean) || null;   // a high-quality scan (-hq), then an upscaled copy (-2x), then the photo
  const per = panels > 1 ? Array.from({ length: panels }, (_, i) => pick(`${key}-${i + 1}`)) : null;
  if (per && per.every(Boolean)) return { panels: per.map((n) => `${ART_DIR}/${encodeURIComponent(n)}`) };
  const whole = pick(key);
  if (whole) return { whole: `${ART_DIR}/${encodeURIComponent(whole)}` };
  return PUBLIC_ART[key] ? { whole: PUBLIC_ART[key] } : null;   // the published public-domain scan, for everyone
}

// ------------------------------------------------------------------ textures (browser only)
const PLACE = new Map(), REAL = new Map();
const browser = () => typeof document !== 'undefined' && !!document.createElement;
function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
function texOf(c, normal = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = normal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = LIMITS.anisotropy; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.userData.shared = true; return t;
}
/** Cut panel `p` (its u0..u1 slice) out of the whole picture `src`. */
function slice(src, p) {
  const sx = p.u0 * src.width, sw = (p.u1 - p.u0) * src.width, c = canvasOf(sw, src.height);
  c.getContext('2d').drawImage(src, sx, 0, sw, src.height, 0, 0, c.width, c.height); return c;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
/** A map and a normal map for each panel, from one canvas per panel. `inW` is a panel's width in inches (for the weave's scale). The
 *  normal maps are made in slices of a few tens of ms (normalSoon), so a 2048 px map never holds the page up for a long task. */
async function texSetSoon(canvases, inW) {
  const out = [];
  for (const c of canvases) { await tick(); out.push({ map: texOf(c), normal: texOf(await normalSoon(c, inW), true), w: c.width, h: c.height }); }
  return out;
}
/** A flat (straight-out) normal map: the placeholder's material is made with it, so the real one later swaps in without a new shader. */
let FLAT = null;
const flatNormal = () => { if (!FLAT) { FLAT = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); FLAT.needsUpdate = true; FLAT.userData.shared = true; } return FLAT; };

/** The placeholder textures of `key` (drawn once per page and shape). */
function placeholder(key, panels, w, h, fast = false) {
  const id = `${key}|${panels.length}|${w.toFixed(1)}|${h.toFixed(1)}|${fast ? 'f' : 'v'}`;
  if (PLACE.has(id)) return PLACE.get(id);
  if (!browser()) { PLACE.set(id, null); return null; }
  const P = PAINTINGS[key] || PAINTINGS.seascape, long = Math.min(fast ? FAST_MAX : 4096, panels.length > 1 ? 3072 : 2048);
  const W = w >= h ? long : Math.round(long * w / h), H = w >= h ? Math.round(long * h / w) : long, c = canvasOf(W, H);
  P.paint(c.getContext('2d'), W, H, rng(hash(key)));
  const canvases = panels.length > 1 ? panels.map((p) => slice(c, p)) : [c];
  const set = canvases.map((cv) => ({ map: texOf(cv), normal: null, w: cv.width, h: cv.height }));   // the picture now, its weave a moment later
  set.ready = (async () => { for (const [i, cv] of canvases.entries()) { await tick(); set[i].normal = texOf(await normalSoon(cv, panels[0].w), true); } return set; })();
  PLACE.set(id, set); return set;
}

let listing, known = null;   // `known`: the listing once it has arrived (a build then skips the placeholder of a picture that will load)
/** The private art files the local server can see, or [] (a static copy of the dashboard has no local API, so nothing is asked for). */
function privateNames() {
  listing ||= Promise.resolve().then(() => getSession()).then((s) => (known = Array.isArray(s?.art) ? s.art : []), () => (known = []));
  return listing;
}
if (browser()) privateNames();   // early, so the first build already knows which pictures are on this computer
async function loadImage(url) {
  const img = new Image(); img.decoding = 'async'; img.src = url;
  await img.decode(); return img;
}
/** Draw `img` cropped to `aspect` at its own resolution (at most the GPU's texture limit). */
function cropped(img, aspect, cap = LIMITS.maxTexture) {
  const k = coverCrop(img.naturalWidth, img.naturalHeight, aspect); let s = Math.min(1, cap / Math.max(k.sw, k.sh));
  let src = img, sx = k.sx, sy = k.sy, sw = k.sw, sh = k.sh;
  while (sw * s < sw / 2.2) {   // a large scan comes down in halves, so the filtering stays clean (no shimmer in fine brushwork)
    const h = canvasOf(sw / 2, sh / 2), hg = h.getContext('2d'); hg.imageSmoothingQuality = 'high'; hg.drawImage(src, sx, sy, sw, sh, 0, 0, h.width, h.height);
    src = h; sx = 0; sy = 0; s *= sw / h.width; sw = h.width; sh = h.height;
  }
  const c = canvasOf(sw * s, sh * s), g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height); return c;
}
/** The renter's own picture of `key` as textures per panel, or null when there is none (then the placeholder stays). */
function realSet(key, panels, w, h, fast = false) {
  const id = `${key}|${panels.length}|${w.toFixed(1)}|${h.toFixed(1)}|${fast ? 'f' : 'v'}`, cap = fast ? Math.min(FAST_MAX, LIMITS.maxTexture) : LIMITS.maxTexture;
  if (REAL.has(id)) return REAL.get(id);
  const p = browser() ? privateNames().then(async (names) => {
    const src = artSources(key, names, panels.length);
    if (!src) return null;
    if (src.panels) { const imgs = await Promise.all(src.panels.map(loadImage)); return texSetSoon(imgs.map((im, i) => cropped(im, panels[i].w / h, cap)), panels[0].w); }
    const whole = cropped(await loadImage(src.whole), w / h, cap);
    return texSetSoon(panels.length > 1 ? panels.map((q) => slice(whole, q)) : [whole], panels[0].w);
  }).catch((err) => { if (typeof console !== 'undefined') console.warn('[room3d] painting image not used', key, err?.message || err); return null; }) : Promise.resolve(null);
  REAL.set(id, p); return p;
}

/**
 * A tangent-space normal map from a painting's luminance: the high-pass of the luminance (a brush stroke's edges and ridges, not the
 * picture's light and dark) plus a fine plain-weave canvas, so the strokes and the cloth catch a raking light. At most 2048 px across
 * (1024 on a phone, where the canvas is never seen close enough to tell). A generator: it yields every few rows, so `normalSoon` can
 * hand the main thread back between slices.
 */
export const normalCap = (isPhone) => (isPhone ? 1024 : 2048);
function* normalSteps(src, inW) {
  const k = Math.min(1, normalCap(phone()) / Math.max(src.width, src.height)), W = Math.max(2, Math.round(src.width * k)), H = Math.max(2, Math.round(src.height * k));
  const c = canvasOf(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, W, H);
  const D = g.getImageData(0, 0, W, H), px = D.data, N = W * H, L = new Float32Array(N);
  yield;
  for (let i = 0; i < N; i++) { L[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255; if (i % (W * 256) === 0) yield; }
  const B = boxBlur(L, W, H, Math.max(2, Math.round(W / 220))), Hh = new Float32Array(N);
  yield;
  const per = clamp(W / (inW * 9), 3, 9);   // about 9 threads an inch, never finer than 3 px a thread (no moire in the mipmaps)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, tx = x / per, ty = y / per, over = ((Math.floor(tx) + Math.floor(ty)) & 1) === 0;
      const weave = 0.5 * (over ? Math.sin(Math.PI * (tx % 1)) : Math.sin(Math.PI * (ty % 1)));
      Hh[i] = clamp((L[i] - B[i]) * 2.6, -0.5, 0.5) + 0.12 * weave;
    }
    if ((y & 63) === 63) yield;
  }
  const s = 2.2;
  for (let y = 0; y < H; y++) {
    if ((y & 63) === 63) yield;
    for (let x = 0; x < W; x++) {
      const i = y * W + x, dx = Hh[y * W + Math.min(W - 1, x + 1)] - Hh[y * W + Math.max(0, x - 1)], dy = Hh[Math.min(H - 1, y + 1) * W + x] - Hh[Math.max(0, y - 1) * W + x];
      let nx = -dx * s, ny = dy * s, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;   // image rows run down, v runs up
      px[i * 4] = (nx * 0.5 + 0.5) * 255; px[i * 4 + 1] = (ny * 0.5 + 0.5) * 255; px[i * 4 + 2] = (nz * 0.5 + 0.5) * 255; px[i * 4 + 3] = 255;
    }
  }
  g.putImageData(D, 0, 0); return c;
}
/** Run normalSteps, giving the main thread back whenever a slice has run past ~30 ms. */
async function normalSoon(src, inW) {
  const it = normalSteps(src, inW); let t = performance.now();
  for (;;) {
    const r = it.next(); if (r.done) return r.value;
    if (performance.now() - t > 30) { await tick(); t = performance.now(); }
  }
}
function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), n = 2 * r + 1;
  for (let y = 0; y < H; y++) { let acc = 0; for (let x = -r; x <= r; x++) acc += src[y * W + clamp(x, 0, W - 1)]; for (let x = 0; x < W; x++) { tmp[y * W + x] = acc / n; acc += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)]; } }
  for (let x = 0; x < W; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, H - 1) * W + x]; for (let y = 0; y < H; y++) { out[y * W + x] = acc / n; acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; } }
  return out;
}

// ------------------------------------------------------------------ geometry
/** A stretched canvas `w` x `h`, `t` deep, centred, its face at +t/2: the face shows uv 0..1 and each edge mirrors the strip beside it. */
function wrapGeo(w, h, t) {
  const P = [], N = [], U = [], idx = [], hw = w / 2, hh = h / 2, ht = t / 2, du = t / w, dv = t / h;
  const quad = (a, b, c, d, n, ua, ub, uc, ud) => { const o = P.length / 3; for (const [p, uv] of [[a, ua], [b, ub], [c, uc], [d, ud]]) { P.push(...p); N.push(...n); U.push(...uv); } idx.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  quad([-hw, -hh, ht], [hw, -hh, ht], [hw, hh, ht], [-hw, hh, ht], [0, 0, 1], [0, 0], [1, 0], [1, 1], [0, 1]);   // the face
  quad([-hw, -hh, -ht], [-hw, -hh, ht], [-hw, hh, ht], [-hw, hh, -ht], [-1, 0, 0], [du, 0], [0, 0], [0, 1], [du, 1]);   // left edge
  quad([hw, -hh, ht], [hw, -hh, -ht], [hw, hh, -ht], [hw, hh, ht], [1, 0, 0], [1, 0], [1 - du, 0], [1 - du, 1], [1, 1]);   // right edge
  quad([-hw, hh, ht], [hw, hh, ht], [hw, hh, -ht], [-hw, hh, -ht], [0, 1, 0], [0, 1], [1, 1], [1, 1 - dv], [0, 1 - dv]);   // top edge
  quad([-hw, -hh, -ht], [hw, -hh, -ht], [hw, -hh, ht], [-hw, -hh, ht], [0, -1, 0], [0, dv], [1, dv], [1, 0], [0, 0]);   // bottom edge
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(idx);
  return g;
}
/** A soft shadow line round a `w` x `h` canvas on the wall (its plane is SHADOW_M inches bigger all round): darkest at the canvas's
 *  edge, gone about an inch out. White on black, as an alphaMap reads green. One per canvas shape, shared. */
const SHADOW_M = 2, SHADOWS = new Map();
function shadowMap(w, h) {
  const key = `${w.toFixed(1)}|${h.toFixed(1)}`;
  if (SHADOWS.has(key)) return SHADOWS.get(key);
  if (!browser()) { SHADOWS.set(key, null); return null; }
  const k = 8, c = canvasOf((w + 2 * SHADOW_M) * k, (h + 2 * SHADOW_M) * k), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.filter = `blur(${0.45 * k}px)`; g.fillStyle = '#fff';
  g.fillRect((SHADOW_M - 0.15) * k, (SHADOW_M - 0.15) * k, (w + 0.3) * k, (h + 0.3) * k);
  const t = new THREE.CanvasTexture(c); t.userData.shared = true; SHADOWS.set(key, t); return t;
}

/**
 * Hang painting `it` into the furniture kit `K` (room3d/furniture.js): inches, origin at the footprint's centre, +z the front, the
 * wall at z = -d/2. Draws the placeholder now and swaps in the renter's photo when it loads (an `as-art-ready` event asks both 3D
 * views for a fresh frame).
 */
export function paintingInto(it, K) {
  const key = it.art, d = it.d || 1.5, t = clamp(it.spec?.canvas?.depth ?? d, 0.5, 4), e = it.elev || 0, back = -d / 2;
  const panels = panelLayout(it.spec, it.w, it.h), cy = e + it.h / 2, fast = K.fast;
  const ph = known && artSources(key, known, panels.length) ? null : placeholder(key, panels, it.w, it.h, fast), wait = new THREE.Color(it.look?.color || 0x8fa7a8).getHex();   // the renter's photo is coming: its main colour until then
  const mats = panels.map((p, i) => {
    const tx = ph?.[i], o = { roughness: 0.6, ...(tx ? { map: tx.map, normalMap: tx.normal || flatNormal(), normalScale: new THREE.Vector2(0.25, 0.25) } : {}) };
    const m = fast ? K.ctx.std(tx ? 0xffffff : wait, o) : new THREE.MeshPhysicalMaterial({ color: tx ? 0xffffff : wait, ...o, metalness: 0, specularIntensity: 0.45, clearcoat: 0.12, clearcoatRoughness: 0.55 });   // a matte varnish: a faint, broad sheen
    m.userData.painting = key; return m;
  });
  panels.forEach((p, i) => {
    const mesh = K.add(K.geo(`art|${p.w.toFixed(2)}|${it.h.toFixed(2)}|${t}`, () => wrapGeo(p.w, it.h, t)), mats[i], p.x, cy, back + t / 2);
    mesh.name = `canvas-${i + 1}`;
    const am = shadowMap(p.w, it.h), shadow = K.mat(`art-shadow|${p.w.toFixed(1)}|${it.h.toFixed(1)}`, () => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: am ? 0.38 : 0, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...(am ? { alphaMap: am } : {}) }));
    const sh = K.add(K.geo(`art-sh|${p.w.toFixed(2)}|${it.h.toFixed(2)}`, () => new THREE.PlaneGeometry(p.w + 2 * SHADOW_M, it.h + 2 * SHADOW_M)), shadow, p.x + 0.2, cy - 0.35, back + 0.06, { cast: false });   // lit from above: a little low and to one side
    sh.receiveShadow = false; sh.renderOrder = 1; sh.name = 'art-shadow';
  });
  if (ph?.some((tx) => !tx.normal)) ph.ready.then(() => {   // the placeholder's weave, once made (the same textures for every build)
    mats.forEach((m, i) => { if (!m.userData.real && ph[i]?.normal) { m.normalMap = ph[i].normal; m.needsUpdate = true; } });
    if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('as-art-ready'));
  });
  realSet(key, panels, it.w, it.h, fast).then((set) => {
    if (!set) return;
    mats.forEach((m, i) => { if (!set[i]) return; m.map = set[i].map; m.normalMap = set[i].normal; m.normalScale = new THREE.Vector2(0.45, 0.45); m.color.set(0xffffff); m.needsUpdate = true; m.userData.real = true; });
    if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('as-art-ready'));
  });
}

// ------------------------------------------------------------------ the placeholders: painterly scenes in each painting's palette
function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const hash = (str) => [...String(str)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
const rgbOf = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
/** A brush: an elongated dab with a lighter ridge and a darker trough, its colour jittered. `pal` is a list of hex colours. */
function brushOf(g, r) {
  return (x, y, len, wid, ang, pal, a = 0.92, jit = 14) => {
    const c = rgbOf(pal[(r() * pal.length) | 0]), j = () => (r() - 0.5) * jit, col = c.map((v) => clamp(Math.round(v + j()), 0, 255));
    const cs = Math.cos(ang), sn = Math.sin(ang); g.setTransform(cs, sn, -sn, cs, x, y);
    g.globalAlpha = a; g.fillStyle = `rgb(${col})`; g.beginPath(); g.ellipse(0, 0, len / 2, wid / 2, 0, 0, TAU); g.fill();
    g.globalAlpha = a * 0.28; g.fillStyle = `rgb(${col.map((v) => Math.min(255, v + 38))})`; g.beginPath(); g.ellipse(0, -wid * 0.18, len * 0.42, wid * 0.16, 0, 0, TAU); g.fill();
    g.globalAlpha = a * 0.22; g.fillStyle = `rgb(${col.map((v) => Math.max(0, v - 42))})`; g.beginPath(); g.ellipse(0, wid * 0.3, len * 0.4, wid * 0.1, 0, 0, TAU); g.fill();
  };
}
const done = (g) => { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; };
function wash(g, W, y0, y1, stops) { const k = g.createLinearGradient(0, y0, 0, y1); stops.forEach(([t, c]) => k.addColorStop(t, c)); g.fillStyle = k; g.fillRect(0, y0, W, y1 - y0); }
/** Fill a band with strokes following `ang(x, y)`: `n` dabs of `len` x `wid` (fractions of W) from `pal`. */
function field(b, r, W, H, { x0 = 0, x1 = 1, y0, y1, n, len, wid, pal, ang = () => 0, a = 0.9, jit, when = () => true }) {
  for (let i = 0; i < n; i++) {
    const x = (x0 + r() * (x1 - x0)) * W, y = (y0 + r() * (y1 - y0)) * H; if (!when(x / W, y / H)) continue;
    const s = 0.7 + r() * 0.6; b(x, y, len * W * s, wid * W * s, ang(x / W, y / H) + (r() - 0.5) * 0.35, pal, a, jit);
  }
}

/** A Van Gogh-like seascape: a sailboat on rolling blue-green waves with white crests under a pale sky and white clouds. */
function seascape(g, W, H, r) {
  const b = brushOf(g, r), hz = 0.4;
  wash(g, W, 0, hz * H, [[0, '#86b4cf'], [0.6, '#b7d4dc'], [1, '#d9e6df']]); wash(g, W, hz * H, H, [[0, '#4f9c95'], [0.45, '#2c7477'], [1, '#174a55']]);
  field(b, r, W, H, { y0: 0, y1: hz, n: 5200, len: 0.022, wid: 0.006, pal: [0x7fb0cf, 0x9cc4da, 0xb9d6df, 0xd3e4e2, 0x6aa0c4], ang: (x, y) => -0.5 + Math.sin(x * 9 + y * 6) * 0.6 });
  for (let c = 0; c < 6; c++) {   // clouds: swirled clusters of cream and white
    const cx = r() * W, cy = (0.06 + r() * 0.24) * H, rw = (0.08 + r() * 0.12) * W, rh = rw * (0.25 + r() * 0.2);
    for (let i = 0; i < 520; i++) { const a = r() * TAU, d = Math.sqrt(r()); b(cx + Math.cos(a) * d * rw, cy + Math.sin(a) * d * rh, W * 0.016, W * 0.006, a + Math.PI / 2, [0xf6f3e8, 0xeceee6, 0xe2e6df, 0xfaf8f0], 0.85); }
  }
  const sea = [0x1f5f6b, 0x2c7a7b, 0x3f9a8f, 0x2a6d73, 0x5fb3a3, 0x174b57];
  field(b, r, W, H, { y0: hz, y1: 1, n: 9000, len: 0.03, wid: 0.007, pal: sea, ang: (x, y) => Math.sin(x * 14 + y * 22) * 0.45 });
  for (let k = 0; k < 9; k++) {   // rolling waves: a curve of bright strokes with foam on its crest, larger toward the front
    const y0 = hz + 0.04 + k * ((1 - hz - 0.06) / 9) + r() * 0.02, amp = 0.012 + k * 0.004, f = 3 + r() * 3, ph = r() * TAU, sz = 0.6 + k * 0.17;
    for (let x = -0.02; x < 1.02; x += 0.0035 / sz) {
      const y = y0 + amp * Math.sin(x * f * TAU + ph), dy = amp * f * TAU * Math.cos(x * f * TAU + ph);
      b(x * W, y * H + (r() - 0.5) * 8, 0.03 * W * sz, 0.008 * W * sz, Math.atan2(dy * H, W), [0x6cc0ae, 0x8fd1bf, 0x4ea89a], 0.9);
      if (Math.sin(x * f * TAU + ph) < -0.25 && r() < 0.8) b(x * W, (y - 0.006 * sz) * H, 0.022 * W * sz, 0.006 * W * sz, Math.atan2(dy * H, W), [0xf2f5ec, 0xdfeee6, 0xffffff], 0.92);
    }
  }
  // the sailboat: a dark hull with a red band, a mast and two cream sails
  const bx = 0.33 * W, by = (hz + 0.07) * H, s = H * 0.2;
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
  g.fillStyle = '#2b2a2c'; g.beginPath(); g.moveTo(bx - s * 0.42, by); g.lineTo(bx + s * 0.46, by - s * 0.03); g.lineTo(bx + s * 0.32, by + s * 0.1); g.lineTo(bx - s * 0.3, by + s * 0.1); g.closePath(); g.fill();
  g.fillStyle = '#b5452f'; g.fillRect(bx - s * 0.36, by + s * 0.005, s * 0.76, s * 0.03);
  g.strokeStyle = '#3a2e22'; g.lineWidth = Math.max(2, s * 0.018); g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + s * 0.02, by - s * 0.95); g.stroke();
  const sail = (pts, pal) => { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = '#efe4c6'; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
    const [xs, ys] = [pts.map((p) => p[0]), pts.map((p) => p[1])]; for (let i = 0; i < 260; i++) { const x = Math.min(...xs) + r() * (Math.max(...xs) - Math.min(...xs)), y = Math.min(...ys) + r() * (Math.max(...ys) - Math.min(...ys)); if (inTri(x, y, pts)) b(x, y, s * 0.06, s * 0.016, -1.35, pal, 0.85); } };
  sail([[bx + s * 0.03, by - s * 0.92], [bx + s * 0.03, by - s * 0.06], [bx + s * 0.44, by - s * 0.1]], [0xf1e6c8, 0xe8d6a8, 0xd9b46a, 0xf7f0dc]);
  sail([[bx - s * 0.02, by - s * 0.82], [bx - s * 0.02, by - s * 0.08], [bx - s * 0.36, by - s * 0.08]], [0xe9dcc0, 0xd8c08c, 0xf3ead6]);
  field(b, r, W, H, { x0: 0.24, x1: 0.44, y0: hz + 0.075, y1: hz + 0.12, n: 260, len: 0.02, wid: 0.005, pal: [0x6cc0ae, 0xf2f5ec, 0x3f9a8f] });   // spray at the bow
  done(g);
}
const inTri = (x, y, [[ax, ay], [bx, by], [cx, cy]]) => { const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry); const d1 = s(x, y, ax, ay, bx, by), d2 = s(x, y, bx, by, cx, cy), d3 = s(x, y, cx, cy, ax, ay); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };

/** Central Park from above: the Midtown skyline along the top, the park's canopy below it and the Lake winding through the middle. */
function park(g, W, H, r) {
  const b = brushOf(g, r), sky = 0.2, base = 0.36;
  wash(g, W, 0, base * H, [[0, '#cfdbe6'], [0.6, '#e9e6de'], [1, '#efe2cf']]);
  field(b, r, W, H, { y0: 0, y1: sky + 0.08, n: 3000, len: 0.012, wid: 0.004, pal: [0xd6e0e8, 0xc4d3df, 0xe9e5dc, 0xf1ebe0], ang: () => 0.1 });
  const towers = [];
  for (let x = 0; x < 1; x += 0.006 + r() * 0.012) { const mid = 1 - Math.abs(x - 0.58) * 1.4, tall = r() < 0.05 * Math.max(0.2, mid) * 3; towers.push({ x, w: 0.006 + r() * 0.016, top: base - (0.05 + r() * 0.12 * Math.max(0.3, mid) + (tall ? 0.14 + r() * 0.08 : 0)) }); }
  towers.sort((a, z) => a.top - z.top);
  for (const t of towers) {   // back to front: the tallest first
    const col = [0x6f7b88, 0x8c96a0, 0x4f5a66, 0xa9b2b8, 0x7d7a74, 0xb9b0a2][(r() * 6) | 0], [cr, cg, cb] = rgbOf(col);
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = `rgb(${cr},${cg},${cb})`; g.fillRect(t.x * W, t.top * H, t.w * W, (base - t.top) * H);
    for (let y = t.top; y < base; y += 0.006) b((t.x + t.w * (0.3 + r() * 0.4)) * W, y * H, t.w * W * 0.9, 0.003 * H, 0, [col, 0xd9dde0, 0x3e4650], 0.55, 18);   // a window grid read as strokes
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 0.35; g.fillStyle = '#f4efe2'; g.fillRect(t.x * W, t.top * H, t.w * W * 0.28, (base - t.top) * H);   // the lit side
  }
  done(g);
  field(b, r, W, H, { y0: base - 0.035, y1: base + 0.01, n: 2600, len: 0.006, wid: 0.01, pal: [0xbda98c, 0x9b8a73, 0xd8cbb4, 0x7d7064, 0xa9b2b8], ang: () => Math.PI / 2 });   // Central Park South along the edge
  wash(g, W, base * H, H, [[0, '#4d6f43'], [0.5, '#3e6b39'], [1, '#2f5a2f']]);
  const canopy = [0x2f5a2f, 0x3f7a3a, 0x5e9a4a, 0x8bb35a, 0x2a4a33, 0x6f8f3f, 0x9fbf6a];
  const lake = (x, y) => { const cy = 0.67 + 0.05 * Math.sin(x * 6.5 + 0.6) + 0.02 * Math.sin(x * 17), edge = Math.min(1, (x - 0.1) / 0.08, (0.88 - x) / 0.08), hw = (0.07 + 0.045 * Math.sin(x * 5 + 1.3)) * Math.max(0, edge); return Math.abs(y - cy) < hw; };
  for (let i = 0; i < 26000; i++) {   // the canopy: round dabs, smaller toward the skyline
    const x = r(), y = base + 0.01 + r() * (1 - base); if (lake(x, y)) continue;
    const sz = 0.004 + (y - base) * 0.014; b(x * W, y * H, sz * W * 1.4, sz * W, r() * TAU, canopy, 0.9, 20);
  }
  for (let i = 0; i < 9000; i++) {   // the Lake: a sky-blue sheet with darker banks and pale reflections
    const x = 0.1 + r() * 0.78, y = base + r() * (1 - base); if (!lake(x, y)) continue;
    b(x * W, y * H, 0.016 * W, 0.004 * W, 0.08 + (r() - 0.5) * 0.2, [0x3d6f8f, 0x4f84a3, 0x6f9fb8, 0x2f5a74, 0xa9c4d2], 0.9);
  }
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 0.8; g.strokeStyle = '#d8cfb5'; g.lineCap = 'round';
  for (let k = 0; k < 6; k++) {   // paths and drives, pale and gently winding
    g.lineWidth = W * (0.0012 + r() * 0.0012); g.beginPath(); let x = r() * W, y = (base + 0.03) * H, a = (r() - 0.5) * 0.8; g.moveTo(x, y);
    for (let s = 0; s < 60; s++) { a += (r() - 0.5) * 0.25; x += Math.sin(a) * H * 0.012; y += Math.cos(a) * H * 0.012; if (lake(x / W, y / H) || y > H) break; g.lineTo(x, y); } g.stroke();
  }
  g.globalAlpha = 1; g.fillStyle = '#efe7d4'; g.fillRect(0.47 * W, 0.645 * H, 0.03 * W, 0.006 * H);   // a bridge over the Lake
  done(g);
}

/** After Monet's Red Boats, Argenteuil: a sunlit river, a red-orange boat and its reflection on the right, moored masts, poplars and a red-roofed house on the green left bank. */
function redBoats(g, W, H, r) {
  const b = brushOf(g, r), hz = 0.52;
  wash(g, W, 0, hz * H, [[0, '#6f9bd2'], [0.7, '#a9c3e4'], [1, '#d2deea']]);
  field(b, r, W, H, { y0: 0, y1: hz, n: 4200, len: 0.02, wid: 0.007, pal: [0x7fa6d6, 0x96b7df, 0xb8cde8, 0x6c95cc], ang: () => -0.3 });
  for (let c = 0; c < 5; c++) { const cx = (0.3 + r() * 0.7) * W, cy = (0.08 + r() * 0.25) * H, rw = (0.07 + r() * 0.1) * W, rh = rw * 0.45; for (let i = 0; i < 380; i++) { const a = r() * TAU, d = Math.sqrt(r()); b(cx + Math.cos(a) * d * rw, cy + Math.sin(a) * d * rh, W * 0.018, W * 0.008, -0.3 + (r() - 0.5), [0xf5f3ea, 0xeef0f2, 0xe1e6ee, 0xfffdf6], 0.85); } }
  wash(g, W, hz * H, H, [[0, '#9cb9d8'], [0.4, '#6f97c4'], [1, '#4f7aae']]);
  field(b, r, W, H, { y0: hz, y1: 1, n: 7000, len: 0.028, wid: 0.006, pal: [0x5b86b8, 0x8fb0d6, 0xd6e2ee, 0x6f97c4, 0xb4cbe3], ang: () => 0 });
  // the left bank: poplars, the red-roofed house, the green strip, and their reflection in the water
  for (let i = 0; i < 9; i++) { const x = (0.02 + i * 0.04 + r() * 0.02) * W, top = (0.1 + r() * 0.16) * H, wd = (0.03 + r() * 0.02) * W;
    for (let k = 0; k < 420; k++) { const y = top + r() * (hz * H - top), sp = wd * (0.4 + 0.6 * (y - top) / (hz * H - top)) * 0.5; b(x + (r() - 0.5) * 2 * sp, y, W * 0.006, W * 0.018, Math.PI / 2 + (r() - 0.5) * 0.3, [0x2f5b37, 0x4d7a3e, 0x7a9a4a, 0x3b6a3a, 0x9bb35e], 0.9); } }
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = '#e9dcc0'; g.fillRect(0.12 * W, 0.43 * H, 0.1 * W, 0.08 * H);
  g.fillStyle = '#c4553a'; g.beginPath(); g.moveTo(0.11 * W, 0.435 * H); g.lineTo(0.17 * W, 0.39 * H); g.lineTo(0.23 * W, 0.435 * H); g.closePath(); g.fill();
  field(b, r, W, H, { x0: 0.11, x1: 0.23, y0: 0.39, y1: 0.51, n: 220, len: 0.012, wid: 0.004, pal: [0xc4553a, 0xd8704a, 0xe9dcc0, 0xf3ead6], when: (x, y) => y > 0.44 || Math.abs(x - 0.17) < (y - 0.39) * 1.3 });
  field(b, r, W, H, { x0: 0, x1: 0.5, y0: hz - 0.02, y1: hz + 0.035, n: 900, len: 0.02, wid: 0.006, pal: [0x6f9a4a, 0x8fb35a, 0x4f7a3e, 0xb9c86a] });
  field(b, r, W, H, { x0: 0, x1: 0.45, y0: hz + 0.04, y1: 0.8, n: 1700, len: 0.006, wid: 0.022, pal: [0x4f6f4a, 0x5f7f54, 0x6f8f9a, 0x3f5f45], ang: () => Math.PI / 2, a: 0.6 });
  // moored sailboats: white and grey hulls with tall masts
  for (let i = 0; i < 4; i++) { const x = (0.27 + i * 0.07) * W, y = (hz + 0.035) * H, hw = 0.03 * W;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = i % 2 ? '#e9e6dc' : '#c9c3b6'; g.beginPath(); g.ellipse(x, y, hw, 0.012 * H, 0, 0, Math.PI); g.fill();
    g.strokeStyle = '#5a4a3a'; g.lineWidth = Math.max(1.5, W * 0.0018); g.beginPath(); g.moveTo(x, y); g.lineTo(x + W * 0.002, y - (0.3 + r() * 0.12) * H); g.stroke();
    field(b, r, W, H, { x0: x / W - 0.02, x1: x / W + 0.02, y0: hz + 0.05, y1: hz + 0.16, n: 60, len: 0.004, wid: 0.016, pal: [0xe9e6dc, 0x9fb4cc], ang: () => Math.PI / 2, a: 0.6 }); }
  // the red-orange boat on the right, its mast and its long broken reflection
  const bx = 0.72 * W, by = 0.62 * H, s = 0.11 * W;
  for (let k = 0; k < 260; k++) { const y = by + 0.03 * H + r() * 0.3 * H, sp = s * (0.32 - 0.18 * (y - by) / (0.3 * H)); b(bx + (r() - 0.5) * 2 * sp, y, W * 0.02, W * 0.005, (r() - 0.5) * 0.15, [0xe0532a, 0xf07a3a, 0xd2452a, 0xf4a05a], 0.7); }
  field(b, r, W, H, { x0: (bx - s * 0.4) / W, x1: (bx + s * 0.4) / W, y0: (by + 0.04 * H) / H, y1: (by + 0.32 * H) / H, n: 160, len: 0.026, wid: 0.004, pal: [0x5b86b8, 0x8fb0d6, 0xd6e2ee], a: 0.8 });   // ripples break it up
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = '#d9472a'; g.beginPath(); g.moveTo(bx - s * 0.55, by - s * 0.12); g.lineTo(bx + s * 0.6, by - s * 0.16); g.lineTo(bx + s * 0.42, by + s * 0.08); g.lineTo(bx - s * 0.42, by + s * 0.08); g.closePath(); g.fill();
  field(b, r, W, H, { x0: (bx - s * 0.5) / W, x1: (bx + s * 0.5) / W, y0: (by - s * 0.13) / H, y1: (by + s * 0.07) / H, n: 200, len: 0.014, wid: 0.004, pal: [0xe0532a, 0xf07a3a, 0xf6b06a, 0xb93a22] });
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.strokeStyle = '#4a3a2c'; g.lineWidth = Math.max(2, W * 0.0026); g.beginPath(); g.moveTo(bx, by - s * 0.12); g.lineTo(bx - W * 0.004, 0.14 * H); g.stroke();
  for (let i = 0; i < 5; i++) b((0.42 + r() * 0.2) * W, (0.78 + r() * 0.12) * H, W * 0.012, W * 0.006, 0, [0xffffff, 0xf4f2ea], 0.95);   // white ducks
  done(g);
}
