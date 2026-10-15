// The visit sheet: what the renter fills in standing in a home, built for one hand on a phone. Every control is at least 44 px
// tall, numbers are steppers or short fields with the right keyboard, ratings are rows of five big buttons, the camera and
// "Done" sit in a bar at the bottom where a thumb rests, and each change is saved the moment it is made (this browser, and the
// search folder when `apartmentscout serve` is running). On a desktop it is a panel at the right. The rules (what counts as a
// contradiction, what a promotion does) are in findings-model.js; the storage is findings-store.js.
import { esc, toast } from '../util.js';
import { reducedMotion } from './dom.js';
import * as FS from './findings-store.js';
import {
  normalize, CHECKS, CHECK_KEYS, COMPASS8, LEVELS, LAUNDRY, SMELLS, assess, phrase, parseFeet, fmtFeet, progress, totalArea, roomArea, livePromotions,
} from './findings-model.js';

const ROOM_PRESETS = ['Living room', 'Bedroom', 'Kitchen', 'Bathroom', 'Other'];
const SCALE = {
  water: ['Weak', '', 'OK', '', 'Strong'], noise: ['Silent', '', 'Some', '', 'Loud'], light: ['Dark', '', 'OK', '', 'Bright'],
};
const BARS = (n) => `<svg viewBox="0 0 16 12" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<rect x="${i * 4}" y="${9 - i * 3}" width="3" height="${3 + i * 3}" rx=".8" class="${i < n ? 'on' : ''}"/>`).join('')}</svg>`;
const X = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const CAM = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 5.2a1 1 0 011-1h1.6l1-1.4h3.8l1 1.4H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1z"/><circle cx="8" cy="8.4" r="2.3"/></svg>';
const IMG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.6"/><circle cx="6" cy="6.6" r="1.2"/><path d="M2.6 12l3.6-3.4 2.6 2.4 2-1.8 2.6 2.6"/></svg>';

let root = null, id = null, ctl = null, opener = null, inerted = [], timers = new Map();
const rec = () => FS.get(id) || {};
const num = (v) => (v == null ? '' : String(v));
const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const sub = (path, f, v) => {   // an immutable set of 'a.b.c' inside a record
  const keys = path.split('.'), out = { ...f };
  let cur = out;
  keys.slice(0, -1).forEach((k) => { cur[k] = { ...(cur[k] || {}) }; cur = cur[k]; });
  const last = keys.at(-1);
  if (v == null || v === '') delete cur[last]; else cur[last] = v;
  return out;
};
const set = (path, v) => FS.update(id, (f) => sub(path, f, v));

// ------------------------------------------------------------------ markup
const rate = (path, scale, cur, label) => `<div class="vs-rate" role="group" aria-label="${esc(label)}">${[1, 2, 3, 4, 5].map((n) =>
  `<button type="button" class="vs-chip" data-set="${path}" data-v="${n}" data-k="${path}-${n}" aria-pressed="${cur === n}" aria-label="${esc(label)} ${n} of 5${SCALE[scale][n - 1] ? ', ' + SCALE[scale][n - 1] : ''}"><b>${n}</b><small>${SCALE[scale][n - 1]}</small></button>`).join('')}</div>`;
const step = (path, v, d, unit, label, min = 0) => `<div class="vs-step" role="group" aria-label="${esc(label)}"><button type="button" data-step="${path}" data-d="${-d}" aria-label="Less ${esc(label)}" ${v != null && v <= min ? 'disabled' : ''}>−</button><label><span class="sr">${esc(label)}</span><input type="text" inputmode="decimal" enterkeyhint="done" data-f="${path}" value="${esc(num(v))}" placeholder="–" autocomplete="off"></label><span class="u">${unit}</span><button type="button" data-step="${path}" data-d="${d}" aria-label="More ${esc(label)}">+</button></div>`;

function roomsHTML(f) {
  const rooms = f.rooms || [];
  const total = totalArea(f), L = ctl.listing(id);
  return `<div class="vs-rooms">${rooms.map((r, i) => `<div class="vs-room" data-room="${i}">
      <label class="vs-nm"><span class="sr">Room name</span><input type="text" data-room-f="name" data-i="${i}" value="${esc(r.name)}" maxlength="40" autocomplete="off"></label>
      <div class="vs-dims">${['w', 'l'].map((k) => `<div class="vs-step sm" role="group" aria-label="${k === 'w' ? 'Width' : 'Length'} of ${esc(r.name)}"><button type="button" data-room-step="${i}" data-rf="${k}" data-d="-0.5" aria-label="Less ${k === 'w' ? 'width' : 'length'}">−</button><label><span class="sr">${k === 'w' ? 'Width' : 'Length'} in feet</span><input type="text" inputmode="decimal" enterkeyhint="done" data-room-f="${k}" data-i="${i}" value="${esc(num(r[k]))}" placeholder="${k === 'w' ? 'wide' : 'long'}" autocomplete="off"></label><button type="button" data-room-step="${i}" data-rf="${k}" data-d="0.5" aria-label="More ${k === 'w' ? 'width' : 'length'}">+</button></div>`).join('<i aria-hidden="true">×</i>')}
        <span class="vs-area" data-area="${i}">${roomArea(r) ? `${roomArea(r)} ft²` : 'ft'}</span></div>
      <button type="button" class="vs-rm" data-rm-room="${i}" aria-label="Remove ${esc(r.name)}">${X}</button></div>`).join('')}</div>
    <div class="vs-add" role="group" aria-label="Add a room">${ROOM_PRESETS.map((n) => `<button type="button" class="vs-chip pill" data-add-room="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>
    <p class="vs-hint" id="vsTotal">${total ? `Rooms add up to <b>${total} ft²</b>${L?.sqft ? `; the listing says ${Math.round(L.sqft)} ft² (listings count walls and closets, rooms you measure do not)` : ''}.` : 'Measure wall to wall. Type 11.5 or 11\'6" and use the steppers for half feet.'}</p>`;
}

function checkHTML(key, f) {
  const c = CHECKS[key], L = ctl.listing(id), chk = f.checks?.[key] || {}, a = assess(L, key, chk), listed = a.listed, live = livePromotions(f), isLive = key in live;
  const verdict = chk.verdict, obsOpts = {
    wd: [[true, 'In the unit'], [false, 'Not in the unit']],
    doorman: LEVELS.map((v) => [v, v === 'none' ? 'No doorman' : v === 'full-time' ? 'Full-time' : v === 'part-time' ? 'Part-time' : 'Virtual']),
    exposure: COMPASS8.map((v) => [v, v]),
  }[key];
  let observed = '';
  if (verdict === 'differs') {
    observed = key === 'size'
      ? `<div class="vs-obs"><label class="vs-num"><span>What you found</span><input type="text" inputmode="numeric" enterkeyhint="done" data-check-size="1" data-k="size-obs" value="${esc(num(chk.observed))}" placeholder="ft²" autocomplete="off"><em>ft²</em></label>${totalArea(f) ? `<button type="button" class="vs-chip pill" data-use-total="1">Use rooms total (${totalArea(f)})</button>` : ''}</div>`
      : `<div class="vs-obs"><span class="vs-q">${listed == null ? 'What you saw' : 'What you found'}</span><div class="vs-chips" role="group" aria-label="${esc(c.label)}: what you found">${obsOpts.map(([v, n]) => `<button type="button" class="vs-chip" data-obs="${key}" data-v="${esc(String(v))}" data-k="obs-${key}-${v}" aria-pressed="${chk.observed === v}">${esc(n)}</button>`).join('')}</div></div>`;
  }
  const state = isLive ? 'promoted' : a.kind;
  const note = {
    contradicts: `<p class="vs-flag bad">Differs from the listing (${esc(phrase(key, a.listed))}). It is flagged on the home but does not change its score until you use it as a fact.</p>`,
    adds: '<p class="vs-flag">The listing says nothing about this. Use it as a fact and it counts in the score.</p>',
    matches: verdict === 'differs' ? '<p class="vs-flag ok">That is what the listing says.</p>' : '',
    promoted: `<p class="vs-flag ok">Used as a fact${f.promoted?.[key]?.observed_at ? ` (observed ${esc(f.promoted[key].observed_at)})` : ''}. The score reads ${esc(phrase(key, live[key]))}; the listing still shows ${esc(phrase(key, listed))}.</p>`,
  }[state] || '';
  const act = isLive ? `<button type="button" class="btn" data-unpromote="${key}">Undo: stop using it</button>` : ['contradicts', 'adds'].includes(a.kind) ? `<button type="button" class="btn primary" data-promote="${key}">Use as a fact</button>` : '';
  return `<div class="vs-check" data-check="${key}">
    <div class="vs-ch-h"><b>${esc(c.label)}</b><span>${listed == null ? 'The listing is silent' : `Listing: ${esc(phrase(key, listed))}`}</span></div>
    <div class="vs-chips vs-tri" role="group" aria-label="${esc(c.label)}: does it match?">
      ${listed == null ? '' : `<button type="button" class="vs-chip" data-verdict="${key}" data-v="match" data-k="v-${key}-match" aria-pressed="${verdict === 'match'}">Matches</button>`}
      <button type="button" class="vs-chip" data-verdict="${key}" data-v="differs" data-k="v-${key}-differs" aria-pressed="${verdict === 'differs'}">${listed == null ? 'I saw it' : 'Differs'}</button>
      <button type="button" class="vs-chip" data-verdict="${key}" data-v="unsure" data-k="v-${key}-unsure" aria-pressed="${verdict === 'unsure'}">Not sure</button></div>
    ${observed}${note}${act ? `<div class="vs-act">${act}</div>` : ''}</div>`;
}

function photosHTML(f) {
  const ph = f.photos || [], s = FS.status();
  return `<div class="vs-photos">${ph.map((p) => `<figure class="vs-ph" data-ph="${p.id}"><img alt="${esc(p.caption || 'Photo from the visit')}" data-src-for="${p.id}" width="${p.w || 96}" height="${p.h || 72}"><figcaption><label><span class="sr">Caption</span><input type="text" data-cap="${p.id}" value="${esc(p.caption || '')}" placeholder="Caption" maxlength="120" autocomplete="off"></label></figcaption><button type="button" class="vs-rm" data-rm-photo="${p.id}" aria-label="Delete this photo">${X}</button></figure>`).join('')}</div>
    <p class="vs-hint">${s.server && s.photos ? 'Photos are saved to your search folder as WebP, without location data.' : 'Photos stay in this browser. Open the dashboard with <code>apartmentscout serve</code> to keep them in your search folder.'} They are left out of anything you share unless you tick the photo option.</p>`;
}

function bodyHTML(f) {
  const L = ctl.listing(id), laundry = f.laundry, smells = f.smells || [];
  return `<section class="vs-sec" id="vs-rooms" aria-labelledby="vs-h1"><h3 id="vs-h1">Rooms and ceilings</h3>${roomsHTML(f)}
      <div class="vs-row"><span class="vs-lab">Ceiling height</span>${step('ceiling', f.ceiling, 0.25, 'ft', 'ceiling height in feet', 0)}</div></section>
    <section class="vs-sec" id="vs-home" aria-labelledby="vs-h2"><h3 id="vs-h2">Water, signal, laundry, smells</h3>
      <div class="vs-row"><span class="vs-lab">Water pressure</span>${rate('water', 'water', f.water, 'Water pressure')}</div>
      <div class="vs-row"><span class="vs-lab">Cell signal</span><div class="vs-chips bars" role="group" aria-label="Cell signal bars">${[0, 1, 2, 3, 4].map((n) => `<button type="button" class="vs-chip" data-set="signal" data-v="${n}" data-k="signal-${n}" aria-pressed="${f.signal === n}" aria-label="${n} bars">${BARS(n)}<small>${n}</small></button>`).join('')}</div></div>
      <div class="vs-row"><span class="vs-lab">Closets</span>${step('closets', f.closets, 1, '', 'number of closets', 0)}</div>
      <div class="vs-row"><span class="vs-lab">Laundry</span><div class="vs-chips" role="group" aria-label="Laundry">${LAUNDRY.map(([v, n]) => `<button type="button" class="vs-chip" data-set="laundry" data-v="${v}" data-k="laundry-${v}" aria-pressed="${laundry === v}">${esc(n)}</button>`).join('')}</div></div>
      <div class="vs-row"><span class="vs-lab">Smells</span><div class="vs-chips" role="group" aria-label="Smells">${SMELLS.map(([v, n]) => `<button type="button" class="vs-chip" data-smell="${v}" data-k="smell-${v}" aria-pressed="${smells.includes(v)}">${esc(n)}</button>`).join('')}</div></div></section>
    <section class="vs-sec" id="vs-noise" aria-labelledby="vs-h3"><h3 id="vs-h3">Noise and light</h3>
      <div class="vs-row"><span class="vs-lab">Noise at the window</span>${rate('noise.rating', 'noise', f.noise?.rating, 'Noise at the window')}</div>
      <div class="vs-row"><span class="vs-lab">Meter reading <small>optional</small></span>${step('noise.db', f.noise?.db, 1, 'dB', 'sound level in decibels', 20)}</div>
      <div class="vs-row"><span class="vs-lab">Light right now</span>${rate('light.rating', 'light', f.light?.rating, 'Light in the room')}</div>
      <div class="vs-row"><span class="vs-lab">At what time</span><label class="vs-time"><span class="sr">Time of the light reading</span><input type="time" data-f="light.time" value="${esc(f.light?.time || '')}"></label></div>
      <div class="vs-row"><span class="vs-lab">Window faces <small>compass app, back to the room</small></span><div class="vs-chips compass" role="group" aria-label="Which way the main window faces">${COMPASS8.map((v) => `<button type="button" class="vs-chip" data-set="light.facing" data-v="${v}" data-k="face-${v}" aria-pressed="${f.light?.facing === v}">${v}</button>`).join('')}</div></div>
      <label class="vs-ta"><span class="vs-lab">What the window looks onto</span><textarea rows="2" maxlength="400" data-f="view" placeholder="Brick wall, courtyard tree, river sliver…" enterkeyhint="done">${esc(f.view || '')}</textarea></label></section>
    <section class="vs-sec" id="vs-match" aria-labelledby="vs-h4"><h3 id="vs-h4">Does it match the listing?</h3><p class="vs-hint">Your findings sit beside the listing's facts. Nothing is overwritten.${L ? '' : ''}</p>${CHECK_KEYS.map((k) => checkHTML(k, f)).join('')}</section>
    <section class="vs-sec" id="vs-photos" aria-labelledby="vs-h5"><h3 id="vs-h5">Photos</h3>${photosHTML(f)}</section>
    <section class="vs-sec" id="vs-note" aria-labelledby="vs-h6"><h3 id="vs-h6">Your note</h3><label class="vs-ta"><span class="sr">Free note about this visit</span><textarea rows="4" maxlength="4000" data-f="note" placeholder="Anything else: the super, the neighbours, the hallway, how it felt." enterkeyhint="done">${esc(f.note || '')}</textarea></label>
      <p class="vs-hint">Your note stays out of a shared page unless you tick “Include my notes”.</p></section>`;
}

function statusText() {
  const s = FS.status();
  if (s.phase === 'error') return `Kept in this browser. Not saved to the search folder: ${s.error}`;
  if (s.phase === 'saving') return 'Saving…';
  return s.server ? 'Saved to your search folder' : 'Saved in this browser';
}
function headHTML(f) {
  const L = ctl.listing(id);
  return `<header class="vs-h"><div class="vs-t"><span class="vs-k">Visit notes</span><h2 id="vsT" tabindex="-1">${esc(ctl.label(id))}</h2>
      <p class="vs-sub"><label>Observed <input type="date" data-f="observed" value="${esc(f.observed || today())}" aria-label="Date of the visit"></label><span class="vs-save" id="vsSave" data-phase="${FS.status().phase}">${esc(statusText())}</span></p></div>
    <button type="button" class="vs-x" data-close aria-label="Close visit notes">${X}</button></header>
    <nav class="vs-jump" aria-label="Sections of the visit notes">${[['vs-rooms', 'Rooms'], ['vs-home', 'Home'], ['vs-noise', 'Noise and light'], ['vs-match', 'Matches?'], ['vs-photos', 'Photos'], ['vs-note', 'Note']].map(([h, n]) => `<button type="button" data-jump="${h}">${n}</button>`).join('')}</nav>${L ? '' : ''}`;
}
function barHTML(f) {
  const p = progress(f);
  return `<footer class="vs-bar"><span class="vs-prog" id="vsProg" aria-live="polite"><b>${p.done}</b> of ${p.total} checked${p.photos ? ` · ${p.photos} photo${p.photos === 1 ? '' : 's'}` : ''}</span>
    <label class="btn vs-cam" title="Take a photo"><span class="sr">Take a photo</span>${CAM}<input type="file" accept="image/*" capture="environment" data-photo hidden></label>
    <label class="btn vs-cam" title="Add photos from your library"><span class="sr">Add photos from your library</span>${IMG}<input type="file" accept="image/*" multiple data-photo hidden></label>
    <button type="button" class="btn primary vs-done" data-close>Done</button></footer>`;
}

// ------------------------------------------------------------------ rendering with the focus kept
function remember() {
  const a = document.activeElement;
  if (!root?.contains(a) || !a) return null;
  const k = a.dataset?.k || a.dataset?.f && `f:${a.dataset.f}` || a.dataset?.step && `s:${a.dataset.step}:${a.dataset.d}` || null;
  return k ? { k, start: a.selectionStart, end: a.selectionEnd } : null;
}
function restore(m) {
  if (!m) return;
  const sel = m.k.startsWith('f:') ? `[data-f="${CSS.escape(m.k.slice(2))}"]` : m.k.startsWith('s:') ? `[data-step="${CSS.escape(m.k.split(':')[1])}"][data-d="${CSS.escape(m.k.split(':')[2])}"]` : `[data-k="${CSS.escape(m.k)}"]`;
  const el = root.querySelector(sel);
  if (el) { el.focus({ preventScroll: true }); if (m.start != null && el.setSelectionRange) try { el.setSelectionRange(m.start, m.end); } catch { /* not a text field */ } }
}
async function loadThumbs() {
  for (const img of root.querySelectorAll('img[data-src-for]')) {
    const p = (rec().photos || []).find((x) => x.id === img.dataset.srcFor); if (!p) continue;
    const u = await FS.photoUrl(id, p);
    if (u) img.src = u; else img.closest('.vs-ph')?.classList.add('missing');
  }
}
export function render() {
  if (!root) return;
  const f = rec(), m = remember(), body = root.querySelector('.vs-body'), y = body.scrollTop;
  body.innerHTML = bodyHTML(f);
  root.querySelector('.vs-bar').outerHTML = barHTML(f);
  body.scrollTop = y;
  restore(m);
  loadThumbs();
}
function patchLive() {   // what changes while the renter types, without rebuilding the form
  const f = rec();
  const p = progress(f);
  const prog = root.querySelector('#vsProg'); if (prog) prog.innerHTML = `<b>${p.done}</b> of ${p.total} checked${p.photos ? ` · ${p.photos} photo${p.photos === 1 ? '' : 's'}` : ''}`;
  (f.rooms || []).forEach((r, i) => { const a = root.querySelector(`[data-area="${i}"]`); if (a) a.textContent = roomArea(r) ? `${roomArea(r)} ft²` : 'ft'; });
  const t = root.querySelector('#vsTotal'), total = totalArea(f), L = ctl.listing(id);
  if (t && total) t.innerHTML = `Rooms add up to <b>${total} ft²</b>${L?.sqft ? `; the listing says ${Math.round(L.sqft)} ft² (listings count walls and closets, rooms you measure do not)` : ''}.`;
}
function patchStatus() {
  const s = root?.querySelector('#vsSave'); if (!s) return;
  s.textContent = statusText(); s.dataset.phase = FS.status().phase;
}

// ------------------------------------------------------------------ events
const debounced = (k, fn, ms = 260) => { clearTimeout(timers.get(k)); timers.set(k, setTimeout(() => { timers.delete(k); fn(); }, ms)); };
const parseNum = (s) => { const t = String(s).trim().replace(',', '.'); return t === '' ? null : Number.isFinite(+t) ? +t : undefined; };
function onClick(e) {
  const t = e.target.closest('button, label.vs-cam'); if (!t || !root.contains(t)) return;
  const d = t.dataset;
  if (d.close != null) { close(); return; }
  if (d.jump) { root.querySelector(`#${d.jump}`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start', inline: 'nearest' }); return; }
  if (d.set) { const cur = d.set.split('.').reduce((o, k) => o?.[k], rec()), v = +d.v; set(d.set, cur === v ? null : v); if (d.set === 'light.rating' && !rec().light?.time) set('light.time', new Date().toTimeString().slice(0, 5)); render(); return; }
  if (d.set === undefined && d.smell) {
    const cur = rec().smells || [], v = d.smell;
    let next = cur.includes(v) ? cur.filter((x) => x !== v) : v === 'none' ? ['none'] : [...cur.filter((x) => x !== 'none'), v];
    set('smells', next); render(); return;
  }
  if (d.step) {
    const cur = d.step.split('.').reduce((o, k) => o?.[k], rec()), dd = +d.d;
    if (cur == null && d.step === 'closets' && dd < 0) return;
    let nx = cur == null ? ({ ceiling: 8, 'noise.db': 45, closets: 1 })[d.step] : Math.round((cur + dd) * 100) / 100;
    if (d.step === 'closets') nx = Math.max(0, Math.round(nx));
    set(d.step, d.step !== 'closets' && nx <= (d.step === 'noise.db' ? 20 : 0) ? null : nx); render(); return;
  }
  if (d.addRoom) { set('rooms', [...(rec().rooms || []), { name: d.addRoom }].slice(0, 12)); render(); setTimeout(() => root.querySelector('.vs-room:last-child [data-room-f="w"]')?.focus(), 0); return; }
  if (d.rmRoom != null) { set('rooms', (rec().rooms || []).filter((_, i) => i !== +d.rmRoom)); render(); return; }
  if (d.roomStep != null) { const i = +d.roomStep, rooms = [...(rec().rooms || [])], r = { ...rooms[i] }, base = r[d.rf] ?? 10; r[d.rf] = Math.max(0.5, Math.round((base + +d.d) * 100) / 100); rooms[i] = r; set('rooms', rooms); render(); return; }
  if (d.verdict) { const cur = rec().checks?.[d.verdict]?.verdict; set(`checks.${d.verdict}`, cur === d.v ? null : { verdict: d.v, ...(d.v === 'differs' && rec().checks?.[d.verdict]?.observed != null ? { observed: rec().checks[d.verdict].observed } : {}) }); render(); return; }
  if (d.obs) { const raw = d.v, v = raw === 'true' ? true : raw === 'false' ? false : raw; const cur = rec().checks?.[d.obs]?.observed; set(`checks.${d.obs}`, { verdict: 'differs', ...(cur === v ? {} : { observed: v }) }); dropStale(d.obs); render(); return; }
  if (d.useTotal) { set('checks.size', { verdict: 'differs', observed: totalArea(rec()) }); dropStale('size'); render(); return; }
  if (d.promote) { ctl.promote(id, d.promote); render(); return; }
  if (d.unpromote) { ctl.unpromote(id, d.unpromote); render(); return; }
  if (d.rmPhoto) { const p = (rec().photos || []).find((x) => x.id === d.rmPhoto); if (p) FS.deletePhoto(id, p).then(render, (er) => toast(`Could not delete the photo: ${er.message}`, 4200)); return; }
}
/** A promotion rests on the value the renter found; changing the finding withdraws it (the model also ignores a stale one). */
function dropStale(key) {
  const f = rec(), p = f.promoted?.[key];
  if (p && f.checks?.[key]?.observed !== p.value) FS.update(id, (cur) => { const pr = { ...(cur.promoted || {}) }; delete pr[key]; return { ...cur, promoted: pr }; });
}
function onInput(e) {
  const t = e.target;
  if (t.dataset.f) {
    const path = t.dataset.f, textual = ['view', 'note', 'observed', 'light.time'].includes(path);
    if (textual) { const v = t.value; debounced(path, () => { set(path, v); patchLive(); }); return; }
    const v = path === 'ceiling' ? parseFeet(t.value) : (() => { const n = parseNum(t.value); return n == null ? null : path === 'closets' ? Math.round(n) : n; })();
    if (v === undefined || (t.value.trim() && v == null)) return;   // not a number yet: leave the saved value alone
    debounced(path, () => { set(path, v); patchLive(); });
    return;
  }
  if (t.dataset.roomF) {
    const i = +t.dataset.i, k = t.dataset.roomF, raw = t.value;
    debounced(`room${i}${k}`, () => { const rooms = [...(rec().rooms || [])]; if (!rooms[i]) return; if (k === 'name' && !raw.trim()) return; const v = k === 'name' ? raw : parseFeet(raw); rooms[i] = { ...rooms[i], [k]: v }; set('rooms', rooms); patchLive(); });
    return;
  }
  if (t.dataset.checkSize) { const v = parseNum(t.value); if (v === undefined) return; debounced('size', () => { set('checks.size', { verdict: 'differs', ...(v ? { observed: v } : {}) }); dropStale('size'); render(); }, 450); return; }
  if (t.dataset.cap) { const pid = t.dataset.cap, v = t.value; debounced(`cap${pid}`, () => FS.setCaption(id, pid, v)); }
}
async function onFiles(e) {
  const inp = e.target.closest('input[data-photo]'); if (!inp?.files?.length) return;
  const files = [...inp.files]; inp.value = '';
  const prog = root.querySelector('#vsProg'); let n = 0;
  for (const file of files) {
    if (prog) prog.textContent = `Saving photo ${++n} of ${files.length}…`;
    try { await FS.addPhoto(id, file); } catch (er) { toast(`Could not add that photo: ${er.message}`, 5000); }
  }
  render();
}
function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
  if (e.key !== 'Tab') return;
  const f = [...root.querySelectorAll('button:not([disabled]), input:not([hidden]):not([disabled]), textarea, select, a[href]')].filter((x) => x.offsetParent !== null || x === document.activeElement);
  if (!f.length) return;
  const a = f.indexOf(document.activeElement);
  if (e.shiftKey && a <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && a === f.length - 1) { e.preventDefault(); f[0].focus(); }
}

// ------------------------------------------------------------------ open and close
const offStore = [];
export const isOpen = () => !!root;
export const openFor = () => id;
export function open(listingId, controller) {
  if (root) close(true);
  id = listingId; ctl = controller; opener = document.activeElement;
  root = document.createElement('div');
  root.className = 'vs'; root.id = 'visitSheet'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'vsT');
  const f = rec();
  root.innerHTML = `<div class="vs-scrim" data-close></div><section class="vs-panel">${headHTML(f)}<div class="vs-body">${bodyHTML(f)}</div>${barHTML(f)}</section>`;
  document.body.append(root);
  inerted = [];
  for (const n of document.body.children) if (n !== root && !n.inert && !['SCRIPT', 'STYLE', 'LINK'].includes(n.tagName) && n.id !== 'toast' && !n.classList.contains('trail-ask')) { n.inert = true; inerted.push(n); }
  root.addEventListener('click', onClick); root.addEventListener('input', onInput); root.addEventListener('change', onFiles); root.addEventListener('keydown', onKey);
  root.addEventListener('focusout', (e) => { if (e.target.matches?.('input[data-f], input[data-room-f], textarea')) FS.flush(); });
  offStore.push(FS.onChange((changed) => { if (changed === null || changed === id) patchStatus(); }));
  requestAnimationFrame(() => { root?.classList.add('on'); root?.querySelector('#vsT')?.focus({ preventScroll: true }); });
  loadThumbs();
  document.documentElement.classList.add('vs-open');
}
export function close(quick = false) {
  if (!root) return;
  FS.flush();
  const r = root; root = null; ctl?.closed?.(id); ctl = null;
  offStore.splice(0).forEach((off) => off());
  for (const n of inerted) n.inert = false;
  inerted = [];
  document.documentElement.classList.remove('vs-open');
  const done = () => { r.remove(); if (opener?.isConnected) opener.focus?.({ preventScroll: true }); opener = null; };
  if (quick || reducedMotion()) done(); else { r.classList.remove('on'); setTimeout(done, 200); }
}
