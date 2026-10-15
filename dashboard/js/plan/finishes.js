// The finishes of a unit as data: floor, walls, ceiling, kitchen, bath, window frames and doors, each with where it came from.
// Pure functions (no DOM, no three.js), so the plan model, the project validator, the accuracy chip and the node tests share one reading.
//
// Plan JSON:  finishes: {
//   floor:  {pattern: herringbone|basket|plank|tile|carpet|concrete, tone: "#hex" | name, basis, evidence},
//   walls / ceiling / window_frames / doors: {colour: "#hex" | name, basis, evidence},
//   kitchen: {cabinets, counters, backsplash: {colour...}, floor: {pattern, tone...}},
//   bath:    {tile, vanity: {colour...}, floor: {pattern, tone...}} }
// `basis` says what a value rests on: `renter` (you set or confirmed it), `photos` (read from the unit's own photos), `listing_text` (the
// listing or its photo review says so), `assumed` (a default or a guess). `evidence` is a short note ("photos 1-9"). A bare "#hex" or name is a value
// with basis `assumed`. The old `floor_finish: "basket" | "parquet" | "oak"` keeps working as a floor pattern (basket, herringbone, plank).
// A VISUAL PREVIEW: nothing in the model depends on these values.

export const FLOOR_PATTERNS = ['herringbone', 'basket', 'plank', 'tile', 'carpet', 'concrete'];
export const BASES = ['renter', 'photos', 'listing_text', 'assumed'];
export const CONFIDENCES = ['low', 'medium', 'high'];
/** The old `floor_finish` values and the pattern each one means. */
export const LEGACY_FLOOR = { basket: 'basket', parquet: 'herringbone', oak: 'plank' };
/** Which sections hold which leaves; a leaf is `{colour}` or, for floors, `{pattern, tone}`. */
export const SECTIONS = { floor: 'floor', walls: 'colour', ceiling: 'colour', window_frames: 'colour', doors: 'colour' };
export const GROUPS = { kitchen: { cabinets: 'colour', counters: 'colour', backsplash: 'colour', floor: 'floor' }, bath: { tile: 'colour', vanity: 'colour', floor: 'floor' } };
export const LABELS = {
  floor: 'Floor', walls: 'Walls', ceiling: 'Ceiling', window_frames: 'Window frames', doors: 'Doors',
  'kitchen.cabinets': 'Kitchen cabinets', 'kitchen.counters': 'Kitchen counters', 'kitchen.backsplash': 'Backsplash', 'kitchen.floor': 'Kitchen floor',
  'bath.tile': 'Bath tile', 'bath.vanity': 'Bath vanity', 'bath.floor': 'Bath floor',
};

/** Named tones a plan may use instead of a hex colour (sRGB). Lookup is case-insensitive and ignores hyphens and underscores. */
export const NAMED_TONES = {
  white: '#f7f4ef', 'warm white': '#f6f0e6', 'off white': '#f1eee7', ivory: '#f1ead8', cream: '#efe4cb', beige: '#dccdb2', greige: '#cbc4b8',
  'light grey': '#d6d6d4', grey: '#b5b5b3', 'dark grey': '#6b6c6e', charcoal: '#4a4b4e', black: '#222326', 'matte black': '#25262a', bronze: '#4a4034',
  honey: '#dcb27a', 'honey oak': '#d9a866', oak: '#cfb38a', 'light oak': '#dcc39c', 'dark oak': '#7d5e3d', natural: '#d2b48c', maple: '#e0c08e', ash: '#d7c3a3',
  'grey oak': '#a39d92', walnut: '#7a5538', espresso: '#4a3226', cherry: '#9a5a3c', mahogany: '#6b3b2a',
  concrete: '#aaa8a3', slate: '#5b6064', 'black granite': '#2a2a2c', granite: '#6a6a6c', marble: '#e8e6e1', 'white marble': '#ebe9e4', carrara: '#e4e2de', terrazzo: '#d8d3ca', quartz: '#e9e7e2',
  navy: '#2f3e5c', sage: '#a9b8a0', 'light blue': '#cfe0ee', 'soft grey': '#e2e2e0',
};
const nameKey = (s) => String(s).trim().toLowerCase().replace(/[-_\s]+/g, ' ');

/** "#rgb", "#rrggbb" (the # is optional) or a named tone, as lowercase "#rrggbb", or null. */
export function parseTone(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff) return `#${v.toString(16).padStart(6, '0')}`;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(s); if (m) return `#${m[1].toLowerCase()}`;
  m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s); if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase();
  return NAMED_TONES[nameKey(s)] || null;
}
/** "#rrggbb" -> 0xrrggbb. */
export const hexNum = (h) => parseInt(String(h).slice(1), 16);

