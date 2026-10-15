// Share shortlist and decision memo, in the browser. One click on "Share shortlist" downloads a read-only, self-contained
// HTML of the saved picks (cards, key facts, thumbnails, a map, the reasons each ranks where it does); "Decision memo"
// opens the same document on its print layout (Save as PDF). Both come from dashboard/share/snapshot.html, the template
// `apartmentscout share` uses too. Notes stay out unless the box is ticked; tour times never leave. The payload is built by
// share-model.js (pure); this file does what needs the page: the template, thumbnails, the buttons.
import { S, on, store, byId, dest, download } from '../app.js';
import { $, toast } from '../util.js';
import { watch } from './dom.js';
import { chainOf, isDead, remoteUrl, rememberOriginal } from './media-chain.js';
import { parseSchema, inlinePayload, buildPayload, photoCandidates, fileSlug } from './share-model.js';

const SHARE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 10.5V2.2M4.9 5.2L8 2.1l3.1 3.1M3 8.5v4.3a1 1 0 001 1h8a1 1 0 001-1V8.5"/></svg>';
const MEMO_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 1.8h5.6l2.9 2.9v9.5H4zM9.6 1.8v3h3M6 8h4.5M6 10.5h4.5"/></svg>';
const FILE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10"/></svg>';
const CHEV = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 6.5l4 4 4-4"/></svg>';

let busy = false, tpl = null;
const opts = () => ({ notes: !!store.get('share-notes', false), tourPhotos: !!store.get('share-tourphotos', false),   // [feature K] visit photos: opt-in
   photos: ['embed', 'link', 'none'].includes(store.get('share-photos', 'embed')) ? store.get('share-photos', 'embed') : 'embed' });
const savedIds = () => Object.entries(S.picks).filter(([id, p]) => (p.saved || p.tier) && p.tier !== 'Pass' && byId(id)).map(([id]) => id);

// ------------------------------------------------------------------ building
async function template() {
  if (tpl) return tpl;
  const emb = window.__AS_DATA__?.['share/snapshot.html'];
  if (typeof emb === 'string') return (tpl = emb);
  const r = await fetch(new URL('share/snapshot.html', document.baseURI), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`the share template did not load (${r.status})`);
  return (tpl = await r.text());
}
/** A thumbnail of an image as a JPEG data URI, or null when it cannot be read (blocked by CORS, missing, not an image). */
async function thumb(url, px, quality) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, referrerPolicy: 'no-referrer', credentials: 'omit', mode: 'cors' });
    if (!r.ok) return null;
    const blob = await r.blob();
    if (!/^image\//.test(blob.type)) return null;
    const bmp = await createImageBitmap(blob), k = Math.min(1, px / bmp.width), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h); bmp.close?.();
    return c.toDataURL('image/jpeg', quality);
  } catch { return null; } finally { clearTimeout(timer); }
}
const abs = (u) => { try { return new URL(u, document.baseURI).href; } catch { return null; } };
/** Up to max_per_home photos per home: an embedded thumbnail of the saved copy while the byte budget lasts (every home's
 *  first photo before anyone's second), else a link to the original. Returns { photos, bytes, embedded, linked }. */
