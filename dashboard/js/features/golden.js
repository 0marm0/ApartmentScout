// Golden-hour map tint: how warm the wash over the map should be right now, and which side it leans in from.
// Pure (the sun position comes from sun.js, which has no DOM), so node can test it.
//
// The wash is strongest when the sun is about 3 degrees above the horizon, fades to nothing by 18 degrees in the
// afternoon and by 8 degrees below the horizon after sunset, and is absent the rest of the day and all night.
import { sunPos, DEG } from '../sun.js';

const smooth = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/** 0 to 1 warmth for a sun altitude in degrees. */
export function warmth(alt) {
  if (!Number.isFinite(alt)) return 0;
  return alt >= 3 ? smooth((18 - alt) / 15) : smooth((alt + 8) / 11);
}

/**
 * The tint for an instant and a place.
 * `intensity` is the warmth (0 to 1); `strength` is the opacity to paint it at (capped so it stays subtle);
 * `gx` and `gy` are percentages: where the glow sits, on the side of the north-up map the sun is on.
 */
export function goldenTint(ms, lat, lon, cap = 0.55) {
  const { az, alt } = sunPos(ms, lat, lon);
  const intensity = warmth(alt);
  const clamp = (v) => Math.max(-10, Math.min(110, v));
  return {
    az, alt, intensity,
    strength: +(intensity * cap).toFixed(3),
    gx: +clamp(50 + 60 * Math.sin(az * DEG)).toFixed(1),
    gy: +clamp(50 - 45 * Math.cos(az * DEG)).toFixed(1),
    phase: alt > 18 ? 'day' : alt >= -4 ? 'golden' : alt >= -8 ? 'dusk' : 'night',
  };
}
