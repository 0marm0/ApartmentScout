// The wood of a real New York floor, drawn: block parquet ("basket weave"), the honey oak under most pre-war and post-war apartments, for both 3D
// engines (plan/interior3d.js floorTexture calls it). One tile is 4 x 4 blocks of 9 in; each block is three slats of 3 in, and neighbouring blocks run
// at right angles. Every block is its own tone (some a little warmer, some paler, a few dull), every slat a hair different again, with long
// cathedral grain, pores, a fine dark joint between slats and a stronger one between blocks, and a light lip where the varnish catches a bevel.
// Three canvases come out of ONE random stream so they agree pixel for pixel: the colour, a height map (slat tops high, joints sunk, grain and
// pores a little lower: the engines use it as a bump map, so light rakes across the blocks) and a roughness map (varnish: glossier on the slat
// face, dull in the joints and along worn patches, so a window's reflection breaks up on the wood instead of mirroring).
// A VISUAL PREVIEW: nothing here changes a number. Browser only (canvas); the pure helpers are exported for node tests.
// (No three.js import: `base` is a THREE.Color passed in, used through clone / multiplyScalar / convertLinearToSRGB only, so node tests run this file.)

export const BLOCK_IN = 9, SLATS = 3, BLOCKS = 4;
/** Metres one tile covers (4 blocks of 9 in). */
export const TILE_M = BLOCKS * BLOCK_IN * 0.0254;

const seeded = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Per-channel sRGB bytes of a linear THREE.Color times k, with `warm` (-1..1) pushing it towards amber (+) or straw (-). */
export function tone(base, k, warm = 0) {
  const c = base.clone().multiplyScalar(k); c.r *= 1 + 0.06 * warm; c.b *= 1 - 0.14 * warm; c.convertLinearToSRGB();
  return [clamp(c.r * 255, 0, 255) | 0, clamp(c.g * 255, 0, 255) | 0, clamp(c.b * 255, 0, 255) | 0];
}
const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const grey = (v, a = 1) => { const g = clamp(v * 255, 0, 255) | 0; return `rgba(${g},${g},${g},${a})`; };

/**
 * The block layout of a tile: per block its orientation and tone, so a test can check that the floor is not one flat tone.
 * Returns {blocks: [{bx, by, horiz, tone, warm, slats: number[]}]} from the same stream the drawing uses.
 */
export function basketPlan(seed = 20260) {
  const rnd = seeded(seed), blocks = [];
  for (let by = 0; by < BLOCKS; by++) for (let bx = 0; bx < BLOCKS; bx++) {
    const t = 0.82 + rnd() * 0.3 + (rnd() < 0.12 ? -0.1 : 0), warm = (rnd() - 0.5) * 1.6;
    blocks.push({ bx, by, horiz: (bx + by) % 2 === 0, tone: t, warm, slats: Array.from({ length: SLATS }, () => 0.95 + rnd() * 0.1) });
  }
  return { blocks };
}

/**
 * Draw one tile at N x N px. `base` = the floor's tone as a linear THREE.Color.
 * @returns {{color: HTMLCanvasElement, bump: HTMLCanvasElement, rough: HTMLCanvasElement}}
 */
