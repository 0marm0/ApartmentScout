// node --test tests/js : the parts of the photo and video renderers with no DOM: the video format a browser records, sizes and bit rates, file names, the WebM
// duration written into the header (Chrome's MediaRecorder leaves it out), and the times of day a render can be made at (render/encode.js, render/timeofday.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickVideoType, extOf, isApple, videoBitrate, videoSize, slug, fileName, canShareFiles, withWebmDuration, webmDuration, photoSize, maxPhotoPx } from '../../dashboard/js/render/encode.js';
import { TIMES, timeOfDay, clock } from '../../dashboard/js/render/timeofday.js';

test('Chrome records WebM (VP9 first), Apple browsers MP4; each falls back to the other; no recorder gives null', () => {
  const all = () => true, webmOnly = (t) => t.startsWith('video/webm'), mp4Only = (t) => t.startsWith('video/mp4');
  assert.equal(pickVideoType(all), 'video/webm;codecs=vp9');
  assert.equal(pickVideoType(all, { apple: true }), 'video/mp4;codecs=avc1.640028');
  assert.equal(pickVideoType(webmOnly, { apple: true }), 'video/webm;codecs=vp9');
  assert.equal(pickVideoType(mp4Only), 'video/mp4;codecs=avc1.640028');
  assert.equal(pickVideoType((t) => t === 'video/webm;codecs=vp8'), 'video/webm;codecs=vp8');
  assert.equal(pickVideoType(() => false), null);
  assert.equal(pickVideoType(() => { throw new Error('no'); }), null, 'a browser that throws is a browser without');
  assert.equal(extOf('video/mp4;codecs=avc1'), 'mp4'); assert.equal(extOf('video/webm'), 'webm'); assert.equal(extOf(undefined), 'webm');
});

test('Apple browsers are told apart from Chrome on a Mac and from other iPhone browsers', () => {
  const safariMac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', vendor: 'Apple Computer, Inc.' };
  const chromeMac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', vendor: 'Google Inc.' };
  const iphoneChrome = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1', vendor: 'Apple Computer, Inc.' };
  assert.equal(isApple(safariMac), true); assert.equal(isApple(chromeMac), false); assert.equal(isApple(iphoneChrome), true); assert.equal(isApple({}), false); assert.equal(isApple(null), false);
});

test('1080p is 1920 x 1080 at about 10 Mbit/s, even sizes, clamped to what the GPU takes', () => {
  assert.deepEqual(videoSize(1080), { w: 1920, h: 1080 }); assert.deepEqual(videoSize(720), { w: 1280, h: 720 }); assert.deepEqual(videoSize(1080, { portrait: true }), { w: 1080, h: 1920 });
  assert.deepEqual(videoSize(2160), { w: 3840, h: 2160 });
  const small = videoSize(1080, { maxPx: 1600 }); assert.ok(small.w <= 1600 && small.w % 2 === 0 && small.h % 2 === 0 && Math.abs(small.w / small.h - 16 / 9) < 0.01, JSON.stringify(small));
  assert.ok(Math.abs(videoBitrate(1920, 1080, 30) - 9.95e6) < 1e5); assert.ok(videoBitrate(320, 180, 30) >= 2.5e6); assert.equal(videoBitrate(3840, 2160, 60), 20e6);
});

test('file names are safe and tell what the picture is', () => {
  assert.equal(slug('Paramount Tower 25E', 'floor 25', null, '', 'Inside!'), 'paramount-tower-25e-floor-25-inside');
  assert.equal(fileName(['paramount-tower-25e-floor25-2026-10-15-1300-inside', 'tour'], 'webm'), 'paramount-tower-25e-floor25-2026-10-15-1300-inside-tour.webm');
  assert.equal(fileName(['../../etc/passwd'], 'png'), 'etc-passwd.png');
});

