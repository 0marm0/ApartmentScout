// New & changed: a dated timeline of what moved between snapshots (new, price, status, gone, relist, concession,
// claim) with old → new chips, filters by type and date, and price-history sparklines per listing.
import { S, openDrawer, label, cost, store } from '../app.js';
import { esc, money } from '../util.js';
import { R, events, priceHistory, snapshots, EVENT_TYPES, parseDate, fmtDate, ageText } from './model.js';
import { sparkline, empty, noteHTML, IC } from './ui.js';

const st = { types: new Set(store.get('research-types', [])), range: store.get('research-range', '30'), shown: 80 };
const RANGES = [['7', '7 days'], ['30', '30 days'], ['all', 'All']];
const MONEY_FIELDS = /gross|net|price|rent|fee|cost|deposit/i;

function val(field, v) {
  if (v == null || v === '') return '<span class="unk">unknown</span>';
  if (typeof v === 'number' && MONEY_FIELDS.test(field || '')) return esc(money(v));
  if (typeof v === 'number' && /free_months|months/.test(field || '')) return esc(`${v} mo free`);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'object') return esc(JSON.stringify(v).slice(0, 60));
  return esc(String(v).replaceAll('_', ' '));
}
function diffHTML(e) {
  const f = e.field || '';
  if (e.type === 'new') { const c = e.L ? cost(e.L) : null; return c != null ? `<span class="rs-diff"><b>${esc(money(c))}</b>/mo</span>` : ''; }
  if (e.type === 'gone') return `<span class="rs-diff"><s>${e.from != null ? val(f, e.from) : 'listed'}</s> → <b>off market</b></span>`;
  if (e.from == null && e.to == null) return '';
  let delta = '';
  if (typeof e.from === 'number' && typeof e.to === 'number' && MONEY_FIELDS.test(f)) {
    const d = e.to - e.from;
    if (d) delta = `<span class="rs-delta ${d < 0 ? 'down' : 'up'}">${d < 0 ? '−' : '+'}${esc(money(Math.abs(d)))}${e.from ? ` · ${Math.abs((d / e.from) * 100).toFixed(1)}%` : ''}</span>`;
  }
  return `<span class="rs-diff">${f ? `<em>${esc(f.replaceAll('_', ' '))}</em>` : ''}${e.from == null ? val(f, e.from) : `<s>${val(f, e.from)}</s>`}<span class="arr" aria-label="changed to">→</span><b>${val(f, e.to)}</b></span>${delta}`;
}
function typeOf(e) {
  if (e.type === 'price' && typeof e.from === 'number' && typeof e.to === 'number') return e.to < e.from ? ['price down', 'Price cut'] : e.to > e.from ? ['price up', 'Price rise'] : ['price', 'Price'];
  return [e.type, (EVENT_TYPES.find(([k]) => k === e.type) || [, e.type])[1]];
}

function evHTML(e) {
  const [cls, name] = typeOf(e);
  const ph = priceHistory(e.id);
  const who = e.L ? `<button type="button" class="rs-ev-t" data-open="${esc(e.id)}">${esc(e.L.building || e.L.address || e.id)} <span>${esc(e.L.unit || '')}</span></button><span class="faint rs-ev-n">${esc(e.L.neighborhood || '')}</span>` : `<span class="rs-ev-t mono">${esc(e.id)}</span><span class="faint rs-ev-n">not in listings</span>`;
  return `<li class="rs-ev t-${cls.replace(' ', ' t-')}">
    <span class="rs-dot" aria-hidden="true"></span>
    <div class="rs-ev-b">
      <div class="rs-ev-h"><span class="rs-type">${esc(name)}</span>${who}</div>
      <div class="rs-ev-d">${diffHTML(e)}${e.source ? `<span class="rs-src">via ${esc(e.source)}</span>` : ''}</div>
      ${e.note ? `<div class="rs-note">${esc(e.note)}</div>` : ''}
    </div>
    <div class="rs-ev-s">${ph.length >= 2 ? sparkline(ph, 84, 24, { label: e.L ? label(e.L) : e.id }) : ''}</div>
  </li>`;
}

