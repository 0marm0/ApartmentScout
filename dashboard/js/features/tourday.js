// Tour day: a full-screen mode for the renter's phone. Today's tours in order (time, address, one-tap directions, the hop to the next
// stop), a checklist for each home built from the renter's criteria and the listing's unknowns (big tap targets, a photo, a note, a
// 10-second noise check with the microphone), and a summary card per home for comparing later. Answers go to the tour findings the
// visit sheet uses (findings-store.js: this browser at once, the search folder when the local API is there, queued until it is
// reachable again); the ones the findings schema has no field for are kept here and written into the note under a marker. The rules
// are in tourday-model.js; opening it is in tourday-entry.js.
import { S, on, store, byId, dest, label, cost, reloaders } from '../app.js';
import { esc, toast, money } from '../util.js';
import { reducedMotion } from './dom.js';
import * as FS from './findings-store.js';
import { assess, livePromotions, listedValue, CHECK_KEYS, CHECKS } from './findings-model.js';
import { pristine, openVisit } from './tour-findings.js';
import * as M from './tourday-model.js';
import * as Noise from './tourday-noise.js';

const ICON = {
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>',
  go: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 8h9M8.5 4l4 4-4 4"/></svg>',
  nav: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M14 2L2 7.4l5 1.6 1.6 5z"/></svg>',
  img: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.6"/><circle cx="6" cy="6.6" r="1.2"/><path d="M2.6 12l3.6-3.4 2.6 2.4 2-1.8 2.6 2.6"/></svg>',
  cam: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 5.2a1 1 0 011-1h1.6l1-1.4h3.8l1 1.4H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1z"/><circle cx="8" cy="8.4" r="2.3"/></svg>',
  mic: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5.5" y="1.8" width="5" height="8" rx="2.5"/><path d="M3.2 7.6a4.8 4.8 0 009.6 0M8 12.4v2"/></svg>',
  up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg>',
  down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>',
  copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 5.5v-2a1.2 1.2 0 00-1.2-1.2H3.7A1.2 1.2 0 002.5 3.5v5.6a1.2 1.2 0 001.2 1.2h1.8"/></svg>',
};
const BARS = (n) => `<svg viewBox="0 0 16 12" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<rect x="${i * 4}" y="${9 - i * 3}" width="3" height="${3 + i * 3}" rx=".8" class="${i < n ? 'on' : ''}"/>`).join('')}</svg>`;

let root = null, st = null, view = 'route', curId = null, depth = 0, opener = null, inerted = [], meas = null, reading = null, adding = false, timer = null;
const offs = [], pending = new Map();
const key = () => `tourday:${S.crit0?.search?.name || S.base}`;
const save = () => store.set(key(), st);
const rec = (id) => FS.get(id) || {};
const exOf = (id) => st.ex[id] || {};
const crit = () => ({ ...S.crit, weights: S.weights });
const checklist = (id) => M.buildChecklist(pristine(byId(id)), crit());
const apple = () => M.isApple(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
const dayLong = (day) => { const d = new Date(day + 'T12:00:00'); return isNaN(d) ? day : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); };
const nameOf = (id) => { const L = byId(id); return L ? label(L) : id; };
const isDone = (id) => st.done[id] === st.day;

// ------------------------------------------------------------------ the day's route
function route() {
  const booked = M.toursOn(S.picks, st.day, byId), ids = M.routeIds(st, booked).filter((id) => byId(id));
  const stops = ids.map((id) => M.stopOf(byId(id), S.picks[id], S.crit, dest()?.name));
  const order = M.routeOrder(stops, st);
  return { booked, entries: M.routeLegs(stops, order, st.day) };
}
const nextAfter = (id) => {
  const e = route().entries, i = e.findIndex((x) => x.stop.id === id);
  return e.slice(i + 1).find((x) => !isDone(x.stop.id)) || e.slice(i + 1)[0] || null;
};
function setOrder(order) { st.order = order; save(); render(); }

// ------------------------------------------------------------------ writing answers
/** The findings note with the generated block rebuilt from the extras; the renter's own text is left as it is. */
function withBlock(f, c, ex) {
  const { text } = M.splitNote(f.note), note = M.joinNote(text, M.noteBlock(c, ex)), o = { ...f };
  if (note) o.note = note; else delete o.note;
  return o;
}
function answer(id, itemKey, value) {
  const c = checklist(id), item = M.allItems(c).find((i) => i.key === itemKey); if (!item) return;
  const L = pristine(byId(id));
  if (['light', 'facing', 'water', 'signal', 'closets', 'wd'].includes(itemKey)) { FS.update(id, (f) => M.applyToFindings(f, itemKey, value, { L })); return; }
  let ex = exOf(id);
  if (itemKey === 'noise_shut' || itemKey === 'noise_open') ex = M.setExtra(ex, 'noise', item.meter, { r: value });
  else if (item.kind === 'yn') ex = M.setExtra(ex, 'yn', itemKey, value);
  else if (item.kind === 'ask') ex = M.setExtra(ex, 'ask', itemKey.slice(4), value ? true : null);
  st.ex = { ...st.ex, [id]: ex }; if (!Object.keys(ex).length) delete st.ex[id];
  save();
  FS.update(id, (f) => withBlock(M.applyToFindings(f, itemKey, value, { L, ex }), c, ex));
}
function saveNote(id, text) {
  FS.update(id, (f) => { const { block } = M.splitNote(f.note), note = M.joinNote(text, block), o = { ...f }; if (note) o.note = note; else delete o.note; return o; });
}
const debounced = (k, fn, ms = 300) => { clearTimeout(pending.get(k)?.t); pending.set(k, { fn, t: setTimeout(() => { pending.delete(k); fn(); }, ms) }); };
function runPending() { for (const [k, p] of [...pending]) { clearTimeout(p.t); pending.delete(k); p.fn(); } }

// ------------------------------------------------------------------ markup: pieces
/** Which of Yes / No is pressed: a W/D answer that matched the listing is whatever the listing says. */
const pressedYN = (item, id) => {
  const v = M.valueOf(item, rec(id), exOf(id));
  return item.key === 'wd' && v === 'match' ? listedValue(pristine(byId(id)), 'wd') : v;
};
const answered = (item, id) => (item.kind === 'ask' ? !!exOf(id).ask?.[item.key.slice(4)] : M.valueOf(item, rec(id), exOf(id)) != null);
const opt = (k, v, pressed, inner, extra = '') => `<button type="button" class="tday-opt ${extra}" data-ans="${esc(k)}" data-v="${esc(String(v))}" data-k="${esc(k)}-${esc(String(v))}" aria-pressed="${pressed}">${inner}</button>`;

function controlHTML(item, id) {
  const f = rec(id), ex = exOf(id), v = M.valueOf(item, f, ex), name = esc(item.label);
  if (item.kind === 'rate') {
    return `<div class="tday-rate" role="group" aria-label="${name}">${[1, 2, 3, 4, 5].map((n) => opt(item.key, n, v === n, `<b>${n}</b><small>${esc(item.scale[n - 1])}</small>`)).join('')}</div>${item.meter ? meterHTML(item, id) : ''}`;
  }
  if (item.kind === 'bars') return `<div class="tday-rate" role="group" aria-label="${name}">${[0, 1, 2, 3, 4].map((n) => opt(item.key, n, v === n, `${BARS(n)}<small>${n}</small>`, 'bars')).join('')}</div>`;
  if (item.kind === 'compass') return `<div class="tday-compass" role="group" aria-label="${name}">${M.COMPASS8.map((d) => opt(item.key, d, v === d, `<b>${d}</b>`)).join('')}</div>`;
  if (item.kind === 'count') {
    return `<div class="tday-count" role="group" aria-label="${name}"><button type="button" data-count="${item.key}" data-d="-1" aria-label="Fewer" ${v === 0 ? 'disabled' : ''}>−</button><output aria-live="polite">${v == null ? '–' : v}</output><button type="button" data-count="${item.key}" data-d="1" aria-label="More">+</button></div>`;
  }
  if (item.kind === 'yn') {
    const p = pressedYN(item, id);
    return `<div class="tday-yn" role="group" aria-label="${name}">${opt(item.key, true, p === true, esc(item.yes || 'Yes'), 'yes')}${opt(item.key, false, p === false, esc(item.no || 'No'), 'no')}</div>`;
  }
  return `<button type="button" class="tday-ask" data-ans="${esc(item.key)}" data-v="${v ? 'false' : 'true'}" data-k="${esc(item.key)}" aria-pressed="${!!v}"><i>${ICON.check}</i><span>${v ? 'Asked' : 'Mark as asked'}</span></button>`;
}
function meterHTML(item, id) {
  const w = item.meter, n = exOf(id).noise?.[w], on = meas && meas.id === id && meas.which === w;
  const lastLine = reading && reading.id === id && reading.which === w
    ? `<p class="tday-reading" role="status">About <b>${reading.leq} dB</b>, ${M.noiseWord(reading.leq)}. Peak ${reading.peak} dB, quietest ${reading.quiet} dB. <em>Approximate.</em></p>`
    : n?.db != null ? `<p class="tday-reading">Last check: about <b>${n.db} dB</b>, ${M.noiseWord(n.db)}. <em>Approximate.</em></p>` : '';
  return `<div class="tday-meter" data-meter="${w}">${on
    ? `<div class="tday-meter-on" role="status"><div class="tday-bar"><i style="width:${Math.round((meas.elapsed / M.MIC_SECONDS) * 100)}%"></i></div><span><b data-meter-t>${Math.max(0, Math.ceil(M.MIC_SECONDS - meas.elapsed))}</b> s · about <b data-meter-db>${meas.level == null ? '–' : Math.round(meas.level)}</b> dB</span><button type="button" class="tday-btn" data-stop-meter>Stop</button></div>`
    : `<button type="button" class="tday-btn mic" data-meter-go="${w}" ${meas ? 'disabled' : ''}>${ICON.mic}<span>Measure 10 s</span></button>`}${lastLine}
    ${w === 'shut' ? '<p class="tday-fine">Asks for the microphone only when you tap. Nothing is recorded or sent. Phone microphones are not calibrated: use it to compare homes, not as a meter.</p>' : ''}</div>`;
}
function questionHTML(item, id) {
  return `<section class="tday-q" data-item="${esc(item.key)}" aria-label="${esc(item.label)}"><header><h3>${esc(item.label)}</h3>${answered(item, id) ? `<span class="tday-tick" role="img" aria-label="Answered">${ICON.check}</span>` : ''}</header>
    ${item.hint ? `<p class="tday-hint">${esc(item.hint)}</p>` : ''}${item.why ? `<p class="tday-why">${esc(item.why)}</p>` : ''}${controlHTML(item, id)}</section>`;
}

function syncHTML() {
  const pend = FS.pending().length, off = typeof navigator.onLine === 'boolean' && !navigator.onLine;
  if (FS.apiExpected()) {
    if (pend) return `<span class="tday-sync warn" role="status"><i></i>${pend} home${pend === 1 ? '' : 's'} waiting to sync${off ? ' (offline)' : ''}</span><button type="button" class="tday-link" data-sync>Sync now</button>`;
    return `<span class="tday-sync ok" role="status"><i></i>Saved to your search folder</span>`;
  }
  return `<span class="tday-sync ${off ? 'warn' : 'ok'}" role="status"><i></i>${off ? 'Offline: kept on this phone' : 'Saved on this phone'}</span>`;
}

// ------------------------------------------------------------------ the route screen
function directionsLink(entry, cls = 'tday-btn dir') {
  const s = entry.stop, url = M.directionsUrl(s, { kind: entry.hop?.kind === 'transit' ? 'transit' : 'walk', apple: apple() });
  return url ? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-directions>${ICON.nav}<span>Directions</span></a>` : '';
}
function routeHTML(entries) {
  const n = entries.length;
  const items = entries.map((e, i) => {
    const id = e.stop.id, c = checklist(id), p = M.progress(c, rec(id), exOf(id)), nxt = entries[i + 1];
    const photos = rec(id).photos?.length || 0;
    return `<li class="tday-stop${isDone(id) ? ' done' : ''}" data-id="${esc(id)}">
      <article class="tday-card"><div class="tday-n" aria-hidden="true">${isDone(id) ? ICON.check : i + 1}</div>
        <div class="tday-main"><p class="tday-time">${e.booked != null ? `<b>${M.clock12(e.booked)}</b>` : '<b class="faint">No time set</b>'}${e.hop && e.leaveBy != null ? ` <span>leave by ${M.clock12(e.leaveBy)}</span>` : ''}</p>
          <h3>${esc(nameOf(id))}</h3><p class="tday-addr">${esc(e.stop.address)}</p>
          <p class="tday-prog"><b>${p.done}</b> of ${p.total} checked${photos ? ` · ${photos} photo${photos === 1 ? '' : 's'}` : ''}${isDone(id) ? ' · done' : ''}</p></div>
        <div class="tday-acts">${directionsLink(e)}<button type="button" class="tday-btn primary" data-open="${esc(id)}">${isDone(id) ? 'Review' : p.done ? 'Continue' : 'Open checklist'}${ICON.go}</button></div>
        <div class="tday-mv"><button type="button" data-up="${esc(id)}" aria-label="Move ${esc(nameOf(id))} earlier" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button><button type="button" data-down="${esc(id)}" aria-label="Move ${esc(nameOf(id))} later" ${i === n - 1 ? 'disabled' : ''}>${ICON.down}</button><button type="button" data-drop="${esc(id)}" aria-label="Take ${esc(nameOf(id))} off today's route">${ICON.x}</button></div></article>
      ${nxt?.hop ? `<p class="tday-hop"><span aria-hidden="true">↓</span> ${esc(M.hopText(nxt.hop))} to ${esc(nameOf(nxt.stop.id))} <em>(estimate)</em></p>` : ''}</li>`;
  }).join('');
  const room = M.addable(S.picks, entries.map((e) => e.stop.id), byId).filter((id) => byId(id).lat != null || byId(id).address);
  const addList = adding ? `<ul class="tday-add" aria-label="Add a home to today">${room.slice(0, 40).map((id) => `<li><button type="button" data-add="${esc(id)}"><b>${esc(nameOf(id))}</b><small>${esc(byId(id).address || '')}</small></button></li>`).join('') || '<li class="tday-fine">Save a home or book a tour on the Tours board, and it appears here.</li>'}</ul>` : '';
  return `${n ? `<div class="tday-seg" role="group" aria-label="Order of the stops"><button type="button" data-mode="time" aria-pressed="${st.mode === 'time'}">By time</button><button type="button" data-mode="near" aria-pressed="${st.mode === 'near'}">Shortest walk</button></div>
      <ol class="tday-route" aria-label="Stops in visiting order">${items}</ol>`
    : `<div class="tday-empty"><h3>No tours booked for today</h3><p>Book a time on the Tours board and it shows up here, or pick the homes you are visiting.</p></div>`}
    <button type="button" class="tday-btn wide" data-adding aria-expanded="${adding}">${adding ? 'Hide the list' : n ? 'Add a home to today' : 'Pick the homes you are visiting'}</button>${addList}
    <p class="tday-fine">Walk and transit times are straight-line estimates, not schedules. Directions open in your maps app.</p>`;
}
function routeHead(entries) {
  const n = entries.length, f = entries.find((e) => e.booked != null);
  return `<div class="tday-t"><span class="tday-k">Tour day</span><h2 id="tdT" tabindex="-1">${esc(dayLong(st.day))}</h2><p>${n} home${n === 1 ? '' : 's'} today${f ? ` · first at ${M.clock12(f.booked)}` : ''}</p></div>`;
}

