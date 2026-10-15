// Facade detail for the city's building materials, shared by Unit 3D and the Floor plan studio (the same material on the same buildings).
// The look is drawn in the shader from per-vertex attributes written by city3d/geometry.js (no textures, no mesh per window): see
// city3d/facade-rules.js for the style rules and the GLSL, and the methodology guide ("How the 3D views draw buildings"). A VISUAL PREVIEW:
// nothing here enters a sun hour, a skyline or a score.
import * as THREE from 'three';
import { STYLE_PARAMS, TINTS, GLASS, VERT_PARS, VERT_MAIN, FRAG_PARS, FRAG_COLOR, FRAG_ROUGH, FRAG_EMISSIVE } from './facade-rules.js';

/** The facade uniforms beyond uNight / uFloorH / uDetail / uLitCol: uLate (0 early evening .. 1 deep night: fewer windows lit), uQual (0 Fast | 1 Visual), uTintMix (0 under the Heights layer), uSkyCol, the style tables. */
export function facadeExtras() {
  return {
    uLate: { value: 0 }, uQual: { value: 0 }, uTintMix: { value: 1 }, uSkyCol: { value: new THREE.Color(0.6, 0.72, 0.9) },
    uSty: { value: STYLE_PARAMS.map((s) => new THREE.Vector4(...s.win)) }, uSty2: { value: STYLE_PARAMS.map((s) => new THREE.Vector4(...s.opt)) },
    uTint: { value: TINTS.map((c) => new THREE.Vector3(...c)) }, uGlass: { value: GLASS.map((c) => new THREE.Vector3(...c)) },
  };
}

/**
 * Give a standard material the facade shader. `U` holds the shared uniforms (uNight 0..1, uFloorH, uDetail, uLitCol; the extras above are added
 * to it when missing, so every material sharing `U` shares them). Window grid per storey, a style by class and year (masonry, punched, ribbon, curtain
 * wall, glass), spandrels, mullions, sills, glass reflection, wall grain, a darker foot of every wall, and lit windows after dusk; windows fade to
 * their average as they shrink under a few pixels. `key` 'unit-target' (this building: accent-coloured) keeps most of its own colour.
 */
export function decorate(mat, U, key) {
  for (const [k, v] of Object.entries(facadeExtras())) if (!(k in U)) U[k] = v;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    if (key === 'unit-target') sh.uniforms.uTintMix = { value: 0.3 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`);
  };
  mat.customProgramCacheKey = () => key;
}