function trendHTML(sn) {
  if (sn.length < 2) return '';
  const w = 560, h = 64, vs = sn.map((s) => +s.active), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const x = (i) => 4 + (i / (sn.length - 1)) * (w - 8), y = (v) => h - 6 - ((v - lo) / span) * (h - 16);
  const d = sn.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(+s.active).toFixed(1)}`).join('');
  const last = sn[sn.length - 1], first = sn[0];
  return `<div class="panel rs-trend"><div class="rs-trend-h"><div><div class="label">Homes in play</div><b class="tnum">${(+last.active).toLocaleString()}</b><span class="faint"> on ${esc(fmtDate(last.date))} · ${(+last.active - +first.active >= 0 ? '+' : '−') + Math.abs(+last.active - +first.active)} since ${esc(fmtDate(first.date))}</span></div><span class="faint rs-trend-n">${sn.length} snapshots</span></div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="rs-trend-svg" role="img" aria-label="Homes in play per snapshot: ${sn.map((s) => `${s.date} ${s.active}`).join(', ')}"><path d="${d}L${x(sn.length - 1)} ${h}L${x(0)} ${h}Z" class="a"/><path d="${d}" class="l" vector-effect="non-scaling-stroke"/></svg></div>`;
}

function movesHTML() {
  const P = Object.keys(R.hist?.price_history || {}).map((id) => ({ id, L: S.listings.find((x) => x.id === id), pts: priceHistory(id) })).filter((x) => x.pts.length >= 2);
  P.forEach((x) => { const a = x.pts[0].v, b = x.pts[x.pts.length - 1].v; x.d = b - a; x.p = a ? (b - a) / a : 0; x.last = x.pts[x.pts.length - 1].date; });
  P.sort((a, b) => (parseDate(b.last) - parseDate(a.last)) || Math.abs(b.p) - Math.abs(a.p));
  if (!P.length) return `<aside class="panel rs-moves"><h3>Price history</h3><p class="faint rs-small">No listing has two or more recorded prices yet.</p></aside>`;
  return `<aside class="panel rs-moves"><h3>Price history <span>${P.length} listing${P.length > 1 ? 's' : ''}</span></h3><ul>${P.slice(0, 40).map((x) => `<li>
      <button type="button" class="rs-mv" ${x.L ? `data-open="${esc(x.id)}"` : 'disabled'}><span class="rs-mv-t">${x.L ? esc(label(x.L)) : `<span class="mono">${esc(x.id)}</span>`}<span class="faint">${x.pts.length} prices · last ${esc(fmtDate(x.last))}</span></span>
      ${sparkline(x.pts, 88, 26, { label: x.L ? label(x.L) : x.id })}<span class="rs-mv-v"><b>${esc(money(x.pts[x.pts.length - 1].v))}</b><span class="rs-delta ${x.d < 0 ? 'down' : x.d > 0 ? 'up' : ''}">${x.d ? (x.d < 0 ? '−' : '+') + esc(money(Math.abs(x.d))) : 'no change'}</span></span></button></li>`).join('')}</ul></aside>`;
}

export function render(el) {
  if (!R.hist) {
    el.innerHTML = empty(IC.pulse, 'No change history yet', 'New & changed compares saved snapshots of your listings: new units, price moves, concessions, status changes and units that came back. History starts with the next build that has a snapshot.', 'apartmentscout build');
    return;
  }
  const E = events();
  if (!E.length) {
    el.innerHTML = trendHTML(snapshots()) + empty(IC.pulse, 'No changes recorded yet', R.hist.note ? noteHTML(R.hist.note) : 'Changes appear after the next snapshot differs from this one: new units, price moves, concessions, status changes and units that came back.');
    return;
  }
  const ref = parseDate(E[0].date);
  const inRange = (e) => st.range === 'all' || ref == null || (ref - parseDate(e.date)) / 864e5 < +st.range;
  const R1 = E.filter(inRange);
  const cnt = Object.fromEntries(EVENT_TYPES.map(([k]) => [k, R1.filter((e) => e.type === k).length]));
  const V = R1.filter((e) => !st.types.size || st.types.has(e.type));
  const days = [];
  for (const e of V.slice(0, st.shown)) { const d = days[days.length - 1]; if (d && d.date === e.date) d.list.push(e); else days.push({ date: e.date, list: [e] }); }
  el.innerHTML = `${trendHTML(snapshots())}
    <div class="rs-bar-row">
      <div class="chips" role="group" aria-label="Event types"><button type="button" class="chip ${st.types.size ? '' : 'on'}" data-t="" aria-pressed="${!st.types.size}">All<span class="n">${R1.length}</span></button>${EVENT_TYPES.map(([k, t]) => `<button type="button" class="chip ev-${k} ${st.types.has(k) ? 'on' : ''}" data-t="${k}" aria-pressed="${st.types.has(k)}"${cnt[k] ? '' : ' disabled'}><i class="rs-cdot" aria-hidden="true"></i>${t}<span class="n">${cnt[k]}</span></button>`).join('')}</div>
      <span class="sp"></span>
      <div class="seg" role="group" aria-label="Date range">${RANGES.map(([k, t]) => `<button type="button" data-r="${k}" class="${st.range === k ? 'on' : ''}" aria-pressed="${st.range === k}">${t}</button>`).join('')}</div>
    </div>
    <p class="rs-sub">${V.length.toLocaleString()} change${V.length === 1 ? '' : 's'}${ref != null ? ` · latest ${esc(fmtDate(E[0].date))} (${esc(ageText(E[0].date))})` : ''} · ranges count back from the latest change</p>
    <div class="rs-split">
      <div class="rs-timeline">${days.length ? days.map((d) => `<section class="rs-day"><h3><b>${esc(fmtDate(d.date, true))}</b><span>${d.list.length} change${d.list.length > 1 ? 's' : ''}</span></h3><ol class="rs-evs">${d.list.map(evHTML).join('')}</ol></section>`).join('')
        + (V.length > st.shown ? `<button type="button" class="btn ghost more-btn rs-more-btn" id="evMore">Show ${Math.min(80, V.length - st.shown)} more of ${V.length - st.shown}</button>` : '')
        : empty(IC.pulse, E.length ? 'No changes in this range' : 'No changes recorded yet', E.length ? 'Widen the date range or pick another type.' : 'The history file has no events yet.')}</div>
      ${movesHTML()}
    </div>`;
  el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.t;
    if (!k) st.types.clear(); else st.types.has(k) ? st.types.delete(k) : st.types.add(k);
    st.shown = 80; store.set('research-types', [...st.types]); render(el); el.querySelector(`[data-t="${k}"]`)?.focus();
  }));
  el.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { st.range = b.dataset.r; st.shown = 80; store.set('research-range', st.range); render(el); el.querySelector(`[data-r="${b.dataset.r}"]`)?.focus(); }));
  el.querySelector('#evMore')?.addEventListener('click', () => { st.shown += 80; render(el); });
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.open)));
}
