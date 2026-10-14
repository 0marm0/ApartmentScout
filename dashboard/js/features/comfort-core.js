// Comfort and personalisation preferences, pure (no DOM): which options exist, how a stored value is checked, and
// how the renter's choice combines with what the operating system already asks for.
//
// Transparency, contrast and motion follow the OS by default and the renter can only add to what the OS asks for:
// the effective value is `os || chosen`, so a system-wide accessibility setting is never switched off from a page.

export const TEXT_STEPS = [
  { id: 'm', label: 'Default', scale: 1 },
  { id: 'l', label: 'Large', scale: 1.125 },
  { id: 'xl', label: 'Larger', scale: 1.25 },
];
export const ACCENTS = [
  { id: 'iris', label: 'Iris' },
  { id: 'jade', label: 'Jade' },
  { id: 'amber', label: 'Amber' },
  { id: 'rose', label: 'Rose' },
];
export const DEFAULTS = Object.freeze({ transparency: false, contrast: false, motion: false, text: 'm', accent: 'iris', golden: false });

const pick = (list, v, d) => (list.some((x) => x.id === v) ? v : d);

/** Anything stored in the browser is untrusted: keep known keys with valid values, fall back to the defaults. */
export function normalizePrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    transparency: r.transparency === true, contrast: r.contrast === true, motion: r.motion === true, golden: r.golden === true,
    text: pick(TEXT_STEPS, r.text, DEFAULTS.text), accent: pick(ACCENTS, r.accent, DEFAULTS.accent),
  };
}

/** `os` = { transparency, contrast, motion } from the prefers-* media queries. */
export function resolveComfort(prefs, os = {}) {
  const p = normalizePrefs(prefs);
  return {
    transparency: !!os.transparency || p.transparency,
    contrast: !!os.contrast || p.contrast,
    motion: !!os.motion || p.motion,
    locked: { transparency: !!os.transparency, contrast: !!os.contrast, motion: !!os.motion },
    text: p.text, accent: p.accent, golden: p.golden,
  };
}

/** The data attributes the stylesheets key on (always explicit, so a rule never has to guess a default). */
export function htmlAttrs(prefs, os = {}) {
  const e = resolveComfort(prefs, os);
  return {
    'data-transparency': e.transparency ? 'reduced' : 'full',
    'data-contrast': e.contrast ? 'high' : 'normal',
    'data-motion': e.motion ? 'reduced' : 'full',
    'data-text': e.text,
    'data-accent': e.accent,
  };
}

/** Which of the OS-backed media queries a matchMedia() string asks about, or null. */
export function comfortQuery(q) {
  const s = String(q).toLowerCase().replace(/\s+/g, ' ');
  if (/prefers-reduced-motion: ?reduce\b/.test(s)) return 'motion';
  if (/prefers-reduced-transparency: ?reduce\b/.test(s)) return 'transparency';
  if (/prefers-contrast: ?(more|high)\b/.test(s)) return 'contrast';
  return null;
}
