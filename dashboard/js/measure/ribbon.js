// Lines of a constant width on screen for the measuring tape (WebGL's own lines are always one pixel). Each segment is a quad
// whose corners are pushed sideways in screen space by half the width; a segment that crosses the camera's near plane is cut
// there, so a line to a point behind you still reads. No three.js addons needed: one small ShaderMaterial.
import * as THREE from 'three';

const VS = `
attribute vec3 aA; attribute vec3 aB; attribute vec2 aC;
uniform vec2 uRes; uniform float uWidth;
varying float vU;
void main() {
  vec4 va = modelViewMatrix * vec4(aA, 1.0), vb = modelViewMatrix * vec4(aB, 1.0);
  float n = 0.05;
  if (va.z > -n && vb.z > -n) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vU = 0.0; return; }
  if (va.z > -n) va = mix(va, vb, (-n - va.z) / (vb.z - va.z));
  if (vb.z > -n) vb = mix(vb, va, (-n - vb.z) / (va.z - vb.z));
  vec4 ca = projectionMatrix * va, cb = projectionMatrix * vb;
  vec2 sa = ca.xy / ca.w * uRes * 0.5, sb = cb.xy / cb.w * uRes * 0.5;
  vec2 d = sb - sa; float len = length(d); d = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-d.y, d.x);
  vec4 c = mix(ca, cb, aC.x);
  vec2 p = mix(sa, sb, aC.x) + nrm * aC.y * uWidth * 0.5 + d * (aC.x * 2.0 - 1.0) * uWidth * 0.25;
  gl_Position = vec4(p / (uRes * 0.5) * c.w, c.z, c.w);
  vU = aC.x * len;
}`;
const FS = `
uniform vec3 uColor; uniform float uDash; uniform float uOpacity;
varying float vU;
void main() {
  if (uDash > 0.0 && mod(vU, uDash * 2.0) > uDash) discard;
  gl_FragColor = vec4(uColor, uOpacity);
}`;

/**
 * @param {THREE.Vector3[][]} pairs [[a, b], ...] in the parent's space
 * @param {{color: THREE.Color, width?: number, dash?: number, opacity?: number}} o
 */
export function ribbon(pairs, { color, width = 3, dash = 0, opacity = 1 }) {
  const n = pairs.length, A = new Float32Array(n * 12), B = new Float32Array(n * 12), C = new Float32Array(n * 8), P = new Float32Array(n * 12), I = new Uint32Array(n * 6);
  const corner = [[0, -1], [0, 1], [1, -1], [1, 1]];
  pairs.forEach(([a, b], i) => {
    for (let k = 0; k < 4; k++) {
      A.set([a.x, a.y, a.z], (i * 4 + k) * 3); B.set([b.x, b.y, b.z], (i * 4 + k) * 3); C.set(corner[k], (i * 4 + k) * 2);
    }
    I.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aA', new THREE.BufferAttribute(A, 3)); g.setAttribute('aB', new THREE.BufferAttribute(B, 3)); g.setAttribute('aC', new THREE.BufferAttribute(C, 2));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  const m = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { uRes: { value: new THREE.Vector2(800, 600) }, uWidth: { value: width }, uColor: { value: new THREE.Color(color) }, uDash: { value: dash }, uOpacity: { value: opacity } },
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.userData.measure = true; mesh.userData.ribbon = true;
  return mesh;
}
/** Tell every ribbon under `root` how big the canvas is (CSS pixels). */
export function setRibbonSize(root, w, h) { root.traverse((o) => { if (o.userData.ribbon) o.material.uniforms.uRes.value.set(w, h); }); }
