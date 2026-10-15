// Media glue for the cards and the drawer: photo counts by group, the blur-up previews, the lightbox entry points
// and the card-photo-to-drawer-hero transition. app.js calls the four exports below from small, marked hooks.
import { esc, mediaSrc, ICONS } from '../util.js';
import { photoItems, heroOf, countsOf, countParts, countSentence, groupInfo } from './photos.js';
import { loadPreviews, whenPreviewsReady, armCards, armTrack } from './lqip.js';
import { openLightbox, configureLightbox, creditHTML } from './lightbox.js';

let host = null;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);
const PLAIN = 'Listing photo, copyright its owner';

/** Called once after the data is loaded: { S, loadJSON, openDrawer, label }. */
export function initMedia(h) {
  host = h;
  configureLightbox({ openDrawer: h.openDrawer, label: h.label });
  loadPreviews(h.loadJSON, h.S.base);   // already under way: app.js starts it with the main data
  const cards = $('cards');
  if (!cards) return;
  whenPreviewsReady(() => armCards(cards));
  // the card list is re-rendered often: paint the previews on whatever is new, before the browser draws it
  new MutationObserver(() => armCards(cards)).observe(cards, { childList: true });
  // the photo count on a card opens the lightbox instead of the drawer (capture: before the card's own click)
  const open = (b, e) => {
    e.stopPropagation(); e.preventDefault();
    const L = h.S.listings.find((x) => x.id === b.dataset.lb);
    if (L) openLightbox({ items: photoItems(L), url: heroOf(L)?.url, from: b });
  };
  cards.addEventListener('click', (e) => { const b = e.target.closest?.('[data-lb]'); if (b) open(b, e); }, true);
  cards.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-lb]')) e.stopPropagation(); }, true);
}

/** The photo well of a result card: the best photo, a blur-up preview behind it and a count by group that opens the
 *  lightbox. null when the listing has no photo (the card then shows its aerial view or glyph as before). */
export function cardMediaHTML(L, im) {
  const hero = heroOf(L);
  if (!hero) return null;
  const items = photoItems(L), counts = countsOf(items), parts = countParts(counts), sentence = countSentence(counts);
  const chip = parts.length
    ? `<button type="button" class="nph" data-lb="${esc(L.id)}" aria-label="View ${esc(sentence)} full screen" title="${esc(sentence)}">${ICONS.camera}<b>${parts[0].n}</b><span class="w"> ${esc(parts[0].word)}</span></button>` : '';   // the biggest group on the card; the whole breakdown is the tooltip
  return `<img src="${esc(mediaSrc(hero.url))}" alt="" loading="lazy" referrerpolicy="no-referrer" data-lq="${esc(hero.keys.join('|'))}">${chip}`;
}

/** After the drawer renders: blur-up previews per slide, the full-screen entry points and group-aware captions. */
export function afterDrawerMedia(dw, L, slides) {
  const tr = $('dTrack');
  if (!tr || !slides.length) return;
  const items = photoItems(L), byUrl = new Map(items.map((it) => [it.url, it]));
  const imgs = [...tr.querySelectorAll(':scope > img')];
  imgs.forEach((im, i) => { const it = byUrl.get(slides[i]?.url); if (it) im.dataset.lq = it.keys.join('|'); });
  armTrack(tr);
  whenPreviewsReady(() => armTrack(tr));
  const itemAt = (i) => byUrl.get(slides[i]?.url);
  const openAt = (i, from) => { const it = itemAt(i); if (it) openLightbox({ items, url: it.url, from, inDrawer: true }); };
  const idx = () => Math.round(tr.scrollLeft / Math.max(1, tr.clientWidth));
  // a full-screen button next to Close, a click on the photo, and Enter on the focused carousel
  const hb = dw.querySelector('.hero-btns');
  if (hb) {
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'dExpand'; b.title = 'View photos full screen'; b.setAttribute('aria-label', `View ${slides.length} photo${slides.length === 1 ? '' : 's'} full screen`);
    b.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5l-4.5 4.5M2.5 13.5L7 9"/></svg>';
    hb.insertBefore(b, hb.lastElementChild);
    b.addEventListener('click', () => openAt(idx(), b));
  }
  let down = null;
  tr.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; }, true);
  tr.addEventListener('click', (e) => {
    if (!(e.target.tagName === 'IMG' || e.target === tr) || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    openAt(idx(), e.target);
  });
  tr.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === tr) { e.preventDefault(); openAt(idx(), tr); } });
  // the counter names the group; the credit line shows licences and sources
  const caption = () => {
    const i = idx(), it = itemAt(i); if (!it) return;
    const c = it.credit || {}, credit = $('dCredit'), count = $('dCount');
    if (count) count.textContent = `${i + 1} / ${slides.length} · ${groupInfo(it.group).label}${it.flagged ? ' · broker mark' : ''}`;
    if (credit) credit.innerHTML = c.author || c.license || it.source === 'building' || (c.note && c.note !== PLAIN) ? creditHTML(it) : '';
  };
  tr.addEventListener('scroll', caption, { passive: true });
  caption();
}

/** Open a listing from its card with the card's photo growing into the drawer's hero (View Transitions API).
 *  Returns true when it has taken over: `run()` then opens the drawer inside the transition. Without the API,
 *  under reduced motion, or when no card photo is on screen it returns false and the drawer slides in as usual. */
export function mediaTransition(id, opt, run) {
  if (opt?.noVT || typeof document.startViewTransition !== 'function' || reduced()) return false;
  const dw = $('drawer');
  if (!dw || dw.classList.contains('open')) return false;
  const well = document.querySelector(`#cards .card[data-id="${CSS.escape(id)}"] .media`);
  if (!well || !well.querySelector(':scope > img')) return false;
  const r = well.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight || r.width < 40) return false;
  well.style.viewTransitionName = 'lbhero';
  document.documentElement.classList.add('vt-hero');
  const t = document.startViewTransition(() => {
    well.style.viewTransitionName = '';
    dw.style.transition = 'none';          // the drawer is final the moment it renders: the morph is its entrance
    run();
    const hero = dw.querySelector('.d-hero');
    if (hero) hero.style.viewTransitionName = 'lbhero';
  });
  const clean = () => {
    well.style.viewTransitionName = '';
    dw.querySelector('.d-hero')?.style.removeProperty('view-transition-name');
    dw.style.transition = '';
    document.documentElement.classList.remove('vt-hero');
  };
  t.ready.then(() => requestAnimationFrame(() => { dw.style.transition = ''; }), clean);
  t.finished.then(clean, clean);
  return true;
}
