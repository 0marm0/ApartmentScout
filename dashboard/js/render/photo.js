// The photo renderer: a progressive, near-photographic still of the current 3D view, drawn in a few seconds on a laptop. Loaded on demand
// (the render sheet imports it when "Render a photo" or "Make a video" is pressed), with the three.js post-processing addons it uses.
//
// HOW THE PICTURE IS MADE. The view is drawn again and again, each time a little different, and the frames are averaged:
//   * the camera moves by a sub-pixel amount (Halton sequence): smooth edges without MSAA;
//   * the sun moves across its disc: the shadows get a soft penumbra that grows with distance, like a real sun;
//   * a second light moves over the sky dome and casts shadows too: the sky's light is blocked by the walls and the neighbouring buildings, so rooms
//     are brightest at the windows and corners and the street canyon is darker at the bottom (the hemisphere light gives none of that);
//   * each frame gets three's GTAO ambient occlusion (the vendored addon), a bloom on whatever is brighter than the display can show (the sun, the
//     sky through glass, lit windows after dark), an optional depth of field, then three's own filmic tone mapping and sRGB output;
//   * a small colour grade and vignette, accumulated in a half-float target so 60 frames do not lose precision, dithered when it goes to 8 bits.
// The time is a budget (5, 12 or 20 seconds), not a frame count: a fast GPU gets more frames in it, a phone fewer, at a size it can afford.
//
// A LOOK, NOT EVIDENCE. Nothing here changes a sun hour, a window's exposure or a number; the light is the view's own, drawn more softly. It is a
// raster approximation: the shadows are shadow maps, the ambient occlusion is screen space, the window light is the view's window glow lights plus
// bloom. It does not trace light bounces, so a sunlit floor does not light the ceiling, and glass shows no reflections.
import * as THREE from 'three';
import { halton, sunDisc } from '../features/render-quality.js';

const NEEDED = ['EffectComposer', 'GTAOPass', 'UnrealBloomPass', 'OutputPass', 'BokehPass', 'Pass'];
let addonsP = null;
/** The vendored post-processing addons, fetched once (this is what keeps them out of the page until a render is asked for). */
export function loadAddons() {
  return (addonsP ||= Promise.all([
    import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/GTAOPass.js'), import('three/addons/postprocessing/UnrealBloomPass.js'),
    import('three/addons/postprocessing/OutputPass.js'), import('three/addons/postprocessing/BokehPass.js'), import('three/addons/postprocessing/Pass.js'),
  ]).then((m) => Object.fromEntries(NEEDED.map((k, i) => [k, m[i][k]]))).catch((e) => { addonsP = null; throw e; }));
}

const GRADE_FS = `
uniform sampler2D tFrame, tAcc; uniform float uW, uSat, uContrast, uVig, uAspect; uniform bool uFirst; varying vec2 vUv;
vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uContrast + 0.5;
  vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
  c *= 1.0 - uVig * smoothstep(0.30, 0.95, length(d));
  return c;
}
void main() {
  vec3 cur = grade(texture2D(tFrame, vUv).rgb);
  vec3 prev = uFirst ? cur : texture2D(tAcc, vUv).rgb;
  gl_FragColor = vec4(mix(prev, cur, uW), 1.0);
}`;
const FINAL_FS = `
uniform sampler2D tAcc; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tAcc, vUv).rgb;
  float h = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  gl_FragColor = vec4(clamp(c + (h - 0.5) / 255.0, 0.0, 1.0), 1.0);
}`;
const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

/** Defaults for the look; a host may override any of them (`host.look`). */
export const LOOK = { grade: { sat: 1.07, contrast: 1.06, vig: 0.12 }, bloom: { strength: 0.2, radius: 0.5, threshold: 1.0 }, exposure: 0.82, sunRadius: 0.012, skyShare: 0.55, sunBoost: 7 };

/**
 * Build the render pipeline for a host at W x H pixels.
 * @param {object} host see render/hosts.js
 * @param {{ao: boolean, bloom: boolean, dof: boolean, skyShadows: boolean}} o
 */
