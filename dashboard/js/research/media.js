// Media: every image the listings have (listing photos, floor plans, licensed building photos with credits, and the
// aerial view as a fallback), filtered by kind and scope, grouped per listing, with a keyboard lightbox.
// Images keep referrerpolicy="no-referrer"; every URL went through safeUrl() in model.mediaOf().
import { openDrawer, label, store } from '../app.js';
import { esc, safeUrl, aerialHTML, ICONS, aerialSource } from '../util.js';
import { mediaGroups, MEDIA_KINDS } from './model.js';
import { empty, IC } from './ui.js';

const st = { kind: store.get('research-media-kind', 'all'), scope: store.get('research-media-scope', 'any'), group: store.get('research-media-group', true), shown: 18 };
const KIND_TXT = { unit: 'Photo', plan: 'Floor plan', building: 'Building', aerial: 'Aerial' };
const SCOPES = [['any', 'Any scope'], ['exact', 'Exact unit'], ['building', 'Building scope']];
let seq = [], broken = new Set(), lastFocus = null;

function creditHTML(c, linked = true) {
  if (!c) return '';
  const page = safeUrl(c.page), lic = safeUrl(c.license_url);
  const a = (u, t) => (u && linked ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : esc(t));
  return `${a(page, c.author || c.source || 'Source')}${c.license ? ' · ' + a(lic, c.license) : ''}${c.source && c.author ? ' · ' + esc(c.source) : ''}`;
}

/** Groups with the items the current kind and scope allow. Aerial views stand in only for homes with no image. */
function itemsFor(groups, kind) {
  const okScope = (it) => st.scope === 'any' || (st.scope === 'exact' ? it.exact : !it.exact);
  return groups.map((g) => {
    const items = kind === 'aerial'
      ? (g.aerial && !g.items.length ? [{ kind: 'aerial', exact: false, scope: 'Aerial view', L: g.L, url: 'aerial:' + g.L.id }] : [])
      : g.items.filter((it) => !broken.has(it.url) && (kind === 'all' || it.kind === kind));
    return { L: g.L, items: items.filter(okScope) };
  }).filter((g) => g.items.length);
}

