// Watchlist: buildings worth checking for new units, with how long since each was checked, units seen, the units
// we track there, a link to the building's own site and a small schematic map drawn over the subway lines.
import { S, openDrawer, cost, store, dest } from '../app.js';
import { esc, money, ICONS } from '../util.js';
import { R, watchRows, events, fmtDate, ageText, parseDate } from './model.js';
import { empty, noteHTML, IC } from './ui.js';

const st = { sort: store.get('research-watch-sort', 'due'), sel: null };
const W = 600, H = 440;
const tone = (age) => (age == null || age > 21 ? 'bad' : age > 7 ? 'warn' : 'good');

function project(rows) {
  const P = rows.filter((r) => r.lat != null);
  if (!P.length) return null;
  let la0 = Math.min(...P.map((r) => r.lat)), la1 = Math.max(...P.map((r) => r.lat)), lo0 = Math.min(...P.map((r) => r.lon)), lo1 = Math.max(...P.map((r) => r.lon));
  const k = Math.cos(((la0 + la1) / 2) * Math.PI / 180);
  const cy = (la0 + la1) / 2, cx = (lo0 + lo1) / 2;
  let sy = Math.max(la1 - la0, 0.012) * 1.35, sx = Math.max((lo1 - lo0) * k, 0.012) * 1.35;
  if (sx / sy > W / H) sy = sx * H / W; else sx = sy * W / H;
  const f = (lat, lon) => [W / 2 + ((lon - cx) * k / sx) * W, H / 2 - ((lat - cy) / sy) * H];
  return { f, box: [cx - sx / k, cy - sy, cx + sx / k, cy + sy], mPerPx: (sx * 111320) / W };
}

