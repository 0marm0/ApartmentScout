// Media: every image the listings have (listing photos, floor plans, licensed building photos with credits, and the
// aerial view as a fallback) as a justified gallery per listing, per building, or all together; filtered by scope
// (unit, same line, building, floor plans, street) and opened in the full-screen lightbox (features/lightbox.js).
// Images keep referrerpolicy="no-referrer"; every URL went through safeUrl() in features/photos.js.
import { openDrawer, label, store } from '../app.js';
import { esc, aerialHTML, aerialSource, mediaSrc } from '../util.js';
import { mediaGroups, MEDIA_SCOPES } from './model.js';
import { empty, IC } from './ui.js';
import { groupInfo, countsOf, countParts, captionText } from '../features/photos.js';
import { aspectFor, armImage, whenPreviewsReady } from '../features/lqip.js';
import { openLightbox } from '../features/lightbox.js';

const st = { scope: store.get('research-media-scope2', 'all'), view: store.get('research-media-view', 'listing'), hideMarked: store.get('research-media-hide-marked', false), shown: 18, flat: 120 };
const VIEWS = [['listing', 'By listing'], ['building', 'By building'], ['all', 'All images']];
const PAGE = 18;
let seq = [], broken = new Set();

const clampAr = (a) => Math.min(2.4, Math.max(0.66, a || 1.5));
const buildingKey = (L) => String(L.building || L.address || L.id).trim().toLowerCase();
const wordsOf = (items) => countParts(countsOf(items)).map((p) => `${p.n} ${p.word}`).join(' · ');

function tileHTML(it, i, named = false) {
  const L = it.L, info = groupInfo(it.group), ar = clampAr(aspectFor(it.keys));
  const cap = captionText(it);
  return `<figure class="rgt g-${it.group}${it.flagged ? ' marked' : ''}" style="--ar:${ar.toFixed(3)}" data-url="${esc(it.url)}">
    <button type="button" class="rgt-b" data-i="${i}" aria-label="${esc(info.long)} photo, ${esc(label(L))}${it.flagged ? ', carries a broker mark' : ''}. Open full screen"${cap ? ` title="${esc(cap)}"` : ''}>
      <img src="${esc(mediaSrc(it.url))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-lq="${esc(it.keys.join('|'))}">
      <span class="rgt-tag">${esc(info.label)}</span>${it.flagged ? `<span class="rgt-mark" title="Carries a broker mark (${esc((it.why || []).join(', ') || 'watermark')}); shown last">Marked</span>` : ''}${it.shared > 1 ? `<span class="rgt-shared">${it.shared} units</span>` : ''}
      ${cap ? `<span class="rgt-cap">${esc(cap)}</span>` : ''}</button>
    ${named ? `<figcaption><button type="button" class="rmt-name" data-open="${esc(L.id)}">${esc(label(L))}</button></figcaption>` : ''}
  </figure>`;
}

/** Sections for the current view: [{ title, sub, id, items, L }]. */
function sectionsFor(groups, scope) {
  const keep = (it) => (scope === 'all' || it.group === scope) && !broken.has(it.url) && !(st.hideMarked && it.flagged);
  const per = groups.map((g) => ({ L: g.L, items: g.items.filter(keep) })).filter((g) => g.items.length);
  if (st.view === 'building') {
    const m = new Map();
    for (const g of per) { const k = buildingKey(g.L); const s = m.get(k) || m.set(k, { L: g.L, units: 0, items: [] }).get(k); s.units++; s.items.push(...g.items); }
    return [...m.values()].map((s) => ({ ...s, title: s.L.building || s.L.address || s.L.id, sub: `${s.units} home${s.units === 1 ? '' : 's'}${s.L.neighborhood ? ' · ' + s.L.neighborhood : ''}`, building: true }));
  }
  return per.map((g) => ({ ...g, title: g.L.building || g.L.address || g.L.id, unit: g.L.unit || '', sub: g.L.neighborhood || '' }));
}

