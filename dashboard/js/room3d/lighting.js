// The light of the room, one definition for both 3D engines: a hemisphere sky light and a bounce/ambient fill so a room is never murky, the sun as a
// directional light with soft shadows (in Visual), the soft glow each window lets in, warm lamps after dark, and the exposure and tone mapping
// that go with each mood. roomLightState() is pure (no three.js, testable in node); applyRoomLight() writes it to a rig of three.js lights.
// Numbers are the Floor plan studio's light look (exposure 1.15 by day), which is the baseline in Unit 3D's Inside and Window cameras too.
// A VISUAL PREVIEW: brightness here is a display gain, never lux; the daylight numbers live in plan/lighting-model.js and unit/daylight-annual.js.
import * as THREE from 'three';
import { MOOD_LIST, moodFor, TONE, roomLightState } from './lighting-core.js';

export { MOOD_LIST, moodFor, TONE, roomLightState };

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
