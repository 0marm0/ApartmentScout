// "Why did this move?": the screen part. A quiet "↓40 since Oct 13" note on the result cards of homes whose rank moved a lot, a
// "Why it moved" section in the drawer listing the dimensions that moved it and why, and a rail section that picks the run to
// compare with and filters or sorts the list to the homes that moved. The history is ranks.json (written by `apartmentscout
// score`, copied by `build`); with fewer than two recorded runs there is nothing to compare and none of this appears.
// The arithmetic and the sentences are in moves-model.js.
import { S, on, emit, store, loadJSON, hooks, SORTS, EXTRA_FILTERS, DIMS, openDrawer } from '../app.js';
import { $, esc } from '../util.js';
import { state as visitState } from './visit.js';
import { addDrawerTop } from './drawer-slots.js';
import { decorateRail } from './rail-sections.js';
import { parseRanks, chooseBaseline, latestRun, movers, change, significant, standing, summary, headline, cardNote, arrowText, runLabel, signedPts, dayLabel, MOVE_MIN } from './moves-model.js';

let model = null, base = null, why = '', now = null, changes = new Map(), only = false, since = null;
const key = () => `moves:${S.crit0?.search?.name || S.base}`;
const labels = () => Object.fromEntries(DIMS);
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

// ------------------------------------------------------------------ choosing the runs
function recompute() {
  base = null; changes = new Map(); why = '';
  if (!model) return;
  const b = chooseBaseline(model, { chosen: since, visit: visitState()?.base || null });
  if (!b) return;
  now = latestRun(model);
  base = b.run; why = b.why;
  changes = movers(model, base, now);
}
const whyText = () => ({ visit: 'your last visit', first: 'the first run recorded', chosen: 'the run you chose' }[why] || '');
const sinceLabel = () => (base ? runLabel(model, base) : '');
/** Numbers the renter typed in this browser that the last scoring run does not know about (they move the home on this page). */
const ownNumbers = (L) => {
  const r = L.score?.renter, r0 = L._score0?.renter;
  return r && Object.keys(r).some((k) => r0?.[k]?.value !== r[k].value) ? r : null;
};
/** How far a home has moved since the compared run, as the page shows it: two recorded runs (so moving a weight slider never
 *  makes a note appear), except that a home carrying the renter's own numbers is read at the rank it holds now, so the note
 *  agrees with the badge. */
export function moved(L) {
  if (!base) return null;
  if (!ownNumbers(L)) return changes.get(L.id) || null;
  const from = standing(model, base, L.id)?.rank || 0, to = L._rank || 0;
  if (!from || !to) return null;
  const c = { id: L.id, kind: 'moved', from, to, delta: from - to, fromScore: null, toScore: L._s ?? null };
  return significant(c, now.n) ? c : null;
}
export const state = () => ({ base, now, why, count: changes.size, only, since });

// ------------------------------------------------------------------ cards
function cardHTML(L) {
  const c = moved(L);
  if (!c) return '';
  const up = c.delta > 0, t = cardNote(c, base, model);
  return `<button type="button" class="mv-note ${up ? 'up' : 'down'}" data-mv="${esc(L.id)}" title="Ranked #${c.from} on ${esc(sinceLabel())}, #${c.to} now. See why." aria-label="${up ? 'Moved up' : 'Moved down'} ${Math.abs(c.delta)} places since ${esc(sinceLabel())}, from number ${c.from} to number ${c.to}. Show why.">${esc(t)}</button>`;
}

// ------------------------------------------------------------------ drawer
function options(selected) {
  const runs = model.runs.slice(0, -1);
  return `<option value="" ${!selected ? 'selected' : ''}>Your last visit, else the first run</option>${runs.map((r) => `<option value="${esc(r.at)}" ${selected === r.at ? 'selected' : ''}>${esc(runLabel(model, r))}</option>`).join('')}`;
}
function drawerHTML(L) {
  if (!base) return '';
  const own = ownNumbers(L);
  const c = own ? { kind: 'moved', delta: (standing(model, base, L.id)?.rank || 0) - (L._rank || 0) } : change(model, base, now, L.id);
  if (!c || (c.kind === 'same') || (c.kind === 'moved' && !c.delta && !own)) return '';
  const e = summary(model, base, now, L.id, { labels: labels(), score: L._score0 || L.score });
  if (!e) return '';
  if (own) {   // the renter's own numbers: the page shows the home where it stands now, so say what they did to it
    const recorded = e.score.to, was = e.rank.from, here = L._rank || 0;
    e.rank = { from: was, to: here, delta: was && here ? was - here : 0 };
    e.score = { from: e.score.from, to: L._s ?? recorded };
    const said = Object.entries(own).map(([k, v]) => ({ size: `${Math.round(v.value).toLocaleString('en-US')} ft\u00b2`, fees: `$${Math.round(v.value)} a month in fees`, price: `$${Math.round(v.value).toLocaleString('en-US')} a month for the rent`, wd: v.value ? 'an in-unit washer/dryer' : 'no in-unit washer/dryer', floor: `floor ${v.value}` })[k]).filter(Boolean);
    if (recorded != null && e.score.to != null && Math.abs(e.score.to - recorded) >= 0.05) e.lines = [{ dim: 'own', label: 'Your numbers', pts: e.score.to - recorded, text: `you entered ${said.join(', ')}` }, ...e.lines];
    Object.assign(e, headline(model, base, e));
    if (!e.rank.delta && !e.lines.length) return '';
  }
  const lines = e.lines.map((l) => `<li><b class="${l.pts > 0 ? 'pos' : 'neg'}">${esc(signedPts(l.pts))}</b><span class="mv-l">${esc(l.label)}</span><span class="mv-t">${esc(cap(l.text))}</span></li>`).join('');
  const p = e.passed;
  const tone = c.kind === 'moved' ? (c.delta > 0 ? 'up' : 'down') : '';
  return `<div class="d-sec mv-sec" id="dMoved" data-tab="Moved"><h3>Why it moved <span>since ${esc(sinceLabel())}</span></h3>
    <p class="mv-head ${tone}"><b>${esc(e.head)}</b>${e.sub ? `<small>${esc(e.sub)}</small>` : ''}</p>
    ${lines ? `<ul class="mv-lines">${lines}</ul>` : '<p class="mv-none">No single dimension explains it: the homes around it moved.</p>'}
    ${e.extras.map((x) => `<p class="mv-extra">${esc(x)}</p>`).join('')}
    ${p.n ? `<p class="mv-extra">${p.n} home${p.n === 1 ? '' : 's'} now rank${p.n === 1 ? 's' : ''} above it that did not before${p.fresh ? ` (${p.fresh} newly ranked)` : ''}.</p>` : ''}
    <label class="mv-pick"><span>Compare with</span><select class="sel mv-since" aria-label="Compare ranks with an earlier scoring run">${options(since)}</select></label></div>`;
}

