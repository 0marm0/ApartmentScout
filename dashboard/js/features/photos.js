// Photo model: every image a listing has, sorted the way the dashboard shows it, with scope, credit and flags.
//
// Pure data logic (no DOM) so it runs under `node --test tests/js/`. The Python twin in apartmentscout/lqip.py
// (photo_groups) decides which photos get a blur-up preview with the same rules; keep them in step.
//
// Groups (the lightbox tabs): unit (the exact unit), line (same line, another floor), building (the building's
// amenities, lobby, exterior and other units), plan (floor plans), street (the block). Inside a group a clean photo
// comes before one flagged as carrying a broker mark (`photo_flags[path].watermark`), and otherwise the data order holds.
import { safeUrl } from '../util.js';
import { rememberOriginal } from './media-chain.js';

export const GROUPS = [
  { key: 'unit', label: 'Unit', long: 'This unit' },
  { key: 'line', label: 'Same line', long: 'Same line, another floor' },
  { key: 'building', label: 'Building', long: 'The building' },
  { key: 'plan', label: 'Floor plans', long: 'Floor plan' },
  { key: 'street', label: 'Street', long: 'On this block' },
];
export const GROUP_KEYS = GROUPS.map((g) => g.key);
const RANK = Object.fromEntries(GROUP_KEYS.map((k, i) => [k, i]));
const SCOPE = { 'exact-unit': 'unit', exact: 'unit', unit: 'unit', 'same-line': 'line', line: 'line', 'same-building': 'building', building: 'building', 'same-property': 'building', street: 'street', block: 'street' };
/** The lightbox group for a `scope` string; `dflt` when the scope is missing or unknown. */
export const groupOf = (scope, dflt) => SCOPE[String(scope ?? '').trim().toLowerCase()] || dflt;
export const groupInfo = (key) => GROUPS[RANK[key]] || GROUPS[2];

const IMG_EXT = /\.(png|jpe?g|webp|gif|avif|svg)(\?.*)?$/i;
const GENERIC_TITLE = /(building|exterior) image$/i;
const isLocal = (u) => /^media\//.test(u || '');
const cache = new WeakMap();

function creditOf(src = {}, fallbackNote = null) {
  const title = src.title && !GENERIC_TITLE.test(String(src.title).trim()) ? String(src.title) : null;
  return {
    title, author: src.author || null, license: src.license || null, licenseUrl: safeUrl(src.license_url) || null,
    page: safeUrl(src.page) || null, source: src.source || null, year: src.year || null,
    // photos_meta carries a one-line credit string; building photos carry author and license instead
    note: typeof src.credit === 'string' ? src.credit : fallbackNote,
  };
}

/** Every displayable image of a listing, in lightbox order: unit, same line, building, floor plans, street.
 *  Each item: { url, remote, group, source, own, flagged, why, credit, keys, L }. `remote` is the original link to
 *  fall back to when a saved copy is missing; `keys` are the sidecar keys to look a blur-up preview up by. */
export function photoItems(L) {
  if (!L || typeof L !== 'object') return [];
  const hit = cache.get(L);
  if (hit) return hit;
  const flags = L.photo_flags || {};
  const flagOf = (...keys) => { for (const k of keys) if (k && flags[k]) return flags[k]; return null; };
  const out = [], seen = new Set();
  const push = (it) => {
    if (!it.url || seen.has(it.url)) return;
    seen.add(it.url);
    if (it.remote) rememberOriginal(it.url, it.remote);   // the last tier of the photo's fallback chain (features/media-chain.js)
    const f = flagOf(it.url, it.remote);
    out.push({ ...it, flagged: !!f?.watermark, why: f?.why || [], keys: [it.url, it.remote].filter(Boolean), L, n: out.length });
  };
  // the listing's own photos: a saved copy where there is one (falling back to the original link), else the link
  const local = L.photos_local || [], web = L.photos || [], meta = L.photos_meta || [];
  const total = Math.max(local.length, web.length);
  for (let i = 0; i < total; i++) {
    const loc = safeUrl(local[i]), w = safeUrl(web[i]);
    const m = meta[i] && typeof meta[i] === 'object' ? meta[i] : {};
    push({ url: i < local.length ? loc : w, remote: i < local.length && w !== loc ? w : null, group: groupOf(m.scope, 'unit'), source: 'photo', own: true,
      credit: creditOf(m, 'Listing photo, copyright its owner') });
  }
  for (const b of L.building_photos || []) {
    const url = safeUrl(b?.url);
    push({ url, remote: null, group: groupOf(b?.scope, 'building'), source: 'building', own: false, credit: creditOf(b), raw: b });
  }
  // floor plans: a saved copy and its original link are both listed in the data; show the copy, fall back to the link
  const plans = (L.floorplan_images || []).map(safeUrl).filter(Boolean);
  const fp = safeUrl(L.links?.floorplan);
  if (fp && IMG_EXT.test(fp)) plans.push(fp);
  const copies = [...new Set(plans.filter(isLocal))], links = [...new Set(plans.filter((u) => !isLocal(u)))];
  if (copies.length) copies.forEach((u, i) => push({ url: u, remote: links.length === copies.length ? links[i] : null, group: 'plan', source: 'plan', own: false, credit: creditOf({}, 'Floor plan from the listing') }));
  else links.forEach((u) => push({ url: u, remote: null, group: 'plan', source: 'plan', own: false, credit: creditOf({}, 'Floor plan from the listing') }));
  // group order; clean before flagged inside a group; otherwise the order of the data
  out.sort((a, b) => RANK[a.group] - RANK[b.group] || a.flagged - b.flagged || a.n - b.n);
  cache.set(L, out);
  return out;
}