function mapHTML(rows, order) {
  const pj = project(rows);
  if (!pj) return `<div class="wl-map wl-nomap"><span class="faint">No coordinates for the watched buildings, so there is no map.</span></div>`;
  const [x0, y0, x1, y1] = pj.box, inBox = (lo, la) => lo >= x0 && lo <= x1 && la >= y0 && la <= y1;
  const feats = S.transit?.features || [];
  const lines = feats.filter((f) => f.properties?.kind === 'line' && f.geometry?.type === 'MultiLineString').map((f) => {
    const d = f.geometry.coordinates.filter((ln) => ln.some(([lo, la]) => inBox(lo, la))).map((ln) => ln.map(([lo, la], i) => { const [x, y] = pj.f(la, lo); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join('')).join('');
    return d ? `<path d="${d}" stroke="${esc(f.properties.color || '#7c858c')}" class="wl-line"/>` : '';
  }).join('');
  const stations = feats.filter((f) => f.properties?.kind === 'station' && f.geometry?.type === 'Point' && inBox(...f.geometry.coordinates)).map((f) => { const [x, y] = pj.f(f.geometry.coordinates[1], f.geometry.coordinates[0]); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" class="wl-stn"><title>${esc(f.properties.name || '')}</title></circle>`; }).join('');
  const homes = S.listings.filter((L) => L.lat != null && inBox(L.lon, L.lat)).map((L) => { const [x, y] = pj.f(L.lat, L.lon); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8" class="wl-home"/>`; }).join('');
  const pins = order.filter((r) => r.lat != null).map((r) => {
    const [x, y] = pj.f(r.lat, r.lon), n = order.indexOf(r) + 1;
    return `<g class="wl-pin ${tone(r.age)}${st.sel === r.key ? ' on' : ''}" data-pin="${esc(r.key)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" tabindex="0" role="button" aria-label="${esc(r.name)}, checked ${esc(ageText(r.checked))}"><circle r="11"/><text y="4">${n}</text></g>`;
  }).join('');
  const d = dest();
  let office = '';
  if (d?.lat != null && inBox(d.lon, d.lat)) {
    const [x, y] = pj.f(d.lat, d.lon);
    office = `<g class="wl-dest" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><rect x="-7" y="-7" width="14" height="14" rx="3.5"/><text x="11" y="4">${esc(d.name || 'Destination')}</text></g>`;
  }
  const m = [100, 200, 250, 500, 1000, 2000].find((v) => v / pj.mPerPx >= 60) || 2000, px = m / pj.mPerPx;
  const scale = `<g class="wl-scale" transform="translate(${W - 16 - px} ${H - 18})"><path d="M0 -5V0H${px.toFixed(1)}V-5"/><text x="${(px / 2).toFixed(1)}" y="-8">${m >= 1000 ? m / 1000 + ' km' : m + ' m'}</text></g><g class="wl-north" transform="translate(${W - 22} 24)"><path d="M0 -10L5 4L0 1L-5 4Z"/><text y="16">N</text></g>`;
  return `<div class="wl-map"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="group" aria-label="Map of watched buildings with subway lines"><rect width="${W}" height="${H}" class="wl-bg"/>${lines}${stations}${homes}${office}${pins}${scale}</svg>
    <div class="wl-key"><span><i class="good"></i>Checked this week</span><span><i class="warn"></i>8–21 days</span><span><i class="bad"></i>Older or never</span><span><i class="home"></i>Tracked homes</span>${office ? `<span><i class="dest"></i>${esc(d.name || 'Destination')}</span>` : ''}<span class="sp"></span><span>Schematic: subway lines and stations only</span></div></div>`;
}

function cardHTML(r, n, recentNew) {
  const nw = r.units.map((L) => recentNew.get(L.id)).filter(Boolean).sort().reverse()[0];
  const live = r.units.filter((L) => !['gone', 'rejected'].includes(L.status || 'new'));
  return `<li class="wl${st.sel === r.key ? ' on' : ''}" data-k="${esc(r.key)}" id="wl-${n}" tabindex="-1">
    <div class="wl-h"><span class="wl-num ${tone(r.age)}">${n}</span><div class="wl-t"><b>${esc(r.name)}</b><span>${esc(r.address)}</span></div>
      <span class="pill ${tone(r.age)}" title="${r.checked ? 'Last checked ' + esc(fmtDate(r.checked)) : 'Never checked'}">${r.checked ? 'Checked ' + esc(ageText(r.checked)) : 'Never checked'}</span></div>
    ${r.reason ? `<p class="wl-r">${esc(r.reason)}</p>` : ''}
    <div class="wl-f"><span><b class="tnum">${r.seen ?? '?'}</b> unit${r.seen === 1 ? '' : 's'} seen</span><span><b class="tnum">${live.length}</b> in play here${r.units.length > live.length ? ` · ${r.units.length - live.length} gone or passed` : ''}</span>
      ${nw ? `<span class="pill good">New unit ${esc(fmtDate(nw))}</span>` : ''}<span class="sp"></span>
      ${r.url ? `<a class="d-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Building site ${ICONS.ext}</a>` : '<span class="faint">No link</span>'}</div>
    ${live.length ? `<div class="wl-u">${live.slice(0, 5).map((L) => `<button type="button" class="chip" data-open="${esc(L.id)}">${esc(L.unit || 'Unit')}<span class="n">${esc(money(cost(L)))}</span></button>`).join('')}${live.length > 5 ? `<span class="faint">+ ${live.length - 5} more</span>` : ''}</div>` : ''}
  </li>`;
}

export function render(el) {
  if (!R.watch) {
    el.innerHTML = empty(IC.eye, 'No buildings on the watchlist', 'Buildings you would move into but that have nothing available right now go here, with why you want them and when someone last looked, so a new unit is caught on day one.', 'apartmentscout build');
    return;
  }
  const rows = watchRows();
  if (!rows.length) { el.innerHTML = empty(IC.eye, 'The watchlist is empty', R.watch.note ? noteHTML(R.watch.note) : 'Add buildings worth checking for new units; they appear here with the last time anyone looked.'); return; }
  const E = events(), ref = E.length ? parseDate(E[0].date) : null;
  const recentNew = new Map(E.filter((e) => e.type === 'new' && ref != null && (ref - parseDate(e.date)) / 864e5 <= 14).map((e) => [e.id, e.date]));
  const order = [...rows].sort(st.sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : st.sort === 'units' ? (a, b) => (b.seen ?? -1) - (a.seen ?? -1) : (a, b) => (b.age ?? 1e6) - (a.age ?? 1e6));
  const due = rows.filter((r) => r.age == null || r.age > 7).length;
  el.innerHTML = `<div class="rs-bar-row">
      <p class="rs-sub" style="margin:0">${rows.length} building${rows.length > 1 ? 's' : ''} · <b>${due}</b> due a check (more than a week)</p><span class="sp"></span>
      <div class="seg" role="group" aria-label="Order">${[['due', 'Due first'], ['name', 'Name'], ['units', 'Units seen']].map(([k, t]) => `<button type="button" data-s="${k}" class="${st.sort === k ? 'on' : ''}" aria-pressed="${st.sort === k}">${t}</button>`).join('')}</div>
    </div>
    <div class="wl-wrap">${mapHTML(rows, order)}<ol class="wl-list">${order.map((r, i) => cardHTML(r, i + 1, recentNew)).join('')}</ol></div>`;
  el.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { st.sort = b.dataset.s; store.set('research-watch-sort', st.sort); render(el); el.querySelector(`[data-s="${b.dataset.s}"]`)?.focus(); }));
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.open)));
  const hl = (k, on) => {
    el.querySelectorAll('.wl-pin').forEach((p) => p.classList.toggle('hl', on && p.dataset.pin === k));
    el.querySelectorAll('.wl').forEach((c) => c.classList.toggle('hl', on && c.dataset.k === k));
  };
  el.querySelectorAll('.wl').forEach((c) => {
    c.addEventListener('mouseenter', () => hl(c.dataset.k, true)); c.addEventListener('mouseleave', () => hl(c.dataset.k, false));
    c.addEventListener('focusin', () => hl(c.dataset.k, true)); c.addEventListener('focusout', () => hl(c.dataset.k, false));
  });
  const choose = (k) => {
    st.sel = k;
    el.querySelectorAll('.wl-pin').forEach((p) => p.classList.toggle('on', p.dataset.pin === k));
    el.querySelectorAll('.wl').forEach((c) => c.classList.toggle('on', c.dataset.k === k));
    const card = [...el.querySelectorAll('.wl')].find((c) => c.dataset.k === k);
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); card?.focus({ preventScroll: true });
  };
  el.querySelectorAll('.wl-pin').forEach((p) => {
    p.addEventListener('click', () => choose(p.dataset.pin));
    p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(p.dataset.pin); } });
    p.addEventListener('mouseenter', () => hl(p.dataset.pin, true)); p.addEventListener('mouseleave', () => hl(p.dataset.pin, false));
  });
}
