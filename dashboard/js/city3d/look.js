// The look of the city, shared by Unit 3D (unit/scene.js) and the Floor plan studio's eye-level views (plan/scene3d.js): the colours of
// the buildings, ground and sky from the design tokens of the current theme, the sky keyframes by sun altitude, the sky dome shader and the
// sun's glow sprite. One place, so the same city has the same colours, sky and haze in both engines. A VISUAL PREVIEW.
import * as THREE from 'three';
import { css } from '../util.js';

export const isLight = () => document.documentElement.dataset.theme === 'light';
const mix = (a, b, t) => a.clone().lerp(b, t);

// The light theme's design tokens, fixed: the daylight look of the eye-level views (Window, Inside, the studio's eye cameras) is the same in
// either UI theme, like the room's own white paint, so a dark dashboard does not give a dark city and a dark sky outside a bright room.
const DAY_TOKENS = {
  '--ground': '#f4f4f1', '--surface-1': '#ffffff', '--surface-2': '#fafaf8', '--surface-3': '#f1f1ed', '--ink': '#12151c', '--ink-2': '#4b5261', '--ink-3': '#656c7b',
  '--ink-4': '#aab0bc', '--accent': '#4952e2', '--sun': '#f5b547', '--warn': '#8f5a03', '--bad': '#bd3d27', '--band-30': '#3a93e0', '--score-1': '#e5604f', '--band-45': '#6a55b8',
};

// A natural daytime sky by sun altitude (sRGB hex; the dome is drawn without tone mapping, so these are the colours on the screen): night, dusk,
// golden hour and day. Day is a clear blue overhead going to a pale, hazy white at the horizon (the haze the far city fades into); golden hour and dusk
// warm the horizon through peach and rose while the zenith stays a deep blue.
const hexes = (a) => a.map((h) => new THREE.Color(h));
export const NATURAL_SKY = {
  zen: hexes(['#121c3a', '#34457a', '#5d85c2', '#2f7fdc']),
  hor: hexes(['#2b3658', '#e0906c', '#f6c79a', '#d4e6f6']),
};

/**
 * Colours for the scene, derived from the design tokens of the current theme.
 * `opts.daylight`: the eye-level look (the light theme's colours whatever the UI theme, and the natural sky above).
 */
export function palette(opts = {}) {
  const day = !!opts.daylight, L = day || isLight();
  const col = (name, fb) => { const v = day ? DAY_TOKENS[name] : css(name); return new THREE.Color(/^#[0-9a-f]{3,8}$/i.test(v) ? v.slice(0, 7) : fb); };
  const ground = col('--ground', '#08090c'), s1 = col('--surface-1', '#0e1015'), s2 = col('--surface-2', '#13161d'), s3 = col('--surface-3', '#1a1e27');
  const ink = col('--ink', '#eef1f6'), ink2 = col('--ink-2', '#a9b1bf'), ink3 = col('--ink-3', '#6f7889'), ink4 = col('--ink-4', '#4a5160');
  const accent = col('--accent', '#8b96ff'), sun = col('--sun', '#f5b547'), warn = col('--warn', '#f0b04c'), bad = col('--bad', '#f2735f');
  const blue = col('--band-30', '#3a93e0'), coral = col('--score-1', '#e5604f'), violet = col('--band-45', '#6a55b8');
  const white = new THREE.Color(1, 1, 1);
  // height classes (unit/heights.js HCLASS): light theme runs pale to deep blue, dark theme muted to bright
  const hcls = L
    ? [mix(s1, blue, 0.06), mix(s1, blue, 0.22), mix(s1, blue, 0.42), mix(s1, blue, 0.68), blue.clone(), mix(blue, ink, 0.4), mix(violet, ink, 0.5)]
    : [mix(s3, ink4, 0.55), mix(s3, blue, 0.3), mix(s3, blue, 0.55), mix(s3, blue, 0.8), mix(blue, ink, 0.22), mix(blue, ink, 0.48), mix(violet, ink, 0.5)];
  const lit = mix(sun, white, 0.45);
  return L ? {
    hcls, lit, blue,
    tBase: accent.clone(),
    light: true, ground: mix(s3, ink4, 0.22), bLow: mix(s3, ink4, 0.42), bHigh: mix(s1, s3, 0.25), street: mix(s1, s3, 0.2), streetOp: 0.95,
    outline: ink3, outlineOp: 0.32, edge: ink3, edgeOp: 0.22, accent, sun, warn, bad, ink, white,
    daylight: day,
    sky: day ? NATURAL_SKY : {
      zen: [mix(ink, violet, 0.35), mix(ink2, violet, 0.45), mix(s1, blue, 0.5), mix(s1, blue, 0.58)],
      hor: [mix(ink, blue, 0.22), mix(s1, coral, 0.42), mix(s1, sun, 0.42), mix(s1, blue, 0.14)],
    },
    hemiDay: 1.9, hemiNight: 0.9, sunMax: 3.4,
  } : {
    daylight: false,
    hcls, lit, blue,
    tBase: mix(accent, ground, 0.42),
    light: false, ground: mix(s3, ink4, 0.3), bLow: mix(s3, ink4, 0.5), bHigh: mix(ink4, ink3, 0.4), street: mix(s3, ink4, 0.55), streetOp: 0.9,
    outline: ink3, outlineOp: 0.3, edge: ground, edgeOp: 0.45, accent, sun, warn, bad, ink, white,
    sky: {
      zen: [ground.clone(), mix(ground, violet, 0.3), mix(s2, blue, 0.32), mix(s2, blue, 0.42)],
      hor: [mix(s2, s3, 0.5), mix(s3, coral, 0.38), mix(s3, sun, 0.42), mix(s3, blue, 0.24)],
    },
    hemiDay: 1.35, hemiNight: 1.1, sunMax: 4.6,
  };
}
// sky keyframes by sun altitude: night, dusk, golden, day
export const SKY_ALT = [-10, -2, 5, 22];
export function skyAt(stops, alt) {
  if (alt <= SKY_ALT[0]) return stops[0].clone();
  for (let i = 1; i < SKY_ALT.length; i++) if (alt <= SKY_ALT[i]) return mix(stops[i - 1], stops[i], (alt - SKY_ALT[i - 1]) / (SKY_ALT[i] - SKY_ALT[i - 1]));
  return stops[stops.length - 1].clone();
}

export const SKY_VS = `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
export const SKY_FS = `uniform vec3 zen; uniform vec3 hor; uniform vec3 gnd; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir); float h = d.y;
  // blue overhead, a pale haze band at the horizon (the air thickens towards it), a darker ground below it
  vec3 c = h > 0.0 ? mix(hor, zen, pow(clamp(h, 0.0, 1.0), 0.45)) : mix(hor, gnd, clamp(-h * 6.0, 0.0, 1.0));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  // the sun: a hard core, a bright halo and a wide soft haze that whitens and warms the sky around it
  c = mix(c, sunCol * 1.15 + 0.25, clamp(pow(s, 7.0) * 0.5 + pow(s, 28.0) * 0.35, 0.0, 0.85) * glow);
  c += sunCol * (pow(s, 1200.0) * 1.4 + pow(s, 120.0) * 0.35) * glow;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