async function resolvePhotos(homes, schema, mode, progress) {
  const cfg = schema.photos, out = {}, budget = cfg.budget_kb * 1024, tally = { bytes: 0, embedded: 0, linked: 0 };
  if (mode === 'none') return { photos: out, ...tally };
  const cands = homes.map((L) => photoCandidates(L).map((c) => ({ ...c })));
  const total = homes.length * cfg.max_per_home; let done = 0;
  for (let round = 0; round < cfg.max_per_home; round++) {
    const queue = homes.map((L, i) => i).filter((i) => (out[homes[i].id]?.length || 0) <= round);
    const worker = async () => {
      for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
        const L = homes[i];
        for (const c of cands[i]) {
          if (c.done) continue;
          c.done = true;
          let src = null;
          if (mode === 'embed' && tally.bytes < budget) {
            // the photo's fallback chain (media/, media-lite/, the published copy, the original link): the first that can be read.
            // A page opened as a file cannot read its sibling files (the browser refuses with a console error): links only.
            const urls = [];
            if (c.local) {
              if (c.ref) rememberOriginal(c.local, c.ref);
              for (const x of chainOf(c.local)) { const u = abs(x.url); if (u && !isDead(x.tier) && (location.protocol !== 'file:' || /^https?:/.test(u))) urls.push(u); }
            } else if (c.ref && /^https?:/.test(c.ref)) urls.push(c.ref);
            let uri = null;
            for (const u of urls) { uri = await thumb(u, cfg.thumb_px, cfg.quality); if (uri) break; }
            if (uri && tally.bytes + uri.length <= budget) { src = uri; tally.bytes += uri.length; tally.embedded++; }
          }
          const link = c.ref || (c.local && remoteUrl(c.local));   // the original link, else the published copy
          if (!src && link) { src = link; tally.linked++; }
          if (src) { (out[L.id] ||= []).push({ src, ...(c.credit ? { credit: c.credit } : {}) }); break; }
        }
        progress?.(Math.min(total, ++done), total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  }
  return { photos: out, ...tally };
}

/** The finished HTML for the saved picks. `view` is the layout it opens on. */
async function build({ view, notes, photos, tourPhotos = false, progress }) {
  const ids = savedIds();
  if (!ids.length) throw new Error('none');
  const [text] = await Promise.all([template()]);
  const schema = parseSchema(text), homes = ids.map(byId);
  const ph = await resolvePhotos(homes, schema, photos, progress);
  // [feature K] the renter's visit findings and decision trail (visit photos only when ticked)
  let extras = {};
  try { extras = await (await import('./tour-findings.js')).shareExtras(ids, { notes, photos: tourPhotos, cfg: schema.tour_photos }); } catch (e) { console.warn('visit findings left out of the page', e); }
  const payload = buildPayload({ listings: S.listings, crit: S.crit, picks: S.picks, weights: S.weights, includeNotes: notes, view, transit: S.transit?.features || [], schema,
    photos: ph.photos, commuteMode: S.commuteMode, destName: dest()?.name || null, extras });
  payload.photo_bytes = ph.bytes;
  const html = inlinePayload(text, payload);
  return { html, n: payload.homes.length, photoStats: ph, kb: Math.round(html.length / 1024) };
}
const stamp = () => new Date().toISOString().slice(0, 10);
const nameFor = (kind) => `${kind}-${fileSlug(S.crit.search?.name)}-${stamp()}.html`;

// ------------------------------------------------------------------ actions
function setBusy(v, label) {
  busy = v;
  document.querySelectorAll('.share-main').forEach((b) => { b.disabled = v; b.dataset.label ??= b.querySelector('.sl')?.textContent; const l = b.querySelector('.sl'); if (l) l.textContent = v ? (label || 'Preparing…') : b.dataset.label; });
  document.querySelectorAll('.share-pop button[data-act]').forEach((b) => { b.disabled = v; });
}
function noPicks() { toast('Star a few homes first, then share them (press s on a home)'); }
async function run(act) {
  if (busy) return;
  if (!savedIds().length) { noPicks(); return; }
  const o = opts();
  setBusy(true);
  try {
    const progress = (a, b) => setBusy(true, o.photos === 'none' ? 'Preparing…' : `Photos ${a}/${b}`);
    const memo = act === 'memo' || act === 'memo-file';
    const r = await build({ view: memo ? 'memo' : 'cards', notes: o.notes, photos: o.photos, tourPhotos: o.tourPhotos, progress });
    const blob = new Blob([r.html], { type: 'text/html' });
    const sizeNote = `${r.n} home${r.n === 1 ? '' : 's'}, ${r.kb >= 1024 ? (r.kb / 1024).toFixed(1) + ' MB' : r.kb + ' KB'}`;
    if (act === 'memo') {
      const url = URL.createObjectURL(blob) + '#memo-print', w = window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url.split('#')[0]), 120000);
      if (!w) { download(nameFor('decision-memo'), r.html, 'text/html'); toast(`Your browser blocked the new tab: the memo was saved as a file (${sizeNote}). Open it and print.`, 4200); }
      else toast(`Decision memo ready: ${sizeNote}. Choose Save as PDF in the print dialog.`, 3600);
    } else {
      download(nameFor(memo ? 'decision-memo' : 'shortlist'), r.html, 'text/html');
      const p = r.photoStats;
      toast(`${memo ? 'Memo' : 'Shortlist'} saved: ${sizeNote}${p.embedded ? `, ${p.embedded} photo${p.embedded === 1 ? '' : 's'} embedded` : ''}${p.linked ? `, ${p.linked} linked` : ''}.`, 3800);
    }
  } catch (e) {
    toast(String(e?.message) === 'none' ? 'Star a few homes first' : `Could not build the page: ${e?.message || e}`, 4200);
  } finally { setBusy(false); }
}