test('the share sheet is used only where it takes files', () => {
  const files = [{ name: 'a.jpg' }];
  assert.equal(canShareFiles({ share() {}, canShare: (d) => d.files.length === 1 }, files), true);
  assert.equal(canShareFiles({ share() {}, canShare: () => false }, files), false);
  assert.equal(canShareFiles({ share() {} }, files), false, 'share without canShare: files are not known to work');
  assert.equal(canShareFiles({ share() {}, canShare() { throw new Error('x'); } }, files), false);
  assert.equal(canShareFiles(undefined, files), false);
});

// ---- WebM: a minimal file the way Chrome's MediaRecorder writes it (unknown-size Segment, an Info with no Duration)
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const sizeOf = (n, len = 0) => { let k = len || 1; while (n >= 2 ** (7 * k) - 1) k++; const o = new Uint8Array(k); let v = n; for (let i = k - 1; i >= 0; i--) { o[i] = v % 256; v = Math.floor(v / 256); } o[0] |= 0x80 >> (k - 1); return o; };
const el = (id, payload, sizeLen = 0) => cat(new Uint8Array(id), sizeOf(payload.length, sizeLen), payload);
const u = (...b) => new Uint8Array(b);
const ascii = (s) => new TextEncoder().encode(s);
function webm({ info = true, knownSegment = false, infoSizeLen = 8, duration = null, seekHead = false } = {}) {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], ascii('webm')));
  const infoPayload = cat(el([0x2a, 0xd7, 0xb1], u(0x0f, 0x42, 0x40)), el([0x4d, 0x80], ascii('Chrome')), el([0x57, 0x41], ascii('Chrome')),
    duration == null ? new Uint8Array(0) : el([0x44, 0x89], new Uint8Array(new Float64Array([duration]).buffer).reverse()));
  const parts = [seekHead ? el([0x11, 0x4d, 0x9b, 0x74], u(0xec, 0x80)) : new Uint8Array(0), info ? el([0x15, 0x49, 0xa9, 0x66], infoPayload, infoSizeLen) : new Uint8Array(0),
    el([0x16, 0x54, 0xae, 0x6b], u(0xae, 0x82, 0xd7, 0x81)), el([0x1f, 0x43, 0xb6, 0x75], cat(el([0xe7], u(0)), el([0xa3], u(0x81, 0, 0, 0x80, 1, 2, 3, 4))))];
  const body = cat(...parts);
  const seg = knownSegment ? cat(u(0x18, 0x53, 0x80, 0x67), sizeOf(body.length, 8), body) : cat(u(0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff), body);
  return cat(header, seg);
}

test('a WebM with no duration gets one in its Info, in milliseconds, and everything else in the file is untouched', () => {
  for (const knownSegment of [false, true]) for (const infoSizeLen of [1, 2, 8]) {
    const src = webm({ knownSegment, infoSizeLen });
    assert.equal(webmDuration(src), null, 'no duration to begin with');
    const out = withWebmDuration(src, 12400);
    assert.notEqual(out, src); assert.equal(webmDuration(out), 12400, `segment ${knownSegment ? 'known' : 'unknown'}, info size field ${infoSizeLen} byte(s)`);
    // the clusters, tracks and the frame data are byte for byte the same, after the Info
    const tail = (b) => Buffer.from(b).toString('hex').slice(-50);   // the Tracks and the Cluster
    assert.equal(tail(out), tail(src));
    assert.equal(withWebmDuration(out, 5000), out, 'a file that has a duration is left as it is');
  }
});

test('a known-size Segment still adds up after the Info grew', () => {
  const src = webm({ knownSegment: true, infoSizeLen: 8 }), out = withWebmDuration(src, 9000);
  // read the Segment's size field back: it must reach exactly the end of the file
  const hex = Buffer.from(out).toString('hex'), at = hex.indexOf('18538067') / 2, sz = out.subarray(at + 4, at + 12);
  let v = 0n; for (let k = 1; k < 8; k++) v = v * 256n + BigInt(sz[k]);
  assert.equal(Number(v), out.length - (at + 12), 'the Segment size is the rest of the file');
});

