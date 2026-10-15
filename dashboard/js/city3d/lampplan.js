// Where the lamps of the night city stand (city3d/nightlights.js draws them): street lamps along the street centrelines of the site file, bridge lights where a
// street is a bridge, promenade lights along the river bank. Pure (no three.js, no DOM), so node tests read it. A look, not a survey: the lamps stand where the
// street data puts a street at a typical spacing; they say nothing about which lamps work and never enter a sun hour.
import { streetStrokes, decodeWater } from '../unit/context-core.js';

/** Lamp kinds, as the shader's colour table reads them: 0 street (sodium warm), 1 bridge (cool white, taller), 2 river promenade (soft warm white). */
export const KINDS = [
  { name: 'street', height: 5.2, size: 7.5, colour: [1.0, 0.7, 0.38], gain: 1.0 },
  { name: 'bridge', height: 7.5, size: 10, colour: [0.88, 0.94, 1.0], gain: 1.25 },
  { name: 'river', height: 3.6, size: 6.5, colour: [1.0, 0.86, 0.66], gain: 0.9 },
];
export const LAMP_CAP = { desktop: 4200, phone: 1800 };

const BRIDGE = /\b(bridge|br)\b/i, FAST_ROAD = /\b(Dr|Drive|Expwy|Pkwy|Fwy|Hwy|Tunl|Tunnel|Exit|Entrance|Ramp)\b/i;
export const hash01 = (a, b = 0) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/** Points every `step` metres along a polyline, starting `start` metres in: [{x, y, nx, ny}] with the unit normal (left of travel). */
export function along(pts, step, start = 0) {
  const out = []; let next = start, base = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-6) continue;
    const ux = (bx - ax) / L, uy = (by - ay) / L;
    while (next <= base + L) { const d = next - base; out.push({ x: ax + ux * d, y: ay + uy * d, nx: -uy, ny: ux }); next += step; }
    base += L;
  }
  return out;
}

/**
 * Where the lamps stand. `site` = {streets, water} (the site file's blocks); o = {center: [x, y] metres, radius, cap}.
 * Streets get a lamp every 26 m (32 m on avenues) alternating sides; a street whose name says bridge gets one every 14 m on both sides; a highway or a ramp
 * one-sided every 38 m; alleys none; the river bank one every 38 m. Returns {x, y, h, kind} typed arrays in site metres (nearest the centre first when capped) and counts per kind.
 */
export function lampPlan(site, o = {}) {
  const [cx, cy] = o.center || [0, 0], radius = o.radius ?? 640, cap = o.cap ?? LAMP_CAP.desktop, list = [];
  const near = (x, y, r = radius) => Math.hypot(x - cx, y - cy) <= r;
  streetStrokes(site?.streets).forEach((s, si) => {
    if (s.road < 6.5) return;                                                  // alleys and service lanes: no lamps
    const name = s.name || '', bridge = BRIDGE.test(name), fast = FAST_ROAD.test(name), avenue = s.road >= 18;
    const step = bridge ? 14 : fast ? 38 : avenue ? 32 : 26, kind = bridge ? 1 : 0, off = s.road / 2 + (bridge ? 0.2 : 1.0);
    const pts = along(s.pts, step, hash01(si, 3) * step);
    pts.forEach((p, k) => {
      const sides = bridge ? [1, -1] : fast ? [k % 2 ? 1 : -1] : [k % 2 ? 1 : -1];   // alternate sides (a bridge: both)
      for (const sd of sides) { const x = p.x + p.nx * off * sd, y = p.y + p.ny * off * sd; if (near(x, y)) list.push({ x, y, kind }); }
    });
  });
  const w = decodeWater(site?.water);
  if (w) w.polys.forEach((poly, pi) => poly.rings.forEach((ring, ri) => {
    const closed = ring.concat([ring[0]]);
    for (const p of along(closed, 38, hash01(pi, ri) * 38)) if (near(p.x, p.y, radius * 1.4)) list.push({ x: p.x, y: p.y, kind: 2 });
  }));
  list.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  const kept = list.slice(0, cap), n = kept.length;
  const x = new Float32Array(n), y = new Float32Array(n), h = new Float32Array(n), kind = new Uint8Array(n), counts = [0, 0, 0];
  kept.forEach((l, i) => { x[i] = l.x; y[i] = l.y; kind[i] = l.kind; h[i] = KINDS[l.kind].height; counts[l.kind]++; });
  return { x, y, h, kind, n, counts, dropped: list.length - n };
}