// ------------------------------------------------------------------ the checklist screen
function unitHead(id, entries) {
  const L = byId(id), p = M.progress(checklist(id), rec(id), exOf(id));
  const e = entries.find((x) => x.stop.id === id) || { stop: M.stopOf(L, S.picks[id], S.crit, dest()?.name), hop: null };
  const link = directionsLink(e, 'tday-btn dir sm');
  return `<div class="tday-t"><span class="tday-k">Checklist</span><h2 id="tdT" tabindex="-1">${esc(nameOf(id))}</h2><p>${esc(L?.address || '')}</p>
    <div class="tday-status">${syncHTML()}</div>
    <div class="tday-prog-bar" role="progressbar" aria-label="Questions answered" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done}"><i style="width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%"></i></div>
    <div class="tday-row"><p class="tday-prog" id="tdProg"><b>${p.done}</b> of ${p.total} checked</p>${link}</div></div>`;
}
function photosHTML(id) {
  const ph = rec(id).photos || [];
  return `<div class="tday-photos">${ph.map((p) => `<figure data-ph="${p.id}"><img alt="${esc(p.caption || 'Photo from the visit')}" data-src-for="${p.id}" width="${p.w || 96}" height="${p.h || 72}"><button type="button" data-rm-photo="${p.id}" aria-label="Delete this photo">${ICON.x}</button></figure>`).join('')}</div>`;
}
function unitHTML(id) {
  const c = checklist(id), f = rec(id), text = M.splitNote(f.note).text;
  const sec = (title, arr) => (arr.length ? `<h3 class="tday-sec">${title}</h3>${arr.map((i) => questionHTML(i, id)).join('')}` : '');
  return `${sec('Right here', c.core)}${sec('The listing does not say', c.unknowns)}${sec('Ask the leasing office', c.asks)}
    <h3 class="tday-sec">Photos and a note</h3>
    <section class="tday-q" aria-label="Photos">${photosHTML(id)}<p class="tday-fine">${FS.status().server && FS.status().photos ? 'Photos are saved to your search folder as WebP, without location data.' : 'Photos stay on this phone until your search folder is reachable.'} They are left out of anything you share unless you tick the photo option.</p></section>
    <section class="tday-q" aria-label="Note"><label><span class="sr">Note about this home</span><textarea rows="4" maxlength="3000" data-note placeholder="The super, the hallway, the neighbours, how it felt." enterkeyhint="done">${esc(text)}</textarea></label></section>`;
}
function unitBar(id, e) {
  const i = e.findIndex((x) => x.stop.id === id);
  return `<label class="tday-btn cam" title="Take a photo">${ICON.cam}<span>Photo</span><input type="file" accept="image/*" capture="environment" data-photo hidden></label>
    <label class="tday-btn cam ghost" title="Add photos from your library">${ICON.img}<span class="sr">Add photos from your library</span><input type="file" accept="image/*" multiple data-photo hidden></label>
    <button type="button" class="tday-btn primary grow" data-finish="${esc(id)}">${i >= 0 && i === e.length - 1 ? 'Finish last home' : 'Finish this home'}${ICON.go}</button>`;
}

