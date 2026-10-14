// Small shared pieces for the Shortlist, Compare and Tours views: thumbnails, gate labels, amenity
// states and formatting. Everything that comes from data goes through esc() or safeUrl().
import { S, cost, commuteOf, dests, tierIndex, TIER_VARS, pick, score, label } from '../app.js';
import { esc, money, safeUrl, bullets, COMPASS, scoreColor } from '../util.js';

export const TIERS = ['S', 'A', 'B', 'C', 'Pass'];
// $/ft² from the scorer (v2 gives null for proxy sizes); older data falls back to cost / reported size
export const ppsf = (L) => { const p = L.score?.ppsf; if (p && typeof p === 'object') return p.value ?? null; if (typeof p === 'number') return p; if (L.score?.version) return null; return L.sqft && cost(L) ? cost(L) / L.sqft : null; };
export const num = (v, d = 0) => (v == null || isNaN(v) ? null : Number(v).toFixed(d));
export const groupKey = (L) => String(L.building || L.address || L.id).trim().toLowerCase();

const GATE_NAMES = { in_unit_wd: 'in-unit W/D', elevator: 'elevator', doorman: 'doorman', gym: 'gym', dishwasher: 'dishwasher', pets: 'pets' };
const gateFacts = (g) => (g.split(':')[1] || '').split(',').map((x) => GATE_NAMES[x] || x.replaceAll('_', ' ')).filter(Boolean);
/** Hard failures: over budget or a must-have that is known to be missing. */
export function gateFails(L) {
  return (L.score?.gates || []).filter((g) => g === 'over_budget' || g.startsWith('fails')).map((g) => (g === 'over_budget' ? 'Over budget' : 'No ' + gateFacts(g).join(', ')));
}
/** Must-haves nobody has confirmed yet. */
export function gateUnverified(L) {
  return (L.score?.gates || []).filter((g) => g.startsWith('unverified')).flatMap(gateFacts);
}
export const costUnknown = (L) => (L.score?.gates || []).includes('unknown_cost');

