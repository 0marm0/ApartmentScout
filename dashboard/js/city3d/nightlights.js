// The lamps of the night city, shared by Unit 3D and the Floor plan studio (they both build the city through city3d/city.js): street lamps along the street
// centrelines of the site file, bridge lights where a street is a bridge, and promenade lights along the river bank. One THREE.Points of soft glows (a
// bright core in a wide halo, additive), so the whole city's lamps cost one draw call and a few thousand vertices, in Fast as well as Visual.
//
// A VISUAL PREVIEW. The lamps stand where the street data puts a street, at a typical spacing: they say nothing about which lamps work. They never enter a sun hour.
// The placement is pure and lives in city3d/lampplan.js (node tests read it); nightLights() builds the mesh.
import * as THREE from 'three';
import { KINDS, LAMP_CAP, lampPlan, hash01 } from './lampplan.js';

export { KINDS, LAMP_CAP, lampPlan, along } from './lampplan.js';

const VS = `attribute vec3 aCol; attribute float aSize; uniform float uNight; uniform float uK; uniform float uOrtho; varying vec3 vCol; varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = uOrtho > 0.5 ? aSize * uK : aSize * uK / dist;
  gl_PointSize = clamp(px, 2.0, 56.0);
  // far lamps thin out into the haze; a lamp too small to see as a glow keeps a point of light but dims
  float fade = 1.0 - smoothstep(1100.0, 2400.0, uOrtho > 0.5 ? 0.0 : dist);
  vA = uNight * fade * min(1.0, px / 5.0);
  vCol = aCol;
}`;
const FS = `varying vec3 vCol; varying float vA;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 26.0), halo = exp(-r2 * 4.6) * 0.34;
  float a = (core + halo) * vA;
  gl_FragColor = vec4(vCol * 1.7, a);
}`;

/**
 * The lamps as a mesh. `data` = {streets, water}; o = {center, radius, place (site metres -> view metres), y0, phone, uNight (the facade's own uNight uniform object, so the
 * lamps come on with the lit windows)}. Returns {group, count, counts, setQuality({phone}), dispose()}.
 */
export function nightLights(data, o = {}) {
  const place = o.place || ((x, y) => [x, y]), y0 = o.y0 ?? 0;
  const plan = lampPlan(data, { center: o.center, radius: o.radius, cap: o.phone ? LAMP_CAP.phone : LAMP_CAP.desktop });
  const group = new THREE.Group(); group.name = 'night-lights';
  const pos = new Float32Array(plan.n * 3), col = new Float32Array(plan.n * 3), size = new Float32Array(plan.n);
  for (let i = 0; i < plan.n; i++) {
    const [px, py] = place(plan.x[i], plan.y[i]), K = KINDS[plan.kind[i]], j = 0.85 + 0.3 * hash01(i, 11);
    pos.set([px, y0 + plan.h[i], -py], i * 3); col.set([K.colour[0] * K.gain * j, K.colour[1] * K.gain * j, K.colour[2] * K.gain * j], i * 3); size[i] = K.size;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const U = { uNight: o.uNight || { value: 0 }, uK: { value: 600 }, uOrtho: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const pts = new THREE.Points(geo, mat); pts.name = 'lamps'; pts.frustumCulled = false; pts.renderOrder = 5;
  pts.onBeforeRender = (renderer, scene, camera) => {   // world metres to pixels for this view
    const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    U.uOrtho.value = camera.isOrthographicCamera ? 1 : 0;
    U.uK.value = (h / 2) * camera.projectionMatrix.elements[5];   // pixels per world metre at distance 1 (perspective) or at any distance (orthographic)
  };
  group.add(pts);
  return {
    group, count: plan.n, counts: plan.counts, points: pts,
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
