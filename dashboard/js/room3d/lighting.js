// The light of the room, one definition for both 3D engines: a hemisphere sky light and a bounce/ambient fill so a room is never murky, the sun as a
// directional light with soft shadows (in Visual), the soft glow each window lets in, warm lamps after dark, and the exposure and tone mapping
// that go with each mood. roomLightState() is pure (no three.js, testable in node); applyRoomLight() writes it to a rig of three.js lights.
// Numbers are the Floor plan studio's light look (exposure 1.15 by day), which is the baseline in Unit 3D's Inside and Window cameras too.
// A VISUAL PREVIEW: brightness here is a display gain, never lux; the daylight numbers live in plan/lighting-model.js and unit/daylight-annual.js.
import * as THREE from 'three';

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
  const exposureByMood = day ? 1.15 : eve ? 1.25 : 1.35, fastLift = visual ? 1 : 1.18;   // Reinhard has a lower mid-grey than ACES: lift it so a room is as bright
  return {
    sunI: sunOn ? (3.6 + 4 * sin) * sc.sun * (eve ? 0.6 : 1) : 0,
    sunColor: eve ? 0xffc890 : 0xfff1d6,
    hemiI: (day ? 1.6 : eve ? 0.64 : 0.36) * sc.ambient * k,
    hemiSky: night ? 0x8090b0 : 0xf2f4f8,
    hemiGround: night ? 0x2a2e36 : eve ? 0x6e6458 : 0xb3a796,
    ambI: (day ? 0.4 : eve ? 0.18 : 0.1) * sc.ambient,
    ambColor: 0xfff3e6,
    glowI: (day ? 2.4 : eve ? 0.7 : 0) * Math.max(0, Math.min(1, sc.sky)) * (o.shaded ? 0.55 : 1),
    glowColor: eve ? 0xb9c4e0 : 0xdfe9f5,
    exposure: exposureByMood * fastLift,
    tone: visual ? TONE.visual : TONE.fast,
    lamps: day ? 0 : night ? 1 : 0.75,
  };
}

const TONE_MAP = { aces: THREE.ACESFilmicToneMapping, reinhard: THREE.ReinhardToneMapping };

/**
 * Write a light state to a rig `{sunL, hemi, amb, glow?: Group of RectAreaLights, renderer?}`. Per-window shading comes from `shaded(i)`.
 */
export function applyRoomLight(rig, st, shaded = () => false) {
  const { sunL, hemi, amb, glow, renderer } = rig;
  if (sunL) { sunL.intensity = st.sunI; sunL.color.set(st.sunColor); }
  if (hemi) { hemi.intensity = st.hemiI; hemi.color.set(st.hemiSky); hemi.groundColor.set(st.hemiGround); }
  if (amb) { amb.intensity = st.ambI; amb.color.set(st.ambColor); }
  for (const L of glow?.children || []) { L.intensity = st.glowI * (shaded(L.userData.win) ? 0.55 : 1); L.color.set(st.glowColor); }
  if (renderer) {
    const tm = TONE_MAP[st.tone] ?? THREE.ACESFilmicToneMapping;
    if (renderer.toneMapping !== tm) { renderer.toneMapping = tm; rig.onToneMapping?.(); }
    renderer.toneMappingExposure = st.exposure;
  }
}

/**
 * One soft area light per window facing into its room: the sky glow daylight brings in. In the frame of the plan, metres, relative to `origin`
 * (plan inches at the local origin), z = -plan y. `inRoom(point)` says whether a plan point is inside a room (to face the light inward).
 * RectAreaLightUniformsLib.init() must have been called once by the engine.
 */
export function windowGlowLights(model, inRoom, origin = [0, 0]) {
  const M = 0.0254, out = [], W = (x, y, h) => new THREE.Vector3((x - origin[0]) * M, h * M, -(y - origin[1]) * M);
  model.windows.forEach((w, i) => {
    const u = [(w.b[0] - w.a[0]) / w.len, (w.b[1] - w.a[1]) / w.len], n0 = [-u[1], u[0]];
    const inside = inRoom([w.mid[0] + n0[0] * 18, w.mid[1] + n0[1] * 18]), n = inside ? n0 : [-n0[0], -n0[1]];
    const hgt = Math.max(6, w.head - w.sill);
    const L = new THREE.RectAreaLight(0xdfe9f5, 0, w.len * M, hgt * M);
    L.position.copy(W(w.mid[0] + n[0] * 3, w.mid[1] + n[1] * 3, w.sill + hgt / 2));
    L.lookAt(W(w.mid[0] + n[0] * 60, w.mid[1] + n[1] * 60, w.sill + hgt / 2 - 10));
    L.userData.win = i; out.push(L);
  });
  return out;
}