// ------------------------------------------------------------------ summary cards
function cardHTML(id, { compact = false } = {}) {
  const L = byId(id); if (!L) return '';
  const P = pristine(L), f = rec(id), ex = exOf(id), c = checklist(id), chips = M.summaryChips(P, f, ex, c), open = M.openQuestions(c, f, ex);
  const flagged = CHECK_KEYS.filter((k) => assess(P, k, f.checks?.[k]).kind === 'contradicts' && !(k in livePromotions(f)));
  const note = M.splitNote(f.note).text, photos = f.photos || [];
  const score = L.score?.overall != null ? Math.round(L.score.overall) : null;
  return `<article class="tday-sum" data-sum="${esc(id)}"><header><div><h3>${esc(label(L))}</h3><p>${esc(L.address || '')}</p></div>
      <div class="tday-sc">${cost(L) != null ? `<b>${money(cost(L))}</b><small>/mo</small>` : ''}${score != null ? `<span class="tday-score" title="Score">${score}</span>` : ''}</div></header>
    ${flagged.length ? `<p class="tday-flag" role="status">Differs from the listing: ${flagged.map((k) => esc(CHECKS[k].label.toLowerCase())).join(', ')}. It is flagged on the home and does not change its score until you use it as a fact.</p>` : ''}
    ${chips.length ? `<dl class="tday-chips">${chips.map((x) => `<div class="${x.tone}"><dt>${esc(x.k)}</dt><dd>${esc(x.v)}</dd></div>`).join('')}</dl>` : '<p class="tday-fine">Nothing checked yet.</p>'}
    ${photos.length ? `<div class="tday-thumbs">${photos.slice(0, 4).map((p) => `<img data-sum-img="${p.id}" data-sum-home="${esc(id)}" alt="${esc(p.caption || 'Photo from the visit')}">`).join('')}${photos.length > 4 ? `<span>+${photos.length - 4}</span>` : ''}</div>` : ''}
    ${note ? `<p class="tday-note">${esc(note.length > 220 ? note.slice(0, 219) + '…' : note)}</p>` : ''}
    ${open.length && !compact ? `<p class="tday-open"><b>Still to find out:</b> ${open.map(esc).join('; ')}</p>` : ''}
    <div class="tday-acts"><button type="button" class="tday-btn" data-copy-sum="${esc(id)}">${ICON.copy}<span>Copy</span></button><button type="button" class="tday-btn" data-visit="${esc(id)}">Full visit notes</button>${compact ? `<button type="button" class="tday-btn" data-open="${esc(id)}">Checklist</button>` : ''}</div></article>`;
}
function summaryHTML(id) {
  const nx = nextAfter(id);
  return `${cardHTML(id)}
    ${nx ? `<section class="tday-next" aria-label="Next stop"><p class="tday-k">Next stop</p><h3>${esc(nameOf(nx.stop.id))}</h3><p>${nx.booked != null ? `${M.clock12(nx.booked)} · ` : ''}${esc(nx.stop.address)}${nx.hop ? ` · ${esc(M.hopText(nx.hop))} (estimate)` : ''}</p>
      <div class="tday-acts">${directionsLink({ ...nx, hop: nx.hop })}<button type="button" class="tday-btn primary" data-open="${esc(nx.stop.id)}">Open checklist${ICON.go}</button></div></section>`
    : `<section class="tday-next"><h3>That was the last stop</h3><p>Your answers are saved. The summaries stay here for comparing homes.</p></section>`}
    <button type="button" class="tday-btn wide" data-all>All summaries</button>`;
}
function allIds() {
  const today = route().entries.map((e) => e.stop.id), seen = new Set(today);
  const rest = [...new Set([...Object.keys(FS.all()), ...Object.keys(st.ex)])].filter((id) => !seen.has(id) && byId(id));
  rest.sort((a, b) => (rec(b).updated || '').localeCompare(rec(a).updated || ''));
  return [...today, ...rest].filter((id) => M.progress(checklist(id), rec(id), exOf(id)).done > 0 || (rec(id).photos || []).length);
}
function allHTML() {
  const ids = allIds();
  return ids.length ? `<div class="tday-acts"><button type="button" class="tday-btn" data-copy-all>${ICON.copy}<span>Copy all summaries</span></button></div>${ids.map((id) => cardHTML(id, { compact: true })).join('')}`
    : `<div class="tday-empty"><h3>No visits yet</h3><p>Answer a few questions on the checklist and each home gets a card here, ready to compare.</p></div>`;
}
const summaryTextOf = (id) => {
  const L = byId(id), P = pristine(L), f = rec(id), ex = exOf(id), c = checklist(id);
  return M.summaryText(label(L), M.summaryChips(P, f, ex, c), { note: M.splitNote(f.note).text, photos: (f.photos || []).length, open: M.openQuestions(c, f, ex) });
};

