// Small shared pieces for the Research sub-views: sparkline, empty state, copy-to-clipboard, thumbnails.
import { esc, money, toast } from '../util.js';
import { thumb as kitThumb } from '../views/table-kit.js';
import { imagesOf, mediaSrc } from '../util.js';
import { illustration } from '../features/empty.js';   // [feature C] empty-state art

/** Price sparkline: one line, the last point marked; colour says which way the price went. */
export function sparkline(pts, w = 96, h = 26, { label = '' } = {}) {
  if (!pts || pts.length < 2) return '';
  const vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const pad = 3, x = (i) => pad + (i / (pts.length - 1)) * (w - pad * 2), y = (v) => h - pad - ((v - lo) / span) * (h - pad * 2);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join('');
  const first = vs[0], last = vs[vs.length - 1];
  const tone = last < first ? 'down' : last > first ? 'up' : 'flat';
  const title = `${label ? label + ': ' : ''}${pts.map((p) => `${p.date} ${money(p.v)}`).join(', ')}`;
  return `<svg class="rs-spark ${tone}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>
    <path d="${d}L${x(pts.length - 1).toFixed(1)} ${h}L${x(0).toFixed(1)} ${h}Z" class="a"/><path d="${d}" class="l"/>
    <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2.4" class="p"/></svg>`;
}

/** Empty state with an icon tile, a title, a line of help and an optional command. */
export function empty(icon, title, body, cmd) {
  const kind = { [IC.clock]: 'history', [IC.pulse]: 'history', [IC.image]: 'media', [IC.queue]: 'queue', [IC.eye]: 'watch' }[icon];   // [feature C] a drawn scene for each tab
  return `<div class="empty rs-empty${kind ? ' has-ill' : ''}">${kind ? illustration(kind) : `<span class="rs-ill" aria-hidden="true">${icon}</span>`}<b>${esc(title)}</b><span>${body}</span>${cmd ? `<code class="rs-cmd">${esc(cmd)}</code>` : ''}</div>`;
}

/** A note written by the pipeline (plain text with `code` spans), made safe for HTML. */
export const noteHTML = (t) => esc(String(t || '')).replace(/`([^`]+)`/g, '<code class="rs-code">$1</code>');

export async function copyText(text, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(what); return; } catch { /* fall back below */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.append(ta); ta.select();
  try { document.execCommand('copy'); toast(what); } catch { toast('Copy failed: select the text and copy it'); }
  ta.remove();
}

/** Listing photo, else licensed building photo, else the unit glyph. */
export function thumb(L, w = 56, h = 44) {
  const im = imagesOf(L);
  const u = im.own[0] || im.building[0]?.url;
  return u ? `<img src="${esc(mediaSrc(u))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="${w}" height="${h}">` : kitThumb(L, w, h);
}

export const IC = {
  queue: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 4h8M5 8h8M5 12h5"/><circle cx="2.5" cy="4" r=".8" fill="currentColor"/><circle cx="2.5" cy="8" r=".8" fill="currentColor"/><circle cx="2.5" cy="12" r=".8" fill="currentColor"/></svg>',
  pulse: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M1.5 8.5h3l2-5 3 9 2-4h3"/></svg>',
  clock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>',
  eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  image: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><circle cx="5.8" cy="6.2" r="1.2"/><path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3"/></svg>',
  copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5"/></svg>',
  chev: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg>',
  left: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>',
  right: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>',
  pin: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M6 5h1M9 5h1M6 8h1M9 8h1M7 14v-3h2v3"/></svg>',
};
