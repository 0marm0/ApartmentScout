// Filter model for the results list and rail: which filters are active (the chip row above the results), what
// removing one means, and the one-line summary a collapsed rail section shows. Pure functions, no DOM and no
// imports, so node can test them; the DOM pieces are filter-chips.js and rail-sections.js.
//
// "Active" means different from the default the dashboard starts with: every budget tier selected, the five
// active statuses, no commute limit, no must-have or feature switch, no text, saved picks off.

export const NO_COMMUTE_LIMIT = 75;   // the rail's commute slider reads "Any" at its right end

const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const sortedNums = (a) => [...a].sort((x, y) => x - y);

/** The budget cap the filters imply, or null for "any price": all tiers off, or the Over tile on, means no cap. */
export function budgetCap(filters, tiers) {
  if (filters.over) return null;
  const sel = (filters.tiers || []).filter((i) => tiers[i]);   // saved filters can name a tier this search no longer has
  if (!sel.length) return null;
  return Math.max(...sel.map((i) => tiers[i]?.max ?? 0));
}

/** Is the budget filter something other than "within budget" (every tier selected)? */
export function budgetChanged(filters, tiers) {
  if (!tiers.length) return false;
  if (filters.over) return true;
  return !same(sortedNums((filters.tiers || []).filter((i) => tiers[i])), tiers.map((_, i) => i));
}

/** Compact status label: one name, two names, "All statuses", or a count with the full list in the tooltip. */
export function statusLabel(status, statuses) {
  const names = statuses.filter(([k]) => status.includes(k)).map(([, n]) => n);
  if (!names.length) return 'No status';
  if (names.length === statuses.length) return 'All statuses';
  if (names.length <= 2) return names.join(', ');
  return `${names.length} statuses`;
}

/**
 * The chips for the active filters, in the order the rail lists them.
 * ctx: { filters, tiers, statuses [[key, name]], defaultStatus [key], features [[key, label]], money(v), commute: { label, dest, multiDest } }
 * Each chip: { id, kind, label, title, tier? (index into tiers, for the colour dot) }.
 */
export function activeChips(ctx) {
  const { filters: f, tiers, statuses, defaultStatus, features, money, commute } = ctx;
  const out = [];
  if (budgetChanged(f, tiers)) {
    const cap = budgetCap(f, tiers), sel = (f.tiers || []).filter((i) => tiers[i]);
    if (cap == null) out.push({ id: 'budget', kind: 'budget', label: 'Any price', title: f.over ? 'Budget: any price, including homes over your cap' : 'Budget: no price cap' });
    else {
      const top = sel.reduce((a, i) => ((tiers[i]?.max ?? 0) >= (tiers[a]?.max ?? 0) ? i : a), sel[0]);
      const one = sel.length === 1 ? `${tiers[top]?.name} ` : '';
      out.push({ id: 'budget', kind: 'budget', tier: top, label: `${one}≤ ${money(cap)}`, title: `Budget: monthly cost at most ${money(cap)}${sel.length > 1 ? ` (${sel.length} tiers selected)` : ''}` });
    }
  }
  if (f.maxCommute < NO_COMMUTE_LIMIT) {
    const dest = commute?.multiDest && commute.dest ? ` to ${commute.dest}` : '';
    out.push({
      id: 'commute', kind: 'commute', label: `≤ ${f.maxCommute} min · ${commute?.label || 'Best'}`,
      title: `Commute: door to door at most ${f.maxCommute} minutes by ${(commute?.label || 'best').toLowerCase()}${dest}. Homes without a computed commute stay in the list.`,
    });
  }
  const labels = Object.fromEntries(features);
  for (const [k] of features) if ((f.toggles || []).includes(k)) out.push({ id: 'toggle:' + k, kind: 'toggle', label: labels[k], title: `Must have: ${labels[k]}` });
  for (const k of f.toggles || []) if (!(k in labels)) out.push({ id: 'toggle:' + k, kind: 'toggle', label: k.replaceAll('_', ' '), title: `Must have: ${k}` });
  if (!same([...(f.status || [])].sort(), [...defaultStatus].sort())) {
    const names = statuses.filter(([k]) => (f.status || []).includes(k)).map(([, n]) => n);
    out.push({ id: 'status', kind: 'status', label: statusLabel(f.status || [], statuses), title: `Status: ${names.join(', ') || 'none selected'}` });
  }
  const q = String(f.q || '').trim();
  if (q) out.push({ id: 'q', kind: 'q', label: `“${q.length > 24 ? q.slice(0, 23) + '…' : q}”`, title: `Text search: ${q}` });
  if (f.savedOnly) out.push({ id: 'saved', kind: 'saved', label: 'Saved picks', title: 'Only the homes you saved' });
  return out;
}

/**
 * What removing a chip does, as a patch for S.filters (undo of that one filter only).
 * ctx: { tiers, defaultStatus, filters }
 */
export function removalPatch(id, ctx) {
  const { tiers, defaultStatus, filters } = ctx;
  if (id === 'budget') return { over: false, tiers: tiers.map((_, i) => i) };
  if (id === 'commute') return { maxCommute: NO_COMMUTE_LIMIT };
  if (id === 'status') return { status: [...defaultStatus] };
  if (id === 'q') return { q: '' };
  if (id === 'saved') return { savedOnly: false };
  if (id.startsWith('toggle:')) return { toggles: (filters.toggles || []).filter((k) => k !== id.slice(7)) };
  return {};
}

/** Back to the starting state: what the "Clear all" button applies. */
export function defaultFilters(ctx) {
  return { q: '', toggles: [], savedOnly: false, maxCommute: NO_COMMUTE_LIMIT, status: [...ctx.defaultStatus], over: false, tiers: ctx.tiers.map((_, i) => i) };
}

/**
 * One-line summaries of each rail section's current setting (shown when the section is collapsed).
 * ctx: activeChips ctx plus { search: { name, preview }, weights {dim: n}, dims [[key, label]], preset: { label, same } | null, savedCount }
 */
export function sectionSummaries(ctx) {
  const { filters: f, tiers, statuses, defaultStatus, features, money, commute } = ctx;
  const cap = budgetCap(f, tiers);
  const budget = !tiers.length ? '' : cap == null ? 'Any price' : `${budgetChanged(f, tiers) ? '' : 'Within budget '}≤ ${money(cap)}`;
  const modeLabel = commute?.label || 'Best';
  const comm = f.maxCommute >= NO_COMMUTE_LIMIT ? `Any · ${modeLabel}` : `≤ ${f.maxCommute} min · ${modeLabel}`;
  const on = (f.toggles || []).length + (f.savedOnly ? 1 : 0);
  const status = same([...(f.status || [])].sort(), [...defaultStatus].sort()) ? 'Active' : statusLabel(f.status || [], statuses);
  const tot = Object.values(ctx.weights || {}).reduce((a, b) => a + b, 0) || 1;
  const top = (ctx.dims || []).map(([k, n]) => [n, (ctx.weights?.[k] || 0) / tot]).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([n, w]) => `${n} ${Math.round(w * 100)}%`).join(' · ');
  const weights = ctx.preset ? (ctx.preset.same ? ctx.preset.label : `${ctx.preset.label}, edited`) : top || 'Custom';
  return {
    search: ctx.search?.preview ? `${ctx.search.name} · preview` : ctx.search?.name || 'Your search',
    budget, commute: comm, features: on ? `${on} on` : 'None', status, weights,
  };
}
