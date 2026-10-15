// Writes the shared quality settings (room3d/quality.js) to a three.js renderer, the sun's shadow map and the scene's environment light: the part of the
// renderer setup that Unit 3D and the Floor plan studio do the same way. Only what changed is touched, so a step down by one level does not
// recompile every material or rebuild a shadow map for nothing. The engines add their own parts (tone mapping, contact shadows, the city) around it.
import * as THREE from 'three';
import { environmentFor, recompileMaterials } from '../features/render-env.js';

/**
 * @param {{renderer, scene, sun: THREE.DirectionalLight}} rig
 * @param {object} s  quality.settings
 * @param {{soft: object, hard: object, envIntensity: number}} look  per-engine shadow parameters: `soft` / `hard` = {radius, bias, normalBias?, blurSamples?}
 * @param {object} memo  the engine's own object; this function keeps what it last applied in it
 * @returns {{shadowRebuilt: boolean, recompiled: boolean, envChanged: boolean, pixelRatioChanged: boolean}}
 */
export function applyRenderer(rig, s, look, memo) {
  const { renderer, scene, sun } = rig, out = { shadowRebuilt: false, recompiled: false, envChanged: false, pixelRatioChanged: false };
  if (!renderer || !scene || !sun) return out;
  if (renderer.getPixelRatio() !== s.pixelRatio) { renderer.setPixelRatio(s.pixelRatio); out.pixelRatioChanged = true; }
  const type = s.softShadows ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap, p = s.softShadows ? look.soft : look.hard;
  if (memo.size !== s.shadowSize || memo.type !== type) {
    sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapSize.set(s.shadowSize, s.shadowSize);
    const was = memo.type ?? renderer.shadowMap.type;
    renderer.shadowMap.type = type; out.shadowRebuilt = true;
    if (was !== type) { recompileMaterials(scene); out.recompiled = true; }
    memo.size = s.shadowSize; memo.type = type;
    // (the bias belongs to the shadow type; written only when it changes, so the Inside camera's own bias is not overwritten by a level change at the same type)
    sun.shadow.radius = p.radius; if (p.blurSamples != null) sun.shadow.blurSamples = p.blurSamples;
    sun.shadow.bias = p.bias; if (p.normalBias != null) sun.shadow.normalBias = p.normalBias;
  }
  if (memo.env !== s.environment) { scene.environment = s.environment ? environmentFor(renderer, { intensity: look.envIntensity }) : null; memo.env = s.environment; out.envChanged = true; }
  return out;
}

/** The scene is new (rebuilt): forget what was applied, so the next applyRenderer writes everything. */
export const forgetRenderer = (memo) => { memo.size = memo.type = memo.env = undefined; };
