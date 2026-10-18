// 3D stills for the decision report: the view out of a home's window, taken from Unit 3D. The dashboard's own Unit 3D page is opened in
// an invisible frame (same origin, in window mode, at a chosen day and hour), its canvas is read once the scene has drawn, and the
// frame is removed. Nothing is uploaded: the picture is cropped to the card's shape and returned as a JPEG data URI.
//
// Unit 3D remembers the camera and the home it was last used with in this browser; a still must not change what the renter sees next
// time, so those keys are put back as they were. No imports: the report page and the headless command line both use this file as is.

const REMEMBERED = ['as:unit-cam', 'as:home-id', 'as:home-last'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

let webgl = null;
/** Whether this browser can make a WebGL context (asked once: a context is a scarce thing). */
function hasWebGL() {
  if (webgl === null) { try { const c = document.createElement('canvas'); webgl = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { webgl = false; } }
  return webgl;
}

/** "Oct 28, 12:00 pm" for an ISO day and minutes after midnight. */
export function whenLabel(date, min) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  if (!m) return '';
  const h = Math.floor(min / 60), mm = min % 60;
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/**
 * One home's window view, or null when there is none (no site model, no WebGL, the page would not load).
 * @param {string} id listing id
 * @param {{date?: string, min?: number, width?: number, height?: number, timeout?: number, base?: string}} o
 *   date: ISO day (default: the page's own default for that home), min: minutes after midnight (default 12:00),
 *   width/height: the picture, cropped from the centre of the canvas (default 1000 x 500).
 * @returns {Promise<{src: string, floor: number|null, face: number|null, when: string}|null>}
 */
export async function captureStill(id, o = {}) {
  const { min = 720, width = 1000, height = 500, timeout = 120000 } = o;   // a software-GL machine (a CI runner, a PC without a GPU) takes over a minute to build the city
  if (!hasWebGL()) return null;   // say so now, not after the wait
  const keep = Object.fromEntries(REMEMBERED.map((k) => [k, read(k)]));
  const qs = new URLSearchParams({ mode: 'window', min: String(min), ...(o.date ? { date: o.date } : {}), theme: 'light' });
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1; f.title = '';
  f.style.cssText = 'position:fixed;left:-4000px;top:0;width:1200px;height:760px;border:0;visibility:hidden;pointer-events:none';
  f.src = `${o.base || location.pathname}?${qs}#unit/${encodeURIComponent(id)}`;
  try {
    document.body.appendChild(f);
    const t0 = performance.now();
    let w = null, u = null;
    while (performance.now() - t0 < timeout) {
      try {
        w = f.contentWindow; u = w && w.__unit3d;
        const load = w && w.document.getElementById('uLoad');
        if (u && u.stage && u.stage.scene && u.st.id === id && load && load.hidden && u.st.mode === 'win' && w.document.getElementById('gl')) break;
      } catch { return null; }   // a page opened as a file has no readable frame
      u = null;
      await sleep(150);
    }
    if (!u) return null;
    await sleep(500);   // the sky, the city and the trees finish a moment after the scene exists
    try { u.stage.frame(true); } catch { /* an older build: the canvas is drawn every frame anyway */ }
    await new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
    const cv = w.document.getElementById('gl');
    if (!cv || !cv.width || !cv.height) return null;
    const k = Math.max(width / cv.width, height / cv.height), sw = width / k, sh = height / k;
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    const g = c.getContext('2d');
    g.fillStyle = '#dfe7f5'; g.fillRect(0, 0, width, height);
    g.drawImage(cv, (cv.width - sw) / 2, (cv.height - sh) / 2, sw, sh, 0, 0, width, height);
    const src = c.toDataURL('image/jpeg', 0.84);
    if (src.length < 4000) return null;   // an empty canvas encodes to almost nothing
    const st = u.st;
    return { src, floor: Number.isFinite(st.floor) ? st.floor : null, face: Number.isFinite(st.az) ? Math.round(st.az) : null, when: whenLabel(st.date, st.min) };
  } catch (e) {
    return null;
  } finally {
    f.remove();
    for (const [k, v] of Object.entries(keep)) if (read(k) !== v) write(k, v);
  }
}

/** Stills for several homes, one after another (each is a whole WebGL scene). `onProgress(done, total)` after each. */
export async function captureStills(ids, o = {}, onProgress = null) {
  const out = {};
  let n = 0;
  for (const id of ids) {
    const s = await captureStill(id, o);
    if (s) out[id] = s;
    onProgress?.(++n, ids.length);
  }
  return out;
}
