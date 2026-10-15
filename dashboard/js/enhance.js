// Shell micro-interactions that sit on top of the rendered markup without changing it: images fade in when
// they load (and broken ones give way to a quiet placeholder), KPI numbers count to their new value, the
// active view tab has a sliding indicator, and result cards cycle their first photos on hover.
// Everything here is progressive: with JS off or reduced motion the markup is unchanged.
import { byId } from './app.js';
import { $, imagesOf, safeUrl, mediaSrc } from './util.js';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initEnhance() {
  images();
  kpiCountUp();
  navIndicator();
  cardPhotos();
  sheetSwipe();
  skipLink();
}

function skipLink() {
  document.querySelector('.skip')?.addEventListener('click', (e) => {
    e.preventDefault();   // the hash is the router's: focus the first result instead of navigating
    if (!['map', 'list'].includes(document.body.dataset.view)) location.hash = 'map';
    requestAnimationFrame(() => document.querySelector('#cards .card, #view-list [tabindex="0"]')?.focus());
  });
}

// ------------------------------------------------------------------ phone: pull the listing sheet down to close it
function sheetSwipe() {
  const dw = $('drawer'); if (!dw) return;
  let s = null;
  const phone = () => matchMedia('(max-width: 760px)').matches;
  dw.addEventListener('touchstart', (e) => {
    const sc = dw.querySelector('.d-scroll');
    if (!phone() || !dw.classList.contains('open') || e.touches.length !== 1 || (sc && sc.scrollTop > 0)) { s = null; return; }
    s = { x: e.touches[0].clientX, y: e.touches[0].clientY, dy: 0, on: false };
  }, { passive: true });
  dw.addEventListener('touchmove', (e) => {
    if (!s) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (!s.on) {
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { s = null; return; }   // upward scroll or a sideways photo swipe
      s.on = true; dw.classList.add('pulling');
    }
    e.preventDefault();
    s.dy = dy;
    dw.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  const end = () => {
    if (!s?.on) { s = null; return; }
    const far = s.dy > Math.min(140, innerHeight * 0.18);
    dw.classList.remove('pulling'); dw.style.transform = '';
    s = null;
    if (far) dw.querySelector('#dClose')?.click();
  };
  dw.addEventListener('touchend', end); dw.addEventListener('touchcancel', end);
}

// ------------------------------------------------------------------ images: fade in on load, placeholder on error
function images() {
  const done = (img) => { img.classList.add('ld'); img.classList.remove('err'); };
  document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') done(e.target); }, true);
  document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('err'); }, true);
  // images that were already complete when inserted (memory cache) never fire load after we look
  const sweep = (n) => {
    const list = n.tagName === 'IMG' ? [n] : n.querySelectorAll ? n.querySelectorAll('img:not(.ld)') : [];
    for (const img of list) if (img.complete && img.naturalWidth) done(img);
  };
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) sweep(n); })
    .observe(document.body, { childList: true, subtree: true });
  sweep(document.body);
}