export function render(el) {
  const groups = mediaGroups();
  const real = groups.flatMap((g) => g.items);
  const nAerial = groups.filter((g) => g.aerial && !g.items.length).length;
  if (!real.length && !nAerial) { el.innerHTML = empty(IC.image, 'No images yet', 'Listing photos, floor plans and licensed building photos appear here once the search has them.', 'apartmentscout photos'); return; }
  const pool = st.hideMarked ? real.filter((x) => !x.flagged) : real;
  const cnt = { all: pool.length, ...countsOf(pool), aerial: nAerial };
  const scope = st.scope === 'all' && !real.length ? 'aerial' : st.scope;
  const nMarked = real.filter((x) => x.flagged).length;
  const chip = (k, t) => `<button type="button" class="chip ${scope === k ? 'on' : ''}" data-k="${k}" aria-pressed="${scope === k}"${cnt[k] ? '' : ' disabled'}>${t}<span class="n">${cnt[k]}</span></button>`;
  const head = `${real.length ? '' : `<div class="panel note rs-notice">No listing photos, floor plans or building photos are saved yet, so this shows the aerial view of each home. <span class="mono">apartmentscout photos</span> finds licensed building photos with credits.</div>`}
    <div class="rs-bar-row">
      <div class="chips" role="group" aria-label="Scope of image">${MEDIA_SCOPES.map(([k, t]) => chip(k, t)).join('')}${chip('aerial', 'Aerial fallback')}</div>
      <span class="sp"></span>
      ${nMarked ? `<button type="button" class="chip ${st.hideMarked ? 'on' : ''}" id="mgMarked" aria-pressed="${st.hideMarked}" title="Photos with a broker's phone number, logo or watermark are shown last in their group">Hide broker-marked<span class="n">${nMarked}</span></button>` : ''}
      <div class="seg" role="group" aria-label="Layout">${VIEWS.map(([k, t]) => `<button type="button" data-v="${k}" class="${st.view === k ? 'on' : ''}" aria-pressed="${st.view === k}">${t}</button>`).join('')}</div>
    </div>`;

  let body = '', nImg = 0, nHome = 0, more = '';
  seq = [];
  if (scope === 'aerial') {
    const A = groups.filter((g) => g.aerial && !g.items.length).slice(0, st.shown);
    nImg = nAerial; nHome = nAerial;
    body = `<div class="rg-aerial">${A.map((g) => `<figure class="rmt k-aerial"><button type="button" class="rmt-b" data-open="${esc(g.L.id)}" aria-label="Aerial view, ${esc(label(g.L))}. Open the listing">${aerialHTML(g.L, 360, 260, 18)}<span class="rmt-tag">Aerial</span></button><figcaption>${esc(label(g.L))}</figcaption></figure>`).join('')}</div>`
      + `<p class="rs-aerial-credit">Aerial imagery: ${esc(aerialSource().credit)}</p>`;
    if (nAerial > st.shown) more = `Show ${Math.min(PAGE, nAerial - st.shown)} more homes of ${nAerial - st.shown}`;
  } else {
    const secs = sectionsFor(groups, scope);
    nHome = secs.length; nImg = secs.reduce((a, s) => a + s.items.length, 0);
    if (st.view === 'all') {
      const flat = secs.flatMap((s) => s.items).slice(0, st.flat);
      seq = flat;
      body = `<div class="rg flat">${flat.map((it, i) => tileHTML(it, i, true)).join('')}</div>`;
      if (nImg > st.flat) more = `Show ${Math.min(PAGE * 4, nImg - st.flat)} more images of ${nImg - st.flat}`;
    } else {
      const shown = secs.slice(0, st.shown);
      body = `<div class="mg-list">${shown.map((s) => {
        s.base = seq.length; seq.push(...s.items);
        return `<section class="mg" aria-label="${esc(s.title)}"><header>${s.building ? `<span class="mg-t static">${esc(s.title)}</span>` : `<button type="button" class="mg-t" data-open="${esc(s.L.id)}">${esc(s.title)} <span>${esc(s.unit)}</span></button>`}<span class="faint">${esc(s.sub)}</span><span class="sp"></span><span class="faint tnum">${esc(wordsOf(s.items))} · ${s.items.length} image${s.items.length > 1 ? 's' : ''}</span></header>
          <div class="rg" data-from="${s.base}" data-to="${s.base + s.items.length}">${s.items.map((it, i) => tileHTML(it, s.base + i)).join('')}</div></section>`;
      }).join('')}</div>`;
      if (secs.length > st.shown) more = `Show ${Math.min(PAGE, secs.length - st.shown)} more ${st.view === 'building' ? 'buildings' : 'homes'} of ${secs.length - st.shown}`;
    }
  }
  const sub = `${nImg.toLocaleString()} image${nImg === 1 ? '' : 's'} from ${nHome.toLocaleString()} ${st.view === 'building' && scope !== 'aerial' ? 'building' : 'home'}${nHome === 1 ? '' : 's'} · unit is the listing's own photos; same line is another floor of the same stack; building covers lobby, amenities, exterior and other units; a photo with a broker's mark goes last in its group${scope === 'aerial' ? ' · aerial views are shown only for homes with no other image' : ''}`;
  el.innerHTML = `${head}<p class="rs-sub">${sub}</p>${nImg ? body + (more ? `<button type="button" class="btn ghost more-btn rs-more-btn" id="mgMore">${more}</button>` : '') : empty(IC.image, 'No images match', 'Try another scope.')}`;

  const rerender = (focusSel) => { render(el); if (focusSel) el.querySelector(focusSel)?.focus(); };
  el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => { st.scope = b.dataset.k; st.shown = PAGE; st.flat = 120; store.set('research-media-scope2', st.scope); rerender(`[data-k="${b.dataset.k}"]`); }));
  el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { st.view = b.dataset.v; st.shown = PAGE; st.flat = 120; store.set('research-media-view', st.view); rerender(`[data-v="${b.dataset.v}"]`); }));
  el.querySelector('#mgMarked')?.addEventListener('click', () => { st.hideMarked = !st.hideMarked; store.set('research-media-hide-marked', st.hideMarked); rerender('#mgMarked'); });
  el.querySelector('#mgMore')?.addEventListener('click', () => { if (st.view === 'all' && scope !== 'aerial') st.flat += PAGE * 4; else st.shown += PAGE; rerender(); });
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.open)));
  el.querySelectorAll('.rgt-b').forEach((b) => b.addEventListener('click', () => {
    // the lightbox walks the section's images (or every shown image in the flat layout), minus tiles that turned out dead
    const g = b.closest('.rg'), from = +(g.dataset.from ?? 0), to = +(g.dataset.to ?? seq.length);
    const items = seq.slice(from, to).filter((x) => !broken.has(x.url));
    openLightbox({ items, url: seq[+b.dataset.i]?.url, from: b });
  }));

  // blur-up behind each tile, the real ratio once the photo is known, a fallback link, and no broken tiles
  const arm = () => el.querySelectorAll('.rgt-b img[data-lq]').forEach((img) => armImage(img, img.parentElement));
  arm(); whenPreviewsReady(arm);
  el.querySelectorAll('.rgt img').forEach((img) => {
    const fig = img.closest('.rgt');
    img.addEventListener('load', () => { if (img.naturalWidth) fig.style.setProperty('--ar', clampAr(img.naturalWidth / img.naturalHeight).toFixed(3)); });
    img.addEventListener('error', () => {   // after the whole photo chain failed (features/media-chain.js)
      broken.add(fig.dataset.url); fig.remove();
      el.querySelectorAll('.mg').forEach((g) => { if (!g.querySelector('.rgt')) g.remove(); });
    });
  });
}
