// Gone fast: what rented and how quickly. The lesson first ("good units at your budget go in N days"), then the
// days-on-market distribution and the list of units with their last price.
import { S, openDrawer, tierIndex, TIER_VARS, store } from '../app.js';
import { esc, money } from '../util.js';
import { R, goneRows, goneLesson, fmtDate } from './model.js';
import { empty, noteHTML, IC } from './ui.js';

const st = { budget: !!store.get('research-gone-budget', false), sort: 'fast', shown: 60 };
const BUCKETS = [[0, 2, '0–2'], [3, 7, '3–7'], [8, 14, '8–14'], [15, 30, '15–30'], [31, 60, '31–60'], [61, Infinity, '60+']];
const d1 = (v) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));

function lessonHTML(ls) {
  if (ls.median == null) return `<div class="panel rs-lesson"><div class="label">The lesson</div><p class="rs-lesson-t">Not enough dates yet to say how fast units go.</p><p class="faint rs-small">Each unit needs the day it was listed and the day it went off the market.</p></div>`;
  const med = Math.round(ls.median);
  return `<div class="panel rs-lesson">
    <div class="label">The lesson <span>${ls.n} unit${ls.n > 1 ? 's' : ''} with both dates</span></div>
    <p class="rs-lesson-t">${esc(ls.who)} go in <b>${med} day${med === 1 ? '' : 's'}</b>.</p>
    <p class="rs-lesson-s">That is the median. The middle half went in ${d1(Math.round(ls.p25))}–${d1(Math.round(ls.p75))} days, and ${ls.within7} of ${ls.n} went within a week. When a match appears, ask for a viewing the same day and have your documents ready.</p>
    ${ls.unknown ? `<p class="faint rs-small">${ls.unknown} more unit${ls.unknown > 1 ? 's' : ''} went without a known listing date and are left out of the timing.</p>` : ''}
  </div>`;
}

function distHTML(rows, ls) {
  const known = rows.filter((r) => r.days != null);
  const B = BUCKETS.map(([lo, hi, t]) => { const inB = known.filter((r) => r.days >= lo && r.days <= hi); return { t, n: inB.length, k: inB.filter((r) => ls.set.has(r.id)).length }; });
  const max = Math.max(1, ...B.map((b) => b.n));
  const who = ls.who.toLowerCase();
  return `<div class="panel rs-dist"><div class="label">Days on market <span>${known.length} units</span></div>
    <div class="rs-hist" role="img" aria-label="Days on market: ${B.map((b) => `${b.t} days ${b.n} units`).join(', ')}">${B.map((b) => `<div class="rs-hb"><span class="rs-hn tnum">${b.n || ''}</span><div class="rs-hcol" style="height:${(b.n / max) * 100}%"><i style="height:${b.n ? (b.k / b.n) * 100 : 0}%"></i></div><span class="rs-ht">${b.t}</span></div>`).join('')}</div>
    <div class="legend-row"><span><i class="sw" style="background:var(--tier-1)"></i>${esc(ls.who)}</span><span><i class="sw" style="background:var(--surface-3);box-shadow:inset 0 0 0 1px var(--line-strong)"></i>Other units</span><span>days from listed to off the market</span></div>
    <span class="sr">${esc(who)} are highlighted.</span></div>`;
}

