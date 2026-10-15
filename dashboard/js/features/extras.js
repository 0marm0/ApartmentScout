// Entry point for the shell, commands and comfort features. app.js imports this lazily at the end of boot()
// (so a failure here can never blank the dashboard) and calls initExtras() once.
//
//   undo.js            Cmd/Ctrl+Z for picks, Compare, filters, weights and the commute lens, with an Undo toast
//   keys.js            g-chords, x and s on a focused card, the searchable cheat sheet (?)
//   nlsearch.js        plain-language queries in the command palette, chips above the results
//   settings-menu.js   accent, comfort switches, text size and the tour in the settings menu
//   golden-tint.js     the optional golden-hour wash over the map
//   coach.js           first-run coach marks
//   multidest.js       several commute destinations: limits, cards, drawer, combined heat
import { initUndo } from './undo.js';
import { initKeys } from './keys.js';
import { initNL } from './nlsearch.js';
import { initSettingsMenu } from './settings-menu.js';
import { initGolden } from './golden-tint.js';
import { initCoach } from './coach.js';
import { init as initMultiDest } from './multidest.js';   // [multi-destination] limits per destination, cards, drawer, combined heat

export function initExtras() {
  initUndo();
  initKeys();
  initNL();
  initSettingsMenu();
  initGolden();
  initCoach();
  initMultiDest();
}