export async function createPipeline(host, W, H, o = {}) {
  const A = await loadAddons(), r = host.renderer, scene = host.scene, cam = host.camera();
  const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const look = { ...LOOK, ...(host.look || {}), grade: { ...LOOK.grade, ...(host.look?.grade || {}) }, bloom: { ...LOOK.bloom, ...(host.look?.bloom || {}) } };
  const composer = new A.EffectComposer(r, new THREE.WebGLRenderTarget(W, H, opts));
  composer.renderToScreen = false;
  const hostPass = new A.Pass(); hostPass.needsSwap = false;
  hostPass.render = (renderer, writeBuffer, readBuffer) => { renderer.setRenderTarget(readBuffer); host.draw(); };
  composer.addPass(hostPass);
  let gtao = null, bloom = null, bokeh = null;
  if (o.ao && cam.isPerspectiveCamera) {
    gtao = new A.GTAOPass(scene, cam, W, H);
    gtao.output = A.GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = host.look?.aoStrength ?? 0.9;
    gtao.updateGtaoMaterial({ radius: host.aoRadius?.() ?? 0.8, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 16 });
    const skip = host.skip?.() || [], over = gtao.overrideVisibility.bind(gtao);   // the sky dome, the sun and its glow are not surfaces to occlude
    gtao.overrideVisibility = () => { over(); for (const ob of skip) { gtao._visibilityCache.set(ob, ob.visible); ob.visible = false; } };
    composer.addPass(gtao);
  }
  if (o.dof && cam.isPerspectiveCamera) {
    bokeh = new A.BokehPass(scene, cam, { focus: host.focus?.() || 4, aperture: 0.00006, maxblur: 0.012 });
    composer.addPass(bokeh);
  }
  if (o.bloom) { bloom = new A.UnrealBloomPass(new THREE.Vector2(W, H), look.bloom.strength, look.bloom.radius, look.bloom.threshold); composer.addPass(bloom); }
  composer.addPass(new A.OutputPass());

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const gradeMat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: GRADE_FS, depthTest: false, depthWrite: false, uniforms: { tFrame: { value: null }, tAcc: { value: null }, uW: { value: 1 }, uSat: { value: look.grade.sat }, uContrast: { value: look.grade.contrast }, uVig: { value: look.grade.vig }, uAspect: { value: W / H }, uFirst: { value: true } } });
  const finalMat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FINAL_FS, depthTest: false, depthWrite: false, uniforms: { tAcc: { value: null } } });
  const mk = () => new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  let acc = [mk(), mk()], cur = 0, n = 0, out8 = null;
  const fs = (mat, target) => { quad.material = mat; r.setRenderTarget(target); r.render(quad, qcam); };

  const pipe = {
    W, H, composer, gtao, bloom, bokeh, get samples() { return n; },
    /** Draw one frame with the camera, sun and sky light as the caller left them, and fold it into the running average. */
    frame() {
      composer.render();
      const src = composer.readBuffer.texture;
      gradeMat.uniforms.tFrame.value = src; gradeMat.uniforms.tAcc.value = acc[cur].texture; gradeMat.uniforms.uW.value = 1 / (n + 1); gradeMat.uniforms.uFirst.value = n === 0;
      fs(gradeMat, acc[1 - cur]); cur = 1 - cur; n++;
      r.setRenderTarget(null);
    },
    restart() { n = 0; },
    /** The average so far drawn to the renderer's canvas (dithered), at the canvas size. For the video, which copies the canvas. */
    toCanvas() { finalMat.uniforms.tAcc.value = acc[cur].texture; fs(finalMat, null); },
    /** The average as ImageData (top row first), W x H. */
    pixels() {
      out8 ||= new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false });
      finalMat.uniforms.tAcc.value = acc[cur].texture; fs(finalMat, out8); r.setRenderTarget(null);
      const buf = new Uint8Array(W * H * 4); r.readRenderTargetPixels(out8, 0, 0, W, H, buf);
      const img = new ImageData(W, H), row = W * 4;
      for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * row, (H - y) * row), y * row);
      return img;
    },
    setFocus(d) { if (bokeh && d) bokeh.uniforms.focus.value = d; },
    dispose() {
      composer.dispose(); gtao?.dispose?.(); bloom?.dispose?.(); bokeh?.dispose?.();
      for (const t of acc) t.dispose(); out8?.dispose(); gradeMat.dispose(); finalMat.dispose(); quad.geometry.dispose();
    },
  };
  return pipe;
}

