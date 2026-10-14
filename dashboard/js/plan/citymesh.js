// "City outside" for the Floor plan studio: the nearby buildings around the apartment in the plan's own
// frame (metres, x = plan x, z = -plan y, y up from the apartment floor). Placement comes from plan/city.js.
import * as THREE from 'three';
import { greenGroup, greenColors } from '../unit/greenmesh.js';

const M = 0.0254;

/**
 * Nearby buildings as one merged mesh in the plan-metre frame, heights measured from the apartment floor,
 * plus the unit's own building below its floor as a faint podium and the ground. Never casts shadows: the
 * per-window skylines decide which windows the city shades. Parks, lawns and trees from the site file's `green`
 * block (unit/greenmesh.js) are drawn on the street, so a window over a park shows one.
 */
export function cityGroup(ctx, opts = {}) {
  const R = opts.radius ?? 260, g = new THREE.Group(); g.name = 'city';
  const col = opts.colors || {};
  const P = [], N = [], C = [];
  const lo = new THREE.Color(col.low ?? 0x3a404c), hi = new THREE.Color(col.high ?? 0x8f97a6), roof = new THREE.Color(col.roof ?? 0xb5bcc8);
  const shape = (b) => {
    const sh = new THREE.Shape();
    for (let j = 0; j < b.n; j++) { const [x, y] = ctx.toPlanM([b.p[2 * j], b.p[2 * j + 1]]); j ? sh.lineTo(x, y) : sh.moveTo(x, y); }
    for (const h of b.holes || []) { const pa = new THREE.Path(); for (let j = 0; j < h.length / 2; j++) { const [x, y] = ctx.toPlanM([h[2 * j], h[2 * j + 1]]); j ? pa.lineTo(x, y) : pa.moveTo(x, y); } sh.holes.push(pa); }
    return sh;
  };
  const push = (geo, c) => {
    const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
    for (let k = 0; k < pos.length; k += 3) { P.push(pos[k], pos[k + 1], pos[k + 2]); N.push(nor[k], nor[k + 1], nor[k + 2]); const cc = nor[k + 1] > 0.9 ? roof.clone().lerp(c, 0.5) : c; C.push(cc.r, cc.g, cc.b); }
    geo.dispose();
  };
  const ground = -ctx.slab;
  let n = 0;
  for (let i = 0; i < ctx.B.length; i++) {
    const b = ctx.B[i]; if (i === ctx.ti) continue;
    const cx = (b.bb[0] + b.bb[2]) / 2, cy = (b.bb[1] + b.bb[3]) / 2;
    if (Math.hypot(cx - ctx.anchor[0], cy - ctx.anchor[1]) > R) continue;
    // a building with components (podium, tower, setback) is drawn as its parts, like the obstruction maths
    for (const q of b.parts || [b]) {
      const bottom = (q === b || q.base_m <= 0.5 ? Math.min(b.g, 0) - 1 : q.base) + ground, top = q.top + ground;
      const geo = new THREE.ExtrudeGeometry(shape(q), { depth: Math.max(0.5, top - bottom), bevelEnabled: false, curveSegments: 1 });
      geo.rotateX(-Math.PI / 2); geo.translate(0, bottom, 0);
      const t = Math.max(0, Math.min(1, Math.log(Math.max(q.top - Math.max(b.g, 0), 6) / 6) / Math.log(260 / 6)));
      push(geo, lo.clone().lerp(hi, Math.pow(t, 0.85)));
    }
    n++;
  }
  if (P.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
    m.name = 'neighbours'; g.add(m);
  }
  // this building below the apartment (its own floors above are left out so the plan stays visible)
  const podTop = -0.35;
  if (ctx.slab > 1) {
    const geo = new THREE.ExtrudeGeometry(shape(ctx.T), { depth: Math.max(0.5, podTop - (ground - 1)), bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, ground - 1, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col.own ?? 0x8b96ff, transparent: true, opacity: 0.35, roughness: 0.7, depthWrite: false }));
    m.name = 'this-building'; g.add(m);
  }
  const gr = new THREE.Mesh(new THREE.PlaneGeometry(2 * R + 200, 2 * R + 200), new THREE.MeshStandardMaterial({ color: col.ground ?? 0x15181f, roughness: 1 }));
  gr.rotation.x = -Math.PI / 2; gr.position.set(ctx.frame.xc * M, ground - 0.05, -ctx.frame.yw * M); gr.name = 'street level'; g.add(gr);
  if (ctx.green && opts.trees !== false) {
    const gg = greenGroup(ctx.green, { place: (x, y) => ctx.toPlanM([x, y]), center: ctx.anchor, radius: R + 20, y0: ground, colors: greenColors(new THREE.Color(col.ground ?? 0x15181f), !!opts.light) });
    g.add(gg); g.userData.green = gg.userData;
  }
  g.userData.count = n;
  return g;
}