const clean = (s, n) => String(s ?? '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * One leaf from raw JSON. `kind` 'floor' = {pattern, tone}, 'colour' = {colour}. Returns {leaf, problems}; `leaf` is null when nothing usable was given.
 * A string is a value of basis `assumed`; an object may carry basis, evidence and confidence.
 */
export function readLeaf(raw, kind, at = 'finish') {
  const problems = [];
  if (raw == null) return { leaf: null, problems };
  const o = typeof raw === 'string' || typeof raw === 'number' ? (kind === 'floor' ? (FLOOR_PATTERNS.includes(raw) ? { pattern: raw } : { tone: raw }) : { colour: raw }) : raw;
  if (!o || typeof o !== 'object' || Array.isArray(o)) { problems.push(`${at} must be an object or a colour`); return { leaf: null, problems }; }
  const leaf = {};
  if (kind === 'floor') {
    if (o.pattern != null) { if (FLOOR_PATTERNS.includes(o.pattern)) leaf.pattern = o.pattern; else problems.push(`${at}.pattern must be one of ${FLOOR_PATTERNS.join(', ')}`); }
    const t = o.tone ?? o.colour ?? o.color;
    if (t != null) { const hex = parseTone(t); if (hex) leaf.tone = hex; else problems.push(`${at}.tone "${clean(t, 30)}" is not a hex colour or a named tone`); }
    if (!leaf.pattern && !leaf.tone) return { leaf: null, problems };
  } else {
    const t = o.colour ?? o.color ?? o.tone;
    const hex = t == null ? null : parseTone(t);
    if (t != null && !hex) problems.push(`${at}.colour "${clean(t, 30)}" is not a hex colour or a named tone`);
    if (!hex) return { leaf: null, problems };
    leaf.colour = hex;
  }
  if (o.basis != null && !BASES.includes(o.basis)) problems.push(`${at}.basis must be one of ${BASES.join(', ')}`);
  leaf.basis = BASES.includes(o.basis) ? o.basis : 'assumed';
  leaf.evidence = clean(o.evidence, 160);
  if (o.confidence != null) { if (CONFIDENCES.includes(o.confidence)) leaf.confidence = o.confidence; else problems.push(`${at}.confidence must be low, medium or high`); }
  return { leaf, problems };
}

/**
 * The finishes of a plan, normalised. `raw` = the plan's `finishes` (any state, or already normalised), `legacy` = its `floor_finish`.
 * @returns {{finishes: object|null, warnings: string[]}}
 *   finishes = {floor, walls, ceiling, window_frames, doors, kitchen: {cabinets, counters, backsplash, floor}|null, bath: {tile, vanity, floor}|null}, each leaf or null;
 *   null when the plan states nothing. A leaf that cannot be read is dropped with a warning (the renderer then uses its default).
 */
export function normaliseFinishes(raw, legacy = null) {
  const warnings = [], f = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (raw != null && f !== raw) warnings.push('finishes must be an object');
  const out = { floor: null, walls: null, ceiling: null, window_frames: null, doors: null, kitchen: null, bath: null };
  const take = (v, kind, at) => { const r = readLeaf(v, kind, at); warnings.push(...r.problems); return r.leaf; };
  for (const [k, kind] of Object.entries(SECTIONS)) out[k] = take(f[k], kind, `finishes.${k}`);
  for (const [g, leaves] of Object.entries(GROUPS)) {
    const src = f[g]; if (src == null) continue;
    if (typeof src !== 'object' || Array.isArray(src)) { warnings.push(`finishes.${g} must be an object`); continue; }
    const grp = {}; let any = false;
    for (const [k, kind] of Object.entries(leaves)) { grp[k] = take(src[k], kind, `finishes.${g}.${k}`); any = any || !!grp[k]; }
    if (any) out[g] = grp;
  }
  // the old `floor_finish` is a floor pattern; the finishes model wins where it names one
  if (LEGACY_FLOOR[legacy] && !out.floor?.pattern) out.floor = { ...(out.floor || { basis: 'photos', evidence: 'floor_finish, matched to the listing photos' }), pattern: LEGACY_FLOOR[legacy] };
  const any = Object.values(out).some(Boolean);
  return { finishes: any ? out : null, warnings };
}

/** The first problem in a raw `finishes` object as a message, or '' when it is valid (strict: the project validator and the CLI use this). */
export function finishesError(raw) {
  if (raw == null) return '';
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'finishes must be an object';
  const known = new Set([...Object.keys(SECTIONS), ...Object.keys(GROUPS)]);
  for (const k of Object.keys(raw)) if (!known.has(k)) return `finishes: unsupported field ${k}`;
  const leafKeys = (kind) => (kind === 'floor' ? ['pattern', 'tone', 'basis', 'evidence', 'confidence'] : ['colour', 'basis', 'evidence', 'confidence']);
  const check = (v, kind, at) => {
    if (v == null) return '';
    if (typeof v === 'object' && !Array.isArray(v)) for (const k of Object.keys(v)) if (!leafKeys(kind).includes(k)) return `${at}: unsupported field ${k}`;
    if (typeof v === 'object' && !Array.isArray(v) && ['evidence'].some((k) => v[k] != null && (typeof v[k] !== 'string' || v[k].length > 160 || /[<>\u0000-\u001f]/.test(v[k])))) return `${at}.evidence must be plain text up to 160 characters`;
    const r = readLeaf(v, kind, at); if (r.problems.length) return r.problems[0];
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !r.leaf) return `${at} needs ${kind === 'floor' ? 'a pattern or a tone' : 'a colour'}`;
    return '';
  };
  for (const [k, kind] of Object.entries(SECTIONS)) { const e = check(raw[k], kind, `finishes.${k}`); if (e) return e; }
  for (const [g, leaves] of Object.entries(GROUPS)) {
    if (raw[g] == null) continue;
    if (typeof raw[g] !== 'object' || Array.isArray(raw[g])) return `finishes.${g} must be an object`;
    for (const k of Object.keys(raw[g])) if (!(k in leaves)) return `finishes.${g}: unsupported field ${k}`;
    for (const [k, kind] of Object.entries(leaves)) { const e = check(raw[g][k], kind, `finishes.${g}.${k}`); if (e) return e; }
  }
  return '';
}