/**
 * Take the view's lights over for the render: the sun gets a disc to move over, the hemisphere light gives a share of its light to a shadow-casting sky light.
 * `capture()` reads the lights as the view has them NOW and applies the share (call it once for a photo; for a video whose light changes, `revert()`, change the
 * view's state, then `capture()` again). `jitter(i)` moves the sun over its disc and the sky light over the dome for sample i. `restore()` puts everything back.
 */
export function prepareLights(host, { skyShadows = true, share = LOOK.skyShare, sunRadius = LOOK.sunRadius } = {}) {
  const sun = host.sun, hemi = host.hemi, scene = host.scene;
  const up = new THREE.Vector3(0, 1, 0), base = { sunPos: new THREE.Vector3(), hemiI: 0, ground: new THREE.Color() };
  const rig = { target: new THREE.Vector3(), d0: new THREE.Vector3(), len: 1, side: new THREE.Vector3(), vert: new THREE.Vector3(), sunOn: false, sky: null };
  const saved = { radius: sun.shadow.radius, blur: sun.shadow.blurSamples };
  let applied = false;
  const mkSky = () => {
    const sky = new THREE.DirectionalLight(0xffffff, 0), s = sun.shadow, ms = Math.min(2048, s.mapSize.x);
    sky.castShadow = true; sky.target = sun.target;
    sky.shadow.mapSize.set(ms, ms); sky.shadow.camera.copy(s.camera); sky.shadow.camera.updateProjectionMatrix();
    sky.shadow.bias = s.bias; sky.shadow.normalBias = s.normalBias; sky.shadow.radius = 1; sky.shadow.blurSamples = 8;
    scene.add(sky); return sky;
  };
  if (hemi && skyShadows) rig.sky = mkSky();
  const L = {
    rig,
    capture() {
      base.sunPos.copy(sun.position); rig.target.copy(sun.target.position); rig.d0.copy(sun.position).sub(rig.target); rig.len = Math.max(1, rig.d0.length());
      rig.side.crossVectors(rig.d0, up).normalize(); rig.vert.crossVectors(rig.side, rig.d0).normalize(); rig.sunOn = sun.intensity > 0.001;
      if (hemi) {
        base.hemiI = hemi.intensity; base.ground.copy(hemi.groundColor);
        if (rig.sky) {
          rig.sky.shadow.camera.copy(sun.shadow.camera); rig.sky.shadow.camera.updateProjectionMatrix();   // (the Inside camera tightens the sun's box)
          rig.sky.color.copy(hemi.color); rig.sky.intensity = (hemi.intensity * share) / 0.57; rig.sky.visible = hemi.intensity > 0.001;
          hemi.intensity *= 1 - share; hemi.groundColor.multiplyScalar(1 / (1 - share));
        }
      }
      sun.shadow.radius = Math.min(saved.radius, 1.5); sun.shadow.blurSamples = 8; applied = true;
    },
    /** Put the view's own lights back (before it changes its state for the next frame). */
    revert() { if (!applied) return; sun.position.copy(base.sunPos); if (hemi) { hemi.intensity = base.hemiI; hemi.groundColor.copy(base.ground); } applied = false; },
    jitter(i) {
      if (rig.sunOn) {
        const [sx, sy] = sunDisc(i, sunRadius);
        sun.position.copy(rig.target).add(rig.d0.clone().addScaledVector(rig.side, sx * rig.len).addScaledVector(rig.vert, sy * rig.len).setLength(rig.len));
      }
      if (rig.sky) {
        const az = 2 * Math.PI * halton(i, 11), y = 0.14 + 0.86 * halton(i, 13), rr = Math.sqrt(1 - y * y);
        rig.sky.position.copy(rig.target).addScaledVector(new THREE.Vector3(Math.cos(az) * rr, y, Math.sin(az) * rr), rig.len);
      }
    },
    restore() {
      L.revert(); sun.shadow.radius = saved.radius; if (saved.blur != null) sun.shadow.blurSamples = saved.blur;
      if (rig.sky) { scene.remove(rig.sky); rig.sky.shadow.map?.dispose(); rig.sky.dispose?.(); rig.sky = null; }
    },
  };
  return L;
}

