// Compare: up to four listings side by side in grouped rows with the best value in each row marked, an
// "add a listing" picker that suggests saved picks and top-ranked homes, a cost-against-space scatter of
// every eligible listing and a per-dimension chart. #compare/id1,id2 deep-links a set.
import { S, on, byId, cost, commuteOf, dests, toggleCompare, toggleSave, openDrawer, isSaved, pick, score, DIMS } from './app.js';
import { $, esc, money, moneyShort, safeUrl, ring, unitGlyph, bullets, scoreColor, ICONS, toast, debounce } from './util.js';
import { modeRoute, ppsf, tierPill, myTierPill, gateFails, gateUnverified, name, thumb, label, isMust, TIERS } from './views/table-kit.js';
import { illustration } from './features/empty.js';   // [feature C] empty-state art

const LET = ['A', 'B', 'C', 'D'];
let shown = false, active = -1, opts = [];
const isOn = () => shown && S.view === 'compare';

// ------------------------------------------------------------------ rows
const unk = (t = 'Unknown') => `<span class="cg-unk">${t}</span>`;
const yesNo = (v) => (v === true ? 1 : v === false ? 0 : null);
const ynHTML = (v, must) => (v === 1 ? '<span class="cg-yes">Yes</span>' : v === 0 ? `<span class="${must ? 'cg-bad' : 'cg-no'}">No</span>` : unk(must ? 'Unconfirmed' : 'Unknown'));
const DOOR = { 'full-time': 3, 'part-time': 2, virtual: 1, none: 0 };
const DOOR_T = { 'full-time': 'Full-time', 'part-time': 'Part-time', virtual: 'Virtual', none: 'None' };
function rating(L) {
  const r = (L.reviews?.ratings || []).map((x) => ({ l: x.label, m: String(x.value).match(/([\d.]+)\s*\/\s*5(?:\D+(\d+))?/) })).filter((x) => x.m);
  if (!r.length) return null;
  const n = r.reduce((a, x) => a + (+x.m[2] || 1), 0);
  return { v: r.reduce((a, x) => a + +x.m[1] * (+x.m[2] || 1), 0) / n, n: r.reduce((a, x) => a + (+x.m[2] || 0), 0), src: r.map((x) => x.l).join(', ') };
}
const sun = (L, m) => L.site?.sun_hours?.[m];

