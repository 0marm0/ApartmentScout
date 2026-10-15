// Sections that features add to the listing drawer just under "Why it ranks here" (app.js calls hooks.drawerTop(L) once per
// drawer). Each feature registers a function that returns the section's HTML for a home, or '' for none; they are joined in
// `order`. A feature that throws is skipped, so one bad section never blanks the drawer.
import { hooks } from '../app.js';

const parts = new Map();
export function addDrawerTop(name, fn, order = 0) {
  parts.set(name, { fn, order });
  hooks.drawerTop = (L) => [...parts.values()].sort((a, b) => a.order - b.order)
    .map((p) => { try { return p.fn(L) || ''; } catch (e) { console.warn('a drawer section failed', e); return ''; } }).join('');
}
