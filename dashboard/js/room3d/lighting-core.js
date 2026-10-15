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
 * @param {{mood: 'day'|'evening'|'night', sunOn?: boolean, sinAlt?: number, quality?: 'fast'|'visual', scale?: {ambient?: number, sun?: number, sky?: number}, shaded?: boolean}} o
 *   sunOn: direct sun reaches the room (default true); scale: the Light tab's glazing, blinds and ambient controls (default 1)
 * @returns {{sunI:number, sunColor:number, hemiI:number, hemiSky:number, hemiGround:number, ambI:number, ambColor:number, glowI:number, glowColor:number, exposure:number, tone:'aces'|'reinhard', lamps:number}}
 *   `lamps` = 0 (off), 0.75 (evening) or 1 (night): the factor the lamps' own candela is multiplied by
 */
export function roomLightState(o) {
  const mood = MOOD_LIST.includes(o.mood) ? o.mood : 'day', day = mood === 'day', eve = mood === 'evening', night = mood === 'night';
  const sc = { ambient: 1, sun: 1, sky: 1, ...(o.scale || {}) }, visual = o.quality === 'visual', sin = Math.max(0, o.sinAlt ?? 0.8);
  const sunOn = o.sunOn !== false && !night;
  // Visual adds an environment light, so the hemisphere steps back a little (as the studio always did)
  const k = visual ? 0.62 : 1;
  const exposureByMood = day ? 1.2 : eve ? 1.38 : 1.5, fastLift = visual ? 1 : 1.5;   // Reinhard has a lower mid-grey than ACES: lift it so a room is as bright
  return {
    sunI: sunOn ? (4.2 + 5 * sin) * sc.sun * (eve ? 0.7 : 1) : 0,
    sunColor: eve ? 0xffc080 : 0xffe6bd,   // warm: the patches on the floor are golden, not white
    hemiI: (day ? 1.9 : eve ? 1.2 : 0.95) * sc.ambient * k,
    hemiSky: night ? 0x8090b0 : 0xf2f4f8,
    hemiGround: night ? 0x2a2e36 : eve ? 0x6e6458 : 0xb3a796,
    // the warm fill of an evening or night room (the bounce of its lamps and of the city): a room with no lamp placed is never black
    ambI: (day ? 0.55 : eve ? 0.5 : 0.55) * sc.ambient,
    ambColor: day ? 0xfff3e6 : eve ? 0xffe2c0 : 0xffd6a8,
    glowI: (day ? 3.2 : eve ? 1.2 : 0.35) * Math.max(0, Math.min(1, sc.sky)) * (o.shaded ? 0.55 : 1),
    glowColor: eve ? 0xb9c4e0 : 0xdfe9f5,
    exposure: exposureByMood * fastLift,
    tone: visual ? TONE.visual : TONE.fast,
    lamps: day ? 0 : night ? 1 : 0.75,
  };
}