// ------------------------------------------------------------------ KPI strip: numbers count to the new value
function kpiCountUp() {
  const el = $('kpis'); if (!el) return;
  let prev = new Map();
  const read = () => {
    const m = new Map();
    el.querySelectorAll('.kpi').forEach((k) => {
      const key = k.querySelector('.k')?.textContent || '', v = k.querySelector('.v');
      const t = v?.firstChild; if (!t || t.nodeType !== 3) return;
      const n = parseFloat(t.textContent.replace(/[$,]/g, ''));
      if (Number.isFinite(n)) m.set(key, { node: t, n, money: t.textContent.trim().startsWith('$') });
    });
    return m;
  };
  new MutationObserver(() => {
    const now = read();
    if (!reduce()) for (const [k, cur] of now) {
      const old = prev.get(k);
      if (old && old.n !== cur.n) tween(cur.node, old.n, cur.n, cur.money);
    }
    prev = now;
  }).observe(el, { childList: true });
  prev = read();
}
function tween(node, a, b, money) {
  const fmt = (v) => (money ? '$' : '') + Math.round(v).toLocaleString();
  const t0 = performance.now(), dur = Math.min(650, 260 + Math.abs(b - a) * 4);
  node.parentElement?.classList.add('tick');
  const step = (t) => {
    if (!node.isConnected) return;
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(a + (b - a) * e);
    if (k < 1) requestAnimationFrame(step); else { node.textContent = fmt(b); node.parentElement?.classList.remove('tick'); }
  };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------------ view tabs: a sliding indicator under the active tab
function navIndicator() {
  const nav = $('tabs'); if (!nav) return;
  const ink = document.createElement('span');
  ink.className = 'nav-ink'; ink.setAttribute('aria-hidden', 'true');
  nav.prepend(ink); nav.classList.add('has-ink');
  let first = true;
  const place = () => {
    const a = nav.querySelector('a.on'); if (!a) { ink.style.opacity = 0; return; }
    ink.style.opacity = 1;
    ink.classList.toggle('instant', first || reduce()); first = false;
    ink.style.width = a.offsetWidth + 'px';
    ink.style.transform = `translateX(${a.offsetLeft}px)`;
    // keep the active tab visible when the strip scrolls sideways on a phone
    if (nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: Math.max(0, a.offsetLeft - 40), behavior: reduce() ? 'auto' : 'smooth' });
  };
  new MutationObserver((ms) => { if (ms.some((m) => m.target.tagName === 'A')) place(); }).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', place);
  document.fonts?.ready.then(place);
  place();
}

// ------------------------------------------------------------------ result cards: cycle the first photos on hover
function cardPhotos() {
  const box = $('cards'); if (!box) return;
  let timer = 0, cur = null;
  const stop = () => {
    clearInterval(timer); timer = 0;
    if (cur) { cur.querySelectorAll('.media .cyc').forEach((x) => x.classList.remove('on')); cur.querySelector('.media')?.classList.remove('cycling'); }
    cur = null;
  };
  const start = (card) => {
    if (card === cur) return;
    stop();
    if (reduce() || matchMedia('(hover: none)').matches) return;
    const L = byId(card.dataset.id); if (!L) return;
    const im = imagesOf(L), urls = (im.own.length ? im.own : im.building.map((b) => b.url)).map(safeUrl).filter(Boolean).slice(0, 3);
    const media = card.querySelector('.media'), base = media?.querySelector(':scope > img');
    if (!media || !base || urls.length < 2) return;
    cur = card;
    // extra frames are built once per card render and reused on the next hover
    if (!media.querySelector('.cyc')) {
      urls.slice(1).forEach((u, k) => {
        const im2 = document.createElement('img');
        im2.className = 'cyc'; im2.alt = ''; im2.referrerPolicy = 'no-referrer'; im2.decoding = 'async';
        im2.src = mediaSrc(u);   // a missing saved copy walks the photo chain by itself (features/media-chain.js)
        media.insertBefore(im2, base.nextSibling);
      });
      const dots = document.createElement('span');
      dots.className = 'cyc-dots'; dots.setAttribute('aria-hidden', 'true');
      dots.innerHTML = urls.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('');
      media.append(dots);
    }
    media.classList.add('cycling');
    const frames = [null, ...media.querySelectorAll('.cyc')], dots = media.querySelectorAll('.cyc-dots i');
    let i = 0;
    timer = setInterval(() => {
      i = (i + 1) % frames.length;
      // only advance onto frames that actually loaded; a broken photo is skipped
      if (frames[i] && !(frames[i].complete && frames[i].naturalWidth)) return;
      frames.forEach((f, j) => f?.classList.toggle('on', j === i));
      dots.forEach((d, j) => d.classList.toggle('on', j === i));
    }, 1100);
  };
  box.addEventListener('mouseover', (e) => { const c = e.target.closest('.card'); if (c && box.contains(c)) start(c); });
  box.addEventListener('mouseleave', stop);
  box.addEventListener('mouseout', (e) => { const c = e.target.closest('.card'); if (c && !c.contains(e.relatedTarget)) stop(); });
  // the card list re-renders often (weights, filters): drop the timer if its card went away
  new MutationObserver(() => { if (cur && !cur.isConnected) stop(); }).observe(box, { childList: true });
}