/** Photos per group, e.g. { unit: 8, line: 0, building: 22, plan: 1, street: 0 }. */
export function countsOf(items) {
  const c = Object.fromEntries(GROUP_KEYS.map((k) => [k, 0]));
  for (const it of items) c[it.group]++;
  return c;
}

/** The words on a card photo: [{ n: 8, word: 'unit' }, { n: 22, word: 'building' }] (the two largest groups in display
 *  order); a lone group of exact-unit photos reads [{ n: 8, word: 'photos' }]. Floor plans are not photos. */
export function countParts(counts) {
  const parts = [['unit', 'unit'], ['line', 'same line'], ['building', 'building'], ['street', 'street']].filter(([k]) => counts[k] > 0);
  if (!parts.length) return [];
  if (parts.length === 1 && parts[0][0] === 'unit') return [{ n: counts.unit, word: counts.unit === 1 ? 'photo' : 'photos' }];
  const top = parts.length > 2 ? [...parts].sort((a, b) => counts[b[0]] - counts[a[0]]).slice(0, 2).sort((a, b) => parts.indexOf(a) - parts.indexOf(b)) : parts;
  return top.map(([k, word]) => ({ n: counts[k], word }));
}
/** The same as text: "8 unit · 22 building", "8 photos", or '' when there are no photos. */
export const countLabel = (counts) => countParts(counts).map((p) => `${p.n} ${p.word}`).join(' · ');
/** The full breakdown for a tooltip or screen reader: "8 of the unit, 2 of the same line, 22 of the building". */
export function countSentence(counts) {
  const w = { unit: 'of the unit', line: 'of the same line', building: 'of the building', plan: (n) => `floor plan${n === 1 ? '' : 's'}`, street: 'of the street' };
  return GROUP_KEYS.filter((k) => counts[k]).map((k) => (k === 'plan' ? `${counts[k]} ${w.plan(counts[k])}` : `${counts[k]} ${w[k]}`)).join(', ');
}

/** The image a card or the drawer opens with: the first clean exact-unit photo, then same line, then building. */
export const heroOf = (L) => photoItems(L).find((it) => it.group !== 'plan') || null;

/** The `{ own, building }` shape `imagesOf` has always returned, now in display order: own photos by group with
 *  flagged ones last, then licensed building and street photos. */
export function imageLists(L) {
  const items = photoItems(L);
  return {
    own: items.filter((it) => it.own).map((it) => it.url),
    building: items.filter((it) => it.source === 'building').map((it) => ({ ...it.raw, url: it.url })),
  };
}

/** `onerror` attribute value data: the original link of the i-th own photo, when a saved copy may be missing. */
export function ownFallback(L, i = 0) {
  const it = photoItems(L).filter((x) => x.own)[i];
  return it?.remote || null;
}

/** Items of a list limited to a group key ('all' keeps everything). */
export const inGroup = (items, key) => (key === 'all' ? items : items.filter((it) => it.group === key));

/** Tab descriptors for a list of items: only groups that have images, each with its count. */
export function tabsOf(items) {
  const c = countsOf(items);
  return GROUPS.filter((g) => c[g.key] > 0).map((g) => ({ ...g, n: c[g.key] }));
}

/** A one-line caption: "Title · Author · Licence · Source", plain text, for aria-labels and the live region. */
export function captionText(it) {
  const c = it.credit || {};
  return [c.title, c.author, c.license, c.note && c.note !== 'Listing photo, copyright its owner' ? c.note : null, c.source].filter(Boolean).join(' · ');
}
