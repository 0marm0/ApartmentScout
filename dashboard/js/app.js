// ApartmentScout dashboard: data loading, shared state, filters, router and the listing drawer.
import { $, esc, money, mins, yn, scoreColor } from './util.js';
import * as MapView from './map.js';
import * as ListView from './list.js';
import * as CompareView from './compare.js';
import * as UnitView from './unit3d.js';
import * as PlanView from './plan3d.js';
import * as RecordsView from './records.js';

const store = {
  get(k, d) { try { const v = localStorage.getItem('as:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('as:' + k, JSON.stringify(v)); } catch { /* storage off */ } },
};

const ACTIVE = ['new', 'researching', 'shortlist', 'touring', 'applied'];
export const S = {
  listings: [], crit: {}, manifest: {}, notes: {},
  filters: Object.assign({ status: ACTIVE, q: '', maxCost: null, maxCommute: null, minScore: 0, mustOnly: false, eligibleOnly: false, favOnly: false }, store.get('filters', {})),
  compare: store.get('compare', []),
  listeners: {},
};
export const on = (ev, fn) => ((S.listeners[ev] ||= []).push(fn));
export const emit = (ev, x) => (S.listeners[ev] || []).forEach((f) => f(x));
export const byId = (id) => S.listings.find((L) => L.id === id);
export const dests = () => (S.crit.commute?.destinations || []).map((d) => d.name);
export const commuteOf = (L, d = dests()[0]) => L.commute?.[d]?.minutes;
export const label = (L) => `${L.building || L.address}${L.unit ? ' ' + L.unit : ''}`;
export const cost = (L) => L.score?.monthly_cost;

export function filtered() {
  const f = S.filters, q = f.q.trim().toLowerCase();
  return S.listings.filter((L) => {
    if (!f.status.includes(L.status || 'new')) return false;
    if (q && !(`${L.building} ${L.unit} ${L.address} ${L.neighborhood}`.toLowerCase().includes(q))) return false;
    if (f.maxCost && cost(L) != null && cost(L) > f.maxCost) return false;
    if (f.maxCommute && commuteOf(L) != null && commuteOf(L) > f.maxCommute) return false;
    if (f.minScore && (L.score?.overall ?? 0) < f.minScore) return false;
    if (f.mustOnly && (L.score?.gates || []).some((g) => g.startsWith('fails') || g.startsWith('unverified'))) return false;
    if (f.eligibleOnly && !L.score?.eligible) return false;
    if (f.favOnly && !(L.favorite || ['shortlist', 'touring', 'applied'].includes(L.status))) return false;
    return true;
  });
}
export function setFilter(k, v) { S.filters[k] = v; store.set('filters', S.filters); emit('filters'); }
export function toggleCompare(id) {
  const i = S.compare.indexOf(id);
  if (i >= 0) S.compare.splice(i, 1); else { S.compare.push(id); if (S.compare.length > 4) S.compare.shift(); }
  store.set('compare', S.compare); emit('compare');
}

async function getJSON(p, fallback) {
  try { const r = await fetch(p, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return await r.json(); } catch { return fallback; }
}
export const loadJSON = getJSON;

// ------------------------------------------------------------ filters UI
const STATUS = [['new', 'New'], ['researching', 'Researching'], ['shortlist', 'Shortlist'], ['touring', 'Touring'], ['applied', 'Applied'], ['rejected', 'Rejected'], ['gone', 'Gone']];
function renderFilters(el, compact) {
  const costs = S.listings.map(cost).filter((v) => v != null).sort((a, b) => a - b);
  const cMax = Math.ceil((costs[Math.floor(costs.length * 0.98)] || 8000) / 100) * 100;
  const hard = S.crit.budget?.hard_max;
  const f = S.filters;
  el.innerHTML = `
    <div class="f-row" style="flex:2 1 220px"><label for="${el.id}-q">Search</label><input type="search" id="${el.id}-q" placeholder="Building, street, neighbourhood" value="${esc(f.q)}"></div>
    <div class="f-row" style="flex:3 1 320px"><span class="lbl">Status</span><div class="chips">${STATUS.map(([k, t]) => `<button type="button" class="chip ${f.status.includes(k) ? 'on' : ''}" data-st="${k}">${t}</button>`).join('')}</div></div>
    <div class="f-row" style="flex:1 1 170px"><label for="${el.id}-cost">Max monthly cost <b class="mono">${f.maxCost ? money(f.maxCost) : 'any'}</b></label><input type="range" id="${el.id}-cost" min="1000" max="${cMax}" step="50" value="${f.maxCost || cMax}"></div>
    ${dests().length ? `<div class="f-row" style="flex:1 1 170px"><label for="${el.id}-com">Max commute to ${esc(dests()[0])} <b class="mono">${f.maxCommute ? f.maxCommute + ' min' : 'any'}</b></label><input type="range" id="${el.id}-com" min="5" max="75" step="1" value="${f.maxCommute || 75}"></div>` : ''}
    <div class="f-row" style="flex:1 1 150px"><label for="${el.id}-sc">Min score <b class="mono">${f.minScore || 0}</b></label><input type="range" id="${el.id}-sc" min="0" max="90" step="1" value="${f.minScore || 0}"></div>
    <div class="f-row"><div class="chips">
      <button type="button" class="chip ${f.eligibleOnly ? 'on' : ''}" data-tg="eligibleOnly" title="Within ${hard ? money(hard) : 'budget'} and no failed must-haves">Eligible only</button>
      <button type="button" class="chip ${f.mustOnly ? 'on' : ''}" data-tg="mustOnly" title="Must-haves confirmed, not just likely">Must-haves confirmed</button>
      <button type="button" class="chip ${f.favOnly ? 'on' : ''}" data-tg="favOnly">Shortlist and favourites</button>
    </div></div>`;
  el.querySelector(`#${el.id}-q`).addEventListener('input', (e) => setFilter('q', e.target.value));
  el.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.st, s = new Set(S.filters.status); s.has(k) ? s.delete(k) : s.add(k); setFilter('status', [...s]);
  }));
  el.querySelectorAll('[data-tg]').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.tg, !S.filters[b.dataset.tg])));
  const rc = el.querySelector(`#${el.id}-cost`); rc.addEventListener('input', () => { const v = +rc.value; setFilter('maxCost', v >= cMax ? null : v); });
  const rm = el.querySelector(`#${el.id}-com`); if (rm) rm.addEventListener('input', () => { const v = +rm.value; setFilter('maxCommute', v >= 75 ? null : v); });
  const rs = el.querySelector(`#${el.id}-sc`); rs.addEventListener('input', () => setFilter('minScore', +rs.value));
}
function refreshFilterLabels() {
  // re-render both filter blocks but keep focus on the active input
  const a = document.activeElement?.id;
  renderFilters($('filters'), true); renderFilters($('filters2'));
  if (a && $(a)) { $(a).focus(); if ($(a).type === 'search') { const v = $(a).value; $(a).setSelectionRange(v.length, v.length); } }
}

