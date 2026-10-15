// Draws the green ground of the city context as grass: parks, gardens, greenstreets and woods in lush tone, mapped
// lawns brighter and mown in stripes, paved playgrounds, courts and plazas as paved ground, turf fields flat green.
// Ground layers come from unit/grassplan.js (back to front, so overlapping polygons never fight); each layer is one
// triangulated mesh with vertex colours, lit like the rest of the scene (so building shadows fall on it in Visual
// quality) and textured in the fragment shader from world position: large tone patches, mown stripes, and metre-scale and
// blade-scale variation that fades out with distance, so a park reads as grass up close and is not noisy from afar.
// Shared by Unit 3D and the Floor plan's "City outside" through `place`, which maps a site point (x east, y north) to
// the view's ground coordinates; three.js world = (px, height, -py).
import * as THREE from 'three';
import { grassPlan, STYLE } from './grassplan.js';
import { hash01 } from './green.js';

const mixC = (a, b, t) => a.clone().lerp(b, t);

/**
 * Base colours per layer for a theme. The lit result is what the renter sees: the dark theme keeps lawns deep and the
 * paving close to the ground, the light theme brighter and fresher.
 */
export function grassColors(ground, light, visual = false) {
  const hex = (h) => new THREE.Color(h);
  const c = grassBase(ground, light, hex);
  // Visual quality adds an environment light that washes every lit surface paler: deepen the grass to match
  if (visual) for (const k of ['park', 'wood', 'lawn', 'turf']) c[k].multiplyScalar(light ? 0.8 : 0.85);
  return c;
}
function grassBase(ground, light, hex) {
  return light
    ? { park: hex(0x5ea64c), wood: hex(0x3f8746), lawn: hex(0x80c05a), paved: mixC(ground, hex(0xa8a496), 0.62), court: mixC(ground, hex(0x9aa3a6), 0.6), turf: hex(0x4f9e4a) }
    : { park: hex(0x276a37), wood: hex(0x1a4f2f), lawn: hex(0x317c3e), paved: mixC(ground, hex(0x56595e), 0.55), court: mixC(ground, hex(0x4a5760), 0.55), turf: hex(0x287a3b) };
}
const KIND_COLOR = { park: 'park', wood: 'wood', play: 'park', grass: 'lawn' };

const VS = (src) => src
  .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
  .replace('#include <project_vertex>', '#include <project_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
const NOISE = `
varying vec3 vGW; uniform float uPatch; uniform float uFine; uniform float uStripe; uniform float uHue;
float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gh(i), gh(i + vec2(1.0, 0.0)), f.x), mix(gh(i + vec2(0.0, 1.0)), gh(i + vec2(1.0, 1.0)), f.x), f.y); }`;
const GRASS = `#include <color_fragment>
{
  float dist = length(vViewPosition);
  float near = 1.0 - smoothstep(55.0, 280.0, dist);              // the fine detail fades with distance (no shimmer)
  vec2 p = vGW.xz;
  float n1 = gn(p / 28.0), n2 = gn(p / 7.0 + 17.0);
  float tone = 1.0 + uPatch * ((n1 - 0.5) * 1.8 + (n2 - 0.5) * 0.9);
  if (uFine > 0.0 && near > 0.0) {                                 // (off in the lighter levels: two noise reads fewer on every grass pixel)
    float n3 = gn(p / 1.7 + 5.0), n4 = gn(p / 0.4 + 9.0);
    tone += near * uFine * ((n3 - 0.5) * 1.2 + (n4 - 0.5) * 0.9);
  }
  diffuseColor.rgb *= tone;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.13, 1.03, 0.7), uHue * smoothstep(0.52, 0.85, n1) * 0.75);   // sun-bleached patches
  if (uStripe > 0.0) {
    float st = smoothstep(0.3, 0.7, abs(fract(dot(p, vec2(0.866, 0.5)) / 5.0) * 2.0 - 1.0));   // a soft-edged mown band every 5 m
    diffuseColor.rgb *= 1.0 + uStripe * (st - 0.5) * 2.0 * (1.0 - smoothstep(90.0, 320.0, dist));
  }
}`;

function layerMaterial(name, layer) {
  const st = STYLE[name], paved = name === 'paved' || name === 'court';
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: paved ? 0.95 : 1, metalness: 0, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1 - layer, polygonOffsetUnits: -1 - layer,
  });
  const u = { uPatch: { value: st.patch }, uFine: { value: st.fine }, uStripe: { value: st.stripe }, uHue: { value: st.hue } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = VS(shader.vertexShader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>' + NOISE).replace('#include <color_fragment>', GRASS);
  };
  mat.customProgramCacheKey = () => 'grass-v2';
  mat.userData.u = u; mat.userData.fine = st.fine;
  return mat;
}

/**
 * Group of the ground layers. `polys`: cleaned green polygons (unit/green.js `greenPlan(...).polys`, which carry hard / turf / src).
 * opts: place(x, y) -> [px, py]; y0 ground height; colors from grassColors(). Meshes are named `green-patches` (the base layer, which
 * the model export reads) and `green-patches-<layer>`.
 */
export function grassGroup(polys, opts = {}) {
  const { place = (x, y) => [x, y], y0 = 0, colors = grassColors(new THREE.Color(0x888888), false) } = opts;
  const g = new THREE.Group(); g.name = 'green';
  const plan = grassPlan(polys), tmp = new THREE.Color();
  g.userData = { polys: plan.reduce((a, l) => a + l.polys.length, 0), layers: plan.map((l) => l.name) };
  /** Metre- and blade-scale variation on or off (the step-down's lighter levels turn it off); the shader skips its two noise reads when off. */
  g.userData.setDetail = (on) => g.traverse((m) => { const mt = m.material; if (mt?.userData?.u) mt.userData.u.uFine.value = on ? mt.userData.fine : 0; });
  for (const { name, layer, polys: list } of plan) {
    const P = [], C = [];
    for (const p of list) {
      const ring = p.ring.map(([x, y]) => place(x, y));
      const sh = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const h of p.holes) sh.holes.push(new THREE.Path(h.map(([x, y]) => { const [a, b] = place(x, y); return new THREE.Vector2(a, b); })));
      let geo;
      try { geo = new THREE.ShapeGeometry(sh); } catch { continue; }
      geo.rotateX(-Math.PI / 2);
      const base = name === 'base' ? colors[KIND_COLOR[p.kind]] || colors.park : colors[name] || colors.park;
      // each polygon a touch different from its neighbour, so two touching parks do not merge into one flat colour
      tmp.copy(base).multiplyScalar(0.94 + 0.12 * hash01(Math.round(p.ring[0][0] * 4), Math.round(p.ring[0][1] * 4), 3));
      // ShapeGeometry is indexed: expand by the index (reading the vertices in order draws slivers that cut across the park)
      const pos = geo.attributes.position.array, ix = geo.index ? geo.index.array : null, y = y0 + 0.06 + layer * 0.015, nv = ix ? ix.length : pos.length / 3;
      for (let k = 0; k < nv; k++) { const v = ix ? ix[k] : k; P.push(pos[3 * v], y, pos[3 * v + 2]); C.push(tmp.r, tmp.g, tmp.b); }
      geo.dispose();
    }
    if (!P.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
    const n = new Float32Array(P.length); for (let k = 1; k < n.length; k += 3) n[k] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    const m = new THREE.Mesh(geo, layerMaterial(name, layer));
    m.name = name === 'base' ? 'green-patches' : `green-patches-${name}`; m.renderOrder = layer; m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