function sections() {
  const D = dests();
  return [
    { t: 'Money', rows: [
      { t: 'Monthly cost', s: 'net of concessions', f: cost, best: 'min', fmt: (v) => `<b class="cg-big">${money(v)}</b>` },
      { t: 'Gross rent', f: (L) => L.price?.gross, best: 'min', fmt: money },
      { t: 'Free months', f: (L) => L.price?.free_months, best: 'max', fmt: (v) => (v ? `${v} free` : 'None') },
      { t: 'Recurring fees', f: (L) => L.price?.fees_monthly, best: 'min', fmt: (v) => `${money(v)}<span class="u">/mo</span>` },
      { t: 'One-time fees', f: (L) => L.price?.fees_one_time, best: 'min', fmt: money },
      { t: '$ per ft²', f: ppsf, best: 'min', fmt: (v) => '$' + v.toFixed(2) },
    ] },
    { t: 'Space', rows: [
      { t: 'Size', f: (L) => L.sqft, best: 'max', fmt: (v) => `${Math.round(v).toLocaleString()}<span class="u">ft²</span>`, none: 'Not published' },
      { t: 'Bedrooms', f: (L) => L.beds, best: 'max', fmt: (v) => (v ? `${v} bd` : 'Studio') },
      { t: 'Floor', f: (L) => L.floor, best: 'max', fmt: (v, L) => `${Math.round(v)}${L.floor_inferred ? '<span class="u" title="Inferred from the unit number">inferred</span>' : ''}` },
      { t: 'Windows face', f: (L) => (L.exposure?.length ? L.exposure.join(' / ') : null), fmt: esc },
      { t: 'Available', f: (L) => L.available || null, fmt: esc },
    ] },
    { t: 'Commute', rows: D.map((d) => ({
      t: `To ${d}${S.commuteMode && S.commuteMode !== 'best' ? ' · ' + S.commuteMode : ''}`, f: (L) => commuteOf(L, d), best: 'min', none: 'Not computed',
      fmt: (v, L) => { const r = modeRoute(L, d), b = bullets(r, 4); return `<span class="cg-cm">${b ? `<span class="line-bullets">${b}</span>` : '<span class="cg-walk">Walk</span>'}<b>${Math.round(v)}</b><span class="u">min</span></span>${r ? `<span class="cg-route" title="${esc(r)}">${esc(r)}</span>` : ''}`; },
    })) },
    { t: 'Building', rows: [
      { t: 'Doorman', f: (L) => DOOR[L.amenities?.doorman] ?? null, best: 'max', fmt: (v, L) => esc(DOOR_T[L.amenities?.doorman] || '') },
      { t: 'In-unit W/D', f: (L) => yesNo(L.amenities?.in_unit_wd), best: 'max', fmt: (v) => ynHTML(v, isMust('in_unit_wd')), raw: true },
      { t: 'Elevator', f: (L) => yesNo(L.amenities?.elevator), best: 'max', fmt: (v) => ynHTML(v, isMust('elevator')), raw: true },
      { t: 'Gym', f: (L) => yesNo(L.amenities?.gym), best: 'max', fmt: (v) => ynHTML(v, false), raw: true },
      { t: 'Records score', s: 'higher is cleaner', f: (L) => L.records?.risk_score, best: 'max', fmt: (v, L) => `${v}<span class="u">/100</span>${L.records?.flags?.length ? `<span class="cg-sub">${L.records.flags.length} flag${L.records.flags.length > 1 ? 's' : ''} to read</span>` : ''}` },
      { t: 'Street quiet', s: 'from 311 noise', f: (L) => L.records?.noise_score, best: 'max', fmt: (v) => `${v}<span class="u">/100</span>` },
      { t: 'Resident reviews', f: (L) => rating(L)?.v, best: 'max', fmt: (v, L) => { const r = rating(L); return `${v.toFixed(1)}<span class="u">/5</span><span class="cg-sub">${esc(r.src)}${r.n ? ` · ${r.n} reviews` : ''}</span>`; } },
    ] },
    { t: 'Light', note: 'modelled direct sun on the window', rows: [
      { t: 'Sun in December', f: (L) => sun(L, 11), best: 'max', fmt: (v) => `${v.toFixed(1)}<span class="u">h/day</span>`, none: 'No light model' },
      { t: 'Sun in June', f: (L) => sun(L, 5), best: 'max', fmt: (v) => `${v.toFixed(1)}<span class="u">h/day</span>`, none: 'No light model' },
      { t: 'Open sky in view', f: (L) => (L.site?.open_sky_share != null ? L.site.open_sky_share * 100 : null), best: 'max', fmt: (v) => `${Math.round(v)}<span class="u">%</span>`, none: 'No light model' },
    ] },
    { t: 'Score', note: 'with your weights', rows: [
      { t: 'Overall', f: score, best: 'max', fmt: (v) => bar(v, true) },
      ...DIMS.map(([k, n]) => ({ t: n, w: k, f: (L) => L.score?.parts?.[k], best: 'max', fmt: (v) => bar(v), none: 'Unknown, counts as 50' })),
      { t: 'Weight on known facts', f: (L) => L.score?.confidence, best: 'max', fmt: (v, L) => `${v}<span class="u">%</span>${L.score?.range && L.score.range[0] !== L.score.range[1] ? `<span class="cg-sub">could land ${Math.round(L.score.range[0])}–${Math.round(L.score.range[1])}</span>` : ''}` },
      { t: 'Hard requirements', f: () => 1, fmt: (v, L) => gatesHTML(L), raw: true },
      { t: 'Open questions', f: (L) => L.notes || null, fmt: (v) => `<span class="cg-notes" title="${esc(v)}">${esc(v)}</span>`, none: 'None recorded' },
    ] },
  ];
}
function bar(v, big) {
  return `<span class="cg-bar${big ? ' big' : ''}"><span class="tr"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${scoreColor(v)}"></i></span><b>${Math.round(v)}</b></span>`;
}
function gatesHTML(L) {
  const f = gateFails(L), u = gateUnverified(L);
  if (!f.length && !u.length) return '<span class="pill good">All met</span>';
  return `<span class="cg-pills">${f.map((x) => `<span class="pill bad">${esc(x)}</span>`).join('')}${u.map((x) => `<span class="pill warn">Confirm ${esc(x)}</span>`).join('')}</span>`;
}
const weightShare = (k) => { const t = Object.values(S.weights).reduce((a, b) => a + b, 0) || 1; return Math.round(((S.weights[k] || 0) / t) * 100); };