// ------------------------------------------------------------ KPIs
function renderKPIs() {
  const F = filtered(), act = S.listings.filter((L) => ACTIVE.includes(L.status));
  const elig = S.listings.filter((L) => L.score?.eligible);
  const c = F.map(cost).filter((v) => v != null).sort((a, b) => a - b);
  const med = c.length ? c[Math.floor(c.length / 2)] : null;
  const cm = F.map((L) => commuteOf(L)).filter((v) => v != null).sort((a, b) => a - b);
  const top = [...elig].sort((a, b) => (a.score.rank || 1e9) - (b.score.rank || 1e9))[0];
  const short = S.listings.filter((L) => ['shortlist', 'touring', 'applied'].includes(L.status)).length;
  $('kpis').innerHTML = [
    ['Listings tracked', `${S.listings.length} <small>${act.length} active</small>`],
    ['Shown with filters', `${F.length}`],
    ['Eligible', `${elig.length} <small>budget + must-haves</small>`],
    ['Shortlist / touring', `${short}`],
    ['Median monthly cost', `${money(med)}`],
    [`Median commute${dests()[0] ? ' to ' + esc(dests()[0]) : ''}`, cm.length ? `${Math.round(cm[Math.floor(cm.length / 2)])} <small>min</small>` : '?'],
    ['Top ranked', top ? `<a href="#" data-open="${top.id}" style="font-size:14px">${esc(label(top))}</a>` : '?'],
  ].map(([k, v]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  $('kpis').querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openDrawer(a.dataset.open); }));
}

