// Friendly empty states: small inline illustrations drawn in the design system's own style (hairline strokes in
// --ink-4, flat fills from the surface tokens, one accent detail, gold for stars, --sun for light) and a helper that
// builds the markup views drop into their `.empty` blocks. No data in here, no imports: it can be used from any view.

const SVG = (inner, label = '') => `<svg class="ill" viewBox="0 0 160 112" width="160" height="112" fill="none" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${inner}</svg>`;
const G = 'class="g"';   // ground shadow under every scene

const ART = {
  // no saved picks: a listing card with an empty star, a second card ghosted behind it
  picks: SVG(`
    <ellipse ${G} cx="80" cy="101" rx="44" ry="4.5"/>
    <rect class="ghost" x="30" y="30" width="62" height="64" rx="10"/>
    <rect class="card" x="48" y="14" width="68" height="78" rx="11"/>
    <rect class="photo" x="54" y="20" width="56" height="34" rx="7"/>
    <path class="hill" d="M54 46l14-12 11 9 8-6 15 11v6a7 7 0 01-7 7H61a7 7 0 01-7-7z"/>
    <circle class="sun" cx="98" cy="30" r="4"/>
    <rect class="bar" x="55" y="62" width="34" height="5" rx="2.5"/>
    <rect class="bar soft" x="55" y="72" width="22" height="4" rx="2"/>
    <circle class="badge" cx="104" cy="76" r="14"/>
    <path class="star" d="M104 67.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>`, 'A listing card with an empty star'),
  // nothing in Compare: two columns and a dashed empty slot with a plus
  compare: SVG(`
    <ellipse ${G} cx="80" cy="101" rx="52" ry="4.5"/>
    <rect class="card" x="14" y="20" width="40" height="70" rx="9"/>
    <rect class="bar" x="21" y="28" width="26" height="5" rx="2.5"/>
    <rect class="bar soft" x="21" y="40" width="26" height="3.5" rx="1.75"/><rect class="bar soft" x="21" y="49" width="20" height="3.5" rx="1.75"/><rect class="bar soft" x="21" y="58" width="24" height="3.5" rx="1.75"/>
    <rect class="card" x="60" y="14" width="40" height="76" rx="9"/>
    <rect class="bar" x="67" y="23" width="26" height="5" rx="2.5"/>
    <rect class="bar soft" x="67" y="36" width="26" height="3.5" rx="1.75"/><rect class="bar acc" x="67" y="45" width="20" height="3.5" rx="1.75"/><rect class="bar soft" x="67" y="54" width="24" height="3.5" rx="1.75"/>
    <rect class="slot" x="106" y="20" width="40" height="70" rx="9"/>
    <circle class="badge acc" cx="126" cy="55" r="11"/><path class="plus" d="M126 49.5v11M120.5 55h11"/>`, 'Two homes side by side and an empty slot'),
  // no records for this building: a report with a magnifier
  records: SVG(`
    <ellipse ${G} cx="80" cy="101" rx="42" ry="4.5"/>
    <path class="card" d="M42 12h48l22 22v54a8 8 0 01-8 8H42a8 8 0 01-8-8V20a8 8 0 018-8z"/>
    <path class="fold" d="M90 12v16a6 6 0 006 6h16"/>
    <rect class="bar" x="45" y="44" width="30" height="5" rx="2.5"/>
    <rect class="bar soft" x="45" y="56" width="52" height="3.5" rx="1.75"/><rect class="bar soft" x="45" y="65" width="44" height="3.5" rx="1.75"/><rect class="bar soft" x="45" y="74" width="36" height="3.5" rx="1.75"/>
    <circle class="lens" cx="108" cy="76" r="15"/><circle class="lensin" cx="108" cy="76" r="9.5"/>
    <path class="handle" d="M119 87l11 11"/><path class="mark" d="M103.5 76h9"/>`, 'A building report with a magnifying glass'),
  // no floor plan: a blueprint room with a door swing and dimension ticks
  plan: SVG(`
    <ellipse ${G} cx="80" cy="102" rx="54" ry="4.5"/>
    <rect class="card" x="20" y="14" width="120" height="82" rx="10"/>
    <path class="wall" d="M36 30h58v18h26v36H36z"/>
    <path class="door" d="M60 84a16 16 0 0116-16"/><path class="wall thin" d="M60 84h0M60 84V68"/>
    <path class="win glass" d="M46 30h22M104 48h14"/>
    <rect class="piece" x="42" y="36" width="24" height="14" rx="3"/>
    <rect class="piece acc" x="96" y="60" width="18" height="18" rx="9"/>
    <path class="dim" d="M36 22h58M36 19v6M94 19v6"/>
    <path class="dim" d="M128 48v36M125 48h6M125 84h6"/>`, 'A floor plan sketch'),
  // no site models: three blocks of different heights and the sun above them
  unit: SVG(`
    <ellipse ${G} cx="80" cy="101" rx="52" ry="4.5"/>
    <circle class="sun big" cx="118" cy="26" r="11"/>
    <path class="ray" d="M118 8v4M118 40v4M100 26h4M132 26h4M105 13l3 3M131 13l-3 3"/>
    <rect class="card" x="30" y="46" width="30" height="46" rx="4"/><rect class="card" x="62" y="22" width="34" height="70" rx="4"/><rect class="card" x="98" y="58" width="28" height="34" rx="4"/>
    <path class="win" d="M38 56h6M46 56h6M38 66h6M46 66h6M38 76h6M46 76h6M70 32h6M80 32h6M70 42h6M80 42h6M70 52h6M80 52h6M70 62h6M80 62h6M70 72h6M80 72h6M106 68h6M114 68h6M106 78h6M114 78h6"/>
    <path class="lit" d="M70 52h6M70 62h6"/>`, 'A tower with the sun beside it'),
  // no homes match: a funnel over an empty tray
  filters: SVG(`
    <ellipse ${G} cx="80" cy="102" rx="46" ry="4.5"/>
    <path class="card" d="M34 22h92L92 60v22l-24 10V60z"/>
    <path class="fold" d="M42 30h76"/>
    <circle class="dot" cx="64" cy="14" r="3"/><circle class="dot acc" cx="82" cy="9" r="3"/><circle class="dot" cx="100" cy="15" r="3"/>
    <path class="slot" d="M48 100h64" />`, 'A filter funnel with nothing coming through'),
  // Research tabs: photos, a timeline, a queue, a watchlist
  media: SVG(`
    <ellipse ${G} cx="80" cy="102" rx="50" ry="4.5"/>
    <rect class="ghost" x="38" y="22" width="76" height="56" rx="9" transform="rotate(-7 76 50)"/>
    <rect class="card" x="42" y="26" width="80" height="62" rx="10"/>
    <rect class="photo" x="48" y="32" width="68" height="40" rx="6"/>
    <path class="hill" d="M48 62l17-15 13 11 10-8 28 20v2a6 6 0 01-6 6H54a6 6 0 01-6-6z"/>
    <circle class="sun" cx="102" cy="43" r="5"/>
    <rect class="bar soft" x="48" y="77" width="30" height="4" rx="2"/>
    <circle class="badge acc" cx="122" cy="30" r="11"/><path class="plus" d="M122 25v10M117 30h10"/>`, 'A stack of photos'),
  history: SVG(`
    <ellipse ${G} cx="80" cy="102" rx="52" ry="4.5"/>
    <rect class="card" x="20" y="18" width="120" height="74" rx="10"/>
    <path class="dim" d="M34 78h92M34 32v46"/>
    <path class="slot" d="M36 66l20-10 18 6 20-20 24 8"/>
    <circle class="dot" cx="56" cy="56" r="3"/><circle class="dot" cx="74" cy="62" r="3"/><circle class="dot acc" cx="94" cy="42" r="3.4"/>
    <circle class="badge acc" cx="122" cy="28" r="11"/><path class="mark" d="M122 22v6l4 3"/>`, 'A timeline waiting for its first points'),
  queue: SVG(`
    <ellipse ${G} cx="80" cy="102" rx="48" ry="4.5"/>
    <rect class="card" x="32" y="14" width="96" height="78" rx="11"/>
    <circle class="badge acc" cx="50" cy="34" r="7.5"/><path class="plus" d="M46.5 34l2.6 2.6 4.6-5"/><rect class="bar" x="64" y="30" width="48" height="5" rx="2.5"/>
    <circle class="badge" cx="50" cy="54" r="7.5"/><rect class="bar soft" x="64" y="50" width="40" height="5" rx="2.5"/>
    <circle class="badge" cx="50" cy="74" r="7.5"/><rect class="bar soft" x="64" y="70" width="32" height="5" rx="2.5"/>`, 'An empty checklist'),
  watch: SVG(`
    <ellipse ${G} cx="80" cy="102" rx="46" ry="4.5"/>
    <rect class="card" x="44" y="22" width="48" height="70" rx="5"/>
    <path class="win" d="M54 34h8M74 34h8M54 46h8M74 46h8M54 58h8M74 58h8M54 70h8M74 70h8"/>
    <rect class="piece" x="62" y="76" width="12" height="16" rx="2"/>
    <circle class="badge acc" cx="112" cy="40" r="16"/>
    <path class="mark" d="M100 40c4-6 8-8 12-8s8 2 12 8c-4 6-8 8-12 8s-8-2-12-8z"/><circle class="dot acc" cx="112" cy="40" r="3.4"/>`, 'A building being watched'),
  // generic: an empty document
  doc: SVG(`
    <ellipse ${G} cx="80" cy="101" rx="40" ry="4.5"/>
    <path class="card" d="M46 12h44l22 22v54a8 8 0 01-8 8H46a8 8 0 01-8-8V20a8 8 0 018-8z"/>
    <path class="fold" d="M90 12v16a6 6 0 006 6h16"/>
    <rect class="bar soft" x="50" y="48" width="52" height="3.5" rx="1.75"/><rect class="bar soft" x="50" y="58" width="44" height="3.5" rx="1.75"/><rect class="bar soft" x="50" y="68" width="48" height="3.5" rx="1.75"/>`, ''),
};