// ------------------------------------------------------------------ rendering with the focus kept
function remember() {
  const a = document.activeElement;
  if (!root?.contains(a) || !a) return null;
  const k = a.dataset?.k || (a.dataset?.count && `c:${a.dataset.count}:${a.dataset.d}`) || null;
  return k ? { k } : null;
}
function restore(m) {
  if (!m) return;
  const sel = m.k.startsWith('c:') ? `[data-count="${CSS.escape(m.k.split(':')[1])}"][data-d="${CSS.escape(m.k.split(':')[2])}"]` : `[data-k="${CSS.escape(m.k)}"]`;
  root.querySelector(sel)?.focus({ preventScroll: true });
}
async function loadThumbs() {
  for (const img of root?.querySelectorAll('img[data-src-for]') || []) {
    const p = (rec(curId).photos || []).find((x) => x.id === img.dataset.srcFor); if (!p) continue;
    const u = await FS.photoUrl(curId, p); if (u) img.src = u;
  }
  for (const img of root?.querySelectorAll('img[data-sum-img]') || []) {
    const id = img.dataset.sumHome, p = (rec(id).photos || []).find((x) => x.id === img.dataset.sumImg); if (!p) continue;
    const u = await FS.photoUrl(id, p); if (u) img.src = u;
  }
}
export function render() {
  if (!root) return;
  const body = root.querySelector('.tday-body'), y = body.scrollTop, m = remember(), same = root.dataset.view === view && root.dataset.id === String(curId);
  if (view === 'unit' && !byId(curId)) view = 'route';
  const head = root.querySelector('.tday-head'), bar = root.querySelector('.tday-bar-f'), entries = route().entries;
  const back = view !== 'route';
  head.innerHTML = `<button type="button" class="tday-x" data-back aria-label="${back ? 'Back' : 'Close Tour day'}">${back ? ICON.back : ICON.x}</button>
    ${view === 'unit' ? unitHead(curId, entries) : view === 'route' ? routeHead(entries) : `<div class="tday-t"><span class="tday-k">Tour day</span><h2 id="tdT" tabindex="-1">${view === 'all' ? 'All summaries' : 'After the visit'}</h2>${view === 'summary' ? `<p>${esc(nameOf(curId))}</p>` : ''}</div>`}`;
  body.innerHTML = view === 'unit' ? unitHTML(curId) : view === 'summary' ? summaryHTML(curId) : view === 'all' ? allHTML() : routeHTML(entries);
  bar.innerHTML = view === 'unit' ? unitBar(curId, entries) : `<div class="tday-status">${syncHTML()}</div>${view === 'route' ? '<button type="button" class="tday-btn" data-all>Summaries</button>' : ''}<button type="button" class="tday-btn primary" data-close>${view === 'route' ? 'Done for today' : 'Close'}</button>`;
  bar.classList.toggle('unit', view === 'unit');
  root.dataset.view = view; root.dataset.id = String(curId);
  body.scrollTop = same ? y : 0;
  if (!same) root.querySelector('#tdT')?.focus({ preventScroll: true });
  restore(m);
  loadThumbs();
}
function patchProgress() {
  const p = M.progress(checklist(curId), rec(curId), exOf(curId));
  const t = root.querySelector('#tdProg'); if (t) t.innerHTML = `<b>${p.done}</b> of ${p.total} checked`;
  const b = root.querySelector('.tday-prog-bar'); if (b) { b.setAttribute('aria-valuenow', p.done); b.firstElementChild.style.width = `${p.total ? Math.round((p.done / p.total) * 100) : 0}%`; }
}
function paintSync() { root?.querySelectorAll('.tday-status').forEach((s) => { s.innerHTML = syncHTML(); }); }
function paintMeter() {
  if (!root || !meas) return;
  const w = root.querySelector(`[data-meter="${meas.which}"]`); if (!w) return;
  const t = w.querySelector('[data-meter-t]'), d = w.querySelector('[data-meter-db]'), b = w.querySelector('.tday-bar i');
  if (t) t.textContent = String(Math.max(0, Math.ceil(M.MIC_SECONDS - meas.elapsed)));
  if (d && meas.level != null) d.textContent = String(Math.round(meas.level));
  if (b) b.style.width = `${Math.round((meas.elapsed / M.MIC_SECONDS) * 100)}%`;
}

