// The phone app's decisions, with no DOM: where a bottom sheet settles after a drag, which way a gesture is going, how far a pull
// has to go to refresh, which map tiles an offline pack needs, and whether the "Add to Home Screen" guide should show.
// tests/js/native-core.test.mjs covers them. native.js, install-guide.js and offline-tiles.js do the touching.

// ------------------------------------------------------------------ gestures
export const LONG_PRESS_MS = 420;     // how long a finger rests on a card before its quick actions open
export const TOUCH_SLOP = 9;          // px a finger may wander and still be "resting"
export const PULL_THRESHOLD = 68;     // px of (damped) pull that triggers a refresh
export const PULL_MAX = 112;

/** Which way a gesture has decided to go once it has moved past the slop: 'x', 'y', or null while it is still undecided. */
export function lockAxis(dx, dy, slop = TOUCH_SLOP) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < slop) return null;
  return ax > ay * 1.15 ? 'x' : 'y';
}

/** iOS-style rubber band: movement past an edge is damped, never reaching `dim`. `over` is the raw overshoot in px. */
export function rubber(over, dim = 160, c = 0.55) {
  if (over <= 0) return 0;
  return (1 - 1 / ((over * c) / dim + 1)) * dim;
}

/** The pull-to-refresh indicator's travel for a raw finger pull: damped, capped. */
export const pullTravel = (raw) => Math.min(PULL_MAX, rubber(raw, PULL_MAX * 1.4, 0.8));
export const shouldRefresh = (travel) => travel >= PULL_THRESHOLD;

// ------------------------------------------------------------------ the bottom sheet
export const SHEET_STOPS = ['closed', 'peek', 'half', 'full'];

/** Visible heights (px) of the sheet at each detent for a viewport `vh` tall. Full leaves the top 12 % (the map's edge) as before. */
export function detentHeights(vh) {
  return { peek: Math.round(Math.max(300, vh * 0.4)), half: Math.round(vh * 0.64), full: Math.round(vh * 0.88) };
}

const nearestStop = (stops, v) => stops.reduce((bi, s, i) => (Math.abs(s - v) < Math.abs(stops[bi] - v) ? i : bi), 0);

/** Where the sheet settles when a drag ends. `visible` = how much of it shows now, `v` = release velocity in px/ms (positive = moving up,
 *  i.e. showing more), `from` = the detent it was at when the drag began (default: the nearest to where it is). A slow release goes to the
 *  nearest detent, with a little momentum (a projection 160 ms ahead, like a decelerating scroll). A flick (0.7 px/ms or faster) goes exactly
 *  one detent from where the drag began, in its direction, however hard it was: a hard flick down from peek closes, from half it stops at peek. */
export function snapDetent(visible, v, heights, from = null) {
  const stops = [0, heights.peek, heights.half, heights.full];
  const near = nearestStop(stops, visible);
  const start = from && SHEET_STOPS.includes(from) ? SHEET_STOPS.indexOf(from) : near;
  let to = nearestStop(stops, visible + v * 160);
  if (Math.abs(v) >= 0.7) {
    const dir = Math.sign(v);
    to = Math.max(0, Math.min(3, start + dir));
    to = dir > 0 ? Math.max(to, near) : Math.min(to, near);   // never against the flick, whatever the starting detent was
  }
  return SHEET_STOPS[to];
}

/** Clamp a dragged visible height: above full it is rubber-banded, below zero it stops. */
export function dragVisible(raw, heights) {
  if (raw > heights.full) return heights.full + rubber(raw - heights.full, 80);
  return Math.max(0, raw);
}

/** Does a swipe between homes commit? dx = travelled px (negative = leftwards), vx = px/ms, w = sheet width. Returns -1 (previous),
 *  1 (next) or 0 (spring back). A swipe LEFT shows the NEXT home, like turning a page. */
export function homeSwipe(dx, vx, w) {
  const far = Math.abs(dx) > w * 0.28, flick = Math.abs(vx) > 0.5 && Math.abs(dx) > 40;
  if (!far && !flick) return 0;
  return dx < 0 ? 1 : -1;
}

