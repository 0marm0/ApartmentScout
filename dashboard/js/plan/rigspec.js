// The geometry of the renter's sim-racing cockpit: a Next Level Racing F-GT Lite (NLR-S015) with a Fanatec direct-drive wheel base and a
// Fanatec Formula (F1-style) wheel. Pure (no DOM, no three.js), so node:test covers it and the fit checks, the 2D plan and both 3D
// engines read the same numbers.
//
// What it is. A FOLDING TUBULAR cockpit: black round steel tubes, a black fabric SLING seat (a low pan and a tall back stretched between side
// tubes, no cushions, no armrests, no office-chair base), a single central tube from the front frame up to a small flat wheel deck, and a low
// pedal plate at the very front, with black-and-red round pivot caps where tubes meet. The side view follows the maker's GT and Formula
// position drawings (cm figures in furniture.json `spec`); the cockpit is drawn by eye inside the planning envelope.
//
// Frame. Inches. `x` across the rig (0 in the middle), `f` along it from the FRONT edge (the pedal end, f = 0) to the rear end (f = d),
// `z` up from the floor. The checks' item frame has +y toward the back, so y = f - d / 2; the 3D frame has +z toward the front, so
// z3 = d / 2 - f. The footprint is the conservative room-planning envelope (195 x 85 x 130 cm = 76.8 x 33.5 x 51.2 in, piece w = 33.5,
// d = 76.8); the maker publishes no seat, wheel-deck or pedal-plate sizes.
//
// Modes. 'gt' (default): the back more upright, the seat pan up at the middle pivot, the wheel deck high. 'formula': the whole seat low and
// reclined, the wheel deck low and the pedal plate raised toward the front. Either way the pedal end is low enough to slide under a desk
// (the pedals and the front tubes stay below 20 in, a desktop's underside is about 27.4 in) and the wheel deck's plate stays out from
// under the desk's edge.

export const RIG_STYLE = 'sim-rig';
export const MODES = ['gt', 'formula'];
/** The planning envelope, inches (195 x 85 x 130 cm, a conservative figure above every published one). */
export const ENVELOPE = { w: 33.5, d: 76.8, h: 51.2 };
const r1 = (v) => Math.round(v * 100) / 100;
const RAD = Math.PI / 180;