// ------------------------------------------------------------------ the noise check
async function runMeter(which) {
  const id = curId; if (meas || !id) return;
  if (!Noise.supported()) { toast('This browser cannot use the microphone on this page', 4200); return; }
  const ctrl = new AbortController();
  meas = { id, which, ctrl, elapsed: 0, level: null }; reading = null; render();
  try {
    const r = await Noise.measure({ signal: ctrl.signal, onTick: ({ elapsed, level }) => { if (meas) { meas.elapsed = elapsed; meas.level = level; paintMeter(); } } });
    meas = null;
    if (r) {
      reading = { id, which, ...r };
      const c = checklist(id), item = c.core.find((i) => i.meter === which), had = exOf(id).noise?.[which]?.r;
      const ex = M.setExtra(exOf(id), 'noise', which, { db: r.leq, ...(had == null ? { r: M.suggestRating(r.leq) } : {}) });
      st.ex = { ...st.ex, [id]: ex }; save();
      FS.update(id, (f) => withBlock(M.applyToFindings(f, item.key, null, { L: pristine(byId(id)), ex }), c, ex));
    }
  } catch (e) { meas = null; if (e.kind !== 'aborted') toast(e.message || 'The noise check did not work', 5200); }
  if (root) render();
}
function stopMeter() { meas?.ctrl.abort(); }