function rowHTML(r, max) {
  const L = r.L, t = L ? tierIndex(L) : -1;
  const w = r.days == null ? 0 : Math.max(3, Math.min(100, (r.days / max) * 100));
  return `<li class="gf-row${L ? '' : ' nolink'}">
    ${L ? `<button type="button" class="gf-t" data-open="${esc(r.id)}">${esc(L.building || L.address || r.id)} <span>${esc(L.unit || '')}</span></button>` : `<span class="gf-t mono">${esc(r.id)}</span>`}
    <span class="gf-n faint">${esc(L?.neighborhood || (L ? '' : 'not in listings'))}</span>
    <span class="gf-dates tnum">${r.listed ? esc(fmtDate(r.listed)) : '?'} → ${esc(fmtDate(r.gone))}</span>
    <span class="gf-days"><i class="gf-bar"><i style="width:${w}%"></i></i><b class="tnum">${r.days == null ? '?' : r.days}</b><span class="faint">${r.days === 1 ? 'day' : 'days'}</span></span>
    <span class="gf-p tnum"><b>${esc(money(r.price))}</b></span>
    <span class="gf-tier">${L?.score?.budget_tier ? `<span class="tierpill" style="color:var(${t >= 0 ? TIER_VARS[t] : '--tier-over'})"><i></i>${esc(L.score.budget_tier)}</span>` : r.atBudget === false ? '<span class="tierpill" style="color:var(--tier-over)"><i></i>Over</span>' : ''}</span>
  </li>`;
}

export function render(el) {
  if (!R.hist) {
    const n = S.listings.filter((L) => L.status === 'gone').length;
    el.innerHTML = empty(IC.clock, 'No rental timing yet', `Gone fast needs the day each unit was listed and the day it went off the market, from the change history.${n ? ` ${n} of your listings are marked gone, but without those dates there is no timing to learn from.` : ''}`, 'apartmentscout build');
    return;
  }
  const rows = goneRows();
  if (!rows.length) { el.innerHTML = empty(IC.clock, 'Nothing has gone yet', `Units that rent or come off the market appear here with how long they lasted.${R.hist.note ? ' ' + noteHTML(R.hist.note) : ''}`); return; }
  const ls = goneLesson(rows);
  const V = rows.filter((r) => !st.budget || r.atBudget).sort(st.sort === 'fast' ? (a, b) => (a.days ?? 1e9) - (b.days ?? 1e9) : st.sort === 'recent' ? (a, b) => String(b.gone).localeCompare(String(a.gone)) : (a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));
  const max = Math.min(60, Math.max(7, ...rows.map((r) => r.days ?? 0)));
  el.innerHTML = `<div class="rs-gone-top">${lessonHTML(ls)}${distHTML(rows, ls)}</div>
    <div class="rs-bar-row">
      <div class="chips" role="group" aria-label="Filter"><button type="button" class="chip ${st.budget ? 'on' : ''}" id="gfBudget" aria-pressed="${st.budget}">At your budget<span class="n">${rows.filter((r) => r.atBudget).length}</span></button></div>
      <span class="sp"></span>
      <div class="seg" role="group" aria-label="Order">${[['fast', 'Fastest'], ['recent', 'Most recent'], ['price', 'Lowest price']].map(([k, t]) => `<button type="button" data-s="${k}" class="${st.sort === k ? 'on' : ''}" aria-pressed="${st.sort === k}">${t}</button>`).join('')}</div>
    </div>
    <div class="panel flush"><div class="gf-head" aria-hidden="true"><span>Unit</span><span>Area</span><span>Listed → gone</span><span>Days on market</span><span>Last price</span><span>Budget</span></div>
      <ul class="gf-list">${V.slice(0, st.shown).map((r) => rowHTML(r, max)).join('')}</ul>
      ${V.length > st.shown ? `<button type="button" class="btn ghost more-btn rs-more-btn" id="gfMore">Show ${Math.min(60, V.length - st.shown)} more of ${V.length - st.shown}</button>` : ''}</div>`;
  el.querySelector('#gfBudget').addEventListener('click', () => { st.budget = !st.budget; store.set('research-gone-budget', st.budget); render(el); el.querySelector('#gfBudget')?.focus(); });
  el.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { st.sort = b.dataset.s; render(el); el.querySelector(`[data-s="${b.dataset.s}"]`)?.focus(); }));
  el.querySelector('#gfMore')?.addEventListener('click', () => { st.shown += 60; render(el); });
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.open)));
}