function tileHTML(it, i, named = false) {
  const L = it.L, kt = KIND_TXT[it.kind];
  const media = it.kind === 'aerial' ? aerialHTML(L, 360, 260, 18) : `<img src="${esc(it.url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  return `<figure class="rmt k-${it.kind}" data-url="${esc(it.url)}">
    <button type="button" class="rmt-b" data-i="${i}" aria-label="${esc(kt)}: ${esc(it.scope)}, ${esc(label(L))}. Open larger">${media}
      <span class="rmt-tag">${esc(kt)}</span>${it.exact ? '' : `<span class="rmt-scope">${esc(it.scope)}</span>`}${it.shared > 1 ? `<span class="rmt-shared">${it.shared} units</span>` : ''}</button>
    ${named ? `<figcaption class="named"><button type="button" class="rmt-name" data-open="${esc(L.id)}">${esc(label(L))}</button>${it.credit ? `<span>${creditHTML(it.credit)}</span>` : ''}</figcaption>`
      : it.credit ? `<figcaption>${creditHTML(it.credit)}</figcaption>` : it.kind === 'aerial' ? `<figcaption>${esc(aerialSource().credit)}</figcaption>` : ''}
  </figure>`;
}

export function render(el) {
  const groups = mediaGroups();
  const all = groups.flatMap((g) => g.items);
  const hasReal = all.length > 0;
  const nAerial = groups.filter((g) => g.aerial && !g.items.length).length;
  const cnt = { all: all.length, ...Object.fromEntries(MEDIA_KINDS.map(([k]) => [k, k === 'aerial' ? nAerial : all.filter((x) => x.kind === k).length])) };
  if (!hasReal && !nAerial) { el.innerHTML = empty(IC.image, 'No images yet', 'Listing photos, floor plans and licensed building photos appear here once the search has them.', 'apartmentscout photos'); return; }
  const kindNow = st.kind === 'all' && !hasReal ? 'aerial' : st.kind;
  const G = itemsFor(groups, kindNow);
  const shownG = G.slice(0, st.shown), nImg = G.reduce((a, g) => a + g.items.length, 0);
  // the lightbox walks every matching image in screen order, including homes not rendered yet
  seq = []; const idx = new Map();
  for (const g of G) for (const it of g.items) { idx.set(it, seq.length); seq.push(it); }
  const grouped = st.group && kindNow !== 'aerial';   // one aerial per home: a flat grid with names reads better
  const chip = (k, t) => `<button type="button" class="chip ${kindNow === k ? 'on' : ''}" data-k="${k}" aria-pressed="${kindNow === k}"${cnt[k] ? '' : ' disabled'}>${t}<span class="n">${cnt[k]}</span></button>`;
  el.innerHTML = `${hasReal ? '' : `<div class="panel note rs-notice">No listing photos, floor plans or building photos are saved yet, so this shows the aerial view of each home. <span class="mono">apartmentscout photos</span> finds licensed building photos with credits.</div>`}
    <div class="rs-bar-row">
      <div class="chips" role="group" aria-label="Kind of image">${chip('all', 'All')}${MEDIA_KINDS.map(([k, t]) => chip(k, k === 'aerial' ? 'Aerial fallback' : t)).join('')}</div>
      <span class="sp"></span>
      <div class="seg" role="group" aria-label="Scope">${SCOPES.map(([k, t]) => `<button type="button" data-sc="${k}" class="${st.scope === k ? 'on' : ''}" aria-pressed="${st.scope === k}">${t}</button>`).join('')}</div>
      <div class="seg" role="group" aria-label="Layout"><button type="button" data-g="1" class="${st.group ? 'on' : ''}" aria-pressed="${st.group}">By listing</button><button type="button" data-g="0" class="${st.group ? '' : 'on'}" aria-pressed="${!st.group}">All images</button></div>
    </div>
    <p class="rs-sub">${nImg.toLocaleString()} image${nImg === 1 ? '' : 's'} from ${G.length.toLocaleString()} home${G.length === 1 ? '' : 's'} · exact unit means the listing's own photos and plans; building scope covers the building, its line or its block${kindNow === 'aerial' ? ' · aerial views are shown only for homes with no other image' : ''}</p>
    ${G.length ? (grouped
      ? `<div class="mg-list">${shownG.map((g) => `<section class="mg" aria-label="${esc(label(g.L))}"><header><button type="button" class="mg-t" data-open="${esc(g.L.id)}">${esc(g.L.building || g.L.address || g.L.id)} <span>${esc(g.L.unit || '')}</span></button><span class="faint">${esc(g.L.neighborhood || '')}</span><span class="sp"></span><span class="faint tnum">${g.items.length} image${g.items.length > 1 ? 's' : ''}</span></header><div class="mg-grid">${g.items.map((it) => tileHTML(it, idx.get(it))).join('')}</div></section>`).join('')}</div>`
      : `<div class="mg-grid flat">${shownG.flatMap((g) => g.items).map((it) => tileHTML(it, idx.get(it), true)).join('')}</div>`)
      + (G.length > st.shown ? `<button type="button" class="btn ghost more-btn rs-more-btn" id="mgMore">Show ${Math.min(18, G.length - st.shown)} more homes of ${G.length - st.shown}</button>` : '')
      + (kindNow === 'aerial' ? `<p class="rs-aerial-credit">Aerial imagery: ${esc(aerialSource().credit)}</p>` : '')
      : empty(IC.image, 'No images match', 'Try another kind or scope.')}`;

  el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => { st.kind = b.dataset.k; st.shown = 18; store.set('research-media-kind', st.kind); render(el); el.querySelector(`[data-k="${b.dataset.k}"]`)?.focus(); }));
  el.querySelectorAll('[data-sc]').forEach((b) => b.addEventListener('click', () => { st.scope = b.dataset.sc; st.shown = 18; store.set('research-media-scope', st.scope); render(el); el.querySelector(`[data-sc="${b.dataset.sc}"]`)?.focus(); }));
  el.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => { st.group = b.dataset.g === '1'; store.set('research-media-group', st.group); render(el); el.querySelector(`[data-g="${b.dataset.g}"]`)?.focus(); }));
  el.querySelector('#mgMore')?.addEventListener('click', () => { st.shown += 18; render(el); });
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.open)));
  el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => openLightbox(+b.dataset.i, b)));
  // a dead image link removes its tile (and its whole group when nothing is left) instead of showing a broken icon
  el.querySelectorAll('.rmt:not(.k-aerial) img').forEach((img) => img.addEventListener('error', () => {
    const fig = img.closest('.rmt'); broken.add(fig.dataset.url); fig.remove();
    el.querySelectorAll('.mg').forEach((g) => { if (!g.querySelector('.rmt')) g.remove(); });
  }, { once: true }));
}

// ------------------------------------------------------------------ lightbox
function lbMedia(it) {
  if (it.kind === 'aerial') {
    const w = Math.min(1024, innerWidth - 48), h = Math.min(680, innerHeight - 220);
    return `<div class="lb-aerial">${aerialHTML(it.L, Math.max(240, Math.round(w)), Math.max(200, Math.round(h)), 18)}</div>`;
  }
  return `<img src="${esc(it.url)}" alt="${esc(KIND_TXT[it.kind])} of ${esc(label(it.L))}" referrerpolicy="no-referrer" class="${it.kind === 'plan' ? 'plan' : ''}">`;
}
function openLightbox(i, from) {
  if (!seq.length) return;
  lastFocus = from || document.activeElement;
  document.querySelector('.rs-lb')?.remove();
  const box = document.createElement('div');
  box.className = 'rs-lb'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Image viewer');
  box.innerHTML = `<div class="lb-stage" id="lbStage"></div>
    <button type="button" class="lb-nav prev" aria-label="Previous image">${IC.left}</button><button type="button" class="lb-nav next" aria-label="Next image">${IC.right}</button>
    <div class="lb-bar"><div class="lb-cap" id="lbCap" aria-live="polite"></div><div class="lb-acts"><button type="button" class="btn" id="lbOpen">Listing details</button><button type="button" class="btn" id="lbClose" aria-label="Close viewer">${ICONS.x}Close</button></div></div>`;
  document.body.append(box);
  let cur = i;
  const show = (n) => {
    cur = (n + seq.length) % seq.length;
    const it = seq[cur];
    box.querySelector('#lbStage').innerHTML = lbMedia(it);
    const img = box.querySelector('#lbStage img');
    img?.addEventListener('error', () => { box.querySelector('#lbStage').innerHTML = '<div class="lb-dead">This image is no longer available at its source.</div>'; }, { once: true });
    box.querySelector('#lbCap').innerHTML = `<b>${esc(label(it.L))}</b><span>${esc(KIND_TXT[it.kind])} · ${esc(it.scope)}${it.shared > 1 ? ` · shared by ${it.shared} units` : ''}</span>
      ${it.credit ? `<span class="lb-credit">${creditHTML(it.credit)}</span>` : it.kind === 'aerial' ? `<span class="lb-credit">${esc(aerialSource().credit)}</span>` : it.kind === 'unit' ? '<span class="lb-credit">Listing photo, copyright its owner</span>' : ''}<span class="lb-n tnum">${cur + 1} / ${seq.length}</span>`;
  };
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); lastFocus?.focus?.(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); show(cur + 1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); show(cur - 1); return; }
    if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); show(0); return; }
    if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); show(seq.length - 1); return; }
    if (e.key === 'Tab') {   // keep focus inside the viewer
      const f = [...box.querySelectorAll('button, a[href]')].filter((x) => !x.disabled);
      const a = f.indexOf(document.activeElement);
      if (e.shiftKey && a <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && a === f.length - 1) { e.preventDefault(); f[0].focus(); }
      return;
    }
    // swallow the app's single-key shortcuts (view switching, theme) while the viewer is open
    if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);
  box.querySelector('.prev').addEventListener('click', () => show(cur - 1));
  box.querySelector('.next').addEventListener('click', () => show(cur + 1));
  box.querySelector('#lbClose').addEventListener('click', close);
  box.querySelector('#lbOpen').addEventListener('click', () => { const id = seq[cur].L.id; close(); openDrawer(id); });
  box.addEventListener('click', (e) => { if (e.target === box || e.target.id === 'lbStage') close(); });
  if (seq.length < 2) box.querySelectorAll('.lb-nav').forEach((b) => (b.hidden = true));
  show(cur);
  box.querySelector('#lbClose').focus();
}
