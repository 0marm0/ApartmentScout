// The sky behind the city in the Floor plan studio's eye-level views: a gradient dome that follows the camera, a sun
// glow where the sun really is, and a haze (fog) that fades the far buildings and the street into the horizon, so the
// window shows a city under a sky and not a model floating in a void. A VISUAL PREVIEW: colours are chosen by eye per
// lighting mood; the sun's position is the one the studio already computes for the chosen date and time.
import * as THREE from 'three';

// zenith, horizon and haze per mood (sRGB hex); the glow is the sun's colour
export const SKY = {
  day: { zenith: 0x5f97d0, horizon: 0xd6e4f2, haze: 0xcddcec, glow: 0xfff4d6, hazeNear: 90, hazeFar: 520 },
  evening: { zenith: 0x2f3f78, horizon: 0xf0a468, haze: 0xd79a78, glow: 0xffc27a, hazeNear: 70, hazeFar: 460 },
  night: { zenith: 0x050813, horizon: 0x1c2748, haze: 0x141c36, glow: 0xb8c4ff, hazeNear: 60, hazeFar: 420 },
};

let dome = null, glow = null, mat = null;
const horizonUniform = { value: new THREE.Color() }, zenithUniform = { value: new THREE.Color() };

function build() {
  const geo = new THREE.SphereGeometry(300, 32, 20);
  mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: { zenith: zenithUniform, horizon: horizonUniform },
    vertexShader: `varying float vH;
void main() { vH = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    // the gradient: horizon colour at and below the horizon, the zenith above, eased so the band near the horizon stays pale
    fragmentShader: `uniform vec3 zenith;
uniform vec3 horizon;
varying float vH;
void main() {
  float k = smoothstep(0.0, 0.62, vH);
  gl_FragColor = vec4(mix(horizon, zenith, pow(k, 0.8)), 1.0);
  #include <colorspace_fragment>
}`,
  });
  dome = new THREE.Mesh(geo, mat); dome.name = 'sky'; dome.renderOrder = -10; dome.frustumCulled = false;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), k = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  k.addColorStop(0, 'rgba(255,255,255,1)'); k.addColorStop(0.08, 'rgba(255,255,255,0.95)'); k.addColorStop(0.16, 'rgba(255,255,255,0.35)'); k.addColorStop(0.5, 'rgba(255,255,255,0.08)'); k.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = k; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  glow.name = 'sun glow'; glow.scale.set(90, 90, 1); glow.renderOrder = -9; glow.frustumCulled = false;
}

/** The sky objects to add to the scene (built on first use). */
export function objects() { if (!dome) build(); return [dome, glow]; }

/**
 * Colour the sky for a mood and put the sun glow at `sunDir` (a vector toward the sun in world space, any length).
 * Returns the haze to give the scene: `{color, near, far}`.
 */
export function setMood(mood, sunDir, sunUp = true) {
  if (!dome) build();
  const m = SKY[mood] || SKY.day;
  zenithUniform.value.set(m.zenith); horizonUniform.value.set(m.horizon);
  glow.material.color.set(m.glow);
  const d = sunDir ? sunDir.clone().normalize() : new THREE.Vector3(0, 1, 0);
  glow.userData.dir = d; glow.userData.lit = sunUp && mood !== 'night' && d.y > -0.05; glow.visible = !!dome.visible && glow.userData.lit;
  glow.material.opacity = mood === 'evening' ? 1 : 0.85;
  return { color: new THREE.Color(m.haze), near: m.hazeNear, far: m.hazeFar };
}

/** Keep the dome and the glow centred on the camera, so the sky never moves as you walk. */
export function follow(pos) {
  if (!dome) return;
  dome.position.copy(pos);
  if (glow?.userData.dir) glow.position.copy(pos).addScaledVector(glow.userData.dir, 280);
}
export function show(on) { if (dome) { dome.visible = on; glow.visible = on && !!glow.userData.lit; } }