// ------------------------------------------------------------------ board
function headHTML(L, i) {
  const ph = (L.photos || []).map(safeUrl).find(Boolean), sv = isSaved(L.id), hasSite = (S.manifest.sites || []).includes(L.id);
  const fails = gateFails(L);
  return `<div class="cg-head" data-id="${esc(L.id)}">
    <div class="ch-media">${ph ? `<img src="${esc(ph)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : unitGlyph(L, 448, 232)}
      <span class="ch-let" aria-hidden="true">${LET[i]}</span>
      <div class="ch-btns"><button type="button" class="${sv ? 'on' : ''}" data-save="${esc(L.id)}" aria-pressed="${sv}" aria-label="${sv ? 'Remove from picks' : 'Save to picks'}">${sv ? ICONS.star : ICONS.starO}</button><button type="button" data-rm="${esc(L.id)}" aria-label="Remove ${esc(label(L))} from compare">${ICONS.x}</button></div></div>
    <div class="ch-body">
      <div class="ch-top"><div class="ch-t"><h3><button type="button" class="ch-name" data-open="${esc(L.id)}">${name(L)}</button></h3><p>${esc(L.neighborhood || L.address || '')}</p></div>${ring(score(L), 64, 5)}</div>
      <div class="ch-tags">${L._rank ? `<span class="pill accent">Rank ${L._rank}</span>` : '<span class="pill">Not ranked</span>'}${tierPill(L)}${myTierPill(L.id)}${fails.length ? '<span class="pill bad">Fails a gate</span>' : ''}</div>
      <div class="ch-acts"><button type="button" class="btn" data-open="${esc(L.id)}">Details</button>${hasSite ? `<a class="btn" href="#unit/${esc(L.id)}">${ICONS.cube}Unit 3D</a>` : ''}${safeUrl(L.links?.listing) ? `<a class="btn ghost" href="${esc(safeUrl(L.links.listing))}" target="_blank" rel="noopener" aria-label="Open the listing">${ICONS.ext}</a>` : ''}</div>
    </div></div>`;
}
function boardHTML(Ls) {
  const n = Ls.length, slot = n < 4;
  const cols = n + (slot ? 1 : 0);
  let h = `<div class="cg-corner"><span class="cg-key"><i></i>Best in row</span></div>${Ls.map(headHTML).join('')}`;
  if (slot) h += `<button type="button" class="cg-add" id="cmpSlot"><span>${ICONS.plus}</span><b>Add a listing</b><small>${4 - n} more slot${4 - n > 1 ? 's' : ''}</small></button>`;
  for (const sec of sections()) {
    h += `<div class="cg-sec" role="rowheader"><span>${esc(sec.t)}${sec.note ? `<small>${esc(sec.note)}</small>` : ''}</span></div>`;
    for (const r of sec.rows) {
      const vals = Ls.map((L) => { const v = r.f(L); return v == null || Number.isNaN(v) ? null : v; });
      const known = vals.filter((v) => v != null);
      let target = null;
      if (r.best && known.length >= 2 && new Set(known).size > 1) target = r.best === 'min' ? Math.min(...known) : Math.max(...known);
      h += `<div class="cg-k"><span>${esc(r.t)}</span>${r.w ? `<small>${weightShare(r.w)}% weight</small>` : r.s ? `<small>${esc(r.s)}</small>` : ''}</div>`;
      h += Ls.map((L, i) => {
        const v = vals[i], best = target != null && v === target;
        const body = v == null && !r.raw ? unk(r.none || 'Unknown') : r.fmt(v, L);
        return `<div class="cg-v${best ? ' best' : ''}" data-col="${i}">${best ? `<span class="sr">Best: </span>` : ''}${body}</div>`;
      }).join('') + (slot ? '<div class="cg-v cg-pad"></div>' : '');
    }
  }
  return `<div class="cmp-scroll"><div class="cmp-grid" style="--n:${cols}">${h}</div></div>`;
}

function emptyHTML() {
  const sugg = suggestions('').slice(0, 4);
  return `<div class="empty cmp-empty has-ill">${illustration('compare')}<b>Nothing to compare yet</b>
    <span>Add up to four homes with <span class="kbd-i">${ICONS.plus}</span> on the Shortlist, <kbd>c</kbd> in the listing panel, or start from one of these.</span>
    ${sugg.length ? `<div class="cmp-sugg">${sugg.map((o) => `<button type="button" class="sg" data-add="${esc(o.L.id)}"><span class="th">${thumb(o.L)}</span><span class="sg-t"><b>${name(o.L)}</b><span>${esc(o.why)} · ${money(cost(o.L))}</span></span><span class="sg-s" style="--c:${scoreColor(score(o.L))}">${Math.round(score(o.L) ?? 0)}</span></button>`).join('')}</div>
    <button type="button" class="btn primary" id="cmpTop">${ICONS.plus}Compare these four</button>` : ''}</div>`;
}

// ------------------------------------------------------------------ picker
function suggestions(q) {
  const inCmp = new Set(S.compare);
  q = q.trim().toLowerCase();
  if (q) {
    return S.listings.filter((L) => !inCmp.has(L.id) && `${L.building} ${L.unit} ${L.address} ${L.neighborhood}`.toLowerCase().includes(q))
      .sort((a, b) => (score(b) ?? -1) - (score(a) ?? -1)).slice(0, 10).map((L) => ({ L, why: L._rank ? `Rank ${L._rank}` : 'Not ranked', g: 'Matches' }));
  }
  const tierOrd = (id) => { const t = pick(id).tier; return t ? TIERS.indexOf(t) : 4.5; };
  const saved = S.listings.filter((L) => isSaved(L.id) && !inCmp.has(L.id) && pick(L.id).tier !== 'Pass').sort((a, b) => tierOrd(a.id) - tierOrd(b.id) || (score(b) ?? 0) - (score(a) ?? 0)).slice(0, 6)
    .map((L) => ({ L, why: pick(L.id).tier ? `Your tier ${pick(L.id).tier}` : 'Saved', g: 'Your saved picks' }));
  const seen = new Set(saved.map((o) => o.L.id));
  const top = S.listings.filter((L) => L._rank && !inCmp.has(L.id) && !seen.has(L.id)).sort((a, b) => a._rank - b._rank).slice(0, 8 - Math.min(saved.length, 4))
    .map((L) => ({ L, why: `Rank ${L._rank}`, g: 'Top ranked' }));
  return [...saved, ...top];
}
function renderOpts() {
  const q = $('cmpQ').value;
  opts = suggestions(q);
  active = opts.length ? Math.max(0, Math.min(active, opts.length - 1)) : -1;
  let g = null;
  $('cmpList').innerHTML = opts.length ? opts.map((o, i) => {
    const head = o.g !== g ? `<div class="cl-g" role="presentation">${esc((g = o.g))}</div>` : '';
    return `${head}<div class="cl-o${i === active ? ' on' : ''}" role="option" id="cmpo-${i}" data-i="${i}" aria-selected="${i === active}"><span class="th">${thumb(o.L, 40, 32)}</span><span class="cl-t"><b>${name(o.L)}</b><span>${esc(o.L.neighborhood || '')}${o.L.neighborhood ? ' · ' : ''}${money(cost(o.L))} · ${esc(o.why)}</span></span><span class="cl-s" style="color:${scoreColor(score(o.L))}">${Math.round(score(o.L) ?? 0)}</span></div>`;
  }).join('') : `<div class="cl-none">No listing matches “${esc(q)}”</div>`;
  $('cmpQ').setAttribute('aria-activedescendant', active >= 0 ? `cmpo-${active}` : '');
  $('cmpList').querySelector('.cl-o.on')?.scrollIntoView({ block: 'nearest' });
}
function openList(open) {
  $('cmpList').hidden = !open; $('cmpQ').setAttribute('aria-expanded', open);
  if (open) renderOpts();
}
function add(id) {
  if (!id || S.compare.includes(id)) return;
  const full = S.compare.length >= 4, old = full ? byId(S.compare[0]) : null;
  toggleCompare(id);
  if (full && old) toast(`Compare holds four: replaced ${label(old)}`);
}

// ------------------------------------------------------------------ scatter
const nice = (a, z, n) => {
  const s = (z - a) / n, p = Math.pow(10, Math.floor(Math.log10(s))), st = [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= s);
  const o = []; for (let v = Math.ceil(a / st) * st; v <= z + 1e-9; v += st) o.push(v); return o;
};
function scatter(ids) {
  const box = $('cmpScatter'), pts = S.listings.filter((L) => L.score?.eligible && L.sqft && cost(L));
  if (pts.length < 3) { box.innerHTML = '<div class="empty" style="padding:24px">Needs at least three eligible listings with a published size and cost.</div>'; $('cmpScLegend').innerHTML = ''; return; }
  const W = Math.max(320, box.clientWidth || 800), H = Math.round(Math.max(260, Math.min(420, W * 0.5))), l = 56, r = 16, t = 14, b = 34;
  const xs = pts.map((L) => L.sqft).sort((a, c) => a - c), ys = pts.map(cost).sort((a, c) => a - c);
  const q = (a, p) => a[Math.max(0, Math.min(a.length - 1, Math.round(p * (a.length - 1))))];
  const x0 = Math.min(q(xs, 0.01), ...ids.map(byId).filter((L) => L?.sqft).map((L) => L.sqft)) * 0.96, x1 = Math.max(q(xs, 0.995), ...ids.map(byId).filter((L) => L?.sqft).map((L) => L.sqft)) * 1.03;
  const tiers = S.crit.budget?.tiers || [];
  const y0 = q(ys, 0.005) * 0.97, y1 = Math.max(q(ys, 0.995), ...tiers.map((x) => x.max).filter((m) => m <= q(ys, 0.995) * 1.08)) * 1.02;
  const X = (v) => l + ((Math.min(Math.max(v, x0), x1) - x0) / (x1 - x0)) * (W - l - r), Y = (v) => H - b - ((Math.min(Math.max(v, y0), y1) - y0) / (y1 - y0)) * (H - t - b);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Monthly cost against size for ${pts.length} eligible listings; your compare picks are lettered">`;
  for (const v of nice(x0, x1, Math.max(4, Math.round(W / 130)))) s += `<line class="gl" x1="${X(v)}" x2="${X(v)}" y1="${t}" y2="${H - b}"/><text class="ax" x="${X(v)}" y="${H - b + 16}" text-anchor="middle">${Math.round(v).toLocaleString()}</text>`;
  for (const v of nice(y0, y1, 5)) s += `<line class="gl" x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${l - 8}" y="${Y(v) + 3.5}" text-anchor="end">${moneyShort(v)}</text>`;
  s += `<text class="ax ttl" x="${W - r}" y="${H - 4}" text-anchor="end">size, ft² →</text>`;
  tiers.forEach((tr, i) => { if (tr.max > y0 && tr.max < y1) s += `<line x1="${l}" x2="${W - r}" y1="${Y(tr.max)}" y2="${Y(tr.max)}" stroke="var(${['--tier-1', '--tier-2', '--tier-3'][i] || '--tier-over'})" stroke-dasharray="4 4" stroke-opacity=".7"/><text class="ax tier" x="${W - r - 2}" y="${Y(tr.max) - 5}" text-anchor="end" fill="var(${['--tier-1', '--tier-2', '--tier-3'][i] || '--tier-over'})">${esc(tr.name)} ${moneyShort(tr.max)}</text>`; });
  // value frontier: homes no other listing beats on both size and cost
  const fr = []; let mn = Infinity;
  [...pts].sort((a, c) => c.sqft - a.sqft || cost(a) - cost(c)).forEach((L) => { if (cost(L) < mn) { fr.push(L); mn = cost(L); } });
  fr.sort((a, c) => a.sqft - c.sqft);
  if (fr.length > 1) s += `<polyline class="frontier" points="${fr.map((L) => `${X(L.sqft).toFixed(1)},${Y(cost(L)).toFixed(1)}`).join(' ')}"/>`;
  const sel = new Set(ids);
  for (const L of pts) {
    if (sel.has(L.id)) continue;
    s += `<circle class="pt${isSaved(L.id) ? ' sv' : ''}" cx="${X(L.sqft).toFixed(1)}" cy="${Y(cost(L)).toFixed(1)}" r="${isSaved(L.id) ? 5.5 : 4.2}" fill="${scoreColor(score(L))}" data-id="${esc(L.id)}"/>`;
  }
  ids.forEach((id, i) => {
    const L = byId(id); if (!L?.sqft || !cost(L)) return;
    const cx = X(L.sqft), cy = Y(cost(L));
    s += `<g class="pk" data-id="${esc(L.id)}" tabindex="0" role="button" aria-label="${esc(LET[i] + ': ' + label(L))}, ${money(cost(L))}, ${Math.round(L.sqft)} square feet. Open details"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="11" fill="${scoreColor(score(L))}"/><text x="${cx.toFixed(1)}" y="${(cy + 3.6).toFixed(1)}" text-anchor="middle">${LET[i]}</text></g>`;
  });
  box.innerHTML = s + '</svg><div class="cmp-tip" id="cmpTip" hidden></div>';
  const off = ids.filter((id) => { const L = byId(id); return L && !(L.sqft && cost(L) && L.score?.eligible); });
  $('cmpScLegend').innerHTML = `<span><i class="lg-dot"></i>Coloured by score</span><span><i class="lg-dot sv"></i>Saved pick</span><span><i class="lg-line"></i>Value frontier: nothing else is both larger and cheaper</span>${off.length ? `<span>${off.map((id) => LET[S.compare.indexOf(id)]).join(', ')} not plotted: size unknown or not eligible</span>` : ''}`;
}
function tip(e) {
  const g = e.target.closest?.('[data-id]'), T = $('cmpTip'); if (!T) return;
  if (!g) { T.hidden = true; return; }
  const L = byId(g.dataset.id); if (!L) return;
  const c = g.tagName === 'circle' ? g : g.querySelector('circle'), box = $('cmpScatter');
  T.innerHTML = `<b>${name(L)}</b><span>${esc(L.neighborhood || '')}</span><div><b>${money(cost(L))}</b><span>${Math.round(L.sqft)} ft² · $${ppsf(L).toFixed(2)}/ft²</span></div><div><span>Score</span><b style="color:${scoreColor(score(L))}">${Math.round(score(L))}</b>${L._rank ? `<span>rank ${L._rank}</span>` : ''}</div>`;
  T.hidden = false;
  const x = +c.getAttribute('cx'), y = +c.getAttribute('cy'), w = T.offsetWidth, h = T.offsetHeight;
  T.style.left = `${Math.min(box.clientWidth - w - 4, Math.max(4, x - w / 2))}px`;
  T.style.top = `${y - h - 14 < 0 ? y + 16 : y - h - 14}px`;
}

