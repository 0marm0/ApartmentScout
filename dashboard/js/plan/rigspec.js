// The geometry of the renter's sim-racing cockpit: a Next Level Racing F-GT Lite (NLR-S015) with a Fanatec direct-drive wheel base and a
// Fanatec Formula (F1-style) wheel. Pure (no DOM, no three.js), so node:test covers it and the fit checks, the 2D plan and both 3D
// engines read the same numbers.
//
// Frame. Inches. `x` across the rig (0 in the middle), `f` along it from the FRONT edge (the pedal end, f = 0) to the rear end (f = d),
// `z` up from the floor. The checks' item frame has +y toward the back, so y = f - d / 2; the 3D frame has +z toward the front, so
// z3 = d / 2 - f. The footprint is the conservative room-planning envelope (195 x 85 x 130 cm = 76.8 x 33.5 x 51.2 in, piece w = 33.5,
// d = 76.8); the shapes inside it are approximations: the maker publishes no seat, wheel-deck or pedal-plate sizes.
//
// Modes. 'gt' (default): upright seat back, the wheel deck high. 'formula': the back reclined, the seat low, the wheel deck low and the
// pedals higher. Either way the pedal end is low enough to slide under a desk (the pedals and the front rails stay below 20 in, a desktop's
// underside is about 27.4 in) and the wheel deck's plate stays below 26 in until it clears the desk edge.

export const RIG_STYLE = 'sim-rig';
export const MODES = ['gt', 'formula'];
/** The planning envelope, inches (195 x 85 x 130 cm, a conservative figure above every published one). */
export const ENVELOPE = { w: 33.5, d: 76.8, h: 51.2 };
const r1 = (v) => Math.round(v * 100) / 100;

/** The numbers of one mode, all in the rig frame above. `d` and `w` default to the envelope. */
export function dimsOf(mode = 'gt', { w = ENVELOPE.w, d = ENVELOPE.d } = {}) {
  const gt = mode !== 'formula', rail = 1.6, railX = w / 2 - 1.6;
  const deckZ = gt ? 24.5 : 13.6, plateT = 1.2, baseH = 5.1, baseL = 7.9, baseW = 5.9;
  const wheelZ = deckZ + plateT + baseH / 2;
  const seatF0 = gt ? 42 : 36, seatF1 = gt ? 60 : 52, seatZ = gt ? 13.5 : 8.5;
  const lean = gt ? 8 : 33, backLen = gt ? 36.5 : 25;   // degrees back from vertical, length along the back
  return {
    mode: gt ? 'gt' : 'formula', w, d,
    rail: { x: railX, t: rail, z0: 2.2, z1: 5.0, f0: 0, f1: d, foot_r: 1.4 },
    cross: { f0: 6, f1: 8.4, z0: 2.2, z1: 5.0 },
    pedalPlate: { f0: 1, f1: 15.5, x: 12.2, z0: gt ? 5 : 8, z1: gt ? 6.2 : 9.2 },
    pedals: { f0: 4, f1: 12.8, x: 8, z0: gt ? 6.2 : 9.2, z1: gt ? 15 : 19.5, n: 3 },
    post: { f0: 12, f1: 15.5, x: 3.6, z0: 5, z1: deckZ },
    deck: { f0: 12, f1: 31, x: 7.2, z0: deckZ, z1: deckZ + plateT },
    base: { f0: 20, f1: 20 + baseL, w: baseW, h: baseH, z0: deckZ + plateT, z1: deckZ + plateT + baseH },
    wheel: { f: 30.3, t: 1.1, w: 11.0, h: 6.7, z: wheelZ },
    seat: { f0: seatF0, f1: seatF1, x: 9.8, z0: seatZ - 3, z1: seatZ, mount_x: 8.5, mount_z0: 5, mount_z1: seatZ - 3 },
    back: { f: seatF1, lean, len: backLen, x: 10.8, t: 3.4, z0: seatZ },
    h: gt ? ENVELOPE.h : 37,
  };
}

/** The back's top: its rearmost point and height. */
export function backTop(g) {
  const a = (g.back.lean * Math.PI) / 180;
  return { f: g.back.f + Math.sin(a) * g.back.len, z: g.back.z0 + Math.cos(a) * g.back.len };
}

/**
 * The solid parts the fit checks use, in the item's frame (x0, x1, y0, y1 in plan inches, z0, z1 heights above the floor), plus the
 * heights the under-desk rule needs. A tilted seat back is the box around it. `d` and `w` default to the envelope.
 */
export function layoutOf(mode = 'gt', opts = {}) {
  const g = dimsOf(mode, opts), hd = g.d / 2, P = (id, kind, x0, x1, f0, f1, z0, z1) => ({ id, kind, x0: r1(x0), x1: r1(x1), y0: r1(f0 - hd), y1: r1(f1 - hd), z0: r1(z0), z1: r1(z1) });
  const bt = backTop(g), parts = [
    P('rail-left', 'frame', -g.rail.x - g.rail.t / 2, -g.rail.x + g.rail.t / 2, 0, g.d, g.rail.z0, g.rail.z1),
    P('rail-right', 'frame', g.rail.x - g.rail.t / 2, g.rail.x + g.rail.t / 2, 0, g.d, g.rail.z0, g.rail.z1),
    P('crossbar', 'frame', -g.rail.x, g.rail.x, g.cross.f0, g.cross.f1, g.cross.z0, g.cross.z1),
    P('pedal-plate', 'pedals', -g.pedalPlate.x, g.pedalPlate.x, g.pedalPlate.f0, g.pedalPlate.f1, g.pedalPlate.z0, g.pedalPlate.z1),
    P('pedals', 'pedals', -g.pedals.x, g.pedals.x, g.pedals.f0, g.pedals.f1, g.pedals.z0, g.pedals.z1),
    P('deck-post', 'deck', -g.post.x, g.post.x, g.post.f0, g.post.f1, g.post.z0, g.post.z1),
    P('wheel-deck', 'deck', -g.deck.x, g.deck.x, g.deck.f0, g.deck.f1, g.deck.z0, g.deck.z1),
    P('wheel-base', 'wheel', -g.base.w / 2, g.base.w / 2, g.base.f0, g.base.f1, g.base.z0, g.base.z1),
    P('wheel', 'wheel', -g.wheel.w / 2, g.wheel.w / 2, g.wheel.f - g.wheel.t / 2, g.wheel.f + g.wheel.t / 2, g.wheel.z - g.wheel.h / 2, g.wheel.z + g.wheel.h / 2),
    P('seat', 'seat', -g.seat.x, g.seat.x, g.seat.f0, g.seat.f1, g.seat.z0, g.seat.z1),
    P('seat-mounts', 'frame', -g.seat.mount_x, g.seat.mount_x, g.seat.f0 + 2, g.seat.f1 - 2, g.seat.mount_z0, g.seat.mount_z1),
    P('seat-back', 'seat', -g.back.x, g.back.x, g.back.f, bt.f + g.back.t, g.back.z0, bt.z),
  ];
  const under = (p) => p.z1;
  return {
    mode: g.mode, w: g.w, d: g.d, h: g.h, dims: g, parts,
    /** Parts whose plan outline lies within `f` inches of the front edge: what goes under a desk when the front slides under it. */
    frontParts: (f) => parts.filter((p) => p.y0 + hd < f),
    /** The tallest point of everything within `f` inches of the front edge (the pedal end). */
    frontHeight: (f) => Math.max(0, ...parts.filter((p) => p.y0 + hd < f).map(under)),
  };
}