/** Every leaf that is set, flat: [{key: 'kitchen.cabinets', label, ...leaf}] in a fixed order. */
export function finishLeaves(finishes) {
  const out = [];
  if (!finishes) return out;
  for (const k of Object.keys(SECTIONS)) if (finishes[k]) out.push({ key: k, label: LABELS[k], ...finishes[k] });
  for (const [g, leaves] of Object.entries(GROUPS)) for (const k of Object.keys(leaves)) if (finishes[g]?.[k]) out.push({ key: `${g}.${k}`, label: LABELS[`${g}.${k}`], ...finishes[g][k] });
  return out;
}

/**
 * What the finishes rest on, for the accuracy chip and the CLI: the labels grouped by basis, and the defaults for what the plan does not state.
 * Accepts a raw or a normalised `finishes` (and the legacy `floor_finish`).
 */
export function finishesSummary(finishes, legacy = null) {
  const { finishes: f } = normaliseFinishes(finishes, legacy);
  const by = { renter: [], photos: [], listing_text: [], assumed: [] };
  for (const l of finishLeaves(f)) by[l.basis].push(l.label.toLowerCase());
  const stated = new Set(finishLeaves(f).map((l) => l.key));
  const unstated = ['floor', 'walls', 'ceiling', 'window_frames', 'doors'].filter((k) => !stated.has(k)).map((k) => LABELS[k].toLowerCase());
  const evidence = finishLeaves(f).filter((l) => l.basis === 'photos' && l.evidence).map((l) => `${l.label.toLowerCase()}: ${l.evidence}`);
  return { by, unstated, evidence, total: stated.size, fromSources: by.renter.length + by.photos.length + by.listing_text.length };
}

/**
 * What the 3D builders read, with nothing but plain data: hex numbers (0xrrggbb) or null where the plan says nothing (the builder keeps its default).
 * @returns {{floor: {pattern: string|null, tone: number|null}|null, walls: number|null, ceiling: number|null, frames: number|null, doors: number|null,
 *   cabinets: number|null, counters: number|null, backsplash: number|null, kitchenFloor: object|null, bathTile: number|null, vanity: number|null, bathFloor: object|null}|null}
 */
export function resolveFinishes(finishes) {
  if (!finishes) return null;
  const c = (l) => (l?.colour ? hexNum(l.colour) : null), fl = (l) => (l ? { pattern: l.pattern || null, tone: l.tone ? hexNum(l.tone) : null } : null);
  return {
    floor: fl(finishes.floor), walls: c(finishes.walls), ceiling: c(finishes.ceiling), frames: c(finishes.window_frames), doors: c(finishes.doors),
    cabinets: c(finishes.kitchen?.cabinets), counters: c(finishes.kitchen?.counters), backsplash: c(finishes.kitchen?.backsplash), kitchenFloor: fl(finishes.kitchen?.floor),
    bathTile: c(finishes.bath?.tile), vanity: c(finishes.bath?.vanity), bathFloor: fl(finishes.bath?.floor),
  };
}

/** Relative luminance of "#rrggbb" in 0..1 (sRGB, simple): used to choose frame metalness and to tell a pale colour from a dark one. */
export function lightness(hex) {
  const n = hexNum(hex), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
