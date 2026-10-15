// The glue between unit3d.js and the model-project modules, kept out of unit3d.js on purpose: the Model panel's
// actions, the comparison board, and importing a model project (restoring its site model, assumed parts, pin, plan
// scenario and view without a network) with the IndexedDB memory that keeps an imported scene after a reload.
// unit3d.js hands over a "bridge" (state getters and a few actions); nothing here reaches into its module state.
import { S } from '../app.js';
import { toast } from '../util.js';
import { createModelPanel } from './model-panel.js';
import { openCompareBoard, savedScenarios, lastComparison } from './compare-board.js';
import { parseModelProject, rememberProject, recalledProjects, forgetProject, base64ToBytes, sha256Hex } from './model-project.js';
import { saveAssumedParts, clearAssumedParts } from './parts.js';
import { savePin, clearPin } from './anchor.js';
import { savePlanScenario } from '../plan/scenario-bridge.js';

const overlay = () => (window.__AS_OVERLAY__ = window.__AS_OVERLAY__ || {});
const fileKey = (id) => `${S.base}/sites/${id}.json`;

/** Make an imported site loadable like any site file: through loadJSON's overlay and the manifest's site list. */
const wasListed = new Map();   // site id -> was it in the search's own manifest before an import added it
function register(project) {
  overlay()[fileKey(project.siteId)] = project.site;
  const sites = S.manifest.sites || [];
  if (!wasListed.has(project.siteId)) wasListed.set(project.siteId, sites.includes(project.siteId));
  if (!sites.includes(project.siteId)) S.manifest.sites = [...sites, project.siteId];
}

/** Add the project's plan to the Floor plan studio's browser library (best effort; it reads the library when it opens). */
function toStudioLibrary(project) {
  try {
    const key = `as:plan-projects.${S.base}`, lib = JSON.parse(localStorage.getItem(key) || '{}');
    const next = { ...(lib && typeof lib === 'object' ? lib : {}), [project.plan.id]: project.plan.project };
    const text = JSON.stringify(next);
    if (text.length < 3 * 1024 * 1024 && Object.keys(next).length <= 20) localStorage.setItem(key, text);
  } catch { /* storage full or unavailable: the Inside view still gets the plan through the scenario */ }
}

export function modelHooks(b) {
  let panel = null, recalled = false;
  const api = {
    get: () => b.get(),
    setUseScenario: (on) => b.setUseScenario(on),
    setFurniture: (on) => b.setFurniture(on),
    setCal: (m) => b.setCal(m),
    async setParts(map, preset) {
      const c = b.get();
      if (map) saveAssumedParts(c.id, map, { nBuildings: c.site.b.length, targetIndex: c.site.target, preset, base: c.base }); else clearAssumedParts(c.id);
      await b.rebuildScene();
      toast(map ? 'Building parts assumed. The drawing, the sun hours and the sky view now use them; the source data is unchanged.' : 'Back to the source geometry.', 4200);
      panel?.refresh(true);
    },
    openCompare: () => { const c = b.get(); if (!c) return; openCompareBoard(b.compareContext()); },
    glb: () => b.glb(),
    planForExport: () => b.planForExport(),
    savedScenarios: () => savedScenarios(b.get().id),
    lastComparison: () => lastComparison(b.get().id),
    hasSite: (id) => (S.manifest.sites || []).includes(id),
    isImported: (id) => fileKey(id) in overlay(),
    /** Drop an imported project's browser-only copy. A site that also exists on disk comes back from disk; one that only existed through the import disappears. */
    async forgetImported(id) {
      await forgetProject(S.base, id); delete overlay()[fileKey(id)];
      const onDisk = wasListed.get(id) === true;
      if (!onDisk) S.manifest.sites = (S.manifest.sites || []).filter((x) => x !== id);
      b.refreshSelect(); b.forceReload();
      toast(onDisk ? 'Forgot the imported project: the site model on disk is shown again.' : 'Forgot the imported project.', 4200);
      location.hash = '#unit' + ((S.manifest.sites || [])[0] && !onDisk ? '/' + encodeURIComponent(S.manifest.sites[0]) : onDisk ? '/' + encodeURIComponent(id) : '');
    },
    async restoreProject(project, text) {
      const id = project.siteId;
      if (project.glb?.sha256) { const ok = await sha256Hex(base64ToBytes(project.glb.data)); if (ok && ok !== project.glb.sha256) toast('The embedded 3D model does not match its checksum; the scene is restored from the site model instead.', 6000); }
      register(project);
      if (project.parts) saveAssumedParts(id, project.parts, { nBuildings: project.site.b.length, base: S.base }); else clearAssumedParts(id);
      if (project.pin) savePin(id, project.pin, { base: S.base }); else clearPin(id);
      if (project.plan) { savePlanScenario({ project: project.plan.project, base: S.base, label: project.plan.label || 'Imported project', from: 'studio' }); toStudioLibrary(project); try { localStorage.setItem('as:unit-scenario-use:' + id, '1'); } catch { /* ignore */ } }
      b.setEdits(id, project.edits);
      b.setPendingView(id, { ...(project.view || {}), cal: project.cal });
      try { localStorage.setItem('as:compare-specs:' + id, JSON.stringify(project.scenarios.slice(0, 4))); } catch { /* ignore */ }
      await rememberProject(S.base, id, text);
      b.refreshSelect();
      b.forceReload();                // load() skips an unchanged id; this one changed under it
      await b.load(id);
      toast(`Restored ${project.site.listing?.building || id} from the project. Nothing was downloaded.`, 4200);
    },
  };
  return {
    mount(host) { panel = createModelPanel(host, api); },
    refresh(force = false) { panel?.refresh(force); },
    /** Re-register the projects imported earlier in this browser, once per page. */
    async recall() {
      if (recalled) return; recalled = true;
      const rows = await recalledProjects(S.base);
      for (const r of rows) { const p = parseModelProject(r.text); if (p.ok) register(p.project); }
      if (rows.length) b.refreshSelect();
    },
  };
}