// ------------------------------------------------------------------ rail
function mountRail() {
  const R = $('rail'); if (!R) return;
  R.querySelector('.mv-rail')?.remove();
  if (!model || !base) return;
  const sec = document.createElement('div');
  sec.className = 'sec mv-rail';
  sec.innerHTML = `<div class="sec-h"><h3>Rank moves</h3></div>
    <label class="mv-pick"><span>Compare with</span><select class="sel mv-since" aria-label="Compare ranks with an earlier scoring run">${options(since)}</select></label>
    <label class="tg ${only ? 'on' : ''}" data-mv-only role="switch" aria-checked="${only}" tabindex="0"><span class="switch"></span><span class="lbl">Only homes that moved</span><span class="n">${changes.size}</span></label>
    <p class="mv-hint">Ranks now against ${esc(sinceLabel())} (${esc(whyText())}). ${changes.size} home${changes.size === 1 ? '' : 's'} moved at least ${MOVE_MIN} places in the top quarter.</p>`;
  const wts = [...R.children].find((x) => x.querySelector?.('.weights'));
  R.insertBefore(sec, wts || null);
  decorateRail(R);   // a collapsible section like its neighbours (a no-op for the ones already done)
}

function choose(value) {
  since = value || null;
  store.set(key(), { since, only });
  recompute();
  emit('filters');
  if (S.sel) openDrawer(S.sel, { instant: true, noVT: true });
}
function setOnly(v) {
  only = !!v;
  store.set(key(), { since, only });
  emit('filters');
}

// ------------------------------------------------------------------ start
async function load() {
  const listed = (S.manifest.extra || []).map(String).some((x) => x === 'ranks.json' || x.endsWith('/ranks.json'));
  const emb = window.__AS_DATA__;
  if (!listed && !(emb && `${S.base}/ranks.json` in emb)) return;
  model = parseRanks(await loadJSON(`${S.base}/ranks.json`, null));
  if (!model) return;
  recompute();
  if (!base) return;
  const sel = $('sortSel');
  if (sel && ![...sel.options].some((o) => o.value === 'moved')) sel.add(new Option('Biggest rank moves', 'moved'));
  emit('filters', { quiet: true });   // the cards pick up their notes; the rail is not rebuilt under a hand that is using it
  mountRail();
}

export function init() {
  const saved = store.get(key(), {});
  since = typeof saved?.since === 'string' ? saved.since : null;
  only = saved?.only === true;
  hooks.card = cardHTML;
  addDrawerTop('moves', drawerHTML, 10);
  EXTRA_FILTERS.push((L) => !only || !base || !!moved(L));
  SORTS.moved = (a, b) => Math.abs(moved(b)?.delta || 0) - Math.abs(moved(a)?.delta || 0) || SORTS.match(a, b);
  on('rail', mountRail);
  document.addEventListener('change', (e) => { const s = e.target.closest?.('.mv-since'); if (s) choose(s.value); });
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-mv-only]');
    if (t) { e.preventDefault(); setOnly(!only); return; }
    const n = e.target.closest?.('.mv-note');
    if (!n) return;
    // the card's own click has opened the drawer by now (it listens first); bring the explanation into view
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const sc = document.querySelector('#drawer .d-scroll'), t2 = $('dMoved'), bar = $('dBar');
      if (sc && t2 && S.sel === n.dataset.mv) sc.scrollTo({ top: t2.offsetTop - (bar?.offsetHeight || 0), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }));
  });
  document.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && e.target.matches?.('[data-mv-only]')) { e.preventDefault(); setOnly(!only); } });
  load();
}
export { arrowText, dayLabel };
