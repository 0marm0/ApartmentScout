// The one top-right menu: This search, Data, Appearance, Comfort, Help (markup in index.html: #menuBtn and #appMenu). It replaces
// the folder menu (searches) and the settings menu. This module owns how the menu behaves: open and close (from the menu button,
// or from the search switcher on the left, which opens the same menu under itself), the roving focus and arrow keys, Esc, the
// bottom sheet on a phone, and the "This search" section (name, the other searches when served, Edit criteria, New search).
// What the Appearance and Comfort controls do lives in shell.js (theme, density) and features/settings-menu.js (accent, comfort,
// text size, tour); picks backup and CSV stay in app.js.
import { S, importPicks } from './app.js';
import { $, esc } from './util.js';
import * as API from './local-api.js';

const phone = () => matchMedia('(max-width: 760px)').matches;
const FOLDER = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M1.8 4.2a1 1 0 011-1h3l1.5 1.7h5.9a1 1 0 011 1v6.4a1 1 0 01-1 1H2.8a1 1 0 01-1-1z"/></svg>';
const openWizard = async (o) => (await import('./onboarding.js')).openWizard(o);

/** Rows of a menu in keyboard order. A segmented group (theme, density, text size, accent) is one stop: up and down move between
 *  rows, left and right move inside the group. Pure DOM reads, so it is also what the tests drive through the keyboard. */
export function stops(menu) {
  const out = [], seen = new Set();
  for (const b of menu.querySelectorAll('button[role^="menuitem"]')) {
    if (b.disabled || b.closest('[hidden]') || seen.has(b)) continue;
    const g = b.closest('.mn-seg, .mn-swatches');
    if (g) { const kids = [...g.querySelectorAll('button[role^="menuitem"]')]; kids.forEach((k) => seen.add(k)); out.push(kids); }
    else out.push([b]);
  }
  return out;
}
const entry = (row) => row.find((b) => b.getAttribute('aria-checked') === 'true') || row[0];

