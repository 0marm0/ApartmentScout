// The personalisation and comfort block of the settings menu (markup in index.html, marked [feature C]): accent
// swatches, the golden-hour tint, reduce transparency / high contrast / reduce motion, text size and the tour.
// The choices live in comfort.js; this file only reflects them in the controls and writes them back.
import { emit } from '../app.js';
import { toast } from '../util.js';
import { getPrefs, setPrefs, effective, onComfort } from './comfort.js';
import { startCoach } from './coach.js';

const SYSTEM_SAYS = { transparency: 'Your system asks for reduced transparency', contrast: 'Your system asks for more contrast', motion: 'Your system asks for reduced motion' };

export function initSettingsMenu() {
  const menu = document.getElementById('appMenu'); if (!menu) return;
  let lastAccent = getPrefs().accent;
  menu.querySelectorAll('[data-comfort] small').forEach((s) => { s.dataset.copy = s.textContent; });

  /** Reflect the effective settings in the controls. A setting the OS already asks for shows on and cannot be turned off here. */
  const sync = (e = effective()) => {
    const p = getPrefs();
    menu.querySelectorAll('[data-accent]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.accent === p.accent)));
    menu.querySelectorAll('[data-text]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.text === p.text)));
    menu.querySelector('#mnGolden')?.setAttribute('aria-checked', String(p.golden));
    menu.querySelectorAll('[data-comfort]').forEach((b) => {
      const k = b.dataset.comfort, locked = e.locked[k], small = b.querySelector('small');
      b.setAttribute('aria-checked', String(e[k]));
      b.toggleAttribute('aria-disabled', locked);
      if (locked) b.setAttribute('aria-disabled', 'true');
      if (small) small.textContent = locked ? 'On: set by your system' : small.dataset.copy;
      if (locked) b.title = `${SYSTEM_SAYS[k]}: change it in your system settings`; else b.removeAttribute('title');
    });
  };

  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.accent) {
      setPrefs({ accent: b.dataset.accent });
      if (b.dataset.accent !== lastAccent) { lastAccent = b.dataset.accent; emit('theme'); }   // the map and 3D scenes read the accent from the tokens
    } else if (b.dataset.text) setPrefs({ text: b.dataset.text });
    else if (b.id === 'mnGolden') setPrefs({ golden: !getPrefs().golden });
    else if (b.dataset.comfort) {
      const k = b.dataset.comfort;
      if (effective().locked[k]) { toast(`${SYSTEM_SAYS[k]}: change it in your system settings`); return; }
      setPrefs({ [k]: !getPrefs()[k] });
    } else if (b.id === 'mnTour') setTimeout(() => startCoach({ force: true }), 120);
  });
  onComfort(sync);
  sync();
}
