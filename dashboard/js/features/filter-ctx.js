// The dashboard's current filter state as the plain object features/filter-model.js works on. Shared by the
// chip row and the collapsible rail sections.
import { S, ACTIVE, STATUSES, FEATURES, DIMS, MODE_LABEL, dest, dests } from '../app.js';
import { money } from '../util.js';

export function filterContext() {
  const d = dest(), P = S.crit.scoring?.presets, cur = S.preset && P?.[S.preset];
  return {
    filters: S.filters, tiers: S.crit.budget?.tiers || [], statuses: STATUSES, defaultStatus: ACTIVE, features: FEATURES, money,
    commute: { label: MODE_LABEL[S.commuteMode] || 'Best', dest: d?.name, multiDest: dests().length > 1 },
    search: { name: S.crit.search?.name || 'Your search', preview: !!S.preview },
    weights: S.weights, dims: DIMS,
    preset: cur ? { label: cur.label, same: DIMS.every(([k]) => (cur.weights[k] || 0) === (S.weights[k] || 0)) } : null,
  };
}