/** A compact stand-in for a photo: the tower with this floor lit, and a compass with the exposure. */
export function miniGlyph(L, w = 56, h = 44) {
  const fl = Math.round(L.floor || 0), top = 6, bot = h - 5, n = Math.min(50, Math.max(12, fl + 4));
  const tx = w * 0.16, tw = w * 0.26;
  const y = fl ? bot - (fl / n) * (bot - top) : null;
  const cx = w * 0.7, cy = h * 0.56, r = Math.min(w, h) * 0.24;
  const rays = (L.exposure || []).map((e) => COMPASS[e]).filter((a) => a != null).map((a) => {
    const t = ((a - 90) * Math.PI) / 180;
    return `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(t) * r * 0.92).toFixed(1)}" y2="${(cy + Math.sin(t) * r * 0.92).toFixed(1)}" stroke="var(--sun)" stroke-width="2" stroke-linecap="round"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><rect width="${w}" height="${h}" fill="var(--surface-3)"/>`
    + `<rect x="${tx}" y="${top}" width="${tw}" height="${bot - top}" rx="1.5" fill="var(--surface-1)" stroke="var(--line-strong)"/>`
    + Array.from({ length: 9 }, (_, i) => `<rect x="${tx + 2.5}" y="${(top + 2.5 + i * ((bot - top - 4) / 9)).toFixed(1)}" width="${tw - 5}" height="1.4" rx=".6" fill="var(--ink-4)" opacity=".35"/>`).join('')
    + (y != null ? `<rect x="${tx + 1.5}" y="${(y - 1.2).toFixed(1)}" width="${tw - 3}" height="2.6" rx="1" fill="var(--sun)"/>` : '')
    + `<text x="${cx}" y="${cy - r - 2}" text-anchor="middle" font-size="5.5" font-family="var(--font-mono)" fill="var(--ink-3)">N</text>`
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line-strong)"/>`
    + (rays || `<text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="8" font-family="var(--font-sans)" fill="var(--ink-3)">?</text>`)
    + '</svg>';
}
/** Listing photo when there is one, otherwise the mini glyph. */
export function thumb(L, w = 56, h = 44) {
  const ph = (L.photos || []).map(safeUrl).find(Boolean);
  return ph ? `<img src="${esc(ph)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="${w}" height="${h}">` : miniGlyph(L, w, h);
}

export function tierPill(L, short = false) {
  const t = L.score?.budget_tier; if (!t) return '<span class="faint">—</span>';
  const i = tierIndex(L);
  return `<span class="tierpill" style="color:var(${i >= 0 ? TIER_VARS[i] : '--tier-over'});background:var(--surface-3)"><i></i>${esc(short && t === 'Slightly over' ? 'Over a bit' : t)}</span>`;
}
export function myTierPill(id) {
  const t = pick(id).tier;
  return t ? `<span class="pill ${t === 'Pass' ? '' : 'accent'} my-tier" title="Your tier">${esc(t)}</span>` : '';
}

const I = {
  yes: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  no: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};
/** True / false / unknown, with words for screen readers. Missing must-haves read as bad. */
export function tri(v, { must = false, what = '' } = {}) {
  if (v === true) return `<span class="tri yes" title="${esc(what)}: yes">${I.yes}<span class="sr">yes</span></span>`;
  if (v === false) return `<span class="tri ${must ? 'bad' : 'no'}" title="${esc(what)}: no">${I.no}<span class="sr">no</span></span>`;
  return `<span class="tri unk${must ? ' must' : ''}" title="${esc(what)}: not confirmed${must ? ' (a must-have: ask before you tour)' : ''}">?<span class="sr">unknown</span></span>`;
}
export function doorman(v) {
  if (v === 'full-time') return `<span class="tri yes" title="Full-time doorman">${I.yes}<span class="sr">full-time</span></span>`;
  if (v === 'part-time' || v === 'virtual') return `<span class="door-txt" title="${esc(v)} doorman">${v === 'virtual' ? 'Virtual' : 'Part'}</span>`;
  if (v === 'none') return `<span class="tri no" title="No doorman">${I.no}<span class="sr">none</span></span>`;
  return `<span class="tri unk" title="Doorman not confirmed">?<span class="sr">unknown</span></span>`;
}
export const isMust = (k) => (S.crit.must_have || []).includes(k);

export function floorText(L) {
  if (L.floor == null) return '<span class="faint">—</span>';
  const f = `${Math.round(L.floor)}${L.floor_inferred ? '<span class="inf" title="Floor inferred from the unit number">?</span>' : ''}`;
  return L.exposure?.length ? `${f}<span class="exp"> · ${esc(L.exposure.join('/'))}</span>` : f;
}
export function commuteHTML(L, d = dests()[0]) {
  const c = commuteOf(L, d);
  if (c == null) return '<span class="faint">—</span>';
  const r = L.commute?.[d]?.route, b = bullets(r, 3);
  return `<span class="cm">${b ? `<span class="line-bullets">${b}</span>` : '<span class="walk" title="Walk"></span>'}<b>${Math.round(c)}</b><span class="u">min</span></span>`;
}
export function scoreBar(v) {
  return `<span class="t-score"><span class="t-bar"><i style="width:${Math.max(0, Math.min(100, v ?? 0))}%;background:${scoreColor(v)}"></i></span><b>${v == null ? '?' : Math.round(v)}</b></span>`;
}
export function statusPill(L) {
  const s = L.status || 'new';
  const cls = { shortlist: 'accent', touring: 'accent', applied: 'good', rejected: 'bad', gone: '' }[s] ?? '';
  return `<span class="pill ${cls}">${esc(s[0].toUpperCase() + s.slice(1))}</span>`;
}
export const name = (L) => `${esc(L.building || L.address)}${L.unit ? ` <span class="u">${esc(L.unit)}</span>` : ''}`;
export { label, money, score };

/** Great-circle distance in km. */
export function km(a, b) {
  const R = 6371, t = Math.PI / 180;
  const dLa = (b.lat - a.lat) * t, dLo = (b.lon - a.lon) * t;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Walking minutes on the street grid: straight line × 1.25 detour at 4.8 km/h. */
export const walkMin = (a, b, kmh = 4.8) => (km(a, b) * 1.25 / kmh) * 60;