/** The neighbouring id in a list (no wrap), or null at either end or when `id` is not in the list. */
export function neighbour(ids, id, step) {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  const j = i + step;
  return j >= 0 && j < ids.length ? ids[j] : null;
}

// ------------------------------------------------------------------ quick actions and sharing
/** The long-press menu for one home. `has` = what the data holds for it ({ interior, site, plan, listing }); `state` = { saved, comparing }. */
export function quickActions(has = {}, state = {}) {
  const out = [
    { key: 'save', label: state.saved ? 'Remove from picks' : 'Save to picks', on: !!state.saved },
    { key: 'compare', label: state.comparing ? 'Remove from compare' : 'Add to compare', on: !!state.comparing },
  ];
  if (has.interior) out.push({ key: 'inside', label: 'See inside' });
  else if (has.site) out.push({ key: 'unit', label: 'Open in Unit 3D' });
  out.push({ key: 'share', label: 'Share' }, { key: 'open', label: 'Open details' });
  return out;
}

const money0 = (n) => (n == null ? null : '$' + Math.round(n).toLocaleString('en-US'));

/** The text a shared home carries next to its link: name and place, monthly cost, the commute and the score. Never notes or picks. */
export function shareSummary({ name, address, neighborhood, beds, cost, commuteMin, commuteTo, score }) {
  const where = [address, neighborhood].filter(Boolean).join(', ');
  const bits = [beds != null ? (beds === 0 ? 'studio' : `${beds} bd`) : null, money0(cost) ? `${money0(cost)}/mo` : null,
    commuteMin != null ? `${Math.round(commuteMin)} min${commuteTo ? ' to ' + commuteTo : ''}` : null, score != null ? `score ${Math.round(score)}` : null].filter(Boolean);
  return [name, where, bits.join(' · ')].filter(Boolean).join('\n');
}

// ------------------------------------------------------------------ the install guide
const DAY = 86400000;
export const GUIDE_SNOOZE_DAYS = 14;

/** What kind of iPhone browser is this? 'safari' | 'chrome' | 'firefox' | 'edge' | 'inapp' | 'other' ; null when it is not an iPhone/iPad.
 *  iPadOS reports a Mac UA, told apart by touch points. */
export function iosBrowser(ua = '', platform = '', touchPoints = 0) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
  if (!ios) return null;
  if (/FBAN|FBAV|Instagram|Line\/|MicroMessenger|Twitter|LinkedInApp|Snapchat|GSA\//.test(ua)) return 'inapp';
  if (/CriOS/.test(ua)) return 'chrome';
  if (/FxiOS/.test(ua)) return 'firefox';
  if (/EdgiOS/.test(ua)) return 'edge';
  return /Safari/.test(ua) ? 'safari' : 'other';
}

/** Should the "Add to Home Screen" guide open by itself? 'show', or the reason it should not.
 *  Not once installed, not in an in-app browser (it has no Add to Home Screen), not while snoozed or after "don't show again",
 *  and only on a return visit, so a first look is never interrupted. `forced` (?installguide=1) skips all of that but the platform. */
export function guideDecision({ browser, standalone = false, visits = 1, dismissedAt = null, never = false, now = Date.now(), forced = false } = {}) {
  if (!browser) return 'not-ios';
  if (standalone) return 'installed';
  if (forced) return 'show';
  if (browser === 'inapp') return 'in-app';
  if (never) return 'never';
  if (dismissedAt != null && now - dismissedAt < GUIDE_SNOOZE_DAYS * DAY) return 'snoozed';
  if (visits < 2) return 'first-visit';
  return 'show';
}

// ------------------------------------------------------------------ offline map tiles
// OpenFreeMap (the basemap) lets an app save an area for offline use up to 3,000 tiles or 50 MB per download, four requests at a time,
// and asks for a unique User-Agent (a page cannot set one: its requests carry the app's origin and the browser's own agent).
// The pack stays well under both numbers.
export const TILE_HOST = 'tiles.openfreemap.org';
export const TILEJSON_URL = `https://${TILE_HOST}/planet`;
export const PACK = Object.freeze({ maxTiles: 1500, maxBytes: 40 * 1024 * 1024, parallel: 4, policyTiles: 3000, policyBytes: 50 * 1024 * 1024 });
export const GLYPH_FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
// per zoom: how far from each place the pack reaches (metres). OpenFreeMap's tiles end at zoom 14; the map draws closer in from them.
const REACH = [[14, 1100], [13, 2600], [12, 6000], [11, 14000], [10, 30000]];
const MPD = 111320;