// ------------------------------------------------------------------ the buttons
function popHTML(id) {
  const n = savedIds().length, o = opts();
  return `<div class="sp-h"><b>Share your picks</b><span>${n ? `${n} saved home${n === 1 ? '' : 's'} · Pass left out` : 'No saved homes yet'}</span></div>
    <button type="button" class="sp-i" data-act="share">${SHARE_ICON}<span><b>Share shortlist</b><small>Read-only HTML: cards, map and the reasons for each rank</small></span></button>
    <button type="button" class="sp-i" data-act="memo">${MEMO_ICON}<span><b>Decision memo</b><small>Print-ready: choose Save as PDF</small></span></button>
    <button type="button" class="sp-i" data-act="memo-file">${FILE_ICON}<span><b>Download memo as HTML</b><small>Same pages, as a file</small></span></button>
    <div class="sp-opts"><label class="sp-o"><input type="checkbox" data-opt="notes" ${o.notes ? 'checked' : ''}><span>Include my notes</span></label>
      <label class="sp-o"><input type="checkbox" data-opt="tourphotos" ${o.tourPhotos ? 'checked' : ''}><span>Include my visit photos</span></label>
      <label class="sp-o"><span>Photos</span><select class="sel" data-opt="photos" aria-label="Photos in the shared page"><option value="embed" ${o.photos === 'embed' ? 'selected' : ''}>Embedded thumbnails</option><option value="link" ${o.photos === 'link' ? 'selected' : ''}>Links only</option><option value="none" ${o.photos === 'none' ? 'selected' : ''}>None</option></select></label>
      <p class="sp-n">Notes stay out unless ticked. Your visit findings and decision trail go in; visit photos only when ticked. Tour times, filters and everything else stay in this browser.</p></div>`;
}
let uid = 0;
/** A split button: the left half shares in one click, the right half opens the options. */
function mountSplit(host, { cls = '' } = {}) {
  if (host.querySelector('.share-split')) return;
  const id = `sharePop${++uid}`, wrap = document.createElement('div');
  wrap.className = `share-split ${cls}`;
  wrap.innerHTML = `<button type="button" class="btn sm share-main" data-act="share" aria-label="Share shortlist" title="Download a read-only page of your saved picks">${SHARE_ICON}<span class="sl">Share shortlist</span></button><button type="button" class="btn sm share-more" aria-haspopup="true" aria-expanded="false" aria-controls="${id}" aria-label="More ways to share: decision memo and options" title="Decision memo and options">${CHEV}</button>
    <div class="menu-pop share-pop" id="${id}" role="group" aria-label="Share options" hidden></div>`;
  host.append(wrap);
  const sync = () => wrap.querySelector('.share-main').classList.toggle('is-empty', !savedIds().length);
  sync(); on('saved', sync);
  const more = wrap.querySelector('.share-more'), pop = wrap.querySelector('.share-pop');
  const set = (open, focus) => { if (open) pop.innerHTML = popHTML(id); pop.hidden = !open; more.setAttribute('aria-expanded', String(open)); if (open && focus) pop.querySelector('button')?.focus(); };
  more.addEventListener('click', (e) => { e.stopPropagation(); set(pop.hidden, e.detail === 0); });
  wrap.querySelector('.share-main').addEventListener('click', () => { set(false); run('share'); });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); set(false); more.focus(); } });
  pop.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) { set(false); run(b.dataset.act); } });
  pop.addEventListener('change', (e) => {
    const t = e.target.closest('[data-opt]'); if (!t) return;
    store.set({ notes: 'share-notes', tourphotos: 'share-tourphotos' }[t.dataset.opt] || 'share-photos', t.dataset.opt === 'notes' || t.dataset.opt === 'tourphotos' ? t.checked : t.value);
  });
  pop.addEventListener('keydown', (e) => {
    const it = [...pop.querySelectorAll('button:not([disabled]), input, select')], i = it.indexOf(document.activeElement);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !(e.target.tagName === 'SELECT')) { e.preventDefault(); it[(i + (e.key === 'ArrowDown' ? 1 : -1) + it.length) % it.length]?.focus(); }
    else if (e.key === 'Tab') set(false);
  });
  document.addEventListener('click', (e) => { if (!pop.hidden && !wrap.contains(e.target)) set(false); });
  on('saved', () => { if (!pop.hidden) pop.innerHTML = popHTML(id); });
}
/** Two items in the Data section of the menu, after "Restore picks". */
function mountMenu() {
  const menu = $('appMenu'), after = $('mnRestore');
  if (!menu || !after || menu.querySelector('#mnShare')) return;
  const mk = (id, icon, text, act) => { const b = document.createElement('button'); b.type = 'button'; b.role = 'menuitem'; b.id = id; b.innerHTML = `${icon}<span>${text}</span>`; b.addEventListener('click', () => run(act)); return b; };
  const memo = mk('mnMemo', MEMO_ICON, 'Decision memo (print or PDF)', 'memo'), share = mk('mnShare', SHARE_ICON, 'Share shortlist', 'share');
  after.after(share, memo);
}

export function init() {
  // the Shortlist / Tours sub-tab row (on both pages) is rebuilt on every picks change: the split button is put back each time
  const sub = $('subnav');
  if (sub) watch(sub, () => { if (sub.dataset.kind !== 'home' && sub.querySelector('a') && !sub.querySelector('.share-split')) mountSplit(sub, { cls: 'in-subnav' }); });
  mountMenu();
}
export const state = () => ({ busy, picks: savedIds(), ...opts() });