// ------------------------------------------------------------------ events
const parse = (item, raw) => (['rate', 'bars', 'count'].includes(item.kind) ? Number(raw) : item.kind === 'yn' || item.kind === 'ask' ? raw === 'true' : raw);
function onClick(e) {
  const t = e.target.closest('button, label.tday-btn, a[data-directions]'); if (!t || !root.contains(t)) return;
  const d = t.dataset;
  if (d.back != null) { back(); return; }
  if (d.close != null) { close(); return; }
  if (d.ans) {
    const id = curId, item = M.allItems(checklist(id)).find((i) => i.key === d.ans); if (!item) return;
    const v = parse(item, d.v), cur = item.kind === 'yn' ? pressedYN(item, id) : item.kind === 'ask' ? null : M.valueOf(item, rec(id), exOf(id));
    answer(id, d.ans, cur === v && item.kind !== 'ask' ? null : v); return;
  }
  if (d.count) {
    const id = curId, item = M.allItems(checklist(id)).find((i) => i.key === d.count), cur = M.valueOf(item, rec(id), exOf(id));
    answer(id, d.count, Math.max(0, Math.min(30, (cur ?? 0) + Number(d.d)))); return;
  }
  if (d.meterGo) { runMeter(d.meterGo); return; }
  if (d.stopMeter != null) { stopMeter(); return; }
  if (d.open) { go('unit', d.open); return; }
  if (d.finish) { st.done = { ...st.done, [d.finish]: st.day }; save(); runPending(); FS.flush(); go('summary', d.finish); return; }
  if (d.all != null) { go('all'); return; }
  if (d.mode) { st.mode = d.mode; st.order = []; save(); render(); return; }
  if (d.up || d.down) {
    const id = d.up || d.down, order = route().entries.map((x) => x.stop.id), i = order.indexOf(id);
    setOrder(M.moveStop(order, i, i + (d.up ? -1 : 1))); return;
  }
  if (d.drop) { const id = d.drop; st.removed = [...new Set([...st.removed, id])]; st.picked = st.picked.filter((x) => x !== id); st.order = st.order.filter((x) => x !== id); save(); render(); toast('Taken off today\'s route', 2600); return; }
  if (d.adding != null) { adding = !adding; render(); return; }
  if (d.add) { st.picked = [...new Set([...st.picked, d.add])]; st.removed = st.removed.filter((x) => x !== d.add); st.order = []; adding = false; save(); render(); return; }
  if (d.sync != null) { toast('Trying the search folder…', 1800); resync(true); return; }
  if (d.rmPhoto) { const p = (rec(curId).photos || []).find((x) => x.id === d.rmPhoto); if (p) FS.deletePhoto(curId, p).then(render, (er) => toast(`Could not delete the photo: ${er.message}`, 4200)); return; }
  if (d.copySum) { copy(summaryTextOf(d.copySum)); return; }
  if (d.copyAll != null) { copy(allIds().map(summaryTextOf).join('\n\n')); return; }
  if (d.visit) { openVisit(d.visit); }
}
async function copy(text) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* blocked: fall back */ }
  if (!ok) { const ta = Object.assign(document.createElement('textarea'), { value: text }); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0'; document.body.append(ta); ta.select(); try { ok = document.execCommand('copy'); } catch { /* nothing else to try */ } ta.remove(); }
  toast(ok ? 'Copied: paste it into a message or a note' : 'Could not copy', 2600);
}
function onInput(e) {
  const t = e.target;
  if (t.matches?.('textarea[data-note]')) { const id = curId, v = t.value; debounced('note', () => saveNote(id, v)); }
}
async function onFiles(e) {
  const inp = e.target.closest('input[data-photo]'); if (!inp?.files?.length) return;
  const files = [...inp.files], id = curId; inp.value = '';
  for (const file of files) { try { await FS.addPhoto(id, file); } catch (er) { toast(`Could not add that photo: ${er.message}`, 5000); } }
  if (root) render();
}
/** Escape steps back, wherever the focus is (a redraw can leave it on the page); the visit sheet, when open, has its own Escape. */
function onDocKey(e) {
  if (e.key !== 'Escape' || !root || document.getElementById('visitSheet') || e.defaultPrevented) return;
  e.preventDefault(); back();
}
function onKey(e) {
  if (e.key !== 'Tab') return;
  const f = [...root.querySelectorAll('button:not([disabled]), input:not([hidden]):not([disabled]), textarea, a[href]')].filter((x) => x.offsetParent !== null || x === document.activeElement);
  if (!f.length) return;
  const a = f.indexOf(document.activeElement);
  if (e.shiftKey && a <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && a === f.length - 1) { e.preventDefault(); f[0].focus(); }
}