export function initAppMenu() {
  const btn = $('menuBtn'), pill = $('searchSwitch'), menu = $('appMenu'), scrim = $('amScrim'), body = $('amBody');
  if (!btn || !menu) return { open() {}, close() {}, isOpen: () => false };
  let opener = btn, token = 0;

  const rove = (cur) => menu.querySelectorAll('button[role^="menuitem"]').forEach((b) => b.setAttribute('tabindex', b === cur ? '0' : '-1'));
  const focusIn = (b) => { if (!b) return; rove(b); b.focus({ preventScroll: false }); b.scrollIntoView?.({ block: 'nearest' }); };

  function place(from) {
    if (from === pill && !phone()) {   // under the switcher it was opened from
      const r = pill.getBoundingClientRect();
      menu.dataset.from = 'pill';
      menu.style.setProperty('--am-left', `${Math.max(8, Math.min(r.left, innerWidth - 336))}px`);
      menu.style.setProperty('--am-top', `${r.bottom + 8}px`);
    } else { delete menu.dataset.from; menu.style.removeProperty('--am-left'); menu.style.removeProperty('--am-top'); }
  }

  /** The "This search" section: the name and counts now, the folder and the other searches once the local API answers. */
  async function refreshSearch() {
    const mine = ++token, cur = S.crit0?.search;
    const city = cur?.city && cur.city !== 'generic' ? cur.city.toUpperCase() : '';
    const meta = (extra) => [city, `${S.listings.length} listing${S.listings.length === 1 ? '' : 's'}`, S.preview ? 'previewing edits' : '', extra].filter(Boolean).join(' · ');
    $('amName').textContent = cur?.name || 'No search loaded';
    $('amMeta').textContent = meta('');
    $('mnEdit').hidden = $('mnSearch').hidden = !cur;
    const api = await API.getSession();
    if (mine !== token) return;
    if (api?.search?.folder) $('amMeta').textContent = meta(api.search.folder);
    const others = (api?.searches || []).filter((s) => !s.active);
    $('mnSwitch').hidden = !others.length;
    const list = $('amSwitchList');
    list.innerHTML = others.map((s) => `<button type="button" role="menuitem" class="am-it" data-switch="${esc(s.folder)}">${FOLDER}<span class="t">${esc(s.name)}<small>${esc(s.folder)}</small></span></button>`).join('');
    if (!others.length) setSwitch(false);
    rove(menu.querySelector('button[tabindex="0"]'));
  }
  function setSwitch(on) {
    $('amSwitchList').hidden = !on; $('mnSwitch').setAttribute('aria-expanded', String(on));
  }

  function set(open, { from = btn, focus = false } = {}) {
    if (open === !menu.hidden && (!open || from === opener)) return;
    if (open) {
      opener = from; place(from);
      menu.hidden = false; scrim.hidden = !phone(); document.body.classList.add('am-open');
      document.body.classList.toggle('am-sheet', phone());
      setSwitch(false); refreshSearch();
      body.scrollTop = 0;
      const first = stops(menu)[0]?.[0];
      rove(first);
      if (focus) focusIn(first);
    } else {
      menu.hidden = true; scrim.hidden = true; document.body.classList.remove('am-sheet', 'am-open');
    }
    btn.setAttribute('aria-expanded', String(open && opener === btn));
    pill?.setAttribute('aria-expanded', String(open && opener === pill));
  }
  const close = (refocus = false) => { const o = opener; set(false); if (refocus) o.focus(); };

  for (const [el, from] of [[btn, btn], [pill, pill]]) {
    el?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!menu.hidden && opener === from) { close(); return; }
      if (!menu.hidden) set(false);
      set(true, { from, focus: e.detail === 0 });   // keyboard: land on the first row; mouse: leave focus where it is
    });
  }
  pill?.setAttribute('aria-haspopup', 'menu'); pill?.setAttribute('aria-expanded', 'false'); pill?.setAttribute('aria-controls', 'appMenu');
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target) && !pill?.contains(e.target)) close(); });
  scrim.addEventListener('click', () => close(true));
  addEventListener('resize', () => { if (!menu.hidden) { place(opener); scrim.hidden = !phone(); document.body.classList.toggle('am-sheet', phone()); } });
  document.addEventListener('keydown', (e) => {   // Esc closes it wherever focus is, and returns to the button it was opened from
    if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); e.preventDefault(); close(true); }
  }, true);

  let typed = '', typedAt = 0;
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { close(); return; }
    const rows = stops(menu), cur = document.activeElement;
    const ri = rows.findIndex((r) => r.includes(cur)), row = rows[ri];
    const go = (i) => { const r = rows[(i + rows.length) % rows.length]; focusIn(r === row ? cur : entry(r)); };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(ri + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(ri < 0 ? rows.length - 1 : ri - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusIn(entry(rows[0])); }
    else if (e.key === 'End') { e.preventDefault(); focusIn(entry(rows[rows.length - 1])); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && row?.length > 1) {
      e.preventDefault(); const j = row.indexOf(cur); focusIn(row[(j + (e.key === 'ArrowRight' ? 1 : -1) + row.length) % row.length]);
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {   // type a letter: jump to the next row that starts with it
      const now = Date.now(); typed = now - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase(); typedAt = now;
      const label = (r) => (r[0].querySelector('.t, span')?.textContent || r[0].getAttribute('aria-label') || r[0].textContent).trim().toLowerCase();
      const hit = [...rows.slice(ri + 1), ...rows.slice(0, ri + 1)].find((r) => r.length === 1 && label(r).startsWith(typed));
      if (hit) { e.preventDefault(); focusIn(hit[0]); }
    }
  });
  menu.addEventListener('focusin', (e) => { const b = e.target.closest('button[role^="menuitem"]'); if (b) rove(b); });

  // "This search" actions. Closing after a choice is shell.js's rule (everything closes except data-keep).
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'mnEdit') openWizard({ mode: 'edit' });
    else if (b.id === 'mnNew') openWizard({ mode: 'new' });
    else if (b.id === 'mnSwitch') { const on = $('amSwitchList').hidden; setSwitch(on); if (on) focusIn($('amSwitchList').querySelector('button')); }
    else if (b.dataset.switch) API.activate(b.dataset.switch).then(() => location.reload()).catch(() => {});
    else if (b.id === 'mnRestore') $('mnRestoreFile').click();
  });
  $('mnRestoreFile')?.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) importPicks(f); e.target.value = ''; });

  return { open: (from = btn, o = {}) => set(true, { from, ...o }), close, isOpen: () => !menu.hidden };
}