/** The numbers of one mode, all in the rig frame above. `d` and `w` default to the envelope. */
export function dimsOf(mode = 'gt', { w = ENVELOPE.w, d = ENVELOPE.d } = {}) {
  const gt = mode !== 'formula';
  const x = 12.4, backX = 10.6, footX = Math.min(15.15, w / 2 - 1.6), tube = 0.6;
  // the joints of one side (f, z): the front foot, the pivot over the pedal plate, the floor where the front legs meet, the middle pivot,
  // the seat pivot and the rear foot
  const J = gt
    ? { foot: [1.2, 0.9], pedalPivot: [8.5, 5.2], floor: [29.5, 1.0], mid: [43, 16.4], seat: [64, 15.8], rearFoot: [67.5, 1.0], rearEnd: [72.2, 1.0] }
    : { foot: [1.2, 0.9], pedalPivot: [8.5, 13.2], floor: [29.5, 1.0], mid: [42, 9.6], seat: [60, 3.4], rearFoot: [61.8, 1.0], rearEnd: [67, 1.0] };
  const deckZ = gt ? 26.6 : 17.0, plateT = 1.2, baseH = 5.1, baseL = 9, baseW = 5.9;
  const deckF1 = J.mid[0] + 1, deckF0 = deckF1 - 13;
  const baseF0 = deckF0 + 1.5, baseF1 = baseF0 + baseL;
  const wheelF = baseF1 + 2.7, wheelZ = deckZ + plateT + baseH / 2;
  const lean = gt ? 14 : 32, backLen = gt ? 36 : 31;   // degrees back from vertical, length along the back
  const seatF0 = gt ? 48 : 44, seatF1 = J.seat[0];
  // the pedal plate: a sloped slab from its front (high) end to the rear (low) end, three pads standing near the rear leaning to the front
  const plate = { f0: 9.5, z0: gt ? 6.0 : 13.8, f1: 27, z1: gt ? 2.6 : 3.0 };
  const at = (f) => plate.z0 + ((f - plate.f0) / (plate.f1 - plate.f0)) * (plate.z1 - plate.z0);
  const padBase = at(20), padH = 7.4;
  return {
    mode: gt ? 'gt' : 'formula', w, d, tube,
    x, backX, footX, joints: J,
    rail: { x, t: tube * 2, z0: 0.4, f0: 0, f1: J.rearEnd[0] + 1 },
    pedalPlate: { f0: plate.f0 - 1, f1: plate.f1 + 0.5, x: 8.5, z0: Math.min(plate.z0, plate.z1) - 0.4, z1: Math.max(plate.z0, plate.z1) + 0.4, slope: plate },
    pedals: { f0: 15, f1: 22.5, x: 5.9, z0: padBase, z1: padBase + padH, n: 3, base: padBase, h: padH },
    post: { f0: J.floor[0] + 1, f1: deckF0 + 8.5, x: 0.7, z0: 1, z1: deckZ },
    deck: { f0: deckF0, f1: deckF1, x: 7.2, z0: deckZ, z1: deckZ + plateT },
    base: { f0: baseF0, f1: baseF1, w: baseW, h: baseH, z0: deckZ + plateT, z1: deckZ + plateT + baseH },
    wheel: { f: wheelF, t: 1.1, w: 11.0, h: 6.7, z: wheelZ },
    seat: { f0: seatF0, f1: seatF1, x: 11.2, z0: J.seat[1] - 0.6, z1: J.seat[1] + (gt ? 0.2 : 0.2), slope: gt ? [[seatF0, J.seat[1] + 0.6], [seatF1, J.seat[1]]] : [[seatF0, J.mid[1] + 0.8], [seatF1, J.seat[1]]] },
    back: { f: J.seat[0], lean, len: backLen, x: backX + 0.3, t: 2.6, z0: J.seat[1] },
    h: gt ? ENVELOPE.h : 37,
  };
}

/** The back's top: its rearmost point and height. */
export function backTop(g) {
  const a = (g.back.lean * RAD);
  return { f: g.back.f + Math.sin(a) * g.back.len, z: g.back.z0 + Math.cos(a) * g.back.len };
}

/**
 * The tubes of one side as segments [(f, z), (f, z)] with the tube's `x` (+ and - are mirrored), and the cross tubes that join the two sides
 * as {f, z, x} (a tube along x of half-length x). The 3D engines draw these as cylinders, the 2D plan as strips.
 */
export function tubesOf(g) {
  const J = g.joints, bt = backTop(g);
  const side = [
    { id: 'front-leg', x: g.x, a: J.foot, b: J.pedalPivot },
    { id: 'pedal-frame', x: g.x, a: J.pedalPivot, b: J.floor, pair: true },
    { id: 'diagonal', x: g.x, a: J.floor, b: J.mid, pair: true },
    { id: 'seat-rail', x: g.x, a: J.mid, b: J.seat },
    { id: 'rear-leg', x: g.x, a: J.seat, b: J.rearFoot },
    { id: 'rear-foot', x: g.x, a: J.rearFoot, b: J.rearEnd },
    { id: 'back-tube', x: g.backX, a: [J.seat[0], J.seat[1]], b: [bt.f, bt.z] },
  ];
  const cross = [
    { id: 'foot', f: J.foot[0], z: J.foot[1], x: g.footX },
    { id: 'pedal-pivot', f: J.pedalPivot[0], z: J.pedalPivot[1], x: g.x },
    { id: 'floor', f: J.floor[0], z: J.floor[1], x: g.x },
    { id: 'mid', f: J.mid[0], z: J.mid[1], x: g.x },
    { id: 'seat-pivot', f: J.seat[0], z: J.seat[1], x: g.x },
    { id: 'rear', f: J.rearEnd[0], z: J.rearEnd[1], x: g.x },
    { id: 'back-top', f: bt.f, z: bt.z, x: g.backX },
  ];
  // the central tube from the front frame up to the underside of the wheel deck
  const centre = { id: 'deck-tube', x: 0, a: [J.floor[0] + 1, 1.2], b: [g.deck.f0 + 8, g.deck.z0 - 0.5] };
  return { side, cross, centre };
}

