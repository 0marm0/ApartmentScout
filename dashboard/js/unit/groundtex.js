// Paints the ground plate and the water mask of the city context into 2D canvases (any CanvasRenderingContext2D;
// node tests pass a recorder). One square window of `2 * half` metres centred on the site origin is mapped onto an
// N x N canvas, north up, so the textures drop onto a plane without a seam:
//
//   plate: block grey everywhere, then every street as a lighter sidewalk ribbon with a darker roadbed inside it
//          (widths from the street data, unit/context-core.js), a thin quay line along the shore, a fade back to
//          plain block grey beyond the surveyed radius (the streets stop there), and finally the water cut out
//          (destination-out), so the plate has holes where the rivers are and the water plane shows through;
//   mask:  water white on black (even-odd, so islands are holes): the water plane's alpha.
//
// Both use the same window and size, so the cut edge of the plate and the edge of the water plane coincide.
import { streetStrokes } from './context-core.js';

export const TEX_SIZE = 2048;

/** Window-to-canvas transform: x east, y north (m) -> canvas px, north up. */
export function windowMap(half, N = TEX_SIZE) {
  const s = N / (2 * half);
  return { s, X: (x) => (x + half) * s, Y: (y) => (half - y) * s };
}

function trace(g, rings, map) {
  g.beginPath();
  for (const ring of rings) {
    ring.forEach(([x, y], i) => (i ? g.lineTo(map.X(x), map.Y(y)) : g.moveTo(map.X(x), map.Y(y))));
    g.closePath();
  }
}
function strokeLines(g, strokes, widthOf, color, map) {
  g.strokeStyle = color; g.lineJoin = 'round'; g.lineCap = 'butt';
  for (const st of strokes) {
    const w = widthOf(st); if (!(w > 0)) continue;
    g.lineWidth = Math.max(1, w * map.s);
    g.beginPath(); st.pts.forEach(([x, y], i) => (i ? g.lineTo(map.X(x), map.Y(y)) : g.moveTo(map.X(x), map.Y(y)))); g.stroke();
  }
}

/**
 * Paint the plate. `colors`: {block, walk, road, quay} CSS colours. `streets` the site's streets, `water` the decoded
 * water ({polys: [{rings}]}) or null, `data` {radius} the surveyed radius (m) beyond which street detail fades out.
 */
export function paintPlate(g, { N = TEX_SIZE, half = 800, colors, streets = [], water = null, radius = 600 } = {}) {
  const map = windowMap(half, N), strokes = streetStrokes(streets);
  g.save();
  g.clearRect(0, 0, N, N);
  g.fillStyle = colors.block; g.fillRect(0, 0, N, N);
  // sidewalks: a ribbon as wide as the roadbed plus a walk on each side; then the roadbed on top
  strokeLines(g, strokes, (st) => (st.walk > 0 ? st.road + 2 * st.walk : 0), colors.walk, map);
  g.lineCap = 'round';
  strokeLines(g, strokes, (st) => st.road, colors.road, map);
  // the quay: a thin line along the shore (its water half is cut away below)
  const rings = water ? water.polys.flatMap((p) => p.rings) : [];
  if (rings.length) {
    g.strokeStyle = colors.quay; g.lineWidth = Math.max(1.5, 3 * map.s); g.lineJoin = 'round';
    trace(g, rings, map); g.stroke();
  }
  // beyond the surveyed radius the streets are not known: fade the detail into plain block colour
  const c = N / 2, r0 = (radius - 70) * map.s, r1 = (radius + 40) * map.s;
  g.globalCompositeOperation = 'source-atop';
  const gr = g.createRadialGradient(c, c, Math.max(0, r0), c, c, Math.max(r0 + 1, r1));
  gr.addColorStop(0, withAlpha(colors.block, 0)); gr.addColorStop(1, withAlpha(colors.block, 1));
  g.fillStyle = gr; g.fillRect(0, 0, N, N);
  // water: cut it out of the plate
  if (rings.length) {
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    trace(g, rings, map); g.fill('evenodd');
  }
  g.restore();
}

/** Paint the water mask: white where there is water (even-odd), black elsewhere. */
export function paintMask(g, { N = TEX_SIZE, half = 800, water = null } = {}) {
  const map = windowMap(half, N), rings = water ? water.polys.flatMap((p) => p.rings) : [];
  g.save(); g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
  if (rings.length) {
    g.fillStyle = '#fff'; trace(g, rings, map); g.fill('evenodd');
    // dilate by ~1.3 m so the mask reaches under the plate's cut edge (the plate hides the overlap) and no seam of base ground shows
    g.strokeStyle = '#fff'; g.lineJoin = 'round'; g.lineWidth = Math.max(1.5, 2.6 * map.s); g.stroke();
  }
  g.restore();
}

/** `#rrggbb` or `rgb(r, g, b)` with an alpha. */
export function withAlpha(css, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (m) { const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  const r = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(css);
  return r ? `rgba(${r[1]},${r[2]},${r[3]},${a})` : css;
}