// ------------------------------------------------------------------ dimension chart
function dims(Ls) {
  const el = $('cmpDims');
  if (!Ls.length) { el.innerHTML = '<p class="faint" style="margin:0;font-size:var(--fs-sm)">Pick listings to see where each one wins.</p>'; return; }
  el.innerHTML = `<div class="dz">${DIMS.map(([k, n]) => {
    const vals = Ls.map((L) => L.score?.parts?.[k]), known = vals.filter((v) => v != null), top = known.length > 1 && new Set(known).size > 1 ? Math.max(...known) : null;
    return `<div class="dz-row"><div class="dz-k"><span>${esc(n)}</span><small>${weightShare(k)}%</small></div><div class="dz-lanes">${Ls.map((L, i) => {
      const v = vals[i];
      return v == null ? `<div class="dz-lane unk" title="${esc(label(L))}: unknown, counts as a neutral 50"><span class="dz-tr"></span><span class="dz-m q" style="left:50%">${LET[i]}</span></div>`
        : `<div class="dz-lane" title="${esc(label(L))}: ${Math.round(v)}"><span class="dz-tr"><i style="width:${v}%;background:${scoreColor(v)}"></i></span><span class="dz-m${v === top ? ' top' : ''}" style="left:${v}%">${LET[i]}</span></div>`;
    }).join('')}</div></div>`;
  }).join('')}<div class="dz-axis"><span></span><div><span>0</span><span>neutral 50</span><span>100</span></div></div></div>
  <div class="legend-row">${Ls.map((L, i) => `<span><b class="dz-key">${LET[i]}</b>${esc(label(L))}</span>`).join('')}<span>Hatched: unknown, scored as 50. Percent: your weight.</span></div>`;
}

