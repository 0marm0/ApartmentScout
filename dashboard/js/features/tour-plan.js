// Tour-day planner, at the top of Shortlist > Tours: pick a day, a start time and where you set off from, and the saved
// picks (grouped by building, Pass left out) become a timeline you can reorder by dragging. It shows when to leave for each
// stop, the hop between stops (walk or transit, labelled as an estimate), the viewing and a buffer per stop, flags a booked
// time you would miss, and exports the day as an .ics file (one event per stop, with the address) or as text to paste.
// The maths is in tour-model.js; booked times are the tour times already set on the Tours board.
import { S, on, store, byId, dest, cost, setPick, openDrawer, label } from '../app.js';
import { $, esc, money, toast, ICONS } from '../util.js';
import { watch } from './dom.js';
import { groupKey } from '../views/table-kit.js';
import { DEFAULTS, toMin, fmtMin, clock12, bookedMin, stationAccess, autoOrder, reconcile, moveStop, buildTimeline, toICS, planText } from './tour-model.js';

const GRIP = '<svg viewBox="0 0 12 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="3" r="1.3"/><circle cx="8.5" cy="3" r="1.3"/><circle cx="3.5" cy="8" r="1.3"/><circle cx="8.5" cy="8" r="1.3"/><circle cx="3.5" cy="13" r="1.3"/><circle cx="8.5" cy="13" r="1.3"/></svg>';
const UP = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg>';
const DOWN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
const CAL = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.8v2.6M10.5 1.8v2.6M8 9v3M6.5 10.5h3"/></svg>';
const COPY = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 5.5v-2a1.2 1.2 0 00-1.2-1.2H3.7A1.2 1.2 0 002.5 3.5v5.6a1.2 1.2 0 001.2 1.2h1.8"/></svg>';

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); return localDay(d); };
const dayLong = (day) => { const d = new Date(day + 'T12:00:00'); return isNaN(d) ? day : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); };
const hm = (m) => { const h = Math.floor(m / 60), r = Math.round(m % 60); return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`; };

let st = null, host = null, drag = null, dirty = true;
const key = () => `tourplan:${S.crit0?.search?.name || S.base}`;
const save = () => store.set(key(), { day: st.day, start: st.start, visit: st.visit, buffer: st.buffer, defaultVisit: st.defaultVisit, defaultBuffer: st.defaultBuffer, order: st.order, modes: st.modes, from: st.from });

// ------------------------------------------------------------------ the stops
/** Saved picks (not Pass) with a location, grouped by building: the planner's stops. */
function stops() {
  const m = new Map(), dn = dest()?.name;
  for (const [id, p] of Object.entries(S.picks)) {
    const L = byId(id);
    if (!L || !(p.saved || p.tier) || p.tier === 'Pass' || L.lat == null || L.lon == null) continue;
    const k = groupKey(L);
    const s = m.get(k) || m.set(k, { key: k, name: L.building || L.address || id, address: L.address || '', lat: L.lat, lon: L.lon, access: stationAccess(L.commute?.[dn]) ?? undefined, units: [], L }).get(k);
    s.units.push({ id, label: L.unit || label(L), price: cost(L), tour: p.tour || null, tier: p.tier || null });
  }
  return [...m.values()];
}
const origin = () => {
  const D = dest();
  return st.from === 'dest' && D?.lat != null ? { name: D.name, lat: D.lat, lon: D.lon, address: D.address, access: DEFAULTS.startAccess } : null;
};
const opts = () => ({ ...DEFAULTS, visit: st.defaultVisit, buffer: st.defaultBuffer });
const plan = () => ({ start: st.start, day: st.day, from: origin(), visit: st.visit, buffer: st.buffer, modes: st.modes, defaultBuffer: st.defaultBuffer });
function compute() {
  const S0 = stops();
  st.order = reconcile(st.order, S0);
  return { S0, tl: buildTimeline(S0, st.order, plan(), opts()) };
}

// ------------------------------------------------------------------ state
function initState() {
  const saved = store.get(key(), null) || {}, today = localDay();
  const booked = Object.values(S.picks).map((p) => String(p.tour || '').slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today).sort();
  st = {
    day: saved.day && saved.day >= today ? saved.day : booked[0] || addDays(today, 1),
    start: toMin(saved.start) != null ? saved.start : DEFAULTS.start,
    defaultVisit: Number.isFinite(+saved.defaultVisit) ? +saved.defaultVisit : DEFAULTS.visit,
    defaultBuffer: Number.isFinite(+saved.defaultBuffer) ? +saved.defaultBuffer : DEFAULTS.buffer,
    visit: saved.visit || {}, buffer: saved.buffer || {}, modes: saved.modes || {}, order: saved.order || [], from: saved.from === 'first' ? 'first' : 'dest',
  };
  if (!st.order.length) { const S0 = stops(); st.order = autoOrder(S0, { start: origin(), day: st.day }, opts()); }
}

// ------------------------------------------------------------------ markup
const stepper = (k, v, min, max, step, unit = 'min', lab = '') => `<span class="tp2-step" data-step="${k}" role="group" aria-label="${esc(lab)}"><button type="button" data-d="-${step}" aria-label="Less ${esc(lab)}" ${v <= min ? 'disabled' : ''}>−</button><output>${v}<small>${unit}</small></output><button type="button" data-d="${step}" aria-label="More ${esc(lab)}" ${v >= max ? 'disabled' : ''}>+</button></span>`;

function stripHTML(tl) {
  if (!tl.entries.length) return '';
  const t0 = tl.begin, t1 = tl.entries.at(-1).depart, span = Math.max(30, t1 - t0), segs = [];
  const push = (cls, a, b, title) => { if (b > a) segs.push(`<i class="${cls}" style="flex:${(b - a).toFixed(1)}" title="${esc(title)}"></i>`); };
  let cur = t0;
  tl.entries.forEach((e) => {
    push('sg-gap', cur, e.leaveBy, 'Free time'); cur = Math.max(cur, e.leaveBy);
    push(e.leg.kind === 'transit' ? 'sg-transit' : 'sg-walk', cur, e.arrive, `${e.leg.kind === 'transit' ? 'Transit' : 'Walk'} ${e.leg.min} min (estimate)`); cur = Math.max(cur, e.arrive);
    push('sg-wait', cur, e.start, `Wait ${e.wait} min`); cur = Math.max(cur, e.start);
    push(`sg-view${e.late ? ' sg-late' : ''}`, cur, e.end, `${e.stop.name}: ${e.visit} min viewing`); cur = e.end;
    push('sg-buf', cur, e.depart, `Buffer ${e.buffer} min`); cur = e.depart;
  });
  const ticks = []; for (let h = Math.ceil(t0 / 60); h * 60 < t1; h++) ticks.push(`<span style="left:${(((h * 60 - t0) / span) * 100).toFixed(2)}%">${clock12(h * 60).replace(':00', '')}</span>`);
  return `<div class="tp2-strip-wrap"><div class="tp2-strip" role="img" aria-label="The day from ${clock12(t0)} to ${clock12(tl.finish)}: ${tl.entries.length} viewings">${segs.join('')}</div><div class="tp2-ticks" aria-hidden="true">${ticks.join('')}</div>
    <div class="tp2-legend" aria-hidden="true"><span><i class="sg-view"></i>Viewing</span><span><i class="sg-walk"></i>Walk</span><span><i class="sg-transit"></i>Transit</span><span><i class="sg-buf"></i>Buffer</span><span><i class="sg-wait"></i>Waiting for a booking</span></div></div>`;
}
function legHTML(e) {
  if (e.leg.kind === 'none') return '';
  const icon = e.leg.kind === 'transit' ? ICONS.train : ICONS.walk, other = e.leg.kind === 'transit' ? e.leg.walk : e.leg.transit;
  const mode = st.modes[e.key] || 'auto', otherLab = e.leg.kind === 'transit' ? `walking would take ${other} min` : other != null ? `transit would take about ${other} min` : '';
  return `<div class="tp2-leg"><span class="tp2-t"></span><span class="tp2-rail"></span><div class="tp2-lg"><button type="button" class="tp2-mode ${mode !== 'auto' ? 'fixed' : ''}" data-act="mode" title="${esc(`${e.leg.kind === 'transit' ? 'Transit' : 'Walk'} estimate${otherLab ? ': ' + otherLab : ''}. Click to switch between automatic, walking and transit.`)}">${icon}<b>${e.leg.min} min</b> ${e.leg.kind === 'transit' ? 'by transit' : 'on foot'}<em>est.${mode !== 'auto' ? ', fixed' : ''}</em></button>
    <span class="tp2-lv">${e.booked != null ? `Leave by <b>${clock12(e.leaveBy)}</b>` : `Leave <b>${clock12(e.leaveBy)}</b>`}${e.leaveFrom?.name ? ` <span>from ${esc(e.leaveFrom.name)}</span>` : ''}</span></div></div>`;
}
function itemHTML(e, i, n) {
  const s = e.stop, status = e.late ? `<span class="tp2-chip bad" role="status">Late by ${e.late} min for the booked time</span>` : e.booked != null ? `<span class="tp2-chip ${e.wait ? 'warn' : 'good'}">${e.wait ? `Arrive ${e.wait} min early, wait` : 'On time'} · booked ${clock12(e.booked)}</span>` : '';
  const units = s.units.map((u) => `${esc(u.label)}${u.price != null ? ` <span class="faint">${money(u.price)}</span>` : ''}`).join(' · ');
  return `<li class="tp2-item" data-key="${esc(s.key)}">${legHTML(e)}
    <div class="tp2-stop"><span class="tp2-t"><b>${clock12(e.start)}</b><small>to ${clock12(e.end)}</small></span><span class="tp2-rail"><i class="tp2-dot">${i + 1}</i></span>
      <div class="tp2-card"><header><button type="button" class="tp2-grip" aria-label="Move ${esc(s.name)}: drag, or press the up and down arrow keys" title="Drag to reorder">${GRIP}</button>
        <div class="tp2-nm"><button type="button" class="tp2-open" data-act="open" data-id="${esc(s.units[0].id)}">${esc(s.name)}</button><span>${esc(s.address)}</span><span class="tp2-un">${units}</span></div>
        <div class="tp2-mv"><button type="button" data-act="up" aria-label="Move ${esc(s.name)} earlier" ${i === 0 ? 'disabled' : ''}>${UP}</button><button type="button" data-act="down" aria-label="Move ${esc(s.name)} later" ${i === n - 1 ? 'disabled' : ''}>${DOWN}</button></div></header>
        <div class="tp2-opts"><label><span>Viewing</span>${stepper('v:' + s.key, e.visit, 5, 120, 5, 'min', `viewing time at ${s.name}`)}</label><label><span>Buffer after</span>${stepper('b:' + s.key, e.buffer, 0, 60, 5, 'min', `buffer after ${s.name}`)}</label>
          <label class="tp2-bk"><span>Booked</span><input type="time" data-booked="${esc(s.key)}" value="${e.booked != null ? fmtMin(e.booked) : ''}" aria-label="Booked time at ${esc(s.name)} on ${esc(dayLong(st.day))}"></label>${status}</div></div></div></li>`;
}
function bodyHTML() {
  const { S0, tl } = compute(), n = tl.entries.length;
  if (!S0.length) return `<div class="tp2-empty"><b>No stops yet</b><span>Save homes you have not passed on, with a location, and they appear here ready to schedule.</span></div>`;
  const from = origin();
  return `<div class="tp2-sum"><div><b>${n}</b><span>stop${n === 1 ? '' : 's'}</span></div><div><b>${hm(tl.finish - tl.begin)}</b><span>${clock12(tl.begin)} to ${clock12(tl.finish)}</span></div><div><b>${hm(tl.walk + tl.transit)}</b><span>travelling, estimated</span></div><div><b>${hm(tl.viewing)}</b><span>viewing</span></div>${tl.lateStops ? `<div class="bad"><b>${tl.lateStops}</b><span>booking${tl.lateStops === 1 ? '' : 's'} you would miss</span></div>` : ''}</div>
    ${stripHTML(tl)}
    <ol class="tp2-list" aria-label="Stops in visiting order">${from ? `<li class="tp2-from"><span class="tp2-t"><b>${clock12(toMin(st.start))}</b></span><span class="tp2-rail"><i class="tp2-dot start"></i></span><div class="tp2-sp"><b>Set off from ${esc(from.name)}</b></div></li>` : ''}${tl.entries.map((e, i) => itemHTML(e, i, n)).join('')}
      <li class="tp2-end"><span class="tp2-t"><b>${clock12(tl.finish)}</b></span><span class="tp2-rail"><i class="tp2-dot end"></i></span><div class="tp2-sp"><b>Last viewing ends</b></div></li></ol>`;
}
function shellHTML() {
  const D = dest();
  return `<div class="tp2-h"><div><h3>Tour day planner</h3><p>Plan the day: when to leave, how long each hop takes, and a buffer after each viewing. Travel times are estimates.</p></div>
      <div class="tp2-acts"><button type="button" class="btn sm" data-act="ics" aria-label="Add to calendar (.ics file)" title="One calendar event per stop, with the address">${CAL}<span>Add to calendar (.ics)</span></button><button type="button" class="btn sm" data-act="copy" aria-label="Copy the plan as text" title="Copy the plan as text">${COPY}<span>Copy plan</span></button></div></div>
    <div class="tp2-ctl"><label><span>Day</span><input type="date" data-f="day" value="${esc(st.day)}"></label><label><span>Start</span><input type="time" data-f="start" value="${esc(st.start)}"></label>
      <label><span>Set off from</span><select class="sel" data-f="from"><option value="dest" ${st.from === 'dest' ? 'selected' : ''} ${D?.lat == null ? 'disabled' : ''}>${esc(D?.name || 'Your destination')}</option><option value="first" ${st.from === 'first' ? 'selected' : ''}>The first stop</option></select></label>
      <label><span>Viewing</span><span data-slot="defaultVisit"></span></label><label><span>Buffer</span><span data-slot="defaultBuffer"></span></label>
      <div class="seg tp2-ord" role="group" aria-label="Order the stops"><button type="button" data-act="order" data-how="near">Shortest walk</button><button type="button" data-act="order" data-how="time">By booked time</button></div></div>
    <div class="tp2-body" id="tp2Body"></div>
    <p class="tp2-note">Walking is straight-line distance × 1.25 at 4.8 km/h. Transit is estimated from the walk to the station in each home's commute route, a ${DEFAULTS.transitWait} min wait and a straight-line ride at ${DEFAULTS.rideKmh} km/h; the subway router does not run in the browser, so these are not schedules. Booked times come from the Tour field on each pick. Confirm every showing with the leasing office.</p>`;
}
function paintControls() {
  host.querySelector('[data-slot=defaultVisit]').innerHTML = stepper('defaultVisit', st.defaultVisit, 5, 120, 5, 'min', 'default viewing time');
  host.querySelector('[data-slot=defaultBuffer]').innerHTML = stepper('defaultBuffer', st.defaultBuffer, 0, 60, 5, 'min', 'default buffer');
}
function render() {
  if (!host) return;
  dirty = false;
  const refocus = focusSelector(host.contains(document.activeElement) ? document.activeElement : null);
  host.querySelector('#tp2Body').innerHTML = bodyHTML();
  paintControls();
  const empty = !stops().length;
  host.querySelectorAll('[data-act=ics], [data-act=copy]').forEach((b) => { b.disabled = empty; });
  host.querySelectorAll('.tp2-ord button').forEach((b) => { b.disabled = empty; });
  if (refocus) (host.querySelector(refocus) || host.querySelector(refocus.replace(/ \[data-d="[^"]*"\]$/, '')))?.focus({ preventScroll: true });
}
/** A selector that finds the focused control again after the timeline is redrawn. */
function focusSelector(el) {
  if (!el || el.closest('.tp2-ctl')) return null;
  const step = el.closest('[data-step]'), item = el.closest('[data-key]'), q = (v) => `"${CSS.escape(v)}"`;
  const within = item ? `[data-key=${q(item.dataset.key)}] ` : '';
  if (step && el.dataset.d) return `${within}[data-step=${q(step.dataset.step)}] [data-d=${q(el.dataset.d)}]`;
  if (el.dataset.booked != null) return `${within}[data-booked=${q(el.dataset.booked)}]`;
  if (el.classList.contains('tp2-grip')) return `${within}.tp2-grip`;
  if (el.dataset.act) return `${within}[data-act=${q(el.dataset.act)}]`;
  return null;
}

// ------------------------------------------------------------------ actions
function setOrder(order) { st.order = order; save(); render(); }
function stepValue(k, d) {
  const map = { defaultVisit: ['defaultVisit', 5, 120], defaultBuffer: ['defaultBuffer', 0, 60] };
  if (map[k]) { const [f, lo, hi] = map[k]; st[f] = Math.max(lo, Math.min(hi, st[f] + d)); }
  else { const [kind, sk] = [k[0], k.slice(2)], { S0 } = compute(), s = S0.find((x) => x.key === sk); if (!s) return; const cur = kind === 'v' ? st.visit[sk] ?? st.defaultVisit + Math.max(0, s.units.length - 1) * DEFAULTS.extraUnit : st.buffer[sk] ?? st.defaultBuffer;
    (kind === 'v' ? st.visit : st.buffer)[sk] = Math.max(kind === 'v' ? 5 : 0, Math.min(kind === 'v' ? 120 : 60, cur + d)); }
  save(); render();
}
function setBooked(skey, value) {
  const s = stops().find((x) => x.key === skey); if (!s) return;
  const onDay = s.units.filter((u) => String(u.tour || '').startsWith(st.day));
  if (!value) { for (const u of onDay) setPick(u.id, { tour: null, saved: true }); return; }
  const t = `${st.day}T${value}`;
  if (onDay.length) onDay.forEach((u, i) => { if (i === 0) setPick(u.id, { tour: t, saved: true }); }); else setPick(s.units[0].id, { tour: t, saved: true });
}
function planMeta() { return { day: st.day, fromName: origin()?.name || null, calName: `Apartment tours, ${dayLong(st.day)}`, now: new Date() }; }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* clipboard blocked: fall back to a hidden textarea */ }
  const ta = Object.assign(document.createElement('textarea'), { value: text }); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0'; document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* nothing else to try */ } ta.remove(); return ok;
}
function onClick(e) {
  const b = e.target.closest('[data-act], [data-d]'); if (!b) return;
  const li = b.closest('.tp2-item'), skey = li?.dataset.key, act = b.dataset.act;
  if (b.dataset.d) { stepValue(b.closest('[data-step]').dataset.step, +b.dataset.d); return; }
  const order = st.order, i = order.indexOf(skey);
  if (act === 'up' || act === 'down') setOrder(moveStop(order, i, i + (act === 'up' ? -1 : 1)));
  else if (act === 'open') openDrawer(b.dataset.id, { fly: true });
  else if (act === 'mode') { const cur = st.modes[skey] || 'auto'; st.modes[skey] = { auto: 'walk', walk: 'transit', transit: 'auto' }[cur]; if (st.modes[skey] === 'auto') delete st.modes[skey]; save(); render(); }
  else if (act === 'order') { const { S0 } = compute(); setOrder(autoOrder(S0, { start: origin(), day: st.day, mode: b.dataset.how }, opts())); toast(b.dataset.how === 'near' ? 'Ordered for the shortest walk, booked homes first' : 'Ordered by booked time'); }
  else if (act === 'ics') { const { tl } = compute(); if (!tl.entries.length) return; download(`tour-plan-${st.day}.ics`, toICS(tl, planMeta())); toast(`Calendar file saved: ${tl.entries.length} event${tl.entries.length === 1 ? '' : 's'} on ${dayLong(st.day)}`); }
  else if (act === 'copy') { const { tl } = compute(); copyText(planText(tl, planMeta())).then((ok) => toast(ok ? 'Plan copied: paste it into a message' : 'Could not copy: select the plan and copy it by hand')); }
}
function download(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function onChange(e) {
  const t = e.target;
  if (t.dataset.f === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(t.value)) { st.day = t.value; const { S0 } = compute(); st.order = autoOrder(S0, { start: origin(), day: st.day }, opts()); save(); render(); }
  else if (t.dataset.f === 'start' && toMin(t.value) != null) { st.start = t.value; save(); render(); }
  else if (t.dataset.f === 'from') { st.from = t.value === 'first' ? 'first' : 'dest'; save(); render(); }
  else if (t.dataset.booked != null) setBooked(t.dataset.booked, t.value);
}
function onKey(e) {
  const g = e.target.closest('.tp2-grip'); if (!g || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
  const skey = g.closest('.tp2-item').dataset.key, i = st.order.indexOf(skey);
  e.preventDefault(); setOrder(moveStop(st.order, i, i + (e.key === 'ArrowUp' ? -1 : 1)));
}

// ------------------------------------------------------------------ dragging a stop
function startDrag(e) {
  const grip = e.target.closest('.tp2-grip'); if (!grip || e.button > 0) return;
  const list = host.querySelector('.tp2-list'), items = [...list.querySelectorAll('.tp2-item')], li = grip.closest('.tp2-item'), from = items.indexOf(li);
  e.preventDefault(); grip.setPointerCapture(e.pointerId);
  const rects = items.map((x) => x.getBoundingClientRect()), mids = rects.map((r) => r.top + r.height / 2);
  drag = { id: e.pointerId, grip, li, items, from, to: from, y0: e.clientY, h: rects[from].height, mids };
  li.classList.add('dragging'); list.classList.add('is-dragging');
}
function moveDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const dy = e.clientY - drag.y0, c = drag.mids[drag.from] + dy;
  drag.li.style.transform = `translateY(${dy}px)`;
  let to = drag.from;
  drag.mids.forEach((m, i) => { if (i < drag.from && c < m) to = Math.min(to, i); if (i > drag.from && c > m) to = Math.max(to, i); });
  drag.to = to;
  drag.items.forEach((x, i) => {
    if (x === drag.li) return;
    const shift = to < drag.from && i >= to && i < drag.from ? drag.h : to > drag.from && i <= to && i > drag.from ? -drag.h : 0;
    x.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  d.items.forEach((x) => { x.style.transform = ''; x.classList.remove('dragging'); }); host.querySelector('.tp2-list')?.classList.remove('is-dragging');
  if (d.to !== d.from) setOrder(moveStop(st.order, d.from, d.to)); else d.grip.focus({ preventScroll: true });
}

// ------------------------------------------------------------------ mount
function mount() {
  const body = $('trBody'); if (!body || body.previousElementSibling?.id === 'tourPlanner') return;
  host = document.createElement('section');
  host.id = 'tourPlanner'; host.className = 'panel tp2 no-print'; host.setAttribute('aria-label', 'Tour day planner');
  host.innerHTML = shellHTML();
  body.before(host);
  host.addEventListener('click', onClick); host.addEventListener('change', onChange); host.addEventListener('keydown', onKey);
  host.addEventListener('pointerdown', startDrag); host.addEventListener('pointermove', moveDrag); host.addEventListener('pointerup', endDrag); host.addEventListener('pointercancel', endDrag);
  render();
}

export function init() {
  initState();
  const v = $('view-tours'); if (!v) return;
  watch(v, mount);
  const refresh = () => { if (host?.isConnected) { if (S.view === 'tours' && !drag) render(); else dirty = true; } };
  on('saved', refresh); on('commute', refresh); on('criteria', refresh);
  addEventListener('hashchange', () => { if (dirty && S.view === 'tours') requestAnimationFrame(render); });
}
export const state = () => ({ ...st, stops: stops().map((s) => s.key) });
