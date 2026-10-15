// The Measure button, the Clear button and the hint line, for any toolbar. The button is appended to the toolbar it is given
// (the studio's camera row, Unit 3D's tool column, the 2D plan's dimension row) so it takes that toolbar's own look; a stage
// without one gets a small floating group in the style of the studio's other tools (css/measure.css).
const RULER = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.2 10.6L10.6 2.2a1 1 0 0 1 1.4 0l1.8 1.8a1 1 0 0 1 0 1.4L5.4 13.8a1 1 0 0 1-1.4 0L2.2 12a1 1 0 0 1 0-1.4z"/><path d="M5 8.2l1.6 1.6M7.2 6l1.2 1.2M9.4 3.9l1.6 1.6"/></svg>';

/**
 * @param {HTMLElement|null} host toolbar to append to
 * @param {HTMLElement} stage fallback parent for a floating group
 * @param {{label: string, id: string, icon?: boolean, onToggle: (on: boolean) => void, onClear: () => void}} o
 *   `icon`: an icon-only button (for a column of icon buttons) with the label as its tooltip and accessible name
 */
export function mountMeasureButtons(host, stage, o) {
  const floating = !host;
  const root = floating ? Object.assign(document.createElement('div'), { className: 'float ms-bar', role: 'group' }) : host;
  if (floating) { root.setAttribute('aria-label', 'Measure'); stage.appendChild(root); }
  const sep = document.createElement(o.icon ? 'hr' : 'i'); sep.className = 'ms-sep'; sep.setAttribute('aria-hidden', 'true');
  const tool = Object.assign(document.createElement('button'), { type: 'button', id: `${o.id}Tool`, className: `ms-tool${o.icon ? ' ms-icon' : ''}` });
  tool.setAttribute('aria-pressed', 'false');
  tool.title = 'Measure: click two points on a floor, wall or piece. It snaps to wall corners, window edges and furniture edges. Esc to finish.';
  if (o.icon) tool.setAttribute('aria-label', o.label);
  tool.innerHTML = o.icon ? RULER : `${RULER}<span>${o.label}</span>`;
  const clear = Object.assign(document.createElement('button'), { type: 'button', id: `${o.id}Clear`, className: 'ms-clear', hidden: true });
  clear.title = 'Remove every measurement';
  if (!floating) root.append(sep);
  root.append(tool, clear);
  let active = false;
  tool.addEventListener('click', () => api.set(!active, true));
  clear.addEventListener('click', () => o.onClear());
  const api = {
    el: root, tool, clear,
    set(on, notify = false) { active = !!on; tool.classList.toggle('on', active); tool.setAttribute('aria-pressed', String(active)); if (notify) o.onToggle(active); },
    get active() { return active; },
    count(n) { clear.hidden = !n; clear.textContent = n ? (o.icon ? `×${n}` : `Clear ${n}`) : ''; clear.setAttribute('aria-label', `Clear ${n} measurement${n === 1 ? '' : 's'}`); },
    /** Show or hide the whole control (a mode where there is nothing to measure). */
    show(on) { tool.hidden = !on; sep.hidden = !on; if (!on) clear.hidden = true; else clear.hidden = !clear.textContent; },
  };
  return api;
}

/** A line of help over the stage when measuring starts: it shows for a few seconds (`show()`), then gets out of the way. */
export function mountHint(stage, text) {
  const el = Object.assign(document.createElement('div'), { className: 'ms-hint', hidden: true });
  el.setAttribute('role', 'status');
  el.textContent = text;
  stage.appendChild(el);
  let t = 0;
  return {
    el,
    show(on) { clearTimeout(t); el.hidden = !on; if (on) t = setTimeout(() => { el.hidden = true; }, 6500); },
    remove() { clearTimeout(t); el.remove(); },
  };
}