export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z, la = Math.max(-85.0511, Math.min(85.0511, lat)) * (Math.PI / 180);
  const x = Math.floor(((lon + 180) / 360) * n), y = Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/** Every tile at zoom z that a circle of `radiusM` metres around the point touches. */
export function tilesAround(lat, lon, z, radiusM) {
  const dLat = radiusM / MPD, dLon = radiusM / (MPD * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const a = lonLatToTile(lon - dLon, lat + dLat, z), b = lonLatToTile(lon + dLon, lat - dLat, z), out = [];
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) out.push({ z, x, y });
  return out;
}

export const tileKey = (t) => `${t.z}/${t.x}/${t.y}`;

/** The pack for a set of places, in download order and capped. `places` = [{ lat, lon, kind }] most important first (today's stops, then
 *  the shortlist). Order: the wide zooms over everything first (so a map always draws), then zoom 14 place by place until the cap or the
 *  byte budget (applied by the downloader) runs out. Returns { tiles: [{z,x,y}], places: n, capped: bool }. */
export function planPack(places, { maxTiles = PACK.maxTiles } = {}) {
  const pts = (places || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  const seen = new Set(), tiles = [];
  const add = (t) => { const k = tileKey(t); if (!seen.has(k)) { seen.add(k); tiles.push(t); } };
  for (const [z, r] of [...REACH].reverse().filter(([z]) => z < 14)) for (const p of pts) tilesAround(p.lat, p.lon, z, r).forEach(add);
  for (const p of pts) tilesAround(p.lat, p.lon, 14, REACH[0][1]).forEach(add);
  return { tiles: tiles.slice(0, maxTiles), places: pts.length, capped: tiles.length > maxTiles };
}

export const tileUrl = (template, t) => template.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);

/** A tile's address without its weekly version folder, so a saved tile answers for the same tile of a newer build:
 *  https://tiles.openfreemap.org/planet/20261011_080001_pt/14/4825/6156.pbf -> https://tiles.openfreemap.org/planet/14/4825/6156.pbf.
 *  sw.js has the same rule (tests/js/native-core.test.mjs checks the two agree). Anything else is returned as it is. */
export function normalizeTileUrl(url) {
  return String(url).replace(/^(https:\/\/tiles\.openfreemap\.org\/planet)\/[0-9a-z_]+\/(\d+\/\d+\/\d+\.pbf)(?=$|\?)/, '$1/$2');
}

/** The label-glyph ranges the pack saves (Latin, which is what the map's labels use). */
export const glyphUrls = () => GLYPH_FONTS.flatMap((f) => ['0-255', '256-511'].map((r) => `https://${TILE_HOST}/fonts/${encodeURIComponent(f)}/${r}.pbf`));

/** Which basemap is drawing: from the map's own flags. Only OpenFreeMap's terms allow a saved area, so the offline pack is offered for it alone. */
export function basemapPolicy(kind) {
  if (kind === 'openfreemap') return { pack: true, host: TILE_HOST, note: 'Map tiles come from OpenFreeMap, whose terms let an app save an area for offline use (up to 3,000 tiles or 50 MB, four requests at a time). This saves far less than that.' };
  if (kind === 'esri') return { pack: false, host: 'server.arcgisonline.com', note: 'This search draws Esri’s basemap, whose terms do not allow saving a whole area. Only the part of the map you look at is kept for offline use, up to a size limit.' };
  if (kind === 'custom') return { pack: false, host: null, note: 'This search uses its own tile server, so the map is not saved for offline use. Pins, transit lines and heat come from saved data and still draw.' };
  return { pack: false, host: null, note: 'The map is in its offline style right now (its tiles could not be reached).' };
}

export function bytesLabel(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
}