export function drawBasket(N, base, seed = 20260) {
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const cv = { color: mk(), bump: mk(), rough: mk() }, g = { color: cv.color.getContext('2d'), bump: cv.bump.getContext('2d'), rough: cv.rough.getContext('2d') };
  const S = N / 1024, B = N / BLOCKS, sw = B / SLATS, rnd = seeded(seed ^ 0x9e37), plan = basketPlan(seed);
  // grounds: joint colour, height and roughness
  g.color.fillStyle = rgba(tone(base, 0.34)); g.color.fillRect(0, 0, N, N);
  g.bump.fillStyle = grey(0.08); g.bump.fillRect(0, 0, N, N);
  g.rough.fillStyle = grey(0.72); g.rough.fillRect(0, 0, N, N);
  const j = 1.6 * S;                                                   // joint half-width between slats
  for (const b of plan.blocks) {
    for (let k = 0; k < SLATS; k++) {
      const x = b.bx * B + (b.horiz ? 0 : k * sw), y = b.by * B + (b.horiz ? k * sw : 0), w = b.horiz ? B : sw, h = b.horiz ? sw : B;
      const x0 = x + j, y0 = y + j, ww = w - 2 * j, hh = h - 2 * j, t = b.tone * b.slats[k];
      // the slat face: a flat tone, lighter along one edge and darker along the other (the slat is slightly crowned), then the grain
      g.color.fillStyle = rgba(tone(base, t, b.warm)); g.color.fillRect(x0, y0, ww, hh);
      const lg = b.horiz ? g.color.createLinearGradient(0, y0, 0, y0 + hh) : g.color.createLinearGradient(x0, 0, x0 + ww, 0);
      lg.addColorStop(0, rgba(tone(base, 1.18, b.warm), 0.28)); lg.addColorStop(0.18, rgba(tone(base, 1, b.warm), 0)); lg.addColorStop(0.82, rgba(tone(base, 1, b.warm), 0)); lg.addColorStop(1, rgba(tone(base, 0.62, b.warm), 0.34));
      g.color.fillStyle = lg; g.color.fillRect(x0, y0, ww, hh);
      g.bump.fillStyle = grey(0.82); g.bump.fillRect(x0, y0, ww, hh);
      const bg = b.horiz ? g.bump.createLinearGradient(0, y0, 0, y0 + hh) : g.bump.createLinearGradient(x0, 0, x0 + ww, 0);   // the crown: edges fall away a little
      bg.addColorStop(0, grey(0.5, 0.9)); bg.addColorStop(0.12, grey(0.82, 0)); bg.addColorStop(0.88, grey(0.82, 0)); bg.addColorStop(1, grey(0.5, 0.9));
      g.bump.fillStyle = bg; g.bump.fillRect(x0, y0, ww, hh);
      const worn = 0.26 + rnd() * 0.12;                                // varnish: glossy face, with a duller patch now and then
      g.rough.fillStyle = grey(worn); g.rough.fillRect(x0, y0, ww, hh);
      // grain along the slat: long soft streaks (a few cathedral arches), then pores
      const along = b.horiz;
      const line = (off, len, bow, dark, lw, a) => {
        g.color.strokeStyle = dark ? rgba(tone(base, 0.55 + rnd() * 0.18, b.warm - 0.2), a) : rgba(tone(base, 1.3, b.warm + 0.2), a * 0.8);
        g.color.lineWidth = lw; g.color.beginPath();
        g.bump.strokeStyle = grey(dark ? 0.62 : 0.9, a * 0.7); g.bump.lineWidth = lw; g.bump.beginPath();
        for (const ctx of [g.color, g.bump]) {
          if (along) { ctx.moveTo(x0, y0 + off); ctx.bezierCurveTo(x0 + len * 0.3, y0 + off + bow, x0 + len * 0.68, y0 + off - bow * 0.8, x0 + ww, y0 + off + bow * 0.3); }
          else { ctx.moveTo(x0 + off, y0); ctx.bezierCurveTo(x0 + off + bow, y0 + len * 0.3, x0 + off - bow * 0.8, y0 + len * 0.68, x0 + off + bow * 0.3, y0 + hh); }
          ctx.stroke(); ctx.beginPath();
        }
      };
      const span = along ? hh : ww, len = along ? ww : hh;
      for (let q = 0; q < 34; q++) line(rnd() * span, len, (rnd() - 0.5) * 7 * S, rnd() > 0.34, (0.4 + rnd() * 1.1) * S, 0.05 + rnd() * 0.16);
      if (rnd() > 0.45) {                                              // a cathedral arch: nested bows where the saw met the growth rings
        const cx = along ? x0 + len * (0.25 + rnd() * 0.5) : x0 + span * (0.3 + rnd() * 0.4), cy = along ? y0 + span * (0.3 + rnd() * 0.4) : y0 + len * (0.25 + rnd() * 0.5);
        for (let r = 1; r <= 4; r++) {
          g.color.strokeStyle = rgba(tone(base, 0.62, b.warm - 0.2), 0.1 + r * 0.02); g.color.lineWidth = (0.5 + rnd() * 0.5) * S; g.color.beginPath();
          g.color.ellipse(cx, cy, (along ? 26 : 5) * r * S, (along ? 5 : 26) * r * S, 0, 0, Math.PI * 2); g.color.stroke();
        }
      }
      for (let q = 0; q < 70; q++) {                                   // pores and tiny flecks
        const px = x0 + rnd() * ww, py = y0 + rnd() * hh, sz = (0.6 + rnd() * 1.1) * S;
        g.color.fillStyle = rgba(tone(base, 0.4 + rnd() * 0.2, b.warm - 0.3), 0.18 + rnd() * 0.2); g.color.fillRect(px, py, along ? sz * 2.2 : sz, along ? sz : sz * 2.2);
        g.bump.fillStyle = grey(0.55, 0.5); g.bump.fillRect(px, py, along ? sz * 2.2 : sz, along ? sz : sz * 2.2);
      }
      if (rnd() > 0.82) {                                              // a small knot or mineral streak
        const px = x0 + rnd() * ww, py = y0 + rnd() * hh;
        g.color.fillStyle = rgba(tone(base, 0.5, b.warm - 0.4), 0.3); g.color.beginPath(); g.color.ellipse(px, py, (3 + rnd() * 4) * S, (1.4 + rnd() * 1.4) * S, along ? 0 : Math.PI / 2, 0, 6.28); g.color.fill();
      }
      // the bevel: a light lip along the top edge of the slat's visible side and a dark crease in the joint
      g.color.fillStyle = rgba(tone(base, 1.35, b.warm), 0.34);
      if (along) g.color.fillRect(x0, y0, ww, 1.1 * S); else g.color.fillRect(x0, y0, 1.1 * S, hh);
      g.color.fillStyle = rgba(tone(base, 0.3), 0.55);
      if (along) g.color.fillRect(x0, y0 + hh - 1.2 * S, ww, 1.2 * S); else g.color.fillRect(x0 + ww - 1.2 * S, y0, 1.2 * S, hh);
    }
    // the block's own joint is a touch wider and darker than the slat joints
    g.color.strokeStyle = rgba(tone(base, 0.26), 0.62); g.color.lineWidth = 2.6 * S; g.color.strokeRect(b.bx * B, b.by * B, B, B);
    g.bump.strokeStyle = grey(0.04, 0.9); g.bump.lineWidth = 2.6 * S; g.bump.strokeRect(b.bx * B, b.by * B, B, B);
  }
  // low-frequency mottling (a lighter patch where a window's sun has bleached the varnish, a darker one where it is thick), wrapped so the tile stays seamless
  for (let q = 0; q < 14; q++) {
    const cx = rnd() * N, cy = rnd() * N, r = (150 + rnd() * 260) * S, dk = rnd() > 0.5, a = 0.045 + rnd() * 0.05;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
      const x = cx + ox, y = cy + oy; if (x < -r || x > N + r || y < -r || y > N + r) continue;
      const rg = g.color.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, rgba(tone(base, dk ? 0.7 : 1.35), a)); rg.addColorStop(1, rgba(tone(base, dk ? 0.7 : 1.35), 0));
      g.color.fillStyle = rg; g.color.fillRect(x - r, y - r, 2 * r, 2 * r);
      const rr = g.rough.createRadialGradient(x, y, 0, x, y, r); rr.addColorStop(0, grey(dk ? 0.12 : 0.9, dk ? 0 : 0.1)); rr.addColorStop(1, grey(0.5, 0));
      g.rough.fillStyle = rr; g.rough.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  }
  return cv;
}
