// three.js side of the lighting design in the Floor plan studio: the luminaires (fixture meshes and lights that come on
// in the Evening and Night moods) and a heat-map tint on the floor. A VISUAL PREVIEW: brightness here is a display
// gain, never lux; the numbers live in plan/lighting-model.js and are labelled there.
import * as THREE from 'three';
import * as G3 from './scene3d.js';
import { kelvinHex, sourcesOf } from './lighting-model.js';
import { heatMeshes } from '../room3d/heatfloor.js';

const M = 0.0254;
const GAIN = 0.14;                       // display gain, the same as the furniture lamps in scene3d.js
const W = (x, y, h = 0) => new THREE.Vector3(x * M, h * M, -y * M);
let root = null, lampRoot = null, tintRoot = null, mood = 'day', current = [], heat = null, ready = false;

/** Add the lighting group to the studio's scene (call once after G3.init). */
export function attach() {
  if (ready) return;
  const { scene } = G3.parts();
  root = new THREE.Group(); root.name = 'lighting'; scene.add(root);
  lampRoot = new THREE.Group(); lampRoot.name = 'luminaires'; root.add(lampRoot);
  tintRoot = new THREE.Group(); tintRoot.name = 'floor-tint'; root.add(tintRoot);
  G3.onMood((m) => { mood = m; applyOn(); });
  ready = true;
}

function disposeTree(g) {
  while (g.children.length) {
    const c = g.children.pop();
    c.traverse((o) => { o.geometry?.dispose(); const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) { m.map?.dispose(); m.dispose(); } });
  }
}

const emissive = (hex, on) => new THREE.MeshBasicMaterial({ color: on ? hex : new THREE.Color(hex).multiplyScalar(0.35), toneMapped: false });
const matte = (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7, metalness: 0.1 });

/** One luminaire as a group: fixture meshes plus its light(s) (off until the mood turns the lamps on). */
function build(l, ceiling) {
  const g = new THREE.Group(); g.userData.lum = l.id; g.name = `luminaire ${l.id}`;
  const hex = kelvinHex(l.k), lights = [], glow = [];
  const cd = (l.lm / (4 * Math.PI)) * GAIN;
  const bulb = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w * M, h * M, d * M), emissive(hex, true)); m.position.copy(W(x, y, z)); m.userData.glow = true; g.add(m); glow.push(m); return m; };
  if (l.type === 'recessed') {
    const trim = new THREE.Mesh(new THREE.CylinderGeometry(3.4 * M, 3.4 * M, 0.5 * M, 28), matte(0xeceef0)); trim.position.copy(W(l.x, l.y, l.z + 0.2)); g.add(trim);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.6 * M, 2.6 * M, 0.3 * M, 28), emissive(hex, true)); disc.position.copy(W(l.x, l.y, l.z - 0.1)); disc.userData.glow = true; g.add(disc); glow.push(disc);
    const sp = new THREE.SpotLight(hex, 0, 0, Math.min(Math.PI / 2.2, (Math.min(l.beam, 160) / 2) * (Math.PI / 180) * 1.35), 0.55, 2);
    sp.position.copy(W(l.x, l.y, l.z - 0.5)); sp.target.position.copy(W(l.x, l.y, 0)); sp.castShadow = false; sp.userData.cd = cd * 5.5;
    g.add(sp, sp.target); lights.push(sp);
  } else if (l.type === 'pendant') {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * M, 0.15 * M, Math.max(1, ceiling - l.z) * M, 6), matte(0x2e3238)); cord.position.copy(W(l.x, l.y, (ceiling + l.z) / 2)); g.add(cord);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(3 * M, 8 * M, 9 * M, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xf1e6d2, roughness: 0.8, side: THREE.DoubleSide, emissive: new THREE.Color(hex), emissiveIntensity: 0 }));
    shade.position.copy(W(l.x, l.y, l.z)); shade.userData.shade = true; g.add(shade);
    bulb(3, 3, 3, l.x, l.y, l.z - 1);
    const pl = new THREE.PointLight(hex, 0, 0, 2); pl.position.copy(W(l.x, l.y, l.z - 3)); pl.userData.cd = cd; g.add(pl); lights.push(pl);
  } else if (l.type === 'floor') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(6 * M, 6 * M, 1 * M, 24), matte(0x2e3238)); base.position.copy(W(l.x, l.y, 0.5)); g.add(base);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * M, 0.5 * M, (l.z - 4) * M, 8), matte(0x2e3238)); pole.position.copy(W(l.x, l.y, (l.z - 4) / 2)); g.add(pole);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(6 * M, 7.5 * M, 10 * M, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0xf1e6d2, roughness: 0.8, side: THREE.DoubleSide, emissive: new THREE.Color(hex), emissiveIntensity: 0 }));
    shade.position.copy(W(l.x, l.y, l.z + 1)); shade.userData.shade = true; g.add(shade);
    const pl = new THREE.PointLight(hex, 0, 0, 2); pl.position.copy(W(l.x, l.y, l.z + 1)); pl.userData.cd = cd; g.add(pl); lights.push(pl);
  } else if (l.type === 'strip') {
    const dx = l.x2 - l.x, dy = l.y2 - l.y, len = Math.max(6, Math.hypot(dx, dy));
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len * M, 0.6 * M, 0.8 * M), emissive(hex, true)); bar.position.copy(W((l.x + l.x2) / 2, (l.y + l.y2) / 2, l.z)); bar.rotation.y = Math.atan2(dy, dx); bar.userData.glow = true; g.add(bar); glow.push(bar);
    const n = 4;
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, pl = new THREE.PointLight(hex, 0, 0, 2); pl.position.copy(W(l.x + dx * t, l.y + dy * t, l.z - 2)); pl.userData.cd = cd / n; g.add(pl); lights.push(pl); }
  }
  g.userData.lights = lights; g.userData.glow = glow; g.userData.on = l.on !== false; g.userData.hex = hex;
  return g;
}