/**
 * The solid parts the fit checks use, in the item's frame (x0, x1, y0, y1 in plan inches, z0, z1 heights above the floor), plus the
 * heights the under-desk rule needs. Sloped tubes are the box around them. `d` and `w` default to the envelope.
 */
export function layoutOf(mode = 'gt', opts = {}) {
  const g = dimsOf(mode, opts), hd = g.d / 2, J = g.joints, P = (id, kind, x0, x1, f0, f1, z0, z1) => ({ id, kind, x0: r1(x0), x1: r1(x1), y0: r1(f0 - hd), y1: r1(f1 - hd), z0: r1(z0), z1: r1(z1) });
  const bt = backTop(g), t = g.tube, zMax = (a, b) => Math.max(a[1], b[1]) + t;
  const parts = [], sides = [['left', -1], ['right', 1]];
  for (const [nm, s] of sides) {   // each side's tubes in three boxes, so the front stays low where it goes under a desk
    const xc = s * g.x;
    parts.push(
      P(`rail-${nm}`, 'frame', xc - t, xc + t, 0.6, J.floor[0] + 1, 0.4, Math.max(J.pedalPivot[1], J.floor[1]) + t),
      P(`rail-${nm}-mid`, 'frame', xc - t, xc + t, J.floor[0], J.seat[0], 0.4, zMax(J.mid, J.seat)),
      P(`rail-${nm}-rear`, 'frame', xc - t, xc + t, J.seat[0], J.rearEnd[0] + 1, 0.4, J.seat[1] + t),
    );
  }
  parts.push(
    P('crossbar', 'frame', -g.footX, g.footX, J.foot[0] - 1, J.foot[0] + 1, 0.4, J.foot[1] + 1.4),
    P('pedal-plate', 'pedals', -g.pedalPlate.x, g.pedalPlate.x, g.pedalPlate.f0, g.pedalPlate.f1, g.pedalPlate.z0, g.pedalPlate.z1),
    P('pedals', 'pedals', -g.pedals.x, g.pedals.x, g.pedals.f0, g.pedals.f1, g.pedals.z0, g.pedals.z1),
    P('deck-post', 'deck', -g.post.x, g.post.x, g.post.f0, g.post.f1, g.post.z0, g.post.z1),
    P('wheel-deck', 'deck', -g.deck.x, g.deck.x, g.deck.f0, g.deck.f1, g.deck.z0, g.deck.z1),
    P('wheel-base', 'wheel', -g.base.w / 2, g.base.w / 2, g.base.f0, g.base.f1, g.base.z0, g.base.z1),
    P('wheel', 'wheel', -g.wheel.w / 2, g.wheel.w / 2, g.wheel.f - g.wheel.t / 2, g.wheel.f + g.wheel.t / 2, g.wheel.z - g.wheel.h / 2, g.wheel.z + g.wheel.h / 2),
    P('seat', 'seat', -g.seat.x, g.seat.x, g.seat.f0, g.seat.f1, Math.min(...g.seat.slope.map((q) => q[1])) - 0.4, Math.max(...g.seat.slope.map((q) => q[1])) + 0.4),
    P('seat-back', 'seat', -g.back.x, g.back.x, g.back.f, bt.f + g.back.t, g.back.z0, bt.z),
  );
  const under = (p) => p.z1;
  return {
    mode: g.mode, w: g.w, d: g.d, h: g.h, dims: g, parts,
    /** Parts whose plan outline lies within `f` inches of the front edge: what goes under a desk when the front slides under it. */
    frontParts: (f) => parts.filter((p) => p.y0 + hd < f),
    /** The tallest point of everything within `f` inches of the front edge (the pedal end). */
    frontHeight: (f) => Math.max(0, ...parts.filter((p) => p.y0 + hd < f).map(under)),
  };
}
