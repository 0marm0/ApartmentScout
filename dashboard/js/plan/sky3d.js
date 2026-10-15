// The sky behind the city in the Floor plan studio's eye-level views. Since the shared city, this is a thin adapter over city3d/sky.js: the
// same dome, sun glow, colours by sun altitude and haze as Unit 3D's Window and Inside cameras, so one hour is one sky in both. The studio's
// lighting moods map to a sky altitude (Day keeps the real sun when it is up, Evening a low golden sun, Night a dark sky). A VISUAL PREVIEW.
import * as THREE from 'three';
import { createSky, applySky, followSky, sunVector, FOG } from '../city3d/sky.js';
import { palette } from '../city3d/look.js';

const D2R = 180 / Math.PI;
let sky = null, lastKey = '';

const ensure = () => (sky || (sky = createSky(palette({ daylight: true }))));

/** The sky objects to add to the scene (built on first use). */
export function objects() { ensure(); return sky.objects; }

/** The altitude (degrees) the sky is painted for under a lighting mood, given the real sun altitude. */
export function moodAltitude(mood, alt) {
  if (mood === 'auto') return Math.max(-12, Math.min(90, alt));   // [daycycle] the real sun: the sky goes through dawn, golden hour and dusk without a jump
  if (mood === 'night') return -12;
  if (mood === 'evening') return Math.max(-1, Math.min(alt, 4));
  return Math.max(alt, 25);   // 'day': the real sun when it is high, else a clear day
}

/**
 * Colour the sky for a mood and put the sun glow at `sunDir` (a vector toward the sun in the studio's world space, any length).
 * Returns the haze to give the scene: `{color, near, far}`.
 */
export function setMood(mood, sunDir, sunUp = true) {
  ensure();
  const pal = palette({ daylight: true }), d = sunDir ? sunDir.clone().normalize() : new THREE.Vector3(0, 1, 0), real = Math.asin(Math.max(-1, Math.min(1, d.y))) * D2R;
  const alt = moodAltitude(mood, sunUp ? real : Math.min(real, -1));
  const az = ((Math.atan2(d.x, -d.z) * D2R) + 360) % 360;
  sky.U.gnd.value.copy(pal.ground);
  const { hor } = applySky(sky, pal, { alt, az }, sunVector(az, Math.max(real, -5)), new THREE.Vector3());
  sky.glow.userData.dir = d; sky.disc.userData.dir = d;
  const lit = sunUp && mood !== 'night' && real > -1.5;   // ('auto' lights the disc and the glow by the real sun)
  sky.disc.userData.lit = lit; sky.disc.visible = sky.glow.visible = lit && sky.dome.visible;
  lastKey = mood;
  return { color: hor.clone(), near: FOG.near, far: FOG.far };
}

/** Keep the dome and the sun on the camera, so the sky never moves as you walk. */
export function follow(pos) {
  if (!sky) return;
  followSky(sky, pos);
  const d = sky.glow.userData.dir;
  if (d) { sky.glow.position.copy(pos).addScaledVector(d, 5000); sky.disc.position.copy(sky.glow.position); }
}
export function show(on) { if (sky) { sky.dome.visible = on; sky.disc.visible = sky.glow.visible = on && !!sky.disc.userData.lit; } }
export const currentMood = () => lastKey;
