// Heat maps for the Floor plan studio: the colour scale, the per-room canvas (shared by the 2D plan and the 3D floor tint),
// the legend and the hover lookup. The scale is a fixed data ramp (not theme colours) so a map reads the same in dark
// and light; it is perceptually ordered and colour-blind safe (purple -> teal -> green -> yellow, like viridis).
const RAMP = [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]];

/** Colour for t in 0..1. */
export function ramp(t) {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  return RAMP[i].map((c, k) => Math.round(c + (RAMP[i + 1][k] - c) * f));
}
/** Scales: values map to the ramp through a square root, so dim corners stay readable next to bright window zones. */
export const SCALES = {
  daylight: { key: 'daylight', max: 10, ticks: [0, 0.5, 1, 2, 5, 10], unit: '%', title: 'Relative daylight', kind: 'modelled', digits: 1 },
  lux: { key: 'lux', max: 300, ticks: [0, 20, 50, 100, 200, 300], unit: ' lx', title: 'Lamp light', kind: 'estimate', digits: 0 },
};
export const scaleT = (v, s) => Math.sqrt(Math.max(0, Math.min(1, v / s.max)));
export const fmtVal = (v, s) => (v == null ? '—' : `${s.digits ? (v < 1 ? v.toFixed(2) : v.toFixed(s.digits)) : Math.round(v)}${s.unit}`);

/**
 * A canvas of nx x ny pixels for a grid room {nx, ny, values (row by row from the lowest plan y)}: the top canvas row is the
 * largest plan y, so the same image fits an SVG <image> (y down = -plan y) and a three.js texture (flipY). Cells outside the
 * room are transparent.
 */
export function heatCanvas(room, scale, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !room.nx || !room.ny) return null;
  const c = doc.createElement('canvas'); c.width = room.nx; c.height = room.ny;
  const g = c.getContext('2d'), im = g.createImageData(room.nx, room.ny);
  for (let j = 0; j < room.ny; j++) for (let i = 0; i < room.nx; i++) {
    const v = room.values[j * room.nx + i];
    if (v == null) continue;
    const t = scaleT(v, scale), [r, gg, b] = ramp(t), o = ((room.ny - 1 - j) * room.nx + i) * 4;
    im.data[o] = r; im.data[o + 1] = gg; im.data[o + 2] = b; im.data[o + 3] = Math.round(255 * (0.22 + 0.78 * Math.min(1, t * 2.5)));   // the dimmest cells stay see-through
  }
  g.putImageData(im, 0, 0);
  return c;
}
/** The grid value at plan point (x, y) inches, or null outside the room's cells. */
export function valueAt(room, x, y) {
  const i = Math.floor((x - room.x0In) / room.stepIn), j = Math.floor((y - room.y0In) / room.stepIn);
  return i < 0 || j < 0 || i >= room.nx || j >= room.ny ? null : room.values[j * room.nx + i];
}
/** Legend: gradient bar and ticks, as HTML (the colours are the only inline style: they are data). */
export function legendHTML(scale) {
  const stops = Array.from({ length: 12 }, (_, i) => { const t = i / 11; const [r, g, b] = ramp(t); return `rgb(${r},${g},${b}) ${Math.round(t * 100)}%`; }).join(',');
  const ticks = scale.ticks.map((v) => `<span style="left:${(scaleT(v, scale) * 100).toFixed(1)}%">${v}${v === scale.max ? '+' : ''}</span>`).join('');
  return `<div class="lx-legend" role="img" aria-label="${scale.title} scale from 0 to ${scale.max}${scale.unit.trim()} or more"><div class="lx-bar" style="background:linear-gradient(90deg,${stops})"></div><div class="lx-ticks">${ticks}</div><div class="lx-unit">${scale.unit.trim() || ''} · ${scale.kind}</div></div>`;
}