// ------------------------------------------------------------------ navigation: the phone's back button steps back, it does not leave the app
function go(v, id = null) {
  runPending();
  if (meas) stopMeter();
  depth += 1; view = v; if (id) curId = id; reading = null;
  try { history.pushState({ tday: v, id: curId, d: depth }, ''); } catch { /* no history here */ }
  render();
}
function back() {
  if (depth > 1) { try { history.back(); return; } catch { /* fall through */ } view = 'route'; depth = 1; render(); return; }
  close();
}
function onPop() {
  if (!root) return;
  const s = history.state;
  if (s && s.tday) {
    runPending(); if (meas) stopMeter();
    depth = s.d || 1; view = s.tday; curId = s.id || curId; reading = null; render();
    requestAnimationFrame(() => { if (root && !root.contains(document.activeElement)) root.querySelector('#tdT')?.focus({ preventScroll: true }); });   // a history step can drop the focus
    return;
  }
  teardown();
}
async function resync(manual = false) {
  try { await FS.resync(); } catch { /* still offline */ }
  if (root) paintSync();
  if (manual && root) toast(FS.pending().length ? 'Still waiting: your search folder cannot be reached' : 'Everything is in your search folder', 2800);
}

// ------------------------------------------------------------------ open and close
export const isOpen = () => !!root;
export function open({ view: v = 'route', id = null } = {}) {
  if (root) return;
  st = M.normalizeState(store.get(key(), null), M.localDay());
  view = v === 'unit' && id && byId(id) ? 'unit' : 'route'; curId = id; depth = 1; adding = false; meas = null; reading = null; opener = document.activeElement;
  root = document.createElement('div');
  root.className = 'tday'; root.id = 'tourDay'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'tdT');
  root.innerHTML = '<section class="tday-panel"><header class="tday-head"></header><div class="tday-body"></div><footer class="tday-bar-f"></footer></section>';
  document.body.append(root);
  inerted = [];
  for (const n of document.body.children) if (n !== root && !n.inert && !['SCRIPT', 'STYLE', 'LINK'].includes(n.tagName) && n.id !== 'toast' && !n.classList.contains('trail-ask')) { n.inert = true; inerted.push(n); }
  root.addEventListener('click', onClick); root.addEventListener('input', onInput); root.addEventListener('change', onFiles); root.addEventListener('keydown', onKey);
  root.addEventListener('focusout', (e) => { if (e.target.matches?.('textarea')) { runPending(); FS.flush(); } });
  try { history.pushState({ tday: view, id: curId, d: 1 }, ''); } catch { /* no history here */ }
  addEventListener('popstate', onPop); document.addEventListener('keydown', onDocKey);
  offs.push(FS.onChange((changed) => { if (!root) return; if (changed == null) paintSync(); else renderSoon(); }));
  const tick = () => { if (FS.pending().length) resync(); else paintSync(); };
  addEventListener('online', tick); addEventListener('offline', paintSync);
  offs.push(() => { removeEventListener('online', tick); removeEventListener('offline', paintSync); });
  timer = setInterval(tick, 15000);
  render();
  requestAnimationFrame(() => root?.classList.add('on'));
  document.documentElement.classList.add('tday-open');
  tick();
}
let soon = false;
/** Redraw after a change, once, and never under the renter's fingers while they type a note. */
function renderSoon() {
  if (soon) return;
  soon = true;
  queueMicrotask(() => {
    soon = false;
    if (!root) return;
    if (document.activeElement?.matches?.('textarea') && root.contains(document.activeElement)) { if (view === 'unit') patchProgress(); paintSync(); return; }
    render();
  });
}
on('saved', () => { if (root && view === 'route') renderSoon(); });
reloaders.tourday = () => { if (!root) return; st = M.normalizeState(store.get(key(), null), M.localDay()); renderSoon(); };   // the sync layer wrote the checklist while it is open
export function close() {
  if (!root) return;
  runPending(); FS.flush();
  if (meas) stopMeter();
  if (depth > 0) {
    const n = depth; depth = 0;
    try { history.go(-n); setTimeout(() => { if (root) teardown(); }, 500); return; } catch { /* fall through */ }
  }
  teardown();
}
function teardown() {
  if (!root) return;
  runPending(); FS.flush();
  removeEventListener('popstate', onPop); document.removeEventListener('keydown', onDocKey); clearInterval(timer);
  offs.splice(0).forEach((off) => off());
  const r = root; root = null; depth = 0;
  for (const n of inerted) n.inert = false;
  inerted = [];
  document.documentElement.classList.remove('tday-open');
  const done = () => { r.remove(); if (opener?.isConnected) opener.focus?.({ preventScroll: true }); opener = null; };
  if (reducedMotion()) done(); else { r.classList.remove('on'); setTimeout(done, 200); }
  document.dispatchEvent(new CustomEvent('tourday:closed'));
}
export const state = () => ({ view, id: curId, depth, st });
