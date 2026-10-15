// The room's light as pure data (no three.js, so node tests can read it): the mood, the tone mapping by quality and the light state a mood and a sun give.
// Shared by room3d/lighting.js, which writes it to three.js lights. Numbers are the Floor plan studio's light look. A VISUAL PREVIEW.

export const MOOD_LIST = ['day', 'evening', 'night'];

/** The mood a want ('auto' | 'day' | 'evening' | 'night') gives for a sun: `up` = the sun is above the horizon, `sinAlt` = sin(altitude), 0 when down. */
export function moodFor(want, up, sinAlt) {
  if (MOOD_LIST.includes(want)) return want;
  return up ? (sinAlt < 0.12 ? 'evening' : 'day') : 'night';
}

/** Tone mapping by render quality: ACES filmic in Visual, a gentler Reinhard curve in Fast (no environment light, no extra cost on a phone). */
export const TONE = { visual: 'aces', fast: 'reinhard' };

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const rgb = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
/** Blend hex colours by weights (a = [[hex, w], ...], w summing to 1). */
const mixHex = (a) => { const o = [0, 0, 0]; for (const [h, w] of a) { const c = rgb(h); for (let i = 0; i < 3; i++) o[i] += c[i] * w; } return (Math.round(o[0]) << 16) | (Math.round(o[1]) << 8) | Math.round(o[2]); };

/**
 * How much of each mood a sun altitude (degrees) is, so the light moves smoothly through a day instead of jumping where the sun crosses a threshold:
 * full day above 16 degrees, a golden-hour evening from about 2 degrees up to there, dusk through twilight, night below -8.
 * @returns {{day: number, evening: number, night: number}} weights summing to 1
 */
export function autoWeights(alt) {
  const day = smooth(2, 16, alt), night = 1 - smooth(-8, 1, alt);
  return { day, night, evening: Math.max(0, 1 - day - night) };
}

/** The colour of the direct sun by altitude (degrees): deep amber at the horizon, warm gold through golden hour, near white above 30 degrees. */
export function sunTint(alt) {
  return alt <= 3 ? 0xff9a4d : alt <= 10 ? mixHex([[0xff9a4d, 1 - (alt - 3) / 7], [0xffc088, (alt - 3) / 7]]) : alt <= 30 ? mixHex([[0xffc088, 1 - (alt - 10) / 20], [0xfff1d6, (alt - 10) / 20]]) : 0xfff1d6;
}
/** How strongly the lamps are on at a sun altitude: off in daylight, three quarters at dusk, full after twilight. */
export const lampsAt = (alt) => 0.75 * (1 - smooth(-2, 6, alt)) + 0.25 * (1 - smooth(-8, -2, alt));

/**
 * The light state of the room.
 * `o.mood` 'auto' with `o.alt` (the sun's altitude in degrees, negative below the horizon) gives the CONTINUOUS state: the day, evening and night states
 * blended by autoWeights, the sun fading in over the first 3 degrees and tinted by sunTint, the lamps by lampsAt. A fixed mood gives that mood exactly.
 * @param {{mood: 'day'|'evening'|'night', sunOn?: boolean, sinAlt?: number, quality?: 'fast'|'visual', scale?: {ambient?: number, sun?: number, sky?: number}, shaded?: boolean}} o
 *   sunOn: direct sun reaches the room (default true); scale: the Light tab's glazing, blinds and ambient controls (default 1)
 * @returns {{sunI:number, sunColor:number, hemiI:number, hemiSky:number, hemiGround:number, ambI:number, ambColor:number, glowI:number, glowColor:number, exposure:number, tone:'aces'|'reinhard', lamps:number}}
 *   `lamps` = 0 (off), 0.75 (evening) or 1 (night): the factor the lamps' own candela is multiplied by
 */
export function roomLightState(o) {
  if (o.mood === 'auto' && Number.isFinite(o.alt)) return blendedState(o);
  return stateFor(o);
}

function blendedState(o) {
  const alt = o.alt, w = autoWeights(alt), up = alt > 0, sin = Math.max(0, Math.sin((alt * Math.PI) / 180));
  const parts = [['day', w.day], ['evening', w.evening], ['night', w.night]].filter(([, x]) => x > 1e-4).map(([m, x]) => [stateFor({ ...o, mood: m, sunOn: o.sunOn !== false && up, sinAlt: sin }), x]);
  const k = (f) => parts.reduce((t, [st, x]) => t + st[f] * x, 0), c = (f) => mixHex(parts.map(([st, x]) => [st[f], x]));
  const ramp = smooth(0, 3, alt);
  return {
    sunI: k('sunI') * ramp, sunColor: sunTint(alt), hemiI: k('hemiI'), hemiSky: c('hemiSky'), hemiGround: c('hemiGround'), ambI: k('ambI'), ambColor: c('ambColor'),
    glowI: k('glowI'), glowColor: c('glowColor'), exposure: k('exposure'), tone: parts[0][0].tone, lamps: lampsAt(alt),
  };
}

function stateFor(o) {
  const mood = MOOD_LIST.includes(o.mood) ? o.mood : 'day', day = mood === 'day', eve = mood === 'evening', night = mood === 'night';
  const sc = { ambient: 1, sun: 1, sky: 1, ...(o.scale || {}) }, visual = o.quality === 'visual', sin = Math.max(0, o.sinAlt ?? 0.8);
  const sunOn = o.sunOn !== false && !night;
  // Visual adds an environment light, so the hemisphere steps back a little (as the studio always did)
  const k = visual ? 0.62 : 1;
  const exposureByMood = day ? 1.2 : eve ? 1.34 : 1.42, fastLift = visual ? 1 : 1.5;   // Reinhard has a lower mid-grey than ACES: lift it so a room is as bright
  return {
    sunI: sunOn ? (4.2 + 5 * sin) * sc.sun * (eve ? 0.7 : 1) : 0,
    sunColor: eve ? 0xffc080 : 0xffe6bd,   // warm: the patches on the floor are golden, not white
    hemiI: (day ? 1.9 : eve ? 1.05 : 0.6) * sc.ambient * k,
    hemiSky: night ? 0x8090b0 : 0xf2f4f8,
    hemiGround: night ? 0x2a2e36 : eve ? 0x6e6458 : 0xb3a796,
    // the warm fill of an evening or night room (the bounce of its lamps and of the city): a room with no lamp placed is never black
    ambI: (day ? 0.55 : eve ? 0.46 : 0.4) * sc.ambient,
    ambColor: day ? 0xfff3e6 : eve ? 0xffe0b8 : 0xffcc94,
    glowI: (day ? 3.2 : eve ? 1.2 : 0.35) * Math.max(0, Math.min(1, sc.sky)) * (o.shaded ? 0.55 : 1),
    glowColor: eve ? 0xb9c4e0 : 0xdfe9f5,
    exposure: exposureByMood * fastLift,
    tone: visual ? TONE.visual : TONE.fast,
    lamps: day ? 0 : night ? 1 : 0.75,
  };
}
