// The sky of the city, shared by Unit 3D and the Floor plan studio's eye-level views: a gradient dome that follows the camera, the sun's disc and
// glow where the sun really is, and the haze (fog) that fades the far city into the horizon. Colours come from city3d/look.js by sun altitude,
// so the same hour is the same sky in both engines. A VISUAL PREVIEW.
import * as THREE from 'three';
import { SKY_VS, SKY_FS, skyAt, glowTexture } from './look.js';

const mix = (a, b, t) => a.clone().lerp(b, t);
export const FOG = { near: 1100, far: 4200 };                 // the haze from a window or inside (orbit uses 900 / 3600 and none from above)
export const SKY_RADIUS = 6000;

/** The dome, the sun disc and the glow sprite, not yet in a scene (add sky.objects). */
export function createSky(pal) {
  const U = { zen: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, gnd: { value: pal.ground.clone() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: pal.sun.clone() }, glow: { value: 1 }, stars: { value: 0 } };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 24), new THREE.ShaderMaterial({ uniforms: U, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false }));
  dome.renderOrder = -10; dome.frustumCulled = false; dome.name = 'sky';
  const disc = new THREE.Mesh(new THREE.SphereGeometry(30, 24, 16), new THREE.MeshBasicMaterial({ color: pal.sun, fog: false, toneMapped: false })); disc.name = 'sun disc';
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: pal.sun, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false })); glow.name = 'sun glow';
  glow.scale.set(420, 420, 1);
  return { U, dome, disc, glow, objects: [dome, disc, glow] };
}

/**
 * Colour the sky for the sun at {alt, az} (degrees) and put the disc and glow where the sun is, seen from `centre` (a Vector3).
 * `dir` is the unit vector toward the sun in three.js axes. Returns {zen, hor, dir} (the haze colour is `hor`).
 */
export function applySky(sky, pal, s, dir, centre) {
  const k = Math.max(0, Math.min(1, s.alt / 30));
  const zen = skyAt(pal.sky.zen, s.alt, pal.sky.alt), hor = skyAt(pal.sky.hor, s.alt, pal.sky.alt);
  sky.U.stars.value = pal.daylight ? Math.max(0, Math.min(1, (-s.alt - 5) / 5)) : 0;   // stars only on the eye-level (natural) sky, once it is dark
  sky.U.zen.value.copy(zen); sky.U.hor.value.copy(hor); sky.U.sunDir.value.copy(dir);
  sky.U.glow.value = s.alt > -4 ? Math.min(1, (s.alt + 4) / 8) : 0;
  sky.U.sunCol.value.copy(mix(pal.sun, pal.white, 0.2 * k));
  const sp = centre.clone().addScaledVector(dir, 5000);
  sky.disc.position.copy(sp); sky.glow.position.copy(sp);
  sky.disc.visible = sky.glow.visible = s.alt > -1.5;
  sky.disc.material.color.copy(mix(pal.sun, pal.white, 0.25 + 0.5 * k));
  return { zen, hor, dir };
}

/** The unit vector toward the sun (three.js axes: x east, y up, -z north) for an azimuth (clockwise from north) and altitude in degrees. */
export function sunVector(az, alt) {
  const D = Math.PI / 180;
  return new THREE.Vector3(Math.sin(az * D) * Math.cos(alt * D), Math.sin(alt * D), -Math.cos(az * D) * Math.cos(alt * D));
}

/** Keep the dome on the camera so the sky never moves as the camera does. */
export const followSky = (sky, camPos) => sky.dome.position.copy(camPos);