// ------------------------------------------------------------------ render
function draw() {
  if (!shown) return;
  const ids = S.compare.filter(byId), Ls = ids.map(byId);
  $('cmpN').textContent = Ls.length ? `${Ls.length} of 4` : '';
  $('cmpSub').innerHTML = Ls.length ? 'The best value in each row is marked. Unknown facts stay unknown; they never count as the worst.' : 'Line up to four homes side by side.';
  $('cmpClear').hidden = !Ls.length;
  { const sites = S.manifest.sites || [], two = ids.filter((id) => sites.includes(id)).slice(0, 2); $('cmpPair').hidden = sites.length < 2; $('cmpPair').href = two.length === 2 ? `#pair/${two.map(encodeURIComponent).join(',')}` : '#pair'; }   // [pair] two homes in live 3D
  $('cmpBody').innerHTML = Ls.length ? boardHTML(Ls) : emptyHTML();
  $('cmpDimsPanel').hidden = !Ls.length;
  $('cmpDimsPanel').parentElement.classList.toggle('solo', !Ls.length);
  scatter(ids);
  dims(Ls);
}

export function init() {
  $('view-compare').innerHTML = `<div class="view-pad cmp-pad">
    <div class="page-h"><div class="t"><h1>Compare <span id="cmpN"></span></h1><p id="cmpSub"></p></div>
      <div class="actions">
        <div class="cmp-picker" id="cmpPicker">
          <label class="cmp-search"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="6" cy="6" r="4.5"/><path d="M9.5 9.5L13 13"/></svg>
            <input id="cmpQ" type="search" placeholder="Add a listing to compare" autocomplete="off" role="combobox" aria-label="Add a listing to compare" aria-expanded="false" aria-controls="cmpList" aria-autocomplete="list"></label>
          <div class="cmp-list" id="cmpList" role="listbox" aria-label="Suggestions" hidden></div>
        </div>
        <a class="btn" id="cmpPair" href="#pair" hidden title="Two apartments side by side in live 3D: the same date, time and camera, each with its own sun hours">Compare in 3D</a>
        <button type="button" class="btn ghost" id="cmpClear">Clear all</button>
      </div></div>
    <div id="cmpBody"></div>
    <div class="cmp-charts">
      <section class="panel"><h3>Cost against space <span>every eligible listing with a published size</span></h3><div class="cmp-scatter" id="cmpScatter"></div><div class="legend-row" id="cmpScLegend"></div></section>
      <section class="panel" id="cmpDimsPanel"><h3>Where each one wins <span>score by dimension</span></h3><div id="cmpDims"></div></section>
    </div></div>`;
  const q = $('cmpQ');
  q.addEventListener('focus', () => openList(true));
  q.addEventListener('input', () => { active = 0; openList(true); });
  q.addEventListener('blur', () => setTimeout(() => openList(false), 120));
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if ($('cmpList').hidden) openList(true); active = Math.max(0, Math.min(opts.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1))); renderOpts(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (opts[active]) { add(opts[active].L.id); q.value = ''; active = 0; renderOpts(); } }
    else if (e.key === 'Escape') { e.stopPropagation(); if (q.value) { q.value = ''; renderOpts(); } else { openList(false); q.blur(); } }
  });
  $('cmpList').addEventListener('mousedown', (e) => e.preventDefault());
  $('cmpList').addEventListener('click', (e) => { const o = e.target.closest('.cl-o'); if (o) { add(opts[+o.dataset.i]?.L.id); q.value = ''; renderOpts(); } });
  $('cmpClear').addEventListener('click', () => { [...S.compare].forEach((id) => toggleCompare(id)); toast('Cleared the comparison'); });
  $('cmpBody').addEventListener('click', (e) => {
    const t = e.target.closest('[data-rm],[data-save],[data-open],[data-add],#cmpTop,#cmpSlot'); if (!t) return;
    if (t.dataset.rm) toggleCompare(t.dataset.rm);
    else if (t.dataset.save) toggleSave(t.dataset.save);
    else if (t.dataset.open) openDrawer(t.dataset.open);
    else if (t.dataset.add) add(t.dataset.add);
    else if (t.id === 'cmpTop') suggestions('').slice(0, 4).forEach((o) => add(o.L.id));
    else if (t.id === 'cmpSlot') q.focus();
  });
  const sc = $('cmpScatter');
  sc.addEventListener('mousemove', tip);
  sc.addEventListener('mouseleave', () => { const T = $('cmpTip'); if (T) T.hidden = true; });
  sc.addEventListener('click', (e) => { const g = e.target.closest('[data-id]'); if (g) openDrawer(g.dataset.id); });
  sc.addEventListener('keydown', (e) => { const g = e.target.closest('.pk'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDrawer(g.dataset.id); } });
  sc.addEventListener('focusin', tip);
  sc.addEventListener('focusout', () => { const T = $('cmpTip'); if (T) T.hidden = true; });
  const redraw = debounce(() => isOn() && scatter(S.compare.filter(byId)), 120);
  if ('ResizeObserver' in window) new ResizeObserver(redraw).observe(sc); else addEventListener('resize', redraw);
  const again = () => isOn() && draw();
  on('compare', again); on('weights', debounce(again, 60)); on('saved', again);
}

export function show(arg) {
  shown = true;
  if (arg) {
    const want = arg.split(',').map((x) => x.trim()).filter((id) => byId(id)).slice(0, 4);
    if (want.length) {
      [...S.compare].filter((id) => !want.includes(id)).forEach((id) => toggleCompare(id));
      want.filter((id) => !S.compare.includes(id)).forEach((id) => toggleCompare(id));
    }
  }
  draw();
}
