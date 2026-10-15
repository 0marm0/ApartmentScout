// three.js helpers for the render-quality modes (features/render-quality.js): a procedural environment light and a
// material recompile after the shadow-map type changes. Kept apart so the pure settings stay testable in node.
import * as THREE from 'three';

// ------------------------------------------------------------------ environment light
const envCache = new WeakMap();   // renderer -> Map(intensity -> texture)
/**
 * A small procedural environment (a sky gradient with two window-shaped panels, no image files) prefiltered for
 * physically based materials. `intensity` scales it: dim on purpose, it adds sheen and soft fill while the scene's own
 * lights stay in charge.
 */
export function environmentFor(renderer, { warm = true, intensity = 1 } = {}) {
  const per = envCache.get(renderer) || new Map(); envCache.set(renderer, per);
  if (per.has(intensity)) return per.get(intensity);
  const s = new THREE.Scene();
  const g = new THREE.SphereGeometry(20, 32, 16), pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0xbfd2f2), mid = new THREE.Color(warm ? 0xfff2e0 : 0xeef2f8), bot = new THREE.Color(0x5a5248);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 20, c = y > 0 ? mid.clone().lerp(top, Math.pow(y, 0.7)) : mid.clone().lerp(bot, Math.pow(-y, 0.5));
    c.multiplyScalar(intensity); col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  s.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  for (const [x, z, w] of [[-12, -6, 7], [12, 6, 5]]) { // two bright windows give metal and varnish something to reflect
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(4 * intensity), side: THREE.DoubleSide }));
    p.position.set(x, 6, z); p.lookAt(0, 3, 0); s.add(p);
  }
  const pm = new THREE.PMREMGenerator(renderer), tex = pm.fromScene(s, 0.05).texture;
  pm.dispose(); g.dispose();
  per.set(intensity, tex);
  return tex;
}

/** Make every material in `scene` rebuild (after the shadow map type changes). */
export function recompileMaterials(scene) {
  scene.traverse((o) => { for (const m of [].concat(o.material || [])) m.needsUpdate = true; });
}

