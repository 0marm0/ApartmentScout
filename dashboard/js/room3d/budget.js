// What a frame costs, read from a renderer and its scene without importing three.js (duck-typed, so node can test it): draw calls and triangles of the
// last render() call (three.js counts the shadow pass in it), geometries and textures alive, and an ESTIMATE of texture memory: every distinct
// texture the scene's materials point at (with mipmaps), the environment light, the shadow maps, and the drawing buffer. Bytes are estimated
// from sizes (4 bytes a texel, 8 for the soft-shadow maps), not read from the GPU, which does not say. scripts/perf_check.py logs it per quality level.

const MIP = 4 / 3;
const isTex = (v) => !!v && v.isTexture === true;
const texBytes = (t) => {
  const im = t.image, w = im?.width || im?.videoWidth || 0, h = im?.height || im?.videoHeight || 0;
  return w * h * 4 * (t.generateMipmaps === false || t.isDepthTexture ? 1 : MIP);
};

/** Distinct textures reachable from a scene's materials (maps, ShaderMaterial uniforms), its environment and background. */
export function sceneTextures(scene) {
  const seen = new Set();
  const take = (t) => { if (isTex(t)) seen.add(t); };
  take(scene.environment); take(scene.background);
  scene.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      for (const k in m) take(m[k]);
      if (m.uniforms) for (const k in m.uniforms) take(m.uniforms[k]?.value);
    }
  });
  return [...seen];
}

/** Estimated bytes of the shadow maps of every light in the scene that has one built. */
export function shadowBytes(scene) {
  let n = 0;
  scene.traverse((o) => {
    const sh = o.shadow, map = sh?.map;
    if (!map) return;
    const w = map.width || sh.mapSize?.x || 0, h = map.height || sh.mapSize?.y || 0;
    n += w * h * (sh.mapPass ? 8 + 8 + 4 : 4 + 4);   // a soft (VSM) map: two half-float targets and a depth buffer; a plain one: depth and a colour target
  });
  return n;
}

/**
 * @param {{info, getPixelRatio?, domElement?}} renderer  a three.js WebGLRenderer (or anything with .info)
 * @param {{traverse}} scene
 * @returns {{draws, triangles, lines, points, geometries, textures, textureMB, shadowMB, bufferMB, memoryMB, pixelRatio, canvas:[number,number]}}
 */
export function renderBudget(renderer, scene) {
  const info = renderer.info || {}, r = info.render || {}, m = info.memory || {};
  const mb = (b) => Math.round((b / 1048576) * 100) / 100;
  const tex = sceneTextures(scene).reduce((a, t) => a + texBytes(t), 0), shadow = shadowBytes(scene);
  const cv = renderer.domElement, w = cv?.width || 0, h = cv?.height || 0;
  const buffer = w * h * 4 * 2 * 2;   // colour + depth, double the multisample of antialias: an upper-end estimate
  return {
    draws: r.calls || 0, triangles: r.triangles || 0, lines: r.lines || 0, points: r.points || 0,
    geometries: m.geometries || 0, textures: m.textures || 0,
    textureMB: mb(tex), shadowMB: mb(shadow), bufferMB: mb(buffer), memoryMB: mb(tex + shadow + buffer),
    pixelRatio: renderer.getPixelRatio ? renderer.getPixelRatio() : 1, canvas: [w, h],
  };
}
