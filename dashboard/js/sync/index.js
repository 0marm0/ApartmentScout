// Entry point of sync (loaded with the decision-workflow features, features/index.js). Starting it reads and sends nothing: the engine only
// timestamps changes in this browser until a gist is connected or a file is exported or imported by hand. docs/guides/sync.md has the details.
import * as E from './engine.js';
import { initSyncUi } from './sync-ui.js';

export async function init() {
  initSyncUi();
  window.__asSync = { status: E.status, probe: E.probe, syncNow: E.syncNow };   // read-only handles for headless checks; the page never uses them
  await E.init();
}
export { E as engine };
