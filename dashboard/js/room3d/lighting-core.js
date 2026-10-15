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

/**
 * The light state of the room.
 * @param {{mood: 'day'|'evening'|'night', sunOn?: boolean, sinAlt?: number, quality?: 'fast'|'visual', envLight?: boolean, tone?: 'aces'|'reinhard', scale?: {ambient?: number, sun?: number, sky?: number}, shaded?: boolean}} o
 *   sunOn: direct sun reaches the room (default true); scale: the Light tab's glazing, blinds and ambient controls (default 1);
 *   envLight: an environment light is on (default: Visual); tone: the tone-mapping curve (default: by quality, TONE). The automatic step-down turns the
 *   environment light off under Visual but keeps the tone, so a lighter level never changes the brightness of the room.
 * @returns {{sunI:number, sunColor:number, hemiI:number, hemiSky:number, hemiGround:number, ambI:number, ambColor:number, glowI:number, glowColor:number, exposure:number, tone:'aces'|'reinhard', lamps:number}}
 *   `lamps` = 0 (off), 0.75 (evening) or 1 (night): the factor the lamps' own candela is multiplied by
 */
export function roomLightState(o) {
  const mood = MOOD_LIST.includes(o.mood) ? o.mood : 'day', day = mood === 'day', eve = mood === 'evening', night = mood === 'night';
  const sc = { ambient: 1, sun: 1, sky: 1, ...(o.scale || {}) }, visual = o.quality === 'visual', sin = Math.max(0, o.sinAlt ?? 0.8);
  const tone = o.tone === 'aces' || o.tone === 'reinhard' ? o.tone : visual ? TONE.visual : TONE.fast, env = o.envLight ?? visual;
  const sunOn = o.sunOn !== false && !night;
  // an environment light (Visual) is also light, so the hemisphere steps back a little (as the studio always did); a lighter level that drops the
  // environment keeps the hemisphere where it was, so the room does not go dark when the level drops
  const k = visual ? (env ? 0.62 : 0.8) : 1;
  const exposureByMood = day ? 1.15 : eve ? 1.25 : 1.35, fastLift = tone === 'aces' ? 1 : 1.18;   // Reinhard has a lower mid-grey than ACES: lift it so a room is as bright
  return {
    sunI: sunOn ? (3.6 + 4 * sin) * sc.sun * (eve ? 0.6 : 1) : 0,
    sunColor: eve ? 0xffc890 : 0xfff1d6,
    hemiI: (day ? 1.6 : eve ? 0.64 : 0.5) * sc.ambient * k,
    hemiSky: night ? 0x8090b0 : 0xf2f4f8,
    hemiGround: night ? 0x2a2e36 : eve ? 0x6e6458 : 0xb3a796,
    // the warm fill of an evening or night room (the bounce of its lamps and of the city): a room with no lamp placed is never black
    ambI: (day ? 0.4 : eve ? 0.22 : 0.32) * sc.ambient,
    ambColor: day ? 0xfff3e6 : eve ? 0xffe2c0 : 0xffd6a8,
    glowI: (day ? 2.4 : eve ? 0.7 : 0) * Math.max(0, Math.min(1, sc.sky)) * (o.shaded ? 0.55 : 1),
    glowColor: eve ? 0xb9c4e0 : 0xdfe9f5,
    exposure: exposureByMood * fastLift,
    tone,
    lamps: day ? 0 : night ? 1 : 0.75,
  };
}