/** Largest render size (long side, pixels) this device should attempt: the GPU's texture limit and a memory-friendly cap, lower on a phone. */
export function maxPhotoPx(renderer, phone) {
  const tex = renderer?.capabilities?.maxTextureSize || 4096;
  return Math.min(tex, phone ? 1920 : 3840);
}
/** The size of a photo: `scale` times the view, the long side within [min, cap], the aspect kept. */
export function photoSize(view, scale, cap, min = 960) {
  const k0 = scale, long = Math.max(view.w, view.h);
  const k = Math.min(k0, cap / long), kk = Math.max(k, Math.min(1, min / long));
  return { w: Math.max(2, Math.round(view.w * kk)), h: Math.max(2, Math.round(view.h * kk)) };
}

/**
 * Render a photo of the host's current view.
 * @param {object} host
 * @param {{width: number, height: number, seconds?: number, ao?: boolean, bloom?: boolean, dof?: boolean, skyShadows?: boolean, minSamples?: number, maxSamples?: number,
 *   signal?: AbortSignal, onProgress?: (p: {samples: number, fraction: number, text: string}) => void}} o
 * @returns {Promise<{canvas: HTMLCanvasElement, samples: number, ms: number, width: number, height: number, aborted: boolean}>}
 */
export async function renderPhoto(host, o) {
  const { seconds = 12, ao = true, bloom = true, dof = false, skyShadows = true, minSamples = 4, maxSamples = 96, signal, onProgress } = o;
  let W = Math.round(o.width), H = Math.round(o.height);
  const r = host.renderer, cam = host.camera(), t0 = performance.now(), budget = seconds * 1000;
  const gl = r.getContext();
  host.begin?.({ boost: bloom });
  const lights = prepareLights(host, { skyShadows, share: host.look?.skyShare ?? LOOK.skyShare, sunRadius: host.look?.sunRadius ?? LOOK.sunRadius });
  lights.capture();
  const view0 = cam.view ? { ...cam.view } : null, exposure0 = r.toneMappingExposure;
  let pipe = null;
  try {
    onProgress?.({ samples: 0, fraction: 0, text: 'Preparing the render…' });
    r.toneMappingExposure = exposure0 * (host.look?.exposure ?? LOOK.exposure);
    host.setAspect(W / H);
    pipe = await createPipeline(host, W, H, { ao, bloom, dof, skyShadows });
    if (dof) pipe.setFocus(host.focus?.());
    let i = 0;
    const frame = (k) => {
      cam.setViewOffset(W, H, ...jit(k), W, H);
      lights.jitter(k);
      host.pose();
      pipe.frame();
      gl.finish();
    };
    const jit = (k) => [halton(k, 2) - 0.5, halton(k, 3) - 0.5];
    // the first frames compile the shaders and build the shadow maps: time them apart, and shrink the picture when the device cannot afford 10 frames in the budget
    frame(i++); frame(i++);
    pipe.restart(); i = 0;
    const t1 = performance.now(); frame(i++); const perFrame = Math.max(1, performance.now() - t1);
    if (budget / perFrame < 10 && Math.max(W, H) > 1100) {
      const k = Math.max(0.5, Math.sqrt((budget / perFrame) / 14));
      W = Math.max(2, Math.round(W * k)); H = Math.max(2, Math.round(H * k));
      pipe.dispose(); host.setAspect(W / H); pipe = await createPipeline(host, W, H, { ao, bloom, dof, skyShadows }); if (dof) pipe.setFocus(host.focus?.()); i = 0;
    }
    const start = performance.now();
    while (true) {
      const el = performance.now() - start;
      if (signal?.aborted && i >= 2) break;
      if (i >= maxSamples || (i >= minSamples && el >= budget)) break;
      frame(i++);
      onProgress?.({ samples: i, fraction: Math.min(0.99, Math.max(el / budget, i / maxSamples)), text: `Sample ${i} · ${W} × ${H} px` });
      await new Promise((res) => setTimeout(res, 0));
    }
    const img = pipe.pixels(), canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H; canvas.getContext('2d').putImageData(img, 0, 0);
    onProgress?.({ samples: i, fraction: 1, text: 'Done' });
    return { canvas, samples: i, ms: Math.round(performance.now() - t0), width: W, height: H, aborted: !!signal?.aborted };
  } finally {
    if (view0) cam.setViewOffset(view0.fullWidth, view0.fullHeight, view0.offsetX, view0.offsetY, view0.width, view0.height); else cam.clearViewOffset();
    pipe?.dispose(); lights.restore(); r.setRenderTarget(null); r.toneMappingExposure = exposure0;
    host.end?.();
  }
}
