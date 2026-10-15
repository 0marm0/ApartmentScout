// What the photo and video renderers need that has no DOM and no three.js, so node tests read it: which video format this browser records,
// the bit rate, a WebM whose duration is written into its header (Chrome's MediaRecorder leaves it out, so the file reports "Infinity" and
// cannot be scrubbed), file names, and whether the share sheet can take a file.

const WEBM = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm;codecs=av1', 'video/webm'];
const MP4 = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'];

/**
 * The container to record in. WebM where the browser makes it (Chrome, Edge, Firefox), MP4 on Apple's browsers, whose Photos app and share sheet take MP4
 * and not WebM; whichever is the other kind is the fallback. `isSupported(type)` is MediaRecorder.isTypeSupported; `apple` = Safari or an iPhone browser.
 * @returns {string|null} the MIME type to pass to MediaRecorder (null: no recorder here)
 */
export function pickVideoType(isSupported, { apple = false } = {}) {
  const order = apple ? [...MP4, ...WEBM] : [...WEBM, ...MP4];
  for (const t of order) { try { if (isSupported(t)) return t; } catch { /* a browser that throws on a type: try the next */ } }
  return null;
}
/** The file extension for a recorder MIME type. */
export const extOf = (type) => (/mp4/i.test(type || '') ? 'mp4' : 'webm');

/** Is this an Apple browser (Safari on a Mac or iPhone, or any iPhone browser)? Takes navigator-like input so tests can pass strings. */
export function isApple(nav) {
  const ua = String(nav?.userAgent || ''), vendor = String(nav?.vendor || '');
  return /iPhone|iPad|iPod/.test(ua) || (/Safari/.test(ua) && /Apple/.test(vendor) && !/Chrome|Chromium|CriOS|Edg|FxiOS/.test(ua));
}

/** Bits a second for sharp interiors: about 0.16 bits per pixel per frame, capped (a phone's Photos and a chat app both take 20 Mbit/s). */
export function videoBitrate(w, h, fps = 30) {
  return Math.round(Math.min(20e6, Math.max(2.5e6, w * h * fps * 0.16)));
}

/** The frame size of a video: 16:9 landscape (or 9:16 portrait) with the short side at `height` (1080 = 1080p), even numbers, never above `maxPx` on the long side. */
export function videoSize(height = 1080, { portrait = false, maxPx = 4096 } = {}) {
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);
  let short = even(height), long = even((short * 16) / 9);
  if (long > maxPx) { long = even(maxPx); short = even((long * 9) / 16); }
  return portrait ? { w: short, h: long } : { w: long, h: short };
}

/** A safe file name from parts: lower case, letters digits and dashes. */
export const slug = (...parts) => parts.filter((p) => p !== null && p !== undefined && p !== '').map((p) => String(p).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean).join('-');
/** A file name for a render: `<slug>.<ext>`. */
export const fileName = (parts, ext) => `${slug(...parts)}.${ext}`;

/** True when the browser's share sheet can take these files (iPhone, Android, some desktops). */
export function canShareFiles(nav, files) {
  try { return !!nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files }); } catch { return false; }
}

// ------------------------------------------------------------------ WebM duration
// Chrome's MediaRecorder streams a WebM: the Segment's size is "unknown" and the Info element has no Duration. A player then reports an unknown
// length and cannot seek. The fix is to write the Duration element into Info (and grow the sizes that contain it). Only EBML bytes are touched.
const ID_SEEKHEAD = 0x114d9b74, ID_SEGMENT = 0x18538067, ID_INFO = 0x1549a966, ID_CLUSTER = 0x1f43b675, ID_DURATION = 0x4489, ID_SCALE = 0x2ad7b1;

function readId(b, i) {
  const f = b[i]; if (f === undefined || f === 0) return null;
  const len = f >= 0x80 ? 1 : f >= 0x40 ? 2 : f >= 0x20 ? 3 : f >= 0x10 ? 4 : 0; if (!len || i + len > b.length) return null;
  let id = 0; for (let k = 0; k < len; k++) id = id * 256 + b[i + k];
  return { id, len };
}
function readSize(b, i) {
  const f = b[i]; if (f === undefined || f === 0) return null;
  let len = 1; while (len <= 8 && !(f & (0x80 >> (len - 1)))) len++;
  if (len > 8 || i + len > b.length) return null;
  let v = f & (0xff >> len), unknown = v === (0xff >> len);
  for (let k = 1; k < len; k++) { v = v * 256 + b[i + k]; if (b[i + k] !== 0xff) unknown = false; }
  return { len, value: unknown ? -1 : v };
}
/** A size as an EBML varint of exactly `len` bytes (or the shortest that fits when `len` is 0). */
function sizeBytes(value, len = 0) {
  let n = len || 1; while (n < 8 && value >= 2 ** (7 * n) - 1) n++;
  if (value >= 2 ** (7 * n) - 1) return null;
  const out = new Uint8Array(n); let v = value;
  for (let k = n - 1; k >= 0; k--) { out[k] = v % 256; v = Math.floor(v / 256); }
  out[0] |= 0x80 >> (n - 1);
  return out;
}

