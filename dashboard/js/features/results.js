// Results list and filter rail features, wired in one place so app.js needs a single import and a single call:
//   - the active-filter chip row                (filter-chips.js, filter-model.js)
//   - collapsible rail sections                  (rail-sections.js)
//   - windowed cards with rank-change motion     (card-list.js, virtual-model.js, morph.js, rank-ui.js, rank-model.js)
//   - the Comfortable / Compact density setting  (density.js)
//   - price history sparklines and drop chips    (price-ui.js, price-model.js)
//   - live re-scoring in a Web Worker            (rescore-live.js, rescore-core.js)
// See docs/guides/dashboard.md for what each one does for the renter.
import { initDensity, onDensity } from './density.js';
import { initCardList, relayoutCardList, setCardItems, clearCardList, cardIds, revealCard } from './card-list.js';
import { initRailSections, decorateRail, railFocus, restoreRailFocus } from './rail-sections.js';
import { initFilterChips } from './filter-chips.js';
import { initRankDeltas, deltaHTML } from './rank-ui.js';
import { initPriceHistory, trendHTML } from './price-ui.js';
import { initRescoreLive, rescoreWeights } from './rescore-live.js';

// what app.js uses
export { setCardItems, clearCardList, cardIds, revealCard, decorateRail, railFocus, restoreRailFocus, rescoreWeights, deltaHTML, trendHTML };

/** Called once from boot(), after the first scoring and before the first render. */
export function initResults() {
  initDensity();
  initCardList();
  initRailSections();
  initFilterChips();
  initRankDeltas();
  onDensity(() => requestAnimationFrame(relayoutCardList));   // the cards change size: measure them again
  initPriceHistory();
  setTimeout(() => initRescoreLive(), 300);   // after the first paint: the worker starts while the renter reads
}