function applyOn() {
  if (!lampRoot) return;
  const lit = mood !== 'day', k = mood === 'night' ? 1 : 0.75;
  for (const g of lampRoot.children) {
    const on = lit && g.userData.on;
    for (const L of g.userData.lights || []) { L.intensity = on ? L.userData.cd * k : 0; L.visible = on; }
    for (const m of g.userData.glow || []) m.material.color.set(g.userData.hex).multiplyScalar(on ? 1 : 0.35);
    g.traverse((o) => { if (o.userData.shade) o.material.emissiveIntensity = on ? 0.9 : 0; });
  }
  G3.markDirty();
}

/** Replace the luminaires in the scene. `ceiling` = ceiling height in inches. */
export function setLuminaires(list, ceiling = 108) {
  if (!ready) return;
  disposeTree(lampRoot); current = list;
  for (const l of list) lampRoot.add(build(l, ceiling));
  mood = G3.moodNow(); applyOn();
}
/** Highlight one luminaire (or none) with a ring on the floor. */
export function select(id) {
  if (!ready) return;
  for (const g of lampRoot.children) {
    g.getObjectByName('sel-ring')?.removeFromParent();
    if (g.userData.lum === id) {
      const l = current.find((q) => q.id === id); if (!l) continue;
      const cx = l.type === 'strip' ? (l.x + l.x2) / 2 : l.x, cy = l.type === 'strip' ? (l.y + l.y2) / 2 : l.y;
      const ring = new THREE.Mesh(new THREE.RingGeometry(7 * M, 8.5 * M, 40), new THREE.MeshBasicMaterial({ color: 0x8b96ff, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(W(cx, cy, 0.6)); ring.name = 'sel-ring'; ring.renderOrder = 7; g.add(ring);
    }
  }
  G3.markDirty();
}

/**
 * Tint the floor of each room with a heat map. `rooms` = [{poly (plan inches), x0In, y0In, stepIn, nx, ny, canvas}] where
 * canvas is the room's heat image (top row = largest plan y, see plan/heatmap.js). Pass null or [] to remove the tint.
 */
export function setHeat(rooms, opacity = 0.82) {
  if (!ready) return;
  disposeTree(tintRoot); heat = rooms || null;
  for (const m of [...heatMeshes(rooms, { opacity }).children]) tintRoot.add(m);   // [room3d] the same tint Unit 3D's Inside camera draws
  G3.markDirty();
}
export const hasHeat = () => !!heat && heat.length > 0;
/** Sources in a luminaire list (for tests and the estimate). */
export const sourcesFor = (list) => list.flatMap((l) => sourcesOf(l));