/** The illustration for a kind (picks, compare, records, plan, unit, filters, media, history, queue, watch, doc) as an inline <svg>. */
export const illustration = (kind) => ART[kind] || ART.doc;

/**
 * A complete empty state: illustration, title, one line of help, optional buttons and a command to copy.
 * `title`, `body` and `actions` are HTML the caller has already escaped; `cls` adds the view's own class.
 */
export function emptyState(kind, { title, body = '', actions = '', cmd = '', cls = '' } = {}) {
  return `<div class="empty has-ill ${cls}">${illustration(kind)}<b>${title}</b>${body ? `<span>${body}</span>` : ''}${cmd ? `<code class="rs-cmd">${cmd}</code>` : ''}${actions ? `<div class="empty-act">${actions}</div>` : ''}</div>`;
}

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * The empty result list on the Map: "No saved picks yet" when the only filter is the saved-picks switch and nothing is
 * starred, otherwise "No homes match" with the text filter named. Both end in the button app.js wires as #resetFilters.
 */
export function cardsEmpty({ q = '', savedOnly = false, hasPicks = true } = {}) {
  if (savedOnly && !hasPicks) {
    return `<div class="empty cards-empty has-ill">${illustration('picks')}<b>No saved picks yet</b><span>Star a home with the star on a card, or press <kbd>s</kbd> on one. It will wait for you here.</span><button type="button" class="btn sm" id="resetFilters">Show all homes</button></div>`;
  }
  return `<div class="empty cards-empty has-ill">${illustration('filters')}<b>No homes match</b><span>${q ? `Nothing matches “${esc(q)}” with these filters. ` : ''}Loosen a filter on the left, or include more statuses.</span><button type="button" class="btn sm" id="resetFilters">Reset filters</button></div>`;
}