/**
 * The bytes of a WebM with a Duration (milliseconds, at the default 1 ms timecode scale) in its Info element. Returns the input untouched when it is
 * not a WebM this function understands, or already has a Duration. Pure and synchronous (the file is a few MB).
 * @param {Uint8Array} bytes
 * @param {number} ms
 * @returns {Uint8Array}
 */
export function withWebmDuration(bytes, ms) {
  try {
    const b = bytes; if (!(ms > 0) || b.length < 32 || readId(b, 0)?.id !== 0x1a45dfa3) return bytes;
    const h = readSize(b, 4); if (!h) return bytes;
    const segAt = 4 + h.len + h.value, seg = readId(b, segAt); if (seg?.id !== ID_SEGMENT) return bytes;
    const segSize = readSize(b, segAt + seg.len); if (!segSize) return bytes;
    const body = segAt + seg.len + segSize.len;   // first child of the Segment
    let i = body, info = null;
    while (i < b.length) {
      const id = readId(b, i); if (!id) break;
      const sz = readSize(b, i + id.len); if (!sz) break;
      if (id.id === ID_INFO) { info = { at: i, idLen: id.len, sizeLen: sz.len, size: sz.value, start: i + id.len + sz.len }; break; }
      if (id.id === ID_SEEKHEAD) return bytes;   // its offsets would shift by the bytes added: leave such a file as it is
      if (id.id === ID_CLUSTER || sz.value < 0) break;
      i += id.len + sz.len + sz.value;
    }
    if (!info || info.size < 0) return bytes;
    // already has a Duration? (and the timecode scale, which sets the unit)
    let scale = 1e6;
    for (let j = info.start; j < info.start + info.size;) {
      const id = readId(b, j), sz = id && readSize(b, j + id.len); if (!id || !sz || sz.value < 0) break;
      if (id.id === ID_DURATION) return bytes;
      if (id.id === ID_SCALE) { let v = 0; for (let k = 0; k < sz.value; k++) v = v * 256 + b[j + id.len + sz.len + k]; if (v > 0) scale = v; }
      j += id.len + sz.len + sz.value;
    }
    const dur = new Uint8Array(11); dur[0] = 0x44; dur[1] = 0x89; dur[2] = 0x88;
    new DataView(dur.buffer).setFloat64(3, (ms * 1e6) / scale, false);
    const newInfo = sizeBytes(info.size + dur.length, info.sizeLen) || sizeBytes(info.size + dur.length);
    if (!newInfo) return bytes;
    const grow = dur.length + (newInfo.length - info.sizeLen);
    let segHead = b.subarray(segAt, body);
    if (segSize.value >= 0) {   // a Segment of known size grows with its Info
      const ns = sizeBytes(segSize.value + grow, segSize.len) || sizeBytes(segSize.value + grow); if (!ns) return bytes;
      segHead = new Uint8Array(seg.len + ns.length); segHead.set(b.subarray(segAt, segAt + seg.len)); segHead.set(ns, seg.len);
    }
    const out = new Uint8Array(b.length + grow + (segHead.length - (body - segAt)));
    let o = 0; const put = (a) => { out.set(a, o); o += a.length; };
    put(b.subarray(0, segAt)); put(segHead); put(b.subarray(body, info.at + info.idLen)); put(newInfo);
    put(b.subarray(info.start, info.start + info.size)); put(dur);
    put(b.subarray(info.start + info.size));
    return out;
  } catch { return bytes; }
}

/** The Duration (milliseconds) written in a WebM's Info, or null. For tests and for the page to double-check a file it just made. */
export function webmDuration(bytes) {
  try {
    const b = bytes; let i = 0;
    const scan = (from, to) => {
      for (let p = from; p < to;) {
        const id = readId(b, p), sz = id && readSize(b, p + id.len); if (!id || !sz) return null;
        const start = p + id.len + sz.len;
        if (id.id === 0x1a45dfa3) { p = start + sz.value; continue; }
        if (id.id === ID_SEGMENT) { const r = scan(start, sz.value < 0 ? b.length : start + sz.value); if (r !== null) return r; p = sz.value < 0 ? b.length : start + sz.value; continue; }
        if (id.id === ID_INFO) {
          let scale = 1e6, dur = null;
          for (let j = start; j < start + sz.value;) {
            const a = readId(b, j), s2 = a && readSize(b, j + a.len); if (!a || !s2) break;
            const d = j + a.len + s2.len;
            if (a.id === ID_SCALE) { let v = 0; for (let k = 0; k < s2.value; k++) v = v * 256 + b[d + k]; scale = v || scale; }
            if (a.id === ID_DURATION) dur = s2.value === 8 ? new DataView(b.buffer, b.byteOffset + d, 8).getFloat64(0, false) : new DataView(b.buffer, b.byteOffset + d, 4).getFloat32(0, false);
            j = d + s2.value;
          }
          return dur === null ? null : (dur * scale) / 1e6;
        }
        if (id.id === ID_CLUSTER || sz.value < 0) return null;
        p = start + sz.value;
      }
      return null;
    };
    return scan(i, b.length);
  } catch { return null; }
}