// ------------------------------------------------------------ drawer
const DIM_LABEL = { cost: 'Cost', space: 'Space', commute: 'Commute', amenities: 'Amenities', light_view: 'Light & view', building: 'Building', quiet: 'Quiet' };
export function openDrawer(id) {
  const L = byId(id); if (!L) return;
  const s = L.score || {}, am = L.amenities || {}, p = L.price || {};
  const gates = (s.gates || []).map((g) => {
    const [k, v] = g.split(':');
    const cls = k === 'over_budget' || k === 'fails' ? 'bad' : 'warn';
    const t = { over_budget: 'Over hard budget', fails: 'Fails must-have', unverified: 'Unverified must-have', unknown_cost: 'Cost unknown' }[k] || k;
    return `<span class="pill ${cls}">${t}${v ? ': ' + esc(v.replaceAll('_', ' ')) : ''}</span>`;
  }).join(' ');
  const dims = Object.entries(s.parts || {}).map(([k, v]) => `<span>${DIM_LABEL[k] || k}</span><span class="bar ${v == null ? 'unknown' : ''}"><i style="width:${v ?? 0}%;background:${scoreColor(v)}"></i></span><span class="num">${v == null ? '?' : Math.round(v)}</span>`).join('');
  const com = Object.entries(L.commute || {}).map(([d, c]) => `<div><b>${esc(d)}: ${mins(c.minutes)}</b> <span class="muted">${esc(c.route || '')}</span></div>`).join('');
  const rec = L.records || {}, rv = L.reviews || {};
  const links = Object.entries(L.links || {}).map(([k, u]) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">${esc(k)} ↗</a>`).join('');
  const hasSite = (S.manifest.sites || []).includes(L.id), hasPlan = (S.manifest.plans || []).includes(L.id), hasDos = (S.manifest.dossiers || []).includes(L.id);
  $('drawerBody').innerHTML = `
    <div class="d-title">${esc(label(L))}</div>
    <div class="d-sub">${esc(L.address || '')}${L.neighborhood ? ' · ' + esc(L.neighborhood) : ''}</div>
    <div>${L.favorite ? `<span class="pill fav">Favourite ${esc(L.favorite)}</span> ` : ''}<span class="pill">${esc(L.status || 'new')}</span> ${s.budget_tier ? `<span class="pill ${s.budget_tier === 'Over budget' ? 'bad' : 'good'}">${esc(s.budget_tier)}</span>` : ''} ${gates}</div>
    <div class="d-sec facts">
      <div class="fact"><div class="k">Monthly cost</div><div class="v">${money(s.monthly_cost)}</div></div>
      <div class="fact"><div class="k">Gross rent</div><div class="v">${money(p.gross)}</div></div>
      <div class="fact"><div class="k">Free months</div><div class="v">${p.free_months ?? 0}${p.lease_months ? ' of ' + p.lease_months : ''}</div></div>
      <div class="fact"><div class="k">Size</div><div class="v">${L.sqft ? Math.round(L.sqft) + ' ft²' : '?'}</div></div>
      <div class="fact"><div class="k">Beds</div><div class="v">${L.beds ?? '?'}</div></div>
      <div class="fact"><div class="k">Floor / exposure</div><div class="v">${L.floor ?? '?'} / ${(L.exposure || []).join(', ') || '?'}</div></div>
      <div class="fact"><div class="k">In-unit W/D</div><div class="v">${yn(am.in_unit_wd)}</div></div>
      <div class="fact"><div class="k">Doorman</div><div class="v">${esc(am.doorman || '?')}</div></div>
      <div class="fact"><div class="k">Gym / elevator</div><div class="v">${yn(am.gym)} / ${yn(am.elevator)}</div></div>
    </div>
    <div class="d-sec"><h3>Score ${s.overall ?? '?'}${s.rank ? ' · rank ' + s.rank : ''} <span class="muted" style="text-transform:none;letter-spacing:0">(${s.confidence ?? 0}% of weight known, range ${s.range ? s.range.join('-') : '?'})</span></h3><div class="dims">${dims}</div></div>
    ${com ? `<div class="d-sec"><h3>Commute</h3>${com}</div>` : ''}
    ${rec.flags ? `<div class="d-sec"><h3>Public records</h3><div class="muted">Records score ${rec.risk_score} · street-noise score ${rec.noise_score}</div>${rec.flags.map((f) => `<div class="flag">${esc(f)}</div>`).join('')}</div>` : ''}
    ${rv.summary ? `<div class="d-sec"><h3>Resident reviews</h3><p>${esc(rv.summary)}</p>${(rv.ratings || []).map((r) => `<div>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a>` : esc(r.label)}: ${esc(r.value)}</div>`).join('')}${rv.questions ? `<p class="muted">Ask: ${esc(rv.questions)}</p>` : ''}</div>` : ''}
    ${L.site?.sun_hours ? `<div class="d-sec"><h3>Light model</h3><div>Direct sun on the ${L.site.floor}th-floor window: ${L.site.sun_hours.map((h) => h.toFixed(1)).join(' · ')} h/day (Jan to Dec). Skyline straight ahead ${L.site.skyline_ahead_deg}°.</div></div>` : ''}
    ${Object.keys(S.notes || {}).some((k) => k.startsWith(L.id) || k.startsWith((L.building || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'))) ? `<div class="d-sec"><h3>Research notes</h3><a href="#records/${L.id}">Open the research notes for this building</a></div>` : ''}
    ${L.notes ? `<div class="d-sec"><h3>Open questions</h3><p>${esc(L.notes)}</p></div>` : ''}
    <div class="btns">
      <button class="btn ${S.compare.includes(L.id) ? 'primary' : ''}" id="dCmp" type="button">${S.compare.includes(L.id) ? 'In compare' : '＋ Compare'}</button>
      ${hasSite ? `<a class="btn primary" href="#unit/${L.id}">Unit 3D, sun and view</a>` : ''}
      ${hasPlan ? `<a class="btn" href="#plan/${L.id}">Floor plan 3D</a>` : ''}
      ${hasDos ? `<a class="btn" href="#records/${L.id}">Building records</a>` : ''}
      ${links}
    </div>
    <p class="muted" style="margin-top:14px;font-size:12px">Last checked ${esc(L.checked || '?')} · id <span class="mono">${esc(L.id)}</span></p>`;
  $('dCmp').addEventListener('click', () => { toggleCompare(L.id); openDrawer(L.id); });
  $('drawerBody').querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', () => closeDrawer()));
  $('drawer').hidden = false;
  emit('select', id);
}
export function closeDrawer() { $('drawer').hidden = true; emit('select', null); }

// ------------------------------------------------------------ router
const VIEWS = { map: MapView, list: ListView, compare: CompareView, unit: UnitView, plan: PlanView, records: RecordsView };
let current = null;
function route() {
  const [view, arg] = (location.hash.replace('#', '') || 'map').split('/');
  const v = VIEWS[view] ? view : 'map';
  document.querySelectorAll('.view').forEach((el) => (el.hidden = el.id !== 'view-' + v));
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.view === v));
  $('kpis').hidden = !['map', 'list'].includes(v);
  current = v;
  VIEWS[v].show?.(arg ? decodeURIComponent(arg) : null);
}

function setupTheme() {
  const saved = store.get('theme', null);
  if (saved) document.documentElement.dataset.theme = saved;
  $('themeBtn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    store.set('theme', document.documentElement.dataset.theme);
    emit('theme');
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => emit('theme'));
}

async function boot() {
  const qs = new URLSearchParams(location.search);
  const base = qs.get('data') || 'data';
  S.base = base;
  const [listings, crit, manifest, notes] = await Promise.all([
    getJSON(`${base}/listings.json`, []), getJSON(`${base}/criteria.json`, {}), getJSON(`${base}/manifest.json`, {}), getJSON(`${base}/notes.json`, {}),
  ]);
  Object.assign(S, { listings, crit, manifest, notes });
  if (qs.get('theme')) document.documentElement.dataset.theme = qs.get('theme');
  $('searchName').textContent = crit.search?.name || '';
  $('footGen').textContent = manifest.generated ? `Data built ${manifest.generated.replace('T', ' ')} · ApartmentScout ${manifest.version || ''}` : 'No data yet: run `apartmentscout build`.';
  setupTheme();
  renderFilters($('filters'), true); renderFilters($('filters2'));
  renderKPIs();
  on('filters', () => { renderKPIs(); refreshFilterLabels(); });
  on('compare', () => { $('cmpCount').hidden = !S.compare.length; $('cmpCount').textContent = S.compare.length; });
  emit('compare');
  $('drawerClose').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  for (const v of Object.values(VIEWS)) v.init?.();
  addEventListener('hashchange', route);
  route();
  if (qs.get('open')) openDrawer(qs.get('open'));
}
boot();