test('files this cannot handle come back untouched: not a WebM, no Info, a SeekHead, no duration to write', () => {
  const junk = new Uint8Array(64).fill(7), noInfo = webm({ info: false }), seek = webm({ seekHead: true }), ok = webm({});
  assert.equal(withWebmDuration(junk, 1000), junk); assert.equal(withWebmDuration(noInfo, 1000), noInfo); assert.equal(withWebmDuration(seek, 1000), seek);
  assert.equal(withWebmDuration(ok, 0), ok); assert.equal(withWebmDuration(ok, NaN), ok); assert.equal(withWebmDuration(new Uint8Array(3), 1000).length, 3);
  assert.equal(webmDuration(junk), null);
});

test('a WebM that already says how long it is keeps that', () => {
  const src = webm({ duration: 8000 }); assert.equal(webmDuration(src), 8000); assert.equal(withWebmDuration(src, 1234), src);
});

// ---- the times of day
const sun = (m) => 62 * Math.sin(((m - 360) / 840) * Math.PI) - 8;   // rises about 6:40, noon 13:00 at 54 degrees, sets about 19:20
test('golden hour is the evening, with the sun low and warm; morning, noon, blue hour and night follow the same sun', () => {
  const g = timeOfDay('golden', sun), mo = timeOfDay('morning', sun), no = timeOfDay('noon', sun), bl = timeOfDay('blue', sun), ni = timeOfDay('night', sun);
  assert.ok(g.min > no.min && g.alt >= 6.5 && g.alt < 10, `golden ${clock(g.min)} at ${g.alt.toFixed(1)} deg`);
  assert.ok(mo.min < no.min && mo.alt >= 9 && mo.alt < 14, `morning ${clock(mo.min)}`);
  assert.equal(no.min, 780);
  assert.ok(bl.min > g.min && bl.alt <= -3 && bl.alt > -7, `blue ${clock(bl.min)} at ${bl.alt.toFixed(1)}`);
  assert.ok(ni.min >= bl.min && ni.alt <= bl.alt, `night ${clock(ni.min)}`);
  assert.deepEqual(timeOfDay('now', sun, { now: 1000 }), { min: 1000, alt: sun(1000), key: 'now' });
  assert.deepEqual(TIMES.map((t) => t.key), ['golden', 'morning', 'noon', 'blue', 'night', 'now']);
  assert.equal(TIMES[0].key, 'golden', 'golden hour first: the default');
});

test('where the sun never gets low or never gets high, a preset still answers with a minute in range', () => {
  const polarDay = () => 20, winter = () => -2;
  for (const alt of [polarDay, winter]) for (const t of TIMES) { const r = timeOfDay(t.key, alt, { from: 300, to: 1285, now: 800 }); assert.ok(r.min >= 300 && r.min <= 1285, `${t.key}: ${r.min}`); }
  assert.equal(clock(1055), '5:35 pm'); assert.equal(clock(0), '12:00 am'); assert.equal(clock(725), '12:05 pm');
});

test('a photo is the view times the scale, the aspect kept, the long side within what the device can take and not under 960 px', () => {
  const view = { w: 1400, h: 600 };
  assert.deepEqual(photoSize(view, 1.5, 3840), { w: 2100, h: 900 });
  assert.deepEqual(photoSize(view, 4, 3840), { w: 3840, h: 1646 }, 'capped on the long side');
  assert.deepEqual(photoSize({ w: 340, h: 640 }, 1.5, 1920), { w: 510, h: 960 }, 'a phone-sized view is brought up to 960 px');
  const small = photoSize({ w: 300, h: 200 }, 1.5, 3840); assert.equal(Math.max(small.w, small.h) >= 960, true); assert.ok(Math.abs(small.w / small.h - 1.5) < 0.01);
  assert.equal(maxPhotoPx({ capabilities: { maxTextureSize: 16384 } }, false), 3840); assert.equal(maxPhotoPx({ capabilities: { maxTextureSize: 16384 } }, true), 1920);
  assert.equal(maxPhotoPx({ capabilities: { maxTextureSize: 2048 } }, false), 2048); assert.equal(maxPhotoPx(null, false), 3840);
});
