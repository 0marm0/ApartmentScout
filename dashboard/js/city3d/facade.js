// Facade detail for the city's building materials, shared by Unit 3D and the Floor plan studio (the same material on the same buildings).
import * as THREE from 'three';
void THREE;

/**
 * Facade detail for the building materials, all in the shader (no textures, no extra geometry): a hint of a
 * window grid on walls (one row per floor height, a bay every 3 m) that fades to its average as cells get smaller
 * than a few pixels, a darker band at the foot of every wall (cheap ambient occlusion where walls meet the street),
 * and after dusk a scatter of lit windows. `U` holds the shared uniforms: uNight 0..1, uFloorH, uDetail, uLitCol.
 */
export function decorate(mat, U, key) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uToSite: { value: new THREE.Matrix4() } }, U);   // uToSite: world -> site frame (identity in Unit 3D; the studio's plan frame is rotated and lifted by the slab)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWP; varying vec3 vWN; uniform float uNight; uniform float uFloorH; uniform float uDetail; uniform vec3 uLitCol; uniform mat4 uToSite;
float uHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 sWP = (uToSite * vec4(vWP, 1.0)).xyz; vec3 sWN = normalize(mat3(uToSite) * vWN);   // the facade pattern is laid out in the site frame, so a building looks the same in both engines
float uWall = 1.0 - smoothstep(0.35, 0.6, abs(sWN.y));
vec2 uT = normalize(vec2(-sWN.z, sWN.x) + 1e-5);
float uV = sWP.y;
vec2 uCell = vec2(dot(sWP.xz, uT) / 3.0, uV / uFloorH);
vec2 uF = fract(uCell), uW = fwidth(uCell);
float uFar = smoothstep(0.3, 0.75, max(uW.x, uW.y));
float uWin = smoothstep(0.2 - uW.x, 0.2 + uW.x, uF.x) * (1.0 - smoothstep(0.8 - uW.x, 0.8 + uW.x, uF.x))
  * smoothstep(0.3 - uW.y, 0.3 + uW.y, uF.y) * (1.0 - smoothstep(0.86 - uW.y, 0.86 + uW.y, uF.y));
uWin = mix(uWin, 0.36, uFar) * step(4.0, uV) * uWall;
float uAo = mix(1.0, mix(0.58, 1.0, smoothstep(0.0, 24.0, uV)), uWall);
diffuseColor.rgb *= uAo * (1.0 - 0.3 * uWin * uDetail);
float uSeed = uHash(floor(uCell) + vec2(floor(dot(sWP.xz, normalize(sWN.xz + 1e-5)) * 0.37), 7.0));
float uLit = mix(step(0.66, uSeed) * uWin, 0.045 * step(4.0, uV) * uWall, uFar) * uDetail;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uLitCol * uLit * uNight;');
  };
  mat.customProgramCacheKey = () => key;
}
